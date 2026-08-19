"""
What does training on the store's own catalog buy, over looking things up in it?

Every catalog number so far comes from nearest-neighbour retrieval: embed the crop, embed the
catalog, compare. That treats the catalog as a lookup table. But the premise of the whole
design is that the catalog is the complete set of possible answers, and a complete set of
answers is a classification problem, not a retrieval one. A classifier gets to learn what
separates SKU 41 from SKU 42, which retrieval never sees.

Three ways of using the same frozen features, so the comparison is only about the head:

  nearest      what ships today: best matching catalog crop wins
  prototype    mean embedding per SKU, no training at all
  linear       a cosine classifier trained on the catalog, which is the "fine-tune for this
               store" the closed-world assumption implies

Nothing here retrains the encoder. The features are the cached ones, so a run is seconds and
the comparison is clean. If the head is worth points, fine-tuning the encoder is worth trying
next; if it is not, that saves the attempt.

Held-out crops from the catalog choose when to stop training. The 465 query crops come from
RPC's test split and are touched exactly once, at the end.

    python3 server/eval/score_probe.py --encoder mobileclip
"""
import argparse
import json
import pathlib
import sys

import numpy as np

HERE = pathlib.Path(__file__).parent
CACHE = HERE / ".cache"
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))

from catalog import head as head_module  # noqa: E402

TIERS = ("easy", "medium", "hard")
VALIDATION_FRACTION = 0.1


def combined(spec, cache):
    """Features from one encoder, or several concatenated and renormalized.

    Concatenating before the head is the cheapest ensemble available: the classifier learns how
    far to trust each encoder for each individual SKU, rather than one global weight applied to
    every product. Every part arrives L2-normalized, so they start out weighted equally and the
    head moves from there.
    """
    from rerank_features import features

    parts = [features(name, cache) for name in spec.split("+")]
    if len(parts) == 1:
        return parts[0]
    catalog = np.concatenate([p[0] for p in parts], axis=1)
    queries = np.concatenate([p[1] for p in parts], axis=1)
    catalog /= np.linalg.norm(catalog, axis=1, keepdims=True) + 1e-9
    queries /= np.linalg.norm(queries, axis=1, keepdims=True) + 1e-9
    return catalog.astype(np.float32), queries.astype(np.float32)


def report(name, scores, want, tier):
    order = np.argsort(-scores, axis=1)
    hit1 = order[:, 0] == want
    hit5 = (order[:, :5] == want[:, None]).any(axis=1)
    parts = [f"{name:>12}"]
    for t in TIERS:
        rows = tier == t
        parts.append(f"{hit1[rows].mean():>8.1%}")
    parts.append(f"{hit1.mean():>9.1%}{hit5.mean():>9.1%}")
    print("".join(parts))
    return float(hit1.mean()), float(hit5.mean())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--encoder", default="mobileclip", help="one name, or several joined by +")
    parser.add_argument("--epochs", type=int, default=60)
    # Subsamples the cached catalog rather than re-cropping, so the depth question costs
    # nothing to ask. What a store has to photograph is the most expensive requirement in the
    # design, and it should be set by measurement rather than by whatever RPC happened to ship.
    parser.add_argument("--per-sku", type=int, default=0, help="0 uses the whole catalog")
    args = parser.parse_args()

    meta = json.loads((CACHE / "index.json").read_text())
    sku_names = sorted(set(meta["catalog"]))
    sku_id = {n: i for i, n in enumerate(sku_names)}
    catalog_label = np.array([sku_id[n] for n in meta["catalog"]])
    want = np.array([sku_id[q["label"]] for q in meta["queries"]])
    tier = np.array([q["tier"] for q in meta["queries"]])

    catalog, queries = combined(args.encoder, CACHE)
    if args.per_sku:
        rng = np.random.default_rng(3)
        keep = np.concatenate(
            [
                rng.permutation(np.flatnonzero(catalog_label == sku))[: args.per_sku]
                for sku in range(len(sku_names))
            ]
        )
        catalog, catalog_label = catalog[keep], catalog_label[keep]
    print(f"{args.encoder}: {catalog.shape[0]} catalog crops, {len(sku_names)} SKUs, "
          f"{queries.shape[0]} queries, {catalog.shape[1]} dims\n")

    header = f"{'head':>12}" + "".join(f"{t:>8}" for t in TIERS) + f"{'ALL R@1':>9}{'R@5':>9}"
    print(header)
    print("-" * len(header))

    results = {}
    # ---- nearest neighbour, the shipped behaviour ----------------------------------------
    sims = queries @ catalog.T
    nearest = np.full((len(want), len(sku_names)), -np.inf, dtype=np.float32)
    for sku in range(len(sku_names)):
        nearest[:, sku] = sims[:, catalog_label == sku].max(axis=1)
    results["nearest"] = report("nearest", nearest, want, tier)

    # ---- prototypes, the cheapest possible head ------------------------------------------
    prototypes = head_module.prototypes(catalog, catalog_label, len(sku_names))
    results["prototype"] = report("prototype", queries @ prototypes.T, want, tier)

    # ---- a cosine classifier trained on the catalog --------------------------------------
    trained, held = head_module.train(
        catalog, catalog_label, len(sku_names), epochs=args.epochs
    )
    print(f"{'':>12}(held-out catalog accuracy {held:.1%})")
    results["linear"] = report("linear", queries @ trained.T, want, tier)

    np.save(CACHE / f"probe-{args.encoder.replace('+', '-')}.npy", trained)
    (HERE / f"probe-score-{args.encoder.replace('+', '-')}.json").write_text(
        json.dumps({"encoder": args.encoder, "results": results}, indent=1)
    )
    print("\nA head is only worth its retraining cost if it beats prototypes, which are free.")


if __name__ == "__main__":
    main()
