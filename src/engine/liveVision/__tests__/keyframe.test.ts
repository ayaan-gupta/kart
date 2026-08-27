import { MAX_KEYFRAME_MOTION, MIN_KEYFRAME_SHARPNESS } from '../config';
import {
  adaptiveMinSharpness, createKeyframeState, evaluateKeyframe, settleKeyframeRequest,
} from '../keyframe';
import type { KeyframeSignals, KeyframeState } from '../types';

const GOOD: KeyframeSignals = { sharpness: 400, motion: 0.004, trackCount: 6, now: 10_000 };

/**
 * A gate that has already seen `count` frames at `sharpness`, so its adaptive floor is populated.
 *
 * The blur floor is now drawn from recent frames rather than a constant, so "blurry" is only
 * meaningful relative to a history. `trackCount: 0` holds every frame on `nothing-to-see`, which
 * fills the window without moving `lastFiredAt` and so leaves the pacing tests independent of it.
 */
function withHistory(sharpness: number, count = 12): KeyframeState {
  let state = createKeyframeState();
  for (let i = 0; i < count; i += 1) {
    state = evaluateKeyframe(state, { ...GOOD, sharpness, trackCount: 0, now: i }).state;
  }
  return state;
}

/**
 * Fires the gate and then delivers the keyframe it asked for, which is what starts the pacing.
 *
 * The two steps are separate on purpose. `evaluateKeyframe` only decides; the interval begins
 * when native hands a keyframe back, one frame later, and it may never hand one back at all.
 * Every pacing test therefore has to say which of the two happened, and a test that only fires
 * is testing a gate that asked and was refused.
 */
function fireAndDeliver(state: KeyframeState, signals = GOOD): KeyframeState {
  const fired = evaluateKeyframe(state, signals);
  expect(fired.fire).toBe(true);
  return settleKeyframeRequest(
    fired.state, { requested: true, delivered: true }, signals.now, signals.trackCount);
}

describe('evaluateKeyframe', () => {
  it('fires on the first sharp, still frame with something in view', () => {
    const r = evaluateKeyframe(createKeyframeState(), GOOD);
    expect(r.fire).toBe(true);
    expect(r.reason).toBe('fire');
    // Deciding to fire does not start the interval. Only a keyframe coming back does.
    expect(r.state.lastFiredAt).toBe(0);
    expect(r.state.lastTrackCount).toBe(0);
  });

  it('starts the pacing interval when the keyframe is delivered, not when it is asked for', () => {
    const delivered = fireAndDeliver(createKeyframeState());
    expect(delivered.lastFiredAt).toBe(GOOD.now);
    expect(delivered.lastTrackCount).toBe(6);
  });

  it('keeps asking while native keeps refusing, so a refusal costs no capture window', () => {
    // The defect this contract exists to prevent. Native re-tests the frame after the one the
    // gate fired on, against a floor roughly 40 per cent of frames clear, so most requests are
    // refused. Measured over 1440 frames of `server/eval/replay` while the clock started at the
    // decision: 22 decisions, 4 uploads, one census per twelve-second clip against a budget of
    // eight. Nothing here delivers, so nothing here may start an interval.
    let state = createKeyframeState();
    for (let i = 0; i < 5; i += 1) {
      const r = evaluateKeyframe(state, { ...GOOD, now: GOOD.now + i * 300 });
      expect(r.fire).toBe(true);
      state = r.state;
    }
  });

  it('holds a frame far blurrier than the ones around it', () => {
    // Relative, not absolute. 5 is only "blurry" because this scene has been running at 400.
    const r = evaluateKeyframe(withHistory(400), { ...GOOD, sharpness: 5 });
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
    const delivered = fireAndDeliver(createKeyframeState());
    const second = evaluateKeyframe(delivered, { ...GOOD, now: GOOD.now + 500 });
    expect(second.fire).toBe(false);
    expect(second.reason).toBe('too-soon');
  });

  it('fires again once the interval has passed', () => {
    const delivered = fireAndDeliver(createKeyframeState());
    const second = evaluateKeyframe(delivered, { ...GOOD, now: GOOD.now + 2500 });
    expect(second.fire).toBe(true);
  });

  it('fires early when the scene changes substantially', () => {
    // Walking round the cart reveals a shelf of new items. Waiting out the full interval
    // would leave them unnamed for two seconds while the user is looking straight at them.
    const delivered = fireAndDeliver(createKeyframeState());
    const second = evaluateKeyframe(delivered, { ...GOOD, now: GOOD.now + 1100, trackCount: 11 });
    expect(second.fire).toBe(true);
  });

  it('does not fire early on a small change in track count', () => {
    const delivered = fireAndDeliver(createKeyframeState());
    const second = evaluateKeyframe(delivered, { ...GOOD, now: GOOD.now + 1100, trackCount: 7 });
    expect(second.fire).toBe(false);
    expect(second.reason).toBe('too-soon');
  });

  it('will not fire early on a scene change that is also blurry', () => {
    const first = { state: fireAndDeliver(withHistory(400)) };
    const second = evaluateKeyframe(first.state, {
      ...GOOD,
      now: GOOD.now + 1100,
      trackCount: 20,
      sharpness: 5,
    });
    expect(second.fire).toBe(false);
    expect(second.reason).toBe('blurry');
  });

  it('does not advance the pacing clock when it holds', () => {
    // Narrower than the "state is untouched" assertion this replaces, and deliberately so: the
    // window has to keep growing on held frames or the adaptive floor could never learn what a
    // blurry scene looks like. What must not move is the pacing, or a run of blurry frames would
    // push the next legitimate keyframe further and further away.
    const first = fireAndDeliver(withHistory(400));
    const second = evaluateKeyframe(first, { ...GOOD, now: GOOD.now + 100, sharpness: 5 });
    expect(second.reason).toBe('blurry');
    expect(second.state.lastFiredAt).toBe(first.lastFiredAt);
    expect(second.state.lastTrackCount).toBe(first.lastTrackCount);
  });
});

