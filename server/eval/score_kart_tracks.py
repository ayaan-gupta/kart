"""Does a track stay on the item it started on?

A track is the product's answer to "is this the same item I saw a moment ago", and every count
depends on it. If a track drifts from the baguette to the biscuits, the shopper's bag gets the
wrong thing and the count is still right, which is the kind of error no count-based metric can
see.

Drift is measurable without hand labels. Each frame of a track is a crop of whatever the box was
on; embed the crops with the same encoder the matcher uses and the cosine similarity between
consecutive frames is how much the thing inside the box changed. An item seen from a slightly
different angle moves a little. A box that has slid onto a different item moves a lot.

The threshold is not assumed. It is read off this corpus's own distribution: consecutive crops
within a track are overwhelmingly similar, and the switches sit in a separate tail.

    ../.venv/bin/python score_kart_tracks.py
"""

import argparse
import json
import pathlib
import statistics
import sys

HERE = pathlib.Path(__file__).resolve().parent
CACHE = HERE / ".cache" / "kart"
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))

PAD = 0.06


def crops_for(tracks, frames_dir):
    """Every appearance of every track, as (track id, frame order, PIL image)."""
    from PIL import Image

    by_order = {}
    for p in sorted(frames_dir.glob("frame-*.jpg")):
        by_order[int(p.stem.split("-")[1]) - 1] = p

    out = []
    cache = {}
    for track in tracks:
        for appearance in track["appearances"]:
            path = by_order.get(appearance["frame"])
            if path is None:
                continue
            if path not in cache:
                cache[path] = Image.open(path).convert("RGB")
            im = cache[path]
            w, h = im.size
            b = appearance["box"]
            x0 = max(0, int((b["x"] - b["w"] * PAD) * w))
            y0 = max(0, int((b["y"] - b["h"] * PAD) * h))
            x1 = min(w, int((b["x"] + b["w"] * (1 + PAD)) * w))
            y1 = min(h, int((b["y"] + b["h"] * (1 + PAD)) * h))
            if x1 - x0 < 16 or y1 - y0 < 16:
                continue
            out.append((track["id"], appearance["frame"], im.crop((x0, y0, x1, y1))))
    return out


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tracks", default=str(HERE / "video-tracks.json"))
    parser.add_argument("--frames", default=str(CACHE / "video"))
    parser.add_argument("--encoder", default="siglipb16")
    parser.add_argument("--out", default=str(CACHE / "track-drift.json"))
    parser.add_argument("--cut", type=float, default=None,
                        help="fixed similarity below which a step counts as a switch. Without "
                             "it the cut is derived from this run's own spread, which is right "
                             "for describing one run and wrong for comparing two: a change that "
                             "tightens the distribution also tightens the test.")
    args = parser.parse_args(argv)

    import numpy as np
    from catalog import encode

    payload = json.loads(pathlib.Path(args.tracks).read_text())
    items = crops_for(payload["tracks"], pathlib.Path(args.frames))
    print(f"  {len(payload['tracks'])} tracks, {len(items)} crops")

    # The matcher's own encoder, so "how much did the thing in the box change" is measured in the
    # same space the product decides identity in.
    prepare, run = encode.load(args.encoder)
    features = encode.embed([c for _, _, c in items], prepare, run)

    by_track = {}
    for (tid, order, _), vector in zip(items, features):
        by_track.setdefault(tid, []).append((order, vector))

    steps, rows = [], []
    for tid, appearances in by_track.items():
        appearances.sort(key=lambda a: a[0])
        similarities = []
        for (a_order, a), (b_order, b) in zip(appearances, appearances[1:]):
            similarity = float(a @ b)
            similarities.append((a_order, b_order, similarity))
            steps.append(similarity)
        rows.append((tid, len(appearances), similarities))

    if not steps:
        print("  nothing to measure")
        return 1

    ordered = sorted(steps)
    print(f"\n  cosine similarity between consecutive crops of one track, {len(steps)} steps")
    for q in (0.05, 0.25, 0.5, 0.75, 0.95):
        print(f"    {q*100:5.0f}th percentile  {ordered[int(q*len(ordered))]:.3f}")

    # The cut is the corpus's own shape, not a preference: the gap between an item seen again and
    # a box that has moved onto something else.
    derived = statistics.median(steps) - 2 * statistics.stdev(steps)
    cut = derived if args.cut is None else args.cut
    print(f"\n  median {statistics.median(steps):.3f}, sd {statistics.stdev(steps):.3f}"
          f"  ->  derived cut {derived:.3f}"
          + ("" if args.cut is None else f", using fixed cut {cut:.3f}"))

    print(f"\n  {'track':10} {'frames':>7} {'worst step':>11} {'suspect switches':>17}")
    switched = 0
    for tid, count, similarities in sorted(rows, key=lambda r: -r[1]):
        if not similarities:
            continue
        worst = min(s for _, _, s in similarities)
        bad = [(a, b) for a, b, s in similarities if s < cut]
        switched += 1 if bad else 0
        marks = " ".join(f"{a}->{b}" for a, b in bad) if bad else ""
        print(f"    {tid:10} {count:>7} {worst:>11.3f} {len(bad):>17}  {marks}")

    total_switches = sum(1 for _, _, sims in rows for _, _, sim in sims if sim < cut)
    print(f"\n  {switched} of {len(rows)} confirmed tracks contain at least one switch, "
          f"{total_switches} switches over {len(steps)} steps")
    pathlib.Path(args.out).write_text(json.dumps({
        "cut": cut,
        "median": statistics.median(steps),
        "tracks": [{"id": t, "frames": n,
                    "steps": [{"from": a, "to": b, "similarity": s} for a, b, s in sims]}
                   for t, n, sims in rows],
    }, indent=1))
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
