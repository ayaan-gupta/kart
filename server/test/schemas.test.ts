import { describe, expect, it } from "vitest";
import {
  censusJsonSchema,
  identifyJsonSchema,
  CensusResponse,
  IdentifyResponse,
  InViewCount,
  UnmarkedItem,
  VerifyResponse,
  PhotoResponse,
  censusFromPhoto,
  productKey,
  photoJsonSchema,
  verifyJsonSchema,
} from "../src/schemas.js";

/** OpenAI strict mode rejects any object that omits these. */
function assertStrict(node: unknown): void {
  if (typeof node !== "object" || node === null) return;
  const n = node as Record<string, any>;
  if (n.type === "object") {
    expect(n.additionalProperties).toBe(false);
    expect(Object.keys(n.properties ?? {}).sort()).toEqual([...(n.required ?? [])].sort());
  }
  for (const v of Object.values(n)) {
    if (Array.isArray(v)) v.forEach(assertStrict);
    else assertStrict(v);
  }
}

describe("census schema", () => {
  it("satisfies OpenAI strict mode at every level", () => {
    assertStrict(censusJsonSchema);
  });

  it("accepts a well-formed response", () => {
    const ok = {
      marks: [
        {
          id: 1,
          name: "Kellogg's Froot Loops, family size",
          brand: "Kellogg's",
          size: "family size",
          category: "Pantry",
          confidence: 0.92,
          needsCloserLook: false, isProduct: true, catalogSku: null,
        },
      ],
      unmarkedItems: [],
      inViewCounts: [{ productKey: "kelloggs::froot loop", count: 1 }],
      occlusion: { itemsLikelyHidden: false, severity: "none", reason: "" },
    };
    expect(() => CensusResponse.parse(ok)).not.toThrow();
  });

  it("rejects a confidence outside 0 to 1", () => {
    const bad = {
      marks: [
        {
          id: 1, name: "x", brand: null, size: null, category: "Other",
          confidence: 1.4, needsCloserLook: false, isProduct: true, catalogSku: null,
        },
      ],
      unmarkedItems: [],
      inViewCounts: [],
      occlusion: { itemsLikelyHidden: false, severity: "none", reason: "" },
    };
    expect(() => CensusResponse.parse(bad)).toThrow();
  });
});

describe("identify schema", () => {
  it("satisfies OpenAI strict mode at every level", () => {
    assertStrict(identifyJsonSchema);
  });
});

describe("productKey", () => {
  it("is stable across capitalisation and spacing", () => {
    expect(productKey("Froot  Loops", "Kellogg's")).toBe(productKey("froot loops", "kelloggs"));
  });

  it("separates brand from name", () => {
    expect(productKey("Froot Loops", "Kellogg's")).toBe("kelloggs::froot loop");
  });

  it("handles a null brand", () => {
    expect(productKey("Bananas", null)).toBe("::banana");
  });

  it("distinguishes different products", () => {
    expect(productKey("Froot Loops", "Kellogg's")).not.toBe(productKey("Corn Flakes", "Kellogg's"));
  });
});

describe("productKey accent folding", () => {
  it("folds accented characters to their base letter, not just stripping them", () => {
    expect(productKey("Café Bustelo", null)).toBe(productKey("Cafe Bustelo", null));
  });

  it("folds a tilde-accented letter the same way", () => {
    expect(productKey("Jalapeño", null)).toBe(productKey("Jalapeno", null));
  });

  it("still applies every other normalisation rule unchanged: case, apostrophes, whitespace", () => {
    expect(productKey("  Froot  Loops  ", "  Kellogg's  ")).toBe("kelloggs::froot loop");
    expect(productKey("FROOT LOOPS", "KELLOGG'S")).toBe("kelloggs::froot loop");
  });
});

/**
 * The zod schema (used to validate what comes back) and the hand-written JSON Schema (sent
 * to OpenAI to constrain what it produces) are two independent descriptions of the same
 * shape. If they drift, the service either accepts shapes the model was never told to
 * produce, or rejects valid ones. Walk both trees together and fail loudly on any mismatch
 * in field names, nesting, nullability, or leaf type.
 */
