import { solveAssignment } from './assignment';
import { fitPolygonToBox, intersectionOverUnion } from './geometry';
import { createBoxFilter, filterToBox, predictBox, updateBox } from './kalman';
import type { Box, ByteTrackConfig, DetectedInstance, Track, TrackerState } from './types';

const DEFAULT_CONFIG: ByteTrackConfig = {
  highThreshold: 0.5,
  lowThreshold: 0.1,
  minIou: 0.2,
  recoverMinIou: 0.5,
  maxLostMs: 2000,
  minHits: 3,
  globalShift: true,
  minTracksForShift: 3,
};

export function createTrackerState(): TrackerState {
  return { tracks: [], nextId: 1 };
}

/**
 * Solves one association round and returns the accepted pairs.
 *
 * Cost is `1 - IoU`, and any pair whose IoU falls below `minIou` is rejected after the solve
 * rather than before it. Rejecting first would change the problem the solver sees and can
 * strand a pairing that was only optimal in combination with another.
 */
function associate(
  tracks: Track[],
  detections: DetectedInstance[],
  minIou: number,
): [number, number][] {
  if (tracks.length === 0 || detections.length === 0) return [];

  const cost = tracks.map((track) =>
    detections.map((detection) => 1 - intersectionOverUnion(track.box, detection.box)),
  );

  return solveAssignment(cost).filter(([t, d]) => cost[t][d] <= 1 - minIou);
}

function applyDetection(track: Track, detection: DetectedInstance, now: number, config: ByteTrackConfig): Track {
  const filter = updateBox(track.filter, detection.box);
  const box = filterToBox(filter);
  const hits = track.hits + 1;

  return {
    ...track,
    filter,
    box,
    // The polygon arrives in the raw detection's frame of reference. Move it onto the filtered
    // box so the tinted silhouette sits where the smoothed item is, not where the noisy
    // measurement was.
    polygon: fitPolygonToBox(detection.polygon, detection.box, box),
    score: detection.score,
    hits,
    lastSeenAt: now,
    state: track.state === 'lost' || hits >= config.minHits ? 'confirmed' : 'tentative',
  };
}

/**
 * The translation common to every track between the last frame and this one, or null when there
 * is not enough evidence for one.
 *
 * A phone held over a trolley pans, and when it does every item in the frame moves the same way
 * at once. The Kalman filter cannot absorb that: it estimates each track's velocity from its own
 * short history, at three frames a second, so it lags a camera that changes direction. Measured
 * on a real handheld scan, a box moves a median of 0.19 of its own size between frames but 11%
 * of steps exceed 0.5, which is where IoU with itself reaches zero and association starts
 * guessing. A single shift shared by all boxes explains 66% of that movement.
 *
 * The estimate is the component-wise median of each track's displacement to its nearest
 * detection. Median rather than mean because the input is exactly the noisy nearest-neighbour
 * matching this is meant to repair: half the pairs may be wrong and the answer still holds. One
 * item moving on its own, a hand lowering something into the trolley, moves the median not at
 * all, which is the behaviour wanted.
 *
 * Returns null below `minTracksForShift` tracks or `minTracksForShift` detections, where a median
 * is not a robust statistic but a coin toss.
 */
export function estimateGlobalShift(
  tracks: { box: Box }[],
  detections: DetectedInstance[],
  minTracks: number,
): { dx: number; dy: number } | null {
  if (tracks.length < minTracks || detections.length < minTracks) return null;
  const dxs: number[] = [];
  const dys: number[] = [];
  for (const track of tracks) {
    const cx = track.box.x + track.box.w / 2;
    const cy = track.box.y + track.box.h / 2;
    let best: DetectedInstance | null = null;
    let bestDistance = Infinity;
    for (const detection of detections) {
      const ox = detection.box.x + detection.box.w / 2;
      const oy = detection.box.y + detection.box.h / 2;
      const distance = (ox - cx) ** 2 + (oy - cy) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = detection;
      }
    }
    if (best == null) continue;
    dxs.push(best.box.x + best.box.w / 2 - cx);
    dys.push(best.box.y + best.box.h / 2 - cy);
  }
  if (dxs.length < minTracks) return null;
  const median = (xs: number[]) => {
    const sorted = [...xs].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };
  return { dx: median(dxs), dy: median(dys) };
}

