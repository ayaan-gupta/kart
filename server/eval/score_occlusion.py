"""
Does the geometric half of the occlusion verdict actually detect occlusion?

This is the feature with the largest measured value and no test. Naming accuracy nearly halves
between an uncrowded scene and a stacked one (server/eval/CATALOG.md), so asking a shopper to
move the thing on top is worth about thirty points on whatever is underneath. Nothing had ever
checked that the warning fires when it should.

`src/engine/liveVision/occlusion.ts` fuses three signals into one verdict: the model's own read
of the scene, the count of items it saw that the detector never proposed, and `peakOverlap`, the
largest fraction of any one box covered by another. Only the third is pure geometry, so only the
third can be scored against boxes alone. That is what this does, and the port below is a direct
transcription of the TypeScript so the two cannot drift silently.

RPC's clutter tiers are the labels. Easy scenes hold three to five items with minimal occlusion,
hard scenes hold eleven or more with heavy stacking. A working signal separates them.

    python3 server/eval/score_occlusion.py
"""
import json
import pathlib
import statistics

HERE = pathlib.Path(__file__).parent
CORPUS = HERE / "corpus"

# src/engine/liveVision/config.ts. Above this the pipeline calls a scene occluded.
OCCLUSION_THRESHOLD = 0.55


def containment(a, b):
    """Fraction of `a` that `b` covers. Transcribed from occlusion.ts.

    Deliberately not IoU. Two items stacked front to back produce a small IoU because the union
    is large, and a large containment ratio. IoU here would report a clear view of a pile.
    """
    area_a = a["w"] * a["h"]
    if area_a <= 0:
        return 0.0
    x1 = max(a["x"], b["x"])
    y1 = max(a["y"], b["y"])
    x2 = min(a["x"] + a["w"], b["x"] + b["w"])
    y2 = min(a["y"] + a["h"], b["y"] + b["h"])
    if x2 <= x1 or y2 <= y1:
        return 0.0
    return ((x2 - x1) * (y2 - y1)) / area_a


def peak_overlap(boxes):
    """The largest fraction of any single box that another box covers."""
    peak = 0.0
    for i, a in enumerate(boxes):
        for j, b in enumerate(boxes):
            if i == j:
                continue
            peak = max(peak, containment(a, b))
    return peak


def main():
    truth = json.loads((CORPUS / "rpc-ground-truth.json").read_text())
    if not truth:
        raise SystemExit("no ground truth; run server/eval/corpus/fetch_rpc.py first")

    tiers = {}
    for key in sorted(truth):
        scene = truth[key]
        boxes = [item["box"] for item in scene["items"]]
        tiers.setdefault(scene["tier"], []).append(peak_overlap(boxes))

    header = f"{'tier':8}{'scenes':>8}{'median':>9}{'mean':>8}{'min':>7}{'max':>7}{'fires':>8}"
    print("peakOverlap on ground-truth boxes, by RPC clutter tier")
    print(f"threshold: {OCCLUSION_THRESHOLD}\n")
    print(header)
    print("-" * len(header))

    for tier in ("easy", "medium", "hard"):
        values = tiers.get(tier)
        if not values:
            continue
        fires = sum(1 for v in values if v >= OCCLUSION_THRESHOLD) / len(values)
        print(
            f"{tier:8}{len(values):>8}{statistics.median(values):>9.2f}"
            f"{statistics.mean(values):>8.2f}{min(values):>7.2f}{max(values):>7.2f}{fires:>7.0%}"
        )

    easy = tiers.get("easy", [])
    hard = tiers.get("hard", [])
    if easy and hard:
        print()
        false_alarm = sum(1 for v in easy if v >= OCCLUSION_THRESHOLD) / len(easy)
        caught = sum(1 for v in hard if v >= OCCLUSION_THRESHOLD) / len(hard)
        print(f"fires on a stacked scene:   {caught:.0%}   (want high)")
        print(f"fires on an open scene:     {false_alarm:.0%}   (want low)")
        print(
            "\nA shopper told to rearrange a cart that is already clearly visible stops "
            "trusting\nthe warning, so the false alarm rate matters as much as the catch rate."
        )


if __name__ == "__main__":
    main()
