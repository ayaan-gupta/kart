import {
  AMBER_DWELL_MS,
  amberTrackIds,
  createSessionState,
  marksFor,
  persistentAmber,
  RecognitionSession,
  tracksNeedingThumbnail,
  worthACensus,
} from '../orchestrator';
import {
  GREEN_CONFIDENCE,
  MAX_CENSUS_CALLS_PER_SESSION,
  MAX_IDENTIFY_CALLS_PER_SESSION,
} from '../config';
import { applyCensus, bagLines, createFusionState, productKey } from '../fusion';
import { createTrackerState } from '../byteTrack';
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

  it('I1: does not want one when the caller says pacing has not cleared it', () => {
    // Regression: scan.tsx used to ignore evaluateKeyframe's own verdict entirely and call
    // wantsKeyframe with only the tracks, so minIntervalMs (and the scene-change interval) had
    // no effect on device and the census budget could be spent in well under a minute.
    const s = new RecognitionSession(deps());
    expect(s.wantsKeyframe([track('a')], false)).toBe(false);
    // The default keeps every other caller (and every other existing test in this file) asking
    // only the session-eligibility question.
    expect(s.wantsKeyframe([track('a')])).toBe(true);
    expect(s.wantsKeyframe([track('a')], true)).toBe(true);
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

  it('clears the "come closer" notice once a barcode resolves an amber track', async () => {
    // Regression: persistentAmber used to check only track presence, so an item that went
    // amber from a low-confidence census and was then resolved by its barcode kept showing the
    // notice for the rest of the scan, since no census ever runs again to refresh amberSince.
    const d = deps({
      lookupBarcode: jest.fn().mockResolvedValue({ name: 'Pringles', brand: 'Pringles', size: '5.2 oz', category: 'Snacks' }),
    });
    const s = new RecognitionSession(d);
    s.state = {
      ...s.state,
      fusion: applyCensus(
        createFusionState(),
        {
          marks: [{ id: 1, name: 'Something', brand: null, size: null, category: 'x', confidence: 0.3, needsCloserLook: false }],
          inViewCounts: [{ productKey: productKey('Something', null), count: 1 }],
        },
        { 1: 'a' },
        ['a'],
      ),
      amberSince: { a: 0 },
    };
    expect(persistentAmber(s.state, [track('a')], AMBER_DWELL_MS + 1)).toBe(true);

    await s.onBarcodes([{ trackId: 'a', payload: '038000138416' }]);

    expect(persistentAmber(s.state, [track('a')], AMBER_DWELL_MS + 1)).toBe(false);
  });

  it('does not save the same thumbnail twice for two overlapping crops of one product', async () => {
    // Regression: the thumbnail slot was claimed by reading `thumbnails` before the await and
    // writing it after, so two overlapping onCrops calls for the same product both saw an empty
    // slot and both saved. The frame loop calls onCrops without awaiting it, so this is routine,
    // not a rare interleaving.
    let resolveSave: (v: string | null) => void = () => {};
    const saveThumbnail = jest.fn().mockReturnValue(new Promise<string | null>((r) => { resolveSave = r; }));
    const s = new RecognitionSession(deps({ saveThumbnail }));
    await s.onKeyframe('AAAA', [track('a')], 0);

    const first = s.onCrops([{ id: 'a', jpeg: 'BBBB' }]);
    const second = s.onCrops([{ id: 'a', jpeg: 'CCCC' }]);
    resolveSave('file:///thumb.jpg');
    await Promise.all([first, second]);

    expect(saveThumbnail).toHaveBeenCalledTimes(1);
    expect(s.state.thumbnails[productKey('Bananas', null)]).toBe('file:///thumb.jpg');
  });

  it('does not let a rejecting requestCensus escape onKeyframe as an unhandled rejection', async () => {
    const d = deps({ requestCensus: jest.fn().mockRejectedValue(new Error('network blew up')) });
    const s = new RecognitionSession(d);
    await expect(s.onKeyframe('AAAA', [track('a')], 0)).resolves.toBeUndefined();
    expect(s.state.lastError).toBe('network blew up');
    // The in-flight flag still clears on a throw, so the session can try again next keyframe.
    expect(s.wantsKeyframe([track('a')])).toBe(true);
  });

  it('does not let a rejecting saveThumbnail escape onCrops as an unhandled rejection', async () => {
    const d = deps({ saveThumbnail: jest.fn().mockRejectedValue(new Error('disk full')) });
    const s = new RecognitionSession(d);
    await s.onKeyframe('AAAA', [track('a')], 0);
    await expect(s.onCrops([{ id: 'a', jpeg: 'BBBB' }])).resolves.toBeUndefined();
    expect(s.state.lastError).toBe('disk full');
    expect(Object.keys(s.state.thumbnails)).toHaveLength(0);
  });

  it('does not let a rejecting lookupBarcode escape onBarcodes as an unhandled rejection', async () => {
    const d = deps({ lookupBarcode: jest.fn().mockRejectedValue(new Error('offline')) });
    const s = new RecognitionSession(d);
    await expect(s.onBarcodes([{ trackId: 'a', payload: '038000138416' }])).resolves.toBeUndefined();
    expect(s.state.lastError).toBe('offline');
    expect(s.state.fusion.identities['a']).toBeUndefined();
  });

  describe('resolveUncertain re-keying (regression: the original counting bug, reintroduced)', () => {
    const noOcclusion = { itemsLikelyHidden: false, severity: 'none' as const, reason: '' };

    it('does not undercount two cartons that a crop identify renames to the same new name', async () => {
      // Two physical cartons, both amber under the generic "Milk" guess. Each gets its own
      // crop identify, both resolving to "Horizon Whole Milk". Without aliasing the old
      // "::milk" key to the new one, each single-track applyCensus call only ever sees itself,
      // so the high-water mark for the new key gets stuck at 1 instead of migrating the 2
      // already accumulated under the old key: two cartons, bag says one.
      const milkCensus = {
        ok: true as const,
        value: {
          marks: [
            { id: 1, name: 'Milk', brand: null, size: null, category: 'Dairy', confidence: 0.3, needsCloserLook: false },
            { id: 2, name: 'Milk', brand: null, size: null, category: 'Dairy', confidence: 0.3, needsCloserLook: false },
          ],
          inViewCounts: [{ productKey: productKey('Milk', null), count: 2 }],
          unmarkedItems: [],
          occlusion: noOcclusion,
        },
      };
      const d = deps({
        requestCensus: jest.fn().mockResolvedValue(milkCensus),
        requestIdentify: jest.fn().mockResolvedValue({
          ok: true,
          value: { name: 'Horizon Whole Milk', brand: null, size: null, category: 'Dairy', confidence: 0.9, stillUnclear: false },
        }),
      });
      const s = new RecognitionSession(d);

      await s.onKeyframe('AAAA', [track('m1'), track('m2')], 0);

      const lines = bagLines(s.state.fusion);
      const total = lines.reduce((sum, l) => sum + l.qty, 0);
      expect(total).toBe(2);
      expect(lines).toHaveLength(1);
      expect(lines[0].name).toBe('Horizon Whole Milk');
    });

    it('does not overcount a clamp survivor whose merged siblings never get re-examined', async () => {
      // One bunch of bananas the tracker split into three boxes. The census clamps the count to
      // 1, folding b2 and b3 into merged; b1 is the clamp survivor by compareTrackIds. Only
      // b1's identify call fits in the remaining budget (a realistic shape: other items already
      // spent most of the session's identify budget), so b2 and b3 are never re-examined. Without
      // aliasing "::bananas" to "dole::bananas", b2 and b3's stale key keeps its full accumulated
      // quantity and shows up as a second bag line: one bunch, bag says two.
      const bananaCensus = {
        ok: true as const,
        value: {
          marks: [
            { id: 1, name: 'Bananas', brand: null, size: null, category: 'Produce', confidence: 0.3, needsCloserLook: false },
            { id: 2, name: 'Bananas', brand: null, size: null, category: 'Produce', confidence: 0.3, needsCloserLook: false },
            { id: 3, name: 'Bananas', brand: null, size: null, category: 'Produce', confidence: 0.3, needsCloserLook: false },
          ],
          inViewCounts: [{ productKey: productKey('Bananas', null), count: 1 }],
          unmarkedItems: [],
          occlusion: noOcclusion,
        },
      };
      const d = deps({
        requestCensus: jest.fn().mockResolvedValue(bananaCensus),
        requestIdentify: jest.fn().mockResolvedValue({
          ok: true,
          value: { name: 'Bananas', brand: 'Dole', size: null, category: 'Produce', confidence: 0.9, stillUnclear: false },
        }),
      });
      const s = new RecognitionSession(d);
      s.state = { ...s.state, identifyCalls: MAX_IDENTIFY_CALLS_PER_SESSION - 1 };

      await s.onKeyframe('AAAA', [track('b1'), track('b2'), track('b3')], 0);

      const lines = bagLines(s.state.fusion);
      const total = lines.reduce((sum, l) => sum + l.qty, 0);
      expect(total).toBe(1);
      expect(lines).toHaveLength(1);
    });

    it('does not overcount when the budget runs out after renaming only the first of two siblings', async () => {
      // The partial case, which is the normal one: resolveUncertain returns early once the
      // session's identify ceiling is reached, so stopping mid-group is routine, not rare. Only
      // m1 gets renamed before the budget runs out; m2 is left on the old key. The bag must
      // still total 2, whether that shows as one line (the old key resolving through the new
      // alias) or two, never 3.
      const milkCensus = {
        ok: true as const,
        value: {
          marks: [
            { id: 1, name: 'Milk', brand: null, size: null, category: 'Dairy', confidence: 0.3, needsCloserLook: false },
            { id: 2, name: 'Milk', brand: null, size: null, category: 'Dairy', confidence: 0.3, needsCloserLook: false },
          ],
          inViewCounts: [{ productKey: productKey('Milk', null), count: 2 }],
          unmarkedItems: [],
          occlusion: noOcclusion,
        },
      };
      const d = deps({
        requestCensus: jest.fn().mockResolvedValue(milkCensus),
        requestIdentify: jest.fn().mockResolvedValue({
          ok: true,
          value: { name: 'Horizon Whole Milk', brand: null, size: null, category: 'Dairy', confidence: 0.9, stillUnclear: false },
        }),
      });
      const s = new RecognitionSession(d);
      s.state = { ...s.state, identifyCalls: MAX_IDENTIFY_CALLS_PER_SESSION - 1 };

      await s.onKeyframe('AAAA', [track('m1'), track('m2')], 0);

      expect((d.requestIdentify as jest.Mock).mock.calls.length).toBe(1);
      const lines = bagLines(s.state.fusion);
      const total = lines.reduce((sum, l) => sum + l.qty, 0);
      expect(total).toBe(2);
    });

    it('does not let a crop identify redirect an already-established barcode key', async () => {
      // A barcode that never resolved a name is still ground truth for counting (see fusion.ts,
      // Identity.placeholder): its key must stay put no matter what a single, uncorroborated
      // crop guess says, exactly like a barcode that did resolve. Aliasing away from a barcode
      // key here would let one crop identify silently override a UPC scan.
      const d = deps({
        lookupBarcode: jest.fn().mockResolvedValue(null),
        requestCensus: jest.fn().mockResolvedValue({
          ok: true,
          value: { marks: [], inViewCounts: [], unmarkedItems: [], occlusion: noOcclusion },
        }),
        requestIdentify: jest.fn().mockResolvedValue({
          ok: true,
          value: { name: 'Pringles', brand: 'Pringles', size: '5.2 oz', category: 'Snacks', confidence: 0.9, stillUnclear: false },
        }),
      });
      const s = new RecognitionSession(d);
      await s.onBarcodes([{ trackId: 'x', payload: '038000138416' }]);
      expect(s.state.fusion.identities['x'].placeholder).toBe(true);

      await s.onKeyframe('AAAA', [track('x')], 0);

      expect(s.state.fusion.identities['x'].key).toBe('upc:038000138416');
      expect(s.state.fusion.identities['x'].name).toBe('Pringles');
      expect(s.state.fusion.identities['x'].source).toBe('barcode');
      expect(s.state.fusion.aliases['upc:038000138416']).toBeUndefined();
    });

    it('I6: a later plain census does not clobber what a crop identify already found', async () => {
      // Regression: applyCensus overwrote any vlm identity unconditionally, so a crop identify's
      // better name and confidence were discarded by the very next wide-shot census. That made
      // the whole identify path pointless: it spends up to 6 network calls per session and keeps
      // none of them, and the item goes back to amber immediately after being resolved.
      const unsureMilk = {
        ok: true as const,
        value: {
          marks: [{ id: 1, name: 'Milk', brand: null, size: null, category: 'Dairy', confidence: 0.3, needsCloserLook: true }],
          inViewCounts: [{ productKey: productKey('Milk', null), count: 1 }],
          unmarkedItems: [],
          occlusion: noOcclusion,
        },
      };
      const d = deps({
        requestCensus: jest.fn().mockResolvedValue(unsureMilk),
        requestIdentify: jest.fn().mockResolvedValue({
          ok: true,
          value: { name: 'Horizon Whole Milk', brand: null, size: null, category: 'Dairy', confidence: 0.9, stillUnclear: false },
        }),
      });
      const s = new RecognitionSession(d);

      await s.onKeyframe('AAAA', [track('a')], 0);
      expect(s.state.fusion.identities['a'].name).toBe('Horizon Whole Milk');
      expect(s.state.fusion.identities['a'].confidence).toBe(0.9);
      expect((d.requestIdentify as jest.Mock).mock.calls.length).toBe(1);

      // A later keyframe's census still only sees the generic guess (the model has no memory of
      // the earlier crop). The identify result must survive it.
      await s.onKeyframe('AAAA', [track('a')], 3000);

      expect(s.state.fusion.identities['a'].name).toBe('Horizon Whole Milk');
      expect(s.state.fusion.identities['a'].confidence).toBe(0.9);
      // Still confidently green, so the second keyframe must not have spent another identify
      // call re-resolving something that was never actually lost.
      expect((d.requestIdentify as jest.Mock).mock.calls.length).toBe(1);
    });
  });
});

