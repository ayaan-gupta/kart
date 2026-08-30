import { requestCensus, requestIdentify, resetRecognitionEndpoint } from '../recognitionClient';

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
