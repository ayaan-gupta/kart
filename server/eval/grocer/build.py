"""Cut the corpus into catalog and query crop directories, once.

    server/.venv/bin/python -m grocer.build            # from server/eval

Writes `server/eval/.cache/grocer/{catalog,query}/<class>/*.jpg` plus a manifest recording the
split, so a later run can tell whether it is comparable to an earlier one without re-reading
four gigabytes of photographs.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import time

from . import corpus

CACHE = pathlib.Path(__file__).resolve().parents[1] / ".cache" / "grocer"

# Twenty photographs per product is where the accuracy curve flattens, measured earlier on RPC
# and recorded in eval/CATALOG.md. Forty leaves headroom above the knee while keeping the
# commonest brands, which appear thousands of times in this corpus, from drowning the rare ones
# in the head's training set and in every mean the harness takes.
CATALOG_PER_CLASS = 60

# At most this many faces of one product from any single photograph. A shelf presents a dozen
# identical faces of the same soap, and twelve crops of one shelf are one observation of that
# product, not twelve, however many pixels they occupy.
CATALOG_PER_SCENE = 3


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=str(corpus.DEFAULT_ROOT))
    parser.add_argument("--out", default=str(CACHE))
    parser.add_argument("--catalog-share", type=float, default=0.6)
    parser.add_argument("--per-class", type=int, default=CATALOG_PER_CLASS)
    parser.add_argument("--per-scene", type=int, default=CATALOG_PER_SCENE)
    parser.add_argument("--min-side", type=int, default=32)
    parser.add_argument("--workers", type=int, default=8)
    args = parser.parse_args(argv)

    started = time.time()
    names = corpus.load_names(args.root)
    print(f"reading {args.root}")
    pool = corpus.scenes(args.root)
    catalog_scenes, query_scenes = corpus.split(pool, args.catalog_share)
    print(f"  {len(pool)} distinct photographs, "
          f"{sum(len(s.crops) for s in pool)} instances")
    print(f"  catalog side {len(catalog_scenes)} photographs, "
          f"query side {len(query_scenes)}")

    out = pathlib.Path(args.out)
    print("cutting catalog crops")
    catalog_counts = corpus.materialize(
        catalog_scenes, out / "catalog", names,
        min_side=args.min_side, max_per_class=args.per_class,
        max_per_scene=args.per_scene, workers=args.workers,
    )
    print("cutting query crops")
    query_counts = corpus.materialize(
        query_scenes, out / "query", names,
        min_side=args.min_side, max_per_class=None, workers=args.workers,
    )

    # A class the query side never asks about contributes nothing but a chance to be wrong, and
    # a class the catalog cannot describe cannot be answered at all. Both are recorded rather
    # than deleted, so the scoring harness decides what to do with them in the open.
    shared = sorted(set(catalog_counts) & set(query_counts))
    manifest = {
        "root": args.root,
        "catalog_share": args.catalog_share,
        "per_class_cap": args.per_class,
        "per_scene_cap": args.per_scene,
        "min_side": args.min_side,
        "photographs": len(pool),
        "catalog_photographs": len(catalog_scenes),
        "query_photographs": len(query_scenes),
        "catalog_crops": sum(catalog_counts.values()),
        "query_crops": sum(query_counts.values()),
        "catalog_classes": len(catalog_counts),
        "query_classes": len(query_counts),
        "shared_classes": len(shared),
        "query_crops_in_shared": sum(query_counts[c] for c in shared),
        "seconds": round(time.time() - started, 1),
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1))
    for key, value in manifest.items():
        print(f"  {key}: {value}")
    return manifest


if __name__ == "__main__":
    main()
