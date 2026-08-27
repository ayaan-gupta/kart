import { MAX_KEYFRAME_MOTION, MIN_KEYFRAME_SHARPNESS } from './config';
import type { KeyframeConfig, KeyframeReason, KeyframeSignals, KeyframeState } from './types';

/**
 * `minSharpness` and `maxMotion` come from `config.ts`, the single home for both thresholds:
 * the same two values gate the native keyframe encode (see `frameProcessor.ts`, which sends
 * `MIN_KEYFRAME_SHARPNESS`/`MAX_KEYFRAME_MOTION` to the plugin). This module used to carry its
 * own, unrelated copies (100 and 0.02, against config.ts's 12 and 0.06), so tuning one side
 * left the other silently disagreeing. Sharing the constants makes that impossible: the JS gate
 * below and the native gate now agree by construction on what counts as sharp and still enough.
 *
 * `minIntervalMs`, `sceneChangeCount` and `sceneChangeIntervalMs` have no native counterpart;
 * they govern only the pacing decision this module makes, so they stay local.
 */
const DEFAULT_CONFIG: KeyframeConfig = {
  minSharpness: MIN_KEYFRAME_SHARPNESS,
  maxMotion: MAX_KEYFRAME_MOTION,
  minIntervalMs: 2000,
  sceneChangeCount: 4,
  sceneChangeIntervalMs: 800,
};

export function createKeyframeState(): KeyframeState {
  return { lastFiredAt: 0, lastTrackCount: 0, recentSharpness: [], awaitingKeyframe: false };
}

/**
 * How many recent frames the adaptive blur floor is drawn from, and where in that window it sits.
 *
 * At the detector's few-frames-a-second pace, 40 samples is roughly the last ten seconds: long
 * enough that one lucky frame cannot drag the floor up and strand the gate, short enough to
 * follow a shopper walking from a dim aisle into a bright one.
 *
 * The quantile is what decides how often the gate can fire at all. At 0.6 the sharpest 40% of
 * recent frames are eligible, so the pacing interval, not the blur test, sets the rate. That is
 * the correct division of labour: `minIntervalMs` already caps spend at one call every two
 * seconds, so the blur test's only remaining job is picking the better frames out of whatever is
 * on offer, not deciding whether to scan at all.
 */
const SHARPNESS_WINDOW = 40;
const SHARPNESS_QUANTILE = 0.6;

/**
 * A floor that rejects a genuinely dead frame no matter what the window says.
 *
 * Without it, a session that opens on a covered lens would compute a floor of zero from its own
 * all-zero history and treat black frames as its best available. Deliberately far below the 1
 * measured as a real dim-room median, so it only ever catches readings that carry no signal.
 */
const ABSOLUTE_SHARPNESS_FLOOR = 0.5;

/**
 * The blur floor for the next frame, given what recent frames have looked like.
 *
 * Exported for the tests, and because `pipeline.ts` hands the same number to the native half of
 * the gate: the two must apply an identical floor or a frame JavaScript asked for gets refused
 * on arrival.
 */
export function adaptiveMinSharpness(recent: number[]): number {
  // Below a useful sample the window says nothing, so fall back to the absolute floor rather
  // than to `MIN_KEYFRAME_SHARPNESS`. Opening a scan on the old constant would reject the first
  // seconds of every session on exactly the devices this change exists for.
  if (recent.length < 8) return ABSOLUTE_SHARPNESS_FLOOR;
  const sorted = [...recent].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * SHARPNESS_QUANTILE));
  return Math.max(ABSOLUTE_SHARPNESS_FLOOR, sorted[index]);
}

