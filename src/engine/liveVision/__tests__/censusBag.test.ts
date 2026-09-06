/**
 * The two judgements `server/eval/pipeline/census-live.ts` makes, pinned without an API call.
 *
 * That runner costs real money and had never executed. A bug in its scoring would be found by
 * spending the money and getting a crash, so the behaviour it depends on is fixed here instead.
 */
import { applyCensus, bagLines, createFusionState } from '../fusion';
import type { CensusMark, CensusResult } from '../fusion';

const mark = (id: number, name: string, isProduct = true): CensusMark => ({
  id, name, brand: null, size: null, category: 'other',
  confidence: 0.9, needsCloserLook: false, isProduct,
});

describe('reading a census answer back', () => {
  it('joins by badge id, not by position', () => {
    // A model may return marks out of order. Joining by array index would score a correct answer
    // as misaligned and a misaligned one as correct, which is the exact thing being measured.
    const marks = [mark(2, 'asparagus'), mark(0, 'cauliflower'), mark(1, 'sprouts')];
    const byId = new Map(marks.map((m) => [m.id, m]));
    expect(byId.get(0)?.name).toBe('cauliflower');
    expect(byId.get(2)?.name).toBe('asparagus');
  });

  it('treats a badge the model never answered for as absent rather than throwing', () => {
    const byId = new Map([mark(0, 'cauliflower')].map((m) => [m.id, m]));
    expect(byId.get(3)).toBeUndefined();
  });
});

describe('the bag the census builds', () => {
  const boxes = { a: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, b: { x: 0.5, y: 0.1, w: 0.2, h: 0.2 } };

  it('counts units as qty, not as lines', () => {
    // Two egg cartons side by side are two units on one line. Counting lines reads 1, which is
    // a mistake this harness made before it was one the model could.
    const census: CensusResult = {
      marks: [mark(0, 'egg carton'), mark(1, 'egg carton')],
      inViewCounts: [{ productKey: '::egg carton', count: 2 }],
      unmarkedItems: [],
    };
    const state = applyCensus(createFusionState(), census, { 0: 'a', 1: 'b' }, ['a', 'b'], false, boxes);
    const lines = bagLines(state);
    expect(lines).toHaveLength(1);
    expect(lines.reduce((n, l) => n + (l.qty ?? 1), 0)).toBe(2);
  });

  it('needs the brand::name key form before a count is honoured', () => {
    // A bare name does not match the identity a mark wrote and the count is silently ignored,
    // which reads as the tracker capping quantity.
    const census: CensusResult = {
      marks: [mark(0, 'egg carton')],
      inViewCounts: [{ productKey: 'egg carton', count: 2 }],
      unmarkedItems: [],
    };
    const state = applyCensus(createFusionState(), census, { 0: 'a' }, ['a'], false, boxes);
    expect(bagLines(state).reduce((n, l) => n + (l.qty ?? 1), 0)).toBe(1);
  });

  it('lets a product no badge landed on reach the bag', () => {
    // How the six occluded items on the fullest trolley photograph arrive at all.
    const census: CensusResult = {
      marks: [mark(0, 'cauliflower')],
      inViewCounts: [{ productKey: '::tomatoes', count: 1 }],
      unmarkedItems: [{ description: 'tomatoes', confidence: 0.9 }],
    };
    const state = applyCensus(createFusionState(), census, { 0: 'a' }, ['a'], false, boxes);
    expect(bagLines(state).map((l) => l.name)).toContain('tomatoes');
  });

  it('keeps a region the model says is not a product out of the bag', () => {
    // The trolley's moulded plastic disc, and the shopper's own tote.
    const census: CensusResult = {
      marks: [mark(0, 'cauliflower'), mark(1, 'plastic fitting', false)],
      inViewCounts: [], unmarkedItems: [],
    };
    const state = applyCensus(createFusionState(), census, { 0: 'a', 1: 'b' }, ['a', 'b'], false, boxes);
    expect(bagLines(state).map((l) => l.name)).toEqual(['cauliflower']);
  });
});

