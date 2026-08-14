import { solveAssignment } from './assignment';
import { fitPolygonToBox, intersectionOverUnion } from './geometry';
import { createBoxFilter, filterToBox, predictBox, updateBox } from './kalman';
import type { ByteTrackConfig, DetectedInstance, Track, TrackerState } from './types';

const DEFAULT_CONFIG: ByteTrackConfig = {
  highThreshold: 0.5,
  lowThreshold: 0.1,
  minIou: 0.2,
  maxLostMs: 2000,
  minHits: 3,
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

  const next: Track[] = [];
  const matchedTracks = new Set<number>();
  const matchedHigh = new Set<number>();

  // Stage one: every track competes for the confident detections.
  for (const [t, d] of associate(predicted, high, config.minIou)) {
    next.push(applyDetection(predicted[t], high[d], now, config));
    matchedTracks.add(t);
    matchedHigh.add(d);
  }

  // Stage two: tracks that found nothing get a second chance against the faint detections.
  // This is the whole point of ByteTrack. An item that dims for a frame keeps its identity.
  const leftoverTracks: number[] = [];
  for (let t = 0; t < predicted.length; t += 1) {
    if (!matchedTracks.has(t)) leftoverTracks.push(t);
  }

  const recovered = associate(
    leftoverTracks.map((t) => predicted[t]),
    low,
    config.minIou,
  );
  const recoveredTracks = new Set<number>();
  for (const [i, d] of recovered) {
    const t = leftoverTracks[i];
    next.push(applyDetection(predicted[t], low[d], now, config));
    recoveredTracks.add(t);
  }

  // Tracks that matched nothing at all. A confirmed track gets a grace period, because real
  // items get buried and resurface. A tentative one is more likely a detector artefact.
  for (const t of leftoverTracks) {
    if (recoveredTracks.has(t)) continue;
    const track = predicted[t];
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
      box: detection.box,
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
