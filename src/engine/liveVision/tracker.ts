import { intersectionOverUnion } from './geometry';
import type { MatchedRegion, TrackedCandidate, TrackerConfig, TrackerEvent } from './types';

const DEFAULT_CONFIG: TrackerConfig = {
  iouMatchThreshold: 0.3,
  lossToleranceMs: 600,
  yellowConfidence: 0.2,
  greenConfidence: 0.5,
  minDwellMs: 500,
};

let idCounter = 0;
function nextCandidateId(): string {
  idCounter += 1;
  return `cand_${idCounter}`;
}

export function createTrackerState(): TrackedCandidate[] {
  return [];
}

function stateFor(confidence: number, hasSku: boolean, config: TrackerConfig): 'forming' | 'tentative' {
  if (!hasSku || confidence < config.yellowConfidence) return 'forming';
  return 'tentative';
}

export function updateTracker(
  candidates: TrackedCandidate[],
  matchedRegions: MatchedRegion[],
  now: number,
  configOverrides: Partial<TrackerConfig> = {},
): { candidates: TrackedCandidate[]; events: TrackerEvent[] } {
  const config = { ...DEFAULT_CONFIG, ...configOverrides };
  const events: TrackerEvent[] = [];
  const claimedRegions = new Set<number>();
  const nextCandidates: TrackedCandidate[] = [];

  for (const candidate of candidates) {
    // Find the best-IoU unclaimed region for this candidate.
    let bestIndex = -1;
    let bestIou = 0;
    matchedRegions.forEach((region, index) => {
      if (claimedRegions.has(index)) return;
      const iou = intersectionOverUnion(candidate.box, region.box);
      if (iou > bestIou) {
        bestIou = iou;
        bestIndex = index;
      }
    });

    if (bestIndex === -1 || bestIou < config.iouMatchThreshold) {
      // Not matched this frame. Drop if past the loss tolerance, otherwise keep as-is.
      if (now - candidate.lastSeenAt <= config.lossToleranceMs) {
        nextCandidates.push(candidate);
      }
      continue;
    }

    claimedRegions.add(bestIndex);
    const region = matchedRegions[bestIndex];

    if (candidate.state === 'locked') {
      // Already counted. Keep tracking its position, never re-evaluate or re-fire.
      nextCandidates.push({ ...candidate, box: region.box, lastSeenAt: now });
      continue;
    }

    const sameGuess = region.skuCode !== null && region.skuCode === candidate.skuCode;
    const aboveGreen = region.skuCode !== null && region.confidence >= config.greenConfidence;
    const stableSince = aboveGreen ? (sameGuess && candidate.stableSince !== null ? candidate.stableSince : now) : null;

    const updated: TrackedCandidate = {
      ...candidate,
      box: region.box,
      skuCode: region.skuCode,
      confidence: region.confidence,
      lastSeenAt: now,
      stableSince,
      state: stateFor(region.confidence, region.skuCode !== null, config),
    };

    if (stableSince !== null && now - stableSince >= config.minDwellMs) {
      updated.state = 'locked';
      events.push({ type: 'locked', candidateId: updated.id, skuCode: region.skuCode as string, confidence: region.confidence });
    }

    nextCandidates.push(updated);
  }

  // Any unclaimed region starts a brand new candidate.
  matchedRegions.forEach((region, index) => {
    if (claimedRegions.has(index)) return;
    const aboveGreen = region.skuCode !== null && region.confidence >= config.greenConfidence;
    nextCandidates.push({
      id: nextCandidateId(),
      box: region.box,
      skuCode: region.skuCode,
      confidence: region.confidence,
      lastSeenAt: now,
      stableSince: aboveGreen ? now : null,
      state: stateFor(region.confidence, region.skuCode !== null, config),
    });
  });

  return { candidates: nextCandidates, events };
}