function walkAligned(zodNode: any, jsonNode: any, path: string): void {
  const t = zodNode?.def?.type;

  if (t === "nullable") {
    expect(Array.isArray(jsonNode.type), `${path} should be a nullable union in the JSON Schema`).toBe(true);
    expect(jsonNode.type, path).toContain("null");
    const rest = (jsonNode.type as string[]).filter((x) => x !== "null");
    expect(rest, `${path} should have exactly one non-null type`).toHaveLength(1);
    walkAligned(zodNode.def.innerType, { ...jsonNode, type: rest[0] }, path);
    return;
  }

  if (t === "object") {
    expect(jsonNode.type, path).toBe("object");
    expect(jsonNode.additionalProperties, path).toBe(false);
    const zodKeys = Object.keys(zodNode.shape).sort();
    const jsonKeys = Object.keys(jsonNode.properties ?? {}).sort();
    expect(jsonKeys, `${path} properties`).toEqual(zodKeys);
    expect([...(jsonNode.required ?? [])].sort(), `${path} required`).toEqual(zodKeys);
    for (const key of zodKeys) {
      walkAligned(zodNode.shape[key], jsonNode.properties[key], `${path}.${key}`);
    }
    return;
  }

  if (t === "array") {
    expect(jsonNode.type, path).toBe("array");
    walkAligned(zodNode.def.element, jsonNode.items, `${path}[]`);
    return;
  }

  if (t === "enum") {
    expect(jsonNode.type, path).toBe("string");
    expect(Array.isArray(jsonNode.enum), path).toBe(true);
    expect([...jsonNode.enum].sort()).toEqual(Object.keys(zodNode.def.entries).sort());
    return;
  }

  if (t === "string") {
    expect(jsonNode.type, path).toBe("string");
    return;
  }

  if (t === "boolean") {
    expect(jsonNode.type, path).toBe("boolean");
    return;
  }

  if (t === "number") {
    // zod v4 represents `.int()`, `.min()`, and `.max()` as separate check objects on
    // `def.checks`, each exposing its own def under `._zod.def` (some check classes also
    // mirror it on a plain `.def` getter, so fall back to that). Pull out whatever bounds
    // are actually enforced at runtime so they can be compared against the wire schema.
    const checks: any[] = zodNode.def.checks ?? [];
    let isInt = false;
    let min: number | undefined;
    let max: number | undefined;
    for (const c of checks) {
      const d = c?._zod?.def ?? c?.def;
      if (!d) continue;
      if (d.check === "number_format" && String(d.format ?? "").toLowerCase().includes("int")) {
        isInt = true;
      } else if (d.check === "greater_than" && d.inclusive) {
        min = d.value;
      } else if (d.check === "less_than" && d.inclusive) {
        max = d.value;
      }
    }

    expect(jsonNode.type, path).toBe(isInt ? "integer" : "number");

    if (isInt) {
      // Known, intentional asymmetry: OpenAI's structured-outputs docs explicitly document
      // `minimum`/`maximum` support for JSON Schema type "number" but never mention type
      // "integer" in that list (see the comment on InViewCount.count in schemas.ts), so we
      // do not claim support we have not verified against a live API. zod still enforces
      // whatever bound it declares at runtime; the JSON Schema side must stay bound-less.
      // This branch protects both directions: if the JSON Schema node ever grows a
      // minimum/maximum without that being verified, or if zod's own bound silently
      // disappears, this assertion set changes and the test breaks instead of drifting
      // silently.
      expect(jsonNode.minimum, `${path} must not declare "minimum" (see schemas.ts comment)`).toBeUndefined();
      expect(jsonNode.maximum, `${path} must not declare "maximum" (see schemas.ts comment)`).toBeUndefined();
      return;
    }

    if (min !== undefined) {
      expect(jsonNode.minimum, `${path} minimum should mirror the zod .min()`).toBe(min);
    } else {
      expect(jsonNode.minimum, `${path} has no zod lower bound, so the JSON Schema must not declare one`).toBeUndefined();
    }
    if (max !== undefined) {
      expect(jsonNode.maximum, `${path} maximum should mirror the zod .max()`).toBe(max);
    } else {
      expect(jsonNode.maximum, `${path} has no zod upper bound, so the JSON Schema must not declare one`).toBeUndefined();
    }
    return;
  }

  // A zod `.optional()` whose JSON Schema counterpart is still required, which is deliberate for
  // `census.subjectIsCart`: strict mode makes the model answer it on every call, while a response
  // from a deployment predating the field still parses instead of failing outright. The shapes
  // must still agree below the optionality, so the inner type is walked.
  if (t === "optional") {
    walkAligned((zodNode as { unwrap(): unknown }).unwrap(), jsonNode, path);
    return;
  }

  throw new Error(`walkAligned: unhandled zod node type "${t}" at ${path}`);
}

