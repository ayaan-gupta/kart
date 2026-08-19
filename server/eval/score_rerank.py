"""
Bake-off: which reranker converts the shortlist into a first choice?

Stage one is a classifier trained on the store's own catalog (server/catalog/head.py), which is
where the largest measured gain lives. It puts the right SKU first 73.8% of the time and inside
the top five 91.0% of the time. Those 17 points are the reranker's entire budget.

Four signals are measured on the same 465 queries, over the same catalog:

  head       stage one's own score, carried through so fusion can weigh it against the rest
  nearest    the old best-matching-crop score, kept because it is free and may still add
  color      a colour-layout descriptor, which is the only signal here that is not greyscale
             and not globally pooled, so the only one that can see a flavour variant
  geometry   RootSIFT correspondences surviving a homography, which asks the strictest
             question available: can these two pictures be the same physical object

Reference crops for the last two are chosen by encoder similarity within the candidate SKU, so
each candidate is represented by its views that most resemble the query rather than by an
arbitrary few.

    python3 server/eval/build_cache.py     # once
    python3 server/eval/score_rerank.py
    python3 server/eval/fuse_rerank.py
"""
import argparse
import json
import pathlib
import sys
import time

import numpy as np

HERE = pathlib.Path(__file__).parent
CACHE = HERE / ".cache"
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))

from catalog import head as head_module  # noqa: E402
from catalog import rank  # noqa: E402

TIERS = ("easy", "medium", "hard")


def recall_at(scores, want, ks):
    order = np.argsort(-scores, axis=1)
    hit = order == want[:, None]
    return {k: float(hit[:, :k].any(axis=1).mean()) for k in ks}


def per_sku_max(sims, index, mask):
    """Best matching reference crop per SKU: the retrieval score this project shipped with."""
    return np.stack([np.where(mask, s[index], -np.inf).max(axis=1) for s in sims])


