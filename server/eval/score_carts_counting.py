"""
How far off is the count, and which mechanism is putting it there?

Counting is the second of the four capabilities in CLAUDE.md and it is the one with the least
evidence behind it. Neither the shelf corpus nor this one carries a per-item count: the shelf
annotation is partial, and nobody has counted the items in these 24 photographs.

Two things can be done honestly.

First, hand-verified counts on the photographs where a person can actually count. On a dense
Trader Joe's haul or a filled trolley the answer is not knowable from the image; on a table
holding seven things it is. Those judgements are in `cart-counts.json`, one line each, with the
mistakes named rather than summarised.

Second, and reproducibly across all 24, the mechanism. The over-counts observed by hand were all
one shape: a proposal sitting inside another proposal. A twin-pack of peanut butter arrives as
the pack and both jars; a six-pack of ale arrives as the carrier and three bottle necks; a jar
arrives with a second box around its label. That is measurable without ground truth, because it
is a statement about the proposals rather than about the world.

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
        print(f"    n = {len(errors)}. This is a characterisation, not a metric: three")
        print("    photographs is too few to quote as an accuracy, and it is here because the")
        print("    alternative was to quote nothing at all about counting.")
    return {"nested_share": nested / max(total, 1), "errors": errors}


if __name__ == "__main__":
    main()