describe('RecognitionSession.onCapture: the capture path', () => {
  // The server enumerates, badges, names and returns the geometry, because the device ran no
  // detector at all. See server/src/enumerate.ts and docs/detector-decision.md.
  const region = (id: number, x: number, name: string) => ({
    id,
    box: { x, y: 0.2, w: 0.2, h: 0.2 },
    polygon: [x, 0.2, x + 0.2, 0.2, x + 0.2, 0.4, x, 0.4],
    score: 0.9,
    name,
  });

  const captureOk = (regions: ReturnType<typeof region>[], enumeration = 'ok') => ({
    ok: true as const,
    value: {
      marks: regions.map((r) => ({
        id: r.id, name: r.name, brand: null, size: null, category: 'Produce',
        confidence: 0.95, needsCloserLook: false, isProduct: true,
      })),
      inViewCounts: [],
      unmarkedItems: [],
      occlusion: { itemsLikelyHidden: false, severity: 'none' as const, reason: '' },
      regions: regions.map(({ id, box, polygon, score }) => ({ id, box, polygon, score })),
      enumeration,
    },
  });

  const captureDeps = (over: Record<string, unknown> = {}) => ({
    requestCensus: jest.fn().mockResolvedValue(captureOk([region(1, 0.1, 'Bananas'), region(2, 0.5, 'Milk')])),
    requestIdentify: jest.fn().mockResolvedValue({
      ok: true,
      value: { name: 'Bananas', brand: null, size: null, category: 'Produce', confidence: 0.9, stillUnclear: false },
    }),
    lookupBarcode: jest.fn().mockResolvedValue(null),
    saveThumbnail: jest.fn().mockResolvedValue('file:///thumb.jpg'),
    ...over,
  });

  it('sends no marks, which is what asks the server to find the regions', async () => {
    const d = captureDeps();
    await new RecognitionSession(d).onCapture('img', createTrackerState(), 1000);
    expect(d.requestCensus.mock.calls[0][0].marks).toBeUndefined();
  });

  it('turns the returned regions into confirmed tracks in one capture', async () => {
    // minHits is 1 here, unlike the live path's 3: a capture is one deliberate authoritative
    // look, so holding everything tentative would draw the whole cart as "still forming".
    const result = await new RecognitionSession(captureDeps()).onCapture('img', createTrackerState(), 1000);
    expect(result).not.toBeNull();
    expect(result!.tracks).toHaveLength(2);
    expect(result!.tracks.every((t) => t.state === 'confirmed')).toBe(true);
  });

  it('carries the returned polygon onto the track, so there is something to outline', async () => {
    const result = await new RecognitionSession(captureDeps()).onCapture('img', createTrackerState(), 1000);
    expect(result!.tracks[0].polygon.length).toBeGreaterThanOrEqual(6);
  });

  it('names each track from the mark on its own region, not another one', async () => {
    const s = new RecognitionSession(captureDeps());
    const result = await s.onCapture('img', createTrackerState(), 1000);
    const named = result!.tracks.map((t) => s.state.fusion.identities[t.id]?.name).sort();
    expect(named).toEqual(['Bananas', 'Milk']);
  });

  it('puts both products in the bag, once each', async () => {
    const s = new RecognitionSession(captureDeps());
    await s.onCapture('img', createTrackerState(), 1000);
    expect(bagLines(s.state.fusion).map((l) => [l.name, l.qty]).sort()).toEqual([['Bananas', 1], ['Milk', 1]]);
  });

  it('does not count the same cart twice across two captures of it', async () => {
    // The high-water-mark rule is what makes several captures accumulate into one bag rather
    // than a running total, and it only works if the second capture associates against the
    // first one's tracks. That is why the tracker is threaded through.
    const s = new RecognitionSession(captureDeps());
    const first = await s.onCapture('img', createTrackerState(), 1000);
    await s.onCapture('img2', first!.tracker, 2000);
    expect(bagLines(s.state.fusion).map((l) => [l.name, l.qty]).sort()).toEqual([['Bananas', 1], ['Milk', 1]]);
  });

  it('still fills the bag when the enumerator was unreachable', async () => {
    // No regions and no outlines, but the model still named what it could see. Measured at 72%
    // of hand-labelled units on real photographs, which is far better than failing the capture.
    const d = captureDeps({
      requestCensus: jest.fn().mockResolvedValue({
        ok: true,
        value: {
          marks: [], inViewCounts: [],
          unmarkedItems: [{ description: 'Bananas', productKey: '::bananas', approxLocation: 'middle', confidence: 0.8 }],
          occlusion: { itemsLikelyHidden: false, severity: 'none' as const, reason: '' },
          regions: [], enumeration: 'degraded',
        },
      }),
    });
    const s = new RecognitionSession(d);
    const result = await s.onCapture('img', createTrackerState(), 1000);

    expect(result!.tracks).toHaveLength(0);
    expect(bagLines(s.state.fusion).map((l) => [l.name, l.qty])).toEqual([['Bananas', 1]]);
    expect(s.state.lastError).toBe('enumeration unavailable');
  });

  it('returns null rather than throwing when the endpoint is not configured', async () => {
    const d = captureDeps({ requestCensus: jest.fn().mockResolvedValue({ ok: false, failure: 'unconfigured' }) });
    const s = new RecognitionSession(d);
    expect(await s.onCapture('img', createTrackerState(), 1000)).toBeNull();
    // And it stops asking, because that can never start working mid-session.
    expect(await s.onCapture('img', createTrackerState(), 2000)).toBeNull();
    expect(d.requestCensus).toHaveBeenCalledTimes(1);
  });

  it('does not start a second capture while one is in flight', async () => {
    let release: (v: unknown) => void = () => {};
    const d = captureDeps({ requestCensus: jest.fn().mockReturnValue(new Promise((r) => { release = r; })) });
    const s = new RecognitionSession(d);
    const first = s.onCapture('img', createTrackerState(), 1000);
    expect(await s.onCapture('img', createTrackerState(), 1100)).toBeNull();
    release(captureOk([region(1, 0.1, 'Bananas')]));
    await first;
    expect(d.requestCensus).toHaveBeenCalledTimes(1);
  });

  it('drops a region that matched no track rather than attaching it to the wrong one', async () => {
    // A region the tracker rejected has no track to carry its identity, and guessing would put
    // one item's name on another item's outline.
    const d = captureDeps({
      requestCensus: jest.fn().mockResolvedValue(captureOk([
        { ...region(1, 0.1, 'Bananas') },
        { ...region(2, 0.5, 'Milk'), box: { x: 0.5, y: 0.2, w: 0, h: 0 }, polygon: [0.5, 0.2, 0.5, 0.2, 0.5, 0.2] },
      ])),
    });
    const s = new RecognitionSession(d);
    const result = await s.onCapture('img', createTrackerState(), 1000);
    const named = result!.tracks.map((t) => s.state.fusion.identities[t.id]?.name).filter(Boolean);
    expect(named).toEqual(['Bananas']);
  });
});

