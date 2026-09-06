import {
  createPhotoScanState,
  scanPhoto,
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
