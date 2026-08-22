"""Detector recall on IMG_0254, against the hand-labelled boxes in corpus/kart/boxes-IMG_0254.json.

Recall here is deliberately weak: an item is REACHED if some proposal covers most of it, and
ISOLATED if a proposal covers most of it without also swallowing a different labelled item. The
distinction is the one the whole yellow-bag investigation turned on. A box drawn over the purple
and yellow bags together reaches the yellow bag and cannot make the census name it, because the
badge it produces is about the pair.

Needs no model and no API credit: it reads a cached region set and the labels.

    server/.venv/bin/python server/eval/score_boxes.py [--frames frames-named.json]
"""
import argparse, json, pathlib

HERE = pathlib.Path(__file__).parent
REACHED = 0.55      # fraction of the item's area inside the proposal
CONTAMINATED = 0.45  # fraction of ANOTHER item's area also inside it


def frac_inside(inner, outer):
    ix0, iy0 = inner["x"], inner["y"]
    ix1, iy1 = inner["x"] + inner["w"], inner["y"] + inner["h"]
    ox0, oy0 = outer["x"], outer["y"]
    ox1, oy1 = outer["x"] + outer["w"], outer["y"] + outer["h"]
    w = max(0.0, min(ix1, ox1) - max(ix0, ox0))
    h = max(0.0, min(iy1, oy1) - max(iy0, oy0))
    area = inner["w"] * inner["h"]
    return (w * h / area) if area > 0 else 0.0


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--frames", default="frames-named.json")
    ap.add_argument("--labels", default=str(HERE / "corpus/kart/boxes-IMG_0254.json"))
    args = ap.parse_args(argv)

    labels = json.loads(pathlib.Path(args.labels).read_text())
    items = labels["items"]
    data = json.loads((HERE / ".cache/kart" / args.frames).read_text())
    frames = data["frames"] if isinstance(data, dict) else data
    frame = next(f for f in frames if labels["image"] in str(f.get("id", "")))
    proposals = frame["boxes"]
    print(f"{labels['image']}: {len(proposals)} proposals against {len(items)} labelled items "
          f"({args.frames})\n")

    reached = isolated = 0
    reached_read = isolated_read = read_total = 0
    for it in items:
        best, best_cov, best_worst = None, 0.0, 1.0
        for n, p in enumerate(proposals):
            cov = frac_inside(it["box"], p)
            if cov < REACHED:
                continue
            others = max((frac_inside(o["box"], p) for o in items if o is not it), default=0.0)
            if cov > best_cov or (best is not None and others < best_worst):
                best, best_cov, best_worst = n, max(cov, best_cov), min(others, best_worst)
        ok = best is not None
        clean = ok and best_worst < CONTAMINATED
        reached += ok
        isolated += clean
        if not it["judged"]:
            read_total += 1
            reached_read += ok
            isolated_read += clean
        mark = "isolated" if clean else ("reached " if ok else "MISSED  ")
        extra = "" if not ok else f"  box {best}, {best_cov:.0%} of it, {best_worst:.0%} of another"
        print(f"  {mark}  {'(judged) ' if it['judged'] else '          '}{it['name']:<26}{extra}")

    print(f"\n  reached   {reached}/{len(items)}   ({reached_read}/{read_total} excluding judged)")
    print(f"  isolated  {isolated}/{len(items)}   ({isolated_read}/{read_total} excluding judged)")


if __name__ == "__main__":
    main()
