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

/** A rectangle in the frame the model was shown: fractions of width and height, origin top left. */
export const NormalizedBox = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0).max(1),
  h: z.number().min(0).max(1),
});
export type NormalizedBox = z.infer<typeof NormalizedBox>;

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
  /**
   * Whether this is something a supermarket sells, the same question rule 8 asks of a badge.
   *
   * A tester photographed a table and the bag said "assorted chocolates". The model had been
   * asked to list products and had nothing to list, and nothing in the answer let it say that
   * what it saw was not a product. Required of the model in `censusJsonSchema`; optional here so
   * an older server's answer, which never carried it, still parses and reads as true.
   */
  isProduct: z.boolean().optional(),
  /**
   * Where the product is: the smallest rectangle enclosing every visible unit of it, normalized
   * to the frame the model was shown, origin top left, 0 to 1.
   *
   * Two things need it. The app shows the shopper their own photograph with each item outlined,
   * green when it is sure and amber when it is not, so "not sure about this one" points at a
   * thing rather than at a name. And the server cuts the box out for the close read, which is
   * what turns a wide guess at a stylised logo into a reading of it. Nullable rather than
   * optional in the wire schema: strict mode makes the model answer for every item, and a product
   * it cannot place is null, never a guess. Optional here so an older answer still parses.
   */
  box: NormalizedBox.nullable().optional(),
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
  /**
   * Whether one shopping cart's interior is the subject of the photograph.
   *
   * Optional here and required in `censusJsonSchema`, deliberately: strict mode makes the model
   * answer it on every call, while a response from an older deployment that predates the field
   * still parses rather than failing outright. Read it as `!== false` so absent means cart, which
   * is what every caller before this field assumed.
   */
  subjectIsCart: z.boolean().optional(),
  /**
   * What the camera is pointed at, which decides whether this census may reach the bag.
   *
   * `subjectIsCart` could not carry this question. It has two values and there are three cases:
   * the shopper's own trolley, a shop's shelves, and a shopper holding one product up to the
   * camera. The first and third must both reach the bag and the second must never reach it, so a
   * boolean that means "cart" has to answer false for the third and empty a bag the shopper was
   * deliberately filling. See `server/eval/pipeline/scene-gate.ts`, which scores all three.
   *
   * Optional here and required in `censusJsonSchema`, for the same reason `subjectIsCart` is:
   * strict mode makes the model answer on every call, while a response from an older deployment,
   * or from `localvlm/serve.py`, which does not answer this at all, still parses. Absent falls
   * back to `subjectIsCart`, which preserves exactly the old behaviour.
   */
  subjectKind: z.enum(["cart", "product", "shelf"]).optional(),
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
 * The close read of one product, from a crop cut at the box the wide pass gave.
 *
 * `matchesHint` is the question that makes two readings comparable without matching free text:
 * the crop is shown with the wide pass's own description, and the model says whether that is
 * what the crop holds. `count` is how many units are in the crop, which is the wide count read a
 * second way. `legible` is whether the packaging text could actually be read, so that a
 * confident guess at an unreadable label cannot be reported as a reading.
 */
export const VerifyResponse = z.object({
  name: z.string(),
  brand: z.string().nullable(),
  count: z.number().int().min(0),
  confidence: z.number().min(0).max(1),
  legible: z.boolean(),
  matchesHint: z.boolean(),
});
export type VerifyResponse = z.infer<typeof VerifyResponse>;

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
/**
 * Folds an English plural, so "red apple" and "red apples" are one product.
 *
 * A scan asks the model the same question about the same trolley four times and gets the number
 * chosen freshly each time: on the nine-second video "red apples" arrived at five seconds and
 * "red apple" at seven, and the bag held both. That is not a model quirk to tune around, it is
 * what free text does.
 *
 * The key is opaque and only ever compared with another key, so a fold that mangles a word costs
 * nothing as long as it is deterministic. "asparagus" becomes "asparagu" on both sides and still
 * meets itself. What it must not do is bring two different products together, which is why the
 * only thing it does is remove a plural.
 */
