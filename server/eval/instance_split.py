"""Does a detector separate two packages of one product that the photo path counts as one?

The photo path reads a photograph twice and asserts a line only when the two readings agree. Both
readings are Qwen looking at the same pixels, so a mistake both make survives the gate. Two of the
fifteen clut photographs fail that way and both are the same mistake: two bags of Priano rigatoni
leaning together on clut4 are counted as one, and a box of rosemary sourdough crackers standing
behind a box of sea salt on clut9 is called a second box of sea salt.

Asking Qwen to point at each package does not fix it. Measured on 2026-09-12, Qwen separates the
two bags when it is shown a crop of the bags alone, and merges them, three times out of three,
when it is shown the crop the phone actually sends, which also holds the Nutella and the pasta
sauce beside them. Asking for the tight region first and pointing inside it does not help either,
because the rectangle around the two bags still contains the jar standing in front of them. What
separates them is the neighbours being gone from the image, and a rectangle cannot do that.

So this asks the question of a detector instead. `server/enumerator` already runs Grounding DINO
for the live scan, where it proposes the regions the badge census names; it has never been pointed
at a photograph's crops. Here it is given one crop and the words the wide pass used for it, and
what comes back is the number of boxes it puts on that product.

    server/.venv/bin/python server/eval/instance_split.py server/eval/clut-photos-salvage.json

      --pass <n>        which pass of the saved run to use, default 1
      --only <ids>      comma-separated image ids
      --threshold <t>   detector threshold, default the enumerator's own 0.23
      --out <path>      result JSON, default server/eval/instance-split.json
      --write-crops     write each crop with its boxes drawn to .cache/clut/instances/

`KART_DETECTOR` swaps the model, as it does for the other detector harnesses here.

The numbers that decide it, printed at the end: on crops where the wide pass counted one package
and there is more than one, how many does the detector find; and on crops where one is right, how
often does it find more than one anyway. The second number is the cost, because a split that is
not there invents a product in the shopper's bag.
"""
import argparse, json, os, pathlib, sys

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "enumerator"))

CACHE = HERE / ".cache" / "clut"
CORPUS = HERE / "corpus" / "clut"
CROP_PADDING = 0.08     # uploadImage.ts CROP_PADDING
CROP_LONG_EDGE = 1536   # uploadImage.ts CROP_LONG_EDGE


def crop_of(pil, box):
    """The crop the phone sends for one box, by the rule in src/engine/liveVision/uploadImage.ts."""
    w, h = pil.size
    pad_x, pad_y = box["w"] * CROP_PADDING, box["h"] * CROP_PADDING
    left = max(0.0, min(1.0, box["x"] - pad_x))
    top = max(0.0, min(1.0, box["y"] - pad_y))
    right = max(0.0, min(1.0, box["x"] + box["w"] + pad_x))
    bottom = max(0.0, min(1.0, box["y"] + box["h"] + pad_y))
    px = (int(left * w), int(top * h), int(round(right * w)), int(round(bottom * h)))
    if px[2] - px[0] < 1 or px[3] - px[1] < 1:
        return None
    cut = pil.crop(px)
    long_edge = max(cut.size)
    if long_edge > CROP_LONG_EDGE:
        scale = CROP_LONG_EDGE / long_edge
        cut = cut.resize((max(1, int(cut.size[0] * scale)), max(1, int(cut.size[1] * scale))))
    return cut


def phrase(name, brand):
    """The words the wide pass used, as one Grounding DINO phrase.

    The brand is left out. It is a proper noun printed on the packaging, and a detector prompted
    with it looks for the logo rather than for the package.
    """
    text = " ".join(str(name).lower().replace(".", " ").split())
    return f"a {text}." if text else "a grocery product."


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("runs", nargs="*", default=[str(HERE / "clut-photos-salvage.json")])
    ap.add_argument("--pass", dest="which", type=int, default=1)
    ap.add_argument("--only", default="")
    ap.add_argument("--threshold", type=float, default=None)
    ap.add_argument("--out", default=str(HERE / "instance-split.json"))
    ap.add_argument("--write-crops", action="store_true")
    args = ap.parse_args(argv)

    from PIL import Image, ImageDraw
    import regions
    from score_kart import detector

    threshold = regions.BOX_THRESHOLD if args.threshold is None else args.threshold
    ground, device = detector()
    print(f"{os.environ.get('KART_DETECTOR', 'IDEA-Research/grounding-dino-base')} on {device}, threshold {threshold}")

    labels = json.loads((CORPUS / "labels.json").read_text())
    by_id = {image["id"]: image for image in labels["images"]}
    only = [s.strip() for s in args.only.split(",") if s.strip()]
    out_dir = CACHE / "instances"
    if args.write_crops:
        out_dir.mkdir(parents=True, exist_ok=True)

    results = []
    for run_path in args.runs:
        run = json.loads(pathlib.Path(run_path).read_text())
        for row in run["rows"]:
            if row.get("pass") != args.which or row["id"] not in by_id:
                continue
            if only and row["id"] not in only:
                continue
            photo = CACHE / f"{row['id']}.jpg"
            if not photo.exists():
                continue
            pil = Image.open(photo).convert("RGB")
            for index, item in enumerate(row.get("items") or []):
                if not item.get("box"):
                    continue
                cut = crop_of(pil, item["box"])
                if cut is None:
                    continue
                text = phrase(item["name"], item.get("brand"))
                boxes, scores = ground(cut, text, threshold)
                keep = regions.dedupe(boxes, scores, size=cut.size) if boxes else []
                kept = [boxes[i] for i in keep]
                saved = next((v for v in ((row.get("verify") or {}).get("items") or []) if v.get("id") == f"p{index}"), None)
                saved_count = ((saved or {}).get("close") or {}).get("count")
                results.append({
                    "run": pathlib.Path(run_path).name,
                    "id": row["id"],
                    "pass": row["pass"],
                    "index": index,
                    "name": item["name"],
                    "prompt": text,
                    "wideCount": item.get("qty"),
                    "savedCount": saved_count,
                    "raw": len(boxes),
                    "boxes": [[round(v, 1) for v in b] for b in kept],
                    "found": len(kept),
                    "size": list(cut.size),
                })
                print(f"  {row['id']} p{row['pass']} #{index} {item['name']}: {len(kept)} boxes"
                      f" ({len(boxes)} before dedupe), wide {item.get('qty')}, close {saved_count}")
                if args.write_crops:
                    drawn = cut.copy()
                    pen = ImageDraw.Draw(drawn)
                    for b in kept:
                        pen.rectangle(b, outline=(0, 255, 0), width=4)
                    drawn.save(out_dir / f"{row['id']}-p{row['pass']}-{index}.jpg", quality=88)

    pathlib.Path(args.out).write_text(json.dumps({
        "detector": os.environ.get("KART_DETECTOR", "IDEA-Research/grounding-dino-base"),
        "threshold": threshold,
        "pass": args.which,
        "runs": [pathlib.Path(r).name for r in args.runs],
        "results": results,
    }, indent=1) + "\n")

    split = [r for r in results if r["found"] > 1]
    agreed = [r for r in results if r["savedCount"] is not None and r["found"] == r["savedCount"]]
    print(f"\n  {len(results)} crops, {len(split)} with more than one box, "
          f"{len(agreed)} agreeing with the close read's count")
    print(f"  written to {args.out}")


if __name__ == "__main__":
    main()
