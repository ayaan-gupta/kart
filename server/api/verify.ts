import { runVerify, type VerifyItemInput } from "../src/recognize.js";
import {
  assertJsonContentType,
  assertJsonObject,
  assertReasonableContentLength,
  assertReasonablePixelDimensions,
  decodeBase64Image,
  fail,
  json,
  withTimeout,
} from "../src/http.js";

export const config = { runtime: "nodejs" };

/**
 * The close read: one crop per product, cut by the phone from its original photograph at the box
 * the census gave, with what the census said about each. The answer is one reconciled line per
 * crop, sure or unsure. See docs/superpowers/specs/2026-09-06-photo-verification-design.md.
 */

/** A cart holds at most a few dozen distinct products; this bounds both the work and the body. */
export const MAX_VERIFY_ITEMS = 40;
const MAX_ID_CHARS = 64;
const MAX_TEXT_CHARS = 200;
/** A count above this is a malformed client, not a fuller cart. */
const MAX_COUNT = 999;
/** Brands read elsewhere in the photograph, bounded like `counted` is: it goes into a prompt. */
const MAX_BRANDS = 40;

function parseBrands(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error("brands must be an array");
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim().slice(0, MAX_TEXT_CHARS);
    if (trimmed.length > 0 && !out.includes(trimmed)) out.push(trimmed);
    if (out.length >= MAX_BRANDS) break;
  }
  return out;
}

/**
 * The box the crop was cut at, normalized to the photograph, or null.
 *
 * Optional on the wire: an older client sends no box, and then a crop holding two varieties still
 * separates but the two lines have no rectangle for the review to draw, which is the honest state
 * of a line whose position nobody told us. Out-of-range numbers are a malformed client, not a
 * fuller answer, so they are refused rather than clamped.
 */
function parseBox(value: unknown, index: number): { x: number; y: number; w: number; h: number } | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new Error(`items[${index}].box is malformed`);
  const raw = value as Record<string, unknown>;
  const side = (name: "x" | "y" | "w" | "h"): number => {
    const n = raw[name];
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 1) {
      throw new Error(`items[${index}].box.${name} must be between 0 and 1`);
    }
    return n;
  };
  return { x: side("x"), y: side("y"), w: side("w"), h: side("h") };
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${field} must be a non-empty string`);
  return value.trim().slice(0, MAX_TEXT_CHARS);
}

/**
 * The other products in the photograph, as the client knows them when it sends this crop.
 *
 * Bounded like the crops themselves and validated the same way: these boxes are painted onto an
 * image, and the description is compared with this crop's own, so neither reaches a model as
 * text. A photograph holds at most a cartful, which is what `MAX_VERIFY_ITEMS` already says.
 */
function parseNeighbours(value: unknown, index: number): { box: { x: number; y: number; w: number; h: number }; description: string }[] {
  if (!Array.isArray(value)) throw new Error(`items[${index}].neighbours must be an array`);
  return value.slice(0, MAX_VERIFY_ITEMS).map((raw, n) => {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error(`items[${index}].neighbours[${n}] is malformed`);
    }
    const neighbour = raw as Record<string, unknown>;
    const box = parseBox(neighbour.box, index);
    if (box === null) throw new Error(`items[${index}].neighbours[${n}].box is malformed`);
    return { box, description: text(neighbour.description, `items[${index}].neighbours[${n}].description`) };
  });
}

async function parseItem(raw: unknown, index: number): Promise<VerifyItemInput> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`items[${index}] is malformed`);
  const item = raw as Record<string, unknown>;
  if (typeof item.id !== "string" || item.id.length === 0 || item.id.length > MAX_ID_CHARS) {
    throw new Error(`items[${index}].id is malformed`);
  }
  const crop = decodeBase64Image(item.image, `items[${index}].image`);
  await assertReasonablePixelDimensions(crop);

  const wide = item.wide;
  if (wide === null || typeof wide !== "object" || Array.isArray(wide)) throw new Error(`items[${index}].wide is malformed`);
  const w = wide as Record<string, unknown>;
  const count = w.count;
  if (typeof count !== "number" || !Number.isInteger(count) || count < 0 || count > MAX_COUNT) {
    throw new Error(`items[${index}].wide.count must be a whole number`);
  }
  const confidence = w.confidence;
  if (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error(`items[${index}].wide.confidence must be between 0 and 1`);
  }
  const brand = typeof w.brand === "string" && w.brand.trim().length > 0 ? w.brand.trim().slice(0, MAX_TEXT_CHARS) : null;
  return {
    id: item.id,
    crop,
    box: parseBox(item.box, index),
    ...(item.neighbours === undefined ? {} : { neighbours: parseNeighbours(item.neighbours, index) }),
    wide: {
      description: text(w.description, `items[${index}].wide.description`),
      productKey: text(w.productKey, `items[${index}].wide.productKey`),
      brand,
      count,
      confidence,
    },
  };
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let items: VerifyItemInput[];
  let brands: string[];
  try {
    assertReasonableContentLength(req);
    assertJsonContentType(req);
    const body = await req.json();
    assertJsonObject(body);
    if (!Array.isArray(body.items)) throw new Error("items must be an array");
    if (body.items.length > MAX_VERIFY_ITEMS) throw new Error("too many items");
    items = [];
    for (const [index, raw] of body.items.entries()) items.push(await parseItem(raw, index));
    brands = parseBrands(body.brands);
  } catch (err) {
    return fail(err, 400);
  }

  if (items.length === 0) return json({ ok: true, result: { items: [] } });

  if ((req.headers.get("accept") ?? "").includes(NDJSON)) return streamed(items, brands);

  try {
    const verified = await withTimeout(runVerify(items, brands));
    return json({ ok: true, result: { items: verified } });
  } catch (err) {
    return fail(err);
  }
}

const NDJSON = "application/x-ndjson";

/**
 * The same answer, one crop at a time: a line `{"item": ...}` the moment each crop is done, in the
 * order they finish, then `{"ok": true, "done": true}`. A failure after the first line has been
 * sent cannot become a status code any more, so it is the last line instead, worded exactly as
 * `fail` words it for a JSON caller, with nothing from upstream in it.
 *
 * Asked for with `Accept: application/x-ndjson`. On 2026-09-17, one request's close reads took
 * 2s for some crops and 7 to 10s for others, and a phone reading the whole answer at once held
 * every quick line back until the slowest crop came in. A caller that does not ask gets the one
 * JSON answer it always did.
 */
function streamed(items: VerifyItemInput[], brands: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (value: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
      try {
        await withTimeout(runVerify(items, brands, (item) => write({ item })));
        write({ ok: true, done: true });
      } catch (err) {
        console.error("[recognition]", err);
        write({ ok: false, error: "Recognition failed" });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": NDJSON, "cache-control": "no-store" } });
}