function foldPlural(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && /(?:ss|sh|ch|x)es$/.test(word)) return word.slice(0, -2);
  if (word.length > 2 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

/**
 * Stable key for one product across calls.
 *
 * Duplicated from `src/engine/liveVision/fusion.ts`, because the client cannot import from this
 * package and both sides compute this key. If the two ever disagree the in-view clamp stops
 * matching and duplicate items come back into the bag, silently: nothing throws, the numbers just
 * get worse.
 *
 * What must match is the behaviour, not the text. The two packages format differently, double
 * quotes here and single there, so a character diff always reports a difference; the contract is
 * pinned by the `productKey` cases in `src/engine/liveVision/__tests__/fusion.test.ts`. **Change
 * this and you must change the copy there, and those tests are what catch you if you do not.**
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
  // The name only. A brand is a proper noun and does not arrive singular one call and plural the
  // next, so folding it would mangle "Kellogg's" to "kellogg" for nothing.
  const foldName = (s: string) => norm(s).split(" ").map(foldPlural).join(" ");
  return `${brand ? norm(brand) : ""}::${foldName(name)}`;
}

// Hand-written JSON Schema rather than generated, because strict mode's requirements
// (every property required, additionalProperties false everywhere) are easier to guarantee
// and review by hand than to coax out of a converter.

export const censusJsonSchema = {
  type: "object",
  properties: {
    subjectIsCart: { type: "boolean" },
    subjectKind: { type: "string", enum: ["cart", "product", "shelf"] },
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
          isProduct: { type: "boolean" },
          box: {
            type: ["object", "null"],
            properties: {
              x: { type: "number", minimum: 0, maximum: 1 },
              y: { type: "number", minimum: 0, maximum: 1 },
              w: { type: "number", minimum: 0, maximum: 1 },
              h: { type: "number", minimum: 0, maximum: 1 },
            },
            required: ["x", "y", "w", "h"],
            additionalProperties: false,
          },
        },
        required: ["description", "productKey", "catalogSku", "approxLocation", "confidence", "isProduct", "box"],
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
  required: ["subjectIsCart", "subjectKind", "marks", "unmarkedItems", "inViewCounts", "occlusion"],
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

export const verifyJsonSchema = {
  type: "object",
  properties: {
    name: { type: "string" },
    brand: { type: ["string", "null"] },
    // No minimum, for the reason InViewCount.count gives above.
    count: { type: "integer" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    legible: { type: "boolean" },
    matchesHint: { type: "boolean" },
  },
  required: ["name", "brand", "count", "confidence", "legible", "matchesHint"],
  additionalProperties: false,
} as const;

/**
 * The photograph census, in the model's own terms.
 *
 * The badge census answers with `censusJsonSchema`, whose unmarked items carry a hand-built
 * "brand::name" key, a store SKU, a location phrase and a separate count list keyed by the same
 * hand-built key. On a photograph every product is an unmarked item, and that shape cost the
 * wide pass about 85 output tokens a product, most of it the key written twice. Sol writes
 * output at roughly eighty tokens a second, so a fourteen-product refrigerator was a fifteen
 * second answer. This shape is the same answer at about half the tokens: name and brand as
 * separate fields, the count beside them, and the box as whole percentages of the frame. The
 * server derives the key with `productKey` and folds the whole thing into a `CensusResponse`,
 * so nothing downstream knows the difference.
 */
export const PhotoItem = z.object({
  name: z.string(),
  brand: z.string().nullable(),
  count: z.number().int().min(0),
  confidence: z.number().min(0).max(1),
  isProduct: z.boolean(),
  /** Percentages of the frame's width and height, origin top left, 0 to 100. */
  box: z
    .object({
      x: z.number().min(0).max(100),
      y: z.number().min(0).max(100),
      w: z.number().min(0).max(100),
      h: z.number().min(0).max(100),
    })
    .nullable(),
});
export type PhotoItem = z.infer<typeof PhotoItem>;

export const PhotoResponse = z.object({
  subjectKind: z.enum(["cart", "product", "shelf"]),
  items: z.array(PhotoItem),
  occlusion: z.object({
    severity: z.enum(["none", "some", "many"]),
    reason: z.string(),
  }),
});
export type PhotoResponse = z.infer<typeof PhotoResponse>;

export const photoJsonSchema = {
  type: "object",
  properties: {
    subjectKind: { type: "string", enum: ["cart", "product", "shelf"] },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          brand: { type: ["string", "null"] },
          // No minimum, for the reason InViewCount.count gives above.
          count: { type: "integer" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          isProduct: { type: "boolean" },
          box: {
            type: ["object", "null"],
            properties: {
              x: { type: "number", minimum: 0, maximum: 100 },
              y: { type: "number", minimum: 0, maximum: 100 },
              w: { type: "number", minimum: 0, maximum: 100 },
              h: { type: "number", minimum: 0, maximum: 100 },
            },
            required: ["x", "y", "w", "h"],
            additionalProperties: false,
          },
        },
        required: ["name", "brand", "count", "confidence", "isProduct", "box"],
        additionalProperties: false,
      },
    },
    occlusion: {
      type: "object",
      properties: {
        severity: { type: "string", enum: ["none", "some", "many"] },
        reason: { type: "string" },
      },
      required: ["severity", "reason"],
      additionalProperties: false,
    },
  },
  required: ["subjectKind", "items", "occlusion"],
  additionalProperties: false,
} as const;

/**
 * Folds a photograph answer into the census shape every caller already reads.
 *
 * The key is derived here with `productKey`, the same function the client keys the bag with,
 * from the two fields the model wrote separately, so the hand-built key that used to drift in
 * case, accents and punctuation no longer exists. Two items that derive to one key are one
 * product listed twice, and their counts are summed exactly as `normalizeCensusResponse` sums
 * a duplicated count; the close read, which counts on its own, is what settles that.
 */
export function censusFromPhoto(photo: PhotoResponse): CensusResponse {
  const unmarkedItems: CensusResponse["unmarkedItems"] = [];
  const counts = new Map<string, number>();
  for (const item of photo.items) {
    const name = item.name.trim();
    if (name.length === 0) continue;
    const brand = item.brand !== null && item.brand.trim().length > 0 ? item.brand.trim() : null;
    const key = productKey(name, brand);
    unmarkedItems.push({
      description: name,
      productKey: `${brand ?? ""}::${name}`,
      catalogSku: null,
      approxLocation: "",
      confidence: item.confidence,
      isProduct: item.isProduct,
      box: item.box === null ? null : { x: item.box.x / 100, y: item.box.y / 100, w: item.box.w / 100, h: item.box.h / 100 },
    });
    counts.set(key, (counts.get(key) ?? 0) + Math.max(0, item.count));
  }
  return {
    subjectIsCart: photo.subjectKind === "cart",
    subjectKind: photo.subjectKind,
    marks: [],
    unmarkedItems,
    inViewCounts: [...counts].map(([productKey, count]) => ({ productKey, count })),
    occlusion: {
      itemsLikelyHidden: photo.occlusion.severity !== "none",
      severity: photo.occlusion.severity,
      reason: photo.occlusion.reason,
    },
  };
}
