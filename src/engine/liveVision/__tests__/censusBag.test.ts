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
  const boxes = { a: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } };
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
});
