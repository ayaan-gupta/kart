import { REQUEST_TIMEOUT_MS } from '../config';
import { lastRecognitionEndpoint, requestCensus, requestIdentify, requestVerify, resetRecognitionEndpoint } from '../recognitionClient';

const okCensus = {
  ok: true,
  result: {
    marks: [{ id: 1, name: 'Bananas', brand: null, size: null, category: 'Produce', confidence: 0.9, needsCloserLook: false }],
    unmarkedItems: [],
    inViewCounts: [{ productKey: '::bananas', count: 1 }],
    occlusion: { itemsLikelyHidden: false, severity: 'none', reason: 'clear view' },
  },
};

const req = { imageBase64: 'AAAA', marks: [{ id: 1, box: { x: 0, y: 0, w: 0.5, h: 0.5 } }] };

function mockFetch(impl: jest.Mock) {
  (global as unknown as { fetch: unknown }).fetch = impl;
  return impl;
}

describe('requestCensus', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    process.env.EXPO_PUBLIC_KART_API_URL = 'https://kart.test';
  });

  beforeEach(() => {
    process.env.EXPO_PUBLIC_KART_API_URL = 'https://kart.test';
  });

  it('returns the parsed result on success', async () => {
    mockFetch(jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => okCensus }));
    const res = await requestCensus(req);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.marks[0].name).toBe('Bananas');
  });

  it('posts the image and marks to the census route', async () => {
    const f = mockFetch(jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => okCensus }));
    await requestCensus(req);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://kart.test/api/census');
    const body = JSON.parse(init.body);
    expect(body.image).toBe('AAAA');
    expect(body.marks).toEqual(req.marks);
  });

  it('reports unconfigured rather than calling an empty host', async () => {
    delete process.env.EXPO_PUBLIC_KART_API_URL;
    const f = mockFetch(jest.fn());
    const res = await requestCensus(req);
    expect(res).toEqual({ ok: false, failure: 'unconfigured' });
    expect(f).not.toHaveBeenCalled();
  });

  it('never touches the network when the caller signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const f = mockFetch(jest.fn());
    const res = await requestCensus(req, controller.signal);
    expect(res).toEqual({ ok: false, failure: 'timeout' });
    expect(f).not.toHaveBeenCalled();
  });

  it('reports offline when fetch itself rejects', async () => {
    mockFetch(jest.fn().mockRejectedValue(new TypeError('Network request failed')));
    expect(await requestCensus(req)).toEqual({ ok: false, failure: 'offline' });
  });

  it('reports timeout when the request aborts', async () => {
    const abort = new Error('Aborted');
    abort.name = 'AbortError';
    mockFetch(jest.fn().mockRejectedValue(abort));
    expect(await requestCensus(req)).toEqual({ ok: false, failure: 'timeout' });
  });

  it('separates a 4xx from a 5xx', async () => {
    mockFetch(jest.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'Bad request' }) }));
    expect(await requestCensus(req)).toEqual({ ok: false, failure: 'rejected' });
    mockFetch(jest.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: 'Recognition failed' }) }));
    expect(await requestCensus(req)).toEqual({ ok: false, failure: 'server' });
  });

  it('reports malformed when the body is not the shape we expect', async () => {
    mockFetch(jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, result: { marks: 'nope' } }) }));
    expect(await requestCensus(req)).toEqual({ ok: false, failure: 'malformed' });
  });

  it('reports malformed when a 200 response carries an envelope that says ok: false', async () => {
    mockFetch(jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: false, error: 'not actually ok' }) }));
    expect(await requestCensus(req)).toEqual({ ok: false, failure: 'malformed' });
  });

  it('reports malformed rather than throwing when the body is not JSON at all', async () => {
    mockFetch(jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } }));
    expect(await requestCensus(req)).toEqual({ ok: false, failure: 'malformed' });
  });

  it('drops a mark the server echoed back with a non-numeric id', async () => {
    mockFetch(jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, result: { ...okCensus.result, marks: [{ ...okCensus.result.marks[0], id: 'one' }] } }),
    }));
    const res = await requestCensus(req);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.marks).toHaveLength(0);
  });
});

