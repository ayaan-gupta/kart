import { VisionCameraProxy, type Frame } from 'react-native-vision-camera';
import { ENABLE_BARCODE_FAST_PATH } from './config';
import type { FrameScan } from './types';

// Wrapped in try/catch: this runs at module scope, and route modules under expo-router load
// eagerly at app boot, before the scan screen even mounts. If frame processors are ever
// unavailable (for example a build that dropped the native plugin), this must degrade to null
// here rather than throw and crash the whole app before the user ever reaches the scan screen.
let plugin: ReturnType<typeof VisionCameraProxy.initFrameProcessorPlugin> | null = null;
try {
  plugin = VisionCameraProxy.initFrameProcessorPlugin('scanGroceryItem', {});
} catch {
  plugin = null;
}

const EMPTY: FrameScan = {
  instances: [],
  barcodes: [],
  sharpness: 0,
  motion: 1,
  width: 0,
  height: 0,
  error: null,
};

export function scanCart(frame: Frame): FrameScan {
  'worklet';
  if (plugin == null) {
    throw new Error(
      'Failed to load Frame Processor Plugin "scanGroceryItem". Did the native build include KartVisionFrameProcessorPlugin?',
    );
  }

  const raw = plugin.call(frame, { barcodes: ENABLE_BARCODE_FAST_PATH }) as unknown as FrameScan | null;
  if (raw == null) return EMPTY;

  // The plugin returns plain JSI values, so this is a shape guard rather than a parse. A
  // malformed frame must degrade to "saw nothing", never take the camera down.
  return {
    instances: raw.instances ?? [],
    barcodes: raw.barcodes ?? [],
    sharpness: raw.sharpness ?? 0,
    motion: raw.motion ?? 1,
    width: raw.width ?? 0,
    height: raw.height ?? 0,
    // Native sends NSNull for a healthy frame, which arrives here as undefined. Both mean the
    // same thing and both normalize to null, so a caller only ever has to check for a string.
    error: raw.error ?? null,
  };
}
