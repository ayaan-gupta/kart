import {
  addAlias,
  applyBarcode,
  applyCensus,
  bagLines,
  createFusionState,
  productKey,
  resolveKey,
  type CensusResult,
} from '../fusion';

const mark = (id: number, name: string, brand: string | null = null, conf = 0.9, closer = false) => ({
  id, name, brand, size: null, category: 'Produce', confidence: conf, needsCloserLook: closer,
});

const census = (marks: ReturnType<typeof mark>[], counts: [string, number][]): CensusResult => ({
  marks,
  inViewCounts: counts.map(([productKey, count]) => ({ productKey, count })),
});

describe('productKey', () => {
  // This function is duplicated in server/src/schemas.ts on purpose: the client cannot import
  // from the server package. These cases are the contract between the two copies. If one side
  // is edited, these fail, which is the only warning anyone gets before the in-view clamp
  // silently stops matching and duplicate items come back.
  it('folds accents to the base letter', () => {
    expect(productKey('Café Bustelo', null)).toBe(productKey('Cafe Bustelo', null));
  });

  it('folds case and punctuation', () => {
    expect(productKey("Kellogg's Froot Loops", null)).toBe(productKey('KELLOGGS FROOT LOOPS', null));
  });

  it('collapses runs of whitespace', () => {
    expect(productKey('  Whole   Milk  ', ' Horizon ')).toBe(productKey('Whole Milk', 'Horizon'));
  });

  it('namespaces on brand', () => {
    expect(productKey('Milk', 'Horizon')).not.toBe(productKey('Milk', null));
  });

  it('matches the server implementation exactly', () => {
    // Copied verbatim from server/src/schemas.ts. Do not refactor into a shared helper; the
    // duplication is the test.
    const serverKey = (name: string, brand: string | null) => {
      const norm = (s: string) =>
        s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
          .replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
      return `${brand ? norm(brand) : ''}::${norm(name)}`;
    };
    const cases: [string, string | null][] = [
      ['Bananas', null], ['Café Bustelo', 'Café'], ['Häagen-Dazs', null],
      ['2% Milk, 1 gal', 'Great Value'], ['jalapeño peppers', null], ['', ''],
      ['100% Juice', null], ['naïve crème brûlée', "Trader Joe's"],
    ];
    for (const [name, brand] of cases) {
      expect(productKey(name, brand)).toBe(serverKey(name, brand));
    }
  });
});

describe('the duplicate bananas bug', () => {
  it('collapses three tracks on one bunch to a single item', () => {
    // The exact reported failure: "classified one bunch of bananas as multiple bunches".
    let state = createFusionState();
    state = applyCensus(
      state,
      census([mark(1, 'Bananas'), mark(2, 'Bananas'), mark(3, 'Bananas')], [[productKey('Bananas', null), 1]]),
      { 1: 't1', 2: 't2', 3: 't3' },
      ['t1', 't2', 't3'],
    );
    const lines = bagLines(state);
    expect(lines).toHaveLength(1);
    expect(lines[0].qty).toBe(1);
    expect(state.merged).toHaveLength(2);
  });

  it('keeps the same survivor across repeated censuses instead of flickering', () => {
    let state = createFusionState();
    const call = () =>
      applyCensus(
        state,
        census([mark(1, 'Bananas'), mark(2, 'Bananas')], [[productKey('Bananas', null), 1]]),
        { 1: 't1', 2: 't2' },
        ['t1', 't2'],
      );
    state = call();
    const firstSurvivor = ['t1', 't2'].filter((id) => !state.merged.includes(id));
    state = call();
    const secondSurvivor = ['t1', 't2'].filter((id) => !state.merged.includes(id));
    expect(secondSurvivor).toEqual(firstSurvivor);
  });
});

