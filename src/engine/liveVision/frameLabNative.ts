import { NativeModules } from 'react-native';
import { Worklets } from 'react-native-worklets-core';
import { scanCart } from './frameProcessor';
import type { ScanRequest } from './types';

/**
 * JS-side access to the debug-only native module `ios/Kart/KartFrameLab.swift`.
 *
 * That module only exists in Debug builds (see its own `#if DEBUG` guard, matched in
 * `KartFrameLab.m`), so `NativeModules.KartFrameLab` is legitimately `undefined` in a
 * Release/TestFlight/App Store binary and on Android, where the module was never written. This
 * mirrors the exact defensive shape `frameProcessor.ts` already uses for the camera plugin
 * itself: check for availability, never assume it.
 */
interface KartFrameLabNativeModule {
  scanBundledImage(path: string, request: Record<string, unknown>): Promise<unknown>;
}

function nativeModule(): KartFrameLabNativeModule | null {
  const mod = (NativeModules as { KartFrameLab?: KartFrameLabNativeModule }).KartFrameLab;
  return mod ?? null;
}

export function isFrameLabNativeAvailable(): boolean {
  return nativeModule() !== null;
}

/**
 * Pushes one bundled test image through the real native plugin.
 *
 * `imagePath` must be a local `file://` URI or plain filesystem path (an `expo-asset` local URI
 * once downloaded, never a remote URL: this harness makes no network calls). `request` is the
 * same argument shape `scanCart` builds for the real plugin call (see `frameProcessor.ts`), so
 * the native side sees an identical `wantKeyframe`/`cropBoxes`/`barcodes` argument set to what a
 * live camera frame would send.
 *
 * Resolves with the plugin's raw reply, the exact shape `toFrameScan` (frameProcessor.ts) is
 * written to consume. Callers should always pass the result through `toFrameScan`, never read it
 * directly, so this harness and the live camera path share one shape guarantee.
 */
export async function scanBundledTestImage(
  imagePath: string,
  request: Record<string, unknown>,
): Promise<unknown> {
  const mod = nativeModule();
  if (mod === null) {
    throw new Error(
      'KartFrameLab native module is unavailable (Debug-only; check this is a Debug build and the ' +
        'file was registered in project.pbxproj).',
    );
  }
  return mod.scanBundledImage(imagePath, request);
}

export interface WorkletBoundaryProbeResult {
  /** True once the worklet ran to completion, whether or not `scanCart` itself threw inside it. */
  ranOnWorkletRuntime: boolean;
  /** True only if `scanCart` threw the specific "regular javascript function ... cannot be
   * shared" class of error, i.e. the exact defect already found and fixed in `scan.tsx`
   * (see .superpowers/sdd/2026-08-14-kart-fusion-and-ui/worklet-boundary-report.md). */
  regressedToUnsharedFunctionError: boolean;
  /** The error `scanCart` threw when called with a non-camera-backed stand-in for `Frame`, or
   * null if it did not throw. Expected to be non-null: a plain object is not a real
   * VisionCamera `Frame`, so the native plugin call inside `scanCart` should fail once it
   * reaches VisionCamera's own Frame-shape check. That expected failure, rather than the
   * "cannot be shared" class of error, is what this probe exists to tell apart. */
  scanCartError: string | null;
}

/**
 * Proves the worklet boundary independently of whether a real camera `Frame` is available.
 *
 * Creates a genuine second worklet runtime (`Worklets.createContext`, the same mechanism
 * VisionCamera itself uses for the live frame processor context) and, inside a real `'worklet'`
 * function running on it, calls the actual, unmodified `scanCart` from `frameProcessor.ts` -
 * closure, `'worklet'` directive and all, exactly as `scan.tsx`'s frame processor does. This
 * exercises:
 *
 *  - that `scanCart`'s own `'worklet'` directive compiles and runs on a real worklet runtime in
 *    the Simulator (worklets themselves need no camera to work);
 *  - that the module-scope `plugin` object `scanCart` closes over (a real JSI host object
 *    returned by `VisionCameraProxy.initFrameProcessorPlugin`) survives being shared into that
 *    second runtime and its `.call` method is still callable there - the exact cross-runtime
 *    object-sharing mechanism `useFrameProcessor`'s own worklet relies on;
 *  - that calling `scanCart` this way does *not* reproduce the historical defect (a plain,
 *    non-`'worklet'` JS function thrown across the boundary), which threw
 *    `"Regular javascript function '...' cannot be shared..."` on every call.
 *
 * What it cannot prove: the one input only a camera can supply. `frame` here is a plain object,
 * not a real VisionCamera `Frame` JSI host object (`FrameHostObject`, the C++ type that would
 * make one, is a private VisionCamera header - see the comment on this decision in
 * `ios/Kart/KartFrameLab.swift`). So `plugin.call(frame, args)` inside `scanCart` is expected to
 * fail once VisionCamera's own native argument parsing inspects `frame` and finds it is not a
 * real Frame. That failure is the signal this probe is looking for: a specific, diagnostic error
 * from deep inside VisionCamera's own Frame-handling code, not the generic "cannot be shared"
 * class of error the worklet-boundary defect produced. Reaching that specific failure, rather
 * than the generic one, is what "the boundary itself is healthy" looks like without a camera.
 */
