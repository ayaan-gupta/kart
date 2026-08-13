import { productKey } from "../src/schemas.js";

export type TruthItem = {
  name: string;
  brand: string | null;
  qty: number;
  occluded: boolean;
};

export type PredictedItem = { name: string; brand: string | null };

export type ImageScore = {
  precision: number;
  recall: number;
  matched: string[];
  missed: string[];
  hallucinated: string[];
};

/**
 * Set-based precision and recall over product keys.
 *
 * Quantity is deliberately not scored here. It depends on the tracker, which does not exist
 * in this plan, so scoring it now would measure nothing real.
 *
 * Because matching is by productKey (brand plus name), a predicted item that gets the name
 * right but the brand wrong (or vice versa) does not partially match, it produces a distinct
 * key from the truth item. That key is simultaneously a miss (the true item's key was never
 * predicted) and a hallucination (the predicted item's key does not exist in truth). This is
 * deliberate: silently crediting a wrong brand as a hit would flatter the model.
 *
 * Both predicted and truth are read into Sets before comparison, so duplicate entries, or
 * distinct entries that collide on the same productKey, collapse to one. This means qty is
 * not just unscored, presence is genuinely all that counts: two ground-truth line items that
 * key identically are one requirement to satisfy, not two, and two predicted items that key
 * identically are one claim, not two.
 *
 * `occluded` on TruthItem is intentionally not read here. Every ground-truth item, occluded
 * or not, is something a human could actually see (see corpus/README.md), so it counts
 * against recall the same as any other truth item; run-eval.ts additionally reports recall
 * with occluded items excluded, so both numbers are visible rather than one being picked
 * silently.
 */
export function scoreImage(predicted: PredictedItem[], truth: TruthItem[]): ImageScore {
  const predKeys = new Set(predicted.map((p) => productKey(p.name, p.brand)));
  const truthKeys = new Set(truth.map((t) => productKey(t.name, t.brand)));

  const matched = [...predKeys].filter((k) => truthKeys.has(k));
  const hallucinated = [...predKeys].filter((k) => !truthKeys.has(k));
  const missed = [...truthKeys].filter((k) => !predKeys.has(k));

  return {
    precision: predKeys.size === 0 ? 0 : matched.length / predKeys.size,
    recall: truthKeys.size === 0 ? 0 : matched.length / truthKeys.size,
    matched,
    missed,
    hallucinated,
  };
}

// ---------------------------------------------------------------------------
// Count accuracy
//
// scoreImage answers "did the model report this product at all", by design, on purpose, and
// it stays exactly as it is above. It cannot answer "did the model get the quantity right",
// which is the question the shipped bug (one bunch of bananas counted as several) actually
// turned on. scoreCounts is a separate, additional measurement for that question, over a
// separate signal (census.inViewCounts), so a caller that wants presence/absence and a
// caller that wants quantity accuracy each get a function that answers exactly one question.
// ---------------------------------------------------------------------------

/** One entry of the model's per-product in-view count, keyed the same way scoreImage keys things. */
export type PredictedCount = { productKey: string; count: number };

/**
 * One product key's full quantity comparison. `truthQty` or `predictedCount` is `null` when
 * that side has no entry for this key at all, which is itself a real result (see CountScore),
 * not something to default to zero and hide.
 */
export type CountComparison = {
  productKey: string;
  truthQty: number | null;
  predictedCount: number | null;
  /** predictedCount - truthQty. Positive means the model over-counted, negative means it
   * under-counted. Only set when both sides have an entry; null otherwise, so a missing side
   * is never silently treated as a count of zero. */
  signedError: number | null;
  exactMatch: boolean;
};

export type CountScore = {
  comparisons: CountComparison[];
  /** Keys with an entry on both sides, the only ones a signedError exists for. */
  totalCompared: number;
  exactMatches: number;
  /** Mean of signedError over `totalCompared` keys. Positive means net over-counting across
   * this image, negative means net under-counting. 0 when totalCompared is 0. */
  meanSignedError: number;
  /** Keys where predictedCount > truthQty: the specific failure mode this exists to catch. */
  overCounted: string[];
  /** Keys where predictedCount < truthQty. */
  underCounted: string[];
  /** Ground truth had a qty for this key, inViewCounts had no entry for it at all. */
  missingFromPredicted: string[];
  /** inViewCounts had an entry for this key, ground truth has no item with it at all. */
  missingFromTruth: string[];
};

/**
 * Compares the model's per-product in-view counts against ground-truth qty.
 *
 * Both `truth` and `predictedCounts` are read into productKey-to-count maps before
 * comparison, and duplicate keys on either side are summed rather than overwritten or
 * rejected: two ground-truth line items with the same key represent that many more real
 * units of the product (unlike scoreImage, quantity is exactly what this function measures),
 * and two predictedCounts entries with the same key (should not happen once
 * runCensus/normalizeCensusResponse has already merged them, but this function does not
 * assume its input was pre-merged) are summed the same way recognize.ts merges them.
 *
 * A key present on only one side is not scored as an implicit zero on the other. It is kept
 * out of `totalCompared`/`meanSignedError` and reported instead in `missingFromPredicted` or
 * `missingFromTruth`, because the model omitting a product from inViewCounts entirely is a
 * different, and separately interesting, failure from the model reporting a wrong count for
 * it: collapsing the two would silently hide exactly the kind of gap this function exists to
 * surface. Callers that want a single "how much of the corpus has any count signal at all"
 * number can read those two arrays' lengths directly.
 */
export function scoreCounts(predictedCounts: PredictedCount[], truth: TruthItem[]): CountScore {
  const truthQtyByKey = new Map<string, number>();
  for (const t of truth) {
    const key = productKey(t.name, t.brand);
    truthQtyByKey.set(key, (truthQtyByKey.get(key) ?? 0) + t.qty);
  }

  const predictedByKey = new Map<string, number>();
  for (const p of predictedCounts) {
    predictedByKey.set(p.productKey, (predictedByKey.get(p.productKey) ?? 0) + p.count);
  }

  const allKeys = new Set([...truthQtyByKey.keys(), ...predictedByKey.keys()]);

  const comparisons: CountComparison[] = [];
  const overCounted: string[] = [];
  const underCounted: string[] = [];
  const missingFromPredicted: string[] = [];
  const missingFromTruth: string[] = [];
  let signedErrorSum = 0;
  let totalCompared = 0;
  let exactMatches = 0;

  for (const key of allKeys) {
    const truthQty = truthQtyByKey.has(key) ? truthQtyByKey.get(key)! : null;
    const predictedCount = predictedByKey.has(key) ? predictedByKey.get(key)! : null;

    let signedError: number | null = null;
    let exactMatch = false;

    if (truthQty !== null && predictedCount !== null) {
      signedError = predictedCount - truthQty;
      exactMatch = signedError === 0;
      signedErrorSum += signedError;
      totalCompared += 1;
      if (exactMatch) exactMatches += 1;
      if (signedError > 0) overCounted.push(key);
      if (signedError < 0) underCounted.push(key);
    } else if (truthQty !== null) {
      missingFromPredicted.push(key);
    } else {
      missingFromTruth.push(key);
    }

    comparisons.push({ productKey: key, truthQty, predictedCount, signedError, exactMatch });
  }

  return {
    comparisons,
    totalCompared,
    exactMatches,
    meanSignedError: totalCompared === 0 ? 0 : signedErrorSum / totalCompared,
    overCounted,
    underCounted,
    missingFromPredicted,
    missingFromTruth,
  };
}
