import {
  addAlias,
  applyBarcode,
  applyCensus,
  bagLines,
  createFusionState,
  productKey,
  resolveKey,
  type CensusMark,
  type CensusResult,
} from '../fusion';

const mark = (id: number, name: string, brand: string | null = null, conf = 0.9, closer = false) => ({
  id, name, brand, size: null, category: 'Produce', confidence: conf, needsCloserLook: closer,
  isProduct: true,
});

/** A badge the model says is not on a product at all: cart frame, bag handle, a shopper's leg. */
const nonProduct = (id: number, name: string) => ({ ...mark(id, name), isProduct: false });

const census = (
  marks: CensusMark[],
  counts: [string, number][],
  unmarked: { description: string; productKey?: string; confidence?: number }[] = [],
): CensusResult => ({
  marks,
  inViewCounts: counts.map(([productKey, count]) => ({ productKey, count })),
  unmarkedItems: unmarked,
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
    const serverFold = (word: string) => {
      if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
      if (word.length > 4 && /(?:ss|sh|ch|x)es$/.test(word)) return word.slice(0, -2);
      if (word.length > 2 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
      return word;
    };
    const serverKey = (name: string, brand: string | null) => {
      const norm = (s: string) =>
        s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
          .replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
      const foldName = (s: string) => norm(s).split(' ').map(serverFold).join(' ');
      return `${brand ? norm(brand) : ''}::${foldName(name)}`;
    };
    const cases: [string, string | null][] = [
      ['Bananas', null], ['Café Bustelo', 'Café'], ['Häagen-Dazs', null],
      ['2% Milk, 1 gal', 'Great Value'], ['jalapeño peppers', null], ['', ''],
      ['100% Juice', null], ['naïve crème brûlée', "Trader Joe's"],
      // The fold's own edges, so a change to one copy and not the other is caught here.
      ['red apple', null], ['red apples', null], ['berries', null], ['pies', null],
      ['boxes', null], ['glass', null], ['asparagus', null], ['peaches', null],
      ['bus', null], ['ss', null], ['a', null],
    ];
    for (const [name, brand] of cases) {
      expect(productKey(name, brand)).toBe(serverKey(name, brand));
    }
  });

  it('brings a singular and its plural to one key, and leaves different products apart', () => {
    // A scan asks the same question four times and the model picks the number freshly each time:
    // "red apples" at five seconds, "red apple" at seven, two bag lines for one bag of apples.
    expect(productKey('red apple', null)).toBe(productKey('red apples', null));
    expect(productKey('Granny Smith Apples', null)).toBe(productKey('granny smith apple', null));
    expect(productKey('boxes of pasta', null)).toBe(productKey('box of pasta', null));
    expect(productKey('berries', null)).toBe(productKey('berry', null));
    // And it must not fuse two things that are not one thing.
    expect(productKey('apple', null)).not.toBe(productKey('apple juice', null));
    expect(productKey('oreo', null)).not.toBe(productKey('oreo cookies', null));
  });

  it('mangles a word that only looks plural, and does so identically every time', () => {
    // "asparagus" becomes "asparagu". The key is opaque and only ever compared with another key,
    // so this costs nothing as long as it is deterministic, which is what is pinned here.
    expect(productKey('asparagus', null)).toBe(productKey('asparagus', null));
    expect(productKey('asparagus', null)).toBe('::asparagu');
    expect(productKey('glass', null)).toBe('::glass');
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

  it('counts what the model saw when the detector found fewer of them', () => {
    // The detector's measured recall on real cart photographs is 38%. One polygon landing on a
    // row of three cartons used to cap the bag at one, because the clamp took the minimum of the
    // track count and the model count. The model is looking at the whole frame; it is the better
    // witness to how many are there.
    let state = createFusionState();
    const key = productKey('Whole milk', null);
    state = applyCensus(state, census([mark(1, 'Whole milk')], [[key, 3]]), { 1: 't1' }, ['t1']);
    expect(bagLines(state)[0].qty).toBe(3);
    expect(state.merged).toHaveLength(0);
  });

  it('does not double count across keyframes when the model keeps seeing the same three', () => {
    let state = createFusionState();
    const key = productKey('Whole milk', null);
    const one = census([mark(1, 'Whole milk')], [[key, 3]]);
    state = applyCensus(state, one, { 1: 't1' }, ['t1']);
    state = applyCensus(state, one, { 1: 't2' }, ['t2']);
    state = applyCensus(state, one, { 1: 't3' }, ['t3']);
    expect(bagLines(state)[0].qty).toBe(3);
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

describe('badges that are not on products', () => {
  it('keeps the cart frame and a shopper leg out of the bag', () => {
    // Measured on a real census: the detector badged cart mesh, a bag handle and a leg, and the
    // model named all three accurately at 0.88 to 0.98 confidence. Confidence cannot filter
    // these, because the model is right about what they are. Only isProduct can.
    let state = createFusionState();
    state = applyCensus(
      state,
      census(
        [nonProduct(1, 'shopping cart frame'), nonProduct(2, 'dark clothing/leg in background'), mark(3, 'Bananas')],
        [[productKey('Bananas', null), 1]],
      ),
      { 1: 't1', 2: 't2', 3: 't3' },
      ['t1', 't2', 't3'],
    );
    const lines = bagLines(state);
    expect(lines).toHaveLength(1);
    expect(lines[0].name).toBe('Bananas');
  });

  it('treats a mark with no isProduct field as a product, so an older server still fills the bag', () => {
    let state = createFusionState();
    const legacy = { id: 1, name: 'Bananas', brand: null, size: null, category: 'Produce', confidence: 0.9, needsCloserLook: false };
    state = applyCensus(state, census([legacy], [[productKey('Bananas', null), 1]]), { 1: 't1' }, ['t1']);
    expect(bagLines(state)).toHaveLength(1);
  });
});

describe('products no badge landed on', () => {
  it('puts an item the model saw but the detector missed into the bag', () => {
    let state = createFusionState();
    const key = productKey('Froot Loops', null);
    state = applyCensus(
      state,
      census([mark(1, 'Whole milk')], [[key, 2]], [{ description: 'Froot Loops', confidence: 0.8 }]),
      { 1: 't1' },
      ['t1'],
    );
    const line = bagLines(state).find((l) => l.key === key);
    expect(line).toBeDefined();
    expect(line!.qty).toBe(2);
    expect(line!.name).toBe('Froot Loops');
  });

  it('defaults an unmarked item with no explicit count to one', () => {
    let state = createFusionState();
    state = applyCensus(state, census([], [], [{ description: 'Sourdough loaf' }]), {}, []);
    expect(bagLines(state).find((l) => l.key === productKey('Sourdough loaf', null))!.qty).toBe(1);
  });

  it('does not double count an unmarked item that a later keyframe finally outlines', () => {
    let state = createFusionState();
    const key = productKey('Bananas', null);
    state = applyCensus(state, census([], [[key, 1]], [{ description: 'Bananas' }]), {}, []);
    expect(bagLines(state)[0].qty).toBe(1);
    // Next keyframe the detector does land a polygon on it, so it arrives as a mark instead.
    state = applyCensus(state, census([mark(1, 'Bananas')], [[key, 1]]), { 1: 'b1' }, ['b1']);
    expect(bagLines(state).filter((l) => l.key === key)).toHaveLength(1);
    expect(bagLines(state)[0].qty).toBe(1);
  });

  it('does not double count when the model spells the marked and unmarked keys differently', () => {
    // Measured on a real census: two badges named "packaged carrots", deriving
    // "::packaged carrots", while the unmarked sighting of the same carrots came back keyed
    // "::carrots". The bag showed four carrots where there were two.
    let state = createFusionState();
    state = applyCensus(
      state,
      census(
        [mark(1, 'packaged carrots'), mark(2, 'packaged carrots')],
        [[productKey('carrots', null), 2]],
        [{ description: 'packaged carrots', productKey: '::carrots' }],
      ),
      { 1: 'c1', 2: 'c2' },
      ['c1', 'c2'],
    );
    const total = bagLines(state).reduce((n, l) => n + l.qty, 0);
    expect(total).toBe(2);
  });

  it('does not invent a line from a count with no mark and no unmarked entry', () => {
    // Guards the hallucinated-count case: a count is not by itself evidence that a product is
    // there, only the model explicitly listing it as unmarked is.
    let state = createFusionState();
    state = applyCensus(state, census([], [[productKey('Ghost', null), 4]]), {}, []);
    expect(bagLines(state)).toHaveLength(0);
  });

  it('counts a product the model listed twice as two, even when it counted it once', () => {
    let state = createFusionState();
    const key = productKey('Greek yogurt', null);
    state = applyCensus(
      state,
      census([], [[key, 1]], [{ description: 'Greek yogurt' }, { description: 'Greek yogurt' }]),
      {},
      [],
    );
    expect(bagLines(state)[0].qty).toBe(2);
  });

  it('joins an unmarked sighting to the branded product by the key the model supplies', () => {
    // Without the model's own key this is two bag lines for one box: an unmarked description
    // carries no brand, so it would key as "::froot loops" and never meet "kelloggs::froot loops".
    let state = createFusionState();
    const branded = productKey('Froot Loops', "Kellogg's");
    state = applyCensus(
      state,
      census([], [[branded, 1]], [{ description: 'Froot Loops', productKey: branded }]),
      {},
      [],
    );
    expect(bagLines(state)).toHaveLength(1);
    expect(bagLines(state)[0].brand).toBeNull();

    // The next keyframe does land a badge on it, with the brand this time.
    state = applyCensus(
      state,
      census([mark(1, 'Froot Loops', "Kellogg's")], [[branded, 1]]),
      { 1: 'f1' },
      ['f1'],
    );
    const lines = bagLines(state);
    expect(lines).toHaveLength(1);
    expect(lines[0].brand).toBe("Kellogg's");
    expect(lines[0].qty).toBe(1);
  });

  it('renormalises a supplied key, so one apostrophe does not split a product in two', () => {
    let state = createFusionState();
    const clean = productKey('Froot Loops', "Kellogg's");
    state = applyCensus(
      state,
      census([], [], [{ description: 'Froot Loops', productKey: "Kellogg's::Froot Loops" }]),
      {},
      [],
    );
    expect(bagLines(state)[0].key).toBe(clean);
  });

  it('falls back to the description when the model supplies no key', () => {
    let state = createFusionState();
    state = applyCensus(state, census([], [], [{ description: 'Sourdough loaf' }]), {}, []);
    expect(bagLines(state)[0].key).toBe(productKey('Sourdough loaf', null));
  });

  it('gives an unmarked item no outline, because nothing located it', () => {
    let state = createFusionState();
    state = applyCensus(state, census([], [], [{ description: 'Olive oil' }]), {}, []);
    // Every real outline is looked up by track id. The synthetic id cannot collide with one.
    const ids = Object.keys(state.identities);
    expect(ids).toHaveLength(1);
    expect(ids[0].startsWith('census:')).toBe(true);
  });
});

describe('several proposals landing on one physical item', () => {
  // Measured on a real cart photograph (runs/2026-08-16-pipeline-run, held/grounded/
  // wm_full_from_above). Two Coca-Cola bottles lay on their sides with only the caps facing the
  // camera. The enumerator put four boxes on them: three nested on the lower bottle and one on
  // the upper. The model named all four, differently, across three censuses, and the bag opened
  // with "cola soda" 1, "Coca-Cola can" 2 and "Coca-Cola" 1. Four units, three lines, two
  // bottles.
  //
  // The in-view clamp could never catch this, because it groups live tracks by product key and
  // these four carried four different keys. Nothing in the pipeline ever compared two live
  // tracks to each other. Geometry is what proves they are one item: the boxes are nested, and
  // a box wholly inside another box is not a second thing to buy.
  const bottleBoxes = {
    // Verbatim from that run's census-03.json.
    track_4: { x: 0.087, y: 0.74, w: 0.163, h: 0.164 },
    track_5: { x: 0.087, y: 0.812, w: 0.082, h: 0.076 },
    track_24: { x: 0.086, y: 0.801, w: 0.09, h: 0.109 },
    track_6: { x: 0.086, y: 0.629, w: 0.081, h: 0.072 },
  };

  it('counts three nested boxes on one bottle as one item, not three', () => {
    const state = applyCensus(
      createFusionState(),
      census(
        [mark(1, 'cola soda', 'Coca-Cola'), mark(2, 'Coca-Cola can', 'Coca-Cola'), mark(3, 'Coca-Cola', 'Coca-Cola')],
        [],
      ),
      { 1: 'track_4', 2: 'track_5', 3: 'track_24' },
      ['track_4', 'track_5', 'track_24'],
      false,
      { track_4: bottleBoxes.track_4, track_5: bottleBoxes.track_5, track_24: bottleBoxes.track_24 },
    );
    expect(bagLines(state).reduce((sum, line) => sum + line.qty, 0)).toBe(1);
  });

  it('keeps a fourth box that overlaps none of them as its own item', () => {
    const state = applyCensus(
      createFusionState(),
      census(
        [mark(1, 'cola soda', 'Coca-Cola'), mark(2, 'Coca-Cola can', 'Coca-Cola'),
         mark(3, 'Coca-Cola', 'Coca-Cola'), mark(4, 'Coca-Cola', 'Coca-Cola')],
        [],
      ),
      { 1: 'track_4', 2: 'track_5', 3: 'track_24', 4: 'track_6' },
      ['track_4', 'track_5', 'track_24', 'track_6'],
      false,
      bottleBoxes,
    );
    // Two bottles, which is what a person counting the photograph gets.
    expect(bagLines(state).reduce((sum, line) => sum + line.qty, 0)).toBe(2);
  });

  it('leaves two side by side boxes of the same product alone', () => {
    // The failure mode to protect against: a cart legitimately holding two identical yogurts
    // next to each other must still count two. These overlap slightly and neither contains the
    // other, so nothing folds.
    const state = applyCensus(
      createFusionState(),
      census([mark(1, 'yogurt', 'Chobani'), mark(2, 'yogurt', 'Chobani')], [['chobani::yogurt', 2]]),
      { 1: 'track_1', 2: 'track_2' },
      ['track_1', 'track_2'],
      false,
      { track_1: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, track_2: { x: 0.28, y: 0.1, w: 0.2, h: 0.2 } },
    );
    expect(bagLines(state).reduce((sum, line) => sum + line.qty, 0)).toBe(2);
  });

  it('does not fold a nested box carrying a different brand, which is a multipack', () => {
    // A box of six cans: the outer box and one legible can inside it are nested, but they are
    // different products and folding them would lose the can's identity entirely.
    const state = applyCensus(
      createFusionState(),
      census([mark(1, 'variety pack', 'Kellogg'), mark(2, 'Corn Flakes', 'Kelloggs Corn Flakes')], []),
      { 1: 'track_1', 2: 'track_2' },
      ['track_1', 'track_2'],
      false,
      { track_1: { x: 0.1, y: 0.1, w: 0.3, h: 0.3 }, track_2: { x: 0.15, y: 0.15, w: 0.08, h: 0.08 } },
    );
    expect(bagLines(state).reduce((sum, line) => sum + line.qty, 0)).toBe(2);
  });

  it('keeps the folded track visible so its outline does not vanish', () => {
    const state = applyCensus(
      createFusionState(),
      census([mark(1, 'cola soda', 'Coca-Cola'), mark(2, 'Coca-Cola can', 'Coca-Cola')], []),
      { 1: 'track_4', 2: 'track_5' },
      ['track_4', 'track_5'],
      false,
      { track_4: bottleBoxes.track_4, track_5: bottleBoxes.track_5 },
    );
    // track_4 is the looser box of the two, so it is the one folded: the tighter box is the
    // better shape to draw and the better crop to identify from. Folded means it stops counting,
    // not that it disappears, so it keeps its identity and still draws its outline.
    expect(state.merged).toContain('track_4');
    expect(state.identities.track_4).toBeDefined();
    expect(state.merged).not.toContain('track_5');
  });

  it('counts the same as before when no boxes are supplied at all', () => {
    // Back compatibility: every existing caller passes five arguments and must be unaffected.
    const state = applyCensus(
      createFusionState(),
      census([mark(1, 'cola soda', 'Coca-Cola'), mark(2, 'Coca-Cola can', 'Coca-Cola')], []),
      { 1: 'track_4', 2: 'track_5' },
      ['track_4', 'track_5'],
    );
    expect(bagLines(state).reduce((sum, line) => sum + line.qty, 0)).toBe(2);
  });

  it('migrates a folded track\u2019s quantity onto the survivor rather than stranding it', () => {
    // The folded track was counted under its own key on an earlier census. That key must not
    // keep a high-water mark of its own once the track is known to be the same bottle.
    let state = applyCensus(
      createFusionState(),
      census([mark(2, 'Coca-Cola can', 'Coca-Cola')], []),
      { 2: 'track_5' },
      ['track_5'],
    );
    expect(state.maxSimultaneous[productKey('Coca-Cola can', 'Coca-Cola')]).toBe(1);

    state = applyCensus(
      state,
      census([mark(1, 'cola soda', 'Coca-Cola'), mark(2, 'Coca-Cola can', 'Coca-Cola')], []),
      { 1: 'track_4', 2: 'track_5' },
      ['track_4', 'track_5'],
      false,
      { track_4: bottleBoxes.track_4, track_5: bottleBoxes.track_5 },
    );
    expect(bagLines(state).reduce((sum, line) => sum + line.qty, 0)).toBe(1);
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

describe('an identify-verified identity (I6: the identify budget must buy something durable)', () => {
  it('is not overwritten outright by a later, disagreeing census guess', () => {
    // Regression: applyCensus used to overwrite any vlm identity unconditionally, so a crop
    // identify's better name and confidence were discarded by the very next wide-shot census,
    // undoing the whole point of spending the identify budget on a closer look.
    let state = createFusionState();
    state = applyCensus(
      state,
      census([mark(1, 'Horizon Whole Milk', null, 0.95)], []),
      { 1: 'a' },
      ['a'],
      true, // fromIdentify: a crop identify, not a wide census.
    );
    expect(state.identities['a'].name).toBe('Horizon Whole Milk');
    expect(state.identities['a'].verifiedByIdentify).toBe(true);

    // A wide-shot census still only sees the generic name, low confidence, unclear.
    state = applyCensus(state, census([mark(1, 'Milk', null, 0.3, true)], []), { 1: 'a' }, ['a']);

    expect(state.identities['a'].name).toBe('Horizon Whole Milk');
    expect(state.identities['a'].confidence).toBe(0.95);
    expect(state.identities['a'].needsCloserLook).toBe(false);
  });

  it('welds a disagreeing census guess onto the identify line only once it repeats', () => {
    // Same two-in-a-row corroboration bar a resolved barcode requires, so one noisy wide-shot
    // guess leaves no permanent trace, but a repeated one is trusted enough to link a sibling
    // track that only ever gets the generic guess onto the identified product's line.
    let state = createFusionState();
    state = applyCensus(state, census([mark(1, 'Horizon Whole Milk', null, 0.95)], []), { 1: 'a' }, ['a'], true);
    const milkKey = productKey('Milk', null);
    const misread = census([mark(1, 'Milk', null, 0.3, true)], []);

    state = applyCensus(state, misread, { 1: 'a' }, ['a']);
    expect(state.aliases[milkKey]).toBeUndefined();
    expect(state.identities['a'].name).toBe('Horizon Whole Milk');

    state = applyCensus(state, misread, { 1: 'a' }, ['a']);
    expect(state.aliases[milkKey]).toBe(state.identities['a'].key);
    // The identify's own name is still untouched, exactly like a corroborated barcode's is.
    expect(state.identities['a'].name).toBe('Horizon Whole Milk');
  });

  it('lets a fresh identify supersede an earlier one outright, no corroboration needed', () => {
    let state = createFusionState();
    state = applyCensus(state, census([mark(1, 'Milk', null, 0.3, true)], []), { 1: 'a' }, ['a'], true);
    state = applyCensus(state, census([mark(1, 'Horizon Whole Milk', null, 0.95)], []), { 1: 'a' }, ['a'], true);
    expect(state.identities['a'].name).toBe('Horizon Whole Milk');
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
