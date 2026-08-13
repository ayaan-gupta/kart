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
