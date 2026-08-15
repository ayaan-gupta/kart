import { createPipelineState, processFrame } from '../pipeline';
import type { FrameScan } from '../types';

function scan(overrides: Partial<FrameScan> = {}): FrameScan {
  return {
    instances: [
      {
        box: { x: 0.2, y: 0.2, w: 0.2, h: 0.2 },
        polygon: [0.2, 0.2, 0.4, 0.2, 0.4, 0.4, 0.2, 0.4],
        score: 0.9,
      },
    ],
    barcodes: [],
    sharpness: 400,
    motion: 0.003,
    width: 1080,
    height: 1920,
    ...overrides,
  };
}

describe('processFrame', () => {
  it('turns detections into tracks', () => {
    const { tracks } = processFrame(createPipelineState(), scan(), 1000);
    expect(tracks).toHaveLength(1);
    expect(tracks[0].polygon).toHaveLength(8);
  });

  it('opens the keyframe gate on a sharp, still frame', () => {
    // A fresh keyframe state starts lastFiredAt at 0, and evaluateKeyframe requires
    // minIntervalMs (2000ms) to elapse before it will fire again. `now` has to clear that from
    // a zero baseline for a first-ever frame to fire, the same convention keyframe.test.ts uses
    // for its own "fires on the first sharp frame" case.
    const { keyframe } = processFrame(createPipelineState(), scan(), 3000);
    expect(keyframe.fire).toBe(true);
  });

  it('holds the gate on a blurry frame but still tracks', () => {
    const { keyframe, tracks } = processFrame(createPipelineState(), scan({ sharpness: 5 }), 1000);
    expect(keyframe.fire).toBe(false);
    expect(keyframe.reason).toBe('blurry');
    expect(tracks).toHaveLength(1);
  });

  it('attaches a barcode whose centre falls inside a track', () => {
    const hit = {
      payload: '0038000138416',
      symbology: 'VNBarcodeSymbologyEAN13',
      box: { x: 0.26, y: 0.26, w: 0.06, h: 0.03 },
    };
    const { tracks } = processFrame(createPipelineState(), scan({ barcodes: [hit] }), 1000);
    expect(tracks[0].barcode).toBe('0038000138416');
  });

  it('ignores a barcode that falls outside every track', () => {
    const hit = {
      payload: '0038000138416',
      symbology: 'VNBarcodeSymbologyEAN13',
      box: { x: 0.8, y: 0.8, w: 0.06, h: 0.03 },
    };
    const { tracks } = processFrame(createPipelineState(), scan({ barcodes: [hit] }), 1000);
    expect(tracks[0].barcode).toBeNull();
  });

  it('keeps a barcode once seen, even when the next frame cannot read it', () => {
    // Barcodes decode intermittently as the cart shifts. Forgetting one the instant it stops
    // decoding would throw away the only certain identification the pipeline ever gets.
    const hit = {
      payload: '0038000138416',
      symbology: 'VNBarcodeSymbologyEAN13',
      box: { x: 0.26, y: 0.26, w: 0.06, h: 0.03 },
    };
    let result = processFrame(createPipelineState(), scan({ barcodes: [hit] }), 1000);
    result = processFrame(result.state, scan(), 1300);
    expect(result.tracks[0].barcode).toBe('0038000138416');
  });

  it('carries tracker and keyframe state forward', () => {
    let result = processFrame(createPipelineState(), scan(), 1000);
    result = processFrame(result.state, scan(), 1300);
    expect(result.tracks).toHaveLength(1);
    expect(result.tracks[0].hits).toBe(2);
    expect(result.keyframe.fire).toBe(false);
  });
});
