"""
Does the matcher know when the thing in front of it is not in the catalog at all?

Every number in CATALOG.md is measured on queries whose answer is definitely present. That is
the closed-world assumption paying out, and it is also the assumption's entire bill: nothing so
far says what happens when a crop has no right answer. In a real cart that case is not rare and
not exotic. It is the detector proposing a trolley strut, a hand, a shopper's own bag, or a
product this branch does not stock.

RPC cannot supply a trolley strut, so this uses the closest proxy available: twenty of the two
hundred SKUs are withheld from the catalog entirely, the head is trained on the remaining one
hundred and eighty, and the queries belonging to the withheld twenty become items with no right
answer. That is a *generous* proxy, because a withheld SKU still looks like a grocery product
photographed the same way, where a trolley strut does not. Read the numbers below as an upper
bound on how well this works, not an estimate.

What matters is whether the confidence separates the two groups, because that is what the floor
acts on. An item with no right answer should fall below the floor and be asked about.

    python3 server/eval/score_openset.py --encoder siglipb16
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

from catalog import head as head_module, matcher as matcher_module, rank  # noqa: E402
from score_rerank import group_index  # noqa: E402


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--encoder", default="siglipb16")
    parser.add_argument("--holdout", type=int, default=20, help="SKUs withheld from the catalog")
    parser.add_argument("--seed", type=int, default=13)
    args = parser.parse_args()

    if not (CACHE / "index.json").exists():
        sys.exit("no cache; run server/eval/build_cache.py first")
    meta = json.loads((CACHE / "index.json").read_text())

    from catalog.geometry import describe, inliers
    from rerank_features import features

    all_skus = sorted(set(meta["catalog"]))
    sku_id = {name: i for i, name in enumerate(all_skus)}
    crop_sku = np.array([sku_id[n] for n in meta["catalog"]])
    query_sku = np.array([sku_id[q["label"]] for q in meta["queries"]])

    rng = np.random.default_rng(args.seed)
    withheld = set(rng.choice(len(all_skus), size=args.holdout, replace=False).tolist())
    kept = [s for s in range(len(all_skus)) if s not in withheld]
    remap = {s: i for i, s in enumerate(kept)}

    catalog, queries = features(args.encoder, CACHE)
    color_catalog, color_queries = features("color", CACHE)
    keep_rows = np.flatnonzero(np.isin(crop_sku, kept))
    reduced_labels = np.array([remap[s] for s in crop_sku[keep_rows]])

    print(f"catalog: {len(kept)} SKUs kept, {args.holdout} withheld")
    weight, held = head_module.train(catalog[keep_rows], reduced_labels, len(kept))
    print(f"head trained, held-out catalog accuracy {held:.1%}")

    trained = head_module.score(queries, weight)
    similarity = queries @ catalog[keep_rows].T
    color_similarity = color_queries @ color_catalog[keep_rows].T
    index, mask = group_index(reduced_labels, len(kept))
    nearest = np.stack([np.where(mask, row[index], -np.inf).max(axis=1) for row in similarity])

    K = matcher_module.SHORTLIST
    order = rank.shortlist(trained, K)

    catalog_paths = sorted((CACHE / "catalog").glob("*.jpg"))
    query_paths = sorted((CACHE / "queries").glob("*.jpg"))
    pair_path = CACHE / "geometry-pairs.json"
    pairs = json.loads(pair_path.read_text()) if pair_path.exists() else {}
    described = {}

    def describe_cached(path):
        key = str(path)
        if key not in described:
            described[key] = describe(path)
        return described[key]

    confidence = np.zeros(len(query_sku))
    chosen = np.zeros(len(query_sku), dtype=np.int64)
    # Absolute evidence, kept alongside the relative kind. The margin asks which of these
    # candidates it is; these ask whether it is any of them, and that is a different question
    # with a different answer whenever the crop is of something the catalog does not contain.
    absolute_head = np.zeros(len(query_sku))
    absolute_geometry = np.zeros(len(query_sku))
    for q in range(len(query_sku)):
        row = order[q]
        # Two index spaces, and conflating them is silent rather than loud. `similarity` and
        # `color_similarity` have one column per *kept* crop, while the image files are named by
        # position in the full catalog. Reference picks are made in the reduced space and
        # translated only where a path is needed.
        refs = []
        for sku in row:
            members = index[sku][mask[sku]]
            refs.append(
                members[np.argsort(-similarity[q, members])[: matcher_module.REFERENCES]]
            )
        counts = np.zeros(K)
        for slot in range(min(matcher_module.GEOMETRY_TOP, K)):
            best = 0
            for crop in dict.fromkeys(int(keep_rows[c]) for c in refs[slot]):
                key = f"{q}:{crop}"
                if key not in pairs:
                    pairs[key] = inliers(
                        describe_cached(query_paths[q]), describe_cached(catalog_paths[crop])
                    )
                best = max(best, pairs[key])
            counts[slot] = best
        signals = {
            "head": rank.standardize(trained[q, row]),
            "nearest": rank.standardize(nearest[q, row]),
            "color": rank.standardize(
                np.array([color_similarity[q, r].max() for r in refs])
            ),
            "geometry": rank.standardize(counts, log=True),
        }
        fused = rank.fuse(signals, matcher_module.FUSION)
        confidence[q] = rank.confidence(
            rank.margin(fused[None, :])[0], matcher_module.CALIBRATION
        )
        winner = int(fused.argmax())
        chosen[q] = kept[row[winner]]
        absolute_head[q] = float(trained[q, row].max())
        absolute_geometry[q] = float(counts.max())
        if q % 100 == 0:
            print(f"    {q}/{len(query_sku)}", flush=True)
    pair_path.write_text(json.dumps(pairs))

    outside = np.isin(query_sku, list(withheld))
    inside = ~outside
    right = (chosen == query_sku) & inside

    print(f"\n{inside.sum()} queries whose product is in the catalog, "
          f"{outside.sum()} whose product was withheld\n")
    print(f"median confidence, in catalog:  {np.median(confidence[inside]):.2f}")
    print(f"median confidence, not in it:   {np.median(confidence[outside]):.2f}")

    print(f"\n{'floor':>7}{'declines the absent':>21}{'wrongly declines':>18}"
          f"{'accepted accuracy':>19}")
    print("-" * 65)
    for floor in (0.4, matcher_module.FLOOR, 0.7, 0.8, 0.9):
        accepted = confidence >= floor
        caught = float((~accepted)[outside].mean()) if outside.any() else 0.0
        lost = float((~accepted)[inside].mean())
        taken = accepted & inside
        # Accuracy over everything accepted, counting an accepted absent product as wrong,
        # because that is exactly what it is to the shopper: an item they did not buy.
        accepted_right = right[accepted].sum() / max(accepted.sum(), 1)
        label = f"{floor:.2f}" + (" *" if floor == matcher_module.FLOOR else "")
        print(f"{label:>7}{caught:>20.0%}{lost:>18.0%}{accepted_right:>19.0%}"
              f"   ({taken.sum()} kept)")
    print("\n* the shipped floor. Withheld products are a generous stand-in for the real case,")
    print("which is a trolley strut or a hand, so treat these as an upper bound.")

    def separation(score):
        """Probability that a present product scores above an absent one, ranked at random.

        The area under the ROC curve, computed from ranks rather than by sweeping thresholds.
        0.5 is a coin toss. It is the right summary here because what matters is whether the
        two groups can be told apart at all, not the accuracy at any one cut point.
        """
        order_all = np.argsort(score)
        ranks = np.empty(len(score))
        ranks[order_all] = np.arange(1, len(score) + 1)
        positives, negatives = inside.sum(), outside.sum()
        return (ranks[inside].sum() - positives * (positives + 1) / 2) / (positives * negatives)

    print("\nTelling an absent product from a present one. Which evidence actually does it:")
    print(f"{'signal':>26}{'separation':>12}")
    print("-" * 38)
    candidates = {
        "confidence (margin)": confidence,
        "head score, absolute": absolute_head,
        "keypoint inliers, absolute": absolute_geometry,
    }
    for name, values in candidates.items():
        print(f"{name:>26}{separation(values):>12.3f}")

    # Whether the absolute signals add anything the margin does not already carry. Fitted and
    # scored on opposite halves of the scenes, because a rule fitted on the items it then
    # judges will always look like it separates them.
    scenes = sorted({q["scene"] for q in meta["queries"]})
    fold_of = {s: i % 2 for i, s in enumerate(scenes)}
    fold = np.array([fold_of[q["scene"]] for q in meta["queries"]])
    stacked = np.stack([confidence, absolute_head, np.log1p(absolute_geometry)], axis=1)
    stacked = (stacked - stacked.mean(axis=0)) / (stacked.std(axis=0) + 1e-9)
    combined = np.zeros(len(query_sku))
    for held in (0, 1):
        fit = fold != held
        w = np.zeros(stacked.shape[1])
        b = 0.0
        for _ in range(2000):
            prediction = 1 / (1 + np.exp(-(stacked[fit] @ w + b)))
            error = prediction - inside[fit].astype(float)
            w -= 0.5 * (stacked[fit] * error[:, None]).mean(axis=0)
            b -= 0.5 * error.mean()
        combined[fold == held] = stacked[fold == held] @ w + b
    print(f"{'all three, held out':>26}{separation(combined):>12.3f}")
    print("\nA margin says which candidate, not whether any of them. If the absolute signals")
    print("separate better, the floor is being asked the wrong question.")

    (HERE / "openset-score.json").write_text(
        json.dumps(
            {
                "encoder": args.encoder,
                "withheld_skus": args.holdout,
                "queries_inside": int(inside.sum()),
                "queries_outside": int(outside.sum()),
                "median_confidence_inside": float(np.median(confidence[inside])),
                "median_confidence_outside": float(np.median(confidence[outside])),
                "floor": matcher_module.FLOOR,
                "declines_absent": float((confidence < matcher_module.FLOOR)[outside].mean()),
                "wrongly_declines": float((confidence < matcher_module.FLOOR)[inside].mean()),
            },
            indent=1,
        )
    )


if __name__ == "__main__":
    main()
