"""
Scores the enumerator's boxes against real per-instance ground truth.

Until this existed, detector quality was measured by counting proposals and comparing the
total to a hand-placed point count. That cannot tell a tight box from a box covering half an
item and part of its neighbour, which is exactly the failure that reached the shopper as a
milk carton named as a bag of greens.

Three numbers, reported per clutter tier because the tiers are the closest thing available to
an occlusion axis:

  recall      fraction of real items with a predicted box at IoU >= 0.5. Items missed.
  precision   fraction of predicted boxes matching a real item. Phantom items.
  count error mean absolute difference between how many items were proposed and how many are
              really there, which is the number a shopper actually feels

Matching is greedy by IoU, highest first, one prediction to one truth. That is the standard
convention and it deliberately gives no credit for a second box on an item already matched,
because a second box on one item is the duplicate bug, not a success.

    python3 server/eval/score_detection.py
"""
import json
import pathlib
import sys
import time

HERE = pathlib.Path(__file__).parent
CORPUS = HERE / "corpus"
IOU_MATCH = 0.5

sys.path.insert(0, str(HERE.parent / "enumerator"))


def iou(a, b):
    overlap = max(0.0, min(a["x"] + a["w"], b["x"] + b["w"]) - max(a["x"], b["x"])) * max(
        0.0, min(a["y"] + a["h"], b["y"] + b["h"]) - max(a["y"], b["y"])
    )
    union = a["w"] * a["h"] + b["w"] * b["h"] - overlap
    return 0.0 if union <= 0 else overlap / union


def match(predicted, truth):
    """Greedy one-to-one assignment by IoU. Returns how many truths were matched."""
    pairs = sorted(
        (
            (iou(p, t), pi, ti)
            for pi, p in enumerate(predicted)
            for ti, t in enumerate(truth)
        ),
        reverse=True,
    )
    used_p, used_t = set(), set()
    for score, pi, ti in pairs:
        if score < IOU_MATCH:
            break
        if pi in used_p or ti in used_t:
            continue
        used_p.add(pi)
        used_t.add(ti)
    return len(used_t)


def main():
    truth = json.loads((CORPUS / "rpc-ground-truth.json").read_text())
    if not truth:
        sys.exit("no ground truth; run server/eval/corpus/fetch_rpc.py first")

    import torch
    from PIL import Image
    from transformers import AutoModelForZeroShotObjectDetection, AutoProcessor

    import app  # the shipped enumerator, so this scores what deploys

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    processor = AutoProcessor.from_pretrained("IDEA-Research/grounding-dino-base")
    model = AutoModelForZeroShotObjectDetection.from_pretrained(
        "IDEA-Research/grounding-dino-base"
    ).to(device)
    print(f"device: {device}\nprompt: {app.GROCERY_PROMPT}\n")

    tiers = {}
    for key in sorted(truth):
        scene = truth[key]
        image = Image.open(CORPUS / "images" / f"{key}.jpg").convert("RGB")

        started = time.perf_counter()
        inputs = processor(images=image, text=app.GROCERY_PROMPT, return_tensors="pt").to(device)
        with torch.no_grad():
            outputs = model(**inputs)
        raw = processor.post_process_grounded_object_detection(
            outputs,
            inputs.input_ids,
            threshold=app.BOX_THRESHOLD,
            text_threshold=app.BOX_THRESHOLD,
            target_sizes=[image.size[::-1]],
        )[0]
        elapsed = (time.perf_counter() - started) * 1000

        xyxy = raw["boxes"].tolist()
        scores = raw["scores"].tolist()
        keep = app.dedupe(xyxy, scores)
        keep.sort(key=lambda i: -scores[i])
        keep = keep[: app.MAX_INSTANCES]

        width, height = image.size
        predicted = [
            {
                "x": xyxy[i][0] / width,
                "y": xyxy[i][1] / height,
                "w": (xyxy[i][2] - xyxy[i][0]) / width,
                "h": (xyxy[i][3] - xyxy[i][1]) / height,
            }
            for i in keep
        ]

        actual = [item["box"] for item in scene["items"]]
        matched = match(predicted, actual)

        bucket = tiers.setdefault(
            scene["tier"], {"scenes": 0, "truth": 0, "pred": 0, "hit": 0, "err": 0, "ms": []}
        )
        bucket["scenes"] += 1
        bucket["truth"] += len(actual)
        bucket["pred"] += len(predicted)
        bucket["hit"] += matched
        bucket["err"] += abs(len(predicted) - len(actual))
        bucket["ms"].append(elapsed)

    header = f"{'tier':8}{'scenes':>7}{'items':>7}{'found':>7}{'recall':>8}{'precision':>11}{'count err':>11}{'ms':>7}"
    print(header)
    print("-" * len(header))
    overall = {"truth": 0, "pred": 0, "hit": 0, "err": 0, "scenes": 0}
    for tier in ("easy", "medium", "hard"):
        b = tiers.get(tier)
        if not b:
            continue
        recall = b["hit"] / b["truth"] if b["truth"] else 0
        precision = b["hit"] / b["pred"] if b["pred"] else 0
        print(
            f"{tier:8}{b['scenes']:>7}{b['truth']:>7}{b['hit']:>7}{recall:>7.0%}"
            f"{precision:>11.0%}{b['err'] / b['scenes']:>11.2f}"
            f"{round(sorted(b['ms'])[len(b['ms']) // 2]):>7}"
        )
        for k in overall:
            overall[k] += b[k]

    print("-" * len(header))
    print(
        f"{'ALL':8}{overall['scenes']:>7}{overall['truth']:>7}{overall['hit']:>7}"
        f"{overall['hit'] / overall['truth']:>7.0%}"
        f"{overall['hit'] / overall['pred']:>11.0%}"
        f"{overall['err'] / overall['scenes']:>11.2f}"
    )

    (HERE / "detection-score.json").write_text(json.dumps(tiers, indent=1, default=str))


if __name__ == "__main__":
    main()
