"""
Does an item being covered actually predict that we will name it wrong?

CLAUDE.md lists four capabilities and this harness is about the third and fourth: items hidden
under other items must be flagged as hidden, and items the system is unsure of must be flagged
as unsure. The app has neither at the level of a single item. It has a scene-level occlusion
verdict that decides whether to open guided capture, which answers "is this cart stacked" and
never "is *this* yogurt buried".

Before adding a per-item state it is worth knowing whether the geometry predicts anything. The
rule under test is deliberately simple and identical to the one the app will run:

  an item is covered by the parts of other items that sit *in front* of it, and an item is in
  front when its box bottom edge is lower in the frame.

That depth cue is the only one available from boxes alone, and it is the right one for objects
resting in a container photographed from above and in front: nearer things sit lower. It is a
cue, not a fact, and it fails for an item hanging over the rim.

The validation is not circular. The rule is computed from geometry; what is measured is whether
naming accuracy falls as the rule's score rises. If it does, the score is worth showing the
shopper, and the threshold can be read off the curve rather than invented.

One caveat bounds every number here: this corpus is partially annotated, so an item covered by
an unlabelled product scores zero coverage and lands in the clear bucket. That biases the clear
bucket downwards, which makes the gap measured here a floor rather than an estimate.

    server/.venv/bin/python server/eval/score_grocer_occlusion.py --tag b16-spread-notta
"""
import argparse
import collections
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).parent
CACHE = HERE / ".cache" / "grocer"
sys.path.insert(0, str(HERE))

from grocer import corpus  # noqa: E402


def hidden_fraction(subject, others):
    """Share of `subject`'s box covered by the union of the boxes in front of it.

    The union, not the sum. Two items overlapping the same corner of a third cover that corner
    once, and summing them reports a jar as more than fully hidden.

    Computed by compressing the occluders' edges into a grid over the subject and measuring the
    cells that are covered. Exact for axis-aligned boxes, and with the handful of items a cart
    holds the grid is small enough that exactness is free.
    """
    sx0, sy0, sx1, sy1 = subject
    width, height = sx1 - sx0, sy1 - sy0
    if width <= 0 or height <= 0:
        return 0.0
    clipped = []
    for ox0, oy0, ox1, oy1 in others:
        x0, y0 = max(sx0, ox0), max(sy0, oy0)
        x1, y1 = min(sx1, ox1), min(sy1, oy1)
        if x1 > x0 and y1 > y0:
            clipped.append((x0, y0, x1, y1))
    if not clipped:
        return 0.0
    xs = sorted({sx0, sx1, *(v for c in clipped for v in (c[0], c[2]))})
    ys = sorted({sy0, sy1, *(v for c in clipped for v in (c[1], c[3]))})
    covered = 0.0
    for i in range(len(xs) - 1):
        for j in range(len(ys) - 1):
            cx, cy = (xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2
            for x0, y0, x1, y1 in clipped:
                if x0 <= cx <= x1 and y0 <= cy <= y1:
                    covered += (xs[i + 1] - xs[i]) * (ys[j + 1] - ys[j])
                    break
    return min(1.0, covered / (width * height))


def in_front(subject, other):
    """Whether `other` is nearer the camera than `subject`, by the ground-plane cue."""
    return other[3] > subject[3]


def coverage_by_scene(root=None):
    """Hidden fraction for every labelled instance, keyed by (digest, order)."""
    pool = corpus.scenes(root) if root else corpus.scenes()
    out = {}
    for scene in pool:
        boxes = [(c.x0, c.y0, c.x1, c.y1) for c in scene.crops]
        for i, subject in enumerate(boxes):
            others = [b for j, b in enumerate(boxes) if j != i and in_front(subject, b)]
            out[(scene.digest[:12], i)] = hidden_fraction(subject, others)
    return out


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tag", required=True)
    args = parser.parse_args(argv)

    rows = json.loads((CACHE / f"rows-{args.tag}.json").read_text())
    answerable = [r for r in rows if r["answerable"]]
    print(f"{len(answerable)} answerable crops from {CACHE / f'rows-{args.tag}.json'}")
    print("computing coverage for every labelled instance in the corpus")
    coverage = coverage_by_scene()
    print(f"  {len(coverage)} instances")

    for row in answerable:
        stem = pathlib.Path(row["path"]).stem
        digest, order = stem.rsplit("-", 1)
        row["hidden"] = coverage.get((digest, int(order)), 0.0)

    bands = [(0.0, 0.05), (0.05, 0.2), (0.2, 0.4), (0.4, 0.6), (0.6, 1.01)]
    print("\n  hidden fraction   n      top-1     declined   silent error")
    summary = []
    for low, high in bands:
        band = [r for r in answerable if low <= r["hidden"] < high]
        if not band:
            continue
        top1 = sum(1 for r in band if r["sku"] == r["truth"]) / len(band)
        declined = sum(1 for r in band if r["sku"] is None) / len(band)
        silent = sum(
            1 for r in band if r["sku"] is not None and r["sku"] != r["truth"]
        ) / len(band)
        label = f"{low:.2f}-{min(high, 1.0):.2f}"
        print(f"    {label:14s} {len(band):5d}   {top1:6.1%}   {declined:8.1%}   {silent:9.1%}")
        summary.append({"low": low, "high": high, "n": len(band), "top1": top1,
                        "declined": declined, "silent_error": silent})

    # The threshold worth shipping is the one where the item is more likely to be got wrong
    # than right, because that is the point at which asking the shopper to move something beats
    # guessing at it.
    print("\n  cumulative, treating everything at or above the threshold as covered")
    print("    threshold   flagged   top-1 below   top-1 at or above")
    chosen = None
    for threshold in (0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7):
        above = [r for r in answerable if r["hidden"] >= threshold]
        below = [r for r in answerable if r["hidden"] < threshold]
        if not above:
            continue
        acc_above = sum(1 for r in above if r["sku"] == r["truth"]) / len(above)
        acc_below = sum(1 for r in below if r["sku"] == r["truth"]) / len(below)
        print(f"    {threshold:9.2f}   {len(above) / len(answerable):7.1%}   "
              f"{acc_below:11.1%}   {acc_above:17.1%}")
        if chosen is None and acc_above < 0.5:
            chosen = threshold
    print(f"\n  lowest threshold at which a flagged item is more often wrong than right: {chosen}")

    out = CACHE / f"occlusion-{args.tag}.json"
    out.write_text(json.dumps({"tag": args.tag, "bands": summary, "threshold": chosen}, indent=1))
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
