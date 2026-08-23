import { describe, expect, it } from '@jest/globals';
import { publishedScanState, nextScanRequest } from '../scanStep';
import { createSessionState, type RecognitionSession } from '../orchestrator';

/**
 * These behaviours could not be tested before.
 *
 * They lived inline in `scan.tsx`, which cannot be rendered under Jest (vision-camera's `Camera`,
 * `useFrameProcessor`, `useCameraDevice` and `useCameraPermission` have no native backing), and
 * were hand-mirrored in `dev/frame-lab.tsx`, where the occlusion half was a hardcoded `false`.
 * So the only checks on them were static ones that read the source as text.
 *
 * Pulling the reading into `scanStep.ts` makes it ordinary code with ordinary inputs. The session
 * is a stub because none of this touches the network: the functions read `session.state` and
 * call two pure helpers.
 */

interface StateOverrides {
  hidden?: boolean;
  censusCalls?: number;
  censusFailures?: number;
  identities?: Record<string, unknown>;
  thumbnails?: Record<string, string>;
}

/**
 * Built from the real `createSessionState()` rather than an object literal. A hand-written state
 * drifts from the real shape silently: the first draft of this file omitted `fusion.aliases` and
 * `bagLines` threw inside the function under test, which is a bug in the test and reads as a bug
 * in the code.
 */
function sessionWith(overrides: StateOverrides = {}): RecognitionSession {
  const base = createSessionState();
  const state = {
    ...base,
    fusion: { ...base.fusion, identities: overrides.identities ?? base.fusion.identities },
    occlusion: { ...base.occlusion, hidden: overrides.hidden ?? false },
    censusCalls: overrides.censusCalls ?? 0,
    censusFailures: overrides.censusFailures ?? 0,
    thumbnails: overrides.thumbnails ?? {},
  };
  return { state, wantsKeyframe: () => false } as unknown as RecognitionSession;
}

describe('publishedScanState', () => {
  describe('the unavailable verdict', () => {
    it('is false when nothing has been attempted', () => {
      // An idle scan is not a broken one. This is the state every session starts in.
      const next = publishedScanState(sessionWith(), [], 1_000, false);
      expect(next.unavailable).toBe(false);
    });

    it('is false when some censuses succeeded', () => {
      // The distinction the field exists for: one failure among successes is a bad frame, and
      // telling the shopper scanning is broken while the bag fills would be false.
      const next = publishedScanState(
        sessionWith({ censusCalls: 4, censusFailures: 1 }), [], 1_000, false);
      expect(next.unavailable).toBe(false);
    });

    it('is true only when every census attempted has failed', () => {
      const next = publishedScanState(
        sessionWith({ censusCalls: 3, censusFailures: 3 }), [], 1_000, false);
      expect(next.unavailable).toBe(true);
    });
  });

  describe('the occlusion episode edge', () => {
    it('reports a fresh episode when occlusion starts', () => {
      const next = publishedScanState(sessionWith({ hidden: true }), [], 1_000, false);
      expect(next.occluded).toBe(true);
      expect(next.freshOcclusionEpisode).toBe(true);
    });

    it('does not report a fresh episode while occlusion persists', () => {
      // The regression this guards: resetting coverage on every frame of one episode would
      // restart the capture guide continuously and it could never complete.
      const next = publishedScanState(sessionWith({ hidden: true }), [], 1_000, true);
      expect(next.freshOcclusionEpisode).toBe(false);
    });

    it('reports a fresh episode again after occlusion clears and returns', () => {
      // Why this is an edge and not a level. `orchestrator.ts` only writes `occlusion` from a
      // successful census, so a second episode inherits a possibly-complete coverage state and
      // its guide could never open without starting over.
      const cleared = publishedScanState(sessionWith({ hidden: false }), [], 1_000, true);
      expect(cleared.freshOcclusionEpisode).toBe(false);

      const returned = publishedScanState(
        sessionWith({ hidden: true }), [], 2_000, cleared.occluded);
      expect(returned.freshOcclusionEpisode).toBe(true);
    });
  });

  it('copies the identities rather than handing out the live object', () => {
    // The screens put this straight into React state. Handing over the session's own object
    // would make a later mutation invisible to React and visible on screen at a random moment.
    const identities = { a: { name: 'apples' } } as unknown as Record<string, never>;
    const next = publishedScanState(sessionWith({ identities }), [], 1_000, false);
    expect(next.identities).not.toBe(identities);
    expect(next.identities).toEqual(identities);
  });
});

describe('nextScanRequest', () => {
  it('passes the pipeline verdict through to wantsKeyframe', () => {
    // The pacing bug this pins: computing `evaluateKeyframe`'s verdict and then not passing it
    // means every frame is a candidate keyframe and the census budget burns in seconds.
    const seen: unknown[] = [];
    const session = {
      state: { thumbnails: {}, fusion: { identities: {} }, identifyCalls: 0 },
      wantsKeyframe: (...args: unknown[]) => { seen.push(args); return true; },
    } as unknown as RecognitionSession;

    nextScanRequest(session, [], true);
    expect(seen).toHaveLength(1);
    expect((seen[0] as unknown[])[1]).toBe(true);

    nextScanRequest(session, [], false);
    expect((seen[1] as unknown[])[1]).toBe(false);
  });
});
