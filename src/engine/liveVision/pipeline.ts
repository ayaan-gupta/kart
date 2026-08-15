import { createTrackerState, updateTracks } from './byteTrack';
import { createKeyframeState, evaluateKeyframe } from './keyframe';
import type { BarcodeHit, Box, FrameScan, KeyframeReason, PipelineState, Track } from './types';

export function createPipelineState(): PipelineState {
  return { tracker: createTrackerState(), keyframe: createKeyframeState() };
}

/** Whether a normalized point falls inside a normalized box, edges included. */
function contains(box: Box, x: number, y: number): boolean {
  return x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h;
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
 *
 * The other half of that principle, and the easy thing to get wrong while fixing the first
 * half: the claim is scoped to a physical position, not to a payload string. A cart holding two
 * of the same yogurt is the most ordinary grocery behaviour there is, and both tubs deserve
 * their own track and their own UPC. So a payload is skipped only when its centre falls inside
 * the box of a track already carrying it, which is a repeated decode of one physical label. A
 * second identical product elsewhere in the cart is a different physical position and claims a
 * track of its own.
 */
function attachBarcodes(tracks: Track[], barcodes: BarcodeHit[]): Track[] {
  if (barcodes.length === 0) return tracks;

  // Where each already-claimed payload physically sits, including on lost tracks. A lost track
  // is a prediction of an item that has been seen, so its claim stands until the track is
  // dropped entirely.
  const holders = new Map<string, Box[]>();
  for (const track of tracks) {
    if (track.barcode === null) continue;
    const boxes = holders.get(track.barcode);
    if (boxes === undefined) holders.set(track.barcode, [track.box]);
    else boxes.push(track.box);
  }

  const claimedTracks = new Set<number>();
  const assignments = new Map<number, string>();

  for (const barcode of barcodes) {
    const cx = barcode.box.x + barcode.box.w / 2;
    const cy = barcode.box.y + barcode.box.h / 2;

    // Already claimed at this position, so this is the same physical label decoding again,
    // either on a later frame or twice within one frame. Vision reports one label twice often
    // enough to matter. A decode of the same payload somewhere else in the frame is a second
    // identical product and falls through to claim its own track.
    const held = holders.get(barcode.payload);
    if (held !== undefined && held.some((box) => contains(box, cx, cy))) continue;

    let bestIndex = -1;
    let bestArea = Infinity;
    tracks.forEach((track, index) => {
      if (track.barcode !== null || track.state === 'lost' || claimedTracks.has(index)) return;
      if (!contains(track.box, cx, cy)) return;

      const area = track.box.w * track.box.h;
      if (area < bestArea) {
        bestArea = area;
        bestIndex = index;
      }
    });

    if (bestIndex === -1) continue;
    claimedTracks.add(bestIndex);
    // Recorded as a holder immediately, so a repeated decode of this same label later in this
    // same frame is skipped by the position test above rather than claiming a second track.
    const boxes = holders.get(barcode.payload);
    if (boxes === undefined) holders.set(barcode.payload, [tracks[bestIndex].box]);
    else boxes.push(tracks[bestIndex].box);
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
