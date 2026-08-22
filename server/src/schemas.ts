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
  /**
   * Whether this badge is on something the shopper is buying.
   *
   * Detector proposals land on cart mesh, a bag handle, a shadow, a person's leg. Rule 8 tells
   * the model to describe those rather than drop them, which is right, and it used to name them
   * with high confidence and no way to say they are not products, so "shopping cart frame" and
   * "dark clothing/leg in background" reached the shopper's bag. This is that missing field.
   * Confidence cannot stand in for it: the model was 0.98 sure about the cart frame.
   */
  isProduct: z.boolean(),
  /**
   * Which of the catalog candidates this identification is, copied exactly, or null.
   *
   * Null covers three different situations deliberately: no catalog was consulted for this
   * region, a catalog was consulted and nothing it offered fits, or the badge is not on a
   * product at all. All three mean the same thing downstream, which is that there is no store
   * SKU to join to, and separating them would be a distinction the model cannot report
   * reliably anyway.
   */
  catalogSku: z.string().nullable(),
});

export const UnmarkedItem = z.object({
  description: z.string(),
  // The same "brand::name" key the model reports in inViewCounts, so an unmarked sighting joins
  // exactly to its count and to any badge that later lands on the same product. Deriving the key
  // from description alone cannot work: a description carries no brand, so "Froot Loops" would
  // key as "::froot loops" and never meet the badge's "kelloggs::froot loops", and the shopper
  // would get two bag lines for one box.
  productKey: z.string(),
  // The same store SKU a mark carries, when one of the offered catalog entries is what this is.
  // Without it an unmarked sighting can only key by brand and name, and a badge that carried a
  // SKU keys as "sku:kart_purple_produce_bag", so the two never meet however the model words the
  // description. Measured on a nine-second scan: three units of over-count out of ten, every one
  // of them a product the bag already held under its SKU.
  catalogSku: z.string().nullable(),
  approxLocation: z.string(),
  confidence: z.number().min(0).max(1),
});

export const InViewCount = z.object({
  productKey: z.string(),
  // zod enforces count >= 0 at parse time. This lower bound is deliberately NOT mirrored
  // in the wire JSON Schema (see censusJsonSchema.inViewCounts.items.properties.count):
  // OpenAI's structured-outputs docs explicitly document `minimum`/`maximum` support for
  // JSON Schema type "number" (https://platform.openai.com/docs/guides/structured-outputs,
  // "Supported properties" > "Supported number properties"), but "integer" appears only in
  // the plain "Supported types" list with no corresponding constraints section, so whether
  // `minimum` is honored for type "integer" under strict mode is not confirmed. Since we
  // cannot make a live API call to verify, we do not risk a schema OpenAI could reject.
  // This asymmetry (zod validates >= 0, the model is never told the floor) is intentional
  // and unresolved pending a live API check; see task-5-report.md, Fix round 1.
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
 *
 * Accents are folded to their base letter (NFD normalise, then strip combining marks)
 * before anything else, so "Café Bustelo" and "Cafe Bustelo" key identically. Without this,
 * a vision model alternating accented and unaccented spellings of the same product across
 * calls would silently produce two different keys.
 */
export function productKey(name: string, brand: string | null): string {
  const norm = (s: string) =>
    s
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, "")
      .replace(/\s+/g, " ")
      .trim();
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
          confidence: { type: "number", minimum: 0, maximum: 1 },
          needsCloserLook: { type: "boolean" },
          isProduct: { type: "boolean" },
          catalogSku: { type: ["string", "null"] },
        },
        required: ["id", "name", "brand", "size", "category", "confidence", "needsCloserLook", "isProduct", "catalogSku"],
        additionalProperties: false,
      },
    },
    unmarkedItems: {
      type: "array",
      items: {
        type: "object",
        properties: {
          description: { type: "string" },
          productKey: { type: "string" },
          catalogSku: { type: ["string", "null"] },
          approxLocation: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
        required: ["description", "productKey", "catalogSku", "approxLocation", "confidence"],
        additionalProperties: false,
      },
    },
    inViewCounts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          productKey: { type: "string" },
          // Deliberately no `minimum` here even though InViewCount.count enforces >= 0 in
          // zod. See the comment on InViewCount.count above: OpenAI's docs confirm
          // `minimum`/`maximum` for type "number" but never say whether "integer" honors
          // them under strict mode, and we cannot verify against a live API right now.
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
    confidence: { type: "number", minimum: 0, maximum: 1 },
    stillUnclear: { type: "boolean" },
  },
  required: ["name", "brand", "size", "category", "confidence", "stillUnclear"],
  additionalProperties: false,
} as const;
