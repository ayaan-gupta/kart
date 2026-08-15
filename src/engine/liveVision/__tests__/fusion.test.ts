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

  it('is not overwritten by a later model guess', () => {
    let state = createFusionState();
    state = applyBarcode(state, 'c1', '016000275270', {
      name: 'Gmills hny nut cheerios', brand: 'General Mills', size: '347 g', category: 'Cereal',
    });
    state = applyCensus(
      state,
      census([mark(1, 'Corn Flakes', 'Kellogg')], [[productKey('Corn Flakes', 'Kellogg'), 1]]),
      { 1: 'c1' },
      ['c1'],
    );
    expect(state.identities['c1'].source).toBe('barcode');
    expect(bagLines(state)).toHaveLength(1);
  });

  it('records nothing countable for a barcode the database does not know', () => {
    let state = createFusionState();
    state = applyBarcode(state, 't1', '021130126026', null);
    // An identity exists so the overlay can show something, but nothing enters the bag until a
    // census actually counts it in view.
    expect(state.identities['t1']).toBeDefined();
    expect(bagLines(state)).toHaveLength(0);
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
