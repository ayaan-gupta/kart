import type { Frame } from 'react-native-vision-camera';
import { buildScanCartArgs, isScanCartPluginAvailable, scanCart, toFrameScan } from '../frameProcessor';
import { ENABLE_BARCODE_FAST_PATH, MAX_KEYFRAME_MOTION, MIN_KEYFRAME_SHARPNESS, THUMBNAIL_PADDING } from '../config';

const nativeReply = {
  instances: [{ box: { x: 0, y: 0, w: 0.5, h: 0.5 }, polygon: [0, 0, 0.5, 0, 0.5, 0.5], score: 0.9 }],
  barcodes: [],
  sharpness: 40,
  motion: 0.01,
  width: 1080,
  height: 1920,
  keyframe: 'AAAA',
  crops: [{ id: 't1', jpeg: 'BBBB' }],
};

describe('toFrameScan', () => {
  it('binds a complete native reply', () => {
    const scan = toFrameScan(nativeReply);
    expect(scan.instances).toHaveLength(1);
    expect(scan.keyframe).toBe('AAAA');
    expect(scan.crops).toEqual([{ id: 't1', jpeg: 'BBBB' }]);
    expect(scan.width).toBe(1080);
  });

  it('treats a missing keyframe as null rather than undefined', () => {
    // The plugin omits the key entirely on a frame that did not pass the gate. Undefined
    // leaking into state would make `keyframe != null` checks pass on some code paths.
    const { keyframe, ...withoutKeyframe } = nativeReply;
    expect(toFrameScan(withoutKeyframe).keyframe).toBeNull();
  });

  it('survives a null reply from a frame with no image buffer', () => {
    const scan = toFrameScan(null);
    expect(scan.instances).toEqual([]);
    expect(scan.crops).toEqual([]);
    expect(scan.keyframe).toBeNull();
    // Maximum motion, so a frame we could not read is never mistaken for a still one.
    expect(scan.motion).toBe(1);
  });

  it('drops a crop entry with a non-string payload', () => {
    const scan = toFrameScan({ ...nativeReply, crops: [{ id: 't1', jpeg: 42 }, { id: 't2', jpeg: 'CCCC' }] });
    expect(scan.crops).toEqual([{ id: 't2', jpeg: 'CCCC' }]);
  });

  it('drops an empty-string keyframe', () => {
    // An encode failure returns "" rather than throwing across the bridge. Writing that to disk
    // would produce a zero byte file that renders as a broken image in the bag.
    expect(toFrameScan({ ...nativeReply, keyframe: '' }).keyframe).toBeNull();
  });
});

describe('scanCart', () => {
  it('yields a non-null error rather than a silent empty scan when the plugin fails to load', () => {
    // jest.setup.js mocks VisionCameraProxy.initFrameProcessorPlugin to always return null, so
    // `plugin` inside frameProcessor.ts is null here exactly as it would be on a device whose
    // native build dropped KartVisionFrameProcessorPlugin. A missing plugin and a detector that
    // ran cleanly and saw an empty cart both report zero instances; `error` is the only thing
    // that tells them apart, and on a phone there is no report to check afterwards.
    const scan = scanCart({} as Frame, { wantKeyframe: false, cropTrackIds: [] });
    expect(scan.error).not.toBeNull();
    expect(scan.error).toMatch(/scanCart/);
    expect(scan.instances).toEqual([]);
  });
});

describe('isScanCartPluginAvailable', () => {
  it('reflects the mocked null plugin under Jest', () => {
    // jest.setup.js's VisionCameraProxy mock always returns null, mirroring a device whose
    // native build dropped the plugin. This is what src/app/dev/frame-lab.tsx's diagnostics
    // panel reads to show plugin-resolution status; asserting it here pins that it is live data
    // from the same module-scope `plugin`, not a hardcoded true.
    expect(isScanCartPluginAvailable()).toBe(false);
  });
});

describe('buildScanCartArgs', () => {
  it('carries the keyframe/motion thresholds from config.ts unchanged', () => {
    const args = buildScanCartArgs({ wantKeyframe: true, cropTrackIds: [] });
    expect(args).toMatchObject({
      barcodes: ENABLE_BARCODE_FAST_PATH,
      wantKeyframe: true,
      minSharpness: MIN_KEYFRAME_SHARPNESS,
      maxMotion: MAX_KEYFRAME_MOTION,
      thumbnailPadding: THUMBNAIL_PADDING,
    });
  });

  it('flattens crop track boxes into the shape the Swift side reads as [[String: Any]]', () => {
    const args = buildScanCartArgs({
      wantKeyframe: false,
      cropTrackIds: [{ id: 'track_1', box: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 } }],
    });
    expect(args.cropBoxes).toEqual([{ id: 'track_1', x: 0.1, y: 0.2, w: 0.3, h: 0.4 }]);
  });

  it('sends an empty cropBoxes array, not an omitted key, when nothing was requested', () => {
    expect(buildScanCartArgs({ wantKeyframe: false, cropTrackIds: [] }).cropBoxes).toEqual([]);
  });
});
