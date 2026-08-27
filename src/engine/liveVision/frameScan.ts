import {
  MAX_KEYFRAME_MOTION,
  MIN_KEYFRAME_SHARPNESS,
  THUMBNAIL_PADDING,
  ENABLE_BARCODE_FAST_PATH,
} from './config';
import type { FrameScan, ScanRequest, ThumbnailCrop } from './types';

/**
 * The two halves of the frame processor's contract with native, with no camera in them.
 *
 * `buildScanCartArgs` is everything the app asks a frame for; `toFrameScan` is everything it
 * accepts back. Both are pure data shaping, and both used to live in `frameProcessor.ts` beside
 * `scanCart`, which imports `react-native-vision-camera` at module scope. That import is the
 * reason they are here instead: it resolves only inside a React Native bundle, so any Node
 * harness that wanted to speak to the native side had to hand-maintain its own copy of the
 * argument shape and its own reply parser, and a copy that drifts is a harness measuring itself.
 *
 * `server/eval/replay/run.ts` drives the real native analysis in a subprocess and needs exactly
 * these two functions and nothing else from this layer. `frameProcessor.ts` re-exports them, so
 * every existing import site is unchanged and there is still one definition.
 *
 * The `'worklet'` directives travel with them: they are inert in ordinary JavaScript and in
 * Node, and required on a device, where a function called from inside `scanCart`'s worklet body
 * without one throws on every single call.
 */

/**
 * Shapes a native reply into a FrameScan.
 *
 * Separate from `scanCart` so it can be tested without a camera, and defensive because a
 * malformed reply reaches this from a worklet thread where a throw is not recoverable.
 *
 * `wantedKeyframe` is the one field that does not come from the reply: it is what the caller
 * asked for on this same frame, carried through so the result records both halves of the
 * handshake. Required rather than defaulted, because a caller that forgets it would silently
 * report that nothing was ever asked, and the pacing rule reads exactly this bit.
 */
export function toFrameScan(raw: unknown, wantedKeyframe: boolean): FrameScan {
  'worklet';
  const r = (raw ?? {}) as Record<string, unknown>;

  const crops: ThumbnailCrop[] = [];
  if (Array.isArray(r.crops)) {
    for (const entry of r.crops) {
      const c = entry as Record<string, unknown>;
      if (typeof c?.id === 'string' && typeof c?.jpeg === 'string' && c.jpeg.length > 0) {
        crops.push({ id: c.id, jpeg: c.jpeg });
      }
    }
  }

  const keyframe = typeof r.keyframe === 'string' && r.keyframe.length > 0 ? r.keyframe : null;

  return {
    instances: Array.isArray(r.instances) ? (r.instances as FrameScan['instances']) : [],
    barcodes: Array.isArray(r.barcodes) ? (r.barcodes as FrameScan['barcodes']) : [],
    sharpness: typeof r.sharpness === 'number' ? r.sharpness : 0,
    // A frame we could not read reports maximum motion, so it is never mistaken for a still one.
    motion: typeof r.motion === 'number' ? r.motion : 1,
    width: typeof r.width === 'number' ? r.width : 0,
    height: typeof r.height === 'number' ? r.height : 0,
    // Native sends NSNull for a healthy frame, which the JSI bridge turns into undefined here.
    // Both mean the same thing and both normalize to null, so a caller only ever checks a string.
    error: typeof r.error === 'string' ? r.error : null,
    gateMinSharpness: typeof r.gateMinSharpness === 'number' ? r.gateMinSharpness : undefined,
    gateMaxMotion: typeof r.gateMaxMotion === 'number' ? r.gateMaxMotion : undefined,
    wantedKeyframe,
    keyframe,
    crops,
  };
}

/**
 * Builds the argument object the native plugin expects, from a plain-data `ScanRequest`.
 *
 * Separate from `scanCart` so `src/app/dev/frame-lab.tsx` (which pushes a bundled test image
 * through the native plugin directly, bypassing `Frame`/JSI entirely) can build the exact same
 * argument shape a live camera frame would send, rather than a second, hand-maintained copy
 * that could quietly drift from what `scanCart` actually sends on device.
 *
 * Carries `'worklet'` for the same reason `toFrameScan` does: it is plain data manipulation with
 * no host calls of its own, but it is still called from inside `scanCart`'s worklet body, and a
 * function crossing that boundary without the directive throws on every call on a real device
 * (see the worklet-boundary defect recorded in
 * .superpowers/sdd/2026-08-14-kart-fusion-and-ui/worklet-boundary-report.md). The Frame Lab
 * screen calls this from ordinary (non-worklet) JS code, where the directive is simply inert.
 */
export function buildScanCartArgs(request: ScanRequest): Record<string, unknown> {
  'worklet';
  return {
    barcodes: ENABLE_BARCODE_FAST_PATH,
    wantKeyframe: request.wantKeyframe,
    // The session's adaptive floor when there is one. `MIN_KEYFRAME_SHARPNESS` remains the
    // fallback for callers with no session behind them, which today is only the Frame Lab.
    minSharpness: request.minSharpness ?? MIN_KEYFRAME_SHARPNESS,
    maxMotion: MAX_KEYFRAME_MOTION,
    thumbnailPadding: THUMBNAIL_PADDING,
    // Flattened rather than nested: the plugin reads plain Double values out of each entry,
    // and a nested dictionary would have to be unwrapped as Any on the Swift side first.
    cropBoxes: request.cropTrackIds.map((t) => ({
      id: t.id, x: t.box.x, y: t.box.y, w: t.box.w, h: t.box.h,
    })),
  };
}
