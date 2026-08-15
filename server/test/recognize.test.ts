import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import sharp from "sharp";
import { APIError, APIConnectionError, APIConnectionTimeoutError } from "openai";
import type { Mark } from "../src/compositor.js";
import { censusJsonSchema, identifyJsonSchema, productKey } from "../src/schemas.js";
import { CENSUS_SYSTEM_PROMPT, IDENTIFY_SYSTEM_PROMPT, censusUserText } from "../src/prompts.js";
import type { CensusDiagnostics } from "../src/recognize.js";

// The real ./openai.ts throws at import time when OPENAI_API_KEY is unset (by design, so a
// misconfigured deployment fails loudly). Tests never set that variable, and never should
// have to, so the module is replaced outright: a vi.fn() standing in for responses.create,
// and the same MODELS values ./openai.ts exports (given verbatim by the task brief, not
// derived from the real module, so this mock cannot silently drift from it undetected since
// every test below also asserts the model id actually sent matches these constants).
vi.mock("../src/openai.js", () => ({
  openai: { responses: { create: vi.fn() } },
  MODELS: { census: "gpt-5.4-mini", identify: "gpt-5.4", escalate: "gpt-5.5" },
}));

const { openai, MODELS } = await import("../src/openai.js");
const { runCensus, runIdentify, cropToBox } = await import("../src/recognize.js");

const create = openai.responses.create as unknown as ReturnType<typeof vi.fn>;

async function blankJpeg(w = 200, h = 150): Promise<Buffer> {
  return sharp({
    create: { width: w, height: h, channels: 3, background: { r: 180, g: 180, b: 180 } },
  })
    .jpeg()
    .toBuffer();
}

function mockOutput(body: unknown): void {
  create.mockResolvedValueOnce({ output_text: JSON.stringify(body) });
}

const wellFormedMark = {
  id: 1,
  name: "Froot Loops",
  brand: "Kellogg's",
  size: "family size",
  category: "cereal",
  confidence: 0.9,
  needsCloserLook: false,
};

const wellFormedOcclusion = { itemsLikelyHidden: false, severity: "none", reason: "" };

beforeEach(() => {
  create.mockReset();
});

describe("runCensus request shape", () => {
  it("sends the census model, effort none, and the strict census schema", async () => {
    mockOutput({
      marks: [wellFormedMark],
      unmarkedItems: [],
      inViewCounts: [{ productKey: "kelloggs::froot loops", count: 1 }],
      occlusion: wellFormedOcclusion,
    });

    const marks: Mark[] = [{ id: 1, box: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } }];
    await runCensus(await blankJpeg(), marks);

    expect(create).toHaveBeenCalledTimes(1);
    const params = create.mock.calls[0][0];
    expect(params.model).toBe(MODELS.census);
    expect(params.model).toBe("gpt-5.4-mini");
    expect(params.reasoning).toEqual({ effort: "none" });
    expect(params.text.format).toEqual({
      type: "json_schema",
      name: "cart_census",
      strict: true,
      schema: censusJsonSchema,
    });
  });

  it("wires in the census system prompt and the marks-derived user text", async () => {
    mockOutput({
      marks: [wellFormedMark],
      unmarkedItems: [],
      inViewCounts: [],
      occlusion: wellFormedOcclusion,
    });

    const marks: Mark[] = [
      { id: 1, box: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } },
      { id: 3, box: { x: 0.5, y: 0.5, w: 0.1, h: 0.1 } },
    ];
    await runCensus(await blankJpeg(), marks);

    const params = create.mock.calls[0][0];
    expect(params.input[0]).toEqual({ role: "system", content: CENSUS_SYSTEM_PROMPT });
    expect(params.input[1].role).toBe("user");
    expect(params.input[1].content[0]).toEqual({
      type: "input_text",
      text: censusUserText(marks),
    });
  });

  it("sends the composited frame as a base64 data URL image", async () => {
    mockOutput({
      marks: [wellFormedMark],
      unmarkedItems: [],
      inViewCounts: [],
      occlusion: wellFormedOcclusion,
    });

    await runCensus(await blankJpeg(), [{ id: 1, box: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } }]);

    const params = create.mock.calls[0][0];
    const imagePart = params.input[1].content[1];
    expect(imagePart.type).toBe("input_image");
    expect(typeof imagePart.image_url).toBe("string");
    expect(imagePart.image_url.startsWith("data:image/jpeg;base64,")).toBe(true);
    expect(imagePart.detail).toBe("auto");
  });
});

