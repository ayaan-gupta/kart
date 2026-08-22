"""Run any proposal model over the six trolleys and write a frames file the harnesses can consume.

`compare_detectors.py` scores a detector against the two hand-labelled photographs. This produces
the region set for all six, so `census_local.py` and `local-census-bag.ts` can put the same
detector through the bag end to end — which is the question a box-level win does not answer, since
every extra proposal is a badge and every badge can become a line.

    KART_DETECTOR=openmmlab-community/mm_grounding_dino_base_all \
      server/.venv/bin/python server/eval/detect_carts.py --threshold 0.15 --out frames-mm.json
"""
import argparse, json, os, pathlib, sys

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))
CARTS = ["IMG_0244", "IMG_0245", "IMG_0246", "IMG_0249", "IMG_0252", "IMG_0254"]


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--threshold", type=float, default=None)
    ap.add_argument("--long-edge", type=int, default=2000)
    ap.add_argument("--out", default="frames-alt.json")
    args = ap.parse_args(argv)

    from PIL import Image, ImageOps
    import score_kart, regions
    threshold = regions.BOX_THRESHOLD if args.threshold is None else args.threshold
    ground, device = score_kart.detector()
    model = os.environ.get("KART_DETECTOR", "IDEA-Research/grounding-dino-base")
    print(f"{model} at {threshold} on {device}")

    frames = []
    for pid in CARTS:
        pil = ImageOps.exif_transpose(
            Image.open(HERE / f".cache/kart/images/{pid}.jpg")).convert("RGB")
        pil.thumbnail((args.long_edge, args.long_edge))
        W, H = pil.size
        boxes, scores = ground(pil, regions.GROCERY_PROMPT, threshold)
        keep = regions.dedupe(boxes, scores, size=pil.size) if boxes else []
        keep = sorted(keep, key=lambda k: -scores[k])[: regions.MAX_INSTANCES]
        frames.append({
            "id": pid, "width": W, "height": H,
            "boxes": [{"x": boxes[k][0] / W, "y": boxes[k][1] / H,
                       "w": (boxes[k][2] - boxes[k][0]) / W,
                       "h": (boxes[k][3] - boxes[k][1]) / H} for k in keep],
            "scores": [float(scores[k]) for k in keep],
        })
        print(f"  {pid}: {len(keep)} proposals")
    out = HERE / ".cache/kart" / args.out
    out.write_text(json.dumps({"detector": model, "threshold": threshold, "frames": frames}))
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
