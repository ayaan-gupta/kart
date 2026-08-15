import { requestCensus, requestIdentify } from '../recognitionClient';

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