describe("runIdentify request shape", () => {
  const wellFormedIdentify = {
    name: "Froot Loops",
    brand: "Kellogg's",
    size: "family size",
    category: "cereal",
    confidence: 0.85,
    stillUnclear: false,
  };

  it("sends the identify model, effort low, and the strict identify schema", async () => {
    mockOutput(wellFormedIdentify);

    await runIdentify(await blankJpeg(), null);

    expect(create).toHaveBeenCalledTimes(1);
    const params = create.mock.calls[0][0];
    expect(params.model).toBe(MODELS.identify);
    expect(params.model).toBe("gpt-5.4");
    expect(params.reasoning).toEqual({ effort: "low" });
    expect(params.text.format).toEqual({
      type: "json_schema",
      name: "product_identification",
      strict: true,
      schema: identifyJsonSchema,
    });
  });

  it("wires in the identify system prompt", async () => {
    mockOutput(wellFormedIdentify);
    await runIdentify(await blankJpeg(), null);
    const params = create.mock.calls[0][0];
    expect(params.input[0]).toEqual({ role: "system", content: IDENTIFY_SYSTEM_PROMPT });
  });

  it("asks generically when there is no hint", async () => {
    mockOutput(wellFormedIdentify);
    await runIdentify(await blankJpeg(), null);
    const params = create.mock.calls[0][0];
    expect(params.input[1].content[0]).toEqual({
      type: "input_text",
      text: "Identify this product.",
    });
  });

  it("asks the model to confirm or correct an earlier guess when a hint is given", async () => {
    mockOutput(wellFormedIdentify);
    await runIdentify(await blankJpeg(), "boxed cereal, brand not legible");
    const params = create.mock.calls[0][0];
    expect(params.input[1].content[0]).toEqual({
      type: "input_text",
      text: 'An earlier pass guessed: "boxed cereal, brand not legible". Confirm or correct it.',
    });
  });
});

describe("valid responses parse", () => {
  it("runCensus returns a structurally correct CensusResponse", async () => {
    mockOutput({
      marks: [wellFormedMark],
      unmarkedItems: [
        { description: "loose bananas", approxLocation: "top of cart", confidence: 0.7 },
      ],
      inViewCounts: [{ productKey: "kelloggs::froot loops", count: 1 }],
      occlusion: wellFormedOcclusion,
    });

    const result = await runCensus(await blankJpeg(), [
      { id: 1, box: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } },
    ]);

    expect(result.marks).toHaveLength(1);
    expect(result.marks[0].name).toBe("Froot Loops");
    expect(result.unmarkedItems).toHaveLength(1);
    expect(result.occlusion).toEqual(wellFormedOcclusion);
  });

  it("runIdentify returns a structurally correct IdentifyResponse", async () => {
    mockOutput({
      name: "Froot Loops",
      brand: "Kellogg's",
      size: null,
      category: "cereal",
      confidence: 0.8,
      stillUnclear: false,
    });

    const result = await runIdentify(await blankJpeg(), null);
    expect(result.name).toBe("Froot Loops");
    expect(result.brand).toBe("Kellogg's");
    expect(result.stillUnclear).toBe(false);
  });
});