describe("zod schema and JSON Schema stay in sync", () => {
  it("census: every field, nesting level, and nullability matches", () => {
    walkAligned(CensusResponse, censusJsonSchema, "census");
  });

  it("identify: every field, nesting level, and nullability matches", () => {
    walkAligned(IdentifyResponse, identifyJsonSchema, "identify");
  });

  it("census: confidence bounds (0 to 1) are mirrored in the wire JSON Schema", () => {
    const confidenceNode = (censusJsonSchema.properties.marks.items.properties as any).confidence;
    expect(confidenceNode).toEqual({ type: "number", minimum: 0, maximum: 1 });

    const unmarkedConfidenceNode = (censusJsonSchema.properties.unmarkedItems.items.properties as any)
      .confidence;
    expect(unmarkedConfidenceNode).toEqual({ type: "number", minimum: 0, maximum: 1 });
  });

  it("identify: confidence bounds (0 to 1) are mirrored in the wire JSON Schema", () => {
    expect((identifyJsonSchema.properties as any).confidence).toEqual({
      type: "number",
      minimum: 0,
      maximum: 1,
    });
  });

  it("documents, explicitly, the one known asymmetry: InViewCount.count", () => {
    // zod enforces count >= 0 at parse time...
    expect(() => InViewCount.parse({ productKey: "x::y", count: -1 })).toThrow();
    expect(() => InViewCount.parse({ productKey: "x::y", count: 0 })).not.toThrow();

    // ...but the wire JSON Schema deliberately does not carry that floor, because OpenAI's
    // docs confirm minimum/maximum support for type "number" but not for type "integer",
    // and it cannot be verified live right now (see the comment on InViewCount.count and
    // on censusJsonSchema.inViewCounts.items.properties.count in schemas.ts).
    const countNode = (censusJsonSchema.properties.inViewCounts.items.properties as any).count;
    expect(countNode).toEqual({ type: "integer" });
  });
});

describe("unmarked items say whether they are a product", () => {
  const base = {
    marks: [],
    inViewCounts: [],
    occlusion: { itemsLikelyHidden: false, severity: "none", reason: "" },
  };
  it("carries isProduct on an unmarked item, and requires it of the model", () => {
    const ok = {
      ...base,
      unmarkedItems: [
        { description: "leftovers in a tub", productKey: "::leftovers", catalogSku: null, approxLocation: "left", confidence: 0.5, isProduct: false },
      ],
    };
    expect(CensusResponse.parse(ok).unmarkedItems[0].isProduct).toBe(false);
    const wire = censusJsonSchema.properties.unmarkedItems.items;
    expect(wire.required).toContain("isProduct");
    expect(wire.properties.isProduct).toEqual({ type: "boolean" });
  });

  it("still parses an older server's item that has no isProduct at all", () => {
    const old = {
      ...base,
      unmarkedItems: [
        { description: "bananas", productKey: "::bananas", catalogSku: null, approxLocation: "left", confidence: 0.9 },
      ],
    };
    expect(() => CensusResponse.parse(old)).not.toThrow();
  });
});

/**
 * Every unmarked item carries a box, so the app can show the shopper which item it means and the
 * server can cut a close crop of it. Nullable rather than optional: strict mode makes the model
 * answer on every item, and a product it cannot place is null rather than a guess.
 */
