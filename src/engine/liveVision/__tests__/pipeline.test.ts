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
    wantedKeyframe: false,
    keyframe: null,
    crops: [],
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
    //
    // The floor is passed explicitly because it is otherwise adaptive, and three frames is too
    // short a history for it to have decided anything. What this test is about is that a blurry
    // frame holds the gate and still updates the tracker, not how the floor is chosen; the floor
    // itself is covered in `keyframe.test.ts`.
    const floor = { minSharpness: 12 };
    let result = processFrame(createPipelineState(), scan(), 3000, floor);
    result = processFrame(result.state, scan(), 3333, floor);
    result = processFrame(result.state, scan({ sharpness: 5 }), 3666, floor);

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

  it('lets two of the same product each claim their own track', () => {
    // The other half of the claim rule. A cart holding two of the same yogurt is the most
    // ordinary grocery behaviour there is, and both tubs decode the same UPC at clearly
    // separate positions. Keying the skip on the payload alone would give the UPC to exactly
    // one tub forever, and Plan 3 counts from tracks, so the second tub would vanish.
    const left = {
      box: { x: 0.1, y: 0.1, w: 0.15, h: 0.15 },
      polygon: [0.1, 0.1, 0.25, 0.1, 0.25, 0.25, 0.1, 0.25],
      score: 0.9,
    };
    const right = {
      box: { x: 0.65, y: 0.65, w: 0.15, h: 0.15 },
      polygon: [0.65, 0.65, 0.8, 0.65, 0.8, 0.8, 0.65, 0.8],
      score: 0.9,
    };
    const payload = '0038000138416';
    const onLeft = {
      payload,
      symbology: 'VNBarcodeSymbologyEAN13',
      box: { x: 0.16, y: 0.16, w: 0.02, h: 0.02 },
    };
    const onRight = {
      payload,
      symbology: 'VNBarcodeSymbologyEAN13',
      box: { x: 0.71, y: 0.71, w: 0.02, h: 0.02 },
    };
    const frame = { instances: [left, right], barcodes: [onLeft, onRight] };

    let result = processFrame(createPipelineState(), scan(frame), 1000);
    expect(result.tracks.filter((track) => track.barcode === payload)).toHaveLength(2);

    // And it stays at two across frames: each decode is already claimed at its own position,
    // so neither one wanders onto the other tub's track.
    result = processFrame(result.state, scan(frame), 1300);
    result = processFrame(result.state, scan(frame), 1600);
    const carriers = result.tracks.filter((track) => track.barcode === payload);
    expect(carriers).toHaveLength(2);
    expect(carriers.map((track) => track.id).sort()).toEqual(['track_1', 'track_2']);
  });

  it('ignores a repeated decode of one label within a single frame', () => {
    // Vision can report the same physical label twice in one frame. Both decodes sit at the
    // same place, so the second must be recognized as the same label rather than handed to the
    // larger overlapping box as a second product.
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
    const payload = '0038000138416';
    const hit = {
      payload,
      symbology: 'VNBarcodeSymbologyEAN13',
      box: { x: 0.26, y: 0.26, w: 0.02, h: 0.02 },
    };
    const again = {
      payload,
      symbology: 'VNBarcodeSymbologyEAN13',
      box: { x: 0.262, y: 0.262, w: 0.02, h: 0.02 },
    };

    const { tracks } = processFrame(
      createPipelineState(),
      scan({ instances: [small, large], barcodes: [hit, again] }),
      1000,
    );

    expect(tracks.filter((track) => track.barcode === payload)).toHaveLength(1);
    expect(tracks.find((track) => track.id === 'track_1')?.barcode).toBe(payload);
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
    // Build confirmation, let the gate fire once, deliver the keyframe it asked for, then confirm
    // the next frame is blocked by the minimum interval rather than by having forgotten it
    // already fired. This is the thing the test is named for: state threaded from one call into
    // the next.
    //
    // The delivery on the fourth frame is not decoration. The pacing clock starts when a keyframe
    // comes back, not when the gate decides to ask for one, so a sequence that never delivers one
    // never starts the interval either. That is the point of the change: a frame native refuses
    // no longer costs a capture window.
    let result = processFrame(createPipelineState(), scan(), 3000);
    result = processFrame(result.state, scan(), 3333);
    result = processFrame(result.state, scan(), 3666);
    expect(result.tracks).toHaveLength(1);
    expect(result.tracks[0].hits).toBe(3);
    expect(result.keyframe.fire).toBe(true);

    // Native honoured the request made on the previous frame.
    result = processFrame(result.state, scan({ keyframe: 'aGVsbG8=' }), 3966);
    expect(result.tracks[0].hits).toBe(4);
    expect(result.keyframe.fire).toBe(false);
    expect(result.keyframe.reason).toBe('too-soon');

    // And the interval it started is measured from the delivery, not from the decision.
    result = processFrame(result.state, scan(), 5900);
    expect(result.keyframe.reason).toBe('too-soon');
    result = processFrame(result.state, scan(), 5967);
    expect(result.keyframe.fire).toBe(true);
  });

  it('does not start the pacing interval on a keyframe that never arrived', () => {
    // The regression this whole change exists for. The gate asks on frame N and native re-tests
    // frame N+1 against the same blur floor; roughly 40 per cent of frames clear that floor, so
    // most requests are correctly refused. Measured over 1440 frames of `server/eval/replay`
    // before the fix: 22 decisions, 4 uploads, and one census per twelve-second clip against a
    // budget of eight, because every refusal had already spent two seconds.
    let result = processFrame(createPipelineState(), scan(), 3000);
    result = processFrame(result.state, scan(), 3333);
    result = processFrame(result.state, scan(), 3666);
    expect(result.keyframe.fire).toBe(true);

    // A request that went out and came back empty: `wantedKeyframe` says native was asked,
    // `keyframe: null` says it looked at the next frame and refused. Both halves are needed to
    // mean "refused" - a frame that asked for nothing also comes back with no keyframe, and that
    // is a spent window rather than a free one.
    result = processFrame(result.state, scan({ wantedKeyframe: true }), 3966);
    expect(result.keyframe.fire).toBe(true);
    expect(result.keyframe.reason).toBe('fire');
  });
});

