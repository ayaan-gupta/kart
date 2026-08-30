import { VisionCameraProxy, type Frame } from 'react-native-vision-camera';
import { buildScanCartArgs, toFrameScan } from './frameScan';
import type { FrameScan, ScanRequest } from './types';

// Re-exported, not redefined: `frameScan.ts` holds them so a Node harness can import them
// without pulling in the camera, and every call site in the app keeps importing them from here.
export { buildScanCartArgs, toFrameScan };

// Wrapped in try/catch: this runs at module scope, and route modules under expo-router load
// eagerly at app boot, before the scan screen even mounts. If frame processors are ever
// unavailable (for example a build that dropped the native plugin), this must degrade to null
// here rather than throw and crash the whole app before the user ever reaches the scan screen.
//
// The string must match the registration name in ios/Kart/KartVisionFrameProcessorPlugin.m
// exactly. It is resolved by name at runtime, so a mismatch is not a build error, it is a
// plugin that silently fails to load on a device.
let plugin: ReturnType<typeof VisionCameraProxy.initFrameProcessorPlugin> | null = null;
let pluginLoadError: string | null = null;
try {
  plugin = VisionCameraProxy.initFrameProcessorPlugin('scanCart', {});
  if (plugin == null) {
    // Resolved without throwing and still found nothing: the frame processor runtime is up and
    // no native plugin answers to this name.
    pluginLoadError =
      'initFrameProcessorPlugin("scanCart") returned null. Frame processors are installed, but no ' +
      'native plugin is registered under that name. Check VISION_EXPORT_SWIFT_FRAME_PROCESSOR in ' +
      'ios/Kart/KartVisionFrameProcessorPlugin.m.';
  }
} catch (error) {
  // The thrown message is the only thing that separates "the native plugin is missing" from "the
  // frame processor runtime itself never installed", and those have completely different fixes.
  // Swallowing it and reporting the first cost days of chasing a plugin that was registered the
  // whole time, so whatever react-native-vision-camera actually said gets carried through to the
  // on-device HUD verbatim.
  plugin = null;
  pluginLoadError = `initFrameProcessorPlugin("scanCart") threw: ${
    error instanceof Error ? error.message : String(error)
  }`;
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

// A frame processor plugin that failed to register and a detector that ran cleanly and saw an
// empty cart both produce zero instances. FrameScan.error exists to keep those apart, and on a
// device there is no report to check afterwards, so this is the one case scanCart must never
// let fall through to a silent, error-less empty scan.
const PLUGIN_LOAD_ERROR = 'Frame Processor Plugin "scanCart" is unavailable, with no reason reported.';

/**
 * Why `scanCart` is unavailable, or null when it loaded.
 *
 * Exported so `src/app/dev/frame-lab.tsx` can show the real reason rather than a guess at one.
 */
export function getScanCartPluginError(): string | null {
  return plugin === null ? (pluginLoadError ?? PLUGIN_LOAD_ERROR) : null;
}

export function scanCart(frame: Frame, request: ScanRequest): FrameScan {
  'worklet';
  if (plugin == null) return toFrameScan({ error: pluginLoadError ?? PLUGIN_LOAD_ERROR }, false);

  const args = buildScanCartArgs(request);
  // The installed react-native-vision-camera types only allow flat parameter values (string,
  // number, boolean, ArrayBuffer, or one level of array/record of those) and do not export the
  // type to build a matching shape against. The native JSI bridge accepts arbitrary JSON-shaped
  // arguments regardless (that is how the Swift side reads `cropBoxes` as `[[String: Any]]`), so
  // this narrows the mismatch to one documented cast rather than widening the call's real type.
  return toFrameScan(
    plugin.call(frame, args as unknown as Parameters<typeof plugin.call>[1]),
    request.wantKeyframe,
  );
}