describe("unmarked items carry a box", () => {
  it("requires a nullable box of four 0 to 1 numbers of the model", () => {
    const props = (censusJsonSchema.properties.unmarkedItems.items.properties as any);
    expect(props.box.type).toEqual(["object", "null"]);
    expect(Object.keys(props.box.properties).sort()).toEqual(["h", "w", "x", "y"]);
    for (const k of ["x", "y", "w", "h"]) expect(props.box.properties[k]).toEqual({ type: "number", minimum: 0, maximum: 1 });
    expect(censusJsonSchema.properties.unmarkedItems.items.required).toContain("box");
  });

  it("parses an item with a box, an item with a null box, and an older item with none", () => {
    const item = { description: "Nutella", productKey: "nutella::nutella", catalogSku: null, approxLocation: "right", confidence: 0.9, isProduct: true };
    expect(UnmarkedItem.parse({ ...item, box: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 } }).box).toEqual({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 });
    expect(UnmarkedItem.parse({ ...item, box: null }).box).toBeNull();
    expect(UnmarkedItem.parse(item).box).toBeUndefined();
  });

  it("rejects a box outside the frame", () => {
    const item = { description: "Nutella", productKey: "nutella::nutella", catalogSku: null, approxLocation: "right", confidence: 0.9, isProduct: true };
    expect(() => UnmarkedItem.parse({ ...item, box: { x: 1.2, y: 0, w: 0.1, h: 0.1 } })).toThrow();
  });
});

/**
 * The close read: one crop, one product, and the question of whether it is what the wide pass
 * said it was.
 */
describe("verify schema", () => {
  it("satisfies OpenAI strict mode at every level", () => {
    assertStrict(verifyJsonSchema);
  });

  it("stays in sync with its zod schema", () => {
    walkAligned(VerifyResponse, verifyJsonSchema, "verify");
  });

  it("accepts a well-formed answer and rejects a confidence out of range", () => {
    const ok = { name: "Rigatoni", brand: "Priano", count: 2, confidence: 0.95, legible: true, matchesHint: true, catalogSku: null };
    expect(VerifyResponse.parse(ok)).toEqual(ok);
    expect(() => VerifyResponse.parse({ ...ok, confidence: 2 })).toThrow();
  });
});

/**
 * The photograph answer in the model's own terms, folded into the census shape on the server.
 */
describe("photo schema", () => {
  it("satisfies OpenAI strict mode at every level and stays in sync with its zod schema", () => {
    assertStrict(photoJsonSchema);
    walkAligned(PhotoResponse, photoJsonSchema, "photo");
  });

  it("folds into a census: the key derived from name and brand, the corners turned into a box, the count beside it", () => {
    const census = censusFromPhoto({
      subjectKind: "cart",
      items: [
        { name: "Rigatoni", brand: "Priano", count: 2, confidence: 0.9, isProduct: true, bbox_2d: [580, 240, 1000, 610] },
        { name: "Bananas", brand: null, count: 1, confidence: 0.95, isProduct: true, bbox_2d: null },
      ],
      occlusion: { severity: "some", reason: "a tin is behind the jar" },
    });
    expect(census.subjectIsCart).toBe(true);
    expect(census.marks).toEqual([]);
    expect(census.unmarkedItems[0]).toMatchObject({ description: "Rigatoni", productKey: "Priano::Rigatoni", box: { x: 0.58, y: 0.24, w: 0.42, h: 0.37 }, isProduct: true });
    expect(census.unmarkedItems[1]).toMatchObject({ description: "Bananas", productKey: "::Bananas", box: null });
    expect(census.inViewCounts).toEqual([
      { productKey: productKey("Rigatoni", "Priano"), count: 2 },
      { productKey: productKey("Bananas", null), count: 1 },
    ]);
    expect(census.occlusion).toEqual({ itemsLikelyHidden: true, severity: "some", reason: "a tin is behind the jar" });
  });

  it("sums the counts of one product listed twice, and treats a blank brand as none", () => {
    const census = censusFromPhoto({
      subjectKind: "product",
      items: [
        { name: "eggs", brand: " ", count: 3, confidence: 0.9, isProduct: true, bbox_2d: null },
        { name: "Eggs", brand: null, count: 1, confidence: 0.6, isProduct: true, bbox_2d: null },
      ],
      occlusion: { severity: "none", reason: "" },
    });
    expect(census.inViewCounts).toEqual([{ productKey: productKey("eggs", null), count: 4 }]);
    expect(census.unmarkedItems.map((u) => u.productKey)).toEqual(["::eggs", "::Eggs"]);
  });

  it("treats a brand written as the word null as none", () => {
    // Celery on clut15 came back with the brand "Null" on both passes of 2026-09-11 and was
    // shown to the shopper as a branded product, asserted.
    const census = censusFromPhoto({
      subjectKind: "product",
      items: [
        { name: "celery", brand: "Null", count: 1, confidence: 0.9, isProduct: true, bbox_2d: null },
        { name: "celery", brand: " null ", count: 1, confidence: 0.9, isProduct: true, bbox_2d: null },
      ],
      occlusion: { severity: "none", reason: "" },
    });
    expect(census.unmarkedItems.map((u) => u.productKey)).toEqual(["::celery", "::celery"]);
    expect(census.inViewCounts).toEqual([{ productKey: productKey("celery", null), count: 2 }]);
  });
});