describe('requestCensus timeout budget', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    process.env.EXPO_PUBLIC_KART_API_URL = 'https://kart.test';
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /** A server that never answers, and a fetch that honours the abort the client sends it. */
  function hangingFetch() {
    return mockFetch(
      jest.fn(
        (_url: string, init: { signal: AbortSignal }) =>
          new Promise((_, reject) => {
            init.signal.addEventListener('abort', () => {
              const e = new Error('Aborted');
              e.name = 'AbortError';
              reject(e);
            });
          }),
      ),
    );
  }

  it('aborts at the shared default when no budget is given', async () => {
    hangingFetch();
    const pending = requestCensus(req);
    await jest.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    expect(await pending).toEqual({ ok: false, failure: 'timeout' });
  });

  it('waits for the longer budget a photograph is given', async () => {
    // A photograph is one call that the shopper is waiting on, not one of eight in a live scan,
    // and the service's own budget is 25s (server/src/http.ts). A client that gives up at 20s
    // abandons a call the server is still spending money on, and then reports a timeout where
    // the server would have reported what actually happened.
    hangingFetch();
    let settled = false;
    const pending = requestCensus(req, undefined, { timeoutMs: 30_000 }).then((r) => {
      settled = true;
      return r;
    });
    await jest.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(10_000);
    expect(await pending).toEqual({ ok: false, failure: 'timeout' });
  });
});

describe('lastRecognitionEndpoint', () => {
  beforeEach(() => {
    resetRecognitionEndpoint();
    process.env.EXPO_PUBLIC_KART_API_URL = 'https://kart.test';
  });

  it('is the address the last request went to', async () => {
    mockFetch(jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => okCensus }));
    await requestCensus(req);
    expect(lastRecognitionEndpoint()).toBe('https://kart.test');
  });

  it('still names the address after a request fails offline, so the failure can say where', async () => {
    // `resolvedBase` is deliberately forgotten on an offline result so the next call probes
    // again. That is the wrong thing to show a person: "nothing answered at null" is exactly the
    // report this exists to replace.
    mockFetch(jest.fn().mockRejectedValue(new TypeError('Network request failed')));
    await requestCensus(req);
    expect(lastRecognitionEndpoint()).toBe('https://kart.test');
  });

  it('is null when nothing is configured', async () => {
    delete process.env.EXPO_PUBLIC_KART_API_URL;
    mockFetch(jest.fn());
    await requestCensus(req);
    expect(lastRecognitionEndpoint()).toBeNull();
  });
});

describe('unmarked items keep their store SKU', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_KART_API_URL = 'https://kart.test';
  });

  it('carries catalogSku through, and tolerates a server that does not send one', async () => {
    mockFetch(jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        result: {
          marks: [],
          unmarkedItems: [
            { description: 'bag of apples', productKey: '::bag of apples', catalogSku: 'kart_granny_smith_apples', approxLocation: 'left', confidence: 0.7 },
            { description: 'loose bananas', productKey: '::loose bananas', approxLocation: 'top', confidence: 0.6 },
          ],
          inViewCounts: [],
          occlusion: { itemsLikelyHidden: false, severity: 'none', reason: '' },
        },
      }),
    }));
    const res = await requestCensus(req);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.unmarkedItems[0].catalogSku).toBe('kart_granny_smith_apples');
    // Dropping the field entirely is what an older server does, and fusion falls back to the key.
    expect(res.value.unmarkedItems[1].catalogSku).toBeNull();
  });
});