describe('the in-view clamp', () => {
  it('preserves honest multiples', () => {
    let state = createFusionState();
    state = applyCensus(
      state,
      census([mark(1, 'Whole milk'), mark(2, 'Whole milk')], [[productKey('Whole milk', null), 2]]),
      { 1: 't1', 2: 't2' },
      ['t1', 't2'],
    );
    expect(bagLines(state)[0].qty).toBe(2);
  });

  it('does not double count when the camera pans away and back', () => {
    // ByteTrack drops a track past maxLostMs, so returning to the same two cartons produces two
    // brand new ids. Counting distinct tracks would say four here. This is the case that the
    // spec's "number of distinct tracks" rule gets wrong.
    let state = createFusionState();
    const key = productKey('Whole milk', null);
    const twoCartons = census([mark(1, 'Whole milk'), mark(2, 'Whole milk')], [[key, 2]]);
    state = applyCensus(state, twoCartons, { 1: 't1', 2: 't2' }, ['t1', 't2']);
    state = applyCensus(state, twoCartons, { 1: 't9', 2: 't10' }, ['t9', 't10']);
    expect(bagLines(state)[0].qty).toBe(2);
  });

  it('does not shrink the bag when a later frame sees fewer items', () => {
    let state = createFusionState();
    const key = productKey('Apple', null);
    state = applyCensus(
      state,
      census([mark(1, 'Apple'), mark(2, 'Apple'), mark(3, 'Apple'), mark(4, 'Apple')], [[key, 4]]),
      { 1: 'a', 2: 'b', 3: 'c', 4: 'd' },
      ['a', 'b', 'c', 'd'],
    );
    expect(bagLines(state)[0].qty).toBe(4);
    state = applyCensus(state, census([mark(1, 'Apple'), mark(2, 'Apple')], [[key, 2]]), { 1: 'a', 2: 'b' }, ['a', 'b']);
    expect(bagLines(state)[0].qty).toBe(4);
  });

  it('never clamps tracks that were out of view for this keyframe', () => {
    // The model only ever sees one frame. Letting its count act on items the camera has already
    // moved past would delete them from the bag.
    let state = createFusionState();
    const key = productKey('Yogurt', null);
    state = applyCensus(state, census([mark(1, 'Yogurt'), mark(2, 'Yogurt')], [[key, 2]]), { 1: 'y1', 2: 'y2' }, ['y1', 'y2']);
    state = applyCensus(state, census([mark(7, 'Yogurt')], [[key, 1]]), { 7: 'y3' }, ['y3']);
    expect(bagLines(state)[0].qty).toBe(2);
    expect(state.merged).not.toContain('y1');
    expect(state.merged).not.toContain('y2');
  });

  it('trusts the tracker when the model reports no count for a product', () => {
    let state = createFusionState();
    state = applyCensus(state, census([mark(1, 'Bread'), mark(2, 'Bread')], []), { 1: 'b1', 2: 'b2' }, ['b1', 'b2']);
    expect(bagLines(state)[0].qty).toBe(2);
  });

  it('treats a negative count from the model as zero rather than as a slice offset', () => {
    let state = createFusionState();
    state = applyCensus(state, census([mark(1, 'Kale')], [[productKey('Kale', null), -3]]), { 1: 'k1' }, ['k1']);
    expect(bagLines(state)).toHaveLength(0);
  });

  it('drops a mark id that was never sent', () => {
    let state = createFusionState();
    state = applyCensus(state, census([mark(99, 'Ghost')], [[productKey('Ghost', null), 1]]), { 1: 't1' }, ['t1']);
    expect(bagLines(state)).toHaveLength(0);
  });

  it('recovers from one occluded keyframe once a later, honest census gives an explicit count', () => {
    // Regression for a defect found in review: the merge set only ever grew, so a single
    // glare-washed keyframe that undercounted six real apples as one permanently pinned the
    // quantity at 1 for the rest of the session, even once five subsequent honest keyframes
    // said 6.
    let state = createFusionState();
    const key = productKey('Apple', null);
    const marks = [1, 2, 3, 4, 5, 6].map((id) => mark(id, 'Apple'));
    const markToTrack = { 1: 'a1', 2: 'a2', 3: 'a3', 4: 'a4', 5: 'a5', 6: 'a6' };
    const liveTrackIds = Object.values(markToTrack);

    // Keyframe 1: glare washes out the frame and the model badly undercounts.
    state = applyCensus(state, census(marks, [[key, 1]]), markToTrack, liveTrackIds);
    expect(bagLines(state)[0].qty).toBe(1);

    // Five honest keyframes in a row, same six tracks still live, explicit correct count.
    for (let i = 0; i < 5; i++) {
      state = applyCensus(state, census(marks, [[key, 6]]), markToTrack, liveTrackIds);
    }
    expect(bagLines(state)[0].qty).toBe(6);
  });

  it('does not let an explicit revision reintroduce the split-bananas overcount on a later silent census', () => {
    // Companion to the six-apples recovery: an explicit count is allowed to raise a clamp, but a
    // later census that says nothing about the product at all must not undo the fold, or the
    // original duplicate-bananas bug creeps back in.
    let state = createFusionState();
    const key = productKey('Bananas', null);
    const marks = [mark(1, 'Bananas'), mark(2, 'Bananas'), mark(3, 'Bananas')];
    const markToTrack = { 1: 't1', 2: 't2', 3: 't3' };
    const liveTrackIds = ['t1', 't2', 't3'];

    state = applyCensus(state, census(marks, [[key, 1]]), markToTrack, liveTrackIds);
    expect(bagLines(state)[0].qty).toBe(1);

    // A later census sees the same three tracks but has no opinion on bananas at all this frame.
    state = applyCensus(state, census(marks, []), markToTrack, liveTrackIds);
    expect(bagLines(state)[0].qty).toBe(1);
  });
});

