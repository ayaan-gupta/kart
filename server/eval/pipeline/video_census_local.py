"""Local census answers for the video's captures, in the shape `video-census-live.ts --replay` reads.

The still path has had a keyless bag harness since `census_local.py`. The video has not, so since
the account emptied the video's *bag* has been dark and only its regions could be measured. This
closes that: the same per-crop questions `census_local.py` asks, put to the frames the loop actually
censuses, written out as a replay file.

Same caveat as everywhere else it is used: this is a local model standing in for the census, so it
measures the pipeline around a stand-in rather than the service. What it makes possible is measuring
a *change* on the video without credit, which was not possible at all before.

    KART_VLM=mlx-community/Qwen2.5-VL-7B-Instruct-4bit \
      server/.venv/bin/python server/eval/pipeline/video_census_local.py \
        --frames video-frames-catalog.json --out kart-video-local-replay.json
"""
import argparse, json, os, pathlib, sys

from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import vlm

HERE = pathlib.Path(__file__).resolve().parent.parent
CACHE = HERE / ".cache" / "kart"
MODEL = os.environ.get("KART_VLM", "mlx-community/Qwen2.5-VL-7B-Instruct-4bit")
PAD = 0.06
NAME_Q = ("What grocery product is this? Answer with the product name only, three words at most. "
          "If it is not a product a shopper is buying, answer NOT A PRODUCT.")
FRAME_Q = ("List the grocery products in this shopping trolley, one per line, name only. "
           "Do not list the trolley, the floor, bags, shoes or people.")


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--frames", default="video-frames-catalog.json")
    # The captures the loop fires on, from the capture path's own log.
    ap.add_argument("--orders", default="6,12,18,24")
    ap.add_argument("--out", default="kart-video-local-replay.json")
    args = ap.parse_args(argv)

    data = json.loads((HERE / args.frames).read_text())
    by = {f["order"]: f for f in data["frames"]}
    orders = [int(o) for o in args.orders.split(",")]
    backend = vlm.load(MODEL)
    print(f"model {MODEL}, frames {args.frames}\n")

    out = []
    for order in orders:
        frame = by.get(order)
        path = CACHE / f"video/frame-{order + 1:03d}.jpg"
        if frame is None or not path.exists():
            print(f"  order {order}: no frame, skipped")
            continue
        pil = Image.open(path).convert("RGB")
        W, H = pil.size
        marks = []
        for i, b in enumerate(frame["boxes"]):
            x0 = max(0, int((b["x"] - PAD * b["w"]) * W))
            y0 = max(0, int((b["y"] - PAD * b["h"]) * H))
            x1 = min(W, int((b["x"] + b["w"] * (1 + PAD)) * W))
            y1 = min(H, int((b["y"] + b["h"] * (1 + PAD)) * H))
            crop = pil.crop((x0, y0, x1, y1))
            if crop.width < 16 or crop.height < 16:
                marks.append({"id": i + 1, "name": "unreadable", "brand": None, "size": None,
                              "category": "unknown", "confidence": 0.1,
                              "needsCloserLook": True, "isProduct": False, "catalogSku": None})
                continue
            said = backend.ask(crop, NAME_Q, tokens=16).strip()
            is_product = "NOT A PRODUCT" not in said.upper()
            marks.append({"id": i + 1, "name": said if is_product else "not a product",
                          "brand": None, "size": None, "category": "grocery",
                          "confidence": 0.9, "needsCloserLook": False,
                          "isProduct": is_product, "catalogSku": None})
        listed = [l.strip(" -*0123456789.") for l in
                  backend.ask(pil, FRAME_Q, tokens=120).splitlines() if l.strip()]
        named = {m["name"] for m in marks if m["isProduct"]}
        unmarked = [{"description": p, "confidence": 0.8, "productKey": f"::{p.lower()}"}
                    for p in dict.fromkeys(listed) if p and p not in named]
        seen = {}
        for m in marks:
            if m["isProduct"]:
                seen[m["name"]] = seen.get(m["name"], 0) + 1
        for u in unmarked:
            seen[u["description"]] = seen.get(u["description"], 0) + 1
        out.append({"t": frame["t"], "order": order, "marks": len(marks), "census": {
            "subjectIsCart": True, "marks": marks, "unmarkedItems": unmarked,
            "inViewCounts": [{"productKey": f"::{k.lower()}", "count": v} for k, v in seen.items()],
            "occlusion": {"itemsLikelyHidden": False, "severity": "none",
                          "reason": "local stand-in, not modelled"},
        }})
        print(f"  order {order}: {sum(1 for m in marks if m['isProduct'])}/{len(marks)} "
              f"regions called products, {len(unmarked)} unmarked")
    (HERE / args.out).write_text(json.dumps(out, indent=1))
    print(f"\nwrote {HERE / args.out}")


if __name__ == "__main__":
    main()
