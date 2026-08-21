"""What the product actually does to a photograph, end to end, measured on labelled shelves.

Every other harness here measures one half of the pipeline against a perfect version of the
other. `score_grocer_detection.py` asks how many labelled items the detector finds and never
names them. `score_grocer.py` asks how well the matcher names a crop and is handed the
annotator's own box to name. Both numbers can be good while the product is bad, because the
matcher in the product is never handed an annotator's box: it is handed whatever the detector
drew, which is looser, off-centre, sometimes half a neighbour.

This runs the two together on the same photographs and reports the number the goal is written
in: of the items in front of the camera, how many does the app both find and name correctly.

It also names each matched instance a second time from the annotator's box. That pairing is the
point of the run. Two configurations that differ only in how tight the boxes are produce the
same naming number on annotator crops and different ones here, and the gap between the two
columns is the cost of the detector's boxes in points of naming accuracy - which is a number
that tells you whether to work on the detector or the matcher next, and which neither harness
alone can produce.

Both sides use the shipped code: `regions.dedupe` for the proposals, `matcher.crop_region` for
the padded crop, `Matcher.match` for the name. Nothing here reimplements a step.

    ../.venv/bin/python score_grocer_endtoend.py --scenes 120 --tag ens
"""

import argparse
import json
import pathlib
import sys
import time

HERE = pathlib.Path(__file__).resolve().parent
CACHE = HERE / ".cache" / "grocer"
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE.parent / "enumerator"))

import regions  # noqa: E402
from grocer import corpus  # noqa: E402
from catalog.matcher import Index, Matcher, crop_region  # noqa: E402
from score_grocer import build_or_load  # noqa: E402

MATCH_IOU = 0.5


def pairs(predicted, truth, threshold=MATCH_IOU):
    """Optimal one-to-one assignment, as a list of (predicted index, truth index, iou).

    The same matching `score_grocer_detection.py` uses, returning the pairing itself rather than
    only its size, because here each pair is a crop to name.
    """
    if not predicted or not truth:
        return []
    import numpy as np
    from scipy.optimize import linear_sum_assignment

    iou = np.zeros((len(predicted), len(truth)))
    for i, box in enumerate(predicted):
        for j, target in enumerate(truth):
            iou[i, j] = regions._iou(box, target)
    rows, cols = linear_sum_assignment(-iou)
    return [
        (int(i), int(j), float(iou[i, j]))
        for i, j in zip(rows, cols)
        if iou[i, j] >= threshold
    ]


def normalize(box, size):
    """A pixel box as the {x, y, w, h} normalized dict every coordinate in the app uses."""
    width, height = size
    x0, y0, x1, y1 = box
    return {
        "x": x0 / width,
        "y": y0 / height,
        "w": (x1 - x0) / width,
        "h": (y1 - y0) / height,
    }