export function updateTracks(
  state: TrackerState,
  detections: DetectedInstance[],
  now: number,
  overrides: Partial<ByteTrackConfig> = {},
): TrackerState {
  const config = { ...DEFAULT_CONFIG, ...overrides };

  const high: DetectedInstance[] = [];
  const low: DetectedInstance[] = [];
  for (const detection of detections) {
    if (detection.score >= config.highThreshold) high.push(detection);
    else if (detection.score >= config.lowThreshold) low.push(detection);
  }

  // Predict every track forward before matching, so association compares this frame's
  // detections against where each item is expected to be, not where it last was.
  const predicted = state.tracks.map((track) => {
    const filter = predictBox(track.filter);
    const box = filterToBox(filter);
    return { ...track, filter, box, polygon: fitPolygonToBox(track.polygon, track.box, box) };
  });

  // Then shift all of them by however much the camera moved, which the filter cannot know.
  const shift = config.globalShift
    ? estimateGlobalShift(predicted, detections, config.minTracksForShift)
    : null;
  const aimed = shift == null ? predicted : predicted.map((track) => {
    const box = { ...track.box, x: track.box.x + shift.dx, y: track.box.y + shift.dy };
    return { ...track, box, polygon: fitPolygonToBox(track.polygon, track.box, box) };
  });

  const next: Track[] = [];
  const matchedTracks = new Set<number>();
  const matchedHigh = new Set<number>();

  // Stage one: every track competes for the confident detections, tentative included. The
  // reference gives unconfirmed tracks their own lower-priority round instead. We solve them
  // jointly because the Hungarian solver is optimal, not greedy: a tentative track only wins a
  // detection here when doing so lowers the total assignment cost, so it is the genuinely better
  // geometric match. If identity continuity ever loses to a tentative track in practice, splitting
  // this into the reference's separate round is the fix.
  for (const [t, d] of associate(aimed, high, config.minIou)) {
    next.push(applyDetection(aimed[t], high[d], now, config));
    matchedTracks.add(t);
    matchedHigh.add(d);
  }

  // Stage two: tracks that found nothing get a second chance against the faint detections.
  // This is the whole point of ByteTrack. An item that dims for a frame keeps its identity.
  const leftoverTracks: number[] = [];
  for (let t = 0; t < aimed.length; t += 1) {
    if (!matchedTracks.has(t)) leftoverTracks.push(t);
  }

  // Confirmed and lost tracks both get the low-score second chance; only tentative is excluded.
  // A tentative track is more likely a detector artefact, and letting faint detections recover it
  // would let noise promote it to confirmed, which everything downstream counts as a real item.
  // The reference denies already-lost tracks this recovery round and restricts stage two to
  // currently-tracked leftovers. We keep lost tracks eligible on purpose: our motivating failure
  // is duplicate counting when a buried item resurfaces mid-pan, and letting a lost track recover
  // is exactly what stops a second id being minted for the same physical item. The reference is
  // tuned for pedestrian benchmarks, where that trade runs the other way.
  const recoverable = leftoverTracks.filter((t) => aimed[t].state !== 'tentative');

  // Stricter than stage one on purpose, see `recoverMinIou` on ByteTrackConfig: a low-score
  // detection is the least trustworthy input here, so it needs a tighter geometric match before
  // it can reattach a track's identity.
  const recovered = associate(
    recoverable.map((t) => aimed[t]),
    low,
    config.recoverMinIou,
  );
  const recoveredTracks = new Set<number>();
  for (const [i, d] of recovered) {
    const t = recoverable[i];
    next.push(applyDetection(aimed[t], low[d], now, config));
    recoveredTracks.add(t);
  }

  // Tracks that matched nothing at all. A confirmed track gets a grace period, because real
  // items get buried and resurface. A tentative one is more likely a detector artefact.
  for (const t of leftoverTracks) {
    if (recoveredTracks.has(t)) continue;
    const track = aimed[t];
    if (track.state === 'tentative') continue;
    if (now - track.lastSeenAt > config.maxLostMs) continue;
    next.push({ ...track, state: 'lost' });
  }

  // Confident detections nobody claimed become new items.
  let nextId = state.nextId;
  for (let d = 0; d < high.length; d += 1) {
    if (matchedHigh.has(d)) continue;
    const detection = high[d];
    const filter = createBoxFilter(detection.box);
    next.push({
      id: `track_${nextId}`,
      box: filterToBox(filter),
      polygon: detection.polygon,
      score: detection.score,
      state: config.minHits <= 1 ? 'confirmed' : 'tentative',
      hits: 1,
      lastSeenAt: now,
      barcode: null,
      filter,
    });
    nextId += 1;
  }

  return { tracks: next, nextId };
}
