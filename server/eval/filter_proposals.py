"""Drop proposals the catalog matcher does not recognise, before the census is asked about them.

Seven times in KART.md a better detector has produced a worse bag, always by the same mechanism:
every proposal is a badge, every badge is a question, and every question can produce a line. The
literature's answer to this is a filter between proposing and labelling, and this corpus already
measured the signal to filter on. The eighty-third found the catalog matcher's own confidence
separates right badges from wrong ones at a +0.122 mean gap, twice the census's own confidence, with
a free operating point: at 0.60 it catches 3 of 9 wrong badges and 0 of 66 right ones, because no
correct badge here scores below 0.60.

So: propose with whatever detector, score every proposal against the catalog, and only ask the
census about the ones the catalog recognises at all.

    server/.venv/bin/python server/eval/filter_proposals.py \
        --frames frames-mm.json --min-confidence 0.60 --out frames-mm-filtered.json
"""
import argparse, json, pathlib, sys

HERE = pathlib.Path(__file__).resolve().parent
CACHE = HERE / ".cache" / "kart"
sys.path.insert(0, str(HERE.parent))


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--frames", default="frames-mm.json")
    ap.add_argument("--index", default=str(CACHE / "index-b16-ft1.npz"))
    ap.add_argument("--min-confidence", type=float, default=0.60)
    ap.add_argument("--keep-score", type=float, default=None,
                    help="also keep a proposal the matcher is unsure of when the detector's own "
                         "score is at least this. The filter's only measured cost is dropping real "
                         "products the index has no SKU for, and the detector score is an "
                         "independent signal that something is an object at all.")
    ap.add_argument("--out", default="frames-mm-filtered.json")
    args = ap.parse_args(argv)

    from PIL import Image, ImageOps
    from catalog.matcher import Index, Matcher

    data = json.loads((CACHE / args.frames).read_text())
    index = Index.load(pathlib.Path(args.index))
    matcher = Matcher(index)
    print(f"{args.frames}: filtering at matcher confidence >= {args.min_confidence}\n")

    kept_total = seen_total = 0
    for frame in data["frames"]:
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
        results = matcher.match(crops, detail=True) if crops else []
        scores = frame.get("scores") or []
        keep = []
        rescued = 0
        for n, r in enumerate(results):
            i = order[n]
            if (r.get("confidence") or 0) >= args.min_confidence:
                keep.append(i)
            elif args.keep_score is not None and i < len(scores) and scores[i] >= args.keep_score:
                keep.append(i)
                rescued += 1
        seen_total += len(frame["boxes"])
        kept_total += len(keep)
        print(f"  {frame['id']}: {len(frame['boxes'])} -> {len(keep)} proposals"
              + (f" ({rescued} kept on detector score alone)" if rescued else ""))
        frame["boxes"] = [frame["boxes"][i] for i in keep]
        if frame.get("scores"):
            frame["scores"] = [frame["scores"][i] for i in keep if i < len(frame["scores"])]
        if frame.get("catalog"):
            frame["catalog"] = [frame["catalog"][i] for i in keep if i < len(frame["catalog"])]

    data["filtered_at"] = args.min_confidence
    (CACHE / args.out).write_text(json.dumps(data))
    print(f"\n  kept {kept_total} of {seen_total} proposals; wrote {CACHE / args.out}")


if __name__ == "__main__":
    main()
