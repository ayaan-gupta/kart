import { OCCLUSION_THRESHOLD } from './config';
import type { Box } from './types';

export { OCCLUSION_THRESHOLD };

export type OcclusionSeverity = 'none' | 'some' | 'many';

export interface OcclusionSignals {
  /** The model's own read of the scene, from the census call. */
  semantic: { itemsLikelyHidden: boolean; severity: OcclusionSeverity };
  /** Boxes of every track that was in view for that keyframe. */
  boxes: Box[];
  /** Things the model saw that we never marked, so the detector missed them. */
  unmarkedCount: number;
}

export interface OcclusionVerdict {
  hidden: boolean;
  /** 0 to 1. Not shown to the user; drives whether guided capture opens. */
  score: number;
  /** Which signals contributed, for the log line and for tests. */
  reasons: string[];
}

/**
 * Fraction of `a` that `b` covers.
 *
 * Deliberately not IoU. Two items stacked front to back produce a small IoU (the union is
 * large) but a large containment ratio, and containment is what stacking actually looks like.
 * IoU here would report a clear view of a pile.
 */
export function containment(a: Box, b: Box): number {
  const areaA = a.w * a.h;
  if (areaA <= 0) return 0;
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  if (x2 <= x1 || y2 <= y1) return 0;
  return ((x2 - x1) * (y2 - y1)) / areaA;
}

/** The largest fraction of any single track that another track covers. */
export function peakOverlap(boxes: Box[]): number {
  let peak = 0;
  for (let i = 0; i < boxes.length; i++) {
    for (let j = 0; j < boxes.length; j++) {
      if (i === j) continue;
      const c = containment(boxes[i], boxes[j]);
      if (c > peak) peak = c;
    }
  }
  return peak;
}

const SEVERITY_SCORE: Record<OcclusionSeverity, number> = { none: 0, some: 0.5, many: 1 };

/**
 * Combines three independent signals into one verdict.
 *
 * No single signal is trusted alone. The model can call a tidy cart "stacked"; heavy overlap is
 * normal in a full cart viewed from above; and unmarked items can just be the detector being
 * conservative at the frame edge. Two of the three agreeing is the bar, which the weights below
 * encode: the semantic signal at full strength is 0.45, so it cannot cross OCCLUSION_THRESHOLD
 * by itself.
 */
export function assessOcclusion(signals: OcclusionSignals): OcclusionVerdict {
  const reasons: string[] = [];

  const semantic = signals.semantic.itemsLikelyHidden
    ? SEVERITY_SCORE[signals.semantic.severity]
    : 0;
  if (semantic > 0) reasons.push(`model says ${signals.semantic.severity} hidden`);

  const overlap = peakOverlap(signals.boxes);
  // Below 0.35 is ordinary crowding. The ramp runs from there to near-total containment.
  const geometric = Math.max(0, Math.min(1, (overlap - 0.35) / 0.45));
  if (geometric > 0) reasons.push(`items overlap by ${Math.round(overlap * 100)}%`);

  // Three or more things the detector missed is a strong hint the pile is deeper than it looks.
  const unmarked = Math.max(0, Math.min(1, signals.unmarkedCount / 3));
  if (unmarked > 0) reasons.push(`${signals.unmarkedCount} unmarked`);

  const score = Math.min(1, semantic * 0.45 + geometric * 0.35 + unmarked * 0.35);
  return { hidden: score >= OCCLUSION_THRESHOLD, score, reasons };
}