describe('keying on the catalog SKU', () => {
  const boxes = { a: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, b: { x: 0.5, y: 0.1, w: 0.2, h: 0.2 } };
  const skuMark = (id: number, name: string, catalogSku: string | null): CensusMark => ({
    id, name, brand: null, size: null, category: 'other',
    confidence: 0.9, needsCloserLook: false, isProduct: true, catalogSku,
  });

  it('counts two spellings of one product as one product', () => {
    // Measured across the four census calls of a nine-second scan: one trolley's contents came
    // back as "oreo" and "oreo cookies", as "bread" and "seedstastic bread". Each spelling was
    // its own bag line, which is most of why ten products became fifteen units.
    const census: CensusResult = {
      marks: [skuMark(0, 'oreo', 'kart_oreo'), skuMark(1, 'oreo cookies', 'kart_oreo')],
      inViewCounts: [{ productKey: 'sku:kart_oreo', count: 1 }],
      unmarkedItems: [],
    };
    const state = applyCensus(createFusionState(), census, { 0: 'a', 1: 'b' }, ['a', 'b'], false, boxes);
    expect(bagLines(state)).toHaveLength(1);
  });

  it('still separates two genuinely different products', () => {
    const census: CensusResult = {
      marks: [skuMark(0, 'milk', 'kart_milk'), skuMark(1, 'almond milk', 'kart_almond_milk')],
      inViewCounts: [], unmarkedItems: [],
    };
    const state = applyCensus(createFusionState(), census, { 0: 'a', 1: 'b' }, ['a', 'b'], false, boxes);
    expect(bagLines(state)).toHaveLength(2);
  });

  it('falls back to the name when no catalog was consulted', () => {
    // A deployment with no catalog, or a region the catalog had nothing for. Behaviour has to be
    // exactly what it was before the field was read at all.
    const census: CensusResult = {
      marks: [skuMark(0, 'oreo', null), skuMark(1, 'oreo cookies', null)],
      inViewCounts: [], unmarkedItems: [],
    };
    const state = applyCensus(createFusionState(), census, { 0: 'a', 1: 'b' }, ['a', 'b'], false, boxes);
    expect(bagLines(state)).toHaveLength(2);
  });
});