export interface RequestPropagationProbeResult {
  /** What the worklet read back after the JS thread wrote a new request. */
  sawWantKeyframe: boolean;
  /** The blur floor the worklet read back, or null if the field never arrived. */
  sawMinSharpness: number | null;
  /** True when the worklet observed the JS thread's write. This is the whole question. */
  propagated: boolean;
  error: string | null;
}

/**
 * Proves that a request written on the JS thread is visible to a worklet runtime.
 *
 * This is the regression probe for the defect that stopped this app ever uploading a frame from a
 * phone. `scan.tsx` held the next scan request in a `useRef`, and the frame processor worklet
 * captured that object once, when the worklet was created. Every later write from `handleScan`
 * landed on the JS thread's copy, which the worklet could not see, so the worklet read the initial
 * `wantKeyframe: false` on every frame forever. Nothing errored: the gate simply never fired, and
 * that is indistinguishable from a user who cannot hold the phone still.
 *
 * The measurement that exposed it was `minSharpness`. JavaScript computed 64.5 and the native side
 * reported having been handed 12.0, the fallback for an absent field, and the only request in the
 * app lacking that field is the initial one.
 *
 * The order below is the point, and it is what `probeWorkletBoundary` cannot do: the shared value
 * and the runtime are both created *first*, and the write happens *after*, so a mechanism that
 * only copies at creation time fails here exactly as it failed on device. Reading it back inside a
 * real worklet is then a direct test of the fix.
 */
export async function probeRequestPropagation(): Promise<RequestPropagationProbeResult> {
  const shared = Worklets.createSharedValue<ScanRequest>({
    wantKeyframe: false,
    cropTrackIds: [],
  });
  const context = Worklets.createContext('KartRequestPropagation');

  // Warm the runtime before the write, so the shared value has already been shared into it. A
  // probe that wrote first would let a copy-at-share-time mechanism pass by accident.
  await context.runAsync(() => {
    'worklet';
    return shared.value.wantKeyframe;
  });

  // The write `handleScan` performs on the JS thread, with the same shape and a floor that cannot
  // be confused with `MIN_KEYFRAME_SHARPNESS`.
  shared.value = { wantKeyframe: true, cropTrackIds: [], minSharpness: 64.5 };

  try {
    const seen = await context.runAsync(() => {
      'worklet';
      const request = shared.value;
      return {
        wantKeyframe: request.wantKeyframe,
        minSharpness: request.minSharpness ?? null,
      };
    });
    return {
      sawWantKeyframe: seen.wantKeyframe,
      sawMinSharpness: seen.minSharpness,
      propagated: seen.wantKeyframe === true && seen.minSharpness === 64.5,
      error: null,
    };
  } catch (error) {
    return {
      sawWantKeyframe: false,
      sawMinSharpness: null,
      propagated: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function probeWorkletBoundary(): Promise<WorkletBoundaryProbeResult> {
  const context = Worklets.createContext('KartFrameLabProbe');

  const outcome = await context.runAsync(() => {
    'worklet';
    const fakeFrame = {
      width: 4,
      height: 4,
      orientation: 'portrait',
      isMirrored: false,
      timestamp: 0,
      pixelFormat: 'unknown',
      isValid: true,
    };
    const request: ScanRequest = { wantKeyframe: false, cropTrackIds: [] };
    try {
      // Deliberately not a real Frame; see the function doc above for why that is the one thing
      // this probe cannot supply.
      scanCart(fakeFrame as unknown as Parameters<typeof scanCart>[0], request);
      return { threw: false, message: null as string | null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { threw: true, message };
    }
  });

  const message = outcome.message;
  const regressed = message !== null && message.includes('cannot be shared');
  return {
    ranOnWorkletRuntime: true,
    regressedToUnsharedFunctionError: regressed,
    scanCartError: message,
  };
}