describe('barcode identity', () => {
  it('absorbs the model key and keeps the quantity', () => {
    // The regression that this design originally had: aliasing stranded maxSimultaneous under
    // the old key, so scanning a UPC made an already-counted item vanish from the bag.
    let state = createFusionState();
    const vlm = productKey('Honey Nut Cheerios', 'General Mills');
    state = applyCensus(
      state,
      census(
        [mark(1, 'Honey Nut Cheerios', 'General Mills'), mark(2, 'Honey Nut Cheerios', 'General Mills')],
        [[vlm, 2]],
      ),
      { 1: 'c1', 2: 'c2' },
      ['c1', 'c2'],
    );
    expect(bagLines(state)[0].qty).toBe(2);

    state = applyBarcode(state, 'c1', '016000275270', {
      name: 'Gmills hny nut cheerios sweetened whl grn oat cereal',
      brand: 'General Mills',
      size: '347 g',
      category: 'Cereal',
    });

    const lines = bagLines(state);
    expect(lines).toHaveLength(1);
    expect(lines[0].qty).toBe(2);
  });

  it('keeps the clean model name over the Open Food Facts retail string', () => {
    let state = createFusionState();
    state = applyCensus(
      state,
      census([mark(1, 'Honey Nut Cheerios', 'General Mills')], [[productKey('Honey Nut Cheerios', 'General Mills'), 1]]),
      { 1: 'c1' },
      ['c1'],
    );
    state = applyBarcode(state, 'c1', '016000275270', {
      name: 'Gmills hny nut cheerios sweetened whl grn oat cereal',
      brand: 'General Mills',
      size: '347 g',
      category: 'Cereal',
    });
    expect(bagLines(state)[0].name).toBe('Honey Nut Cheerios');
    // ...but takes the size, which the model did not give us.
    expect(bagLines(state)[0].size).toBe('347 g');
  });

  it('falls back to the Open Food Facts name when the model never named it', () => {
    let state = createFusionState();
    state = applyBarcode(state, 't1', '038000138416', {
      name: 'Original Potato Crisps', brand: 'Pringles', size: '5.2 oz', category: 'Snacks',
    });
    expect(state.identities['t1'].name).toBe('Original Potato Crisps');
  });

  it('is not overwritten by a later model guess, and one misread does not permanently weld an unrelated product into the line', () => {
    // Regression for a defect found in review: welding a mark's key into a barcoded track's
    // identity with no repetition requirement meant a single bad keyframe (glare, a half-second
    // misread) permanently aliased an unrelated product's key onto the barcode's line. A later
    // census with the true contents then collapsed everything onto one line and the unrelated
    // product's genuine items never appeared in the bag at all.
    let state = createFusionState();
    state = applyBarcode(state, 'c1', '016000275270', {
      name: 'Gmills hny nut cheerios', brand: 'General Mills', size: '347 g', category: 'Cereal',
    });
    // One bad keyframe misreads the barcoded track as Corn Flakes.
    state = applyCensus(
      state,
      census([mark(1, 'Corn Flakes', 'Kellogg')], [[productKey('Corn Flakes', 'Kellogg'), 1]]),
      { 1: 'c1' },
      ['c1'],
    );
    expect(state.identities['c1'].source).toBe('barcode');

    // A later census with the true contents: Cheerios still on c1, and two genuine Corn Flakes
    // boxes on their own tracks, with an honest in-view count for each.
    const cornFlakesKey = productKey('Corn Flakes', 'Kellogg');
    state = applyCensus(
      state,
      census(
        [mark(1, 'Cheerios', 'General Mills'), mark(2, 'Corn Flakes', 'Kellogg'), mark(3, 'Corn Flakes', 'Kellogg')],
        [[cornFlakesKey, 2]],
      ),
      { 1: 'c1', 2: 'f1', 3: 'f2' },
      ['c1', 'f1', 'f2'],
    );

    const lines = bagLines(state);
    expect(lines).toHaveLength(2);
    expect(lines.find((l) => l.key === cornFlakesKey)?.qty).toBe(2);
  });

  it('welds a model guess onto the barcode line only once it repeats on a second census', () => {
    let state = createFusionState();
    state = applyBarcode(state, 'c1', '016000275270', {
      name: 'Gmills hny nut cheerios', brand: 'General Mills', size: '347 g', category: 'Cereal',
    });
    const misreadKey = productKey('Corn Flakes', 'Kellogg');
    const misread = census([mark(1, 'Corn Flakes', 'Kellogg')], [[misreadKey, 1]]);
    state = applyCensus(state, misread, { 1: 'c1' }, ['c1']);
    expect(state.aliases[misreadKey]).toBeUndefined();
    state = applyCensus(state, misread, { 1: 'c1' }, ['c1']);
    expect(state.aliases[misreadKey]).toBe(state.identities['c1'].key);
  });

  it('records nothing countable for a barcode the database does not know', () => {
    let state = createFusionState();
    state = applyBarcode(state, 't1', '021130126026', null);
    // An identity exists so the overlay can show something, but nothing enters the bag until a
    // census actually counts it in view.
    expect(state.identities['t1']).toBeDefined();
    expect(bagLines(state)).toHaveLength(0);
  });

  it('lets a confident census correct a barcode that never resolved a name', () => {
    // Regression: an unresolved lookup (offline, rate limited, or a real database miss) used to
    // set confidence 1 on the "Scanned item" placeholder, which is high enough that applyCensus's
    // barcode protection froze it there forever. The fix is to make an unresolved barcode's name
    // freely replaceable while its key stays put, so the UPC keeps doing its job as the counting
    // key even while the display name is still catching up.
    let state = createFusionState();
    state = applyBarcode(state, 't1', '021130126026', null);
    expect(state.identities['t1'].name).toBe('Scanned item');
    expect(state.identities['t1'].confidence).toBeLessThan(1);

    state = applyCensus(state, census([mark(1, 'Pringles', 'Pringles', 0.95)], []), { 1: 't1' }, ['t1']);

    expect(state.identities['t1'].name).toBe('Pringles');
    expect(state.identities['t1'].confidence).toBe(0.95);
    // Still the barcode's own key, not a productKey derived from the guess: the UPC is what a
    // sibling track's own barcode read, or a future alias, needs to land on the same line.
    expect(state.identities['t1'].key).toBe('upc:021130126026');
    expect(state.identities['t1'].source).toBe('barcode');

    // Now that it has a real name, it is protected exactly like any other barcode identity: one
    // misread does not un-name it.
    state = applyCensus(state, census([mark(1, 'Corn Flakes', 'Kellogg')], []), { 1: 't1' }, ['t1']);
    expect(state.identities['t1'].name).toBe('Pringles');
  });

  it('does not overcount two different barcodes that shared one generic model name', () => {
    // Regression for a defect found in review: addAlias used to clobber an existing redirect
    // unconditionally, so scanning the second of two differently-flavoured cups (both named
    // just "Yogurt" by the model) stole the first cup's stranded quantity, leaving one line at
    // 2 and a second at 1 for two physical cups: three items instead of two.
    let state = createFusionState();
    const genericKey = productKey('Yogurt', null);
    state = applyCensus(
      state,
      census([mark(1, 'Yogurt'), mark(2, 'Yogurt')], [[genericKey, 2]]),
      { 1: 'y1', 2: 'y2' },
      ['y1', 'y2'],
    );
    expect(bagLines(state)[0].qty).toBe(2);

    state = applyBarcode(state, 'y1', '000000000001', {
      name: 'Strawberry Yogurt', brand: null, size: '6 oz', category: 'Dairy',
    });
    state = applyBarcode(state, 'y2', '000000000002', {
      name: 'Blueberry Yogurt', brand: null, size: '6 oz', category: 'Dairy',
    });

    // Both cups are still in view; nothing new to identify, but the clamp re-derives quantity
    // for whatever key each track now carries.
    state = applyCensus(state, census([], []), {}, ['y1', 'y2']);

    const lines = bagLines(state);
    expect(lines.reduce((sum, l) => sum + l.qty, 0)).toBe(2);
  });
});

