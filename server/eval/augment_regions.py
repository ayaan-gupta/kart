"""Add low-threshold proposals to dense frames, but only where the shipped pass found nothing.

The eighty-eighth measured that IMG_0254's yellow produce bag -- the most stubborn item in this
corpus -- IS isolated by the detector at threshold 0.15, and that swapping a dense frame's whole
region set to 0.15 costs five units end to end, because five of the six proposals it gains are
ground the shipped pass already covered.

This keeps the shipped set and adds only a 0.15 box that overlaps nothing in it: no IoU above
MAX_IOU with any existing box, and not sitting inside one past MAX_INSIDE. On the two loaded
trolleys that is two boxes each rather than six, and it is enough to reach every labelled item.

Sparse frames are left alone entirely. The seventy-fourth measured a lower threshold breaking both
sparse trolleys, which have one to three products and nothing to gain.

    server/.venv/bin/python server/eval/augment_regions.py \
        [--base frames-named.json] [--low frames-t0.15.json] [--out frames-augment15.json]
"""
import argparse, json, pathlib

HERE = pathlib.Path(__file__).parent
CACHE = HERE / ".cache/kart"
DENSE_AT = 8      # proposals in the shipped pass before a frame counts as dense
MAX_IOU = 0.30    # above this, the low-threshold box is the same object again
MAX_INSIDE = 0.60 # above this, it is a part of something already proposed


def _iou(a, b):
    ax1, ay1, bx1, by1 = a["x"]+a["w"], a["y"]+a["h"], b["x"]+b["w"], b["y"]+b["h"]
    inter = max(0.0, min(ax1, bx1)-max(a["x"], b["x"])) * max(0.0, min(ay1, by1)-max(a["y"], b["y"]))
    union = a["w"]*a["h"] + b["w"]*b["h"] - inter
    return inter/union if union > 0 else 0.0


def _inside(inner, outer):
    ix1, iy1 = inner["x"]+inner["w"], inner["y"]+inner["h"]
    ox1, oy1 = outer["x"]+outer["w"], outer["y"]+outer["h"]
    inter = max(0.0, min(ix1, ox1)-max(inner["x"], outer["x"])) * \
            max(0.0, min(iy1, oy1)-max(inner["y"], outer["y"]))
    area = inner["w"]*inner["h"]
    return inter/area if area > 0 else 0.0


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="frames-named.json")
    ap.add_argument("--low", default="frames-t0.15.json")
    ap.add_argument("--out", default="frames-augment15.json")
    args = ap.parse_args(argv)

    base = json.loads((CACHE / args.base).read_text())
    low = json.loads((CACHE / args.low).read_text())
    bf = base["frames"] if isinstance(base, dict) else base
    lf = {f["id"]: f for f in (low["frames"] if isinstance(low, dict) else low)}

    out = []
    for f in bf:
        if len(f["boxes"]) < DENSE_AT or f["id"] not in lf:
            out.append(f)
            continue
        grown = dict(f)
        boxes, scores = list(f["boxes"]), list(f.get("scores", []))
        catalog = list(f.get("catalog") or [])
        src = lf[f["id"]]
        added = 0
        for i, b in enumerate(src["boxes"]):
            if any(_iou(b, e) >= MAX_IOU or _inside(b, e) >= MAX_INSIDE for e in f["boxes"]):
                continue
            boxes.append(b)
            ss = src.get("scores") or []
            scores.append(ss[i] if i < len(ss) else 0)
            sc = src.get("catalog") or []
            catalog.append(sc[i] if i < len(sc) else None)
            added += 1
        grown["boxes"], grown["scores"] = boxes, scores
        if f.get("catalog") is not None:
            grown["catalog"] = catalog
        out.append(grown)
        print(f"  {f['id']}: {len(f['boxes'])} + {added} new-ground = {len(boxes)}")

    payload = dict(base) if isinstance(base, dict) else {}
    payload["frames"] = out
    (CACHE / args.out).write_text(json.dumps(payload))
    print(f"wrote {CACHE / args.out}")


if __name__ == "__main__":
    main()