def report(rows, scenes_seen, truth_total, proposed_total, log=print):
    """The composition, and the paired gap between detector boxes and annotator boxes."""
    answerable = [r for r in rows if r["answerable"]]

    detected = sum(1 for r in rows if r["found"])
    answerable_truth = sum(1 for r in rows if r["answerable"])
    found_answerable = [r for r in answerable if r["found"]]
    m = max(len(found_answerable), 1)

    detector_right = sum(1 for r in found_answerable if r["sku"] == r["truth"])
    truthbox_right = sum(1 for r in found_answerable if r["sku_truthbox"] == r["truth"])
    detector_declined = sum(1 for r in found_answerable if r["sku"] is None)
    truthbox_declined = sum(1 for r in found_answerable if r["sku_truthbox"] is None)
    detector_wrong = sum(
        1 for r in found_answerable if r["sku"] is not None and r["sku"] != r["truth"]
    )

    summary = {
        "scenes": scenes_seen,
        "labelled_instances": truth_total,
        "answerable_instances": answerable_truth,
        "proposals": proposed_total,
        "detection_recall": detected / max(len(rows), 1),
        "named_of_found": detector_right / m,
        "named_of_found_truthbox": truthbox_right / m,
        "end_to_end": detector_right / max(answerable_truth, 1),
        "declined_of_found": detector_declined / m,
        "declined_of_found_truthbox": truthbox_declined / m,
        "wrong_of_found": detector_wrong / m,
    }

    log("")
    log(f"  photographs             {scenes_seen}")
    log(f"  labelled instances      {truth_total}")
    log(f"  of those, in catalog    {answerable_truth}  "
        f"({answerable_truth / max(truth_total, 1):.1%})")
    log(f"  proposals kept          {proposed_total}")
    log("")
    log("  the composition, on the instances the catalog can answer")
    log(f"    found by the detector   {len(found_answerable)}/{answerable_truth}  "
        f"{len(found_answerable) / max(answerable_truth, 1):.1%}")
    log(f"    and named correctly     {detector_right}/{answerable_truth}  "
        f"{detector_right / max(answerable_truth, 1):.1%}   <- end to end")
    log("")
    log("  naming the same instances twice, from two different boxes")
    log(f"    {'':22} {'detector box':>14} {'annotator box':>15}")
    log(f"    {'named correctly':22} {detector_right / m:>13.1%} "
        f"{truthbox_right / m:>15.1%}")
    log(f"    {'declined':22} {detector_declined / m:>13.1%} "
        f"{truthbox_declined / m:>15.1%}")
    log(f"    {'named, but wrong':22} {detector_wrong / m:>13.1%} "
        f"{(m - truthbox_right - truthbox_declined) / m:>15.1%}")
    log("")
    cost = truthbox_right / m - detector_right / m
    log(f"  cost of the detector's boxes  {cost * 100:+.1f} points of naming accuracy")

    by_iou = {}
    for r in found_answerable:
        band = "0.5-0.7" if r["iou"] < 0.7 else "0.7-0.85" if r["iou"] < 0.85 else "0.85+"
        slot = by_iou.setdefault(band, [0, 0])
        slot[1] += 1
        slot[0] += 1 if r["sku"] == r["truth"] else 0
    if by_iou:
        log("")
        log("  naming accuracy by how tight the detector's box was")
        for band in ("0.5-0.7", "0.7-0.85", "0.85+"):
            if band in by_iou:
                right, seen = by_iou[band]
                log(f"    iou {band:9} n={seen:5}  {right / max(seen, 1):.1%}")
    summary["by_iou"] = {k: {"n": v[1], "correct": v[0]} for k, v in by_iou.items()}
    return summary


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scenes", type=int, default=120)
    parser.add_argument("--encoders", default="siglipb16,siglip2l16")
    parser.add_argument("--finetune-epochs", type=int, default=0)
    parser.add_argument("--index", default=None,
                        help="index cache to load or build, default derived from --tag")
    parser.add_argument("--tag", default="ens")
    parser.add_argument("--threshold", type=float, default=regions.BOX_THRESHOLD)
    parser.add_argument("--max-side", type=int, default=1333)
    parser.add_argument("--match-iou", type=float, default=MATCH_IOU)
    parser.add_argument("--out", default=str(HERE / "grocer-endtoend.json"))
    args = parser.parse_args(argv)

    import torch
    from PIL import Image
    from transformers import AutoModelForZeroShotObjectDetection, AutoProcessor

    names = corpus.load_names()
    index_path = pathlib.Path(args.index) if args.index else CACHE / f"index-{args.tag}-notta.npz"
    index = build_or_load(index_path, args.encoders.split(","), args.finetune_epochs)
    matcher = Matcher(index, tta=1)
    known = set(index.skus)

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    print(f"loading grounding-dino-base on {device}")
    proc = AutoProcessor.from_pretrained("IDEA-Research/grounding-dino-base")
    dino = AutoModelForZeroShotObjectDetection.from_pretrained(
        "IDEA-Research/grounding-dino-base").to(device)

    # The query half, the same side both other harnesses report on, so the three numbers sit in
    # the same table without a footnote.
    pool = corpus.scenes()
    _, query_scenes = corpus.split(pool)
    chosen = query_scenes[: args.scenes]
    print(f"{len(chosen)} photographs, {sum(len(s.crops) for s in chosen)} labelled instances")

    rows, proposed_total, truth_total = [], 0, 0
    started = time.time()
    for n, scene in enumerate(chosen):
        with Image.open(scene.image) as handle:
            pil = handle.convert("RGB")
        shrunk = pil.copy()
        shrunk.thumbnail((args.max_side, args.max_side))

        inputs = proc(
            images=shrunk, text=regions.GROCERY_PROMPT, return_tensors="pt"
        ).to(device)
        with torch.no_grad():
            outputs = dino(**inputs)
        found = proc.post_process_grounded_object_detection(
            outputs, inputs.input_ids, threshold=args.threshold,
            text_threshold=args.threshold, target_sizes=[shrunk.size[::-1]],
        )[0]
        boxes = [[float(v) for v in row] for row in found["boxes"].cpu().numpy()]
        scores = [float(s) for s in found["scores"].cpu()]

        if boxes:
            keep = regions.dedupe(boxes, scores)
            keep.sort(key=lambda i: -scores[i])
            keep = keep[: regions.MAX_INSTANCES]
            boxes = [boxes[i] for i in keep]

        sw, sh = shrunk.size
        truth = [(c.x0 * sw, c.y0 * sh, c.x1 * sw, c.y1 * sh) for c in scene.crops]
        found_pairs = {j: (i, iou) for i, j, iou in pairs(boxes, truth, args.match_iou)}

        proposed_total += len(boxes)
        truth_total += len(truth)

        # One naming call per photograph, both boxes of every matched pair in the same batch.
        batch, slots = [], []
        for j, crop in enumerate(scene.crops):
            if j not in found_pairs:
                continue
            i, _ = found_pairs[j]
            detected = crop_region(shrunk, normalize(boxes[i], shrunk.size))
            annotated = crop_region(shrunk, normalize(truth[j], shrunk.size))
            if detected is None or annotated is None:
                continue
            slots.append(j)
            batch.append(detected)
            batch.append(annotated)

        results = matcher.match(batch, detail=True) if batch else []
        named = {}
        for k, j in enumerate(slots):
            named[j] = (results[2 * k], results[2 * k + 1])

        for j, crop in enumerate(scene.crops):
            truth_name = corpus.canonical(names[crop.cls])
            detected_result, annotated_result = named.get(j, (None, None))
            rows.append({
                "scene": scene.digest,
                "truth": truth_name,
                "answerable": truth_name in known,
                "found": j in found_pairs,
                "iou": found_pairs[j][1] if j in found_pairs else 0.0,
                "sku": detected_result["sku"] if detected_result else None,
                "confidence": (
                    float(detected_result["confidence"]) if detected_result else 0.0
                ),
                "alternatives": (
                    [a["sku"] for a in detected_result["alternatives"]]
                    if detected_result else []
                ),
                "sku_truthbox": annotated_result["sku"] if annotated_result else None,
                "named": j in named,
            })

        if (n + 1) % 10 == 0:
            rate = (n + 1) / (time.time() - started)
            done = [r for r in rows if r["answerable"]]
            right = sum(1 for r in done if r["sku"] == r["truth"])
            print(f"  {n + 1}/{len(chosen)} photographs, {rate:.2f}/s, "
                  f"end to end so far {right / max(len(done), 1):.1%}")

    summary = report(rows, len(chosen), truth_total, proposed_total)
    summary["prompt"] = regions.GROCERY_PROMPT
    summary["encoders"] = args.encoders
    summary["match_iou"] = args.match_iou

    out = pathlib.Path(args.out)
    existing = json.loads(out.read_text() or "{}") if out.exists() else {}
    existing[args.tag] = summary
    out.write_text(json.dumps(existing, indent=1))
    (CACHE / f"endtoend-{args.tag}.json").write_text(json.dumps(rows))
    print(f"\nwrote {out}")
    print(f"wrote {CACHE / f'endtoend-{args.tag}.json'}  ({len(rows)} instances)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
