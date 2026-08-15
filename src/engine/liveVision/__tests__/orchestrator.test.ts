import {
  AMBER_DWELL_MS,
  amberTrackIds,
  createSessionState,
  marksFor,
  persistentAmber,
  RecognitionSession,
  tracksNeedingThumbnail,
} from '../orchestrator';
import { GREEN_CONFIDENCE } from '../config';
import { applyCensus, createFusionState, productKey } from '../fusion';
import type { Track } from '../types';

const track = (id: string, over: Partial<Track> = {}): Track =>
  ({
    id,
    box: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
    polygon: [0.1, 0.1, 0.3, 0.1, 0.3, 0.3],
    score: 0.9,
    state: 'confirmed',
    hits: 5,
    lastSeenAt: 0,
    barcode: null,
    filter: {} as Track['filter'],
    ...over,
  }) as Track;

describe('marksFor', () => {
  it('numbers marks from one and maps them back to tracks', () => {
    const { marks, markToTrack } = marksFor([track('a'), track('b')]);
    expect(marks.map((m) => m.id)).toEqual([1, 2]);
    expect(markToTrack).toEqual({ 1: 'a', 2: 'b' });
  });

  it('skips tentative and lost tracks', () => {
    // Marking a track that is about to disappear wastes a mark slot and asks the model about
    // something that may be a detector artefact.
    const { marks } = marksFor([track('a'), track('b', { state: 'tentative' }), track('c', { state: 'lost' })]);
    expect(marks).toHaveLength(1);
  });

  it('caps marks and keeps the largest items', () => {
    // The server rejects more than 40 marks outright, and dense badges are the documented
    // failure mode of set-of-mark prompting. When over the cap, the biggest items are the ones
    // most worth naming.
    const many = Array.from({ length: 50 }, (_, i) =>
      track(`t${i}`, { box: { x: 0, y: 0, w: 0.01 * (i + 1), h: 0.01 * (i + 1) } }),
    );
    const { marks, markToTrack } = marksFor(many, 40);
    expect(marks).toHaveLength(40);
    expect(Object.values(markToTrack)).toContain('t49');
    expect(Object.values(markToTrack)).not.toContain('t0');
  });

  it('produces no marks for an empty cart', () => {
    expect(marksFor([]).marks).toEqual([]);
  });
});

describe('amberTrackIds', () => {
  it('is empty before anything is identified', () => {
    expect(amberTrackIds(createSessionState(), [track('a')])).toEqual([]);
  });

  it('flags a low confidence identity', () => {
    let state = createSessionState();
    state = {
      ...state,
      fusion: applyCensus(
        createFusionState(),
        {
          marks: [{ id: 1, name: 'Something', brand: null, size: null, category: 'x', confidence: 0.3, needsCloserLook: false }],
          inViewCounts: [{ productKey: productKey('Something', null), count: 1 }],
        },
        { 1: 'a' },
        ['a'],
      ),
    };
    expect(amberTrackIds(state, [track('a')])).toEqual(['a']);
  });

  it('flags an item the model itself asked to see closer, even at high confidence', () => {
    let state = createSessionState();
    state = {
      ...state,
      fusion: applyCensus(
        createFusionState(),
        {
          marks: [{ id: 1, name: 'Something', brand: null, size: null, category: 'x', confidence: 0.95, needsCloserLook: true }],
          inViewCounts: [{ productKey: productKey('Something', null), count: 1 }],
        },
        { 1: 'a' },
        ['a'],
      ),
    };
    expect(amberTrackIds(state, [track('a')])).toEqual(['a']);
  });

  it('does not flag a confident identity', () => {
    let state = createSessionState();
    state = {
      ...state,
      fusion: applyCensus(
        createFusionState(),
        {
          marks: [{ id: 1, name: 'Bananas', brand: null, size: null, category: 'x', confidence: GREEN_CONFIDENCE + 0.05, needsCloserLook: false }],
          inViewCounts: [{ productKey: productKey('Bananas', null), count: 1 }],
        },
        { 1: 'a' },
        ['a'],
      ),
    };
    expect(amberTrackIds(state, [track('a')])).toEqual([]);
  });
});

