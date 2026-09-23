import {
  createPhotoScanState,
  photoSummary,
  scanPhoto,
  type PhotoItem,
  type PhotoScanDeps,
} from '../photoScan';
import type { CensusPayload, UnmarkedItem } from '../recognitionClient';

/**
 * A census reply shaped the way the capture path really receives one: no marks and no regions,
 * because the device never ran a detector and `ENUMERATOR_URL` is unset, so every product
 * arrives through `unmarkedItems`. See server/src/enumerate.ts.
 */
function reply(
  items: { name: string; count?: number; confidence?: number }[],
  occlusion: CensusPayload['occlusion'] = {
    itemsLikelyHidden: false,
    severity: 'none',
    reason: 'single item',
  },
): CensusPayload {
  return {
    marks: [],
    inViewCounts: items.map((i) => ({ productKey: `::${i.name}`, count: i.count ?? 1 })),
    unmarkedItems: items.map((i) => ({
      description: i.name,
      productKey: `::${i.name}`,
      catalogSku: null,
      approxLocation: 'centre of frame',
      confidence: i.confidence ?? 0.9,
      isProduct: true,
      box: null,
    })),
    occlusion,
    regions: [],
    enumeration: 'degraded',
  };
}

/** Records what each call was asked, so the `counted` contract can be asserted on. */
function stubCensus(replies: CensusPayload[]): PhotoScanDeps & { asked: { counted: string[]; confirming?: string[] }[] } {
  const asked: { counted: string[]; confirming?: string[] }[] = [];
  let n = 0;
  return {
    asked,
    async requestCensus(request) {
      asked.push({ counted: request.counted ?? [], ...(request.confirming ? { confirming: request.confirming } : {}) });
      const payload = replies[Math.min(n, replies.length - 1)];
      n += 1;
      return { ok: true, value: payload };
    },
  };
}

describe('scanPhoto', () => {
  it('puts a named product in the bag', async () => {
    const deps = stubCensus([reply([{ name: 'oranges' }])]);

    const outcome = await scanPhoto(createPhotoScanState(), 'BASE64', deps);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.lines).toHaveLength(1);
    expect(outcome.lines[0].name).toBe('oranges');
    expect(outcome.lines[0].qty).toBe(1);
  });

  // The whole point of accumulating: a shopper photographs an item, then photographs the next
  // one, and the first must still be there.
  it('keeps earlier photos in the bag when a later photo names something else', async () => {
    const deps = stubCensus([reply([{ name: 'oranges' }]), reply([{ name: 'baguette' }])]);

    const first = await scanPhoto(createPhotoScanState(), 'ONE', deps);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = await scanPhoto(first.state, 'TWO', deps);

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.lines.map((l) => l.name).sort()).toEqual(['baguette', 'oranges']);
    expect(second.lines.every((l) => l.qty === 1)).toBe(true);
  });

  // Two photographs of one orange are one orange. Without this the bag counts every shutter
  // press, which is the failure the live path's in-view clamp exists to prevent.
  it('does not count the same product twice when it is photographed again', async () => {
    const deps = stubCensus([reply([{ name: 'oranges' }]), reply([{ name: 'oranges' }])]);

    const first = await scanPhoto(createPhotoScanState(), 'ONE', deps);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = await scanPhoto(first.state, 'TWO', deps);

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.lines).toHaveLength(1);
    expect(second.lines[0].qty).toBe(1);
  });

  // Sending back what has already been counted is how the model is asked to reuse a phrasing
  // rather than invent a third. Measured on the corpus scan at 1.7 spurious lines a bag down
  // to 0.3. The first call has nothing to send.
  it('tells the census what has already been counted, from the second photo on', async () => {
    const deps = stubCensus([reply([{ name: 'oranges' }]), reply([{ name: 'baguette' }])]);

    const first = await scanPhoto(createPhotoScanState(), 'ONE', deps);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    await scanPhoto(first.state, 'TWO', deps);

    expect(deps.asked[0].counted).toEqual([]);
    expect(deps.asked[1].counted).toEqual(['oranges']);
  });

  it('sends the image it was given', async () => {
    const asked: string[] = [];
    const deps: PhotoScanDeps = {
      async requestCensus(request) {
        asked.push(request.imageBase64);
        return { ok: true, value: reply([{ name: 'oranges' }]) };
      },
    };

    await scanPhoto(createPhotoScanState(), 'THE-IMAGE', deps);

    expect(asked).toEqual(['THE-IMAGE']);
  });

  // A shelf is emptied server side by the subject gate, so it arrives here as a valid census
  // naming nothing. That is a normal outcome and not a failure: the shopper pointed at
  // something that is not theirs, and the right answer is an unchanged bag.
  it('treats a census that names nothing as success with nothing added', async () => {
    const deps = stubCensus([reply([{ name: 'oranges' }]), reply([])]);

    const first = await scanPhoto(createPhotoScanState(), 'ONE', deps);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = await scanPhoto(first.state, 'TWO', deps);

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.added).toBe(0);
    expect(second.lines).toHaveLength(1);
  });

  it('reports how many new lines a photo added', async () => {
    const deps = stubCensus([reply([{ name: 'oranges' }, { name: 'baguette' }])]);

    const outcome = await scanPhoto(createPhotoScanState(), 'ONE', deps);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.added).toBe(2);
  });

  it('passes a client failure back instead of throwing', async () => {
    const deps: PhotoScanDeps = {
      async requestCensus() {
        return { ok: false, failure: 'offline' };
      },
    };

    const outcome = await scanPhoto(createPhotoScanState(), 'ONE', deps);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failure).toBe('offline');
  });

  // A failed photo must not lose the bag the shopper has already filled.
  it('keeps the bag when a photo fails', async () => {
    const good = stubCensus([reply([{ name: 'oranges' }])]);
    const first = await scanPhoto(createPhotoScanState(), 'ONE', good);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const bad: PhotoScanDeps = {
      async requestCensus() {
        return { ok: false, failure: 'timeout' };
      },
    };
    const second = await scanPhoto(first.state, 'TWO', bad);

    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.state).toBe(first.state);
  });

  it('counts two of one product when the census says there are two', async () => {
    const deps = stubCensus([reply([{ name: 'yogurt', count: 2 }])]);

    const outcome = await scanPhoto(createPhotoScanState(), 'ONE', deps);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.lines).toHaveLength(1);
    expect(outcome.lines[0].qty).toBe(2);
  });
});

