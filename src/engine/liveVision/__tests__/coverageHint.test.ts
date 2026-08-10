import { evaluateCoverageHint } from '../coverageHint';
import type { TrackedCandidate } from '../types';

function candidate(state: TrackedCandidate['state']): TrackedCandidate {
  return { id: 'c1', box: { x: 0, y: 0, w: 0.1, h: 0.1 }, skuCode: null, confidence: 0, state, lastSeenAt: 0, stableSince: null };
}

describe('evaluateCoverageHint', () => {
  it('does not show a hint with no active candidates', () => {
    expect(evaluateCoverageHint([], null, 5000, false).showHint).toBe(false);
  });

  it('does not show a hint before the idle threshold', () => {
    expect(evaluateCoverageHint([candidate('tentative')], 0, 1000, false, 4000).showHint).toBe(false);
  });

  it('shows a hint once idle time with unresolved candidates passes the threshold', () => {
    expect(evaluateCoverageHint([candidate('tentative')], 0, 4001, false, 4000).showHint).toBe(true);
  });

  it('does not re-trigger while already active', () => {
    expect(evaluateCoverageHint([candidate('tentative')], 0, 9000, true, 4000).showHint).toBe(false);
  });

  it('does not show a hint once everything present is locked', () => {
    expect(evaluateCoverageHint([candidate('locked')], 0, 9000, false, 4000).showHint).toBe(false);
  });
});
