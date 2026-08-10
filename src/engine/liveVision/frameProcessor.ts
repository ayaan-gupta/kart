import { VisionCameraProxy, type Frame } from 'react-native-vision-camera';
import type { LabelCandidate, RawRegion } from './types';

// Wrapped in try/catch: this runs at module scope, and route modules under expo-router load
// eagerly at app boot, before the scan screen even mounts. If frame processors are ever
// unavailable (e.g. a build that dropped the native plugin), this must degrade to `null` here
// rather than throw and crash the whole app before the user ever reaches the scan screen.
// `scanGroceryItem` below still throws its own clear error, but only when actually invoked.
let plugin: ReturnType<typeof VisionCameraProxy.initFrameProcessorPlugin> | null = null;
try {
  plugin = VisionCameraProxy.initFrameProcessorPlugin('scanGroceryItem', {});
} catch {
  plugin = null;
}

export function scanGroceryItem(frame: Frame): RawRegion[] {
  'worklet';
  if (plugin == null) {
    throw new Error(
      'Failed to load Frame Processor Plugin "scanGroceryItem". Did the native build include KartVisionFrameProcessorPlugin?',
    );
  }
  const raw = plugin.call(frame) as unknown as Array<{
    box: RawRegion['box'];
    labels: LabelCandidate[];
    ocrText: string;
  }>;
  return raw.map((r) => ({
    box: r.box,
    labels: r.labels,
    ocrText: r.ocrText || undefined,
  }));
}