/**
 * CLAUDE.md's third requirement: items hidden under other items are flagged as hidden, so the
 * shopper is asked to move them. The census answers that question on every photograph and
 * `CoachNotice` already holds the product owner's own wording for it, but nothing carried the
 * answer from one to the other: `scanPhoto` read `result.value.occlusion` only to hand the whole
 * payload to `applyCensus`, and returned a bag with no trace of it.
 *
 * Measured on the fifteen photographs in `server/eval/corpus/clut`, the census raises this flag on
 * 25 of the 39 scans that have something hidden. All 25 were being thrown away here.
 */
describe('scanPhoto reports what is hidden', () => {
  it('returns the occlusion report so the screen can ask the shopper to move things', async () => {
    const deps = stubCensus([
      reply([{ name: 'cereal' }], {
        itemsLikelyHidden: true,
        severity: 'many',
        reason: 'a produce bag covers the bottom of the basket',
      }),
    ]);

    const outcome = await scanPhoto(createPhotoScanState(), 'BASE64', deps);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.occlusion.itemsLikelyHidden).toBe(true);
    expect(outcome.occlusion.severity).toBe('many');
  });

  it('reports nothing hidden when the census saw everything', async () => {
    const deps = stubCensus([reply([{ name: 'cereal' }])]);

    const outcome = await scanPhoto(createPhotoScanState(), 'BASE64', deps);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.occlusion.itemsLikelyHidden).toBe(false);
    expect(outcome.occlusion.severity).toBe('none');
  });
});

/**
 * The close read. Every product the census boxed is cut out of the original photograph and read
 * again on its own; the two readings are reconciled on the server, and only agreement is shown
 * as sure. See docs/superpowers/specs/2026-09-06-photo-verification-design.md.
 */