describe('requestIdentify', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_KART_API_URL = 'https://kart.test';
  });

  it('sends the box so the server can crop', async () => {
    const f = mockFetch(jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, result: { name: 'Milk', brand: null, size: '1 gal', category: 'Dairy', confidence: 0.8, stillUnclear: false } }),
    }));
    const box = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 };
    const res = await requestIdentify({ imageBase64: 'AAAA', box, hint: 'milk?' });
    expect(res.ok).toBe(true);
    const body = JSON.parse(f.mock.calls[0][1].body);
    expect(body.box).toEqual(box);
    expect(body.hint).toBe('milk?');
  });

  it('omits the box when there is not one', async () => {
    const f = mockFetch(jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, result: { name: 'Milk', brand: null, size: null, category: 'Dairy', confidence: 0.8, stillUnclear: false } }),
    }));
    await requestIdentify({ imageBase64: 'AAAA', box: null, hint: null });
    const body = JSON.parse(f.mock.calls[0][1].body);
    expect(body.box).toBeUndefined();
  });
});

/**
 * The address is inlined at build time, so it freezes the lease the laptop held when the build
 * ran. These cover the list that replaced it: the app is expected to find the service after the
 * laptop moves networks, without a native rebuild.
 */
describe('choosing between candidate addresses', () => {
  const health = (ok: boolean) => ({ ok, status: ok ? 200 : 500, json: async () => ({ ok }) });

  beforeEach(() => {
    resetRecognitionEndpoint();
    process.env.EXPO_PUBLIC_KART_API_URL = 'http://first.test:4310';
    process.env.EXPO_PUBLIC_KART_API_FALLBACKS = 'http://second.test:4310,http://third.test:4310';
  });

  afterEach(() => {
    resetRecognitionEndpoint();
    delete process.env.EXPO_PUBLIC_KART_API_FALLBACKS;
    process.env.EXPO_PUBLIC_KART_API_URL = 'https://kart.test';
  });

  it('posts to the first candidate that answers, not the first that is listed', async () => {
    const f = mockFetch(
      jest.fn(async (url: string, init?: { method?: string }) => {
        if (init?.method !== 'POST') return health(url.startsWith('http://second.test'));
        return { ok: true, status: 200, json: async () => okCensus };
      }),
    );
    const res = await requestCensus(req);
    expect(res.ok).toBe(true);
    const posted = f.mock.calls.find((c) => c[1]?.method === 'POST');
    expect(posted?.[0]).toBe('http://second.test:4310/api/census');
  });

  it('probes once and reuses the answer, rather than paying for it on every census', async () => {
    const f = mockFetch(
      jest.fn(async (url: string, init?: { method?: string }) => {
        if (init?.method !== 'POST') return health(url.startsWith('http://third.test'));
        return { ok: true, status: 200, json: async () => okCensus };
      }),
    );
    await requestCensus(req);
    await requestCensus(req);
    expect(f.mock.calls.filter((c) => c[1]?.method !== 'POST')).toHaveLength(3);
  });

  it('rejects a 200 that is not this service, so a captive portal is not mistaken for it', async () => {
    const f = mockFetch(
      jest.fn(async (url: string, init?: { method?: string }) => {
        if (init?.method !== 'POST') {
          // The portal answers everything with a login page; only the real service sends ok.
          if (url.startsWith('http://first.test')) return { ok: true, status: 200, json: async () => ({ login: true }) };
          return health(url.startsWith('http://third.test'));
        }
        return { ok: true, status: 200, json: async () => okCensus };
      }),
    );
    await requestCensus(req);
    const posted = f.mock.calls.find((c) => c[1]?.method === 'POST');
    expect(posted?.[0]).toBe('http://third.test:4310/api/census');
  });

  it('re-probes after the chosen address stops answering, instead of failing there all session', async () => {
    let live = 'http://second.test';
    mockFetch(
      jest.fn(async (url: string, init?: { method?: string }) => {
        if (init?.method !== 'POST') return health(url.startsWith(live));
        if (!url.startsWith(live)) throw new TypeError('Network request failed');
        return { ok: true, status: 200, json: async () => okCensus };
      }),
    );

    expect((await requestCensus(req)).ok).toBe(true);

    // The laptop moves networks: the address that was answering goes away and another appears.
    live = 'http://third.test';
    expect(await requestCensus(req)).toEqual({ ok: false, failure: 'offline' });

    const recovered = await requestCensus(req);
    expect(recovered.ok).toBe(true);
  });

  it('still sends the request when no candidate answers the probe', async () => {
    const f = mockFetch(
      jest.fn(async (_url: string, init?: { method?: string }) => {
        if (init?.method !== 'POST') return health(false);
        return { ok: true, status: 200, json: async () => okCensus };
      }),
    );
    const res = await requestCensus(req);
    expect(res.ok).toBe(true);
    const posted = f.mock.calls.find((c) => c[1]?.method === 'POST');
    expect(posted?.[0]).toBe('http://first.test:4310/api/census');
  });
});

