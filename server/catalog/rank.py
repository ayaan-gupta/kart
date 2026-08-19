"""
Shortlist, fusion, and a confidence that means what it says.

The shape of the problem, measured rather than assumed: a catalog-trained head puts the right
SKU first 73.8% of the time and inside the top five 91.0% of the time. Those 17 points are the
reranker's whole budget, and they are largest on exactly the crowded scenes the product is worst
at, which is the opposite of how most accuracy aids behave.

The functions here are deliberately pure arithmetic over score arrays. They hold no models and
open no files, so the eval harness and the deployed service run identical code and the unit
tests cover the part where a mistake would be silent.

On the confidence: a number shown to a shopper has to be true. If the interface says 0.8 then
roughly four out of five of those names had better be right, because the threshold that decides
between adding an item silently and offering a choice is set on that number. So it is a logistic
fitted on the first-to-second margin, and its coefficients are measured on held-out scenes.
"""
import numpy as np


def shortlist(scores, k):
    """Indices of the k best-scoring SKUs per query, best first."""
    k = min(k, scores.shape[1])
    top = np.argpartition(-scores, k - 1, axis=1)[:, :k]
    ordered = np.take_along_axis(scores, top, axis=1).argsort(axis=1)[:, ::-1]
    return np.take_along_axis(top, ordered, axis=1)


def standardize(values, log=False):
    """Per-query standardization of one signal across the shortlist.

    The signals arrive on scales that cannot be compared. Cosine similarity sits in a narrow
    band near 0.7; inlier counts run from zero to several hundred and are zero for most
    candidates. Summing the raw numbers would hand the decision to whichever signal happens to
    have the widest range. Logging first is for the counts: one candidate matching four hundred
    keypoints should outrank one matching forty, but not by ten times the evidence.
    """
    values = np.asarray(values, dtype=np.float64)
    if log:
        values = np.log1p(np.maximum(values, 0))
    centred = values - values.mean(axis=-1, keepdims=True)
    return centred / (values.std(axis=-1, keepdims=True) + 1e-6)


def fuse(signals, weights):
    """Weighted sum of standardized signals. `signals` maps name to a per-shortlist array."""
    missing = [name for name in weights if name not in signals]
    if missing:
        raise KeyError(f"no signal supplied for {missing}")
    total = None
    for name, weight in weights.items():
        term = weight * signals[name]
        total = term if total is None else total + term
    return total


def margin(fused):
    """Gap between the best and second-best fused score. Undefined below two candidates."""
    if fused.shape[-1] < 2:
        return np.full(fused.shape[:-1], np.inf)
    ordered = np.sort(fused, axis=-1)[..., ::-1]
    return ordered[..., 0] - ordered[..., 1]


def confidence(gap, coefficients):
    """Calibrated probability that the top choice is right, from the margin.

    Two parameters on one feature. More would fit the noise in 465 queries, and the thing being
    predicted is binary and mostly explained by how far ahead the winner is.
    """
    slope, intercept = coefficients
    return 1 / (1 + np.exp(-(slope * np.asarray(gap, dtype=np.float64) + intercept)))


def decide(names, order, fused, coefficients, floor, alternatives=3):
    """The product-facing result for one crop.

    Returns the chosen SKU or None, its calibrated confidence, and the runners-up. Below the
    floor nothing is chosen: the interface offers the alternatives instead of adding an item
    the shopper then has to find and correct. A wrong name silently added costs more trust than
    a question asked, so the floor exists to be crossed rarely and honestly.
    """
    ranking = np.argsort(-fused)
    sure = float(confidence(margin(fused[None, :])[0], coefficients))
    ranked = [
        {"sku": names[order[i]], "score": float(fused[i])} for i in ranking[:alternatives]
    ]
    return {
        "sku": ranked[0]["sku"] if sure >= floor else None,
        "confidence": sure,
        "alternatives": ranked,
    }
