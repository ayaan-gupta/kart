import { z } from "zod";

/**
 * Note on nullability: OpenAI strict mode has no optional properties. Every field must be
 * present and listed in `required`, so anything that can be absent is a nullable union.
 * Do not switch these to `.optional()`, the API rejects the schema.
 */

export const MarkIdentification = z.object({
  id: z.number().int(),
  name: z.string(),
  brand: z.string().nullable(),
  size: z.string().nullable(),
  category: z.string(),
  confidence: z.number().min(0).max(1),
  needsCloserLook: z.boolean(),
});

export const UnmarkedItem = z.object({
  description: z.string(),
  approxLocation: z.string(),
  confidence: z.number().min(0).max(1),
});

export const InViewCount = z.object({
  productKey: z.string(),
  count: z.number().int().min(0),
});

export const Occlusion = z.object({
  itemsLikelyHidden: z.boolean(),
  severity: z.enum(["none", "some", "many"]),
  reason: z.string(),
});

export const CensusResponse = z.object({
  marks: z.array(MarkIdentification),
  unmarkedItems: z.array(UnmarkedItem),
  inViewCounts: z.array(InViewCount),
  occlusion: Occlusion,
});
export type CensusResponse = z.infer<typeof CensusResponse>;

export const IdentifyResponse = z.object({
  name: z.string(),
  brand: z.string().nullable(),
  size: z.string().nullable(),
  category: z.string(),
  confidence: z.number().min(0).max(1),
  stillUnclear: z.boolean(),
});
export type IdentifyResponse = z.infer<typeof IdentifyResponse>;

/**
 * Stable key for one product across calls.
 *
 * The model will not phrase a name identically every time ("Froot Loops" one call,
 * "Kellogg's Froot Loops" the next). Everything downstream that counts or dedupes keys on
 * this, never on the display string.
 */
export function productKey(name: string, brand: string | null): string {
  const norm = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
  return `${brand ? norm(brand) : ""}::${norm(name)}`;
}

// Hand-written JSON Schema rather than generated, because strict mode's requirements
// (every property required, additionalProperties false everywhere) are easier to guarantee
// and review by hand than to coax out of a converter.

export const censusJsonSchema = {
  type: "object",
  properties: {
    marks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "integer" },
          name: { type: "string" },
          brand: { type: ["string", "null"] },
          size: { type: ["string", "null"] },
          category: { type: "string" },
          confidence: { type: "number" },
          needsCloserLook: { type: "boolean" },
        },
        required: ["id", "name", "brand", "size", "category", "confidence", "needsCloserLook"],
        additionalProperties: false,
      },
    },
    unmarkedItems: {
      type: "array",
      items: {
        type: "object",
        properties: {
          description: { type: "string" },
          approxLocation: { type: "string" },
          confidence: { type: "number" },
        },
        required: ["description", "approxLocation", "confidence"],
        additionalProperties: false,
      },
    },
    inViewCounts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          productKey: { type: "string" },
          count: { type: "integer" },
        },
        required: ["productKey", "count"],
        additionalProperties: false,
      },
    },
    occlusion: {
      type: "object",
      properties: {
        itemsLikelyHidden: { type: "boolean" },
        severity: { type: "string", enum: ["none", "some", "many"] },
        reason: { type: "string" },
      },
      required: ["itemsLikelyHidden", "severity", "reason"],
      additionalProperties: false,
    },
  },
  required: ["marks", "unmarkedItems", "inViewCounts", "occlusion"],
  additionalProperties: false,
} as const;

export const identifyJsonSchema = {
  type: "object",
  properties: {
    name: { type: "string" },
    brand: { type: ["string", "null"] },
    size: { type: ["string", "null"] },
    category: { type: "string" },
    confidence: { type: "number" },
    stillUnclear: { type: "boolean" },
  },
  required: ["name", "brand", "size", "category", "confidence", "stillUnclear"],
  additionalProperties: false,
} as const;