describe('unmarked items carry whether the model called them a product', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_KART_API_URL = 'https://kart.test';
  });

  it('reads isProduct, and treats an older server that omits it as true', async () => {
    mockFetch(jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        result: {
          marks: [],
          unmarkedItems: [
            { description: 'leftovers', productKey: '::leftovers', approxLocation: 'left', confidence: 0.5, isProduct: false },
            { description: 'bananas', productKey: '::bananas', approxLocation: 'top', confidence: 0.9 },
          ],
          inViewCounts: [],
          occlusion: { itemsLikelyHidden: false, severity: 'none', reason: '' },
        },
      }),
    }));
    const res = await requestCensus(req);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.unmarkedItems[0].isProduct).toBe(false);
    expect(res.value.unmarkedItems[1].isProduct).toBe(true);
  });
});

describe('unmarked items carry a box', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_KART_API_URL = 'https://kart.test';
  });

  it('reads a box, and gives null for an absent, null or malformed one', async () => {
    mockFetch(jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        result: {
          marks: [],
          unmarkedItems: [
            { description: 'a', productKey: '::a', approxLocation: '', confidence: 0.9, box: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 } },
            { description: 'b', productKey: '::b', approxLocation: '', confidence: 0.9, box: null },
            { description: 'c', productKey: '::c', approxLocation: '', confidence: 0.9 },
            { description: 'd', productKey: '::d', approxLocation: '', confidence: 0.9, box: { x: 'no', y: 0, w: 1, h: 1 } },
          ],
          inViewCounts: [],
          occlusion: { itemsLikelyHidden: false, severity: 'none', reason: '' },
        },
      }),
    }));
    const res = await requestCensus(req);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.unmarkedItems.map((u) => u.box)).toEqual([{ x: 0.1, y: 0.2, w: 0.3, h: 0.4 }, null, null, null]);
  });

  it('sends the confirming list with the census request', async () => {
    const f = mockFetch(jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => okCensus }));
    await requestCensus({ ...req, confirming: ['Priano rigatoni'] });
    const body = JSON.parse(f.mock.calls[0][1].body);
    expect(body.confirming).toEqual(['Priano rigatoni']);
  });
});

