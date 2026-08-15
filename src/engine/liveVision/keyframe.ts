import type { KeyframeConfig, KeyframeReason, KeyframeSignals, KeyframeState } from './types';

/**
 * Thresholds are starting points, not measurements. `minSharpness` in particular is in the
 * arbitrary units of variance-of-Laplacian over an 8-bit luma plane and depends on the camera
 * and on the window the metric is measured over, so it has to be re-tuned against the numbers a
 * real device reports before this gate can be trusted. `scripts/detector-bench` prints the
 * values it sees, and it computes them by calling the same `FrameMetrics` the device does, so
 * its `sharp` column is directly comparable to what the phone will report.
 *
 * `maxMotion` is the one threshold the bench cannot tune from a folder of unrelated photos,
 * because motion is a comparison between consecutive frames. See docs/detector-measurement.md.
 */
const DEFAULT_CONFIG: KeyframeConfig = {
  minSharpness: 100,
  maxMotion: 0.02,
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
