import { VisionCameraProxy, type Frame } from 'react-native-vision-camera';
import {
  MAX_KEYFRAME_MOTION,
  MIN_KEYFRAME_SHARPNESS,
  THUMBNAIL_PADDING,
  ENABLE_BARCODE_FAST_PATH,
} from './config';
import type { FrameScan, ScanRequest, ThumbnailCrop } from './types';

// Wrapped in try/catch: this runs at module scope, and route modules under expo-router load
// eagerly at app boot, before the scan screen even mounts. If frame processors are ever
// unavailable (for example a build that dropped the native plugin), this must degrade to null
// here rather than throw and crash the whole app before the user ever reaches the scan screen.
//
// The string must match the registration name in ios/Kart/KartVisionFrameProcessorPlugin.m
// exactly. It is resolved by name at runtime, so a mismatch is not a build error, it is a
// plugin that silently fails to load on a device.
let plugin: ReturnType<typeof VisionCameraProxy.initFrameProcessorPlugin> | null = null;
try {
  plugin = VisionCameraProxy.initFrameProcessorPlugin('scanCart', {});
} catch {
  plugin = null;
}

/**
 * Whether the native `scanCart` frame processor plugin resolved by name at module load.
 *
 * Exported so a diagnostic screen (see `src/app/dev/frame-lab.tsx`) can show, on the running
 * device or Simulator, whether `VisionCameraProxy.initFrameProcessorPlugin('scanCart', {})`
 * actually found the native registration, without duplicating the try/catch above or calling
 * `initFrameProcessorPlugin` a second time. `plugin` itself stays module-private: nothing
 * outside this file should be able to call `.call` directly and bypass `scanCart`'s shape
 * guarantees.
 */
export function isScanCartPluginAvailable(): boolean {
  return plugin !== null;
}

/**
 * Shapes a native reply into a FrameScan.
 *
 * Separate from `scanCart` so it can be tested without a camera, and defensive because a
 * malformed reply reaches this from a worklet thread where a throw is not recoverable.
 */
export function toFrameScan(raw: unknown): FrameScan {
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
    keyframe,
    crops,
  };
}

// A frame processor plugin that failed to register and a detector that ran cleanly and saw an
// empty cart both produce zero instances. FrameScan.error exists to keep those apart, and on a
// device there is no report to check afterwards, so this is the one case scanCart must never
// let fall through to a silent, error-less empty scan.
const PLUGIN_LOAD_ERROR =
  'Failed to load Frame Processor Plugin "scanCart". Did the native build include KartVisionFrameProcessorPlugin?';

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
    minSharpness: MIN_KEYFRAME_SHARPNESS,
    maxMotion: MAX_KEYFRAME_MOTION,
    thumbnailPadding: THUMBNAIL_PADDING,
    // Flattened rather than nested: the plugin reads plain Double values out of each entry,
    // and a nested dictionary would have to be unwrapped as Any on the Swift side first.
    cropBoxes: request.cropTrackIds.map((t) => ({
      id: t.id, x: t.box.x, y: t.box.y, w: t.box.w, h: t.box.h,
    })),
  };
}

export function scanCart(frame: Frame, request: ScanRequest): FrameScan {
  'worklet';
  if (plugin == null) return toFrameScan({ error: PLUGIN_LOAD_ERROR });

  const args = buildScanCartArgs(request);
  // The installed react-native-vision-camera types only allow flat parameter values (string,
  // number, boolean, ArrayBuffer, or one level of array/record of those) and do not export the
  // type to build a matching shape against. The native JSI bridge accepts arbitrary JSON-shaped
  // arguments regardless (that is how the Swift side reads `cropBoxes` as `[[String: Any]]`), so
  // this narrows the mismatch to one documented cast rather than widening the call's real type.
  return toFrameScan(plugin.call(frame, args as unknown as Parameters<typeof plugin.call>[1]));
}
