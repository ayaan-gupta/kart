"""
Naming accuracy on real store shelves, not products on a white tray.

Every accuracy number this project has quoted came from RPC: individual products arranged on a
clean background, well lit, unoccluded, one camera. It is a fair test of an encoder and a
useless test of the product, because the thing a shopper photographs is none of those. This
harness asks the same question of `server/eval/grocer`, which is 6,289 photographs of real
Indian grocery shelves, freezers and baskets, densely packed, with products behind wire, behind
price tags, behind each other, and cut off at the frame edge.

The closed-world assumption from CLAUDE.md still holds and is what makes the question tractable:
the catalog is the complete set of answers. Here the catalog is built from crops taken out of
one set of photographs and queried with crops from a disjoint set, split by photograph so that
no query is ever answered by a reference that shares its lighting and its camera.

What is reported and why:

  top-1              the product decision. This is the number that matters.
  top-5              the candidates handed to the census model, so the ceiling on that step.
  shortlist          the ceiling on everything downstream of the encoder.
  declined           crops the matcher refused to name at all, which the product shows as unsure
                     rather than getting wrong. Being wrong and knowing it is a different
                     outcome from being wrong confidently, and the two must never be summed.
  silent error       named confidently and wrong. The only failure the shopper cannot see.

Accuracy is reported per crop, not per class. Per class would weight a product that appears
twice as heavily as one that appears fifteen hundred times, and the cart contains instances.

    server/.venv/bin/python server/eval/score_grocer.py --limit 4000
    server/.venv/bin/python server/eval/score_grocer.py            # all 34k query crops
"""
import argparse
import collections
import hashlib
import json
import pathlib
import sys
import time

import numpy as np

HERE = pathlib.Path(__file__).parent
CACHE = HERE / ".cache" / "grocer"
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))

from catalog import matcher as matcher_module  # noqa: E402
from catalog.matcher import Index, Matcher  # noqa: E402


def query_crops(limit=None, seed="grocer"):
    """Every query crop as (path, true class name), optionally a deterministic subsample.

    Subsampling is by a hash of the file's own name rather than by `random.sample`, so a run
    with --limit 4000 draws a subset of the same crops a run with --limit 8000 draws, and the
    two are directly comparable. A shuffled sample would make every pair of runs differ by both
    the change under test and the draw.
    """
    root = CACHE / "query"
    items = []
    for folder in sorted(p for p in root.iterdir() if p.is_dir()):
        for path in sorted(folder.glob("*.jpg")):
            items.append((path, folder.name))
    if limit is None or limit >= len(items):
        return items
    ranked = sorted(
        items, key=lambda it: hashlib.md5(f"{seed}/{it[0].name}".encode()).hexdigest()
    )
    return sorted(ranked[:limit])


def build_or_load(index_path, encoders, finetune_epochs, log=print):
    """The index, rebuilt only when there is no cached one for this configuration."""
    if index_path.exists():
        log(f"loading cached index {index_path.name}")
        return Index.load(index_path)
    log(f"building index from {CACHE / 'catalog'}")
    started = time.time()
    index = Index.build(
        CACHE / "catalog", encoder=encoders, finetune_epochs=finetune_epochs, log=log
    )
    index.save(index_path)
    log(f"  built in {time.time() - started:.0f}s")
    return index


