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

  it('gates low-score recovery stricter than stage one, per the reference stage-two threshold', () => {
    // The reference hardcodes IoU >= 0.5 for low-score recovery, tighter than stage one's
    // IoU >= 0.2, because a low-confidence detection is the least trustworthy input the tracker
    // sees. At an offset that lands the IoU at ~0.3, between the two thresholds, a low-score
    // detection must miss recovery while the identical offset at high score would have matched
    // in stage one. If this ever regresses to sharing minIou again, a low-confidence blob from a
    // neighbouring item could hijack a track in a packed cart, which is the wrong-count bug this
    // tracker exists to prevent.
    const dx = 0.7 / 13; // IoU between two 0.1-wide boxes offset by dx on one axis is ~0.3.

    const built = run(createTrackerState(), 4, () => [detection(0.3, 0.3)]);
    expect(built.state.tracks[0].state).toBe('confirmed');
    const id = built.state.tracks[0].id;

    const lowState = updateTracks(built.state, [detection(0.3 + dx, 0.3, 0.2)], built.now);
    expect(lowState.tracks).toHaveLength(1);
    expect(lowState.tracks[0].id).toBe(id);
    expect(lowState.tracks[0].state).toBe('lost');

    const highState = updateTracks(built.state, [detection(0.3 + dx, 0.3, 0.9)], built.now);
    expect(highState.tracks).toHaveLength(1);
    expect(highState.tracks[0].id).toBe(id);
    expect(highState.tracks[0].state).toBe('confirmed');
  });

  it('does not let low-score detections promote a tentative track to confirmed', () => {
    // A tentative track is one hit old and unproven, more likely a detector artefact (a
    // shadow, a fold in a bag) than a real item. It must not get the second-stage recovery
    // that a confirmed track gets: two low-score hits in the same spot must never be enough,
    // on their own, to build hits toward confirmation and mint a phantom item downstream.
    let state = updateTracks(createTrackerState(), [detection(0.3, 0.3)], 1000);
    expect(state.tracks).toHaveLength(1);
    expect(state.tracks[0].state).toBe('tentative');

    // Excluded from second-stage recovery, the tentative track counts this as a miss like
    // any other, and a tentative track is dropped the moment it misses (see the dedicated
    // test below), so it does not linger either. Either way it never reaches 'confirmed'.
    state = updateTracks(state, [detection(0.3, 0.3, 0.15)], 1300);
    state = updateTracks(state, [detection(0.3, 0.3, 0.15)], 1600);
    expect(state.tracks.some((t) => t.state === 'confirmed')).toBe(false);
    expect(state.tracks).toHaveLength(0);
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
    // Two items close enough that each track overlaps both detections, drifting together so
    // each track's own detection stays its unambiguous best match every frame. This is a
    // baseline: it shows steady-state co-tracking holds two nearby items apart. It does not
    // by itself distinguish the assignment solver from a greedy per-track matcher, because
    // neither ever faces a conflicting claim here. The test below this one is what exercises
    // that distinction, with a scenario a greedy matcher provably gets wrong.
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

  it('resolves a genuine assignment conflict without swapping identities', () => {
    // A scenario that actually discriminates the Hungarian solver from a greedy per-track
    // matcher, verified against a greedy substitute in a throwaway scratch script (not
    // committed): two confirmed tracks sit close together, then the left item jumps far away
    // in the same frame the right item barely moves. Now both tracks want the right-hand
    // detection. The solver picks the globally cheaper total assignment: track_2 (already
    // closer) keeps the right-hand item, track_1 gets nothing within minIou and goes lost,
    // and a new track seeds at the jumped position. A greedy matcher, which lets track_1
    // claim its locally-best option first, instead steals the right-hand item out from under
    // track_2, an identity swap this tracker exists to prevent.
    let { state, now } = run(createTrackerState(), 3, () => [
      detection(0.44, 0.4),
      detection(0.49, 0.4),
    ]);
    expect(state.tracks.every((t) => t.state === 'confirmed')).toBe(true);

    state = updateTracks(state, [detection(0.2, 0.4), detection(0.5, 0.4)], now);

    const track1 = state.tracks.find((t) => t.id === 'track_1');
    const track2 = state.tracks.find((t) => t.id === 'track_2');
    const track3 = state.tracks.find((t) => t.id === 'track_3');

    expect(state.tracks).toHaveLength(3);
    expect(track2?.state).toBe('confirmed');
    expect(track2?.box.x).toBeCloseTo(0.5, 1);
    expect(track1?.state).toBe('lost');
    expect(track1?.box.x).toBeCloseTo(0.44, 1);
    expect(track3?.state).toBe('tentative');
    expect(track3?.box.x).toBeCloseTo(0.2, 1);
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
