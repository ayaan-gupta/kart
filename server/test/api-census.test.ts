import { describe, expect, it, vi, beforeEach } from "vitest";
import sharp from "sharp";

// The real ../src/recognize.js transitively imports ../src/openai.js, which throws at import
// time when OPENAI_API_KEY is unset (by design). Mocking recognize.js outright means that
// import chain is never touched, and no network call can happen. The mock's runCensus is a
// bare vi.fn() so each test controls exactly what it resolves or rejects with.
vi.mock("../src/recognize.js", () => ({
  runCensus: vi.fn(),
}));

const { runCensus } = await import("../src/recognize.js");
const { default: handler, parseMarks } = await import("../api/census.js");
const { REQUEST_TIMEOUT_MS } = await import("../src/http.js");

const runCensusMock = runCensus as unknown as ReturnType<typeof vi.fn>;

// vi.useFakeTimers() and vi.advanceTimersByTimeAsync do not reliably service a REAL
// pending async operation (assertReasonablePixelDimensions's sharp().metadata() call,
// which resolves via a genuine libuv/thread-pool completion, not a JS timer) that is
// already in flight when fake time is advanced: confirmed by direct repro, advancing
// fake timers alone left that promise permanently unresolved and the test timed out.
// A short real-time delay, using the real setTimeout captured here before any test
// fakes it, gives that genuine async work a chance to complete on its own first.
const realSetTimeout = globalThis.setTimeout;
function realDelay(ms: number): Promise<void> {
  return new Promise((resolve) => realSetTimeout(resolve, ms));
}

async function tinyJpegBase64(): Promise<string> {
  const buf = await sharp({
    create: { width: 4, height: 4, channels: 3, background: { r: 100, g: 100, b: 100 } },
  })
    .jpeg()
    .toBuffer();
  return buf.toString("base64");
}

function post(body: unknown, extraHeaders: Record<string, string> = {}): Request {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  return new Request("http://localhost/api/census", {
    method: "POST",
    headers: { "content-type": "application/json", ...extraHeaders },
    body: payload,
  });
}

let validImage: string;

beforeEach(async () => {
  runCensusMock.mockReset();
  validImage = await tinyJpegBase64();
});

