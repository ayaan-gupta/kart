"""What the confidence floor costs, and what it buys, on stored naming outcomes.

The floor is the single constant that decides which of the app's overlay states an item gets:
above it the item is named and drawn green, below it the item is drawn amber and the shopper is
asked to look closer. Every naming run here already stores, per crop, the whole ranked shortlist
and the raw confidence before any floor was applied, so the entire coverage/precision curve is
recoverable from a finished run without touching a GPU. This prints it.

Reading the curve rather than a single number matters because the two failure modes trade
against each other and only one of them is visible in a top-1 figure. A floor set too low
asserts a wrong name confidently, which is the failure the amber state exists to prevent. A
floor set too high declines items it had right, which shows the shopper amber on an item the
system actually knew. `rank.fit_floor` picks the cut; this says what the rest of the curve looked
like, so a floor can be argued about with the alternatives in view.

The stored `sku` is None below the floor, so the crop's would-be answer is read back off the
head of its own shortlist. Verified exact on both stored runs: of 2,085 named crops across them,
zero have `sku` different from `shortlist[0]`, so the reconstruction is the matcher's own answer
and not an approximation of it.

    ../.venv/bin/python report_grocer_floor.py
"""

import argparse
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
CACHE = HERE / ".cache" / "grocer"
sys.path.insert(0, str(HERE.parent))

from catalog import matcher as matcher_module  # noqa: E402

# The floor each stored run ships with. A run's rows are written with whatever floor was current
# when it ran, so the stored `sku` cannot be compared across runs; the raw confidence can, and
# that is what this applies these to.
SHIPPED = {
    "b16-spread-notta": ("one encoder, references spread", matcher_module.FLOOR),
    "ens-notta": ("two-encoder ensemble (shipped default)", matcher_module.FLOOR),
    "b16-ft1-notta": ("one encoder, fine-tuned 1 epoch", matcher_module.FLOOR_FINETUNED),
}

STEPS = (0.0, 0.50, 0.60, 0.70, 0.80, 0.87, 0.90, 0.93, 0.96, 0.98, 0.99)


def answer(row):
    """The name this crop would be given at a floor of zero.

    Not `row["sku"]`, which is already None below whatever floor was current when the run was
    written and so cannot be compared across runs. The head of the ranked shortlist is the
    matcher's own answer: across the two stored runs, all 2,085 named crops have `sku` equal to
    `shortlist[0]`, so this recovers it rather than approximating it.
    """
    return row["shortlist"][0] if row["shortlist"] else None


def outcomes(tag):
    """Answerable crops from one stored run, each carrying the answer it would give at any floor."""
    path = CACHE / f"rows-{tag}.json"
    if not path.exists():
        return None
    rows = [r for r in json.loads(path.read_text()) if r["answerable"]]
    for row in rows:
        row["head"] = answer(row)
    return rows


def curve(rows, steps=STEPS):
    """(floor, coverage, precision, right-of-all) at each cut."""
    total = max(len(rows), 1)
    out = []
    for floor in steps:
        named = [r for r in rows if r["confidence"] >= floor]
        if not named:
            continue
        right = sum(1 for r in named if r["head"] == r["truth"])
        out.append((floor, len(named) / total, right / len(named), right / total))
    return out


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runs", default=",".join(SHIPPED))
    args = parser.parse_args(argv)

    found = [(tag, outcomes(tag)) for tag in args.runs.split(",")]
    found = [(tag, rows) for tag, rows in found if rows]
    if not found:
        print("no stored runs; run score_grocer.py first")
        return 1

    print(f"  {'run':38} {'top-1':>7} {'top-5':>7} {'ceiling':>8}")
    for tag, rows in found:
        label = SHIPPED.get(tag, (tag, None))[0]
        n = len(rows)
        top1 = sum(1 for r in rows if r["head"] == r["truth"]) / n
        top5 = sum(1 for r in rows if r["truth"] in r["shortlist"][:5]) / n
        ceiling = sum(1 for r in rows if r["truth"] in r["shortlist"]) / n
        print(f"  {label:38} {top1:>7.1%} {top5:>7.1%} {ceiling:>8.1%}")
    print("\n  Floor-independent. Every crop is named; the question is only whether the name is"
          "\n  right. The ceiling is how often the answer is anywhere in the shortlist at all,"
          "\n  which bounds what any fusion or re-ranking on top of it could reach.")

    for tag, rows in found:
        label, shipped = SHIPPED.get(tag, (tag, None))
        print(f"\n  {label}  ({len(rows)} answerable crops)")
        print(f"    {'floor':>7} {'named':>8} {'precision':>10} {'right of all':>13}")
        for floor, coverage, precision, overall in curve(rows):
            mark = "  <- shipped" if shipped is not None and abs(floor - shipped) < 1e-9 else ""
            print(f"    {floor:>7.2f} {coverage:>7.1%} {precision:>10.1%} "
                  f"{overall:>12.1%}{mark}")

    print("\n  named        share of crops the app would draw green")
    print("  precision    of those, how many carry the right name")
    print("  right of all named correctly as a share of every crop, which is the only column"
          "\n               where a floor change and a model change are comparable")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
