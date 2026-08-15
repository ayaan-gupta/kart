import { createTrackerState, updateTracks } from './byteTrack';
import { createKeyframeState, evaluateKeyframe } from './keyframe';
import type { BarcodeHit, FrameScan, KeyframeReason, PipelineState, Track } from './types';

export function createPipelineState(): PipelineState {
  return { tracker: createTrackerState(), keyframe: createKeyframeState() };
}

/**
 * Assigns each decoded barcode to the track it sits on top of.
 *
 * A barcode already attached to a track is never cleared by a frame that failed to decode it.
 * Barcodes read intermittently as the cart shifts, and a decoded UPC is the only certain
 * identification this pipeline ever produces, so it is kept once earned.
 */
function attachBarcodes(tracks: Track[], barcodes: BarcodeHit[]): Track[] {
  if (barcodes.length === 0) return tracks;

  return tracks.map((track) => {
    if (track.barcode !== null) return track;

    const hit = barcodes.find((barcode) => {
      const cx = barcode.box.x + barcode.box.w / 2;
      const cy = barcode.box.y + barcode.box.h / 2;
      return (
        cx >= track.box.x &&
        cx <= track.box.x + track.box.w &&
        cy >= track.box.y &&
        cy <= track.box.y + track.box.h
      );
    });

    return hit ? { ...track, barcode: hit.payload } : track;
  });
}

export function processFrame(
  state: PipelineState,
  scan: FrameScan,
  now: number,
): { state: PipelineState; tracks: Track[]; keyframe: { fire: boolean; reason: KeyframeReason } } {
  const tracker = updateTracks(state.tracker, scan.instances, now);
  const tracks = attachBarcodes(tracker.tracks, scan.barcodes);

  // The gate counts every currently tracked item, tentative or confirmed. ByteTrack's minHits
  // means a real item stays tentative for its first couple of hits, so gating on confirmed-only
  // would leave the shutter closed for the first several frames of every single item, including
  // a lone item that was scanned once, sharply, and never moved.
  const keyframe = evaluateKeyframe(state.keyframe, {
    sharpness: scan.sharpness,
    motion: scan.motion,
    trackCount: tracks.length,
    now,
  });

  return {
    state: { tracker: { ...tracker, tracks }, keyframe: keyframe.state },
    tracks,
    keyframe: { fire: keyframe.fire, reason: keyframe.reason },
  };
}
