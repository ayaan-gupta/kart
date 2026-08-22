"""Re-matches the cached video regions against the catalog as it stands now.

`video-frames.json` carries a `catalog` column, and not one of its 137 boxes has a single one of
this trolley's eight products anywhere in its five-entry shortlist. That is not the matcher
failing. It is the order the corpus was built in: `score_video.py` ran first, `build_kart_catalog.py`
cut this trolley's references out of the video afterwards, and the column was never refreshed. So
every census run over the video has been offered Pulses, Salt and Poha for a cauliflower.

The boxes are not recomputed, only the column, so the detection numbers on this video are
untouched and stay comparable.

What the refreshed column can and cannot say. These references were cut from this same video, so
the shortlist is better here than a store's catalog would be, and a bag built on it bounds the
shipped path from above rather than estimating it. The stills are where the shortlist is honest:
there the references come from the video and the queries from photographs it never saw.

    ../.venv/bin/python refresh_video_catalog.py
"""
import argparse
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
CACHE = HERE / ".cache" / "kart"
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--frames", default=str(HERE / "video-frames.json"))
    parser.add_argument("--images", default=str(CACHE / "video"))
    parser.add_argument("--index", default=str(CACHE / "index-b16-ft1.npz"))
    parser.add_argument("--out", default=str(HERE / "video-frames-catalog.json"))
    args = parser.parse_args(argv)

    from PIL import Image

    from catalog.matcher import Index, Matcher

    data = json.loads(pathlib.Path(args.frames).read_text())
    matcher = Matcher(Index.load(pathlib.Path(args.index)))
    store = [s for s in matcher.index.skus if s.startswith("kart_")]
    print(f"catalog: {len(matcher.index.skus)} products, {len(store)} of them this trolley's")

    images = pathlib.Path(args.images)
    named = 0
    shortlisted = 0
    total = 0
    for frame in data["frames"]:
        # frame-001.jpg is order 0, the way score_kart_tracks.py reads them back.
        path = images / f"frame-{frame['order'] + 1:03d}.jpg"
        if not path.exists():
            print(f"  order {frame['order']}: no frame image, leaving its column alone")
            continue
        pil = Image.open(path).convert("RGB")
        matches = matcher.match_regions(pil, frame["boxes"]) if frame["boxes"] else []
        frame["catalog"] = [
            None if m is None else {
                "sku": m["sku"],
                "confidence": round(float(m["confidence"]), 6),
                "alternatives": [a["sku"] for a in m["alternatives"]],
            }
            for m in matches
        ]
        for entry in frame["catalog"]:
            total += 1
            if entry is None:
                continue
            if entry["sku"] and entry["sku"].startswith("kart_"):
                named += 1
            if any(a.startswith("kart_") for a in entry["alternatives"]):
                shortlisted += 1

    data["index"] = pathlib.Path(args.index).name
    data["catalog_refreshed"] = True
    pathlib.Path(args.out).write_text(json.dumps(data, indent=1))
    print(f"  {total} boxes")
    print(f"    named as one of this trolley's products      {named}")
    print(f"    with one anywhere in the five alternatives   {shortlisted}")
    print(f"  wrote {args.out}")


if __name__ == "__main__":
    main()