/**
 * What the pacing interval is actually paying for.
 *
 * The gate is a handshake with a one-frame lag: JavaScript decides on frame N, native re-tests
 * frame N+1 against the same blur floor, and only then is a keyframe encoded. So a decision is
 * not a delivery, and `minIntervalMs` must be charged for the second rather than the first -
 * measured over 1440 frames of `server/eval/replay`, charging the decision turned 22 of them
 * into 4 uploads and one census per twelve-second clip against a budget of eight.
 *
 * The other half of that rule, and the one these two tests exist for: a decision the session
 * never turned into a request is still a spent window. `RecognitionSession.wantsKeyframe`
 * returns false for the whole duration of a census, and for the rest of the session once the
 * budget is gone, so nothing reaches native and nothing can ever come back. Keying the clock on
 * delivery alone leaves nothing to advance it, and the gate then fires on every frame for as
 * long as the session keeps saying no. Free in itself, but it means `minIntervalMs` stops
 * spacing censuses altogether: the next one starts the instant the previous one lands.
 */
describe('the pacing clock charges for a capture window actually spent', () => {
  it('retries on the very next frame when native refuses a keyframe it asked for', () => {
    let state = createPipelineState();
    for (let i = 0; i < 3; i += 1) state = processFrame(state, scan(), 3000 + i * 333).state;

    // Asked for on the frame before, and declined: `keyframe` came back null even though the
    // request went out. Nothing was encoded, so no window was spent and the gate may ask again
    // immediately rather than waiting out another two seconds for a frame it never got.
    const refused = processFrame(state, scan({ wantedKeyframe: true }), 4000);
    expect(refused.keyframe.fire).toBe(true);

    const again = processFrame(refused.state, scan({ wantedKeyframe: true }), 4033);
    expect(again.keyframe.fire).toBe(true);
  });

  it('still paces the gate while the session is declining to ask at all', () => {
    let state = createPipelineState();
    let fired = 0;
    // Three seconds at 30fps, with every frame reporting that no keyframe was requested of
    // native, which is exactly what a census in flight looks like from here.
    for (let i = 0; i < 90; i += 1) {
      const result = processFrame(state, scan({ wantedKeyframe: false }), 3000 + i * 33);
      state = result.state;
      if (result.keyframe.fire) fired += 1;
    }

    // One once the item confirms, one when the two-second interval comes round, and nothing
    // else. Unpaced, this is 80-odd.
    expect(fired).toBeLessThanOrEqual(2);
  });
});