def evaluate(matcher, items, chunk=64, log=print):
    """Match every query crop and collect the raw per-crop outcome.

    Crops are decoded in chunks and thrown away, not held: 34,883 crops at 320px is more decoded
    pixels than this machine has memory for, and the failure would arrive an hour into a run.
    """
    from PIL import Image

    known = set(matcher.index.skus)
    rows = []
    started = time.time()
    for start in range(0, len(items), chunk):
        batch = items[start : start + chunk]
        images = [Image.open(p).convert("RGB") for p, _ in batch]
        sizes = [im.size for im in images]
        results = matcher.match(images, detail=True)
        for (path, truth), size, result in zip(batch, sizes, results):
            # `alternatives` is the ranked head of the shortlist and includes the winner, so it
            # is top-N as it stands. Prepending `sku` would double-count the first slot and read
            # a point or two high.
            rows.append({
                "path": str(path),
                "truth": truth,
                "answerable": truth in known,
                "sku": result["sku"],
                "confidence": float(result["confidence"]),
                "shortlist": result["shortlist"],
                "alternatives": [a["sku"] for a in result["alternatives"]],
                "signals": result["signals"],
                "pixels": size,
            })
        if log and (start // chunk) % 20 == 0:
            done = min(start + chunk, len(items))
            rate = done / max(time.time() - started, 1e-6)
            log(f"  {done}/{len(items)} crops, {rate:.0f}/s, "
                f"eta {(len(items) - done) / max(rate, 1e-6) / 60:.0f}m")
    return rows


def report(rows, log=print):
    """Turn per-crop outcomes into the table, and say what each row excludes."""
    total = len(rows)
    answerable = [r for r in rows if r["answerable"]]
    top1 = sum(1 for r in answerable if r["sku"] == r["truth"])
    top5 = sum(1 for r in answerable if r["truth"] in r["alternatives"])
    ceiling = sum(1 for r in answerable if r["truth"] in r["shortlist"])
    declined = sum(1 for r in answerable if r["sku"] is None)
    silent = sum(1 for r in answerable if r["sku"] is not None and r["sku"] != r["truth"])

    n = max(len(answerable), 1)
    summary = {
        "query_crops": total,
        "answerable": len(answerable),
        "coverage": len(answerable) / max(total, 1),
        "top1": top1 / n,
        "top5": top5 / n,
        "shortlist_ceiling": ceiling / n,
        "declined": declined / n,
        "silent_error": silent / n,
    }
    log("")
    log(f"  query crops           {total}")
    log(f"  answerable            {len(answerable)}  ({summary['coverage']:.1%} of crops "
        f"belong to a class the catalog holds)")
    log(f"  top-1                 {summary['top1']:.1%}")
    log(f"  top-5                 {summary['top5']:.1%}")
    log(f"  shortlist ceiling     {summary['shortlist_ceiling']:.1%}")
    log(f"  declined              {summary['declined']:.1%}")
    log(f"  silent error          {summary['silent_error']:.1%}")

    # Crop size is the one property of a cart photograph the shopper controls, by standing
    # closer, so it is worth knowing where accuracy falls off rather than only the mean.
    log("")
    log("  by crop size (shorter edge, pixels)")
    buckets = [(0, 64), (64, 96), (96, 144), (144, 224), (224, 10_000)]
    for low, high in buckets:
        band = [r for r in answerable if low <= min(r["pixels"]) < high]
        if not band:
            continue
        hit = sum(1 for r in band if r["sku"] == r["truth"])
        log(f"    {low:4d}-{high if high < 10_000 else '  +':>4}  n={len(band):6d}  "
            f"top-1 {hit / len(band):.1%}")

    log("")
    log("  worst classes by instances lost")
    lost = collections.Counter()
    confused = collections.defaultdict(collections.Counter)
    for r in answerable:
        if r["sku"] != r["truth"]:
            lost[r["truth"]] += 1
            confused[r["truth"]][r["sku"]] += 1
    for name, count in lost.most_common(10):
        into = ", ".join(f"{k or 'declined'}x{v}" for k, v in confused[name].most_common(3))
        log(f"    {name:24s} {count:4d} lost   -> {into}")
    return summary


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=None,
                        help="score a deterministic subsample of this many crops")
    parser.add_argument("--encoders", default=",".join(matcher_module.DEFAULT_ENCODERS))
    parser.add_argument("--finetune-epochs", type=int, default=0)
    parser.add_argument("--tag", default=None, help="name for the cached index and the result")
    parser.add_argument("--no-tta", action="store_true",
                        help="one view per crop instead of five")
    parser.add_argument("--out", default=str(HERE / "grocer-score.json"))
    args = parser.parse_args(argv)

    encoders = [e for e in args.encoders.split(",") if e]
    tag = args.tag or "-".join(encoders) + (f"-ft{args.finetune_epochs}"
                                            if args.finetune_epochs else "")
    if args.no_tta:
        matcher_module.TTA_VIEWS = False
        tag += "-notta"

    if not (CACHE / "manifest.json").exists():
        raise SystemExit(
            f"no crop cache at {CACHE}. Run:  "
            f"cd server/eval && ../.venv/bin/python -m grocer.build"
        )
    manifest = json.loads((CACHE / "manifest.json").read_text())

    index = build_or_load(CACHE / f"index-{tag}.npz", encoders, args.finetune_epochs)
    matcher = Matcher(index)
    items = query_crops(args.limit)
    print(f"scoring {len(items)} crops against {len(index.skus)} catalog products")
    started = time.time()
    rows = evaluate(matcher, items)
    summary = report(rows)
    summary |= {
        "tag": tag,
        "encoders": encoders,
        "finetune_epochs": args.finetune_epochs,
        "tta": not args.no_tta,
        "catalog_products": len(index.skus),
        "seconds": round(time.time() - started, 1),
        "corpus": manifest,
    }
    out = pathlib.Path(args.out)
    existing = json.loads(out.read_text()) if out.exists() else {}
    existing[tag] = summary
    out.write_text(json.dumps(existing, indent=1))

    # Every per-crop outcome, not only the summary. Two runs are rarely comparable head to head
    # here, because a change to the reference set changes which classes clear MIN_REFERENCES and
    # therefore which crops are answerable at all. Keeping the rows means that comparison can be
    # made afterwards on the classes both runs held, instead of being asserted.
    rows_path = CACHE / f"rows-{tag}.json"
    rows_path.write_text(json.dumps(rows))
    print(f"\nwrote {out}")
    print(f"wrote {rows_path}  ({len(rows)} per-crop outcomes)")
    return summary


if __name__ == "__main__":
    main()
