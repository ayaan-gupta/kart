import { MAX_KEYFRAME_MOTION } from '../config';
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

describe('the motion ceiling against a real handheld scan', () => {
  it('admits the motion a phone held over a trolley actually produces', () => {
    // Median motion across a nine-second handheld scan of a loaded trolley was 0.1009, and the
    // frames at that level have a median sharpness of 58 against a floor of 12. The previous
    // ceiling of 0.06 rejected 25 of 26 frames and the session made one census call and put
    // nothing in the bag.
    const state = createKeyframeState();
    const result = evaluateKeyframe(state, {
      sharpness: 58, motion: 0.1009, trackCount: 3, now: 10_000,
    });
    expect(result.reason).not.toBe('moving');
  });

  it('still refuses the first frame of a session', () => {
    // FrameMetrics reports 1.0 for the first frame and whenever the buffer size changes. Any
    // ceiling at or above 1.0 would silently start uploading it.
    expect(MAX_KEYFRAME_MOTION).toBeLessThan(1);
    const result = evaluateKeyframe(createKeyframeState(), {
      sharpness: 200, motion: 1, trackCount: 3, now: 10_000,
    });
    expect(result.fire).toBe(false);
    expect(result.reason).toBe('moving');
  });

  it('still refuses a genuinely blurred frame, which is now the only blur test', () => {
    const result = evaluateKeyframe(createKeyframeState(), {
      sharpness: 4, motion: 0.02, trackCount: 3, now: 10_000,
    });
    expect(result.reason).toBe('blurry');
  });
});
