import { describe, expect, it, vi, beforeEach } from "vitest";
import sharp from "sharp";

// See test/api-census.test.ts for why recognize.js is mocked outright rather than just
// openai.js: it keeps the real ./openai.js (which throws at import time without
// OPENAI_API_KEY) out of the module graph entirely.
vi.mock("../src/recognize.js", () => ({
  runIdentify: vi.fn(),
}));

const { runIdentify } = await import("../src/recognize.js");
const { default: handler } = await import("../api/identify.js");
const { REQUEST_TIMEOUT_MS } = await import("../src/http.js");

const runIdentifyMock = runIdentify as unknown as ReturnType<typeof vi.fn>;

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
  return new Request("http://localhost/api/identify", {
    method: "POST",
    headers: { "content-type": "application/json", ...extraHeaders },
    body: payload,
  });
}

let validImage: string;

beforeEach(async () => {
  runIdentifyMock.mockReset();
  validImage = await tinyJpegBase64();
});

const sampleResult = {
  name: "Froot Loops",
  brand: "Kellogg's",
  size: "family size",
  category: "cereal",
  confidence: 0.92,
  stillUnclear: false,
};

describe("POST /api/identify: method handling", () => {
  it("rejects GET with 405", async () => {
    const res = await handler(new Request("http://localhost/api/identify", { method: "GET" }));
    expect(res.status).toBe(405);
    expect(await res.json()).toEqual({ error: "Method not allowed" });
  });

  it("never calls runIdentify for a rejected method", async () => {
    await handler(new Request("http://localhost/api/identify", { method: "GET" }));
    expect(runIdentifyMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/identify: content-type and body shape", () => {
  it("rejects a missing content-type header", async () => {
    const req = new Request("http://localhost/api/identify", {
      method: "POST",
      body: JSON.stringify({ image: validImage }),
    });
    const res = await handler(req);
    expect(res.status).toBe(400);
  });

  it("rejects a body that is not JSON at all", async () => {
    const res = await handler(post("not json"));
    expect(res.status).toBe(400);
  });

  it("rejects a JSON array body", async () => {
    const res = await handler(post([1, 2]));
    expect(res.status).toBe(400);
  });

  it("rejects a null JSON body", async () => {
    const res = await handler(post(null));
    expect(res.status).toBe(400);
  });

  it("rejects an oversized declared content-length", async () => {
    const res = await handler(post({ image: validImage }, { "content-length": String(50 * 1024 * 1024) }));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/identify: image validation", () => {
  it("rejects a missing image field", async () => {
    const res = await handler(post({}));
    expect(res.status).toBe(400);
  });

  it("rejects an empty image string", async () => {
    const res = await handler(post({ image: "" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Bad request" });
  });

  it("rejects base64 that decodes to non-image bytes", async () => {
    const notAnImage = Buffer.from("plain text padded long enough to matter for this check", "utf8").toString(
      "base64",
    );
    const res = await handler(post({ image: notAnImage }));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/identify: hint handling", () => {
  it("passes null when hint is omitted", async () => {
    runIdentifyMock.mockResolvedValueOnce(sampleResult);
    await handler(post({ image: validImage }));
    expect(runIdentifyMock).toHaveBeenCalledWith(expect.any(Buffer), null);
  });

  it("passes null when hint is an empty string", async () => {
    runIdentifyMock.mockResolvedValueOnce(sampleResult);
    await handler(post({ image: validImage, hint: "" }));
    expect(runIdentifyMock).toHaveBeenCalledWith(expect.any(Buffer), null);
  });

  it("ignores a non-string hint rather than failing the request", async () => {
    runIdentifyMock.mockResolvedValueOnce(sampleResult);
    const res = await handler(post({ image: validImage, hint: 12345 }));
    expect(res.status).toBe(200);
    expect(runIdentifyMock).toHaveBeenCalledWith(expect.any(Buffer), null);
  });

  it("truncates a hint longer than 200 characters", async () => {
    runIdentifyMock.mockResolvedValueOnce(sampleResult);
    const longHint = "x".repeat(500);
    await handler(post({ image: validImage, hint: longHint }));
    const passedHint = runIdentifyMock.mock.calls[0][1] as string;
    expect(passedHint.length).toBe(200);
  });

  it("passes a short hint through unchanged", async () => {
    runIdentifyMock.mockResolvedValueOnce(sampleResult);
    await handler(post({ image: validImage, hint: "looked like cereal" }));
    expect(runIdentifyMock).toHaveBeenCalledWith(expect.any(Buffer), "looked like cereal");
  });
});

describe("POST /api/identify: success path", () => {
  it("returns 200 with ok:true and the identify result", async () => {
    runIdentifyMock.mockResolvedValueOnce(sampleResult);
    const res = await handler(post({ image: validImage, hint: "cereal" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, result: sampleResult });
  });
});

describe("POST /api/identify: upstream failure never leaks", () => {
  it("returns the generic message and 500, never the real error text", async () => {
    const secretLike = "sk-proj-should-never-leak-abcdefghijklmno";
    runIdentifyMock.mockRejectedValueOnce(new Error(`runIdentify: OpenAI request failed (401 ${secretLike})`));
    const res = await handler(post({ image: validImage }));
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain(secretLike);
    expect(text).not.toContain("sk-");
    expect(JSON.parse(text)).toEqual({ error: "Recognition failed" });
  });

  it("returns 500 without hanging when runIdentify never settles, once the timeout budget elapses", async () => {
    vi.useFakeTimers();
    try {
      runIdentifyMock.mockImplementationOnce(() => new Promise(() => {}));
      const resPromise = handler(post({ image: validImage }));
      await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 500);
      const res = await resPromise;
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "Recognition failed" });
    } finally {
      vi.useRealTimers();
    }
  });
});
