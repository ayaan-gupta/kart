import type { Sku } from '../types';
import type { LabelCandidate, MatchResult } from './types';
import { LABEL_TO_SKU } from './labelCatalog';

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 1),
  );
}

/** Fraction of the catalog name's own tokens that also appear in the OCR text. */
function ocrOverlapScore(catalogName: string, ocrText: string): number {
  const nameTokens = tokenize(catalogName);
  if (nameTokens.size === 0) return 0;
  const ocrTokens = tokenize(ocrText);
  let hits = 0;
  for (const token of nameTokens) {
    if (ocrTokens.has(token)) hits += 1;
  }
  return hits / nameTokens.size;
}

/** Matches a single label (ignoring any other candidates) against the catalog. */
function matchSingleLabel(
  label: string,
  confidence: number,
  ocrText: string | undefined,
  catalog: Sku[],
): MatchResult {
  const candidates = LABEL_TO_SKU[label];
  if (!candidates || candidates.length === 0) {
    return { skuCode: null, matchConfidence: 0 };
  }

  if (candidates.length === 1) {
    return { skuCode: candidates[0], matchConfidence: confidence };
  }

  // Ambiguous label: use OCR text to pick the best-scoring candidate.
  if (!ocrText) {
    return { skuCode: null, matchConfidence: 0 };
  }

  let best: { skuCode: string; score: number } | null = null;
  for (const skuCode of candidates) {
    const sku = catalog.find((s) => s.code === skuCode);
    if (!sku) continue;
    const score = ocrOverlapScore(sku.name, ocrText);
    if (score > 0 && (best === null || score > best.score)) {
      best = { skuCode, score };
    }
  }

  if (!best) return { skuCode: null, matchConfidence: 0 };
  return { skuCode: best.skuCode, matchConfidence: Math.min(confidence, best.score) };
}

/**
 * Tries each candidate label in confidence order and returns the first one with any catalog
 * mapping. The classifier's top-1 label is often a generic hypernym ("food", "material") with
 * no entry in LABEL_TO_SKU even when a more specific, correct label was returned right behind
 * it — this lets the matcher fall through instead of giving up on the first miss.
 */
export function matchRegion(
  region: { labels: LabelCandidate[]; ocrText?: string },
  catalog: Sku[],
): MatchResult {
  for (const candidate of region.labels) {
    const result = matchSingleLabel(candidate.label, candidate.confidence, region.ocrText, catalog);
    if (result.skuCode !== null) return result;
  }
  return { skuCode: null, matchConfidence: 0 };
}
