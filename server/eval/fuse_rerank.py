"""
Combines the reranker signals score_rerank.py measured, and reports what it costs to be sure.

Each signal is a different kind of evidence and they fail differently: an image-text encoder
knows what a thing is, a self-supervised encoder knows which particular thing it is, and
keypoint geometry knows whether two pictures can be the same physical object at all. Fusing
them should beat any one of them, and the point of this script is to check that rather than
assume it.

Weights are fit by two-fold cross-validation split on scene, never on query, so no crop from a
scene used to choose the weights is ever scored by them. Splitting on query would leak: two
crops from one photograph share lighting, camera, and often the product.

The last table is the one the product needs. A name the shopper has to correct is worse than a
name the app declined to guess, so what matters is not only accuracy but how well the reranker
knows when it is wrong. Coverage is the fraction of items confident enough to auto-add; the
remainder is what the interface would show as alternatives.

    python3 server/eval/fuse_rerank.py
"""
import itertools
import json
import pathlib
import sys

import numpy as np

HERE = pathlib.Path(__file__).parent
CACHE = HERE / ".cache"
sys.path.insert(0, str(HERE.parent))

from catalog import rank  # noqa: E402
STEP = 0.1  # weight grid resolution
TIERS = ("easy", "medium", "hard")


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


def fit_logistic(x, y, steps=400, lr=0.5):
    """One-dimensional logistic regression, fit by gradient descent.

    The product needs a probability, not a score. "0.83" shown to a shopper has to mean the
    name is right about 83 times in a hundred, or the threshold that decides whether an item is
    added silently or offered as a choice is set on a number that means nothing. Two parameters
    on one feature is all the data here can support without overfitting, and hand-rolling it
    avoids adding scikit-learn to a service that otherwise needs numpy and OpenCV.
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
        rows_in = np.flatnonzero((prob >= lo) & (prob < hi))
        if not len(rows_in):
            continue
        said, was = float(prob[rows_in].mean()), float(correct[rows_in].mean())
        rows.append((len(rows_in), said, was))
        gap += len(rows_in) * abs(said - was)
    return rows, gap / len(prob)


def accuracy(stack, weights, shortlist, want, rows):
    fused = np.tensordot(weights, stack[:, rows], axes=(0, 0))
    picked = shortlist[rows, fused.argmax(axis=1)]
    return float((picked == want[rows]).mean())


def main():
    data = np.load(CACHE / "signals.npz", allow_pickle=True)
    shortlist, want = data["shortlist"], data["want"]
    tier, scene = data["tier"], data["scene"]
    names = [k for k in data.files if k not in ("shortlist", "want", "tier", "scene")]
    n = len(want)

    # Geometry is a count with a long tail; the encoders are bounded similarities. Logging the
    # count before standardizing keeps one candidate with four hundred inliers from swamping the
    # rest of the evidence, without discarding the fact that it matched far better.
    stack = np.stack(
        [rank.standardize(data[k], log=(k == "geometry")) for k in names]
    )

    ceiling = float((shortlist == want[:, None]).any(axis=1).mean())
    print(f"{n} queries, shortlist of {shortlist.shape[1]}, ceiling {ceiling:.1%}")
    print(f"signals: {', '.join(names)}\n")

    print("Each signal alone, choosing from the shortlist:")
    print(f"{'signal':>12}{'R@1':>8}")
    print("-" * 20)
    for i, name in enumerate(names):
        picked = shortlist[np.arange(n), stack[i].argmax(axis=1)]
        print(f"{name:>12}{float((picked == want).mean()):>8.1%}")

    # ---- fusion, cross-fit on scene ------------------------------------------------------
    scenes = sorted(set(scene.tolist()))
    fold_of_scene = {s: i % 2 for i, s in enumerate(scenes)}
    fold = np.array([fold_of_scene[s] for s in scene.tolist()])

    grid = list(weight_grid(len(names)))
    fused_pick = np.zeros(n, dtype=shortlist.dtype)
    fused_score = np.zeros_like(stack[0])
    chosen = []
    for held in (0, 1):
        fit_rows = np.flatnonzero(fold != held)
        test_rows = np.flatnonzero(fold == held)
        best = max(grid, key=lambda w: accuracy(stack, w, shortlist, want, fit_rows))
        chosen.append(best)
        scores = np.tensordot(best, stack[:, test_rows], axes=(0, 0))
        fused_pick[test_rows] = shortlist[test_rows, scores.argmax(axis=1)]
        fused_score[test_rows] = scores

    print("\nFused, weights fit on the other half of the scenes:")
    for held, w in enumerate(chosen):
        print(f"  fold {held}: " + "  ".join(f"{k} {v:.1f}" for k, v in zip(names, w)))

    baseline = shortlist[:, 0]
    print(f"\n{'tier':8}{'queries':>9}{'before':>9}{'after':>9}{'gain':>8}{'ceiling':>9}")
    print("-" * 52)
    for name in TIERS + ("ALL",):
        rows = np.arange(n) if name == "ALL" else np.flatnonzero(tier == name)
        if not len(rows):
            continue
        before = float((baseline[rows] == want[rows]).mean())
        after = float((fused_pick[rows] == want[rows]).mean())
        top = float((shortlist[rows] == want[rows, None]).any(axis=1).mean())
        gain = (after - before) * 100
        print(f"{name:8}{len(rows):>9}{before:>9.1%}{after:>9.1%}{gain:>+8.1f}{top:>9.1%}")

    # ---- how well does it know when it is wrong? -----------------------------------------
    margin = rank.margin(fused_score)
    correct = (fused_pick == want).astype(float)

    # Calibrated on the other half of the scenes, same folds as the weights, for the same
    # reason: a confidence fitted on the items it then scores reads far better than it is.
    prob = np.zeros(n)
    coefficients = []
    for held in (0, 1):
        fit_rows = np.flatnonzero(fold != held)
        test_rows = np.flatnonzero(fold == held)
        w, b = fit_logistic(margin[fit_rows], correct[fit_rows])
        coefficients.append((w, b))
        prob[test_rows] = rank.confidence(margin[test_rows], (w, b))

    print("\nConfidence, thresholded on the first-to-second margin:")
    print(f"{'coverage':>10}{'accuracy':>10}{'deferred':>10}")
    print("-" * 30)
    rows_by_margin = np.argsort(-margin)
    for coverage in (1.0, 0.9, 0.75, 0.5, 0.25):
        take = rows_by_margin[: max(1, int(round(coverage * n)))]
        print(f"{coverage:>10.0%}{float(correct[take].mean()):>10.1%}{n - len(take):>10}")
    print("\nDeferred items are not failures: they are the ones the interface shows as a short")
    print("list of alternatives instead of adding silently.")

    rows, ece = reliability(prob, correct)
    print("\nIs the number it reports true? Predicted against observed, held-out:")
    print(f"{'items':>8}{'says':>8}{'is':>8}")
    print("-" * 24)
    for count, said, was in rows:
        print(f"{count:>8}{said:>8.0%}{was:>8.0%}")
    print(f"average gap between what it says and what it is: {ece:.1%}")
    print("logistic on margin, per fold: " + "  ".join(f"w {w:.2f} b {b:.2f}" for w, b in coefficients))

    (HERE / "rerank-score.json").write_text(
        json.dumps(
            {
                "queries": int(n),
                "shortlist": int(shortlist.shape[1]),
                "ceiling": ceiling,
                "signals": names,
                "weights": [w.tolist() for w in chosen],
                "before": float((baseline == want).mean()),
                "after": float(correct.mean()),
                "calibration": {"coefficients": coefficients, "gap": ece},
                "by_tier": {
                    t: {
                        "n": int((tier == t).sum()),
                        "before": float((baseline[tier == t] == want[tier == t]).mean()),
                        "after": float((fused_pick[tier == t] == want[tier == t]).mean()),
                    }
                    for t in TIERS
                    if (tier == t).any()
                },
            },
            indent=1,
        )
    )


if __name__ == "__main__":
    main()