describe("invalid responses are rejected, not silently passed through", () => {
  it("runCensus throws on unparsable JSON", async () => {
    create.mockResolvedValueOnce({ output_text: "not json at all" });
    await expect(
      runCensus(await blankJpeg(), [{ id: 1, box: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } }]),
    ).rejects.toThrow();
  });

  it("runCensus throws when a field violates the schema (confidence out of range)", async () => {
    mockOutput({
      marks: [{ ...wellFormedMark, confidence: 1.5 }],
      unmarkedItems: [],
      inViewCounts: [],
      occlusion: wellFormedOcclusion,
    });
    await expect(
      runCensus(await blankJpeg(), [{ id: 1, box: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } }]),
    ).rejects.toThrow();
  });

  it("runCensus throws when a required field is missing", async () => {
    mockOutput({
      marks: [],
      unmarkedItems: [],
      inViewCounts: [],
      // occlusion omitted entirely
    });
    await expect(
      runCensus(await blankJpeg(), [{ id: 1, box: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } }]),
    ).rejects.toThrow();
  });

  it("runIdentify throws on unparsable JSON", async () => {
    create.mockResolvedValueOnce({ output_text: "{not valid json" });
    await expect(runIdentify(await blankJpeg(), null)).rejects.toThrow();
  });

  it("runIdentify throws when confidence is out of range", async () => {
    mockOutput({
      name: "x",
      brand: null,
      size: null,
      category: "other",
      confidence: -0.1,
      stillUnclear: false,
    });
    await expect(runIdentify(await blankJpeg(), null)).rejects.toThrow();
  });
});

describe("inViewCounts productKey is re-derived server-side, not trusted from the model", () => {
  it("leaves an already-canonical key unchanged", async () => {
    mockOutput({
      marks: [wellFormedMark],
      unmarkedItems: [],
      inViewCounts: [{ productKey: "kelloggs::froot loops", count: 2 }],
      occlusion: wellFormedOcclusion,
    });
    const result = await runCensus(await blankJpeg(), [
      { id: 1, box: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } },
    ]);
    expect(result.inViewCounts[0].productKey).toBe(productKey("Froot Loops", "Kellogg's"));
  });

  it("repairs a drifted key (case, punctuation, spacing) to match the mark's own fields", async () => {
    mockOutput({
      marks: [wellFormedMark],
      unmarkedItems: [],
      inViewCounts: [{ productKey: "Kellogg's::Froot  Loops", count: 2 }],
      occlusion: wellFormedOcclusion,
    });
    const result = await runCensus(await blankJpeg(), [
      { id: 1, box: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } },
    ]);
    expect(result.inViewCounts[0].productKey).toBe("kelloggs::froot loops");
  });

  it("repairs an accent-folding drift to match the mark's own fields", async () => {
    const mark = { ...wellFormedMark, name: "Jalapeño Chips", brand: null };
    mockOutput({
      marks: [mark],
      unmarkedItems: [],
      inViewCounts: [{ productKey: "::Jalapeno Chips", count: 1 }],
      occlusion: wellFormedOcclusion,
    });
    const result = await runCensus(await blankJpeg(), [
      { id: 1, box: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } },
    ]);
    expect(result.inViewCounts[0].productKey).toBe(productKey("Jalapeño Chips", null));
    expect(result.inViewCounts[0].productKey).toBe("::jalapeno chips");
  });

  it("keeps and warns on a key that matches no mark, instead of dropping the entry", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockOutput({
      marks: [wellFormedMark],
      unmarkedItems: [],
      inViewCounts: [
        { productKey: "kelloggs::froot loops", count: 1 },
        { productKey: "SodaStream::Flavor Pack", count: 3 },
      ],
      occlusion: wellFormedOcclusion,
    });
    const result = await runCensus(await blankJpeg(), [
      { id: 1, box: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } },
    ]);

    expect(result.inViewCounts).toHaveLength(2);
    expect(result.inViewCounts[1].productKey).toBe("sodastream::flavor pack");
    expect(warn).toHaveBeenCalledTimes(1);
    const warning = warn.mock.calls[0].join(" ");
    expect(warning).toContain("SodaStream::Flavor Pack");
    expect(warning).toContain("sodastream::flavor pack");
    warn.mockRestore();
  });

  it("treats an empty-string mark brand the same as null when deriving keys", async () => {
    const mark = { ...wellFormedMark, name: "Bananas", brand: "" };
    mockOutput({
      marks: [mark],
      unmarkedItems: [],
      inViewCounts: [{ productKey: "::Bananas", count: 1 }],
      occlusion: wellFormedOcclusion,
    });
    const result = await runCensus(await blankJpeg(), [
      { id: 1, box: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } },
    ]);
    expect(result.marks[0].brand).toBeNull();
    expect(result.inViewCounts[0].productKey).toBe("::bananas");
  });
});

