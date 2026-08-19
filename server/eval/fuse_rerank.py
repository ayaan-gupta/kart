"""
Combines the reranker signals score_rerank.py measured, and reports what it costs to be sure.

Each signal is a different kind of evidence and they fail differently: a trained head knows
which SKU the crop resembles across the whole catalog, colour knows which panel of the packet is
red, and keypoint geometry knows whether two pictures can be the same physical object at all.
Fusing them should beat any one of them, and the point of this script is to check that rather
than assume it.

Two things keep the number honest. Folds are split on scene, never on query, because two crops
from one photograph share lighting, camera and often the product, so splitting on query would
leak. And the weights are the average of the best few grid points rather than the single best:
one grid point chosen on a couple of hundred queries is fit to their noise, which showed up as
folds disagreeing about whether geometry deserved 0.6 or 0.2. Averaging shrinks that towards
whatever the good solutions have in common.

The last table is the one the product needs. A name the shopper has to correct is worse than a
name the app declined to guess, so what matters is not only accuracy but how well the reranker
knows when it is wrong. Coverage is the fraction of items confident enough to add silently; the
rest is what the interface offers as alternatives.

    python3 server/eval/fuse_rerank.py
"""
import argparse
import itertools
import json
import pathlib
import sys

import numpy as np

HERE = pathlib.Path(__file__).parent
CACHE = HERE / ".cache"
sys.path.insert(0, str(HERE.parent))

from catalog import rank  # noqa: E402

STEP = 0.1
TIERS = ("easy", "medium", "hard")


def fit_logistic(x, y, steps=400, lr=0.5):
    """One-dimensional logistic regression, fit by gradient descent.

    The product needs a probability, not a score. "0.83" shown to a shopper has to mean the name
    is right about 83 times in a hundred, or the threshold deciding whether an item is added
    silently or offered as a choice is set on a number that means nothing. Two parameters on one
    feature is all 465 queries can support, and hand-rolling it keeps scikit-learn out of a
    service that otherwise needs numpy and OpenCV.
    """
    w = b = 0.0
    for _ in range(steps):
        p = 1 / (1 + np.exp(-(w * x + b)))
        error = p - y
        w -= lr * float((error * x).mean())
        b -= lr * float(error.mean())
    return w, b


def reliability(prob, correct, bins=5):
    """Predicted probability against observed accuracy, and the gap between them."""
    edges = np.quantile(prob, np.linspace(0, 1, bins + 1))
    edges[-1] += 1e-9
    rows, gap = [], 0.0
    for lo, hi in zip(edges[:-1], edges[1:]):
        inside = np.flatnonzero((prob >= lo) & (prob < hi))
        if not len(inside):
            continue
        said, was = float(prob[inside].mean()), float(correct[inside].mean())
        rows.append((len(inside), said, was))
        gap += len(inside) * abs(said - was)
    return rows, gap / len(prob)


def candidate_features(data, names):
    """Per-candidate evidence, richer than the four standardized signals alone.

    A weighted sum of standardized signals can only say "geometry matters this much
    everywhere". It cannot use the fact that forty inliers is strong evidence in absolute terms
    however the rest of the shortlist scored, or that a candidate sitting fourth in a shortlist
    is a worse bet than one sitting first even when their fused scores tie. Both of those are
    real and both are cheap to hand a ranker.
    """
    columns, labels = [], []
    for name in names:
        raw = np.asarray(data[name], dtype=np.float64)
        columns.append(rank.standardize(raw, log=(name == "geometry")))
        labels.append(f"{name}:z")
        # How far behind the shortlist leader, in the signal's own units. Standardizing throws
        # this away by dividing out the spread, and the spread is itself informative: a
        # shortlist where everything scores alike is a shortlist to be unsure about.
        columns.append(raw - raw.max(axis=1, keepdims=True))
        labels.append(f"{name}:lag")
    columns.append(np.log1p(np.maximum(np.asarray(data["geometry"], dtype=np.float64), 0)))
    labels.append("geometry:absolute")
    slots = np.broadcast_to(
        np.arange(data["head"].shape[1], dtype=np.float64), data["head"].shape
    )
    columns.append(slots)
    labels.append("shortlist:slot")
    return np.stack(columns, axis=-1), labels


