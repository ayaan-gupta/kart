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

/**
 * Whether `other` sits between the camera and `subject`.
 *
 * The only depth cue two boxes carry is where they end. Items resting in a cart, photographed
 * from above and in front, occlude downwards: the nearer item's lower edge is further down the
 * frame. It is a cue and not a fact, and it is wrong for an item hanging over the rim, which is
 * part of why the state it feeds is a question to the shopper rather than a silent decision.
 */
export function isInFront(subject: Box, other: Box): boolean {
  return other.y + other.h > subject.y + subject.h;
}

/**
 * How much of `subject` the items in front of it cover, 0 to 1.
 *
 * The union of the occluders, not the sum of them. Two boxes overlapping the same corner of a
 * third cover that corner once; adding them reports a jar as more than entirely hidden and any
 * threshold above 1 then never fires.
 *
 * Exact, via coordinate compression: the occluders' own edges cut the subject into a grid whose
 * cells are each wholly covered or wholly clear. A cart holds tens of items, not thousands, so
 * the grid is small and exactness costs nothing worth measuring.
 *
 * Measured on 1,442 crops of real shelves (`server/eval/score_grocer_occlusion.py`): items this
 * scores at or above 0.2 are named correctly 47.1% of the time against 57.6% for the rest. The
 * corpus is partially annotated, so items covered by an unlabelled product score zero here and
 * sit in the clear group, which makes that ten-point gap a floor rather than an estimate.
 */
export function hiddenFraction(subject: Box, others: Box[]): number {
  if (subject.w <= 0 || subject.h <= 0) return 0;
  const sx1 = subject.x + subject.w;
  const sy1 = subject.y + subject.h;

  const clipped: Box[] = [];
  for (const other of others) {
    if (!isInFront(subject, other)) continue;
    const x = Math.max(subject.x, other.x);
    const y = Math.max(subject.y, other.y);
    const w = Math.min(sx1, other.x + other.w) - x;
    const h = Math.min(sy1, other.y + other.h) - y;
    if (w > 0 && h > 0) clipped.push({ x, y, w, h });
  }
  if (clipped.length === 0) return 0;

  const xs = [...new Set([subject.x, sx1, ...clipped.flatMap((b) => [b.x, b.x + b.w])])].sort(
    (a, b) => a - b,
  );
  const ys = [...new Set([subject.y, sy1, ...clipped.flatMap((b) => [b.y, b.y + b.h])])].sort(
    (a, b) => a - b,
  );

  let covered = 0;
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < ys.length - 1; j++) {
      const cx = (xs[i] + xs[i + 1]) / 2;
      const cy = (ys[j] + ys[j + 1]) / 2;
      const hit = clipped.some(
        (b) => cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h,
      );
      if (hit) covered += (xs[i + 1] - xs[i]) * (ys[j + 1] - ys[j]);
    }
  }
  return Math.min(1, covered / (subject.w * subject.h));
}

/**
 * Hidden fraction for every box against all the others, by index.
 *
 * One call for the whole frame rather than one per item, because the overlay asks about every
 * track on every render and each answer needs the same list of neighbours.
 */
export function hiddenFractions(boxes: Box[]): number[] {
  return boxes.map((subject, i) => hiddenFraction(subject, boxes.filter((_, j) => j !== i)));
}
