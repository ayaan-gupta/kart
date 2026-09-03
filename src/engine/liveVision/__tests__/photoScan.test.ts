import {
  createPhotoScanState,
  scanPhoto,
  type PhotoScanDeps,
} from '../photoScan';
import type { CensusPayload } from '../recognitionClient';

/**
 * A census reply shaped the way the capture path really receives one: no marks and no regions,
 * because the device never ran a detector and `ENUMERATOR_URL` is unset, so every product
 * arrives through `unmarkedItems`. See server/src/enumerate.ts.
 */
function reply(items: { name: string; count?: number; confidence?: number }[]): CensusPayload {
  return {
    marks: [],
    inViewCounts: items.map((i) => ({ productKey: `::${i.name}`, count: i.count ?? 1 })),
    unmarkedItems: items.map((i) => ({
      description: i.name,
      productKey: `::${i.name}`,
      catalogSku: null,
      approxLocation: 'centre of frame',
      confidence: i.confidence ?? 0.9,
    })),
    occlusion: { itemsLikelyHidden: false, severity: 'none', reason: 'single item' },
    regions: [],
    enumeration: 'degraded',
  };
}

/** Records what each call was asked, so the `counted` contract can be asserted on. */
function stubCensus(replies: CensusPayload[]): PhotoScanDeps & { asked: { counted: string[] }[] } {
  const asked: { counted: string[] }[] = [];
  let n = 0;
  return {
    asked,
    async requestCensus(request) {
      asked.push({ counted: request.counted ?? [] });
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