def fit_ranker(features, truth, rows, steps=600, lr=0.05, l2=1e-3, seed=5):
    """Listwise softmax ranker: score every candidate, softmax across the shortlist.

    The loss is cross-entropy against the correct slot, which is exactly the quantity being
    reported. Queries whose shortlist never contained the right answer are dropped from the
    loss, because there is nothing about them to learn, but they are still scored at test time
    where they can only be wrong.
    """
    import torch

    torch.manual_seed(seed)
    usable = rows[truth[rows] >= 0]
    x = torch.from_numpy(features[usable]).double()
    y = torch.from_numpy(truth[usable]).long()
    mean = x.reshape(-1, x.shape[-1]).mean(dim=0)
    spread = x.reshape(-1, x.shape[-1]).std(dim=0) + 1e-9
    weight = torch.zeros(x.shape[-1], dtype=torch.float64, requires_grad=True)
    optimizer = torch.optim.Adam([weight], lr=lr, weight_decay=l2)
    for _ in range(steps):
        logits = ((x - mean) / spread) @ weight
        loss = torch.nn.functional.cross_entropy(logits, y)
        optimizer.zero_grad()
        loss.backward()
        optimizer.step()
    return weight.detach().numpy(), mean.numpy(), spread.numpy()


def apply_ranker(features, fitted):
    weight, mean, spread = fitted
    return ((features - mean) / spread) @ weight

def weight_grid(n, step=STEP):
    """Every non-negative weighting of n signals summing to one, on a fixed grid."""
    steps = int(round(1 / step))
    for cut in itertools.combinations(range(steps + n - 1), n - 1):
        parts, previous = [], -1
        for c in cut:
            parts.append(c - previous - 1)
            previous = c
        parts.append(steps + n - 2 - previous)
        yield np.array(parts, dtype=np.float64) / steps


