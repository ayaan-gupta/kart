"""
Sweeps the enumerator's post-processing against real per-instance boxes.

Detection is now the binding constraint. Naming reaches 88% of the items it is handed, but the
detector hands it 79% of what is there, so roughly seven items in ten survive the whole pipeline
and the larger loss is the earlier one.

Every threshold in server/enumerator/app.py was chosen by looking at overlays on five cart
photographs. That was the only evidence available at the time and it is not evidence of much:
five photographs, no per-instance boxes, and a judgement made by eye. This scores the same
knobs against 465 labelled instances.

The model runs once per scene at a threshold below every candidate, and its raw output is
cached. Everything swept afterwards is arithmetic on those boxes, so a hundred configurations
cost one pass rather than a hundred.

What it must not do is quietly overfit to a tray. RPC lays products on a white surface, and the
prompt in app.py was tuned to stop whole-trolley proposals, a failure this corpus cannot show.
So the prompt is held fixed here and only the geometry is swept.

    python3 server/eval/sweep_detection.py
"""
import argparse
import itertools
import json
import pathlib
import sys

import numpy as np

HERE = pathlib.Path(__file__).parent
CORPUS = HERE / "corpus"
CACHE = HERE / ".cache"
sys.path.insert(0, str(HERE.parent / "enumerator"))

IOU_MATCH = 0.5
# Below every threshold swept, so one pass serves all of them.
FLOOR = 0.05


def iou(a, b):
    overlap = max(0.0, min(a[2], b[2]) - max(a[0], b[0])) * max(
        0.0, min(a[3], b[3]) - max(a[1], b[1])
    )
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - overlap
    return 0.0 if union <= 0 else overlap / union


def matched(predicted, truth):
    """Greedy one-to-one by IoU, highest first. A second box on a matched item earns nothing,
    because a second box on one item is the duplicate bug rather than a success."""
    pairs = sorted(
        ((iou(p, t), pi, ti) for pi, p in enumerate(predicted) for ti, t in enumerate(truth)),
        reverse=True,
    )
    used_p, used_t = set(), set()
    for score, pi, ti in pairs:
        if score < IOU_MATCH:
            break
        if pi not in used_p and ti not in used_t:
            used_p.add(pi)
            used_t.add(ti)
    return len(used_t)


def dedupe(boxes, scores, nms_iou, containment, max_ratio, size=None):
    """The service's own de-duplication, with its constants lifted into arguments.

    This used to be a copy of the function rather than a call to it, and the copy carried the
    same inverted size guard the original had. A sweep that reimplements the thing it is tuning
    cannot find a bug in it: both agreed, so both looked right, and the threshold that came out
    of this file was chosen against behaviour nobody intended.
    """
    import regions

    return regions.dedupe(boxes, scores, nms_iou, containment, max_ratio, size)


def collect(truth, tile):
    """Raw boxes per scene, cached to disk. The expensive half, run once."""
    name = f"detection-raw{'-tiled' if tile else ''}.json"
    path = CACHE / name
    if path.exists():
        return json.loads(path.read_text())

    import torch
    from PIL import Image
    from transformers import AutoModelForZeroShotObjectDetection, AutoProcessor

    import regions  # noqa: F401

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    processor = AutoProcessor.from_pretrained("IDEA-Research/grounding-dino-base")
    model = AutoModelForZeroShotObjectDetection.from_pretrained(
        "IDEA-Research/grounding-dino-base"
    ).to(device)
    print(f"device: {device}   tiled: {tile}\nprompt: {regions.GROCERY_PROMPT}\n")

    def run(image):
        inputs = processor(
            images=image, text=regions.GROCERY_PROMPT, return_tensors="pt"
        ).to(device)
        with torch.no_grad():
            outputs = model(**inputs)
        raw = processor.post_process_grounded_object_detection(
            outputs, inputs.input_ids, threshold=FLOOR, text_threshold=FLOOR,
            target_sizes=[image.size[::-1]],
        )[0]
        return raw["boxes"].tolist(), raw["scores"].tolist()

    out = {}
    for n, key in enumerate(sorted(truth)):
        image = Image.open(CORPUS / "images" / f"{key}.jpg").convert("RGB")
        width, height = image.size
        boxes, scores = run(image)
        if tile:
            # Half-overlapping quarters. A small item is a larger fraction of a tile than of the
            # frame, and the detector's own resizing is what makes small items hard, so this is
            # the cheapest way to ask it the same question at a scale where they are big.
            for ox, oy in itertools.product((0, 0.25, 0.5), repeat=2):
                left, top = int(ox * width), int(oy * height)
                right, bottom = left + width // 2, top + height // 2
                piece = image.crop((left, top, right, bottom))
                more, more_scores = run(piece)
                boxes += [[b[0] + left, b[1] + top, b[2] + left, b[3] + top] for b in more]
                scores += more_scores
        out[key] = {"boxes": boxes, "scores": scores, "width": width, "height": height}
        if n % 10 == 0:
            print(f"    {n}/{len(truth)}", flush=True)
    CACHE.mkdir(exist_ok=True)
    path.write_text(json.dumps(out))
    return out


