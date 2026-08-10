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
    return { box: region.box, skuCode: match.skuCode, confidence: match.skuCode ? region.confidence : 0 };
  });

  const { candidates, events } = updateTracker(state.candidates, matchedRegions, now);
  return { state: { candidates }, events };
}
