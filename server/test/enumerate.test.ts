import { describe, expect, it } from "vitest";
import {
  enumerateRegions,
  enumeratorConfigured,
  marksFromRegions,
  MAX_CANDIDATES,
  MAX_REGIONS,
} from "../src/enumerate.js";

const jpeg = Buffer.from("not really a jpeg, this module never decodes it");

const square = (x: number, y: number, size = 0.1) => ({
  box: { x, y, w: size, h: size },
  polygon: [x, y, x + size, y, x + size, y + size, x, y + size],
  score: 0.9,
});

/** A fetch that records what it was called with and replies with whatever is handed in. */
function stubFetch(reply: { status?: number; body?: unknown; throws?: Error }) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: unknown, init: unknown) => {
    calls.push({ url: String(url), init: init as RequestInit });
    if (reply.throws) throw reply.throws;
    return {
      ok: (reply.status ?? 200) < 400,
      status: reply.status ?? 200,
      json: async () => reply.body,
    } as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("enumeratorConfigured", () => {
  it("is false with no endpoint, which is a supported state and not a bug", () => {
    expect(enumeratorConfigured({ endpoint: "" })).toBe(false);
  });

  it("is false for an endpoint that is only whitespace", () => {
    expect(enumeratorConfigured({ endpoint: "   " })).toBe(false);
  });

  it("is true once an endpoint is set", () => {
    expect(enumeratorConfigured({ endpoint: "https://gpu.example/enumerate" })).toBe(true);
  });
});

describe("enumerateRegions", () => {
  it("returns nothing, and says why, when no endpoint is configured", async () => {
    const result = await enumerateRegions(jpeg, { endpoint: "" });
    expect(result.regions).toEqual([]);
    expect(result.degraded).toBe("no enumerator configured");
  });

  it("posts the frame as base64 JSON to the configured endpoint", async () => {
    const { impl, calls } = stubFetch({ body: { instances: [square(0.1, 0.1)] } });
    await enumerateRegions(jpeg, { endpoint: "https://gpu.example/enumerate", fetchImpl: impl });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://gpu.example/enumerate");
    expect(calls[0].init.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init.body)).image).toBe(jpeg.toString("base64"));
  });

  it("sends a bearer token when one is set", async () => {
    const { impl, calls } = stubFetch({ body: { instances: [] } });
    await enumerateRegions(jpeg, { endpoint: "https://gpu.example/e", token: "sec", fetchImpl: impl });
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer sec");
  });

  it("sends no authorization header at all when no token is set", async () => {
    // A host that authenticates by URL alone should not be handed an empty bearer to reject.
    const { impl, calls } = stubFetch({ body: { instances: [] } });
    await enumerateRegions(jpeg, { endpoint: "https://gpu.example/e", token: "", fetchImpl: impl });
    expect((calls[0].init.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it("returns the regions it was given", async () => {
    const { impl } = stubFetch({ body: { instances: [square(0.1, 0.1), square(0.5, 0.5)] } });
    const result = await enumerateRegions(jpeg, { endpoint: "https://gpu.example/e", fetchImpl: impl });
    expect(result.regions).toHaveLength(2);
    expect(result.degraded).toBeNull();
  });

  it("keeps the highest scoring regions when handed more than the ceiling", async () => {
    const instances = Array.from({ length: MAX_REGIONS + 10 }, (_, i) => ({
      ...square(0.01 * i, 0.01 * i),
      score: i / 100,
    }));
    const { impl } = stubFetch({ body: { instances } });
    const result = await enumerateRegions(jpeg, { endpoint: "https://gpu.example/e", fetchImpl: impl });

    expect(result.regions).toHaveLength(MAX_REGIONS);
    // Sorted highest first, so the lowest kept still beats every one dropped.
    expect(result.regions[0].score).toBeGreaterThan(result.regions[MAX_REGIONS - 1].score);
    expect(result.regions[MAX_REGIONS - 1].score).toBeGreaterThanOrEqual(0.1);
  });

  it("drops a box with no area, which would badge nothing", async () => {
    const { impl } = stubFetch({
      body: { instances: [{ ...square(0.1, 0.1), box: { x: 0.1, y: 0.1, w: 0, h: 0.2 } }] },
    });
    const result = await enumerateRegions(jpeg, { endpoint: "https://gpu.example/e", fetchImpl: impl });
    expect(result.regions).toEqual([]);
  });

  it("drops a polygon with fewer than three points, which cannot enclose anything", async () => {
    const { impl } = stubFetch({
      body: { instances: [{ ...square(0.1, 0.1), polygon: [0.1, 0.1, 0.2, 0.2] }] },
    });
    const result = await enumerateRegions(jpeg, { endpoint: "https://gpu.example/e", fetchImpl: impl });
    expect(result.regions).toEqual([]);
  });

  it("drops a polygon with an odd number of coordinates", async () => {
    const { impl } = stubFetch({
      body: { instances: [{ ...square(0.1, 0.1), polygon: [0.1, 0.1, 0.2, 0.2, 0.3] }] },
    });
    const result = await enumerateRegions(jpeg, { endpoint: "https://gpu.example/e", fetchImpl: impl });
    expect(result.regions).toEqual([]);
  });

  it("keeps the good regions from a response that also contains a bad one", async () => {
    const { impl } = stubFetch({
      body: { instances: [square(0.1, 0.1), { ...square(0.5, 0.5), polygon: [0.5, 0.5] }] },
    });
    const result = await enumerateRegions(jpeg, { endpoint: "https://gpu.example/e", fetchImpl: impl });
    expect(result.regions).toHaveLength(1);
  });

  it("degrades rather than throwing when the host returns an error status", async () => {
    const { impl } = stubFetch({ status: 502, body: {} });
    const result = await enumerateRegions(jpeg, { endpoint: "https://gpu.example/e", fetchImpl: impl });
    expect(result.regions).toEqual([]);
    expect(result.degraded).toBe("enumerator returned 502");
  });

  it("degrades rather than throwing when the response does not parse", async () => {
    const { impl } = stubFetch({ body: { totally: "wrong" } });
    const result = await enumerateRegions(jpeg, { endpoint: "https://gpu.example/e", fetchImpl: impl });
    expect(result.regions).toEqual([]);
    expect(result.degraded).toBe("enumerator response did not parse");
  });

  it("degrades rather than throwing when the host is unreachable", async () => {
    const { impl } = stubFetch({ throws: new TypeError("fetch failed") });
    const result = await enumerateRegions(jpeg, { endpoint: "https://gpu.example/e", fetchImpl: impl });
    expect(result.regions).toEqual([]);
    expect(result.degraded).toBe("enumerator unreachable");
  });

  it("degrades with a distinct reason when the host is too slow", async () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    const { impl } = stubFetch({ throws: abort });
    const result = await enumerateRegions(jpeg, { endpoint: "https://gpu.example/e", fetchImpl: impl });
    expect(result.degraded).toBe("enumerator timed out");
  });

  it("never echoes the host's error body, which this service cannot vouch for", async () => {
    const { impl } = stubFetch({ status: 500, body: { error: "postgres://user:hunter2@db/x" } });
    const result = await enumerateRegions(jpeg, { endpoint: "https://gpu.example/e", fetchImpl: impl });
    expect(result.degraded).toBe("enumerator returned 500");
    expect(JSON.stringify(result)).not.toContain("hunter2");
  });
});

describe("catalog matches arriving with the regions", () => {
  const withCatalog = (sku: string | null, alternatives: string[]) => ({
    ...square(0.1, 0.1),
    catalog: {
      sku,
      confidence: 0.87,
      alternatives: alternatives.map((s, i) => ({ sku: s, score: 2 - i })),
    },
  });

  it("still parses a response with no catalog field, which is what ships today", async () => {
    const { regions, degraded } = await enumerateRegions(jpeg, {
      endpoint: "https://example.invalid/enumerate",
      fetchImpl: stubFetch({ body: { instances: [square(0.1, 0.1)] } }).impl,
    });
    expect(degraded).toBeNull();
    expect(regions).toHaveLength(1);
    expect(marksFromRegions(regions)[0].candidates).toBeUndefined();
  });

  it("numbers marks from one, positionally, so the drawn badge matches the prompt row", () => {
    const marks = marksFromRegions([square(0.1, 0.1), square(0.5, 0.5), square(0.8, 0.2)]);
    expect(marks.map((m) => m.id)).toEqual([1, 2, 3]);
  });

  it("carries the catalog shortlist across, best first, capped", () => {
    const [mark] = marksFromRegions([
      withCatalog("Froot Loops", ["Froot Loops", "Apple Jacks", "Corn Pops", "Krave", "Raisin Bran", "Special K"]),
    ]);
    expect(mark.candidates).toHaveLength(MAX_CANDIDATES);
    expect(mark.candidates?.[0]).toEqual({ sku: "Froot Loops", confidence: 0.87 });
  });

  it("gives no candidate but the matcher's own choice a confidence", () => {
    // The matcher reports one confidence, for its top choice. Repeating it on every row would
    // tell the model the fifth candidate is as likely as the first, which is the opposite of
    // what a shortlist means.
    const [mark] = marksFromRegions([withCatalog("Froot Loops", ["Froot Loops", "Apple Jacks"])]);
    expect(mark.candidates?.[1].confidence).toBe(0);
  });

  it("still offers the shortlist when the matcher declined to name anything", () => {
    // Below the floor the matcher names nothing, and that is exactly when the alternatives
    // matter most: the shopper is asked which of these it is rather than told wrongly.
    const [mark] = marksFromRegions([withCatalog(null, ["Froot Loops", "Apple Jacks"])]);
    expect(mark.candidates).toHaveLength(2);
    expect(mark.candidates?.every((c) => c.confidence === 0)).toBe(true);
  });

  it("treats an empty shortlist as no catalog rather than an empty one", () => {
    const [mark] = marksFromRegions([withCatalog(null, [])]);
    expect(mark.candidates).toBeUndefined();
  });
});