def evaluate(raw, truth, threshold, nms_iou, containment, max_ratio, max_instances,
             relative=None):
    """`relative` keeps boxes scoring above that fraction of the scene's own best proposal.

    An absolute cut is the thing most likely not to survive the move from this corpus to a
    cart. The optimum here is sharp, 0.05 too low costs six points of recall and 0.05 too high
    costs eighteen, and a detector's raw scores are a property of how confidently it matched the
    prompt, which is exactly what changes when the background stops being a white tray. A cut
    expressed as a fraction of the best box in the same photograph moves with the scene instead
    of assuming it.
    """
    got = hit = pred = err = 0
    for key in sorted(truth):
        scene = raw[key]
        cut = threshold
        if relative is not None and scene["scores"]:
            cut = max(threshold, relative * max(scene["scores"]))
        keep_raw = [i for i, s in enumerate(scene["scores"]) if s >= cut]
        boxes = [scene["boxes"][i] for i in keep_raw]
        scores = [scene["scores"][i] for i in keep_raw]
        keep = dedupe(boxes, scores, nms_iou, containment, max_ratio,
                      (scene["width"], scene["height"]))
        keep.sort(key=lambda i: -scores[i])
        keep = keep[:max_instances]
        predicted = [boxes[i] for i in keep]
        actual = [
            [
                t["box"]["x"] * scene["width"], t["box"]["y"] * scene["height"],
                (t["box"]["x"] + t["box"]["w"]) * scene["width"],
                (t["box"]["y"] + t["box"]["h"]) * scene["height"],
            ]
            for t in truth[key]["items"]
        ]
        got += len(actual)
        pred += len(predicted)
        hit += matched(predicted, actual)
        err += abs(len(predicted) - len(actual))
    recall, precision = hit / got, hit / max(pred, 1)
    return {
        "recall": recall, "precision": precision,
        "f1": 0.0 if recall + precision == 0 else 2 * recall * precision / (recall + precision),
        "count_error": err / len(truth),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--tile", action="store_true", help="also run half-overlapping quarters")
    args = parser.parse_args()

    truth = json.loads((CORPUS / "rpc-ground-truth.json").read_text())
    if not truth:
        sys.exit("no ground truth; run server/eval/corpus/fetch_rpc.py first")

    # `regions`, not `app`: app.py builds a modal.Volume at import and cannot be loaded
    # without credentials, which is why this file used to hold its own copy of the logic.
    import regions

    raw = collect(truth, args.tile)
    shipped = evaluate(raw, truth, regions.BOX_THRESHOLD, regions.NMS_IOU,
                       regions.NESTED_CONTAINMENT, regions.NESTED_MAX_RATIO,
                       regions.MAX_INSTANCES)
    print(f"shipped: recall {shipped['recall']:.1%}  precision {shipped['precision']:.1%}  "
          f"F1 {shipped['f1']:.3f}  count error {shipped['count_error']:.2f}\n")

    grid = list(itertools.product(
        (0.10, 0.15, 0.20, 0.25, 0.30, 0.35),
        (0.4, 0.5, 0.6, 0.7),
        (0.75, 0.80, 0.85, 0.90),
        (2.0, 4.0, 8.0),
    ))
    results = []
    for threshold, nms_iou, containment, max_ratio in grid:
        scored = evaluate(raw, truth, threshold, nms_iou, containment, max_ratio,
                          regions.MAX_INSTANCES)
        results.append({"threshold": threshold, "nms": nms_iou, "containment": containment,
                        "ratio": max_ratio, **scored})
    print(f"{len(results)} configurations\n")

    header = (f"{'thr':>6}{'nms':>6}{'cont':>6}{'ratio':>7}{'recall':>9}"
              f"{'precision':>11}{'F1':>7}{'count err':>11}")
    for label, key in (("best F1", "f1"), ("best recall", "recall")):
        print(f"{label}:")
        print(header)
        print("-" * len(header))
        for row in sorted(results, key=lambda r: -r[key])[:5]:
            print(f"{row['threshold']:>6.2f}{row['nms']:>6.1f}{row['containment']:>6.2f}"
                  f"{row['ratio']:>7.1f}{row['recall']:>9.1%}{row['precision']:>11.1%}"
                  f"{row['f1']:>7.3f}{row['count_error']:>11.2f}")
        print()

    # A cut expressed as a fraction of the best box in the same photograph, with a low absolute
    # floor underneath it so a scene of nothing but noise cannot promote its own noise.
    relative_results = []
    for floor, fraction, nms_iou in itertools.product(
        (0.05, 0.10, 0.15), (0.35, 0.45, 0.55, 0.65, 0.75), (0.5,)
    ):
        scored = evaluate(raw, truth, floor, nms_iou, regions.NESTED_CONTAINMENT,
                          regions.NESTED_MAX_RATIO, regions.MAX_INSTANCES, relative=fraction)
        relative_results.append({"floor": floor, "fraction": fraction, **scored})

    print("relative cut, as a fraction of the best box in the same photograph:")
    header = (f"{'floor':>7}{'fraction':>10}{'recall':>9}{'precision':>11}{'F1':>7}"
              f"{'count err':>11}")
    print(header)
    print("-" * len(header))
    for row in sorted(relative_results, key=lambda r: -r["f1"])[:6]:
        print(f"{row['floor']:>7.2f}{row['fraction']:>10.2f}{row['recall']:>9.1%}"
              f"{row['precision']:>11.1%}{row['f1']:>7.3f}{row['count_error']:>11.2f}")

    (HERE / f"detection-sweep{'-tiled' if args.tile else ''}.json").write_text(
        json.dumps({"shipped": shipped, "grid": results, "relative": relative_results}, indent=1)
    )


if __name__ == "__main__":
    main()
