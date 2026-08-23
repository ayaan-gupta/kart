/**
 * The two things a scan screen must do after every frame and after every recognition result,
 * in one place because there are two screens and they drifted.
 *
 * `scan.tsx` is the product. `dev/frame-lab.tsx` is the harness that stands in for it wherever a
 * camera is unavailable, which on a Simulator is everywhere: `useCameraDevice('back')` returns
 * null there, so the real screen's `<Camera>` branch never renders and every end-to-end claim
 * about the app has come from the harness instead.
 *
 * That only works while the two agree, and twice they did not:
 *
 *   * the harness called `session.onKeyframe` for months after the product moved to
 *     `session.onCapture`, so every "the app reaches the service" result described the older
 *     path where the device sends marks and the service does not enumerate;
 *   * the harness passed a literal `occluded: false` into `guideVisible` against a coverage state
 *     with no setter, so the occluded notice and the capture guide could not appear on it, and
 *     requirement 3 in CLAUDE.md had no exercise on any screen that draws.
 *
 * Both typechecked. Both left the bag correct, which is the one thing anybody checks. Pinning the
 * call sites with a test catches the next instance; sharing the code removes the surface.
 *
 * Nothing here touches React or the network: these are pure readings of session state, so both
 * screens apply the same values and the reading itself is unit-testable without a camera, a
 * server or a simulator.
 */
import { bagLines, type BagLine } from './fusion';
import { persistentAmber, tracksNeedingThumbnail, type RecognitionSession } from './orchestrator';
import type { Identity, ScanRequest, Track } from './types';

/** Everything a screen shows that is derived from session state after a result lands. */
export interface PublishedScanState {
  identities: Record<string, Identity>;
  /** The census's occlusion verdict for the frame it last answered. */
  occluded: boolean;
  /**
   * True on the first frame of a new occlusion episode, meaning the screen should start a fresh
   * coverage requirement.
   *
   * `orchestrator.ts` only writes `state.occlusion` from a successful census, so once the census
   * budget is spent the verdict never changes again. `coachKind` and `guideVisible` therefore key
   * their exit on coverage completing instead, and coverage may already be complete from an
   * earlier episode, which would leave a second episode unable to open its guide at all. Starting
   * over is what keeps the exit meaningful the second time.
   */
  freshOcclusionEpisode: boolean;
  amberPersists: boolean;
  /**
   * Every census this session attempted has failed. Not "the last one failed": one failure among
   * successes is a bad frame, and saying scanning is broken because of it would be false while
   * the bag is visibly filling.
   */
  unavailable: boolean;
  bag: BagLine[];
  thumbnails: Record<string, string>;
}

/**
 * Reads the session once and returns what to show.
 *
 * `wasOccluded` is the previous call's `occluded`, which the caller holds because this function
 * keeps no state of its own; passing it is what makes `freshOcclusionEpisode` an edge rather than
 * a level.
 *
 * `tracks` must be the captured tracks once a capture has landed, never the frame's own. The
 * frame's come from `AppleInstanceMaskDetector`, which outlines a whole trolley as roughly one
 * blob, so amber computed from them is amber over one track instead of eight.
 */
export function publishedScanState(
  session: RecognitionSession,
  tracks: Track[],
  now: number,
  wasOccluded: boolean,
): PublishedScanState {
  const state = session.state;
  const occluded = state.occlusion.hidden;
  return {
    identities: { ...state.fusion.identities },
    occluded,
    freshOcclusionEpisode: occluded && !wasOccluded,
    amberPersists: persistentAmber(state, tracks, now),
    unavailable: state.censusFailures > 0 && state.censusFailures === state.censusCalls,
    bag: bagLines(state.fusion),
    thumbnails: state.thumbnails,
  };
}

/**
 * What the next frame should be asked for.
 *
 * Both readings touch `session.state` and must therefore run on the JS thread, never inside the
 * frame processor worklet. `keyframeFire` is `evaluateKeyframe`'s verdict for the frame just
 * processed, passed through so it actually gates the request rather than being computed and
 * discarded.
 */
export function nextScanRequest(
  session: RecognitionSession,
  tracks: Track[],
  keyframeFire: boolean,
): ScanRequest {
  return {
    wantKeyframe: session.wantsKeyframe(tracks, keyframeFire),
    cropTrackIds: tracksNeedingThumbnail(session.state, tracks),
  };
}
