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
    error: null,
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
    // The gate counts confirmed tracks, and ByteTrack needs three hits (minHits: 3) before a
    // lone item is trusted enough to confirm. Run three frames spaced at DETECT_TARGET_FPS
    // (3fps, ~333ms apart) the way the detector actually runs, and check the gate holds with
    // 'nothing-to-see' for the first two before it opens on the one that confirms the item.
    let result = processFrame(createPipelineState(), scan(), 3000);
    expect(result.keyframe.fire).toBe(false);
    expect(result.keyframe.reason).toBe('nothing-to-see');

    result = processFrame(result.state, scan(), 3333);
    expect(result.keyframe.fire).toBe(false);
    expect(result.keyframe.reason).toBe('nothing-to-see');

    result = processFrame(result.state, scan(), 3666);
    expect(result.keyframe.fire).toBe(true);
    expect(result.keyframe.reason).toBe('fire');
  });

  it('holds the gate on a blurry frame but still tracks', () => {
    // Confirmation needs three good hits first; only the last frame needs to be the blurry one,
    // so the gate holds for the right reason ('blurry') rather than the wrong one
    // ('nothing-to-see', which would pass even if the sharpness check were never reached).
    let result = processFrame(createPipelineState(), scan(), 3000);
    result = processFrame(result.state, scan(), 3333);
    result = processFrame(result.state, scan({ sharpness: 5 }), 3666);

    expect(result.keyframe.fire).toBe(false);
    expect(result.keyframe.reason).toBe('blurry');
    expect(result.tracks).toHaveLength(1);
  });

  it('holds the gate with nothing-to-see when a frame has no detections at all', () => {
    const { keyframe, tracks } = processFrame(createPipelineState(), scan({ instances: [] }), 3000);
    expect(tracks).toHaveLength(0);
    expect(keyframe.fire).toBe(false);
    expect(keyframe.reason).toBe('nothing-to-see');
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

  it('claims a barcode for only the smallest containing track, not every one', () => {
    // Stacked or adjacent cart items commonly produce overlapping axis-aligned boxes even when
    // their actual masks do not overlap. A barcode sitting inside two boxes should identify
    // only the tighter one, the best guess at the item actually carrying the label, never both.
    const small = {
      box: { x: 0.24, y: 0.24, w: 0.06, h: 0.06 },
      polygon: [0.24, 0.24, 0.3, 0.24, 0.3, 0.3, 0.24, 0.3],
      score: 0.9,
    };
    const large = {
      box: { x: 0.1, y: 0.1, w: 0.3, h: 0.3 },
      polygon: [0.1, 0.1, 0.4, 0.1, 0.4, 0.4, 0.1, 0.4],
      score: 0.9,
    };
    const hit = {
      payload: '0038000138416',
      symbology: 'VNBarcodeSymbologyEAN13',
      box: { x: 0.26, y: 0.26, w: 0.02, h: 0.02 },
    };

    const { tracks } = processFrame(
      createPipelineState(),
      scan({ instances: [small, large], barcodes: [hit] }),
      1000,
    );

    expect(tracks).toHaveLength(2);
    const smallTrack = tracks.find((track) => track.id === 'track_1');
    const largeTrack = tracks.find((track) => track.id === 'track_2');
    expect(smallTrack?.barcode).toBe('0038000138416');
    expect(largeTrack?.barcode).toBeNull();
  });

  it('never lets a second track claim a payload another track already carries', () => {
    // The one-claim-per-barcode rule has to hold for the life of the scan, not the life of a
    // frame. The same two overlapping boxes as the test above, run for two consecutive frames:
    // on frame 2 the payload is already on track_1, and the naive "skip tracks that have a
    // barcode" rule would hand it to track_2 as well, recreating the over-count on the time
    // axis. Barcodes decode intermittently at 3fps, so this is the common case, not a corner.
    const small = {
      box: { x: 0.24, y: 0.24, w: 0.06, h: 0.06 },
      polygon: [0.24, 0.24, 0.3, 0.24, 0.3, 0.3, 0.24, 0.3],
      score: 0.9,
    };
    const large = {
      box: { x: 0.1, y: 0.1, w: 0.3, h: 0.3 },
      polygon: [0.1, 0.1, 0.4, 0.1, 0.4, 0.4, 0.1, 0.4],
      score: 0.9,
    };
    const hit = {
      payload: '0038000138416',
      symbology: 'VNBarcodeSymbologyEAN13',
      box: { x: 0.26, y: 0.26, w: 0.02, h: 0.02 },
    };
    const frame = { instances: [small, large], barcodes: [hit] };

    let result = processFrame(createPipelineState(), scan(frame), 1000);
    let carriers = result.tracks.filter((track) => track.barcode === hit.payload);
    expect(carriers).toHaveLength(1);
    expect(carriers[0].id).toBe('track_1');

    result = processFrame(result.state, scan(frame), 1300);
    expect(result.tracks).toHaveLength(2);
    carriers = result.tracks.filter((track) => track.barcode === hit.payload);
    expect(carriers).toHaveLength(1);
    expect(carriers[0].id).toBe('track_1');

    result = processFrame(result.state, scan(frame), 1600);
    carriers = result.tracks.filter((track) => track.barcode === hit.payload);
    expect(carriers).toHaveLength(1);
    expect(carriers[0].id).toBe('track_1');
  });

  it('does not let a barcode attach to a track that has already left the frame', () => {
    // A lost track is a Kalman prediction of an item that is no longer actually there. A
    // barcode should never bind to it, only to something the detector still sees.
    let result = processFrame(createPipelineState(), scan(), 3000);
    result = processFrame(result.state, scan(), 3333);
    result = processFrame(result.state, scan(), 3666);
    expect(result.tracks[0].state).toBe('confirmed');

    const hit = {
      payload: '0038000138416',
      symbology: 'VNBarcodeSymbologyEAN13',
      box: { x: 0.26, y: 0.26, w: 0.06, h: 0.03 },
    };
    result = processFrame(result.state, scan({ instances: [], barcodes: [hit] }), 3999);
    expect(result.tracks[0].state).toBe('lost');
    expect(result.tracks[0].barcode).toBeNull();
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
    // Build confirmation, let the gate fire once, then confirm the next frame is blocked by
    // the minimum interval rather than by having forgotten it already fired. This is the thing
    // the test is named for: state threaded from one call into the next.
    let result = processFrame(createPipelineState(), scan(), 3000);
    result = processFrame(result.state, scan(), 3333);
    result = processFrame(result.state, scan(), 3666);
    expect(result.tracks).toHaveLength(1);
    expect(result.tracks[0].hits).toBe(3);
    expect(result.keyframe.fire).toBe(true);

    result = processFrame(result.state, scan(), 3966);
    expect(result.tracks[0].hits).toBe(4);
    expect(result.keyframe.fire).toBe(false);
    expect(result.keyframe.reason).toBe('too-soon');
  });
});