describe('worthACensus', () => {
  const confirmed = (id: string): Track =>
    ({ id, box: { x: 0, y: 0, w: 0.2, h: 0.2 }, polygon: [0, 0, 0.2, 0, 0.2, 0.2], score: 0.9,
       state: 'confirmed', hits: 5, lastSeenAt: 0, barcode: null,
       filter: {} as Track['filter'] }) as Track;

  const named = (id: string) => ({
    ...createSessionState(),
    censusCalls: MAX_CENSUS_CALLS_PER_SESSION / 2,
    fusion: {
      ...createFusionState(),
      identities: {
        [id]: { key: '::x', name: 'X', brand: null, size: null, category: 'Grocery',
                confidence: 0.9, needsCloserLook: false, source: 'vlm' as const,
                placeholder: false, verifiedByIdentify: false },
      },
    },
  });

  it('spends the first half of the budget on any confirmed track', () => {
    // Repeat calls early are how a wrong name is corrected and how a quantity is refined, so the
    // early budget is deliberately unconditional.
    expect(worthACensus(createSessionState(), [confirmed('a')])).toBe(true);
  });

  it('stops spending the second half on a frame where everything is already named', () => {
    // Measured on four thirty-second sessions of real handheld footage: the whole budget went in
    // the first fourteen to sixteen seconds, every call landing on the same items as the camera
    // lingered, and everything that entered frame afterwards was never examined.
    expect(worthACensus(named('a'), [confirmed('a')])).toBe(false);
  });

  it('still spends the second half when something in frame has no name yet', () => {
    expect(worthACensus(named('a'), [confirmed('a'), confirmed('fresh')])).toBe(true);
  });

  it('never spends on a frame with no confirmed track', () => {
    const tentative = { ...confirmed('a'), state: 'tentative' as const };
    expect(worthACensus(createSessionState(), [tentative])).toBe(false);
  });

  it('never spends past the budget', () => {
    const spent = { ...createSessionState(), censusCalls: MAX_CENSUS_CALLS_PER_SESSION };
    expect(worthACensus(spent, [confirmed('fresh')])).toBe(false);
  });
});