describe("malformed raw productKey shapes are repaired, not naively re-derived", () => {
  it("a key with no separator is matched to the mark by name, not defaulted to no-brand", async () => {
    // Before this fix: naive re-derivation of "Froot Loops" (no "::") assumed no brand and
    // produced "::froot loops", silently discarding the real brand "Kellogg's".
    mockOutput({
      marks: [wellFormedMark],
      unmarkedItems: [],
      inViewCounts: [{ productKey: "Froot Loops", count: 1 }],
      occlusion: wellFormedOcclusion,
    });
    const result = await runCensus(await blankJpeg(), [
      { id: 1, box: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } },
    ]);
    // After: matched to the one mark whose name matches, brand included.
    expect(result.inViewCounts[0].productKey).toBe("kelloggs::froot loops");
  });

  it("a key with more than one separator preserves the word boundary instead of concatenating", async () => {
    // Before this fix: naive re-derivation stripped every "::" with no boundary, turning
    // "Kellogg's::Froot::Loops" into "kelloggs::frootloops", which never matches the mark.
    mockOutput({
      marks: [wellFormedMark],
      unmarkedItems: [],
      inViewCounts: [{ productKey: "Kellogg's::Froot::Loops", count: 1 }],
      occlusion: wellFormedOcclusion,
    });
    const result = await runCensus(await blankJpeg(), [
      { id: 1, box: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } },
    ]);
    // After: the stray "::" becomes a space, matching the mark's real canonical key.
    expect(result.inViewCounts[0].productKey).toBe("kelloggs::froot loops");
  });

  it("a no-separator key with no unambiguous name match falls back to a no-brand guess, not a false match", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const otherMark = { ...wellFormedMark, id: 2, name: "Corn Flakes" };
    mockOutput({
      marks: [wellFormedMark, otherMark],
      unmarkedItems: [],
      inViewCounts: [{ productKey: "Some Unrelated Snack", count: 1 }],
      occlusion: wellFormedOcclusion,
    });
    const result = await runCensus(await blankJpeg(), [
      { id: 1, box: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } },
      { id: 2, box: { x: 0.5, y: 0.5, w: 0.2, h: 0.2 } },
    ]);
    expect(result.inViewCounts[0].productKey).toBe("::some unrelated snack");
    warn.mockRestore();
  });
});

