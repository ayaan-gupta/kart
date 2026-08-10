import { VisionCameraProxy, type Frame } from 'react-native-vision-camera';
import type { RawRegion } from './types';

const plugin = VisionCameraProxy.initFrameProcessorPlugin('scanGroceryItem', {});

export function scanGroceryItem(frame: Frame): RawRegion[] {
  'worklet';
  if (plugin == null) {
    throw new Error(
      'Failed to load Frame Processor Plugin "scanGroceryItem". Did the native build include KartVisionFrameProcessorPlugin?',
    );
  }
  const raw = plugin.call(frame) as unknown as Array<{
    box: RawRegion['box'];
    label: string;
    confidence: number;
    ocrText: string;
  }>;
  return raw.map((r) => ({
    box: r.box,
    label: r.label,
    confidence: r.confidence,
    ocrText: r.ocrText || undefined,
  }));
}