/**
 * Two corners, which is how the model actually points at things.
 *
 * Until 2026-09-13 this asked for x, y, a width and a height as percentages, and the model
 * answered in corners often enough that `photoBox` existed to re-read them: of 939 boxes across
 * every saved clut run, 227 ran past the frame edge and 177 of those were a valid rectangle read
 * as corners. It also had a worse failure, one rectangle repeated for every product in the
 * photograph, which `server/eval/pipeline/box-arms.ts` measured away by asking in the form
 * Qwen3-VL grounds in: `bbox_2d`, two corners on a 0 to 1000 scale. Asked that way, all 109
 * products across the fifteen photographs came back with a rectangle and no two shared one.
 *
 * The reader is deliberately forgiving, because a rectangle it refuses costs the shopper a whole
 * product: the crop is never cut, nothing reads it twice, and the line is shown as unsure.
 */
describe("photo rectangles", () => {
  const photo = (bbox_2d: number[] | null) => ({
    subjectKind: "cart" as const,
    items: [{ name: "Rigatoni", brand: "Priano", count: 1, confidence: 0.9, isProduct: true, bbox_2d }],
    occlusion: { severity: "none" as const, reason: "" },
  });
  const boxOf = (b: number[] | null) => censusFromPhoto(PhotoResponse.parse(photo(b))).unmarkedItems[0].box;

  it("turns two corners into a box as a fraction of the frame", () => {
    expect(boxOf([580, 240, 1000, 610])).toEqual({ x: 0.58, y: 0.24, w: 0.42, h: 0.37 });
  });

  it("reads corners given in either order", () => {
    expect(boxOf([1000, 610, 580, 240])).toEqual({ x: 0.58, y: 0.24, w: 0.42, h: 0.37 });
  });

  it("trims a rectangle that runs past the frame rather than dropping it", () => {
    expect(boxOf([900, 900, 1200, 1400])).toEqual({ x: 0.9, y: 0.9, w: 0.1, h: 0.1 });
  });

  it("keeps a rectangle flush against the far edge", () => {
    expect(boxOf([600, 500, 1000, 1000])).toEqual({ x: 0.6, y: 0.5, w: 0.4, h: 0.5 });
  });

  it("drops a rectangle with no area", () => {
    expect(boxOf([500, 500, 500, 800])).toBeNull();
    expect(boxOf([500, 500, 800, 500])).toBeNull();
  });

  it("drops a rectangle wholly outside the frame", () => {
    expect(boxOf([1100, 200, 1400, 600])).toBeNull();
  });

  it("drops a rectangle that is not four numbers", () => {
    expect(boxOf([500, 500])).toBeNull();
    expect(boxOf([])).toBeNull();
    expect(boxOf(null)).toBeNull();
  });

  it("keeps the first four when the model writes more", () => {
    expect(boxOf([580, 240, 1000, 610, 0])).toEqual({ x: 0.58, y: 0.24, w: 0.42, h: 0.37 });
  });
});