describe('persistentAmber', () => {
  it('is false before the dwell has elapsed', () => {
    const state = { ...createSessionState(), amberSince: { a: 1000 } };
    expect(persistentAmber(state, [track('a')], 1000 + AMBER_DWELL_MS - 1)).toBe(false);
  });

  it('is true once an amber track has persisted', () => {
    // The dwell exists so the notice does not flicker on a transient confidence dip while the
    // user is simply moving the phone.
    const state = { ...createSessionState(), amberSince: { a: 1000 } };
    expect(persistentAmber(state, [track('a')], 1000 + AMBER_DWELL_MS + 1)).toBe(true);
  });

  it('ignores an amber track that has since left the frame', () => {
    const state = { ...createSessionState(), amberSince: { gone: 0 } };
    expect(persistentAmber(state, [track('a')], 999_999)).toBe(false);
  });
});

describe('tracksNeedingThumbnail', () => {
  const identified = () => {
    const fusion = applyCensus(
      createFusionState(),
      {
        marks: [{ id: 1, name: 'Bananas', brand: null, size: null, category: 'Produce', confidence: 0.95, needsCloserLook: false }],
        inViewCounts: [{ productKey: productKey('Bananas', null), count: 1 }],
      },
      { 1: 'a' },
      ['a'],
    );
    return { ...createSessionState(), fusion };
  };

  it('asks for a picture of a newly counted item', () => {
    expect(tracksNeedingThumbnail(identified(), [track('a')]).map((t) => t.id)).toEqual(['a']);
  });

  it('does not ask twice for the same product', () => {
    const state = identified();
    const withThumb = { ...state, thumbnails: { [productKey('Bananas', null)]: 'file:///a.jpg' } };
    expect(tracksNeedingThumbnail(withThumb, [track('a')])).toEqual([]);
  });

  it('does not ask for an unidentified track', () => {
    expect(tracksNeedingThumbnail(createSessionState(), [track('a')])).toEqual([]);
  });
});

