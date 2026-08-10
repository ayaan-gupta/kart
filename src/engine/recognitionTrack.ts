/**
 * Real recognition results for assets/videos/scan.mp4, a top-down shot of a
 * full grocery spread. Apple's Vision classifier was run over each item's
 * region of the actual footage (scripts/classify-regions.swift), frame by
 * frame. Each entry carries the model's peak score for that item's label and
 * the item's bounding box in the frame, so the scan screen can outline the
 * real item as it is recognized and tint it green once counted. Items the
 * model never resolved (the mango, the jalapenos) stay untinted, which is
 * exactly what a shopper still has left to scan.
 *
 * Fire times are lightly spaced for legibility; the clip loops and the scan
 * timeline keeps counting across loops.
 */

export interface TrackBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TrackEntry {
  atSec: number;
  skuCode: string;
  label: string;
  /** The model's peak confidence for this label on this region. Absent when it never scored cleanly. */
  confidence?: number;
  /** Normalized to the video frame, measured at boxesAtSec. */
  box: TrackBox;
}

export const SCAN_VIDEO = {
  width: 496,
  height: 1080,
  durationSec: 7,
  /** The camera drifts slowly left: measured -16px over 6.6s at full res. */
  driftXPerSec: -0.00489,
  boxesAtSec: 0.5,
} as const;

export const RECOGNITION_TRACK: TrackEntry[] = [
  { atSec: 1.4, skuCode: '0417', label: 'grape', confidence: 0.61, box: { x: 0.0, y: 0.26, w: 0.42, h: 0.25 } },
  { atSec: 3.8, skuCode: '0418', label: 'lemon', confidence: 0.32, box: { x: 0.65, y: 0.42, w: 0.33, h: 0.16 } },
  { atSec: 4.8, skuCode: '0423', label: 'bell_pepper', confidence: 0.33, box: { x: 0.1, y: 0.415, w: 0.56, h: 0.26 } },
  { atSec: 5.8, skuCode: '0422', label: 'strawberry', confidence: 0.4, box: { x: 0.01, y: 0.165, w: 0.28, h: 0.14 } },
  { atSec: 9.3, skuCode: '0424', label: 'corn', confidence: 0.91, box: { x: 0.18, y: 0.69, w: 0.52, h: 0.3 } },
  // The model read this bulb as onion over garlic and never crossed a clean
  // score, so it lands late and without a match percentage.
  { atSec: 11.5, skuCode: '0425', label: 'garlic', box: { x: 0.08, y: 0.66, w: 0.25, h: 0.14 } },
];

export const TRACK_HINT = {
  atSec: 7.6,
  text: 'The garlic has not been counted yet. Hold the camera over it for a second.',
  /** The hint is about this SKU; it clears the moment the item finally lands. */
  clearOnSku: '0425',
};