describe('requestVerify', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_KART_API_URL = 'https://kart.test';
  });

  const item = {
    id: 'a',
    imageBase64: 'Q1JPUA==',
    wide: { description: 'Rigatoni', productKey: 'priano::rigatoni', brand: 'Piano', count: 2, confidence: 0.9 },
  };
  const answer = {
    ok: true,
    result: {
      items: [{
        id: 'a',
        close: { name: 'Rigatoni', brand: 'Priano', count: 2, confidence: 0.98, legible: true, matchesHint: true },
        line: { description: 'Rigatoni', brand: 'Priano', count: 2, confidence: 0.5, sure: false, agreed: false },
      }],
    },
  };

  it('posts the crops and the wide readings to the verify route', async () => {
    const f = mockFetch(jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => answer }));
    await requestVerify({ items: [item] });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://kart.test/api/verify');
    const body = JSON.parse(init.body);
    expect(body.items).toEqual([{ id: 'a', image: 'Q1JPUA==', wide: item.wide }]);
    expect(body.brands).toBeUndefined();
  });

  it('sends the brands read in the photograph when there are any', async () => {
    const f = mockFetch(jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => answer }));
    await requestVerify({ items: [item], brands: ['Priano', 'Nutella'] });
    expect(JSON.parse(f.mock.calls[0][1].body).brands).toEqual(['Priano', 'Nutella']);
  });

  it('returns the reconciled line per item', async () => {
    mockFetch(jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => answer }));
    const res = await requestVerify({ items: [item] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.items).toHaveLength(1);
    expect(res.value.items[0].id).toBe('a');
    expect(res.value.items[0].line).toEqual({ description: 'Rigatoni', brand: 'Priano', count: 2, confidence: 0.5, sure: false, agreed: false });
  });

  it('reports malformed when an item has no line, rather than trusting half an answer', async () => {
    mockFetch(jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, result: { items: [{ id: 'a' }] } }) }));
    const res = await requestVerify({ items: [item] });
    expect(res).toEqual({ ok: false, failure: 'malformed' });
  });

  it('uses the photograph budget it is given', async () => {
    const f = mockFetch(jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => answer }));
    await requestVerify({ items: [item] }, undefined, { timeoutMs: 30_000 });
    expect(f).toHaveBeenCalled();
  });
});

/**
 * The close read, one crop at a time. On 2026-09-17 one request's close reads took 2s for some
 * crops and 7 to 10s for others, and reading the answer whole held every quick line back until the
 * slowest came in. With `onItem`, each line is handed over as it arrives.
 */
describe('requestVerify neighbours', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_KART_API_URL = 'https://kart.test';
  });

  it('sends the other products in the photograph with a crop, so one crop alone can still be painted', async () => {
    const f = mockFetch(jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, result: { items: [] } }) }));
    const neighbours = [{ box: { x: 0.5, y: 0.2, w: 0.3, h: 0.4 }, description: 'Hazelnut spread' }];
    await requestVerify({
      items: [{
        id: 'a',
        imageBase64: 'Q1JPUA==',
        box: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
        wide: { description: 'Rigatoni', productKey: 'priano::rigatoni', brand: 'Priano', count: 1, confidence: 0.9 },
        neighbours,
      }],
    });
    expect(JSON.parse(f.mock.calls[0][1].body).items[0].neighbours).toEqual(neighbours);
  });

  it('sends no neighbours field when the caller named none', async () => {
    const f = mockFetch(jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, result: { items: [] } }) }));
    await requestVerify({ items: [{ id: 'a', imageBase64: 'Q1JPUA==', wide: { description: 'Rigatoni', productKey: 'priano::rigatoni', brand: null, count: 1, confidence: 0.9 } }] });
    expect(JSON.parse(f.mock.calls[0][1].body).items[0]).not.toHaveProperty('neighbours');
  });
});

