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
  return { lastFiredAt: 0, lastTrackCount: 0 };
}

export function evaluateKeyframe(
  state: KeyframeState,
  signals: KeyframeSignals,
  overrides: Partial<KeyframeConfig> = {},
): { fire: boolean; reason: KeyframeReason; state: KeyframeState } {
  const config = { ...DEFAULT_CONFIG, ...overrides };
  const hold = (reason: KeyframeReason) => ({ fire: false, reason, state });

  if (signals.trackCount === 0) return hold('nothing-to-see');
  if (signals.sharpness < config.minSharpness) return hold('blurry');
  if (signals.motion > config.maxMotion) return hold('moving');

  const elapsed = signals.now - state.lastFiredAt;
  const sceneChanged =
    Math.abs(signals.trackCount - state.lastTrackCount) >= config.sceneChangeCount;
  const required = sceneChanged ? config.sceneChangeIntervalMs : config.minIntervalMs;

  if (elapsed < required) return hold('too-soon');

  return {
    fire: true,
    reason: 'fire',
    state: { lastFiredAt: signals.now, lastTrackCount: signals.trackCount },
  };
}