describe('scanPhoto with a close read', () => {
  const box = { x: 0.1, y: 0.1, w: 0.3, h: 0.3 };

  function boxedReply(items: { name: string; brand?: string; count?: number; confidence?: number; box?: typeof box | null }[]): CensusPayload {
    const base = reply(items.map((i) => ({ name: i.name, count: i.count, confidence: i.confidence })));
    return {
      ...base,
      inViewCounts: items.map((i) => ({ productKey: `${(i.brand ?? '').toLowerCase()}::${i.name}`, count: i.count ?? 1 })),
      unmarkedItems: (base.unmarkedItems as UnmarkedItem[]).map((u, n): UnmarkedItem => ({
        ...u,
        productKey: `${(items[n].brand ?? '').toLowerCase()}::${items[n].name}`,
        box: items[n].box === undefined ? box : items[n].box,
      })),
    };
  }

  type Line = { description: string; brand: string | null; count: number; confidence: number; sure: boolean; agreed: boolean };
  function verifier(lines: Record<string, Partial<Line>>) {
    const asked: { id: string; imageBase64: string; wide: unknown }[][] = [];
    const brands: (string[] | undefined)[] = [];
    return {
      asked,
      brands,
      async requestVerify(request: { items: { id: string; imageBase64: string; wide: { description: string; brand: string | null; count: number; confidence: number } }[]; brands?: string[] }) {
        asked.push(request.items);
        brands.push(request.brands);
        return {
          ok: true as const,
          value: {
            items: request.items.map((item) => ({
              id: item.id,
              close: null,
              line: {
                description: item.wide.description,
                brand: item.wide.brand,
                count: item.wide.count,
                confidence: 0.95,
                sure: true,
                agreed: true,
                ...(lines[item.wide.description] ?? {}),
              },
            })),
          },
        };
      },
    };
  }
  const crop = async (b: typeof box | null) => (b === null ? null : `crop@${b.x}`);

  /**
   * The unit pass separating one crop into the varieties it held. The server asks it only where
   * the close read counted more than one package, and answers with one line per variety and each
   * one's share of the box (`splitByUnits` in server/src/reconcile.ts).
   */
  function splitter(split: { description: string; count?: number; box: typeof box }[]) {
    return {
      async requestVerify(request: { items: { id: string; imageBase64: string; box?: typeof box | null; wide: { description: string; brand: string | null; count: number; confidence: number } }[] }) {
        return {
          ok: true as const,
          value: {
            items: request.items.map((item) => ({
              id: item.id,
              close: null,
              line: { description: item.wide.description, brand: item.wide.brand, count: item.wide.count, confidence: 0.5, sure: false, agreed: true },
              split: split.map((piece) => ({
                description: piece.description,
                brand: item.wide.brand,
                count: piece.count ?? 1,
                confidence: 0.5,
                sure: false,
                agreed: true,
                box: piece.box,
              })),
            })),
          },
        };
      },
    };
  }

  /**
   * 2026-09-17: one request's close reads took 2s for some crops and 7 to 10s for others, and the
   * bag waited for the slowest. Each item now goes in the bag when its own line lands.
   */
  /**
   * Measured on clut7 on 2026-09-22 (`server/eval/census-timeline.json`): the census writes the
   * first product's rectangle 2.9 seconds in and finishes at 9.4, about 0.8 seconds a product.
   * Waiting for the whole answer before cutting the first crop spends those seconds on nothing.
   */
  describe('while the census is still writing', () => {
    const other = { x: 0.6, y: 0.6, w: 0.3, h: 0.3 };
    const streamedProduct = (name: string, brand: string, at: typeof box) => ({
      description: name,
      productKey: `${brand.toLowerCase()}::${name}`,
      catalogSku: null,
      approxLocation: 'centre of frame',
      confidence: 0.9,
      isProduct: true,
      box: at,
      count: 1,
    });

    /** A census that writes its products, then answers with the same two. */
    function streamingCensus(hold?: Promise<void>) {
      const payload = boxedReply([
        { name: 'rigatoni', brand: 'Priano', box },
        { name: 'salsa', brand: 'Primo', box: other },
      ]);
      return {
        async requestCensus(_request: unknown, onItem?: (p: unknown) => void) {
          onItem?.(streamedProduct('rigatoni', 'Priano', box));
          onItem?.(streamedProduct('salsa', 'Primo', other));
          if (hold) await hold;
          return { ok: true as const, value: payload };
        },
      };
    }

    it('reads a crop before the census has finished, one request per crop', async () => {
      let release!: () => void;
      const held = new Promise<void>((resolve) => { release = resolve; });
      const sent: string[][] = [];
      const done = scanPhoto(createPhotoScanState(), 'IMG', {
        ...streamingCensus(held),
        crop,
        async requestVerify(request) {
          sent.push(request.items.map((i) => i.wide.description));
          return { ok: true, value: { items: request.items.map((i) => ({ id: i.id, line: { description: i.wide.description, brand: i.wide.brand, count: 1, confidence: 0.95, sure: true, agreed: true } })) } };
        },
      } as PhotoScanDeps);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(sent).toEqual([['rigatoni'], ['salsa']]);
      release();
      const outcome = await done;
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.lines.map((l) => l.name)).toEqual(['rigatoni', 'salsa']);
      // The crops read early are not read again when the census lands.
      expect(sent).toEqual([['rigatoni'], ['salsa']]);
    });

    it('names the products it already knows about as the neighbours of the crop it sends', async () => {
      const neighbours: unknown[][] = [];
      await scanPhoto(createPhotoScanState(), 'IMG', {
        ...streamingCensus(),
        crop,
        async requestVerify(request) {
          neighbours.push(request.items.map((i) => i.neighbours ?? []));
          return { ok: true, value: { items: request.items.map((i) => ({ id: i.id, line: { description: i.wide.description, brand: i.wide.brand, count: 1, confidence: 0.95, sure: true, agreed: true } })) } };
        },
      } as PhotoScanDeps);
      expect(neighbours[0]).toEqual([[]]);
      expect(neighbours[1]).toEqual([[{ box, description: 'rigatoni' }]]);
    });

    it('drops an early reading of a product the finished census does not hold', async () => {
      const payload = boxedReply([{ name: 'rigatoni', brand: 'Priano', box }]);
      const outcome = await scanPhoto(createPhotoScanState(), 'IMG', {
        async requestCensus(_request: unknown, onItem?: (p: unknown) => void) {
          onItem?.(streamedProduct('rigatoni', 'Priano', box));
          onItem?.(streamedProduct('salsa', 'Primo', other));
          return { ok: true as const, value: payload };
        },
        crop,
        async requestVerify(request) {
          return { ok: true, value: { items: request.items.map((i) => ({ id: i.id, line: { description: i.wide.description, brand: i.wide.brand, count: 1, confidence: 0.95, sure: true, agreed: true } })) } };
        },
      } as PhotoScanDeps);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.lines.map((l) => l.name)).toEqual(['rigatoni']);
      expect(outcome.items.map((i) => `${i.name}:${i.status}`)).toEqual(['rigatoni:sure']);
    });

    it('reads a crop the census never wrote early in one request with the rest', async () => {
      const payload = boxedReply([
        { name: 'rigatoni', brand: 'Priano', box },
        { name: 'salsa', brand: 'Primo', box: other },
      ]);
      const sent: string[][] = [];
      const outcome = await scanPhoto(createPhotoScanState(), 'IMG', {
        async requestCensus(_request: unknown, onItem?: (p: unknown) => void) {
          onItem?.(streamedProduct('rigatoni', 'Priano', box));
          return { ok: true as const, value: payload };
        },
        crop,
        async requestVerify(request) {
          sent.push(request.items.map((i) => i.wide.description));
          return { ok: true, value: { items: request.items.map((i) => ({ id: i.id, line: { description: i.wide.description, brand: i.wide.brand, count: 1, confidence: 0.95, sure: true, agreed: true } })) } };
        },
      } as PhotoScanDeps);
      expect(sent).toEqual([['rigatoni'], ['salsa']]);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.lines.map((l) => l.name)).toEqual(['rigatoni', 'salsa']);
    });

    it('keeps the photograph when cutting a crop early throws', async () => {
      const outcome = await scanPhoto(createPhotoScanState(), 'IMG', {
        ...streamingCensus(),
        crop: async () => { throw new Error('the manipulator gave up'); },
        async requestVerify(request) {
          return { ok: true, value: { items: request.items.map((i) => ({ id: i.id, line: { description: i.wide.description, brand: i.wide.brand, count: 1, confidence: 0.95, sure: true, agreed: true } })) } };
        },
      } as PhotoScanDeps);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.lines.map((l) => l.name)).toEqual(['rigatoni', 'salsa']);
      expect(outcome.items.every((i) => i.status === 'unsure')).toBe(true);
    });

    it('says the close read did not finish when an early request failed', async () => {
      const outcome = await scanPhoto(createPhotoScanState(), 'IMG', {
        ...streamingCensus(),
        crop,
        async requestVerify() {
          return { ok: false, failure: 'timeout' as const };
        },
      } as PhotoScanDeps);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.verifyFailure).toBe('timeout');
      expect(outcome.items.every((i) => i.status === 'unsure')).toBe(true);
    });
  });

  describe('as each line arrives', () => {
    const other = { x: 0.6, y: 0.6, w: 0.3, h: 0.3 };
    const lineFor = (id: string, description: string, brand: string | null, sure = true) => ({
      id,
      line: { description, brand, count: 1, confidence: sure ? 0.95 : 0.5, sure, agreed: sure },
    });
    const twoProducts = () => boxedReply([
      { name: 'rigatoni', brand: 'Priano', box },
      { name: 'salsa', brand: 'Primo', box: other },
    ]);

    it('puts an item in the bag the moment its close read lands, before the others', async () => {
      let release!: () => void;
      const held = new Promise<void>((resolve) => { release = resolve; });
      const progress: { lines: string[]; statuses: string[] }[] = [];
      const done = scanPhoto(
        createPhotoScanState(),
        'IMG',
        {
          ...stubCensus([twoProducts()]),
          crop,
          async requestVerify(_request, onItem) {
            onItem?.(lineFor('p1', 'salsa', 'Primo'));
            await held;
            onItem?.(lineFor('p0', 'rigatoni', 'Priano'));
            return { ok: true, value: { items: [lineFor('p0', 'rigatoni', 'Priano'), lineFor('p1', 'salsa', 'Primo')] } };
          },
        },
        {
          onProgress: ({ lines, items }) => progress.push({
            lines: lines.map((l) => `${l.name}:${l.unsure ? 'unsure' : 'sure'}`),
            statuses: items.map((i) => `${i.name}:${i.status}`),
          }),
        },
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(progress).toEqual([{ lines: ['salsa:sure'], statuses: ['rigatoni:checking', 'salsa:sure'] }]);
      release();
      const outcome = await done;
      expect(progress[1]).toEqual({ lines: ['rigatoni:sure', 'salsa:sure'], statuses: ['rigatoni:sure', 'salsa:sure'] });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.lines.map((l) => l.name)).toEqual(['rigatoni', 'salsa']);
    });

    it('ends with the same bag and review whether the lines arrived one by one or all at once', async () => {
      const answers = [lineFor('p0', 'rigatoni', 'Priano'), lineFor('p1', 'salsa', 'Primo', false)];
      const whole = await scanPhoto(createPhotoScanState(), 'IMG', {
        ...stubCensus([twoProducts()]),
        crop,
        async requestVerify() {
          return { ok: true, value: { items: answers } };
        },
      });
      const streamed = await scanPhoto(
        createPhotoScanState(),
        'IMG',
        {
          ...stubCensus([twoProducts()]),
          crop,
          async requestVerify(_request, onItem) {
            for (const answer of [...answers].reverse()) onItem?.(answer);
            return { ok: true, value: { items: answers } };
          },
        },
        { onProgress: () => {} },
      );
      expect(streamed).toEqual(whole);
    });

    it('keeps the lines that arrived when the close read fails partway', async () => {
      const outcome = await scanPhoto(
        createPhotoScanState(),
        'IMG',
        {
          ...stubCensus([twoProducts()]),
          crop,
          async requestVerify(_request, onItem) {
            onItem?.(lineFor('p0', 'rigatoni', 'Priano'));
            return { ok: false, failure: 'timeout' };
          },
        },
        { onProgress: () => {} },
      );
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.items.map((i) => `${i.name}:${i.status}`)).toEqual(['rigatoni:sure', 'salsa:unsure']);
      expect(outcome.lines.map((l) => `${l.name}:${l.unsure ? 'unsure' : 'sure'}`)).toEqual(['rigatoni:sure', 'salsa:unsure']);
      expect(outcome.verifyFailure).toBe('timeout');
    });
  });

  it('sends the box the crop was cut at, so a split line has a share of it to point at', async () => {
    const census = stubCensus([boxedReply([{ name: 'crackers', brand: 'Savoritz', count: 2 }])]);
    const verify = verifier({});
    await scanPhoto(createPhotoScanState(), 'IMG', { ...census, crop, requestVerify: verify.requestVerify });

    expect((verify.asked[0][0] as { box?: unknown }).box).toEqual(box);
  });

  it('turns one crop that held two varieties into one line each, neither of them asserted', async () => {
    const left = { x: 0.1, y: 0.1, w: 0.15, h: 0.3 };
    const right = { x: 0.25, y: 0.1, w: 0.15, h: 0.3 };
    const census = stubCensus([boxedReply([{ name: 'crackers with sea salt', brand: 'Savoritz', count: 2 }])]);
    const verify = splitter([
      { description: 'crackers with sea salt', box: left },
      { description: 'crackers with rosemary sourdough', box: right },
    ]);

    const outcome = await scanPhoto(createPhotoScanState(), 'IMG', { ...census, crop, requestVerify: verify.requestVerify });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.items.map((i) => i.name)).toEqual(['crackers with sea salt', 'crackers with rosemary sourdough']);
    expect(outcome.items.map((i) => i.qty)).toEqual([1, 1]);
    expect(outcome.items.map((i) => i.box)).toEqual([left, right]);
    expect(outcome.items.every((i) => i.status === 'unsure')).toBe(true);
    expect(outcome.items[0].id).not.toBe(outcome.items[1].id);
    // Both reach the bag as separate lines, which is the product the photograph was missing.
    expect(outcome.lines).toHaveLength(2);
    expect(outcome.lines.every((l) => l.unsure)).toBe(true);
  });

  it('crops every boxed item, sends the crops with the wide reading, and asserts what agreed', async () => {
    const census = stubCensus([boxedReply([{ name: 'rigatoni', brand: 'Priano', count: 2, confidence: 0.9 }])]);
    const verify = verifier({});
    const outcome = await scanPhoto(createPhotoScanState(), 'IMG', { ...census, crop, requestVerify: verify.requestVerify });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(verify.asked[0]).toHaveLength(1);
    expect(verify.asked[0][0].imageBase64).toBe('crop@0.1');
    expect(verify.asked[0][0].wide).toEqual({ description: 'rigatoni', productKey: 'priano::rigatoni', brand: 'Priano', count: 2, confidence: 0.9 });
    expect(verify.brands[0]).toEqual(['Priano']);
    expect(outcome.items).toHaveLength(1);
    expect(outcome.items[0].status).toBe('sure');
    expect(outcome.items[0].box).toEqual(box);
    expect(outcome.lines[0].unsure).toBe(false);
  });

  /**
   * The gate's verdict is not the same thing as its confidence, and the bag had only ever been
   * shown the confidence. A line both readings agreed on carries their average, ~0.96, and the
   * package check can still take its certainty away afterwards without touching that number
   * (`doubtByPackages` in server/src/reconcile.ts, which may only ever doubt). The review screen
   * read `line.sure` and showed amber; the bag read the confidence alone and asserted it. On the
   * fifteen clut photographs this was every one of the remaining asserted-wrong lines: two boxes
   * of Priano rigatoni leaning together, doubted by the check and asserted by the bag anyway.
   */
  it('holds a doubted line back in the bag too, though both readings were confident', async () => {
    const census = stubCensus([boxedReply([{ name: 'rigatoni', brand: 'Priano', confidence: 0.97 }])]);
    const verify = verifier({ rigatoni: { confidence: 0.965, sure: false, agreed: true } });
    const outcome = await scanPhoto(createPhotoScanState(), 'IMG', { ...census, crop, requestVerify: verify.requestVerify });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.items[0].status).toBe('unsure');
    expect(outcome.lines[0].unsure).toBe(true);
  });

  it('shows a disagreement as unsure, in the bag and in the review', async () => {
    const census = stubCensus([boxedReply([{ name: 'rigatoni', brand: 'Piano', confidence: 0.97 }])]);
    const verify = verifier({ rigatoni: { brand: 'Priano', confidence: 0.5, sure: false, agreed: false } });
    const outcome = await scanPhoto(createPhotoScanState(), 'IMG', { ...census, crop, requestVerify: verify.requestVerify });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.items[0].status).toBe('unsure');
    expect(outcome.lines[0].unsure).toBe(true);
    // The close read's brand is what the line shows: it read the label.
    expect(outcome.lines[0].brand).toBe('Priano');
    expect(outcome.items[0].brand).toBe('Priano');
  });

  it('reports the boxed items as checking before the close read, so the review can draw them at once', async () => {
    const census = stubCensus([boxedReply([{ name: 'rigatoni' }, { name: 'farro', box: null }])]);
    const verify = verifier({});
    const seen: string[][] = [];
    await scanPhoto(createPhotoScanState(), 'IMG', { ...census, crop, requestVerify: verify.requestVerify }, {
      onCensus: (items) => seen.push(items.map((i) => `${i.name}:${i.status}`)),
    });
    expect(seen).toEqual([['rigatoni:checking', 'farro:unsure']]);
  });

  it('marks an item with no box, or whose crop failed, unsure: nothing read it twice', async () => {
    const census = stubCensus([boxedReply([{ name: 'rigatoni', box: null, confidence: 0.99 }, { name: 'farro', confidence: 0.99 }])]);
    const verify = verifier({});
    const failingCrop = async () => null;
    const outcome = await scanPhoto(createPhotoScanState(), 'IMG', { ...census, crop: failingCrop, requestVerify: verify.requestVerify });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.items.map((i) => i.status)).toEqual(['unsure', 'unsure']);
    expect(outcome.lines.every((l) => l.unsure)).toBe(true);
    // Nothing was sent for a close read: there was nothing to send.
    expect(verify.asked).toEqual([]);
  });

  it('marks everything unsure when the close read cannot be made, and says so', async () => {
    const census = stubCensus([boxedReply([{ name: 'rigatoni', confidence: 0.99 }])]);
    const outcome = await scanPhoto(createPhotoScanState(), 'IMG', {
      ...census,
      crop,
      requestVerify: async () => ({ ok: false as const, failure: 'timeout' as const }),
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.items[0].status).toBe('unsure');
    expect(outcome.lines[0].unsure).toBe(true);
    expect(outcome.verifyFailure).toBe('timeout');
  });

  it('keeps the wide reading as is when no close read is wired, which is what the older callers get', async () => {
    const census = stubCensus([boxedReply([{ name: 'rigatoni', confidence: 0.9 }, { name: 'mystery', confidence: 0.3 }])]);
    const outcome = await scanPhoto(createPhotoScanState(), 'IMG', census);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.items.map((i) => i.status)).toEqual(['sure', 'unsure']);
    expect(outcome.verifyFailure).toBeUndefined();
  });

  it('sends the names to confirm with the census, and a sure reading replaces the unsure line', async () => {
    const census = stubCensus([
      boxedReply([{ name: 'rigatoni', brand: 'Piano', confidence: 0.97 }]),
      boxedReply([{ name: 'rigatoni', brand: 'Priano', confidence: 0.99 }]),
    ]);
    const first = await scanPhoto(createPhotoScanState(), 'ONE', { ...census, crop, requestVerify: verifier({ rigatoni: { brand: 'Piano', confidence: 0.5, sure: false, agreed: false } }).requestVerify });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.lines[0].unsure).toBe(true);

    const second = await scanPhoto(first.state, 'TWO', { ...census, crop, requestVerify: verifier({}).requestVerify }, {
      confirming: first.lines.filter((l) => l.unsure).map((l) => l.name),
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(census.asked[1]).toMatchObject({ confirming: ['rigatoni'] });
    expect(second.lines).toHaveLength(1);
    expect(second.lines[0].unsure).toBe(false);
    expect(second.lines[0].brand).toBe('Priano');
  });
});

