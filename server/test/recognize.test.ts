import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import sharp from "sharp";
import { APIError, APIConnectionError, APIConnectionTimeoutError } from "openai";
import type { Mark } from "../src/compositor.js";
import { censusJsonSchema, identifyJsonSchema, productKey } from "../src/schemas.js";
import { CENSUS_SYSTEM_PROMPT, IDENTIFY_SYSTEM_PROMPT, PHOTO_SYSTEM_PROMPT, censusUserText } from "../src/prompts.js";
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
  needsCloserLook: false, isProduct: true, catalogSku: null,
};

const wellFormedOcclusion = { itemsLikelyHidden: false, severity: "none", reason: "" };

beforeEach(() => {
  create.mockReset();
});

/**
 * A census with no marks is a photograph, and a photograph gets a different call.
 *
 * Measured on the fifteen clut photographs on 2026-09-05, one pass each, same labels, same
 * scorer: gpt-5.6-luna reads 80% of brands and misreads PRIANO as Piano, Primo or Rummo on
 * every pass; gpt-5.6-sol reads 94% at reasoning medium and 85% at low, and reads PRIANO.
 * Terra sits with Luna on brands. The prompt made no difference on any tier. So the photo
 * path runs Sol, under the short photo prompt, at the effort the sweep chose, on the image the
 * phone sent rather than a 1536 composite of it.
 */
describe("runCensus on a photograph (no marks)", () => {
  it("uses the photo model, the photo prompt, and a high-detail image", async () => {
    mockOutput({ marks: [], unmarkedItems: [], inViewCounts: [], occlusion: wellFormedOcclusion });
    await runCensus(await blankJpeg(), []);

    const params = create.mock.calls[0][0];
    expect(params.model).toBe(MODELS.photo);
    expect(params.model).not.toBe(MODELS.census);
    expect(params.input[0]).toEqual({ role: "system", content: PHOTO_SYSTEM_PROMPT });
    expect(params.input[1].content[0]).toEqual({ type: "input_text", text: censusUserText([]) });
    expect(params.input[1].content[1].detail).toBe("high");
    expect(params.text.format.schema).toEqual(censusJsonSchema);
  });

  it("sends the photograph at up to 2048 on its long edge, not the census composite's 1536", async () => {
    mockOutput({ marks: [], unmarkedItems: [], inViewCounts: [], occlusion: wellFormedOcclusion });
    await runCensus(await blankJpeg(3000, 2000), []);

    const url: string = create.mock.calls[0][0].input[1].content[1].image_url;
    const sent = Buffer.from(url.split(",")[1], "base64");
    const meta = await sharp(sent).metadata();
    expect(meta.width).toBe(2048);
  });

  it("still passes the counted list through, so a second photograph reuses the bag's names", async () => {
    mockOutput({ marks: [], unmarkedItems: [], inViewCounts: [], occlusion: wellFormedOcclusion });
    await runCensus(await blankJpeg(), [], undefined, ["Nutella"]);
    const text: string = create.mock.calls[0][0].input[1].content[0].text;
    expect(text).toContain("Nutella");
  });
});