describe("CensusDiagnostics: distinguishing a legitimate case from a real failure", () => {
  it("classifies an already-correct or drift-corrected key as repaired", async () => {
    mockOutput({
      marks: [wellFormedMark],
      unmarkedItems: [],
      inViewCounts: [{ productKey: "Kellogg's::Froot  Loops", count: 1 }],
      occlusion: wellFormedOcclusion,
    });
    const diagnostics: CensusDiagnostics = {
      repaired: [],
      plausiblyUnmarked: [],
      unrepaired: [],
      merged: [],
    };
    await runCensus(
      await blankJpeg(),
      [{ id: 1, box: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } }],
      diagnostics,
    );
    expect(diagnostics.repaired).toEqual([
      { raw: "Kellogg's::Froot  Loops", canonical: "kelloggs::froot loops" },
    ]);
    expect(diagnostics.plausiblyUnmarked).toEqual([]);
    expect(diagnostics.unrepaired).toEqual([]);
  });

  it("classifies a key matching an unmarkedItems description as plausiblyUnmarked, and does not warn", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockOutput({
      marks: [wellFormedMark],
      // CENSUS_SYSTEM_PROMPT rule 10 asks for description to name the product "the same way
      // name would for a marked item", i.e. brand-free, matching the name segment of a
      // productKey (see productKey()'s own brand/name split in schemas.ts).
      unmarkedItems: [
        { description: "Flavor Pack", approxLocation: "top shelf", confidence: 0.6 },
      ],
      inViewCounts: [{ productKey: "SodaStream::Flavor Pack", count: 3 }],
      occlusion: wellFormedOcclusion,
    });
    const diagnostics: CensusDiagnostics = {
      repaired: [],
      plausiblyUnmarked: [],
      unrepaired: [],
      merged: [],
    };
    const result = await runCensus(
      await blankJpeg(),
      [{ id: 1, box: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } }],
      diagnostics,
    );

    expect(result.inViewCounts.find((c) => c.productKey === "sodastream::flavor pack")).toBeTruthy();
    expect(diagnostics.plausiblyUnmarked).toEqual([
      { raw: "SodaStream::Flavor Pack", canonical: "sodastream::flavor pack" },
    ]);
    expect(diagnostics.unrepaired).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("classifies a key matching nothing at all as unrepaired, and still warns", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockOutput({
      marks: [wellFormedMark],
      unmarkedItems: [],
      inViewCounts: [{ productKey: "SodaStream::Flavor Pack", count: 3 }],
      occlusion: wellFormedOcclusion,
    });
    const diagnostics: CensusDiagnostics = {
      repaired: [],
      plausiblyUnmarked: [],
      unrepaired: [],
      merged: [],
    };
    await runCensus(
      await blankJpeg(),
      [{ id: 1, box: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } }],
      diagnostics,
    );

    expect(diagnostics.unrepaired).toEqual([
      { raw: "SodaStream::Flavor Pack", canonical: "sodastream::flavor pack" },
    ]);
    expect(diagnostics.plausiblyUnmarked).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("leaves diagnostics untouched when the caller does not opt in (backward compatible)", async () => {
    mockOutput({
      marks: [wellFormedMark],
      unmarkedItems: [],
      inViewCounts: [{ productKey: "kelloggs::froot loops", count: 1 }],
      occlusion: wellFormedOcclusion,
    });
    // Two-argument call, exactly as every prior test in this file uses it.
    const result = await runCensus(await blankJpeg(), [
      { id: 1, box: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } },
    ]);
    expect(result.inViewCounts[0].productKey).toBe("kelloggs::froot loops");
  });
});

describe("duplicate inViewCounts entries that re-derive to the same key are merged", () => {
  it("sums the counts of two differently-phrased raw entries for one product into a single entry", async () => {
    mockOutput({
      marks: [wellFormedMark],
      unmarkedItems: [],
      inViewCounts: [
        { productKey: "Kellogg's::Froot Loops", count: 2 },
        { productKey: "kelloggs::froot   loops", count: 1 },
      ],
      occlusion: wellFormedOcclusion,
    });
    const diagnostics: CensusDiagnostics = {
      repaired: [],
      plausiblyUnmarked: [],
      unrepaired: [],
      merged: [],
    };
    const result = await runCensus(
      await blankJpeg(),
      [{ id: 1, box: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } }],
      diagnostics,
    );

    expect(result.inViewCounts).toHaveLength(1);
    expect(result.inViewCounts[0]).toEqual({ productKey: "kelloggs::froot loops", count: 3 });
    expect(diagnostics.merged).toEqual([
      {
        canonical: "kelloggs::froot loops",
        rawKeys: ["Kellogg's::Froot Loops", "kelloggs::froot   loops"],
        count: 3,
      },
    ]);
  });

  it("does not report a merge for a product that only had one entry", async () => {
    mockOutput({
      marks: [wellFormedMark],
      unmarkedItems: [],
      inViewCounts: [{ productKey: "kelloggs::froot loops", count: 1 }],
      occlusion: wellFormedOcclusion,
    });
    const diagnostics: CensusDiagnostics = {
      repaired: [],
      plausiblyUnmarked: [],
      unrepaired: [],
      merged: [],
    };
    await runCensus(
      await blankJpeg(),
      [{ id: 1, box: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } }],
      diagnostics,
    );
    expect(diagnostics.merged).toEqual([]);
  });
});

