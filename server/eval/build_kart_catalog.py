"""Catalog references from the video, so the stills can be queried without training on them.

CLAUDE.md assumes the store's product list is known and that the model is fine-tuned per store.
Testing that honestly needs references from one capture and queries from another, or the number
measures memorisation. The video and the stills are exactly that split: different session,
different angles, different lighting, the same trolley.

Identity linkage comes from the shipped tracker rather than a rule invented here, so a reference
set is one the product could actually have collected. But a track is not automatically one item:
measured on this video, four of eleven confirmed tracks contain at least one point where the box
slid onto something else. So each track is first cut into appearance-consistent runs at exactly
those points, using the same cosine test `score_kart_tracks.py` applies, and a run is what gets
labelled. That way a switch costs the run it happens in rather than poisoning a product's
references with pictures of a different product.

    ../.venv/bin/python build_kart_catalog.py --render <dir>     # to label
    ../.venv/bin/python build_kart_catalog.py --labels labels.json --out .cache/kart/catalog
"""

import argparse
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
CACHE = HERE / ".cache" / "kart"
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))

PAD = 0.06
CUT = 0.75
MIN_RUN = 3


def runs(tracks, similarities, cut=CUT, min_run=MIN_RUN):
    """Each track cut into stretches with no appearance discontinuity in them."""
    breaks = {}
    for entry in similarities["tracks"]:
        breaks[entry["id"]] = {s["to"] for s in entry["steps"] if s["similarity"] < cut}
    out = []
    for track in tracks:
        current = []
        for appearance in sorted(track["appearances"], key=lambda a: a["frame"]):
            if appearance["frame"] in breaks.get(track["id"], set()) and current:
                out.append((track["id"], current))
                current = []
            current.append(appearance)
        if current:
            out.append((track["id"], current))
    return [(f"{tid}-{i}", app) for i, (tid, app) in enumerate(out) if len(app) >= min_run]