export function evaluateKeyframe(
  state: KeyframeState,
  signals: KeyframeSignals,
  overrides: Partial<KeyframeConfig> = {},
): {
  fire: boolean;
  reason: KeyframeReason;
  state: KeyframeState;
  /** The floor applied here, for the native half of the gate to apply to the next frame. */
  minSharpness: number;
} {
  const config = { ...DEFAULT_CONFIG, ...overrides };

  // Recorded before any early return. A frame held for being blurry is still evidence of what
  // this scene looks like, and it is the most common frame in exactly the sessions the adaptive
  // floor exists to rescue; dropping those samples would leave the window describing only frames
  // that already passed.
  const recentSharpness = [...state.recentSharpness, signals.sharpness].slice(-SHARPNESS_WINDOW);
  // `awaitingKeyframe: false` on every path that holds. A frame the gate declines to fire on
  // asks native for nothing, so there is no outstanding decision for the next frame to settle.
  const next = { ...state, recentSharpness, awaitingKeyframe: false };

  // An explicit override still wins outright. `server/eval/pipeline/video-states.ts` sweeps these
  // thresholds to measure them, and a swept value silently replaced by an adaptive one would
  // report the adaptive gate's behaviour under every arm of the sweep.
  const minSharpness =
    overrides.minSharpness ?? adaptiveMinSharpness(state.recentSharpness);

  const hold = (reason: KeyframeReason) => ({
    fire: false, reason, state: next, minSharpness,
  });

  if (signals.trackCount === 0) return hold('nothing-to-see');
  if (signals.sharpness < minSharpness) return hold('blurry');
  if (signals.motion > config.maxMotion) return hold('moving');

  const elapsed = signals.now - state.lastFiredAt;
  const sceneChanged =
    Math.abs(signals.trackCount - state.lastTrackCount) >= config.sceneChangeCount;
  const required = sceneChanged ? config.sceneChangeIntervalMs : config.minIntervalMs;

  if (elapsed < required) return hold('too-soon');

  // The pacing clock is deliberately NOT advanced here: deciding is not delivering, and which
  // of the two happened is only known one frame later. See `settleKeyframeRequest`.
  return {
    fire: true, reason: 'fire', state: { ...next, awaitingKeyframe: true }, minSharpness,
  };
}

/**
 * Settles the decision the previous frame made, now that its outcome is known.
 *
 * The gate is a handshake with a one-frame lag. JavaScript decides on frame N; native re-tests
 * frame N+1 against the same blur floor before spending an encode. So `evaluateKeyframe` cannot
 * start the pacing interval itself - it does not yet know whether a keyframe will exist - and
 * this runs one frame later, when it does.
 *
 * Three outcomes, and only one of them is free:
 *
 *   * **delivered** - a keyframe came back. The window was spent on an upload, which is what the
 *     interval is for. Charged.
 *   * **declined** - the request went to native and native refused the frame, because it got
 *     blurrier in the intervening frame. Nothing was encoded and nothing was uploaded, so
 *     nothing was spent. Not charged, and the gate asks again on the very next frame.
 *   * **never asked** - the gate fired but `RecognitionSession.wantsKeyframe` said no, so no
 *     request reached native at all. Charged, and this is the subtle one.
 *
 * That last case is why this takes `requested` rather than just looking at whether a keyframe
 * came back. The session declines for the whole duration of a census, and for the rest of the
 * session once the budget is gone. Nothing is asked, so nothing can ever be delivered, so a
 * clock keyed on delivery alone would never advance again and the gate would fire on every
 * single frame. That costs nothing directly - the request is a boolean nobody sends - but it
 * means `minIntervalMs` stops spacing censuses at all, and the next census starts the instant
 * the previous one lands. Charging the window for a decision the session threw away keeps the
 * interval doing the one job it has.
 *
 * Measured before any of this, over 1440 frames of `server/eval/replay` across four cart clips
 * with the clock started at the decision: 22 decisions produced 4 uploads, an 18 per cent
 * delivery rate, and one census per twelve-second clip against a per-session budget of eight.
 * Refusing a blurry frame is right. Charging the capture window for it is not, and the shopper
 * pays for it in an emptier bag.
 */
export function settleKeyframeRequest(
  state: KeyframeState,
  outcome: { requested: boolean; delivered: boolean },
  now: number,
  trackCount: number,
): KeyframeState {
  // Nothing outstanding: the previous frame held, so there is no decision to settle and the
  // clock must not move. Without this the common case - a quiet scene the gate never fired on -
  // would charge the window on every frame and the gate could never fire at all.
  if (!state.awaitingKeyframe) return state;
  // Asked for, and refused. The one free outcome.
  if (outcome.requested && !outcome.delivered) return state;
  return { ...state, lastFiredAt: now, lastTrackCount: trackCount, awaitingKeyframe: false };
}