describe("runIdentify normalises an empty-string brand to null", () => {
  it("converts brand '' to null in the returned response", async () => {
    mockOutput({
      name: "Bananas",
      brand: "",
      size: null,
      category: "produce",
      confidence: 0.6,
      stillUnclear: false,
    });
    const result = await runIdentify(await blankJpeg(), null);
    expect(result.brand).toBeNull();
  });

  it("leaves a real brand untouched", async () => {
    mockOutput({
      name: "Froot Loops",
      brand: "Kellogg's",
      size: null,
      category: "cereal",
      confidence: 0.8,
      stillUnclear: false,
    });
    const result = await runIdentify(await blankJpeg(), null);
    expect(result.brand).toBe("Kellogg's");
  });

  it("leaves an already-null brand untouched", async () => {
    mockOutput({
      name: "a red can, brand not legible",
      brand: null,
      size: null,
      category: "other",
      confidence: 0.3,
      stillUnclear: true,
    });
    const result = await runIdentify(await blankJpeg(), null);
    expect(result.brand).toBeNull();
  });
});

describe("errors are surfaced usefully without leaking the API key", () => {
  it("never includes an OpenAI APIError's message, which can echo the key back", async () => {
    const leaky = new APIError(
      401,
      {
        message:
          "Incorrect API key provided: sk-LEAKEDSECRETVALUE1234567890abcdefgh. You can find your API key at https://platform.openai.com/account/api-keys.",
        type: "invalid_request_error",
        code: "invalid_api_key",
      },
      "Incorrect API key provided: sk-LEAKEDSECRETVALUE1234567890abcdefgh...",
      new Headers(),
    );
    create.mockRejectedValueOnce(leaky);

    let caught: unknown;
    try {
      await runCensus(await blankJpeg(), [{ id: 1, box: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } }]);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).not.toContain("sk-LEAKEDSECRETVALUE1234567890abcdefgh");
    expect(message).not.toContain("LEAKEDSECRETVALUE");
    // still useful: names the failing call and the categorical reason.
    expect(message).toContain("runCensus");
    expect(message).toContain("401");
    expect(message).toContain("invalid_api_key");
  });

  it("never reads or forwards the error's headers", async () => {
    const headers = new Headers({ "x-request-id": "req_123" });
    const err = new APIError(500, { message: "boom", type: "server_error" }, "500 boom", headers);
    create.mockRejectedValueOnce(err);

    await expect(
      runIdentify(await blankJpeg(), null),
    ).rejects.toThrow(/runIdentify.*500/);
  });

  // The two tests below used to construct a plain `new Error(...)` to stand in for a network
  // failure. The real SDK never throws a plain Error for that: fetch failures, resets, and
  // DNS errors all come back as APIConnectionError (node_modules/openai/client.mjs), so a
  // plain Error exercised a branch that never actually runs for connectivity problems. Both
  // are rewritten below to construct the real SDK error classes instead.

  it("gives a specific, distinguishable message for a connection timeout", async () => {
    create.mockRejectedValueOnce(new APIConnectionTimeoutError());
    await expect(
      runCensus(await blankJpeg(), [{ id: 1, box: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } }]),
    ).rejects.toThrow(/runCensus.*timed out/i);
  });

  it("surfaces a short, safe reason for a real connection failure, not the collapsed generic message", async () => {
    // Mirrors the shape Node's fetch actually produces: a low-level error carrying a short
    // `.code` such as "ECONNRESET", reachable via APIConnectionError's `.cause`.
    const netCause = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
    create.mockRejectedValueOnce(new APIConnectionError({ cause: netCause }));

    let caught: unknown;
    try {
      await runCensus(await blankJpeg(), [{ id: 1, box: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } }]);
    } catch (err) {
      caught = err;
    }

    const message = (caught as Error).message;
    expect(message).toContain("runCensus");
    expect(message).toContain("ECONNRESET");
    // Before this fix every connection failure collapsed to this exact byte-identical string.
    expect(message).not.toBe("runCensus: OpenAI request failed (unknown status api_error)");
  });

  it("gives a different message for a timeout than for a plain connection error", async () => {
    create.mockRejectedValueOnce(new APIConnectionTimeoutError());
    const timeoutMessage = await runIdentify(await blankJpeg(), null).catch(
      (e: Error) => e.message,
    );

    create.mockRejectedValueOnce(new APIConnectionError({ cause: new Error("boom") }));
    const connectionMessage = await runIdentify(await blankJpeg(), null).catch(
      (e: Error) => e.message,
    );

    expect(timeoutMessage).not.toBe(connectionMessage);
  });

  it("redacts a key-shaped substring even if one ends up in a connection error's cause code", async () => {
    const netCause = Object.assign(new Error("boom"), {
      code: "sk-abcdefghijklmnopqrstuvwx",
    });
    create.mockRejectedValueOnce(new APIConnectionError({ cause: netCause }));

    let caught: unknown;
    try {
      await runCensus(await blankJpeg(), [{ id: 1, box: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } }]);
    } catch (err) {
      caught = err;
    }
    expect((caught as Error).message).not.toContain("sk-abcdefghijklmnopqrstuvwx");
    expect((caught as Error).message).toContain("[redacted]");
  });

  it("still produces a safe, prefixed message for a completely unexpected thrown value", async () => {
    create.mockRejectedValueOnce("boom, not even an Error instance");
    await expect(runIdentify(await blankJpeg(), null)).rejects.toThrow(/runIdentify:.*boom/);
  });
});

