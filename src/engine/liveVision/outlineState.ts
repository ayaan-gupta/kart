import { GREEN_CONFIDENCE } from './config';
import type { Identity, Track } from './types';

/**
 * The three states an item's outline can be in.
 *
 * Lives beside the engine rather than inside `ItemHighlights` because the rule is not a
 * rendering concern: the offline pipeline harness draws the same states over a captured frame
 * without React Native anywhere in the process, and it must not be allowed to re-implement
 * them. `ItemHighlights` re-exports both so its own consumers and tests are unaffected.
 */
export type OutlineState = 'counted' | 'closer' | 'forming';

/**
 * Which of the three states an item is in.
 *
 * Pure so the rule is testable without rendering. The ordering matters: `needsCloserLook` beats
 * a high confidence number, because a model that says "I am 99% sure but you should look
 * closer" is telling us something its confidence field cannot.
 *
 * `Number.isFinite` guards against a garbage confidence (NaN, +/-Infinity): `NaN < GREEN_CONFIDENCE`
 * is `false`, so without this check a corrupt confidence value would fail open into `'counted'`,
 * the most trusted state, and tell the user an item is confirmed when it is not.
 */
export function outlineStateFor(track: Track, identity: Identity | undefined): OutlineState {
  if (track.state === 'tentative' || !identity) return 'forming';
  if (
    identity.needsCloserLook ||
    !Number.isFinite(identity.confidence) ||
    identity.confidence < GREEN_CONFIDENCE
  ) {
    return 'closer';
  }
  return 'counted';
}
