import { describe, expect, it, vi, beforeEach } from "vitest";
import sharp from "sharp";

// See test/api-census.test.ts for why recognize.js is mocked outright: it keeps ../src/openai.js,
// which throws at import time without OPENAI_API_KEY, out of the module graph.
vi.mock("../src/recognize.js", () => ({
  runVerify: vi.fn(),
}));

const { runVerify } = await import("../src/recognize.js");
const { default: handler, MAX_VERIFY_ITEMS } = await import("../api/verify.js");

const runVerifyMock = runVerify as unknown as ReturnType<typeof vi.fn>;

async function tinyJpegBase64(): Promise<string> {
  const buf = await sharp({
    create: { width: 4, height: 4, channels: 3, background: { r: 100, g: 100, b: 100 } },
  })
    .jpeg()
    .toBuffer();
  return buf.toString("base64");
}

function post(body: unknown): Request {
  return new Request("http://localhost/api/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

let image: string;
const wide = { description: "Rigatoni", productKey: "priano::rigatoni", brand: "Priano", count: 2, confidence: 0.9 };

beforeEach(async () => {
  runVerifyMock.mockReset();
  image = await tinyJpegBase64();
});

/**
 * The close read: the phone cuts each product out of its original photograph at the box the
 * census gave, and posts the crops here with what the census said about each. The answer is one
 * reconciled line per crop.
 */
describe("POST /api/verify", () => {
  it("rejects GET with 405", async () => {
    const res = await handler(new Request("http://localhost/api/verify", { method: "GET" }));
    expect(res.status).toBe(405);
  });

  it("hands every crop and its wide reading to runVerify, and returns what it says", async () => {
    runVerifyMock.mockResolvedValueOnce([
      { id: "a", close: null, line: { description: "Rigatoni", brand: "Priano", count: 2, confidence: 0.5, sure: false, agreed: false } },
    ]);
    const res = await handler(post({ items: [{ id: "a", image, wide }] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.result.items).toHaveLength(1);
    expect(body.result.items[0].id).toBe("a");
    expect(body.result.items[0].line.sure).toBe(false);

    const handed = runVerifyMock.mock.calls[0][0];
    expect(handed).toHaveLength(1);
    expect(handed[0].id).toBe("a");
    expect(Buffer.isBuffer(handed[0].crop)).toBe(true);
    expect(handed[0].wide).toEqual(wide);
  });

  it("answers an empty list with an empty list and no model call", async () => {
    const res = await handler(post({ items: [] }));
    expect(res.status).toBe(200);
    expect((await res.json()).result.items).toEqual([]);
    expect(runVerifyMock).not.toHaveBeenCalled();
  });

  it("rejects more crops than a cart can hold", async () => {
    const items = Array.from({ length: MAX_VERIFY_ITEMS + 1 }, (_, i) => ({ id: `i${i}`, image, wide }));
    const res = await handler(post({ items }));
    expect(res.status).toBe(400);
    expect(runVerifyMock).not.toHaveBeenCalled();
  });

  it("rejects a crop that is not an image, an item with no id, and a wide reading with a bad count", async () => {
    expect((await handler(post({ items: [{ id: "a", image: "bm90IGFuIGltYWdl", wide }] }))).status).toBe(400);
    expect((await handler(post({ items: [{ image, wide }] }))).status).toBe(400);
    expect((await handler(post({ items: [{ id: "a", image, wide: { ...wide, count: -1 } }] }))).status).toBe(400);
    expect((await handler(post({ items: [{ id: "a", image, wide: { ...wide, confidence: 3 } }] }))).status).toBe(400);
    expect(runVerifyMock).not.toHaveBeenCalled();
  });

  it("treats a missing brand as null and bounds the text fields", async () => {
    runVerifyMock.mockResolvedValueOnce([]);
    const long = "x".repeat(1000);
    await handler(post({ items: [{ id: "a", image, wide: { description: long, productKey: long, count: 1, confidence: 0.5 } }] }));
    const handed = runVerifyMock.mock.calls[0][0][0].wide;
    expect(handed.brand).toBeNull();
    expect(handed.description.length).toBeLessThan(long.length);
    expect(handed.productKey.length).toBeLessThan(long.length);
  });

  it("passes the brands read elsewhere to runVerify, deduplicated and bounded, and rejects a non-list", async () => {
    runVerifyMock.mockResolvedValueOnce([]);
    await handler(post({ items: [{ id: "a", image, wide }], brands: ["Priano", "Priano", " Nutella ", 7] }));
    expect(runVerifyMock.mock.calls[0][1]).toEqual(["Priano", "Nutella"]);
    expect((await handler(post({ items: [{ id: "a", image, wide }], brands: "Priano" }))).status).toBe(400);
  });

  it("never lets an upstream error message reach the client", async () => {
    runVerifyMock.mockRejectedValueOnce(new Error("sk-secret leaked in a message"));
    const res = await handler(post({ items: [{ id: "a", image, wide }] }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Recognition failed" });
  });
});
