"""
Draw what the shopper would see, so it can be looked at rather than assumed.

Every other harness here prints numbers. This one draws the four outline states over the
photograph they came from, using the states the TypeScript engine computed, and writes contact
sheets. A number cannot tell you that a box is drawn around two items at once, or around the
cart's handle, or that the covered rule has flagged an entire pile. Looking can.

    server/node_modules/.bin/tsx server/eval/pipeline/states.ts
    server/.venv/bin/python server/eval/render_carts.py --out /tmp/overlays
"""
import argparse
import json
import pathlib

HERE = pathlib.Path(__file__).resolve().parent
CORPUS = HERE / "corpus"

# The overlay's own colours, from src/design/tokens.ts, so the sheet looks like the app.
STROKE = {
    "counted": (52, 199, 89),
    "closer": (255, 179, 0),
    "covered": (255, 255, 255),
    "forming": (170, 170, 170),
}
FILL = {
    "counted": (52, 199, 89, 56),
    "closer": (255, 179, 0, 51),
    "covered": (0, 0, 0, 90),
    "forming": None,
}


def draw(states, boxes, path):
    from PIL import Image, ImageDraw, ImageOps

    with Image.open(path) as handle:
        # Phone photographs carry EXIF orientation; without this the overlay is drawn a quarter
        # turn from the picture it is describing.
        handle = ImageOps.exif_transpose(handle)
        image = handle.convert("RGB")
    width, height = image.size
    layer = Image.new("RGBA", image.size, (0, 0, 0, 0))
    pen = ImageDraw.Draw(layer)
    line = max(2, width // 500)
    for box, state in zip(boxes, states):
        x0, y0 = box["x"] * width, box["y"] * height
        x1, y1 = (box["x"] + box["w"]) * width, (box["y"] + box["h"]) * height
        if FILL[state]:
            pen.rectangle([x0, y0, x1, y1], fill=FILL[state])
        if state == "covered":
            # Dashed, as the component draws it, so the sheet does not imply a solid outline.
            step = max(8, width // 90)
            for x in range(int(x0), int(x1), step * 2):
                pen.line([x, y0, min(x + step, x1), y0], fill=STROKE[state], width=line)
                pen.line([x, y1, min(x + step, x1), y1], fill=STROKE[state], width=line)
            for y in range(int(y0), int(y1), step * 2):
                pen.line([x0, y, x0, min(y + step, y1)], fill=STROKE[state], width=line)
                pen.line([x1, y, x1, min(y + step, y1)], fill=STROKE[state], width=line)
        else:
            pen.rectangle([x0, y0, x1, y1], outline=STROKE[state], width=line)
    return Image.alpha_composite(image.convert("RGBA"), layer).convert("RGB")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", default="/tmp/kart-overlays")
    parser.add_argument("--images", default=None,
                        help="directory holding the photographs, if not corpus/carts")
    parser.add_argument("--cell", type=int, default=560)
    parser.add_argument("--cols", type=int, default=3)
    args = parser.parse_args(argv)

    from PIL import Image, ImageDraw, ImageOps

    frames = {f["id"]: f for f in json.loads((HERE / "carts-frames.json").read_text())["frames"]}
    states = json.loads((HERE / "carts-states.json").read_text())
    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    rendered = []
    for result in states["results"]:
        frame = frames[result["id"]]
        root = pathlib.Path(args.images) if args.images else CORPUS / "carts"
        image = draw(result["states"], result["trackBoxes"], root / frame["file"])
        image.save(out / f"{result['id']}.jpg", quality=88)
        rendered.append((result, image))

    per_page = args.cols * 2
    for start in range(0, len(rendered), per_page):
        chunk = rendered[start : start + per_page]
        rows = (len(chunk) + args.cols - 1) // args.cols
        sheet = Image.new("RGB", (args.cols * args.cell, rows * args.cell), (18, 18, 18))
        pen = ImageDraw.Draw(sheet)
        for i, (result, image) in enumerate(chunk):
            thumb = image.copy()
            thumb.thumbnail((args.cell - 8, args.cell - 30))
            sheet.paste(thumb, ((i % args.cols) * args.cell + 4,
                                (i // args.cols) * args.cell + 26))
            tally = {s: result["states"].count(s) for s in STROKE}
            pen.text(((i % args.cols) * args.cell + 6, (i // args.cols) * args.cell + 6),
                     f"{result['id'][:14]} [{result['tier']}] green {tally['counted']} "
                     f"amber {tally['closer']} cov {tally['covered']} plain {tally['forming']}",
                     fill=(255, 220, 80))
        page = out / f"overlay-sheet-{start // per_page}.jpg"
        sheet.save(page, quality=86)
        print(f"  {page}")
    print(f"\n{len(rendered)} overlays in {out}")


if __name__ == "__main__":
    main()
