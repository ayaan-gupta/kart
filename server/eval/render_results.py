"""Annotated pictures of what the pipeline actually did, one per photograph and video capture.

Every number in KART.md is a count. This draws the thing the counts describe: each detector box
the census was asked about, the answer it gave, whether that answer was right, and what reached the
bag against what is really in the trolley.

Reads only saved results, so it needs no model and no API credit:

    kart-census-live.json        six trolleys, three passes each, badges and bags
    kart-video-census-live.json  the four captures of the video

    server/.venv/bin/python server/eval/render_results.py --out <dir>
"""
import argparse, json, pathlib

HERE = pathlib.Path(__file__).resolve().parent
CACHE = HERE / ".cache" / "kart"

OK, BAD, MUTE = (46, 160, 67), (215, 58, 73), (140, 148, 158)


def _font(size):
    from PIL import ImageFont
    for p in ("/System/Library/Fonts/Supplemental/Arial Bold.ttf",
              "/System/Library/Fonts/Helvetica.ttc"):
        try:
            return ImageFont.truetype(p, size)
        except OSError:
            continue
    return ImageFont.load_default()


def _said(m):
    return f"{(m.get('brand') + ' ') if m.get('brand') else ''}{m.get('name') or ''}".strip()


def draw(img, boxes, rows, width=1100):
    """Boxes with the census's answer beside each, coloured by whether it was right."""
    from PIL import ImageDraw
    img = img.copy()
    img.thumbnail((width, width))
    W, H = img.size
    d = ImageDraw.Draw(img, "RGBA")
    f = _font(max(13, W // 62))
    by = {r["badge"]: r for r in rows}
    for i, b in enumerate(boxes):
        r = by.get(i)
        colour = MUTE if r is None or r.get("ok") is None else (OK if r["ok"] else BAD)
        x0, y0 = b["x"] * W, b["y"] * H
        x1, y1 = (b["x"] + b["w"]) * W, (b["y"] + b["h"]) * H
        d.rectangle([x0, y0, x1, y1], outline=colour, width=3)
        # With no answers at all -- a photograph the gate refused -- the boxes are the whole story
        # and forty-three copies of "(no answer)" only obscure them.
        if not rows:
            continue
        said = (r or {}).get("said") or "(no answer)"
        label = f"{i}  {said}"[:38]
        tw = d.textlength(label, font=f)
        ty = max(0, y0 - f.size - 6)
        d.rectangle([x0, ty, x0 + tw + 10, ty + f.size + 6], fill=(*colour, 235))
        d.text((x0 + 5, ty + 3), label, fill=(255, 255, 255), font=f)
    return img


def main(argv=None):
    from PIL import Image, ImageOps
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(HERE / ".cache/kart/render"))
    ap.add_argument("--pass", dest="which", type=int, default=0, help="which saved pass to draw")
    args = ap.parse_args(argv)
    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    frames = {f["id"]: f for f in json.loads((CACHE / "frames-named.json").read_text())["frames"]}

    # Verdicts are re-derived from the labels as they stand rather than read from the saved run.
    # The run predates the ninetieth's correction of IMG_0254 badge 10, and a picture that shows a
    # right answer in red because the label has since changed is worse than no picture.
    labels = {}
    for name in ("still-labels.json", "query-labels.json"):
        labels.update(json.loads((HERE / "corpus/kart" / name).read_text())["boxes"])
    SAME = {
        "cauliflower": ["cauliflower"], "brussels_sprouts": ["brussels", "sprout"],
        "asparagus": ["asparagus"], "oreo": ["oreo"],
        "seedtastic_bread": ["bread", "seedtastic"],
        "granny_smith_apples": ["apple", "granny"], "baguette": ["baguette", "bread"],
        "purple_produce_bag": ["apple", "fuji", "produce bag", "purple"],
    }
    NOT_A_PRODUCT = {"not_a_product", "skip"}

    def verdict(pid, badge, said):
        lab = (labels.get(pid) or [None] * (badge + 1))[badge] if badge < len(labels.get(pid) or []) else None
        if lab in NOT_A_PRODUCT:
            return False if said and said != "(no answer)" else True
        if lab in SAME:
            return any(w in (said or "").lower() for w in SAME[lab])
        return None
    stills = [r for r in json.loads((HERE / "kart-census-live.json").read_text())
              if r["pass"] == args.which]
    summary = []
    for r in stills:
        img = ImageOps.exif_transpose(Image.open(CACHE / f"images/{r['id']}.jpg")).convert("RGB")
        rows = [{**row, "ok": verdict(r["id"], row["badge"], row.get("said"))} for row in r["rows"]]
        draw(img, frames[r["id"]]["boxes"], rows).save(out / f"{r['id']}.jpg", quality=88)
        c = r.get("contents") or {}
        summary.append({
            "id": r["id"], "kind": "trolley", "units": r["units"], "real": r["real"],
            "found": c.get("lenient"), "truth": (c.get("lenient") or 0) + len(c.get("missing") or []),
            "missing": c.get("missing") or [], "spurious": c.get("spurious") or [],
            "bag": [f"{l['qty']} x {(l['brand'] + ' ') if l.get('brand') else ''}{l['name']}"
                    for l in r["lines"]],
        })

    # The saved video results carry a mark COUNT, not the boxes, so the geometry comes from the
    # frame set the run was given and the answers are joined to it by the mark's one-based id.
    vframes = {f["order"]: f for f in
               json.loads((HERE / "video-frames-catalog.json").read_text())["frames"]}
    # The four shelves. No census answers exist for them, and that is the point: the gate refuses
    # the photograph before any region is named, so every box is drawn muted and the verdict comes
    # from `is_cart_local.py` rather than from a naming run.
    verdicts_path = CACHE / "is-cart-local.json"
    verdicts = json.loads(verdicts_path.read_text()) if verdicts_path.exists() else {}
    for pid in ("IMG_0247", "IMG_0248", "IMG_0250", "IMG_0251"):
        if pid not in frames:
            continue
        img = ImageOps.exif_transpose(Image.open(CACHE / f"images/{pid}.jpg")).convert("RGB")
        draw(img, frames[pid]["boxes"], []).save(out / f"{pid}.jpg", quality=86)
        summary.append({
            "id": pid, "kind": "shelf", "units": 0, "real": 0,
            "proposals": len(frames[pid]["boxes"]),
            "is_cart": verdicts.get(pid), "bag": [],
        })

    video = json.loads((HERE / "kart-video-census-live.json").read_text())
    for cap in video:
        fp = CACHE / f"video/frame-{cap['order'] + 1:03d}.jpg"
        frame = vframes.get(cap["order"])
        if not fp.exists() or frame is None:
            continue
        answers = cap["census"].get("marks", [])
        rows = [{"badge": int(m["id"]) - 1, "said": _said(m), "ok": None} for m in answers]
        draw(Image.open(fp).convert("RGB"), frame["boxes"], rows).save(
            out / f"video-t{cap['t']}.jpg", quality=88)
        summary.append({"id": f"video, {cap['t']}s", "kind": "video capture",
                        "units": None, "real": None,
                        "bag": [_said(m) for m in answers if m.get("isProduct") is not False]})

    (out / "summary.json").write_text(json.dumps(summary, indent=1))
    print(f"wrote {len(list(out.glob('*.jpg')))} images and summary.json to {out}")


if __name__ == "__main__":
    main()
