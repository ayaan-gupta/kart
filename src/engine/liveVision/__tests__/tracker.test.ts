import { createTrackerState, updateTracker } from '../tracker';
import type { MatchedRegion } from '../types';

const CONFIG = { iouMatchThreshold: 0.3, lossToleranceMs: 600, yellowConfidence: 0.2, greenConfidence: 0.5, minDwellMs: 500 };

function region(box: MatchedRegion['box'], skuCode: string | null, confidence: number): MatchedRegion {
  return { box, skuCode, confidence };
}

describe('updateTracker', () => {
  it('creates a forming candidate for a new region with no confident match', () => {
    const { candidates, events } = updateTracker(
      createTrackerState(),
      [region({ x: 0, y: 0, w: 0.1, h: 0.1 }, null, 0)],
      0,
      CONFIG,
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0].state).toBe('forming');
    expect(events).toHaveLength(0);
  });

  it('locks a candidate after sustained high confidence for the dwell time', () => {
    const box = { x: 0, y: 0, w: 0.1, h: 0.1 };
    let state = createTrackerState();
    let events;
    ({ candidates: state, events } = updateTracker(state, [region(box, '0417', 0.7)], 0, CONFIG));
    expect(state[0].state).toBe('tentative'); // not held long enough yet
    ({ candidates: state, events } = updateTracker(state, [region(box, '0417', 0.7)], 600, CONFIG));
    expect(state[0].state).toBe('locked');
    expect(events).toEqual([{ type: 'locked', candidateId: state[0].id, skuCode: '0417', confidence: 0.7 }]);
  });

  it('stays tentative below the green threshold and never locks or fires an event', () => {
    const box = { x: 0, y: 0, w: 0.1, h: 0.1 };
    let state = createTrackerState();
    let events;
    ({ candidates: state, events } = updateTracker(state, [region(box, '0425', 0.3)], 0, CONFIG));
    ({ candidates: state, events } = updateTracker(state, [region(box, '0425', 0.3)], 600, CONFIG));
    expect(state[0].state).toBe('tentative');
    expect(events).toHaveLength(0);
  });

  it('drops a tentative candidate once it is lost, uncounted', () => {
    const box = { x: 0, y: 0, w: 0.1, h: 0.1 };
    let state = createTrackerState();
    ({ candidates: state } = updateTracker(state, [region(box, '0425', 0.3)], 0, CONFIG));
    // No matching region for longer than lossToleranceMs.
    const { candidates: after, events } = updateTracker(state, [], 1000, CONFIG);
    expect(after).toHaveLength(0);
    expect(events).toHaveLength(0);
  });

  it('counts two spatially distinct instances of the same SKU separately', () => {
    const boxA = { x: 0, y: 0, w: 0.1, h: 0.1 };
    const boxB = { x: 0.5, y: 0.5, w: 0.1, h: 0.1 };
    let state = createTrackerState();
    let events;
    ({ candidates: state, events } = updateTracker(
      state,
      [region(boxA, '5561', 0.7), region(boxB, '5561', 0.7)],
      0,
      CONFIG,
    ));
    ({ candidates: state, events } = updateTracker(
      state,
      [region(boxA, '5561', 0.7), region(boxB, '5561', 0.7)],
      600,
      CONFIG,
    ));
    const lockEvents = events.filter((e) => e.type === 'locked');
    expect(lockEvents).toHaveLength(2);
    expect(lockEvents.map((e) => e.skuCode)).toEqual(['5561', '5561']);
    expect(lockEvents[0].candidateId).not.toBe(lockEvents[1].candidateId);
  });

  it('does not unlock or re-fire once locked, even if confidence later dips', () => {
    const box = { x: 0, y: 0, w: 0.1, h: 0.1 };
    let state = createTrackerState();
    ({ candidates: state } = updateTracker(state, [region(box, '0417', 0.7)], 0, CONFIG));
    ({ candidates: state } = updateTracker(state, [region(box, '0417', 0.7)], 600, CONFIG));
    expect(state[0].state).toBe('locked');
    const { candidates: after, events } = updateTracker(state, [region(box, '0417', 0.1)], 700, CONFIG);
    expect(after[0].state).toBe('locked');
    expect(events).toHaveLength(0);
  });
});
