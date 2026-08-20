"""
Detection on real store shelves: how many of the items that are there do we find?

Counting is one of the four capabilities in CLAUDE.md and it is decided here, not in the
matcher. An item the detector never proposes cannot be named, cannot be counted, and cannot be
flagged as unsure; it is simply absent from the shopper's bag with nothing to indicate it.

The threshold in `regions.py` was set on RPC, 465 instances of products laid out on a white
tray. This asks the same question of shelves holding a hundred items each.

One property of the corpus decides what may honestly be reported. Its annotation is partial:
many clearly visible products carry no box, because their brand is outside the vocabulary or
because the annotator stopped. So

  recall      is unbiased. Every labelled instance is really there, and either we found it or
              we did not.
  precision   is a lower bound and nothing more. A correct detection of an unlabelled product
              is counted here as a false positive, and there is no way to tell those apart from
              real ones without relabelling the photographs by hand.
  count error is not measurable at all, and is not reported. The true number of items in these
              photographs is unknown. Reporting recall as though it were counting accuracy
              would be the most misleading number this project could produce.

The detector, prompt, threshold and de-duplication are imported from `server/enumerator`, so a
change to the service changes this measurement.

    server/.venv/bin/python server/eval/score_grocer_detection.py --scenes 120
"""
import argparse
import json
import pathlib
import statistics
import sys
import time

HERE = pathlib.Path(__file__).parent
CACHE = HERE / ".cache" / "grocer"
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "enumerator"))

import regions  # noqa: E402
from grocer import corpus  # noqa: E402
from score_grocer_occlusion import hidden_fraction, in_front  # noqa: E402

MATCH_IOU = 0.5