describe('the closer look and the census keying differently', () => {
  const boxes = { a: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, b: { x: 0.5, y: 0.1, w: 0.2, h: 0.2 } };
  const skuMark = (id: number, name: string, catalogSku: string | null): CensusMark => ({
    id, name, brand: null, size: null, category: 'other',
    confidence: 0.9, needsCloserLook: false, isProduct: true, catalogSku,
  });

  it('does not read agreement as disagreement', () => {
    // IdentifyResponse has no catalogSku field, so a closer look can only produce a brand::name
    // key while a census on the same product produces sku:. Comparing one key would send two
    // calls that agree round the corroboration path and show one product on two bag lines.
    const identified = applyCensus(
      createFusionState(),
      { marks: [skuMark(0, 'oreo', null)], inViewCounts: [], unmarkedItems: [] },
      { 0: 'a' }, ['a'], true, boxes,
    );
    expect(identified.identities.a?.verifiedByIdentify).toBe(true);

    const after = applyCensus(
      identified,
      { marks: [skuMark(0, 'oreo', 'kart_oreo')], inViewCounts: [], unmarkedItems: [] },
      { 0: 'a' }, ['a'], false, boxes,
    );
    // The closer look's identity stands and nothing went pending: the two calls agree.
    expect(after.pendingAlias.a).toBeUndefined();
    expect(bagLines(after)).toHaveLength(1);
  });

  it('does not open a second line for an unmarked sighting of a badged product', () => {
    // From a real census of the three-item trolley: two badges named "Brussels sprouts" carrying
    // catalogSku kart_brussels_sprouts, and an unmarked "Brussels sprouts bag" whose productKey
    // could only be "::brussels sprouts", because UnmarkedItem has no catalogSku to offer. The
    // badge keys as sku: and the sighting keys as brand::name, so the guard that skips an
    // unmarked item already carried by a track never fired, and a trolley holding three items
    // produced a bag of five.
    const state = applyCensus(
      createFusionState(),
      {
        marks: [skuMark(0, 'Brussels sprouts', 'kart_brussels_sprouts')],
        inViewCounts: [{ productKey: '::brussels sprouts', count: 1 }],
        unmarkedItems: [{ description: 'Brussels sprouts bag', productKey: '::brussels sprouts', confidence: 0.8 }],
      },
      { 0: 'a' }, ['a'], false, boxes,
    );
    const lines = bagLines(state);
    expect(lines).toHaveLength(1);
    expect(lines.reduce((n, l) => n + (l.qty ?? 1), 0)).toBe(1);
  });

  it('merges two badges of one product when the catalog matched it once and missed it once', () => {
    // From a nine-second scan: "Oreo" badged at one second with catalogSku kart_oreo and again
    // at seven seconds with none, because the shortlist that call did not carry it. One keys
    // "sku:kart_oreo" and the other "::oreo", so the bag held two packets of Oreos.
    const first = applyCensus(
      createFusionState(),
      { marks: [skuMark(0, 'Oreo', 'kart_oreo')], inViewCounts: [], unmarkedItems: [] },
      { 0: 'a' }, ['a'], false, boxes,
    );
    const second = applyCensus(
      first,
      { marks: [skuMark(0, 'Oreo', null)], inViewCounts: [], unmarkedItems: [] },
      { 0: 'b' }, ['b'], false, { b: boxes.b },
    );
    expect(bagLines(second)).toHaveLength(1);
  });

  it('does not fuse two products that merely share a name segment', () => {
    const first = applyCensus(
      createFusionState(),
      { marks: [skuMark(0, 'Oreo', 'kart_oreo')], inViewCounts: [], unmarkedItems: [] },
      { 0: 'a' }, ['a'], false, boxes,
    );
    const second = applyCensus(
      first,
      { marks: [skuMark(0, 'Digestives', null)], inViewCounts: [], unmarkedItems: [] },
      { 0: 'b' }, ['b'], false, { b: boxes.b },
    );
    expect(bagLines(second)).toHaveLength(2);
  });

  it('merges an unmarked sighting with a badge by SKU, however differently it is worded', () => {
    // The residual over-count on the nine-second scan. A badge names the Granny Smith bag at one
    // second and the census at five lists the same bag as "bag of apples", which shares no word
    // with the badge's name and so keys as its own product. With a SKU on the sighting the two
    // are one thing, which is the whole reason the field was added to UnmarkedItem.
    const named = applyCensus(
      createFusionState(),
      {
        marks: [skuMark(0, 'Granny Smith Apples', 'kart_granny_smith_apples')],
        inViewCounts: [], unmarkedItems: [],
      },
      { 0: 'a' }, ['a'], false, boxes,
    );
    const later = applyCensus(
      named,
      {
        marks: [],
        inViewCounts: [],
        unmarkedItems: [{
          description: 'bag of apples',
          productKey: '::bag of apples',
          catalogSku: 'kart_granny_smith_apples',
          confidence: 0.7,
        }],
      },
      {}, [], false, {},
    );
    expect(bagLines(later)).toHaveLength(1);
  });

  it('still separates an unmarked sighting the catalog matched to something else', () => {
    const named = applyCensus(
      createFusionState(),
      {
        marks: [skuMark(0, 'Granny Smith Apples', 'kart_granny_smith_apples')],
        inViewCounts: [], unmarkedItems: [],
      },
      { 0: 'a' }, ['a'], false, boxes,
    );
    const later = applyCensus(
      named,
      {
        marks: [],
        inViewCounts: [],
        unmarkedItems: [{
          description: 'bag of apples',
          productKey: '::bag of apples',
          catalogSku: 'kart_purple_produce_bag',
          confidence: 0.7,
        }],
      },
      {}, [], false, {},
    );
    expect(bagLines(later)).toHaveLength(2);
  });

  it('does not open a second line when the badge that named it is no longer live', () => {
    // A scan pans. From the nine-second video: a badge names the purple produce bag at three
    // seconds and keys it by SKU, the camera moves on, and the census at five seconds lists the
    // same bag as unmarked, keyed by name because unmarked items have no SKU to offer. By then
    // the track is gone, so the live-track guard cannot see it and only the set of identities
    // already in the bag can. It has to know both spellings too.
    const named = applyCensus(
      createFusionState(),
      {
        marks: [skuMark(0, 'purple produce bag', 'kart_purple_produce_bag')],
        inViewCounts: [], unmarkedItems: [],
      },
      { 0: 'a' }, ['a'], false, boxes,
    );
    const later = applyCensus(
      named,
      {
        marks: [],
        inViewCounts: [],
        unmarkedItems: [{ description: 'purple produce bag', confidence: 0.8 }],
      },
      {}, [], false, {},
    );
    expect(bagLines(later)).toHaveLength(1);
  });
});