describe("POST /api/census: method handling", () => {
  it("rejects GET with 405", async () => {
    const res = await handler(new Request("http://localhost/api/census", { method: "GET" }));
    expect(res.status).toBe(405);
    expect(await res.json()).toEqual({ error: "Method not allowed" });
  });

  it("rejects PUT with 405", async () => {
    const res = await handler(new Request("http://localhost/api/census", { method: "PUT" }));
    expect(res.status).toBe(405);
  });

  it("never calls runCensus for a rejected method", async () => {
    await handler(new Request("http://localhost/api/census", { method: "DELETE" }));
    expect(runCensusMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/census: content-type and body shape", () => {
  it("rejects a missing content-type header", async () => {
    const req = new Request("http://localhost/api/census", {
      method: "POST",
      body: JSON.stringify({ image: validImage, marks: [] }),
    });
    const res = await handler(req);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Bad request" });
  });

  it("rejects a body that is not JSON at all", async () => {
    const res = await handler(post("this is not json {{{"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Bad request" });
  });

  it("rejects a JSON body that is an array, not an object", async () => {
    const res = await handler(post([1, 2, 3]));
    expect(res.status).toBe(400);
  });

  it("rejects a JSON body that is a bare string", async () => {
    const res = await handler(post(JSON.stringify("hello")));
    expect(res.status).toBe(400);
  });

  it("rejects a JSON body that is null", async () => {
    const res = await handler(post(null));
    expect(res.status).toBe(400);
  });

  it("rejects a declared content-length far larger than anything this endpoint accepts", async () => {
    const res = await handler(post({ image: validImage, marks: [] }, { "content-length": String(50 * 1024 * 1024) }));
    expect(res.status).toBe(400);
  });

  it("never calls runCensus when the body fails validation", async () => {
    await handler(post({ image: "" }));
    expect(runCensusMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/census: image validation", () => {
  it("rejects a missing image field", async () => {
    const res = await handler(post({ marks: [] }));
    expect(res.status).toBe(400);
  });

  it("rejects an empty image string", async () => {
    const res = await handler(post({ image: "" }));
    expect(res.status).toBe(400);
  });

  it("rejects a non-string image field", async () => {
    const res = await handler(post({ image: 12345 }));
    expect(res.status).toBe(400);
  });

  it("rejects base64 that decodes to something that is not an image", async () => {
    const notAnImage = Buffer.from("plain text padded out to be long enough to matter here", "utf8").toString(
      "base64",
    );
    const res = await handler(post({ image: notAnImage }));
    expect(res.status).toBe(400);
  });

  it("rejects an oversized decoded image", async () => {
    const big = Buffer.alloc(13 * 1024 * 1024, 0);
    big[0] = 0xff;
    big[1] = 0xd8;
    big[2] = 0xff;
    const res = await handler(post({ image: big.toString("base64") }));
    expect(res.status).toBe(400);
  });

  it("accepts a data: URI prefixed image", async () => {
    runCensusMock.mockResolvedValueOnce({
      marks: [],
      unmarkedItems: [],
      inViewCounts: [],
      occlusion: { itemsLikelyHidden: false, severity: "none", reason: "" },
    });
    const res = await handler(post({ image: `data:image/jpeg;base64,${validImage}`, marks: [] }));
    expect(res.status).toBe(200);
  });
});

describe("POST /api/census: marks validation", () => {
  it("defaults to an empty marks array when marks is omitted", async () => {
    runCensusMock.mockResolvedValueOnce({
      marks: [],
      unmarkedItems: [],
      inViewCounts: [],
      occlusion: { itemsLikelyHidden: false, severity: "none", reason: "" },
    });
    const res = await handler(post({ image: validImage }));
    expect(res.status).toBe(200);
    expect(runCensusMock).toHaveBeenCalledWith(expect.any(Buffer), []);
  });

  it("rejects marks that is not an array", async () => {
    const res = await handler(post({ image: validImage, marks: "nope" }));
    expect(res.status).toBe(400);
  });

  it("rejects more than 40 marks", async () => {
    const marks = Array.from({ length: 41 }, (_, i) => ({ id: i, box: { x: 0, y: 0, w: 0.1, h: 0.1 } }));
    const res = await handler(post({ image: validImage, marks }));
    expect(res.status).toBe(400);
  });

  it("does not iterate the marks array at all when it is absurdly oversized", async () => {
    // A stand-in for "tens of thousands of entries": length is checked before any per-entry
    // validation runs, so this must reject in effectively O(1) time relative to entry count.
    const marks = Array.from({ length: 50_000 }, (_, i) => ({ id: i, box: { x: 0, y: 0, w: 0.1, h: 0.1 } }));
    const start = performance.now();
    const res = await handler(post({ image: validImage, marks }));
    const elapsed = performance.now() - start;
    expect(res.status).toBe(400);
    expect(elapsed).toBeLessThan(500);
  });

  it("rejects a mark missing an id", async () => {
    const res = await handler(post({ image: validImage, marks: [{ box: { x: 0, y: 0, w: 0.1, h: 0.1 } }] }));
    expect(res.status).toBe(400);
  });

  it("rejects a mark missing a box", async () => {
    const res = await handler(post({ image: validImage, marks: [{ id: 1 }] }));
    expect(res.status).toBe(400);
  });

  it("rejects a non-integer mark id", async () => {
    const res = await handler(
      post({ image: validImage, marks: [{ id: 1.5, box: { x: 0, y: 0, w: 0.1, h: 0.1 } }] }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects duplicate mark ids", async () => {
    const marks = [
      { id: 1, box: { x: 0, y: 0, w: 0.1, h: 0.1 } },
      { id: 1, box: { x: 0.5, y: 0.5, w: 0.1, h: 0.1 } },
    ];
    const res = await handler(post({ image: validImage, marks }));
    expect(res.status).toBe(400);
  });

  it("rejects an Infinity box coordinate sent as a genuine numeric-overflow JSON literal", async () => {
    // JSON has no NaN literal, but it does allow exponent literals whose value overflows a
    // double to Infinity: JSON.parse("1e400") really does yield Infinity. Building the request
    // body as raw JSON text (not JSON.stringify of a JS object containing the JS value
    // Infinity, which JSON.stringify silently turns into the text "null") is what makes this
    // test exercise the real wire format a hostile client could actually send.
    const rawBody = '{"image":' + JSON.stringify(validImage) + ',"marks":[{"id":1,"box":{"x":1e400,"y":0,"w":0.1,"h":0.1}}]}';
    const res = await handler(post(rawBody));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Bad request" });
  });

  it(
    "parseMarks unit test (not reachable via HTTP JSON, defence in depth only): rejects a literal NaN box coordinate",
    () => {
      // No valid JSON document can ever produce a literal NaN (RFC 8259 has no NaN token, and
      // JSON.stringify(NaN) serialises to the text "null", which the earlier typeof check
      // already rejects before this code path is reached). This calls parseMarks directly with
      // a real JS NaN value to prove the Number.isFinite guard itself is correct, without
      // implying an attacker can reach it this way over HTTP.
      expect(() => parseMarks([{ id: 1, box: { x: NaN, y: 0, w: 0.1, h: 0.1 } }])).toThrow();
    },
  );

  it("rejects a negative box coordinate", async () => {
    const marks = [{ id: 1, box: { x: -0.1, y: 0, w: 0.1, h: 0.1 } }];
    const res = await handler(post({ image: validImage, marks }));
    expect(res.status).toBe(400);
  });

  it("rejects a box coordinate greater than 1", async () => {
    const marks = [{ id: 1, box: { x: 0, y: 0, w: 1.5, h: 0.1 } }];
    const res = await handler(post({ image: validImage, marks }));
    expect(res.status).toBe(400);
  });

  it("rejects a box field sent as a string instead of a number", async () => {
    const marks = [{ id: 1, box: { x: "0.1", y: 0, w: 0.1, h: 0.1 } }];
    const res = await handler(post({ image: validImage, marks }));
    expect(res.status).toBe(400);
  });

  it("accepts a well-formed marks array with a gap in ids", async () => {
    runCensusMock.mockResolvedValueOnce({
      marks: [],
      unmarkedItems: [],
      inViewCounts: [],
      occlusion: { itemsLikelyHidden: false, severity: "none", reason: "" },
    });
    const marks = [
      { id: 1, box: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } },
      { id: 4, box: { x: 0.5, y: 0.5, w: 0.2, h: 0.2 } },
    ];
    const res = await handler(post({ image: validImage, marks }));
    expect(res.status).toBe(200);
    expect(runCensusMock).toHaveBeenCalledWith(expect.any(Buffer), marks);
  });
});

describe("POST /api/census: pixel-dimension guard", () => {
  it(
    "rejects an image whose decoded pixel dimensions exceed the ceiling, before runCensus is called",
    async () => {
      // 9000 x 7000 = 63,000,000 pixels, over the 60,000,000 ceiling, while a solid-colour JPEG
      // at that quality compresses to a tiny file: proves this is the *pixel*-dimension guard
      // catching it, not the earlier 12MB compressed-byte-size check.
      const oversized = await sharp({
        create: { width: 9000, height: 7000, channels: 3, background: { r: 120, g: 120, b: 120 } },
      })
        .jpeg({ quality: 60 })
        .toBuffer();
      expect(oversized.length).toBeLessThan(12 * 1024 * 1024);

      const res = await handler(post({ image: oversized.toString("base64"), marks: [] }));

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Bad request" });
      // The point of this test: the guard must run, and reject, before the expensive
      // recognition call, not merely produce the same status code some other way.
      expect(runCensusMock).not.toHaveBeenCalled();
    },
  );

  it("accepts an image at a realistic modern phone camera resolution (48MP, 8064x6048)", async () => {
    runCensusMock.mockResolvedValueOnce({
      marks: [],
      unmarkedItems: [],
      inViewCounts: [],
      occlusion: { itemsLikelyHidden: false, severity: "none", reason: "" },
    });
    const phonePhoto = await sharp({
      create: { width: 8064, height: 6048, channels: 3, background: { r: 90, g: 90, b: 90 } },
    })
      .jpeg({ quality: 60 })
      .toBuffer();
    const res = await handler(post({ image: phonePhoto.toString("base64"), marks: [] }));
    expect(res.status).toBe(200);
    expect(runCensusMock).toHaveBeenCalled();
  });
});

describe("POST /api/census: success path", () => {
  it("returns 200 with ok:true and the census result", async () => {
    const result = {
      marks: [{ id: 1, name: "Froot Loops", brand: "Kellogg's", size: null, category: "cereal", confidence: 0.9, needsCloserLook: false, isProduct: true }],
      unmarkedItems: [],
      inViewCounts: [{ productKey: "kelloggs::froot loops", count: 1 }],
      occlusion: { itemsLikelyHidden: false, severity: "none", reason: "" },
    };
    runCensusMock.mockResolvedValueOnce(result);
    const marks = [{ id: 1, box: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } }];
    const res = await handler(post({ image: validImage, marks }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, result });
  });
});

describe("POST /api/census: upstream failure never leaks", () => {
  it("returns the generic message and 500 when runCensus rejects, never the real error text", async () => {
    const secretLike = "sk-proj-should-never-appear-in-a-response-abcdefgh";
    runCensusMock.mockRejectedValueOnce(new Error(`runCensus: OpenAI request failed (401 ${secretLike})`));
    const marks = [{ id: 1, box: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } }];
    const res = await handler(post({ image: validImage, marks }));
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain(secretLike);
    expect(text).not.toContain("sk-");
    expect(JSON.parse(text)).toEqual({ error: "Recognition failed" });
  });

  it("returns 500 without hanging when runCensus never settles, once the timeout budget elapses", async () => {
    vi.useFakeTimers();
    try {
      runCensusMock.mockImplementationOnce(() => new Promise(() => {}));
      const marks = [{ id: 1, box: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } }];
      const resPromise = handler(post({ image: validImage, marks }));
      // Let the handler's real (unmocked) assertReasonablePixelDimensions call resolve on its
      // own real-time tick before advancing fake time; see realDelay's comment above.
      await realDelay(50);
      await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 500);
      const res = await resPromise;
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "Recognition failed" });
    } finally {
      vi.useRealTimers();
    }
  });
});