/**
 * The regression that made the app unusable on a real phone.
 *
 * `MIN_KEYFRAME_SHARPNESS` was 12, set against `score_video.py`'s whole-frame variance of the
 * Laplacian. `FrameMetrics.sharpness` reports a different statistic on a different scale, and a
 * real iPhone in a dim room measured a median of 1 over 390 frames. Every frame was held, no
 * census was ever attempted, and because the "scanning isn't working" notice keys off failed
 * calls rather than absent ones, the shopper was told nothing at all.
 */
describe('the adaptive blur floor', () => {
  it('fires in a scene whose every frame is far below the old fixed threshold', () => {
    const dim = [0, 1, 1, 2, 1, 0, 3, 1, 2, 1, 1, 2];
    expect(Math.max(...dim)).toBeLessThan(MIN_KEYFRAME_SHARPNESS);

    let state = createKeyframeState();
    for (const sharpness of dim) {
      state = evaluateKeyframe(state, { ...GOOD, sharpness, trackCount: 0, now: 0 }).state;
    }

    // 9 is this scene's version of a sharp frame. The old gate rejected it for being under 12.
    const r = evaluateKeyframe(state, { ...GOOD, sharpness: 9 });
    expect(r.fire).toBe(true);
  });

  it('still refuses a dead frame no matter how dark the history is', () => {
    let state = createKeyframeState();
    for (let i = 0; i < 12; i += 1) {
      state = evaluateKeyframe(state, { ...GOOD, sharpness: 0, trackCount: 0, now: 0 }).state;
    }
    // An all-zero history must not make zero acceptable, or a covered lens uploads black frames.
    const r = evaluateKeyframe(state, { ...GOOD, sharpness: 0 });
    expect(r.fire).toBe(false);
    expect(r.reason).toBe('blurry');
  });

  it('opens a session on the absolute floor rather than the old constant', () => {
    // The first seconds of every scan have no window yet. Falling back to 12 there would
    // reproduce the original failure on exactly the devices this exists for.
    expect(adaptiveMinSharpness([])).toBeLessThan(MIN_KEYFRAME_SHARPNESS);
    expect(evaluateKeyframe(createKeyframeState(), { ...GOOD, sharpness: 9 }).fire).toBe(true);
  });

  it('lets an explicit override win, so the eval sweeps still measure what they set', () => {
    const r = evaluateKeyframe(withHistory(1), { ...GOOD, sharpness: 9 }, { minSharpness: 50 });
    expect(r.fire).toBe(false);
    expect(r.reason).toBe('blurry');
    expect(r.minSharpness).toBe(50);
  });

  it('reports the floor it applied, which is what native re-tests the next frame against', () => {
    const r = evaluateKeyframe(withHistory(400), GOOD);
    expect(r.minSharpness).toBeGreaterThan(0);
    expect(r.minSharpness).toBeLessThanOrEqual(400);
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
    // Seeded at the 58 the same scan measured, so 4 is blurry relative to its own scene.
    const result = evaluateKeyframe(withHistory(58), {
      sharpness: 4, motion: 0.02, trackCount: 3, now: 10_000,
    });
    expect(result.reason).toBe('blurry');
  });
});

