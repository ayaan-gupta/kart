import type { BoxFilter } from './kalman';

/** Normalized to the camera frame, origin top-left, values 0-1. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * A closed outline, flat as `[x0, y0, x1, y1, ...]`, normalized to the frame with origin
 * top-left. Flat rather than an array of points because this crosses the JSI boundary on
 * every detection, where one contiguous number array is markedly cheaper than N objects.
 */
export type Polygon = number[];

/** One class-agnostic instance from the detector. The detector never names anything. */
export interface DetectedInstance {
  box: Box;
  polygon: Polygon;
  /** Detector confidence that this region is a distinct object, 0 to 1. Not a class score. */
  score: number;
}

export type TrackState = 'tentative' | 'confirmed' | 'lost';

/**
 * One physical item, followed across frames. The id is the unit of quantity in Plan 3, so it
 * must be stable for as long as the item is the same item, and never reused.
 */
export interface Track {
  id: string;
  box: Box;
  polygon: Polygon;
  score: number;
  state: TrackState;
  hits: number;
  lastSeenAt: number;
  /** Decoded UPC if the barcode fast path saw one over this track. Resolved in Plan 3. */
  barcode: string | null;
  filter: BoxFilter;
}

export interface TrackerState {
  tracks: Track[];
  nextId: number;
}

export interface ByteTrackConfig {
  /** At or above this score a detection can both match and seed a track. */
  highThreshold: number;
  /** Below this score a detection is discarded outright. */
  lowThreshold: number;
  /** Minimum IoU for a track and a detection to be allowed to pair, in the high-score stage. */
  minIou: number;
  /**
   * Minimum IoU for the low-score recovery stage. Stricter than `minIou`: reference value 0.5
   * (byte_tracker.py hardcodes this for stage two, versus match_thresh=0.8 cost / IoU>=0.2 for
   * stage one). A low-confidence detection is the least trustworthy input the tracker sees, so
   * it needs a tighter geometric match before it is allowed to reattach a track's identity.
   */
  recoverMinIou: number;
  /** How long a confirmed track survives with no detection before it is removed. */
  maxLostMs: number;
  /** Detections needed before a track is trusted enough to be confirmed. */
  minHits: number;
  /**
   * Shift every prediction by the translation common to all tracks before associating. The
   * Kalman filter estimates each track's own velocity and cannot see a camera that pans, which
   * at three frames a second is most of the movement in a handheld scan.
   */
  globalShift: boolean;
  /** Below this many tracks or detections the shared shift is a coin toss, so it is not used. */
  minTracksForShift: number;
}

export interface KeyframeSignals {
  /** Variance of the Laplacian over the luma plane. Higher is sharper. Not normalized. */
  sharpness: number;
  /** Mean absolute luma difference against the previous frame, 0 to 1. Higher is more motion. */
  motion: number;
  trackCount: number;
  now: number;
}

export interface KeyframeState {
  lastFiredAt: number;
  lastTrackCount: number;
  /**
   * Sharpness readings from the most recent frames, newest last, for the adaptive blur floor.
   *
   * A fixed `minSharpness` cannot work. The shipped 12 was calibrated against `score_video.py`'s
   * whole-frame variance of the Laplacian, but `FrameMetrics.sharpness` reports the largest of a
   * 3 by 3 grid of native-resolution tiles, which is a different statistic on a different scale.
   * Measured on a real iPhone in a dim room: median 1, max 487 over 390 frames. Every frame was
   * rejected and the scan sent nothing at all, with no error, for its whole life.
   *
   * Scaling the constant would only move the failure: the same number that admits a dim bedroom
   * would admit everything under store lighting, where readings run orders of magnitude higher.
   * What the gate actually wants is the sharpest frames *available right now*, so the floor is
   * derived from this window instead of asserted ahead of time.
   */
  recentSharpness: number[];
  /**
   * Whether the previous frame's gate decided to fire and what became of that decision is not
   * yet known.
   *
   * The gate is a handshake across a one-frame lag, so a decision is not yet an upload and must
   * not start the pacing interval on its own. This is what the next frame needs in order to tell
   * a decision it has to settle from a quiet frame that never fired at all. See
   * `settleKeyframeRequest`.
   */
  awaitingKeyframe: boolean;
}

