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
  /** Minimum IoU for a track and a detection to be allowed to pair. */
  minIou: number;
  /** How long a confirmed track survives with no detection before it is removed. */
  maxLostMs: number;
  /** Detections needed before a track is trusted enough to be confirmed. */
  minHits: number;
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
   * Why this frame produced no instances, when the reason was a failure rather than an empty
   * cart. Null on a healthy frame. A plain string, never a native error object: a detector that
   * throws every frame is otherwise indistinguishable from one that works and sees nothing.
   */
  error: string | null;
}

export interface PipelineState {
  tracker: TrackerState;
  keyframe: KeyframeState;
}
