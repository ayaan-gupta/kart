import { createTrackerState, updateTracks } from '../byteTrack';
import type { DetectedInstance, TrackerState } from '../types';

function boxAt(x: number, y: number, size = 0.1): DetectedInstance['box'] {
  return { x, y, w: size, h: size };
}

function detection(x: number, y: number, score = 0.9, size = 0.1): DetectedInstance {
  const box = boxAt(x, y, size);
  return {
    box,
    polygon: [box.x, box.y, box.x + box.w, box.y, box.x + box.w, box.y + box.h, box.x, box.y + box.h],
    score,
  };
}

/** Drive the tracker for `frames` steps, 300ms apart, with detections from `at`. */
function run(
  state: TrackerState,
  frames: number,
  at: (frame: number) => DetectedInstance[],
  startAt = 1000,
): { state: TrackerState; now: number } {
  let now = startAt;
  let s = state;
  for (let i = 0; i < frames; i += 1) {
    s = updateTracks(s, at(i), now);
    now += 300;
  }
  return { state: s, now };
}

describe('updateTracks', () => {
  it('creates a track for a high-confidence detection', () => {
    const s = updateTracks(createTrackerState(), [detection(0.2, 0.2)], 1000);
    expect(s.tracks).toHaveLength(1);
    expect(s.tracks[0].state).toBe('tentative');
  });

  it('does not start a track from a low-confidence detection alone', () => {
    // ByteTrack's defining rule: low-score boxes may recover an existing track, never seed one.
    const s = updateTracks(createTrackerState(), [detection(0.2, 0.2, 0.2)], 1000);
    expect(s.tracks).toHaveLength(0);
  });

  it('ignores detections below the low threshold entirely', () => {
    const s = updateTracks(createTrackerState(), [detection(0.2, 0.2, 0.01)], 1000);
    expect(s.tracks).toHaveLength(0);
  });

  it('promotes a track to confirmed after minHits', () => {
    const { state } = run(createTrackerState(), 4, () => [detection(0.2, 0.2)]);
    expect(state.tracks).toHaveLength(1);
    expect(state.tracks[0].state).toBe('confirmed');
  });

  it('holds one identity for one jittery object', () => {
    // The duplicate-bananas regression. One bunch of bananas, detection boxes wobbling by a
    // few percent per frame, must stay exactly one track with one unchanging id. The old
    // greedy matcher dropped association on the wobble and minted a new candidate each time,
    // and Plan 3 counts quantity by counting tracks, so every spurious track is a phantom item.
    const wobble = [0, 0.012, -0.009, 0.015, -0.013, 0.006, -0.004];
    const { state } = run(createTrackerState(), 30, (i) =>
      [detection(0.4 + wobble[i % wobble.length], 0.4 + wobble[(i + 3) % wobble.length])],
    );
    expect(state.tracks).toHaveLength(1);
    expect(state.tracks[0].id).toBe('track_1');
    expect(state.tracks[0].hits).toBe(30);
  });

  it('recovers a track from a low-confidence detection', () => {
    // Second-stage association. A confirmed item that dims below the high threshold for a
    // frame keeps its identity instead of dying and being reborn with a new id.
    let { state } = run(createTrackerState(), 4, () => [detection(0.3, 0.3)]);
    const id = state.tracks[0].id;
    state = updateTracks(state, [detection(0.3, 0.3, 0.2)], 2200);
    expect(state.tracks).toHaveLength(1);
    expect(state.tracks[0].id).toBe(id);
    expect(state.tracks[0].state).toBe('confirmed');
  });

  it('keeps a vanished track alive briefly, then drops it', () => {
    let { state, now } = run(createTrackerState(), 4, () => [detection(0.3, 0.3)]);
    state = updateTracks(state, [], now);
    expect(state.tracks).toHaveLength(1);
    expect(state.tracks[0].state).toBe('lost');

    state = updateTracks(state, [], now + 5000);
    expect(state.tracks).toHaveLength(0);
  });

  it('resumes the same identity when an occluded item reappears', () => {
    let { state, now } = run(createTrackerState(), 4, () => [detection(0.3, 0.3)]);
    const id = state.tracks[0].id;
    state = updateTracks(state, [], now);
    state = updateTracks(state, [detection(0.3, 0.3)], now + 400);
    expect(state.tracks).toHaveLength(1);
    expect(state.tracks[0].id).toBe(id);
    expect(state.tracks[0].state).toBe('confirmed');
  });

  it('drops a tentative track the moment it misses', () => {
    // An unconfirmed track is more likely to be a detector artefact than a real item, so it
    // does not get the grace period a confirmed track gets.
    let state = updateTracks(createTrackerState(), [detection(0.3, 0.3)], 1000);
    state = updateTracks(state, [], 1300);
    expect(state.tracks).toHaveLength(0);
  });

  it('keeps two neighbouring items apart without swapping identities', () => {
    // Two items close enough that each track overlaps both detections. Greedy matching gives
    // the first track its global best and strands the second; the assignment solver keeps
    // both pairings, which is why one is used.
    const { state } = run(createTrackerState(), 8, (i) => [
      detection(0.30 + i * 0.005, 0.4),
      detection(0.38 + i * 0.005, 0.4),
    ]);
    expect(state.tracks).toHaveLength(2);
    const sorted = [...state.tracks].sort((a, b) => a.box.x - b.box.x);
    expect(sorted[0].id).toBe('track_1');
    expect(sorted[1].id).toBe('track_2');
    expect(sorted[0].box.x).toBeLessThan(sorted[1].box.x);
  });

  it('starts a second track when a genuinely new item appears', () => {
    let { state, now } = run(createTrackerState(), 4, () => [detection(0.2, 0.2)]);
    state = updateTracks(state, [detection(0.2, 0.2), detection(0.7, 0.7)], now);
    expect(state.tracks).toHaveLength(2);
    expect(new Set(state.tracks.map((t) => t.id)).size).toBe(2);
  });

  it('carries the polygon onto the filtered box', () => {
    const { state } = run(createTrackerState(), 6, () => [detection(0.4, 0.4)]);
    const track = state.tracks[0];
    const xs = track.polygon.filter((_, i) => i % 2 === 0);
    const ys = track.polygon.filter((_, i) => i % 2 === 1);
    expect(Math.min(...xs)).toBeCloseTo(track.box.x, 5);
    expect(Math.min(...ys)).toBeCloseTo(track.box.y, 5);
    expect(Math.max(...xs)).toBeCloseTo(track.box.x + track.box.w, 5);
  });

  it('does not mutate the state it was given', () => {
    const initial = updateTracks(createTrackerState(), [detection(0.2, 0.2)], 1000);
    const snapshot = JSON.stringify(initial);
    updateTracks(initial, [detection(0.5, 0.5)], 1300);
    expect(JSON.stringify(initial)).toBe(snapshot);
  });
});
