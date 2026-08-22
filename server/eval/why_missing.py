"""Where the two products the census never reports die.

IMG_0252 holds ten products and the detector proposes eight. The two it does not are the yellow
produce bag and the tomatoes on the vine, and the census never lists either as unmarked in any
run at any effort or resolution. That leaves detection, so this walks a frame through the shipped
passes and prints what each one proposed and what the next one dropped, rather than only the
eight that survive.

    ../.venv/bin/python why_missing.py --frame IMG_0252
"""
import argparse
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
CACHE = HERE / ".cache" / "kart"
sys.path.insert(0, str(HERE.parent))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--frame", default="IMG_0252")
    parser.add_argument("--out", default=None)
    args = parser.parse_args(argv)

    import torch
    from PIL import Image, ImageOps
    from transformers import AutoProcessor, AutoModelForZeroShotObjectDetection

    from enumerator import regions

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    proc = AutoProcessor.from_pretrained("IDEA-Research/grounding-dino-base")
    dino = AutoModelForZeroShotObjectDetection.from_pretrained(
        "IDEA-Research/grounding-dino-base").to(device)

    pil = ImageOps.exif_transpose(
        Image.open(CACHE / "images" / f"{args.frame}.jpg")).convert("RGB")
    pil.thumbnail((1333, 1333))
    W, H = pil.size
    print(f"{args.frame} at {W} by {H}")

    def ground(text, cut):
        inputs = proc(images=pil, text=text, return_tensors="pt").to(device)
        with torch.no_grad():
            out = dino(**inputs)
        found = proc.post_process_grounded_object_detection(
            out, inputs.input_ids, threshold=cut, text_threshold=cut,
            target_sizes=[pil.size[::-1]])[0]
        boxes = [[float(v) for v in row] for row in found["boxes"].cpu().numpy()]
        scores = [float(s) for s in found["scores"].cpu()]
        labels = [str(t) for t in found.get("text_labels", found.get("labels", []))]
        return boxes, scores, labels

    boxes, scores, labels = ground(regions.GROCERY_PROMPT, regions.BOX_THRESHOLD)
    print(f"\ngrocery pass proposed {len(boxes)} boxes at threshold {regions.BOX_THRESHOLD}")

    kept = regions.dedupe(boxes, scores, size=pil.size)
    print(f"  dedupe and deframe kept {len(kept)}")
    dropped = [i for i in range(len(boxes)) if i not in set(kept)]
    for i in dropped:
        print(f"    dropped: {labels[i] if i < len(labels) else '?'} "
              f"score {scores[i]:.2f} at {[round(v) for v in boxes[i]]}")

    base = [boxes[i] for i in kept]
    base_scores = [scores[i] for i in kept]

    pboxes, pscores, plabels = ground(regions.PRODUCE_PROMPT, regions.PRODUCE_THRESHOLD)
    print(f"\nproduce pass proposed {len(pboxes)} boxes at threshold {regions.PRODUCE_THRESHOLD}")
    merged = regions.merge_produce(base, pboxes, pscores)
    print(f"  merge_produce accepted {len(merged)}")
    accepted = set(merged)
    for i, box in enumerate(pboxes):
        name = plabels[i] if i < len(plabels) else "?"
        best_iou = max((regions._iou(box, o) for o in base), default=0.0)
        best_inside = max((regions._inside_of(box, o) for o in base), default=0.0)
        verdict = "kept" if i in accepted else (
            "dropped: overlaps an existing box" if best_iou >= regions.PRODUCE_OVERLAP else
            "dropped: sits inside an existing box" if best_inside >= regions.PRODUCE_INSIDE else
            "dropped: duplicate of another produce box")
        print(f"    {name:<22} score {pscores[i]:.2f}  iou {best_iou:.2f}  inside {best_inside:.2f}  {verdict}")

    final = base + [pboxes[i] for i in merged]
    print(f"\nfinal: {len(final)} regions")

    if args.out:
        pathlib.Path(args.out).write_text(json.dumps({
            "frame": args.frame, "size": [W, H],
            "grocery": [{"box": b, "score": s, "label": l} for b, s, l in zip(boxes, scores, labels)],
            "kept": kept,
            "produce": [{"box": b, "score": s, "label": l} for b, s, l in zip(pboxes, pscores, plabels)],
            "merged": merged,
        }, indent=1))
        print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
