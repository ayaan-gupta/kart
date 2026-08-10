import type { Sku } from '../types';
import { matchRegion } from './labelMatcher';
import { createTrackerState, updateTracker } from './tracker';
import type { PipelineState, RawRegion, TrackerEvent } from './types';

export function createPipelineState(): PipelineState {
  return { candidates: createTrackerState() };
}

export function processFrame(
  state: PipelineState,
  rawRegions: RawRegion[],
  now: number,
  catalog: Sku[],
): { state: PipelineState; events: TrackerEvent[] } {
  const matchedRegions = rawRegions.map((region) => {
    const match = matchRegion(region, catalog);
    // Use the matcher's own combined confidence (classifier confidence blended with the OCR
    // overlap score for ambiguous packaged-goods matches), not the raw classifier confidence.
    // Otherwise a weak, barely-matching OCR read gets treated the same as a strong one, and OCR
    // disambiguation never actually influences the tracker's tentative/locked decision.
    return { box: region.box, skuCode: match.skuCode, confidence: match.matchConfidence };
  });

  const { candidates, events } = updateTracker(state.candidates, matchedRegions, now);
  return { state: { candidates }, events };
}