async function solid(w: number, h: number): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 3, background: { r: 10, g: 20, b: 30 } } })
    .jpeg()
    .toBuffer();
}

describe("cropToBox", () => {
  it("cuts out the requested fraction of the image", async () => {
    const out = await cropToBox(await solid(1000, 800), { x: 0.25, y: 0.5, w: 0.5, h: 0.25 }, 0);
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(500);
    expect(meta.height).toBe(200);
  });

  it("pads outward so the crop carries some context", async () => {
    const out = await cropToBox(await solid(1000, 1000), { x: 0.4, y: 0.4, w: 0.2, h: 0.2 }, 0.5);
    const meta = await sharp(out).metadata();
    // 0.2 wide, padded by half its width on each side, is 0.4 of a 1000px image.
    expect(meta.width).toBe(400);
  });

  it("clamps a box that runs off the edge instead of throwing", async () => {
    // A tracked item half out of frame is normal, not an error. sharp's extract() throws on an
    // out-of-bounds region, so the clamp has to happen before it is called.
    //
    // Box x=0.9 w=0.5 spans 0.9..1.4, i.e. only 0.9..1.0 (100px of a 1000px image) is actually
    // inside the frame. Padding widens the box by 0.2 of its own (raw, pre-clamp) width, 0.1
    // fraction (100px) on each side, giving an unclamped span of 0.8..1.5; clamped to the image
    // that is 0.8..1.0, i.e. 200px. That is comfortably less than the image's full 1000px width,
    // which is what demonstrates the overhanging box was clamped rather than left to error out.
    const out = await cropToBox(await solid(1000, 1000), { x: 0.9, y: 0.9, w: 0.5, h: 0.5 }, 0.2);
    const meta = await sharp(out).metadata();
    expect(meta.width).toBeGreaterThan(0);
    expect(meta.width).toBe(200);
  });

  it("rejects a box with no area", async () => {
    await expect(cropToBox(await solid(100, 100), { x: 0.5, y: 0.5, w: 0, h: 0 }, 0)).rejects.toThrow();
  });

  it("rejects a box entirely outside the image", async () => {
    await expect(cropToBox(await solid(100, 100), { x: 3, y: 3, w: 0.1, h: 0.1 }, 0)).rejects.toThrow();
  });
});