/**
 * The three things that can become of one decision, and which of them costs a capture window.
 *
 * `pipeline.test.ts` covers the same rule through `processFrame`, where the outcome is read off
 * the frame rather than passed in. These pin it at the unit, because the three cases are easy to
 * collapse into two and the collapse is silent: treat "never asked" as free and the gate fires on
 * every frame for the whole of every census; treat "refused" as spent and the original defect is
 * back, 22 decisions for 4 uploads.
 */
describe('settleKeyframeRequest', () => {
  it('charges the window when a keyframe comes back', () => {
    const fired = evaluateKeyframe(createKeyframeState(), GOOD);
    const settled = settleKeyframeRequest(
      fired.state, { requested: true, delivered: true }, GOOD.now, 6);
    expect(settled.lastFiredAt).toBe(GOOD.now);
    expect(evaluateKeyframe(settled, { ...GOOD, now: GOOD.now + 500 }).reason).toBe('too-soon');
  });

  it('charges nothing when native refuses a keyframe it was asked for', () => {
    const fired = evaluateKeyframe(createKeyframeState(), GOOD);
    const settled = settleKeyframeRequest(
      fired.state, { requested: true, delivered: false }, GOOD.now, 6);
    expect(settled.lastFiredAt).toBe(0);
    // Nothing was encoded, so nothing was spent, and the gate asks again at once.
    expect(evaluateKeyframe(settled, { ...GOOD, now: GOOD.now + 33 }).fire).toBe(true);
  });

  it('charges the window when the session never asked, so a census still paces the gate', () => {
    // `wantsKeyframe` returns false for the whole duration of a census and for the rest of the
    // session once the budget is gone. Nothing is asked, so nothing can ever be delivered; a
    // clock that only moves on delivery would never move again.
    const fired = evaluateKeyframe(createKeyframeState(), GOOD);
    const settled = settleKeyframeRequest(
      fired.state, { requested: false, delivered: false }, GOOD.now, 6);
    expect(settled.lastFiredAt).toBe(GOOD.now);
    expect(evaluateKeyframe(settled, { ...GOOD, now: GOOD.now + 500 }).reason).toBe('too-soon');
  });

  it('charges nothing when the gate held, so a quiet scene cannot stall the clock', () => {
    // The case that makes the rule above safe. A held frame asks for nothing, so it has no
    // decision to settle; charging it would move the clock to now on every single frame and the
    // gate could then never fire at all.
    const held = evaluateKeyframe(createKeyframeState(), { ...GOOD, trackCount: 0 });
    expect(held.fire).toBe(false);
    const settled = settleKeyframeRequest(
      held.state, { requested: false, delivered: false }, GOOD.now, 0);
    expect(settled.lastFiredAt).toBe(0);
    expect(evaluateKeyframe(settled, GOOD).fire).toBe(true);
  });
});
