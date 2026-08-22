"""Draw what the proposal filter would remove, so the decision is not made from a number alone.

`MIN_CATALOG_CONFIDENCE` is implemented and off, waiting on a census pass to validate. Whoever
makes that call should be able to see what it drops: a proposal removed here is a question the
census is never asked, and whether that is a good trade is partly a judgement about the pictures.

Kept boxes are drawn in the page's steel blue, dropped ones in red with their matcher confidence.

    server/.venv/bin/python server/eval/render_filter.py
"""
import argparse, json, pathlib, sys

HERE = pathlib.Path(__file__).resolve().parent
CACHE = HERE / ".cache" / "kart"
sys.path.insert(0, str(HERE.parent))
KEPT, DROPPED = (36, 72, 94), (215, 58, 73)


def _font(size):
    from PIL import ImageFont
    for p in ("/System/Library/Fonts/Supplemental/Arial Bold.ttf",
              "/System/Library/Fonts/Helvetica.ttc"):
        try:
            return ImageFont.truetype(p, size)
        except OSError:
            continue
    return ImageFont.load_default()


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--frames", default="frames-named.json")
    ap.add_argument("--min-confidence", type=float, default=0.60)
    ap.add_argument("--out", default=str(CACHE / "render"))
    args = ap.parse_args(argv)

    from PIL import Image, ImageDraw, ImageOps
    from catalog.matcher import Index, Matcher

    data = json.loads((CACHE / args.frames).read_text())
    index = Index.load(CACHE / "index-b16-ft1.npz")
    matcher = Matcher(index)
    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    for frame in data["frames"]:
        if frame["id"] not in ("IMG_0252", "IMG_0254"):
            continue
        pil = ImageOps.exif_transpose(
            Image.open(CACHE / f"images/{frame['id']}.jpg")).convert("RGB")
        pil.thumbnail((2000, 2000))
        W, H = pil.size
        crops, order = [], []
        for i, b in enumerate(frame["boxes"]):
            x0, y0 = int(b["x"] * W), int(b["y"] * H)
            x1, y1 = int((b["x"] + b["w"]) * W), int((b["y"] + b["h"]) * H)
            if x1 - x0 < 8 or y1 - y0 < 8:
                continue
            crops.append(pil.crop((x0, y0, x1, y1)))
            order.append(i)
        conf = {}
        for n, r in enumerate(matcher.match(crops, detail=True)):
            conf[order[n]] = r.get("confidence") or 0.0

        view = pil.copy()
        view.thumbnail((1100, 1100))
        vw, vh = view.size
        d = ImageDraw.Draw(view, "RGBA")
        f = _font(max(13, vw // 62))
        dropped = 0
        for i, b in enumerate(frame["boxes"]):
            c = conf.get(i)
            keep = c is None or c >= args.min_confidence
            colour = KEPT if keep else DROPPED
            dropped += not keep
            x0, y0 = b["x"] * vw, b["y"] * vh
            x1, y1 = (b["x"] + b["w"]) * vw, (b["y"] + b["h"]) * vh
            d.rectangle([x0, y0, x1, y1], outline=colour, width=3 if keep else 4)
            if not keep:
                label = f"dropped  {c:.2f}"
                tw = d.textlength(label, font=f)
                ty = max(0, y0 - f.size - 6)
                d.rectangle([x0, ty, x0 + tw + 10, ty + f.size + 6], fill=(*colour, 235))
                d.text((x0 + 5, ty + 3), label, fill=(255, 255, 255), font=f)
        path = out / f"filter-{frame['id']}.jpg"
        view.save(path, quality=88)
        print(f"  {frame['id']}: {len(frame['boxes'])} proposals, {dropped} dropped -> {path.name}")


if __name__ == "__main__":
    main()