def accuracy(stack, weights, shortlist, want, rows):
    fused = np.tensordot(weights, stack[:, rows], axes=(0, 0))
    return float((shortlist[rows, fused.argmax(axis=1)] == want[rows]).mean())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--folds", type=int, default=4)
    parser.add_argument(
        "--shrink",
        type=int,
        default=10,
        help="average this many of the best grid points rather than taking one",
    )
    args = parser.parse_args()

    data = np.load(CACHE / "signals.npz", allow_pickle=True)
    shortlist, want = data["shortlist"], data["want"]
    tier, scene = data["tier"], data["scene"]
    names = [k for k in data.files if k not in ("shortlist", "want", "tier", "scene")]
    n = len(want)

    # Geometry is a count with a long tail; the rest are bounded similarities. Logging the count
    # before standardizing stops one candidate with four hundred inliers swamping the other
    # evidence, without discarding that it matched far better than the runner-up.
    stack = np.stack([rank.standardize(data[k], log=(k == "geometry")) for k in names])

    ceiling = float((shortlist == want[:, None]).any(axis=1).mean())
    print(f"{n} queries, shortlist of {shortlist.shape[1]}, ceiling {ceiling:.1%}")
    print(f"signals: {', '.join(names)}\n")

    print("Each signal alone, choosing from the shortlist:")
    print(f"{'signal':>12}{'R@1':>8}")
    print("-" * 20)
    for i, name in enumerate(names):
        picked = shortlist[np.arange(n), stack[i].argmax(axis=1)]
        print(f"{name:>12}{float((picked == want).mean()):>8.1%}")

    scenes = sorted(set(scene.tolist()))
    fold_of_scene = {s: i % args.folds for i, s in enumerate(scenes)}
    fold = np.array([fold_of_scene[s] for s in scene.tolist()])

    grid = list(weight_grid(len(names)))
    fused_pick = np.zeros(n, dtype=shortlist.dtype)
    fused_score = np.zeros_like(stack[0])
    prob = np.zeros(n)
    chosen, calibrations = [], []

    for held in range(args.folds):
        fit_rows = np.flatnonzero(fold != held)
        test_rows = np.flatnonzero(fold == held)
        scored = sorted(
            grid, key=lambda w: -accuracy(stack, w, shortlist, want, fit_rows)
        )
        weights = np.mean(scored[: args.shrink], axis=0)
        chosen.append(weights)

        fused = np.tensordot(weights, stack[:, test_rows], axes=(0, 0))
        fused_pick[test_rows] = shortlist[test_rows, fused.argmax(axis=1)]
        fused_score[test_rows] = fused

        # Calibration is fit on the same held-out split as the weights, for the same reason: a
        # confidence fitted on the items it then scores reads far better than it is.
        fit_fused = np.tensordot(weights, stack[:, fit_rows], axes=(0, 0))
        fit_correct = (
            shortlist[fit_rows, fit_fused.argmax(axis=1)] == want[fit_rows]
        ).astype(float)
        coefficients = fit_logistic(rank.margin(fit_fused), fit_correct)
        calibrations.append(coefficients)
        prob[test_rows] = rank.confidence(rank.margin(fused), coefficients)

    # A second fusion, for comparison. The weighted sum above can only say how much each signal
    # matters on average; this one can also use how far behind the leader a candidate sits, how
    # many keypoints it matched in absolute terms, and where it started in the shortlist.
    stacked, feature_names = candidate_features(data, names)
    truth = np.where(
        (shortlist == want[:, None]).any(axis=1), (shortlist == want[:, None]).argmax(axis=1), -1
    )
    ranked_pick = np.zeros(n, dtype=shortlist.dtype)
    for held in range(args.folds):
        fitted = fit_ranker(stacked, truth, np.flatnonzero(fold != held))
        test_rows = np.flatnonzero(fold == held)
        scored = apply_ranker(stacked[test_rows], fitted)
        ranked_pick[test_rows] = shortlist[test_rows, scored.argmax(axis=1)]
    ranked_right = float((ranked_pick == want).mean())

    weights = np.mean(chosen, axis=0)
    spread = np.std(chosen, axis=0)
    print(f"\nFused, {args.folds}-fold cross-validated on scene. Weights, mean across folds:")
    for name, mean, sd in zip(names, weights, spread):
        print(f"  {name:>10} {mean:.2f}  (spread {sd:.2f})")

    correct = (fused_pick == want).astype(float)
    baseline = shortlist[:, 0]
    print(f"\n{'tier':8}{'queries':>9}{'before':>9}{'after':>9}{'gain':>8}{'ceiling':>9}")
    print("-" * 52)
    for name in TIERS + ("ALL",):
        rows = np.arange(n) if name == "ALL" else np.flatnonzero(tier == name)
        if not len(rows):
            continue
        before = float((baseline[rows] == want[rows]).mean())
        after = float(correct[rows].mean())
        top = float((shortlist[rows] == want[rows, None]).any(axis=1).mean())
        print(f"{name:8}{len(rows):>9}{before:>9.1%}{after:>9.1%}"
              f"{(after - before) * 100:>+8.1f}{top:>9.1%}")

    print(f"\nlistwise ranker over {len(feature_names)} candidate features, same folds: "
          f"{ranked_right:.1%}")
    print("features: " + ", ".join(feature_names))

    print("\nConfidence, thresholded on the first-to-second margin:")
    print(f"{'coverage':>10}{'accuracy':>10}{'deferred':>10}")
    print("-" * 30)
    by_margin = np.argsort(-rank.margin(fused_score))
    for coverage in (1.0, 0.9, 0.75, 0.5, 0.25):
        take = by_margin[: max(1, int(round(coverage * n)))]
        print(f"{coverage:>10.0%}{float(correct[take].mean()):>10.1%}{n - len(take):>10}")
    print("\nDeferred items are not failures: they are the ones the interface offers as a short")
    print("list of alternatives instead of adding silently.")

    rows, gap = reliability(prob, correct)
    print("\nIs the number it reports true? Predicted against observed, held-out:")
    print(f"{'items':>8}{'says':>8}{'is':>8}")
    print("-" * 24)
    for count, said, was in rows:
        print(f"{count:>8}{said:>8.0%}{was:>8.0%}")
    print(f"average gap between what it says and what it is: {gap:.1%}")

    calibration = np.mean(calibrations, axis=0)
    print(f"logistic on margin, mean across folds: w {calibration[0]:.2f} b {calibration[1]:.2f}")

    # Where to put the threshold is a product decision, but it should be made on evidence
    # rather than on a round number. Given a tolerance for wrong names added silently, this is
    # the confidence floor that meets it and the share of items that clear it.
    print("\nChoosing the floor: what each tolerance for a silent mistake costs in coverage.")
    print(f"{'want':>8}{'floor':>8}{'covers':>9}{'actual':>9}{'asks about':>12}")
    print("-" * 46)
    floors = np.unique(np.round(prob, 2))
    for target in (0.90, 0.95, 0.98):
        pick = None
        for floor in floors:
            taken = prob >= floor
            if taken.sum() and correct[taken].mean() >= target:
                pick = (floor, taken.mean(), correct[taken].mean(), int((~taken).sum()))
                break
        if pick is None:
            print(f"{target:>8.0%}{'unreachable at any floor':>38}")
        else:
            floor, covers, actual, asks = pick
            print(f"{target:>8.0%}{floor:>8.2f}{covers:>9.1%}{actual:>9.1%}{asks:>12}")
    print("An item below the floor is not lost. It is the one the shopper is asked about.")

    score_path = HERE / "rerank-score.json"
    previous = json.loads(score_path.read_text()) if score_path.exists() else {}
    previous.update(
        {
            "signals": names,
            "folds": args.folds,
            "weights": dict(zip(names, weights.round(3).tolist())),
            "weight_spread": dict(zip(names, spread.round(3).tolist())),
            "calibration": calibration.round(3).tolist(),
            "calibration_gap": gap,
            "before": float((baseline == want).mean()),
            "after": float(correct.mean()),
            "listwise": ranked_right,
            "by_tier": {
                t: {
                    "n": int((tier == t).sum()),
                    "before": float((baseline[tier == t] == want[tier == t]).mean()),
                    "after": float(correct[tier == t].mean()),
                }
                for t in TIERS
                if (tier == t).any()
            },
        }
    )
    score_path.write_text(json.dumps(previous, indent=1))


if __name__ == "__main__":
    main()