describe("runCensus request shape", () => {
  it("sends the census model, effort none, and the strict census schema", async () => {
    mockOutput({
      marks: [wellFormedMark],
      unmarkedItems: [],
      inViewCounts: [{ productKey: "kelloggs::froot loop", count: 1 }],
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

describe("occlusion cannot contradict itself", () => {
  it("derives itemsLikelyHidden from severity when the model disagrees with itself", async () => {
    // A real response came back severity "some" with itemsLikelyHidden false, which rule 16
    // forbids. Two fields carrying one fact will disagree eventually, so the consequence is
    // derived from the choice rather than trusted alongside it.
    mockOutput({
      marks: [],
      unmarkedItems: [],
      inViewCounts: [],
      occlusion: { itemsLikelyHidden: false, severity: "some", reason: "bags overlap" },
    });
    const result = await runCensus(await blankJpeg(), [
      { id: 1, box: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } },
    ]);
    expect(result.occlusion.itemsLikelyHidden).toBe(true);
    expect(result.occlusion.severity).toBe("some");
    expect(result.occlusion.reason).toBe("bags overlap");
  });

  it("leaves a clear view alone", async () => {
    mockOutput({
      marks: [],
      unmarkedItems: [],
      inViewCounts: [],
      occlusion: { itemsLikelyHidden: true, severity: "none", reason: "nothing covered" },
    });
    const result = await runCensus(await blankJpeg(), [
      { id: 1, box: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } },
    ]);
    expect(result.occlusion.itemsLikelyHidden).toBe(false);
  });
});

describe("valid responses parse", () => {
  it("runCensus returns a structurally correct CensusResponse", async () => {
    mockOutput({
      marks: [wellFormedMark],
      unmarkedItems: [
        { description: "loose bananas", productKey: "::loose banana", catalogSku: null, approxLocation: "top of cart", confidence: 0.7 },
      ],
      inViewCounts: [{ productKey: "kelloggs::froot loop", count: 1 }],
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
      inViewCounts: [{ productKey: "kelloggs::froot loop", count: 2 }],
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
    expect(result.inViewCounts[0].productKey).toBe("kelloggs::froot loop");
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
    expect(result.inViewCounts[0].productKey).toBe("::jalapeno chip");
  });

  it("does NOT bind a brandless key that keeps its separator, and warns instead", async () => {
    // Pinning a refusal, not an endorsement. A productKey is brandless two ways: "muenster cheese"
    // with no separator, which the repair below does bind, and "::muenster cheese" with an empty
    // brand, which it does not. The inconsistency looks like a plain bug and costs a real count on
    // IMG_0254, where two Muenster packs are reported as `count: 2` under "::muenster cheese"
    // against a mark keyed "lucerne::muenster cheese".
    //
    // Widening the repair to cover both was written, tested and measured, and it made the corpus
    // worse: 68.5 of 93 products over six passes against 75 over six without it. `inViewCounts` is
    // not a plain quantity here, it is also the clamp-release signal a few lines into `applyCensus`,
    // so binding a count to a mark changes which merged tracks are released to re-count. That is
    // the likely mechanism and it is not established. The sixty-eighth section of KART.md carries
    // the numbers. Do not "fix" this without re-measuring.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mark = { ...wellFormedMark, name: "Muenster Cheese", brand: "Lucerne" };
    mockOutput({
      marks: [mark],
      unmarkedItems: [],
      inViewCounts: [{ productKey: "::Muenster Cheese", count: 2 }],
      occlusion: wellFormedOcclusion,
    });
    const result = await runCensus(await blankJpeg(), [
      { id: 1, box: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } },
    ]);
    expect(result.inViewCounts[0].productKey).toBe(productKey("Muenster Cheese", null));
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("keeps and warns on a key that matches no mark, instead of dropping the entry", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockOutput({
      marks: [wellFormedMark],
      unmarkedItems: [],
      inViewCounts: [
        { productKey: "kelloggs::froot loop", count: 1 },
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
    expect(result.inViewCounts[0].productKey).toBe("::banana");
  });
});

describe("a census that means \"nothing here\" does not reach the shopper as an item", () => {
  it("drops the exact rows a real photograph produced: description \"None.\" and a ::none count", async () => {
    // Verbatim from a live census on a user photograph of two cartons whose labels were too
    // blurred to read (server/eval/corpus/kart/manifest.json, PRACTICE_0001). Rule 10 pushes the
    // model to be complete rather than to answer with an empty list, and this is what that
    // pressure produces on a picture it cannot read. Unfiltered, the shopper's bag gets an item
    // called none.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockOutput({
      marks: [],
      unmarkedItems: [
        { description: "None.", productKey: "::none.", catalogSku: null, approxLocation: "in the trolley", confidence: 0.6 },
      ],
      inViewCounts: [{ productKey: "::none", count: 1 }],
      occlusion: wellFormedOcclusion,
    });
    const result = await runCensus(await blankJpeg(), []);

    expect(result.unmarkedItems).toEqual([]);
    expect(result.inViewCounts).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("keeps a real product whose name merely begins with one of those words", async () => {
    // The filter is whole-name only. "no bake cheesecake" starts with "no" and is a product.
    mockOutput({
      marks: [],
      unmarkedItems: [
        { description: "No Bake Cheesecake", productKey: "::no bake cheesecake", catalogSku: null, approxLocation: "in the trolley", confidence: 0.6 },
      ],
      inViewCounts: [{ productKey: "::No Bake Cheesecake", count: 1 }],
      occlusion: wellFormedOcclusion,
    });
    const result = await runCensus(await blankJpeg(), []);

    expect(result.unmarkedItems).toHaveLength(1);
    expect(result.inViewCounts).toEqual([{ productKey: "::no bake cheesecake", count: 1 }]);
  });
});

describe("malformed raw productKey shapes are repaired, not naively re-derived", () => {
  it("a key with no separator is matched to the mark by name, not defaulted to no-brand", async () => {
    // Before this fix: naive re-derivation of "Froot Loops" (no "::") assumed no brand and
    // produced "::froot loop", silently discarding the real brand "Kellogg's".
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
    expect(result.inViewCounts[0].productKey).toBe("kelloggs::froot loop");
  });

  it("a key with more than one separator preserves the word boundary instead of concatenating", async () => {
    // Before this fix: naive re-derivation stripped every "::" with no boundary, turning
    // "Kellogg's::Froot::Loops" into "kelloggs::frootloop", which never matches the mark.
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
    expect(result.inViewCounts[0].productKey).toBe("kelloggs::froot loop");
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
      { raw: "Kellogg's::Froot  Loops", canonical: "kelloggs::froot loop" },
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
        { description: "Flavor Pack", productKey: "::flavor pack", catalogSku: null, approxLocation: "top shelf", confidence: 0.6 },
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

  it("matches an unmarkedItems key whose plural the fold removes, rather than reporting it unresolvable", async () => {
    // productKey folds English plurals, so "hummus" keys as "hummu". unmarkedItems[].productKey
    // used to be compared exactly as the model wrote it, unfolded, while the inViewCounts key it
    // had to meet was re-derived and therefore folded. Two halves of one response that agreed
    // about the product could not match: the count was logged as matching nothing and landed in
    // `unrepaired`. The description here deliberately does not name the product the same way, so
    // the productKey path is the only thing that can produce the match.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockOutput({
      marks: [wellFormedMark],
      unmarkedItems: [
        { description: "tubs on the lower rack", productKey: "::pita pal hummus", catalogSku: null, approxLocation: "lower rack", confidence: 0.6 },
      ],
      inViewCounts: [{ productKey: "::Pita Pal Hummus", count: 2 }],
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

    expect(diagnostics.plausiblyUnmarked).toEqual([
      { raw: "::Pita Pal Hummus", canonical: "::pita pal hummu" },
    ]);
    expect(diagnostics.unrepaired).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("leaves diagnostics untouched when the caller does not opt in (backward compatible)", async () => {
    mockOutput({
      marks: [wellFormedMark],
      unmarkedItems: [],
      inViewCounts: [{ productKey: "kelloggs::froot loop", count: 1 }],
      occlusion: wellFormedOcclusion,
    });
    // Two-argument call, exactly as every prior test in this file uses it.
    const result = await runCensus(await blankJpeg(), [
      { id: 1, box: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } },
    ]);
    expect(result.inViewCounts[0].productKey).toBe("kelloggs::froot loop");
  });
});

describe("duplicate inViewCounts entries that re-derive to the same key are merged", () => {
  it("sums the counts of two differently-phrased raw entries for one product into a single entry", async () => {
    mockOutput({
      marks: [wellFormedMark],
      unmarkedItems: [],
      inViewCounts: [
        { productKey: "Kellogg's::Froot Loops", count: 2 },
        { productKey: "kelloggs::froot   loop", count: 1 },
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
    expect(result.inViewCounts[0]).toEqual({ productKey: "kelloggs::froot loop", count: 3 });
    expect(diagnostics.merged).toEqual([
      {
        canonical: "kelloggs::froot loop",
        rawKeys: ["Kellogg's::Froot Loops", "kelloggs::froot   loop"],
        count: 3,
      },
    ]);
  });

  it("does not report a merge for a product that only had one entry", async () => {
    mockOutput({
      marks: [wellFormedMark],
      unmarkedItems: [],
      inViewCounts: [{ productKey: "kelloggs::froot loop", count: 1 }],
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

describe("the eval-only env overrides are bounded", () => {
  // Both live in shipped server code and both are read once at module load, so these assert the
  // parsing rule rather than re-importing the module per case. The long edge sets an image
  // dimension: "15360" typed for "1536" would have compositeMarks build about a hundred times the
  // pixels, past the 60 megapixel ceiling http.ts enforces on incoming images. Out of range falls
  // back to the default rather than clamping, because a value that far out is a typo.
  const longEdge = (raw: string | undefined) => {
    const value = raw?.trim() ? Number(raw.trim()) : NaN;
    return Number.isFinite(value) && value >= 256 && value <= 4096 ? value : 1536;
  };
  const temperature = (raw: string | undefined) => {
    if (!raw?.trim()) return undefined;
    const value = Number(raw.trim());
    return Number.isFinite(value) && value >= 0 && value <= 2 ? value : undefined;
  };

  it("takes the long edges the sweep actually used", () => {
    expect(longEdge("1024")).toBe(1024);
    expect(longEdge("2048")).toBe(2048);
  });

  it("falls back rather than building an enormous composite", () => {
    expect(longEdge("15360")).toBe(1536);
    expect(longEdge("0")).toBe(1536);
    expect(longEdge("-2048")).toBe(1536);
    expect(longEdge("banana")).toBe(1536);
    expect(longEdge(undefined)).toBe(1536);
  });

  it("takes a temperature the API accepts and refuses one it does not", () => {
    expect(temperature("0")).toBe(0);
    expect(temperature("2")).toBe(2);
    expect(temperature("50")).toBeUndefined();
    expect(temperature("-1")).toBeUndefined();
    expect(temperature(undefined)).toBeUndefined();
  });
});

describe("a photograph that is not a cart cannot fill a bag", () => {
  // Measured on the four shelf photographs in the kart corpus: the census called 102 of 102 badges
  // products and refused none, which would have put up to 41 items a shopper is not buying into
  // their bag. Rule 13 forbids it per badge and the model ignores that; asked once about the whole
  // photograph it is right 10 times out of 10. This pins the gate, not the model.
  const shelf = (subjectIsCart: boolean | undefined) => ({
    ...(subjectIsCart === undefined ? {} : { subjectIsCart }),
    marks: [wellFormedMark],
    unmarkedItems: [{
      description: "cucumbers", productKey: "::cucumber", catalogSku: null,
      approxLocation: "middle shelf", confidence: 0.9,
    }],
    inViewCounts: [{ productKey: "kelloggs::froot loop", count: 1 }],
    occlusion: wellFormedOcclusion,
  });
  const marks: Mark[] = [{ id: 1, box: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } }];

  it("returns nothing countable when the subject is not a cart", async () => {
    mockOutput(shelf(false));
    const result = await runCensus(await blankJpeg(), marks);
    expect(result.marks).toEqual([]);
    expect(result.unmarkedItems).toEqual([]);
    expect(result.inViewCounts).toEqual([]);
  });

  it("keeps the occlusion report, which describes the photograph rather than the goods", async () => {
    mockOutput(shelf(false));
    const result = await runCensus(await blankJpeg(), marks);
    expect(result.occlusion.severity).toBe("none");
  });

  it("passes everything through when the subject is a cart", async () => {
    mockOutput(shelf(true));
    const result = await runCensus(await blankJpeg(), marks);
    expect(result.marks).toHaveLength(1);
    expect(result.unmarkedItems).toHaveLength(1);
  });

  it("treats an absent field as a cart, so an older deployment behaves as before", async () => {
    mockOutput(shelf(undefined));
    const result = await runCensus(await blankJpeg(), marks);
    expect(result.marks).toHaveLength(1);
  });
});

describe("a product held up to the camera fills a bag, a shop's shelf does not", () => {
  // The gate above was a boolean and could not tell those two apart: both answer false to "is
  // this a cart", so a shopper presenting one product to the camera had their bag emptied along
  // with the shelf photographs. Measured on server/eval/corpus/kart/scene-labels.json through
  // scene-gate.ts, three runs of each of twelve photographs: the boolean scored cart 6/6,
  // shelf 4/4, product 0/2, and the three-way field scores 18/18, 12/12 and 6/6.
  const scene = (subjectKind: string | undefined, subjectIsCart: boolean) => ({
    subjectIsCart,
    ...(subjectKind === undefined ? {} : { subjectKind }),
    marks: [wellFormedMark],
    unmarkedItems: [{
      description: "shelled walnuts", productKey: "southern grove::shelled walnuts",
      catalogSku: null, approxLocation: "centre of the table", confidence: 0.97,
    }],
    inViewCounts: [{ productKey: "kelloggs::froot loop", count: 1 }],
    occlusion: wellFormedOcclusion,
  });
  const marks: Mark[] = [{ id: 1, box: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } }];

  it("keeps a product scene, even though it is not a cart", async () => {
    mockOutput(scene("product", false));
    const result = await runCensus(await blankJpeg(), marks);
    expect(result.marks).toHaveLength(1);
    expect(result.unmarkedItems).toHaveLength(1);
    expect(result.inViewCounts).toHaveLength(1);
  });

  it("keeps a cart scene", async () => {
    mockOutput(scene("cart", true));
    const result = await runCensus(await blankJpeg(), marks);
    expect(result.marks).toHaveLength(1);
  });

  it("still empties a shelf scene", async () => {
    mockOutput(scene("shelf", false));
    const result = await runCensus(await blankJpeg(), marks);
    expect(result.marks).toEqual([]);
    expect(result.unmarkedItems).toEqual([]);
    expect(result.inViewCounts).toEqual([]);
  });

  // subjectKind is what decides, so a stale or disagreeing boolean beside it must not empty a bag
  // the kind says to keep. The prompt asks for them to agree; this pins what happens when they do
  // not, rather than leaving it to the order the two are read in.
  it("lets the kind decide when the boolean disagrees with it", async () => {
    mockOutput(scene("product", false));
    const kept = await runCensus(await blankJpeg(), marks);
    expect(kept.unmarkedItems).toHaveLength(1);

    mockOutput(scene("shelf", true));
    const emptied = await runCensus(await blankJpeg(), marks);
    expect(emptied.unmarkedItems).toEqual([]);
  });
});
