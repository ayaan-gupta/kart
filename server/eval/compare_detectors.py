"""Score a proposal model against the hand-labelled boxes, so detectors can be compared directly.

The seventy-sixth closed every rule-level fix for grouping by construction and ended: "Improving it
means a different proposal source, which is a model change and not a configuration one." This is
how a different proposal source gets measured without touching anything downstream.

`reached` asks whether any proposal covers the item. `isolated` asks whether one covers it without
also swallowing another labelled item, which is the quantity the census actually suffers from: a
badge on a box holding two products asks about the pair.

    KART_DETECTOR=openmmlab-community/mm_grounding_dino_base_all \
      server/.venv/bin/python server/eval/compare_detectors.py
"""
import argparse, json, os, pathlib, sys

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))
REACHED, CONTAM = 0.55, 0.45


def _frac(inner, outer):
    ix1, iy1 = inner["x"] + inner["w"], inner["y"] + inner["h"]
    ox1, oy1 = outer["x"] + outer["w"], outer["y"] + outer["h"]
    w = max(0.0, min(ix1, ox1) - max(inner["x"], outer["x"]))
    h = max(0.0, min(iy1, oy1) - max(inner["y"], outer["y"]))
    a = inner["w"] * inner["h"]
    return (w * h / a) if a > 0 else 0.0


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--threshold", type=float, default=None)
    ap.add_argument("--long-edge", type=int, default=2000)
    ap.add_argument("--save", default=None,
                    help="write the proposals to .cache/kart/<name> in frames.json shape")
    args = ap.parse_args(argv)

    from PIL import Image, ImageOps
    import score_kart, regions
    threshold = regions.BOX_THRESHOLD if args.threshold is None else args.threshold
    ground, device = score_kart.detector()
    model = os.environ.get("KART_DETECTOR", "IDEA-Research/grounding-dino-base")
    print(f"{model} at threshold {threshold} on {device}\n")

    totals = dict(reached=0, isolated=0, items=0, r_read=0, i_read=0, read=0, boxes=0)
    saved = []
    for lab in sorted((HERE / "corpus/kart").glob("boxes-*.json")):
        L = json.loads(lab.read_text())
        items = L["items"]
        pil = ImageOps.exif_transpose(
            Image.open(HERE / f".cache/kart/images/{L['image']}.jpg")).convert("RGB")
        pil.thumbnail((args.long_edge, args.long_edge))
        boxes, scores = ground(pil, regions.GROCERY_PROMPT, threshold)
        keep = regions.dedupe(boxes, scores, size=pil.size) if boxes else []
        W, H = pil.size
        props = [{"x": boxes[k][0] / W, "y": boxes[k][1] / H,
                  "w": (boxes[k][2] - boxes[k][0]) / W, "h": (boxes[k][3] - boxes[k][1]) / H}
                 for k in keep]
        r = i = rr = ii = read = 0
        for it in items:
            best_clean = False
            hit = False
            for p in props:
                if _frac(it["box"], p) < REACHED:
                    continue
                hit = True
                others = max((_frac(o["box"], p) for o in items if o is not it), default=0.0)
                best_clean = best_clean or others < CONTAM
            r += hit
            i += best_clean
            if not it["judged"]:
                read += 1
                rr += hit
                ii += best_clean
        saved.append({"id": L["image"], "width": W, "height": H, "boxes": props,
                      "scores": [float(scores[k]) for k in keep]})
        print(f"  {L['image']}: {len(props)} proposals, reached {rr}/{read}, isolated {ii}/{read}"
              f"  (with judged: {r}/{len(items)}, {i}/{len(items)})")
        totals["reached"] += r; totals["isolated"] += i; totals["items"] += len(items)
        totals["r_read"] += rr; totals["i_read"] += ii; totals["read"] += read
        totals["boxes"] += len(props)

    print(f"\n  {model}")
    print(f"  proposals {totals['boxes']}")
    print(f"  reached   {totals['r_read']}/{totals['read']} readable "
          f"({totals['reached']}/{totals['items']} with judged)")
    print(f"  isolated  {totals['i_read']}/{totals['read']} readable "
          f"({totals['isolated']}/{totals['items']} with judged)")
    if args.save:
        out = HERE / ".cache/kart" / args.save
        out.write_text(json.dumps({"detector": model, "threshold": threshold, "frames": saved}))
        print(f"  wrote {out}")


if __name__ == "__main__":
    main()