/**
 * One object listed twice. The wide pass named a package of beef ribs twice, "Black Angus beef
 * chuck country-style ribs" and "Beef country-style ribs", with two boxes on the same package,
 * and each close read confirmed its own hint. Two readings of one thing under two names is not
 * two products, and geometry says so: one box inside the other, and the names sharing words.
 */
describe('scanPhoto folds two boxes on one object', () => {
  const box = { x: 0.1, y: 0.1, w: 0.3, h: 0.3 };
  const inner = { x: 0.12, y: 0.12, w: 0.26, h: 0.26 };

  function replyWith(items: { name: string; brand?: string; confidence: number; box: typeof box }[]): CensusPayload {
    const base = reply(items.map((i) => ({ name: i.name, confidence: i.confidence })));
    return {
      ...base,
      inViewCounts: items.map((i) => ({ productKey: `${(i.brand ?? '').toLowerCase()}::${i.name}`, count: 1 })),
      unmarkedItems: (base.unmarkedItems as UnmarkedItem[]).map((u, n): UnmarkedItem => ({
        ...u,
        productKey: `${(items[n].brand ?? '').toLowerCase()}::${items[n].name}`,
        box: items[n].box,
      })),
    };
  }
  const agree = async (request: { items: { id: string; wide: { description: string; brand: string | null; count: number; confidence: number } }[] }) => ({
    ok: true as const,
    value: {
      items: request.items.map((item) => ({
        id: item.id,
        close: null,
        line: { description: item.wide.description, brand: item.wide.brand, count: item.wide.count, confidence: 0.95, sure: true, agreed: true },
      })),
    },
  });
  const crop = async () => 'crop';

  it('keeps one item, unsure, when two boxes nest and the names share words', async () => {
    const census = stubCensus([replyWith([
      { name: 'Black Angus beef chuck country-style ribs', confidence: 0.9, box },
      { name: 'Beef country-style ribs', confidence: 0.8, box: inner },
    ])]);
    const outcome = await scanPhoto(createPhotoScanState(), 'IMG', { ...census, crop, requestVerify: agree });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.items).toHaveLength(1);
    expect(outcome.items[0].name).toBe('Black Angus beef chuck country-style ribs');
    expect(outcome.items[0].status).toBe('unsure');
    expect(outcome.lines).toHaveLength(1);
    expect(outcome.lines[0].qty).toBe(1);
    expect(outcome.lines[0].unsure).toBe(true);
  });

  it('keeps both when the boxes nest but the names share nothing: a cheese block on an egg carton', async () => {
    const census = stubCensus([replyWith([
      { name: 'eggs', confidence: 0.9, box },
      { name: 'cheddar cheese slices', confidence: 0.8, box: inner },
    ])]);
    const outcome = await scanPhoto(createPhotoScanState(), 'IMG', { ...census, crop, requestVerify: agree });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.items).toHaveLength(2);
    expect(outcome.lines).toHaveLength(2);
  });

  it('keeps both when the names share words but the boxes are apart: two bags of the same thing', async () => {
    const census = stubCensus([replyWith([
      { name: 'red apples', confidence: 0.9, box },
      { name: 'red apples in a bag', confidence: 0.8, box: { x: 0.6, y: 0.6, w: 0.3, h: 0.3 } },
    ])]);
    const outcome = await scanPhoto(createPhotoScanState(), 'IMG', { ...census, crop, requestVerify: agree });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.items).toHaveLength(2);
  });
});

