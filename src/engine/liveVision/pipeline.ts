import { createTrackerState, updateTracks } from './byteTrack';
import { createKeyframeState, evaluateKeyframe } from './keyframe';
import type { BarcodeHit, FrameScan, KeyframeReason, PipelineState, Track } from './types';

export function createPipelineState(): PipelineState {
  return { tracker: createTrackerState(), keyframe: createKeyframeState() };
}

/**
 * Assigns each decoded barcode to at most one track: the smallest box that contains its
 * centre, the best guess at the item actually carrying the label.
 *
 * Boxes are axis-aligned, so stacked or adjacent cart items overlap routinely even when their
 * masks do not. Without a claim, a single physical UPC would attach to every track whose box
 * happens to cover it, turning one physical item into several counted products. A lost track
 * (a Kalman prediction of an item not actually seen this frame) never claims one either, so a
 * barcode read off an item still in view cannot bind to something that already left.
 *
 * A barcode already attached to a track is never cleared by a frame that failed to decode it.
 * Barcodes read intermittently as the cart shifts, and a decoded UPC is the only certain
 * identification this pipeline ever produces, so it is kept once earned.
 *
 * The general principle, which this pipeline has now got wrong in four separate places: an
 * identity claim must hold for the life of the scan, not the life of a frame. Every rule here
 * that stops one physical item being counted twice has to be checked against the state carried
 * forward from previous frames, not only against what this frame happens to be doing. A rule
 * that is enforced per frame and reset every frame is not a rule at all, because the scan runs
 * at several frames a second for as long as the user holds the phone up.
 */
function attachBarcodes(tracks: Track[], barcodes: BarcodeHit[]): Track[] {
  if (barcodes.length === 0) return tracks;

  // Payloads any track already carries, including lost ones. A payload in here is spoken for
  // by a physical item that has been seen, so it must not be handed to a second track on a
  // later frame just because the first track is no longer eligible to re-claim it.
  const heldPayloads = new Set<string>();
  for (const track of tracks) {
    if (track.barcode !== null) heldPayloads.add(track.barcode);
  }

  const claimedTracks = new Set<number>();
  const assignments = new Map<number, string>();

  for (const barcode of barcodes) {
    if (heldPayloads.has(barcode.payload)) continue;

    const cx = barcode.box.x + barcode.box.w / 2;
    const cy = barcode.box.y + barcode.box.h / 2;

    let bestIndex = -1;
    let bestArea = Infinity;
    tracks.forEach((track, index) => {
      if (track.barcode !== null || track.state === 'lost' || claimedTracks.has(index)) return;
      const contains =
        cx >= track.box.x &&
        cx <= track.box.x + track.box.w &&
        cy >= track.box.y &&
        cy <= track.box.y + track.box.h;
      if (!contains) return;

      const area = track.box.w * track.box.h;
      if (area < bestArea) {
        bestArea = area;
        bestIndex = index;
      }
    });

    if (bestIndex === -1) continue;
    claimedTracks.add(bestIndex);
    // Held from this point on, so a second decode of the same payload later in this same frame
    // cannot land on a different track either. Vision can report one label twice.
    heldPayloads.add(barcode.payload);
    assignments.set(bestIndex, barcode.payload);
  }

  return tracks.map((track, index) => {
    const payload = assignments.get(index);
    return payload !== undefined ? { ...track, barcode: payload } : track;
  });
}

export function processFrame(
  state: PipelineState,
  scan: FrameScan,
  now: number,
): { state: PipelineState; tracks: Track[]; keyframe: { fire: boolean; reason: KeyframeReason } } {
  const tracker = updateTracks(state.tracker, scan.instances, now);
  const tracks = attachBarcodes(tracker.tracks, scan.barcodes);

  // The gate counts confirmed tracks, not raw detections. A frame whose only content is
  // unconfirmed noise is not worth an upload.
  const confirmed = tracks.filter((track) => track.state === 'confirmed').length;
  const keyframe = evaluateKeyframe(state.keyframe, {
    sharpness: scan.sharpness,
    motion: scan.motion,
    trackCount: confirmed,
    now,
  });

  return {
    state: { tracker: { ...tracker, tracks }, keyframe: keyframe.state },
    tracks,
    keyframe: { fire: keyframe.fire, reason: keyframe.reason },
  };
}