describe('addAlias', () => {
  it('moves the accumulated quantity to the surviving key', () => {
    let state = createFusionState();
    state = { ...state, maxSimultaneous: { 'a::x': 3 } };
    state = addAlias(state, 'a::x', 'upc:123');
    expect(state.maxSimultaneous['upc:123']).toBe(3);
    expect(state.maxSimultaneous['a::x']).toBeUndefined();
  });

  it('keeps the larger of the two quantities when both keys have one', () => {
    let state = createFusionState();
    state = { ...state, maxSimultaneous: { 'a::x': 3, 'upc:123': 1 } };
    state = addAlias(state, 'a::x', 'upc:123');
    expect(state.maxSimultaneous['upc:123']).toBe(3);
  });

  it('is a no-op when the keys already resolve to the same place', () => {
    let state = createFusionState();
    state = addAlias(state, 'a::x', 'upc:123');
    const same = addAlias(state, 'a::x', 'upc:123');
    expect(same.aliases).toEqual(state.aliases);
  });

  it('does not spin on a cycle', () => {
    // Aliases are written from two call sites, so a cycle is reachable. A wrong answer is
    // survivable here; a hung frame handler is not.
    const state = { ...createFusionState(), aliases: { a: 'b', b: 'a' } };
    expect(() => resolveKey(state, 'a')).not.toThrow();
    expect(typeof resolveKey(state, 'a')).toBe('string');
  });
});
