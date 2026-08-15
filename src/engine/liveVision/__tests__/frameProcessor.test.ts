import { toFrameScan } from '../frameProcessor';

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