def group_index(sku_of_crop, classes):
    """Padded (classes, widest) crop-index table plus a validity mask."""
    per = [np.flatnonzero(sku_of_crop == s) for s in range(classes)]
    widest = max(len(p) for p in per)
    index = np.zeros((classes, widest), dtype=np.int64)
    mask = np.zeros((classes, widest), dtype=bool)
    for s, crops in enumerate(per):
        index[s, : len(crops)] = crops
        mask[s, : len(crops)] = True
    return index, mask


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--encoder", default="mobileclip")
    parser.add_argument("--shortlist", type=int, default=10)
    parser.add_argument("--refs", type=int, default=3, help="reference crops per candidate")
    parser.add_argument("--geo-top", type=int, default=8, help="shortlist depth given to SIFT")
    parser.add_argument("--skip-geometry", action="store_true")
    args = parser.parse_args()

    if not (CACHE / "index.json").exists():
        sys.exit("no cache; run server/eval/build_cache.py first")
    meta = json.loads((CACHE / "index.json").read_text())

    from rerank_features import features

    sku_names = sorted(set(meta["catalog"]))
    sku_id = {name: i for i, name in enumerate(sku_names)}
    sku_of_crop = np.array([sku_id[n] for n in meta["catalog"]])
    want = np.array([sku_id[q["label"]] for q in meta["queries"]])
    tier_of = np.array([q["tier"] for q in meta["queries"]])
    scene_of = np.array([q["scene"] for q in meta["queries"]])
    index, mask = group_index(sku_of_crop, len(sku_names))
    n = len(want)

    print(f"catalog: {len(meta['catalog'])} crops, {len(sku_names)} SKUs, "
          f"depth {meta['per_sku']}")
    print(f"queries: {n} crops\n")

    catalog, queries = features(args.encoder, CACHE)
    sims = queries @ catalog.T

    nearest = per_sku_max(sims, index, mask)
    weight, _ = head_module.train(
        catalog, sku_of_crop, len(sku_names), log=lambda m: print(f"  head: {m}")
    )
    trained = head_module.score(queries, weight)

    print(f"\nStage one, {args.encoder}:")
    print(f"{'':>10}{'R@1':>8}{'R@5':>8}{'R@10':>8}{'R@20':>8}")
    print("-" * 42)
    for label, scores in (("nearest", nearest), ("head", trained)):
        r = recall_at(scores, want, (1, 5, 10, 20))
        print(f"{label:>10}{r[1]:>8.1%}{r[5]:>8.1%}{r[10]:>8.1%}{r[20]:>8.1%}")

    K = args.shortlist
    order = rank.shortlist(trained, K)
    ceiling = float((order == want[:, None]).any(axis=1).mean())
    print(f"\nshortlist of {K}: ceiling {ceiling:.1%}. No reranker can beat that.\n")

    signals = {
        "head": np.take_along_axis(trained, order, axis=1),
        "nearest": np.take_along_axis(nearest, order, axis=1),
    }

    # Which reference crops represent each candidate. Chosen once and reused by both the colour
    # and the geometry signal, so the two are answering the same question about the same views.
    refs = np.zeros((n, K, args.refs), dtype=np.int64)
    for q in range(n):
        for slot in range(K):
            crops = index[order[q, slot]][mask[order[q, slot]]]
            picked = crops[np.argsort(-sims[q, crops])[: args.refs]]
            refs[q, slot, : len(picked)] = picked
            refs[q, slot, len(picked) :] = picked[-1] if len(picked) else 0

    # ---- colour ---------------------------------------------------------------------------
    color_catalog, color_queries = features("color", CACHE)
    color_sims = color_queries @ color_catalog.T
    signals["color"] = np.stack(
        [color_sims[q][refs[q]].max(axis=1) for q in range(n)]
    ).astype(np.float32)

    # ---- geometry -------------------------------------------------------------------------
    if not args.skip_geometry:
        from catalog.geometry import describe, inliers

        started = time.perf_counter()
        described = {}

        def describe_cached(path):
            key = str(path)
            if key not in described:
                described[key] = describe(path)
            return described[key]

        catalog_paths = sorted((CACHE / "catalog").glob("*.jpg"))
        query_paths = sorted((CACHE / "queries").glob("*.jpg"))
        # Inlier counts depend only on which two crops were compared, never on the shortlist
        # that proposed the pair, so they survive a change of encoder or shortlist width.
        # Persisting them turns a four-minute pass into seconds on a re-run.
        pair_path = CACHE / "geometry-pairs.json"
        pairs = json.loads(pair_path.read_text()) if pair_path.exists() else {}
        reused = len(pairs)

        geometry = np.zeros((n, K), dtype=np.float32)
        for q in range(n):
            query_kd = None
            for slot in range(min(args.geo_top, K)):
                best = 0
                for crop in dict.fromkeys(refs[q, slot].tolist()):
                    key = f"{q}:{crop}"
                    if key not in pairs:
                        if query_kd is None:
                            query_kd = describe_cached(query_paths[q])
                        pairs[key] = inliers(query_kd, describe_cached(catalog_paths[crop]))
                    best = max(best, pairs[key])
                geometry[q, slot] = best
            if q % 100 == 0:
                print(f"    geometry {q}/{n}", flush=True)
        pair_path.write_text(json.dumps(pairs))
        signals["geometry"] = geometry
        print(f"    {len(pairs) - reused} new pairs, {reused} reused, "
              f"{time.perf_counter() - started:.0f}s")

    print(f"\n{'signal':>10}{'alone':>8}   (choosing from the shortlist)")
    print("-" * 30)
    for name, values in signals.items():
        picked = order[np.arange(n), values.argmax(axis=1)]
        print(f"{name:>10}{float((picked == want).mean()):>8.1%}")

    np.savez(
        CACHE / "signals.npz",
        shortlist=order, want=want, tier=tier_of, scene=scene_of, **signals
    )
    (HERE / "rerank-score.json").write_text(
        json.dumps(
            {
                "encoder": args.encoder,
                "per_sku": meta["per_sku"],
                "queries": n,
                "skus": len(sku_names),
                "stage_one": {
                    "nearest": recall_at(nearest, want, (1, 5, 10, 20)),
                    "head": recall_at(trained, want, (1, 5, 10, 20)),
                },
                "shortlist": K,
                "ceiling": ceiling,
            },
            indent=1,
        )
    )
    print(f"\nsignals saved; run fuse_rerank.py to combine them.")


if __name__ == "__main__":
    main()