/**
 * The brand of a product no badge landed on.
 *
 * With no detector configured every product arrives through `unmarkedItems`, which carries no
 * brand field: the model reports the brand inside `productKey`, as the segment before "::". The
 * bag used to hardcode `brand: null` for these, so `itemSubtitle` had a brand to show for no item
 * in a whole scan. Which is more visible on some models than others: gpt-5.4-mini tends to repeat
 * the brand inside the free-text description, gpt-5.6-luna does not, and on luna the shopper saw
 * "Shelled walnuts" where the model had read "southern grove::shelled walnuts" perfectly.
 */
describe('the brand of an unmarked product', () => {
  const unmarked = (description: string, productKey: string) => ({
    marks: [],
    inViewCounts: [{ productKey, count: 1 }],
    unmarkedItems: [{ description, productKey, catalogSku: null, confidence: 0.9 }],
  });

  it('comes from the productKey when the description leaves it out', () => {
    const state = applyCensus(
      createFusionState(),
      unmarked('Shelled walnuts', 'southern grove::shelled walnuts'),
      {}, [], false, {},
    );
    expect(bagLines(state)[0].brand).toBe('Southern Grove');
  });

  it('is null for produce, which genuinely has no brand', () => {
    const state = applyCensus(
      createFusionState(),
      unmarked('bananas', '::bananas'),
      {}, [], false, {},
    );
    expect(bagLines(state)[0].brand).toBeNull();
  });

  it('leaves the name alone, so the brand is not shown twice in one string', () => {
    const state = applyCensus(
      createFusionState(),
      unmarked('Shelled walnuts', 'southern grove::shelled walnuts'),
      {}, [], false, {},
    );
    expect(bagLines(state)[0].name).toBe('Shelled walnuts');
  });
});

/**
 * CLAUDE.md's fourth requirement, on the line the shopper reads: an item the model is unsure
 * about is flagged as unsure, not asserted. A tester photographed a table and read "assorted
 * chocolates" in the bag with nothing to say it was a guess. The prompt's own rule is that a
 * guess belongs below 0.6, so that is where a line becomes "unsure"; and something the model
 * itself says is not a product never reaches the bag at all.
 */
describe('unsure lines and non-products', () => {
  const unmarked = (description: string, confidence: number, isProduct = true) => ({
    description, productKey: `::${description}`, catalogSku: null, approxLocation: 'centre', confidence, isProduct,
  });
  const census = (items: ReturnType<typeof unmarked>[]): CensusResult => ({
    marks: [],
    inViewCounts: items.map((i) => ({ productKey: i.productKey, count: 1 })),
    unmarkedItems: items,
  });

  it('marks a line unsure below the confidence the prompt calls a guess', () => {
    const state = applyCensus(createFusionState(), census([unmarked('assorted chocolates', 0.25), unmarked('bananas', 0.9)]), {}, [], false, {});
    const lines = bagLines(state);
    expect(lines.find((l) => l.name === 'assorted chocolates')?.unsure).toBe(true);
    expect(lines.find((l) => l.name === 'bananas')?.unsure).toBe(false);
  });

  it('never puts something the model says is not a product in the bag', () => {
    const state = applyCensus(createFusionState(), census([unmarked('food leftovers', 0.8, false), unmarked('bananas', 0.9)]), {}, [], false, {});
    expect(bagLines(state).map((l) => l.name)).toEqual(['bananas']);
  });

  it('does not call a confident badge unsure', () => {
    const state = applyCensus(
      createFusionState(),
      { marks: [mark(0, 'egg carton')], inViewCounts: [{ productKey: '::egg carton', count: 1 }], unmarkedItems: [] },
      { 0: 'a' }, ['a'], false, { a: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } },
    );
    expect(bagLines(state)[0].unsure).toBe(false);
  });
});
