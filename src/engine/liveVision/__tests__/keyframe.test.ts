import { createKeyframeState, evaluateKeyframe } from '../keyframe';
import type { KeyframeSignals } from '../types';

const GOOD: KeyframeSignals = { sharpness: 400, motion: 0.004, trackCount: 6, now: 10_000 };

describe('evaluateKeyframe', () => {
  it('fires on the first sharp, still frame with something in view', () => {
    const r = evaluateKeyframe(createKeyframeState(), GOOD);
    expect(r.fire).toBe(true);
    expect(r.reason).toBe('fire');
    expect(r.state.lastFiredAt).toBe(GOOD.now);
    expect(r.state.lastTrackCount).toBe(6);
  });

  it('holds a blurry frame', () => {
    // Below MIN_KEYFRAME_SHARPNESS (config.ts), the single home for this threshold now that
    // this module shares it instead of carrying its own, disagreeing copy.
    const r = evaluateKeyframe(createKeyframeState(), { ...GOOD, sharpness: 5 });
    expect(r.fire).toBe(false);
    expect(r.reason).toBe('blurry');
  });

  it('holds a frame taken mid-sweep', () => {
    const r = evaluateKeyframe(createKeyframeState(), { ...GOOD, motion: 0.2 });
    expect(r.fire).toBe(false);
    expect(r.reason).toBe('moving');
  });

  it('holds when the detector found nothing', () => {
    const r = evaluateKeyframe(createKeyframeState(), { ...GOOD, trackCount: 0 });
    expect(r.fire).toBe(false);
    expect(r.reason).toBe('nothing-to-see');
  });

  it('does not fire twice inside the minimum interval', () => {
    const first = evaluateKeyframe(createKeyframeState(), GOOD);
    const second = evaluateKeyframe(first.state, { ...GOOD, now: GOOD.now + 500 });
    expect(second.fire).toBe(false);
    expect(second.reason).toBe('too-soon');
  });

  it('fires again once the interval has passed', () => {
    const first = evaluateKeyframe(createKeyframeState(), GOOD);
    const second = evaluateKeyframe(first.state, { ...GOOD, now: GOOD.now + 2500 });
    expect(second.fire).toBe(true);
  });

  it('fires early when the scene changes substantially', () => {
    // Walking round the cart reveals a shelf of new items. Waiting out the full interval
    // would leave them unnamed for two seconds while the user is looking straight at them.
    const first = evaluateKeyframe(createKeyframeState(), GOOD);
    const second = evaluateKeyframe(first.state, { ...GOOD, now: GOOD.now + 1100, trackCount: 11 });
    expect(second.fire).toBe(true);
  });

  it('does not fire early on a small change in track count', () => {
    const first = evaluateKeyframe(createKeyframeState(), GOOD);
    const second = evaluateKeyframe(first.state, { ...GOOD, now: GOOD.now + 1100, trackCount: 7 });
    expect(second.fire).toBe(false);
    expect(second.reason).toBe('too-soon');
  });

  it('will not fire early on a scene change that is also blurry', () => {
    const first = evaluateKeyframe(createKeyframeState(), GOOD);
    const second = evaluateKeyframe(first.state, {
      ...GOOD,
      now: GOOD.now + 1100,
      trackCount: 20,
      sharpness: 5,
    });
    expect(second.fire).toBe(false);
    expect(second.reason).toBe('blurry');
  });

  it('leaves state untouched when it holds', () => {
    const first = evaluateKeyframe(createKeyframeState(), GOOD);
    const second = evaluateKeyframe(first.state, { ...GOOD, now: GOOD.now + 100, sharpness: 5 });
    expect(second.state).toEqual(first.state);
  });
});