describe('requestVerify, streamed', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_KART_API_URL = 'https://kart.test';
  });

  const item = {
    id: 'a',
    imageBase64: 'Q1JPUA==',
    wide: { description: 'Rigatoni', productKey: 'priano::rigatoni', brand: 'Priano', count: 1, confidence: 0.9 },
  };
  const entry = (id: string, description = 'Rigatoni') => ({
    id,
    close: null,
    line: { description, brand: 'Priano', count: 1, confidence: 0.9, sure: true, agreed: true },
  });
  const parsedLine = (description = 'Rigatoni') => ({ description, brand: 'Priano', count: 1, confidence: 0.9, sure: true, agreed: true });

  /** A response body read through `getReader`, in exactly these byte chunks, each released by `gate`. */
  function body(chunks: Uint8Array[], gate: (Promise<void> | undefined)[] = []) {
    let i = 0;
    return {
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          async read() {
            if (gate[i]) await gate[i];
            return i < chunks.length ? { done: false, value: chunks[i++] } : { done: true, value: undefined };
          },
        }),
      },
    };
  }
  const bytes = (text: string) => new TextEncoder().encode(text);

  it('asks for the answer one crop at a time', async () => {
    const f = mockFetch(jest.fn().mockResolvedValue(body([bytes(`${JSON.stringify({ ok: true, done: true })}\n`)])));
    await requestVerify({ items: [item] }, undefined, { onItem: () => {} });
    expect(f.mock.calls[0][1].headers.accept).toBe('application/x-ndjson');
  });

  it('does not ask for a stream when nobody is listening for lines', async () => {
    const f = mockFetch(jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, result: { items: [] } }) }));
    await requestVerify({ items: [item] });
    expect(f.mock.calls[0][1].headers.accept).toBeUndefined();
  });

  it('hands over each line as it arrives, across chunks that split a line and a character', async () => {
    const text = `${JSON.stringify({ item: entry('b', '샘표 soy sauce') })}\n${JSON.stringify({ item: entry('a') })}\n${JSON.stringify({ ok: true, done: true })}\n`;
    const all = bytes(text);
    // Cut inside the first line's Korean, so a chunk ends partway through a character.
    const cut = bytes(text.slice(0, text.indexOf('표'))).length + 1;
    mockFetch(jest.fn().mockResolvedValue(body([all.slice(0, cut), all.slice(cut)])));
    const handed: { id: string; line: unknown }[] = [];
    const res = await requestVerify({ items: [item] }, undefined, { onItem: (it) => handed.push(it) });
    expect(handed).toEqual([{ id: 'b', line: parsedLine('샘표 soy sauce') }, { id: 'a', line: parsedLine() }]);
    expect(res).toEqual({ ok: true, value: { items: handed } });
  });

  it('hands over the first line before the rest of the answer has arrived', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    mockFetch(jest.fn().mockResolvedValue(body(
      [bytes(`${JSON.stringify({ item: entry('quick') })}\n`), bytes(`${JSON.stringify({ item: entry('slow') })}\n${JSON.stringify({ ok: true, done: true })}\n`)],
      [Promise.resolve(), held],
    )));
    const handed: string[] = [];
    const done = requestVerify({ items: [item] }, undefined, { onItem: (it) => handed.push(it.id) });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(handed).toEqual(['quick']);
    release();
    await done;
    expect(handed).toEqual(['quick', 'slow']);
  });

  it('keeps the lines already handed over, and reports a server failure, when the answer ends in one', async () => {
    mockFetch(jest.fn().mockResolvedValue(body([bytes(`${JSON.stringify({ item: entry('a') })}\n${JSON.stringify({ ok: false, error: 'Recognition failed' })}\n`)])));
    const handed: string[] = [];
    const res = await requestVerify({ items: [item] }, undefined, { onItem: (it) => handed.push(it.id) });
    expect(handed).toEqual(['a']);
    expect(res).toEqual({ ok: false, failure: 'server' });
  });

  it('reports malformed when the answer stops without saying it is done', async () => {
    mockFetch(jest.fn().mockResolvedValue(body([bytes(`${JSON.stringify({ item: entry('a') })}\n`)])));
    const res = await requestVerify({ items: [item] }, undefined, { onItem: () => {} });
    expect(res).toEqual({ ok: false, failure: 'malformed' });
  });

  it('works against a server that answers in one piece, handing over every line', async () => {
    const whole = { ok: true, result: { items: [entry('a')] } };
    mockFetch(jest.fn().mockResolvedValue({ ok: true, status: 200, body: null, text: async () => JSON.stringify(whole) }));
    const handed: string[] = [];
    const res = await requestVerify({ items: [item] }, undefined, { onItem: (it) => handed.push(it.id) });
    expect(handed).toEqual(['a']);
    expect(res.ok).toBe(true);
  });
});