def crop(image, box, pad=PAD):
    w, h = image.size
    x0 = max(0, int((box["x"] - box["w"] * pad) * w))
    y0 = max(0, int((box["y"] - box["h"] * pad) * h))
    x1 = min(w, int((box["x"] + box["w"] * (1 + pad)) * w))
    y1 = min(h, int((box["y"] + box["h"] * (1 + pad)) * h))
    if x1 - x0 < 16 or y1 - y0 < 16:
        return None
    return image.crop((x0, y0, x1, y1))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tracks", default=str(HERE / "video-tracks.json"))
    parser.add_argument("--drift", default=str(CACHE / "track-drift.json"))
    parser.add_argument("--frames", default=str(CACHE / "video"))
    parser.add_argument("--labels", default=str(HERE / "corpus" / "kart" / "run-labels.json"))
    parser.add_argument("--render", default=None)
    parser.add_argument("--out", default=str(CACHE / "catalog"))
    parser.add_argument("--split-cut", type=float, default=CUT,
                        help="similarity below which a run is cut in two. Higher than the cut "
                             "used to *report* switches: reporting wants the switches that are "
                             "certain, building a catalog wants purity, and an over-split run "
                             "costs a few references where a contaminated one costs accuracy.")
    parser.add_argument("--min-run", type=int, default=MIN_RUN)
    parser.add_argument("--append", action="store_true",
                        help="add to an existing catalog rather than replacing it, so a second "
                             "split of the same video contributes the runs the first could not "
                             "separate")
    args = parser.parse_args(argv)

    from PIL import Image

    tracks = json.loads(pathlib.Path(args.tracks).read_text())["tracks"]
    drift = json.loads(pathlib.Path(args.drift).read_text())
    chosen = runs(tracks, drift, args.split_cut, args.min_run)
    print(f"  {len(tracks)} confirmed tracks -> {len(chosen)} appearance-consistent runs "
          f"of {MIN_RUN}+ frames")

    frames = {}
    for p in sorted(pathlib.Path(args.frames).glob("frame-*.jpg")):
        frames[int(p.stem.split("-")[1]) - 1] = p
    opened = {}

    if args.render:
        out_dir = pathlib.Path(args.render)
        out_dir.mkdir(parents=True, exist_ok=True)
        CELL = 200
        rows = []
        for name, appearances in chosen:
            tiles = []
            step = max(1, len(appearances) // 5)
            for a in appearances[::step][:5]:
                path = frames.get(a["frame"])
                if path is None:
                    continue
                if path not in opened:
                    opened[path] = Image.open(path).convert("RGB")
                piece = crop(opened[path], a["box"])
                if piece is None:
                    continue
                piece.thumbnail((CELL, CELL))
                tile = Image.new("RGB", (CELL, CELL), (20, 20, 20))
                tile.paste(piece, ((CELL - piece.width) // 2, (CELL - piece.height) // 2))
                tiles.append(tile)
            if tiles:
                rows.append((name, len(appearances), tiles))
        sheet = Image.new("RGB", (CELL * 5, CELL * len(rows)), (20, 20, 20))
        for i, (_, _, tiles) in enumerate(rows):
            for j, tile in enumerate(tiles):
                sheet.paste(tile, (j * CELL, i * CELL))
        sheet.save(out_dir / "runs.jpg", quality=92)
        print("\n  row order:")
        for i, (name, count, _) in enumerate(rows):
            print(f"    row {i}: {name}  ({count} frames)")
        print(f"\n  wrote {out_dir / 'runs.jpg'}")
        return 0

    labels_path = pathlib.Path(args.labels)
    if not labels_path.exists():
        print(f"  no labels at {labels_path}; run with --render first and label the runs")
        return 1
    labels = json.loads(labels_path.read_text())["runs"]

    out_root = pathlib.Path(args.out)
    if out_root.exists() and not args.append:
        import shutil
        shutil.rmtree(out_root)
    written = {}
    if args.append:
        for folder in sorted(p for p in out_root.iterdir() if p.is_dir()):
            written[folder.name] = len(list(folder.glob("*.jpg")))
    for name, appearances in chosen:
        sku = labels.get(name)
        if not sku or sku == "skip":
            continue
        folder = out_root / sku
        folder.mkdir(parents=True, exist_ok=True)
        for a in appearances:
            path = frames.get(a["frame"])
            if path is None:
                continue
            if path not in opened:
                opened[path] = Image.open(path).convert("RGB")
            piece = crop(opened[path], a["box"])
            if piece is None:
                continue
            # Named by the frame, not by the run. Two splits of the same video, one coarse and
            # one fine, disagree about where runs begin and end but agree about what is in a
            # given frame, so keying on the frame lets their outputs be unioned instead of
            # duplicated.
            target = folder / f"v{a['frame']:03d}.jpg"
            already = target.exists()
            piece.save(target, quality=93)
            if not already:
                written[sku] = written.get(sku, 0) + 1

    # The early photographs as well. A product photographed once in the video and once on the
    # shelf of the trolley is a product with two viewpoints, which is what a reference set is
    # for; the query photographs are excluded by name rather than by chance.
    stills_path = HERE / "corpus" / "kart" / "still-labels.json"
    if stills_path.exists():
        stills = json.loads(stills_path.read_text())
        frames_json = json.loads((CACHE / "frames.json").read_text())["frames"]
        by_id = {f["id"]: f for f in frames_json}
        images_dir = CACHE / "images"
        from PIL import ImageOps
        for photograph, names in stills["boxes"].items():
            frame = by_id.get(photograph)
            if frame is None:
                continue
            source = ImageOps.exif_transpose(
                Image.open(images_dir / f"{photograph}.jpg")).convert("RGB")
            source.thumbnail((1333, 1333))
            for i, sku in enumerate(names):
                if sku == "skip" or i >= len(frame["boxes"]):
                    continue
                piece = crop(source, frame["boxes"][i])
                if piece is None:
                    continue
                folder = out_root / sku
                folder.mkdir(parents=True, exist_ok=True)
                target = folder / f"{photograph}-{i}.jpg"
                already = target.exists()
                piece.save(target, quality=93)
                if not already:
                    written[sku] = written.get(sku, 0) + 1

    print(f"\n  {len(written)} products, {sum(written.values())} references")
    for sku, count in sorted(written.items(), key=lambda kv: -kv[1]):
        print(f"    {sku:28} {count}")
    print(f"\nwrote {out_root}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
