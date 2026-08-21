"""
How far off is the count, and which mechanism is putting it there?

Counting is the second of the four capabilities in CLAUDE.md and it is the one with the least
evidence behind it. Neither the shelf corpus nor this one carries a per-item count: the shelf
annotation is partial, and this corpus arrived without counts.

Two things can be done honestly.

First, hand-verified counts on the photographs where a person can actually count. On a dense
Trader Joe's haul or a filled trolley the answer is not knowable from the image; on a table
holding seven things it is. Those judgements are in `cart-counts.json`, one line each, with the
mistakes named rather than summarised. Sixteen of the twenty-four have now been judged, six of
them countable.

`correct` is recorded separately from `products` because the two can agree by accident. One
photograph here proposes eight boxes for eight products and is still wrong twice: one box is on
a napkin holder and one product drew nothing. A harness that only compared totals would score
that as perfect.

Second, and reproducibly across all 24, the mechanism. Under the shape-word prompt the errors
were over-counts, and all of one shape: a proposal sitting inside another proposal. A twin-pack
of peanut butter arrived as the pack and both jars; a six-pack of ale as the carrier and three
bottle necks. That is measurable without ground truth, because it is a statement about the
proposals rather than about the world, and it is still reported below.

Since the prompt was chosen by measurement the error has changed sign. Nesting is down to 2.6%
of proposals and the counts now run short rather than long. The misses are not distributed at
random: on the one photograph where every item is separately visible, all seven packaged items
were found and all six loose or netted produce items were missed.

    server/.venv/bin/python server/eval/score_carts_counting.py
"""
import argparse
import json
import pathlib

HERE = pathlib.Path(__file__).parent
NESTED = 0.80


def inside_of(inner, outer):
    """Fraction of `inner` that lies within `outer`."""
    area = inner["w"] * inner["h"]
    if area <= 0:
        return 0.0
    x = max(inner["x"], outer["x"])
    y = max(inner["y"], outer["y"])
    w = min(inner["x"] + inner["w"], outer["x"] + outer["w"]) - x
    h = min(inner["y"] + inner["h"], outer["y"] + outer["h"]) - y
    return (w * h) / area if w > 0 and h > 0 else 0.0


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--frames", default=str(HERE / "carts-frames.json"))
    parser.add_argument("--truth", default=str(HERE / "corpus" / "cart-counts.json"))
    args = parser.parse_args(argv)

    frames = json.loads(pathlib.Path(args.frames).read_text())["frames"]
    truth = json.loads(pathlib.Path(args.truth).read_text())
    counted = {c["id"]: c for c in truth["counted"]}

    print(f"{len(frames)} photographs\n")
    print("  proposals sitting inside another proposal")
    total = nested = 0
    per_image = []
    for frame in frames:
        boxes = frame["boxes"]
        inner = sum(
            1 for i, a in enumerate(boxes)
            if any(
                j != i
                and b["w"] * b["h"] > a["w"] * a["h"]
                and inside_of(a, b) >= NESTED
                for j, b in enumerate(boxes)
            )
        )
        total += len(boxes)
        nested += inner
        per_image.append((frame["id"], len(boxes), inner))
    print(f"    {nested} of {total} ({nested / max(total, 1):.1%})")
    print("    every over-count found by hand was one of these: a pack arriving as the pack and")
    print("    its members, or a jar arriving with a second box around its label")

    print("\n  hand-counted photographs")
    print("    id                     real  proposed  correct  error")
    errors = []
    for frame in frames:
        entry = counted.get(frame["id"])
        if not entry:
            continue
        proposed = len(frame["boxes"])
        error = proposed - entry["products"]
        errors.append(error)
        print(f"    {frame['id']:22s} {entry['products']:4d} {proposed:9d} "
              f"{entry['correct']:8d} {error:+6d}")
    if errors:
        print(f"\n    mean signed error   {sum(errors) / len(errors):+.1f} items")
        print(f"    mean absolute error {sum(abs(e) for e in errors) / len(errors):.1f} items")
        kinds = {}
        for entry in truth["counted"]:
            for item in entry.get("missed", []):
                kinds[item["kind"]] = kinds.get(item["kind"], 0) + 1
        if kinds:
            total_missed = sum(kinds.values())
            produce = sum(n for k, n in kinds.items() if "produce" in k)
            print(f"\n    of {total_missed} items the detector drew nothing for, "
                  f"{produce} are produce")
            for kind, n in sorted(kinds.items(), key=lambda kv: -kv[1]):
                print(f"      {n:2d}  {kind}")
        print(f"\n    n = {len(errors)}. This is a characterisation, not a metric: a handful of")
        print("    photographs is too few to quote as an accuracy, and it is here because the")
        print("    alternative was to quote nothing at all about counting.")
    return {"nested_share": nested / max(total, 1), "errors": errors}


if __name__ == "__main__":
    main()
