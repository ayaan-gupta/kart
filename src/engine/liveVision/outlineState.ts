import { COVERED_FRACTION, GREEN_CONFIDENCE } from './config';
import type { Identity, Track } from './types';

/**
 * The four states an item's outline can be in.
 *
 * Lives beside the engine rather than inside `ItemHighlights` because the rule is not a
 * rendering concern: the offline pipeline harness draws the same states over a captured frame
 * without React Native anywhere in the process, and it must not be allowed to re-implement
 * them. `ItemHighlights` re-exports both so its own consumers and tests are unaffected.
 */
export type OutlineState = 'counted' | 'covered' | 'closer' | 'forming';

/**
 * Which of the four states an item is in.
 *
 * Pure so the rule is testable without rendering. The ordering matters, and each step of it is
 * a product decision:
 *
 * `counted` wins outright. An item already identified and in the bag does not become a problem
 * because something was later set down in front of it; the answer is already banked.
 *
 * `covered` beats both of the remaining states, because it is the only one that tells the
 * shopper what to *do*. An item we cannot see is not going to be identified by looking harder
 * from here, and reporting it as merely unrecognized invites exactly that. Reporting it as
 * covered asks them to move what is on top of it, which is the action that fixes it.
 *
 * `needsCloserLook` then beats a high confidence number, because a model that says "I am 99%
 * sure but you should look closer" is telling us something its confidence field cannot.
 *
 * `Number.isFinite` guards against a garbage confidence (NaN, +/-Infinity): `NaN >= GREEN_CONFIDENCE`
 * is `false`, so a corrupt confidence value falls out of `'counted'` rather than into it, and
 * an item is never reported as confirmed on the strength of a number that is not one.
 *
 * `hidden` defaults to zero so every existing caller keeps the behaviour it had: with nothing
 * covering an item, the four states collapse back to the three that were here before.
 */
export function outlineStateFor(
  track: Track,
  identity: Identity | undefined,
  hidden: number = 0,
): OutlineState {
  const counted =
    track.state !== 'tentative' &&
    identity !== undefined &&
    !identity.needsCloserLook &&
    Number.isFinite(identity.confidence) &&
    identity.confidence >= GREEN_CONFIDENCE;
  if (counted) return 'counted';
  if (hidden >= COVERED_FRACTION) return 'covered';
  if (track.state === 'tentative' || !identity) return 'forming';
  return 'closer';
}