describe('RecognitionSession', () => {
  const censusOk = {
    ok: true as const,
    value: {
      marks: [{ id: 1, name: 'Bananas', brand: null, size: null, category: 'Produce', confidence: 0.95, needsCloserLook: false }],
      inViewCounts: [{ productKey: productKey('Bananas', null), count: 1 }],
      unmarkedItems: [],
      occlusion: { itemsLikelyHidden: false, severity: 'none' as const, reason: '' },
    },
  };

  const deps = (over: Record<string, unknown> = {}) => ({
    requestCensus: jest.fn().mockResolvedValue(censusOk),
    requestIdentify: jest.fn().mockResolvedValue({
      ok: true,
      value: { name: 'Bananas', brand: null, size: null, category: 'Produce', confidence: 0.9, stillUnclear: false },
    }),
    lookupBarcode: jest.fn().mockResolvedValue(null),
    saveThumbnail: jest.fn().mockResolvedValue('file:///thumb.jpg'),
    ...over,
  });

  it('wants a keyframe when there are confirmed tracks and no call is in flight', () => {
    const s = new RecognitionSession(deps());
    expect(s.wantsKeyframe([track('a')])).toBe(true);
  });

  it('does not want one with nothing to look at', () => {
    expect(new RecognitionSession(deps()).wantsKeyframe([])).toBe(false);
  });

  it('does not want another while one is in flight', async () => {
    let release: (v: unknown) => void = () => {};
    const d = deps({ requestCensus: jest.fn().mockReturnValue(new Promise((r) => { release = r; })) });
    const s = new RecognitionSession(d);
    const pending = s.onKeyframe('AAAA', [track('a')], 0);
    expect(s.wantsKeyframe([track('a')])).toBe(false);
    release(censusOk);
    await pending;
    expect(s.wantsKeyframe([track('a')])).toBe(true);
  });

  it('folds a census result into fusion', async () => {
    const s = new RecognitionSession(deps());
    await s.onKeyframe('AAAA', [track('a')], 0);
    expect(s.state.fusion.identities['a'].name).toBe('Bananas');
    expect(s.state.censusCalls).toBe(1);
  });

  it('stops calling once the session cap is reached', async () => {
    const d = deps();
    const s = new RecognitionSession(d);
    for (let i = 0; i < 20; i++) await s.onKeyframe('AAAA', [track('a')], i * 3000);
    // Without a cap, leaving the scan screen face up on a table bills indefinitely.
    expect((d.requestCensus as jest.Mock).mock.calls.length).toBeLessThanOrEqual(8);
    expect(s.wantsKeyframe([track('a')])).toBe(false);
  });

  it('leaves fusion untouched when the request fails', async () => {
    const d = deps({ requestCensus: jest.fn().mockResolvedValue({ ok: false, failure: 'offline' }) });
    const s = new RecognitionSession(d);
    await s.onKeyframe('AAAA', [track('a')], 0);
    expect(Object.keys(s.state.fusion.identities)).toHaveLength(0);
  });

  it('does not spend the budget on a permanently unconfigured endpoint', async () => {
    const d = deps({ requestCensus: jest.fn().mockResolvedValue({ ok: false, failure: 'unconfigured' }) });
    const s = new RecognitionSession(d);
    await s.onKeyframe('AAAA', [track('a')], 0);
    await s.onKeyframe('AAAA', [track('a')], 3000);
    // Retrying a missing base URL cannot ever succeed, so it stops asking after the first.
    expect((d.requestCensus as jest.Mock).mock.calls.length).toBe(1);
  });

  it('follows up on a low confidence item with a crop', async () => {
    const unsure = {
      ok: true as const,
      value: {
        ...censusOk.value,
        marks: [{ ...censusOk.value.marks[0], confidence: 0.25, needsCloserLook: true }],
      },
    };
    const d = deps({ requestCensus: jest.fn().mockResolvedValue(unsure) });
    const s = new RecognitionSession(d);
    await s.onKeyframe('AAAA', [track('a')], 0);
    expect(d.requestIdentify).toHaveBeenCalled();
    const req = (d.requestIdentify as jest.Mock).mock.calls[0][0];
    expect(req.box).toEqual(track('a').box);
    expect(s.state.fusion.identities['a'].confidence).toBe(0.9);
  });

  it('does not crop a confident item', async () => {
    const d = deps();
    const s = new RecognitionSession(d);
    await s.onKeyframe('AAAA', [track('a')], 0);
    expect(d.requestIdentify).not.toHaveBeenCalled();
  });

  it('records the occlusion verdict', async () => {
    const hidden = {
      ok: true as const,
      value: {
        ...censusOk.value,
        unmarkedItems: [
          { description: 'a box', approxLocation: 'under', confidence: 0.7 },
          { description: 'a can', approxLocation: 'under', confidence: 0.6 },
          { description: 'a bag', approxLocation: 'under', confidence: 0.6 },
        ],
        occlusion: { itemsLikelyHidden: true, severity: 'many' as const, reason: 'stacked' },
      },
    };
    const s = new RecognitionSession(deps({ requestCensus: jest.fn().mockResolvedValue(hidden) }));
    await s.onKeyframe('AAAA', [track('a')], 0);
    expect(s.state.occlusion.hidden).toBe(true);
  });

  it('stores a thumbnail against the product, not the track', async () => {
    // Keying on the track would lose the picture the moment ByteTrack retires that id.
    const s = new RecognitionSession(deps());
    await s.onKeyframe('AAAA', [track('a')], 0);
    await s.onCrops([{ id: 'a', jpeg: 'BBBB' }]);
    expect(s.state.thumbnails[productKey('Bananas', null)]).toBe('file:///thumb.jpg');
  });

  it('ignores a crop for a track it cannot identify', async () => {
    const s = new RecognitionSession(deps());
    await s.onCrops([{ id: 'nobody', jpeg: 'BBBB' }]);
    expect(Object.keys(s.state.thumbnails)).toHaveLength(0);
  });

  it('applies a resolved barcode', async () => {
    const d = deps({
      lookupBarcode: jest.fn().mockResolvedValue({ name: 'Pringles', brand: 'Pringles', size: '5.2 oz', category: 'Snacks' }),
    });
    const s = new RecognitionSession(d);
    await s.onBarcodes([{ trackId: 'a', payload: '038000138416' }]);
    expect(s.state.fusion.identities['a'].source).toBe('barcode');
  });

  it('does not re-resolve a barcode already attached to a track', async () => {
    const d = deps({ lookupBarcode: jest.fn().mockResolvedValue({ name: 'X', brand: null, size: null, category: 'y' }) });
    const s = new RecognitionSession(d);
    await s.onBarcodes([{ trackId: 'a', payload: '038000138416' }]);
    await s.onBarcodes([{ trackId: 'a', payload: '038000138416' }]);
    expect((d.lookupBarcode as jest.Mock).mock.calls.length).toBe(1);
  });

  it('drops in-flight work when disposed', async () => {
    const d = deps();
    const s = new RecognitionSession(d);
    s.dispose();
    await s.onKeyframe('AAAA', [track('a')], 0);
    expect(d.requestCensus).not.toHaveBeenCalled();
  });
});