/**
 * The census writes one product about every 0.8 seconds and the phone can cut a crop the moment
 * a product's rectangle lands (`server/eval/census-timeline.json`, clut7: first rectangle at
 * 2.9s, answer finished at 9.4s). The envelope is still the answer; the lines are the same
 * products arriving early.
 */
describe('requestCensus, streamed', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_KART_API_URL = 'https://kart.test';
  });

  const product = (description: string) => ({
    description,
    productKey: `::${description}`,
    catalogSku: null,
    approxLocation: '',
    confidence: 0.9,
    isProduct: true,
    box: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
    count: 2,
  });
  function body(chunks: Uint8Array[], gate: (Promise<void> | undefined)[] = []) {
    let i = 0;
    return {
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          async read() {
            if (gate[i]) await gate[i];
            return i < chunks.length ? { done: false, value: chunks[i++] } : { done: true, value: undefined };
          },
        }),
      },
    };
  }
  const bytes = (text: string) => new TextEncoder().encode(text);
  const envelope = `${JSON.stringify(okCensus)}\n`;

  it('asks for the answer one product at a time', async () => {
    const f = mockFetch(jest.fn().mockResolvedValue(body([bytes(envelope)])));
    await requestCensus(req, undefined, { onItem: () => {} });
    expect(f.mock.calls[0][1].headers.accept).toBe('application/x-ndjson');
  });

  it('does not ask for a stream when nobody is listening for products', async () => {
    const f = mockFetch(jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => okCensus }));
    await requestCensus(req);
    expect(f.mock.calls[0][1].headers.accept).toBeUndefined();
  });

  it('hands each product over as it arrives, then answers with the whole census', async () => {
    const text = `${JSON.stringify({ item: product('Rigatoni') })}\n${JSON.stringify({ item: product('Pesto') })}\n${envelope}`;
    mockFetch(jest.fn().mockResolvedValue(body([bytes(text)])));
    const handed: { description: string; count: number }[] = [];
    const res = await requestCensus(req, undefined, { onItem: (item) => handed.push(item) });
    expect(handed.map((h) => h.description)).toEqual(['Rigatoni', 'Pesto']);
    expect(handed[0].count).toBe(2);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.marks[0].name).toBe('Bananas');
  });

  it('hands the first product over before the rest of the answer has arrived', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    mockFetch(jest.fn().mockResolvedValue(body(
      [bytes(`${JSON.stringify({ item: product('Rigatoni') })}\n`), bytes(envelope)],
      [undefined, held],
    )));
    const handed: { description: string }[] = [];
    const done = requestCensus(req, undefined, { onItem: (item) => handed.push(item) });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(handed.map((h) => h.description)).toEqual(['Rigatoni']);
    release();
    expect((await done).ok).toBe(true);
  });

  it('reads a server that answers with one JSON envelope and no lines', async () => {
    mockFetch(jest.fn().mockResolvedValue(body([bytes(envelope)])));
    const handed: unknown[] = [];
    const res = await requestCensus(req, undefined, { onItem: (item) => handed.push(item) });
    expect(handed).toEqual([]);
    expect(res.ok).toBe(true);
  });

  it('reports the server failing partway as a failure, not as a census', async () => {
    const text = `${JSON.stringify({ item: product('Rigatoni') })}\n${JSON.stringify({ ok: false, error: 'Recognition failed' })}\n`;
    mockFetch(jest.fn().mockResolvedValue(body([bytes(text)])));
    const res = await requestCensus(req, undefined, { onItem: () => {} });
    expect(res).toEqual({ ok: false, failure: 'server' });
  });

  it('drops a product line it cannot read rather than handing over a half-parsed one', async () => {
    const text = `${JSON.stringify({ item: { description: 7 } })}\n${envelope}`;
    mockFetch(jest.fn().mockResolvedValue(body([bytes(text)])));
    const handed: unknown[] = [];
    const res = await requestCensus(req, undefined, { onItem: (item) => handed.push(item) });
    expect(handed).toEqual([]);
    expect(res.ok).toBe(true);
  });
});