describe('the census is told what the session has already counted', () => {
  // Server-side parsing of `counted` is covered in server/test/api-census.test.ts. Nothing covered
  // the client actually sending it, and dropping the argument would silently disable the feature:
  // no test fails, no type breaks, and the bag goes back to holding one product under three names.
  // Measured on server/eval/pipeline/scan-loop.ts, that is 1.7 lines matching nothing real per bag
  // instead of 0.33.
  const censusOk = {
    ok: true as const,
    value: {
      regions: [],
      enumeration: 'ok' as const,
      marks: [{ id: 1, name: 'Bananas', brand: null, size: null, category: 'Produce', confidence: 0.95, needsCloserLook: false }],
      inViewCounts: [{ productKey: productKey('Bananas', null), count: 1 }],
      unmarkedItems: [],
      occlusion: { itemsLikelyHidden: false, severity: 'none' as const, reason: '' },
    },
  };
  const deps = (over: Record<string, unknown> = {}) => ({
    requestCensus: jest.fn().mockResolvedValue(censusOk),
    requestIdentify: jest.fn().mockResolvedValue({ ok: false, failure: 'server' }),
    lookupBarcode: jest.fn().mockResolvedValue(null),
    saveThumbnail: jest.fn().mockResolvedValue(null),
    ...over,
  });

  it('sends the field on the very first keyframe, empty because nothing is counted yet', async () => {
    const d = deps();
    const s = new RecognitionSession(d);
    await s.onKeyframe('AAAA', [track('a')], 0);
    expect((d.requestCensus as jest.Mock).mock.calls[0][0]).toHaveProperty('counted', []);
  });

  it('sends what the bag holds on the next keyframe', async () => {
    const d = deps();
    const s = new RecognitionSession(d);
    await s.onKeyframe('AAAA', [track('a')], 0);
    await s.onKeyframe('AAAA', [track('a')], 5000);
    const second = (d.requestCensus as jest.Mock).mock.calls[1][0];
    expect(second.counted).toEqual(['Bananas']);
  });

  it('sends it on the capture path too, which is the one the app uses', async () => {
    const d = deps();
    const s = new RecognitionSession(d);
    await s.onCapture('AAAA', createTrackerState(), 0);
    expect((d.requestCensus as jest.Mock).mock.calls[0][0]).toHaveProperty('counted');
  });
});
