import { describe, expect, it } from "vitest";
import {
  censusJsonSchema,
  identifyJsonSchema,
  CensusResponse,
  IdentifyResponse,
  InViewCount,
  productKey,
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
          needsCloserLook: false,
        },
      ],
      unmarkedItems: [],
      inViewCounts: [{ productKey: "kelloggs::froot loops", count: 1 }],
      occlusion: { itemsLikelyHidden: false, severity: "none", reason: "" },
    };
    expect(() => CensusResponse.parse(ok)).not.toThrow();
  });

  it("rejects a confidence outside 0 to 1", () => {
    const bad = {
      marks: [
        {
          id: 1, name: "x", brand: null, size: null, category: "Other",
          confidence: 1.4, needsCloserLook: false,
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
    expect(productKey("Froot Loops", "Kellogg's")).toBe("kelloggs::froot loops");
  });

  it("handles a null brand", () => {
    expect(productKey("Bananas", null)).toBe("::bananas");
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
    expect(productKey("  Froot  Loops  ", "  Kellogg's  ")).toBe("kelloggs::froot loops");
    expect(productKey("FROOT LOOPS", "KELLOGG'S")).toBe("kelloggs::froot loops");
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