export type KeyframeReason = 'fire' | 'blurry' | 'moving' | 'too-soon' | 'nothing-to-see';

export interface KeyframeConfig {
  minSharpness: number;
  maxMotion: number;
  minIntervalMs: number;
  /** Change in track count that counts as a new scene worth an early look. */
  sceneChangeCount: number;
  /** Floor on the interval even for a scene change, so a churning detector cannot spam. */
  sceneChangeIntervalMs: number;
}

export interface BarcodeHit {
  payload: string;
  symbology: string;
  box: Box;
}

export interface ThumbnailCrop {
  /** The track id this picture belongs to, echoed back from the request. */
  id: string;
  /** Base64 JPEG, no data URL prefix. */
  jpeg: string;
}

export interface ScanRequest {
  wantKeyframe: boolean;
  cropTrackIds: { id: string; box: Box }[];
  /**
   * The blur floor the native half should apply to the frame it is about to measure.
   *
   * Both halves of the gate have to agree or neither fires: JavaScript decides it wants a
   * keyframe from frame N's readings, and native re-tests frame N+1 before spending an encode on
   * it. While this was the constant `MIN_KEYFRAME_SHARPNESS` that agreement was free. Now that
   * the floor adapts, it has to travel with the request, or native would keep applying the old
   * constant and refuse every frame JavaScript asked for.
   *
   * Optional so `frame-lab.tsx`, which pushes a bundled image at the plugin with no session
   * behind it, keeps working; `buildScanCartArgs` falls back to the constant.
   */
  minSharpness?: number;
}

/** Exactly what the native frame processor returns for one frame. */
export interface FrameScan {
  instances: DetectedInstance[];
  barcodes: BarcodeHit[];
  sharpness: number;
  motion: number;
  /** Upright frame dimensions, already corrected for sensor rotation natively. */
  width: number;
  height: number;
  /**
   * The orientation VisionCamera reported for this frame's buffer, carried through purely so a
   * development build can print it.
   *
   * It is the one input to the native `CGImagePropertyOrientation` conversion that nothing on the
   * JavaScript side could see, and the overlay is drawing every silhouette rotated 180 degrees,
   * which is what a wrong choice inside that conversion looks like. Optional because only the
   * live camera path sets it: `frame-lab.tsx` pushes a bundled image straight at the plugin and
   * has no `Frame` to read it from.
   */
  orientation?: string;
  /**
   * The thresholds the native half of the gate actually parsed for this frame, echoed back.
   *
   * The two halves have to agree, and when they silently disagreed there was no symptom at all:
   * JavaScript believed it had sent a reachable `minSharpness` while native's cast failed and
   * left it at infinity, so every frame was refused and the scan uploaded nothing, forever, with
   * no error. Reading native's own number back is the only way to see that from this side.
   */
  gateMinSharpness?: number;
  gateMaxMotion?: number;
  /**
   * Whether this frame's request actually asked native for a keyframe.
   *
   * Recorded by `scanCart` from the request it just used, rather than read back off the shared
   * value afterwards: the scan screen rewrites that value again whenever an async result lands,
   * so by the time this frame's reply is handled it may no longer be what the worklet sent. The
   * pacing rule turns on this exact bit - a request native refused costs nothing, a decision the
   * session never sent still costs the window - so it is taken from the one place that cannot
   * disagree with what went over the boundary.
   */
  wantedKeyframe: boolean;
  /**
   * Why this frame produced no instances, when the reason was a failure rather than an empty
   * cart. Null on a healthy frame. A plain string, never a native error object: a detector that
   * throws every frame is otherwise indistinguishable from one that works and sees nothing.
   */
  error: string | null;
  /** Base64 JPEG of an upload-worthy frame, or null. Non-null only when both halves of the
   * keyframe gate agreed, so its presence is itself the signal to upload. */
  keyframe: string | null;
  crops: ThumbnailCrop[];
}

export interface PipelineState {
  tracker: TrackerState;
  keyframe: KeyframeState;
}

/**
 * `Identity` and `IdentitySource` are defined in `fusion.ts`, which produces them, and
 * re-exported here so the UI can import types without reaching into the async session machinery
 * via a longer path. Do not redefine them here: two independent copies previously drifted (the
 * copy here was missing `placeholder`), and structural typing hid the mismatch from `tsc`.
 */
export type { Identity, IdentitySource } from './fusion';
