import type { Sku } from '../types';
import type { MatchResult } from './types';
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

export function matchRegion(
  region: { label: string; confidence: number; ocrText?: string },
  catalog: Sku[],
): MatchResult {
  const candidates = LABEL_TO_SKU[region.label];
  if (!candidates || candidates.length === 0) {
    return { skuCode: null, matchConfidence: 0 };
  }

  if (candidates.length === 1) {
    return { skuCode: candidates[0], matchConfidence: region.confidence };
  }

  // Ambiguous label: use OCR text to pick the best-scoring candidate.
  if (!region.ocrText) {
    return { skuCode: null, matchConfidence: 0 };
  }

  let best: { skuCode: string; score: number } | null = null;
  for (const skuCode of candidates) {
    const sku = catalog.find((s) => s.code === skuCode);
    if (!sku) continue;
    const score = ocrOverlapScore(sku.name, region.ocrText);
    if (score > 0 && (best === null || score > best.score)) {
      best = { skuCode, score };
    }
  }

  if (!best) return { skuCode: null, matchConfidence: 0 };
  return { skuCode: best.skuCode, matchConfidence: Math.min(region.confidence, best.score) };
}