/**
 * What the screen says under the photograph once both readings are in.
 *
 * On 2026-09-17 the owner, testing on a phone, asked for the green items to go in the cart
 * "instead of having me take another picture". They already went in: every line of every
 * photograph reaches the bag. What the screen said was "Added 3 items" beside the amber notice
 * and a button reading "Photograph it again", which reads as the green ones waiting on a retake.
 * So the line names what is in the cart, and names the amber items as in it too.
 */
describe('photoSummary', () => {
  const item = (name: string, status: PhotoItem['status'], qty = 1): PhotoItem => ({
    id: name,
    key: `::${name}`,
    name,
    brand: null,
    qty,
    confidence: status === 'sure' ? 0.9 : 0.5,
    status,
    box: null,
  });

  it('names the green items as in the cart', () => {
    expect(photoSummary([item('Rigatoni', 'sure'), item('Fusilli Bucati', 'sure', 2)])).toBe(
      'In your cart: Rigatoni, Fusilli Bucati x2',
    );
  });

  it('says the amber items are in the cart too, not held back for another photo', () => {
    expect(photoSummary([item('Rigatoni', 'sure'), item('Brioche Buns', 'unsure')])).toBe(
      'In your cart: Rigatoni\nAlso in your cart, not sure yet: Brioche Buns',
    );
  });

  it('says so when nothing was sure', () => {
    expect(photoSummary([item('Brioche Buns', 'unsure'), item('Salsa', 'unsure')])).toBe(
      'In your cart, not sure yet: Brioche Buns, Salsa',
    );
  });

  it('shortens a long list rather than covering the photograph with it', () => {
    const names = ['A', 'B', 'C', 'D', 'E', 'F'];
    expect(photoSummary(names.map((n) => item(n, 'sure')))).toBe('In your cart: A, B, C, D and 2 more');
  });

  it('names a product once when the photograph boxed it twice, as the cart does', () => {
    // clut7 on 2026-09-17: two boxes on the black beans read "Black Beans x5, Black Beans x5".
    expect(photoSummary([item('Black Beans', 'unsure', 5), item('Black Beans', 'unsure', 5), item('Salsa', 'unsure')])).toBe(
      'In your cart, not sure yet: Black Beans x5, Salsa',
    );
  });

  it('says a photograph found nothing', () => {
    expect(photoSummary([])).toBe('Nothing found in that one');
  });
});