def match(predicted, truth):
    """Greedy one-to-one matching by IoU, best score first. The usual convention.

    One-to-one matters more here than the choice of threshold: a detector that proposes four
    boxes over one yogurt should be credited with finding one yogurt, not four.
    """
    taken = set()
    hits = 0
    for box in predicted:
        best, best_iou = None, MATCH_IOU
        for i, target in enumerate(truth):
            if i in taken:
                continue
            score = regions._iou(box, target)
            if score >= best_iou:
                best, best_iou = i, score
        if best is not None:
            taken.add(best)
            hits += 1
    return hits, taken


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scenes", type=int, default=120)
    parser.add_argument("--threshold", type=float, default=regions.BOX_THRESHOLD)
    parser.add_argument("--max-side", type=int, default=1333,
                        help="longest edge the detector sees; these photographs are 12MP")
    parser.add_argument("--out", default=str(HERE / "grocer-detection.json"))
    args = parser.parse_args(argv)

    import torch
    from PIL import Image
    from transformers import AutoModelForZeroShotObjectDetection, AutoProcessor

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    print(f"loading grounding-dino-base on {device}")
    proc = AutoProcessor.from_pretrained("IDEA-Research/grounding-dino-base")
    dino = AutoModelForZeroShotObjectDetection.from_pretrained(
        "IDEA-Research/grounding-dino-base").to(device)

    # The query half of the split, so this never reports on photographs whose crops trained the
    # catalog head. Detection does not use the head, but a scene appearing in both would make
    # this number incomparable to the naming number beside it.
    pool = corpus.scenes()
    _, query_scenes = corpus.split(pool)
    chosen = query_scenes[: args.scenes]
    print(f"{len(chosen)} photographs, "
          f"{sum(len(s.crops) for s in chosen)} labelled instances")

    found = missed = proposed = raw_proposed = 0
    per_scene, occluded_found, occluded_total = [], 0, 0
    by_size = {"small": [0, 0], "medium": [0, 0], "large": [0, 0]}
    started = time.time()
    for n, scene in enumerate(chosen):
        with Image.open(scene.image) as handle:
            pil = handle.convert("RGB")
        width, height = pil.size
        shrunk = pil.copy()
        shrunk.thumbnail((args.max_side, args.max_side))

        inputs = proc(images=shrunk, text=regions.GROCERY_PROMPT, return_tensors="pt").to(device)
        with torch.no_grad():
            outputs = dino(**inputs)
        result = proc.post_process_grounded_object_detection(
            outputs, inputs.input_ids, threshold=args.threshold,
            text_threshold=args.threshold, target_sizes=[shrunk.size[::-1]],
        )[0]

        boxes = [[float(v) for v in row] for row in result["boxes"].cpu().numpy()]
        scores = [float(s) for s in result["scores"].cpu()]
        raw_proposed += len(boxes)
        if boxes:
            keep = regions.dedupe(boxes, scores)
            keep.sort(key=lambda i: -scores[i])
            keep = keep[: regions.MAX_INSTANCES]
            boxes = [boxes[i] for i in keep]

        # Both sides in the same coordinate space: the shrunk frame the detector saw.
        sw, sh = shrunk.size
        truth = [(c.x0 * sw, c.y0 * sh, c.x1 * sw, c.y1 * sh) for c in scene.crops]
        hits, taken = match(boxes, truth)

        found += hits
        missed += len(truth) - hits
        proposed += len(boxes)
        per_scene.append((len(truth), len(boxes), hits))

        normalized = [(c.x0, c.y0, c.x1, c.y1) for c in scene.crops]
        for i, crop in enumerate(scene.crops):
            subject = normalized[i]
            covered = hidden_fraction(
                subject, [b for j, b in enumerate(normalized) if j != i and in_front(subject, b)]
            )
            if covered >= 0.2:
                occluded_total += 1
                occluded_found += 1 if i in taken else 0
            side = min((crop.x1 - crop.x0) * width, (crop.y1 - crop.y0) * height)
            band = "small" if side < 80 else "medium" if side < 200 else "large"
            by_size[band][1] += 1
            by_size[band][0] += 1 if i in taken else 0
        if (n + 1) % 20 == 0:
            rate = (n + 1) / (time.time() - started)
            print(f"  {n + 1}/{len(chosen)} photographs, {rate:.2f}/s, "
                  f"recall so far {found / max(found + missed, 1):.1%}")

    recall = found / max(found + missed, 1)
    precision_floor = found / max(proposed, 1)
    print(f"\n  threshold             {args.threshold}")
    print(f"  labelled instances    {found + missed}")
    print(f"  recall                {recall:.1%}   (unbiased)")
    print(f"  precision             {precision_floor:.1%}   (a floor: unlabelled products "
          f"found correctly count against it)")
    print(f"  proposals per scene   {raw_proposed / len(chosen):.1f} raw, "
          f"{statistics.mean(b for _, b, _ in per_scene):.1f} after de-duplication and the "
          f"{regions.MAX_INSTANCES}-instance cap, against "
          f"{statistics.mean(t for t, _, _ in per_scene):.1f} labelled")
    print("\n  recall by instance size (shorter edge in the original photograph)")
    for band, (hit, total) in by_size.items():
        if total:
            print(f"    {band:7s} n={total:5d}   {hit / total:.1%}")
    if occluded_total:
        clear_found = found - occluded_found
        clear_total = (found + missed) - occluded_total
        print(f"\n  recall on items at or above the covered threshold  "
              f"{occluded_found / occluded_total:.1%}  (n={occluded_total})")
        print(f"  recall on the rest                                 "
              f"{clear_found / max(clear_total, 1):.1%}  (n={clear_total})")

    summary = {
        "threshold": args.threshold,
        "scenes": len(chosen),
        "labelled_instances": found + missed,
        "recall": recall,
        "precision_floor": precision_floor,
        "proposals": proposed,
        "raw_proposals": raw_proposed,
        "max_side": args.max_side,
        "recall_by_size": {k: (v[0] / v[1] if v[1] else None) for k, v in by_size.items()},
        "recall_covered": occluded_found / occluded_total if occluded_total else None,
        "covered_instances": occluded_total,
        "seconds": round(time.time() - started, 1),
        "note": "precision is a lower bound; the corpus is partially annotated. Count error is "
                "not measurable on this corpus and is deliberately absent.",
    }
    out = pathlib.Path(args.out)
    existing = json.loads(out.read_text() or "{}") if out.exists() else {}
    # Keyed by both, because resolution turned out to matter more than the threshold and a
    # results file keyed on the threshold alone would have overwritten the evidence for it.
    existing[f"threshold={args.threshold} max_side={args.max_side}"] = summary
    out.write_text(json.dumps(existing, indent=1))
    print(f"\nwrote {out}")
    return summary


if __name__ == "__main__":
    main()
