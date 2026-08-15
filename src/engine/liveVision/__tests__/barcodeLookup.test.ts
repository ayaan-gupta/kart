import { createLookupCache, lookupBarcode, OPEN_FOOD_FACTS_ATTRIBUTION } from '../barcodeLookup';

const found = (over: Record<string, unknown> = {}) => ({
  status: 1,
  product: {
    code: '016000275270',
    product_name: 'Gmills hny nut cheerios sweetened whl grn oat cereal',
    brands: 'General Mills',
    quantity: '347 g',
    categories_tags: ['en:breakfasts', 'en:cereals'],
    ...over,
  },
});

function mockFetch(impl: jest.Mock) {
  (global as unknown as { fetch: unknown }).fetch = impl;
  return impl;
}

describe('lookupBarcode', () => {
  it('resolves a known barcode', async () => {
    mockFetch(jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => found() }));
    const p = await lookupBarcode(createLookupCache(), '016000275270');
    expect(p?.brand).toBe('General Mills');
    expect(p?.size).toBe('347 g');
  });

  it('passes a 13 digit EAN-13-with-leading-zero payload through unmodified and resolves normally', async () => {
    // Apple's Vision framework has no UPC-A symbology: a physical UPC-A barcode always arrives
    // here as the 13 digit EAN-13 string Vision decodes it as, the original 12 digit UPC-A
    // prefixed with a leading zero. This module must forward that string opaquely rather than
    // assume a 12 digit UPC, so nothing here may normalize or truncate it.
    const ean13FromUpcA = '0016000275270';
    const f = mockFetch(jest.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => found({ code: ean13FromUpcA }),
    }));
    const p = await lookupBarcode(createLookupCache(), ean13FromUpcA);
    expect(f.mock.calls[0][0]).toContain(ean13FromUpcA);
    expect(p?.brand).toBe('General Mills');
  });

  it('treats status 0 as a miss even though the HTTP code is 200', async () => {
    // This is the trap. Open Food Facts answers 200 for an unknown barcode. Checking response.ok
    // alone reports every miss as a successful lookup with an undefined name.
    mockFetch(jest.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ code: '1', status: 0, status_verbose: 'product not found' }),
    }));
    expect(await lookupBarcode(createLookupCache(), '021130126026')).toBeNull();
  });

  it('treats an empty quantity string as no size', async () => {
    // Pepsi's real response has quantity: "".
    mockFetch(jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => found({ quantity: '' }) }));
    expect((await lookupBarcode(createLookupCache(), '012000001291'))?.size).toBeNull();
  });

  it('takes only the first brand from the comma joined list', async () => {
    // Nutella's real response is "Nutella, Ferrero, Yum yum".
    mockFetch(jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => found({ brands: 'Nutella, Ferrero, Yum yum' }) }));
    expect((await lookupBarcode(createLookupCache(), '3017620422003'))?.brand).toBe('Nutella');
  });

  it('returns null rather than an empty name when the record has no name', async () => {
    mockFetch(jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => found({ product_name: '' }) }));
    expect(await lookupBarcode(createLookupCache(), '016000275270')).toBeNull();
  });

  it('reads a human category out of the tag list', async () => {
    mockFetch(jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => found() }));
    expect((await lookupBarcode(createLookupCache(), '016000275270'))?.category).toBe('breakfasts');
  });

  it('sends an identifying User-Agent, which their policy requires', async () => {
    const f = mockFetch(jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => found() }));
    await lookupBarcode(createLookupCache(), '016000275270');
    expect(f.mock.calls[0][1].headers['User-Agent']).toMatch(/Kart\/.+\(.+\)/);
  });

  it('caches a hit so the same barcode is fetched once', async () => {
    const f = mockFetch(jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => found() }));
    const cache = createLookupCache();
    await lookupBarcode(cache, '016000275270');
    await lookupBarcode(cache, '016000275270');
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('caches a miss too', async () => {
    // Without this, an unbranded item whose barcode is not in the database is re-fetched on
    // every frame it is visible, and the 15 per minute budget is gone in seconds.
    const f = mockFetch(jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ status: 0 }) }));
    const cache = createLookupCache();
    await lookupBarcode(cache, '021130126026');
    await lookupBarcode(cache, '021130126026');
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('shares one in-flight request between concurrent callers', async () => {
    let resolveIt: (v: unknown) => void = () => {};
    const f = mockFetch(jest.fn().mockReturnValue(new Promise((r) => { resolveIt = r; })));
    const cache = createLookupCache();
    const a = lookupBarcode(cache, '016000275270');
    const b = lookupBarcode(cache, '016000275270');
    resolveIt({ ok: true, status: 200, json: async () => found() });
    await Promise.all([a, b]);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('stops fetching once the per-minute budget is spent', async () => {
    const f = mockFetch(jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => found() }));
    const cache = createLookupCache();
    for (let i = 0; i < 20; i++) await lookupBarcode(cache, `upc-${i}`);
    // Their documented ceiling is 15 per minute per IP. Going over risks the whole IP, which on
    // a shared network is not only this user.
    expect(f.mock.calls.length).toBeLessThanOrEqual(15);
  });

  it('returns null instead of throwing when the network fails', async () => {
    mockFetch(jest.fn().mockRejectedValue(new TypeError('Network request failed')));
    expect(await lookupBarcode(createLookupCache(), '016000275270')).toBeNull();
  });

  it('returns null instead of throwing on a non-JSON body', async () => {
    mockFetch(jest.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); },
    }));
    expect(await lookupBarcode(createLookupCache(), '016000275270')).toBeNull();
  });

  it('ships the attribution string the ODbL requires', () => {
    expect(OPEN_FOOD_FACTS_ATTRIBUTION).toContain('Open Food Facts');
    expect(OPEN_FOOD_FACTS_ATTRIBUTION).toContain('ODbL');
  });
});
