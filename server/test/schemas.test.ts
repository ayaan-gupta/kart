import { describe, expect, it } from "vitest";
import {
  censusJsonSchema,
  identifyJsonSchema,
  CensusResponse,
  IdentifyResponse,
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
    const isInt = (zodNode.def.checks ?? []).some((c: any) =>
      String(c?.def?.format ?? "").toLowerCase().includes("int"),
    );
    expect(jsonNode.type, path).toBe(isInt ? "integer" : "number");
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
});
