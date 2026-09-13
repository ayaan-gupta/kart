/**
 * What a photo answer that was stopped part way through still says.
 *
 * Qwen 3 VL 235B sometimes stops listing products and starts writing one of them over and over.
 * On 2026-09-11 clut12 wrote "lactose free milk, Friendly Farms" until the output cap and clut9
 * did the same with "crackers, Savoritz", after five and ten good products respectively. Another
 * answer wrote one product and then 31,106 characters of whitespace inside its box. Each of those
 * requests failed, so the products the model had already listed correctly never reached the bag.
 *
 * The answer is written as one line of JSON in schema order, so every product whose closing
 * brace was written is a whole object that can be read on its own. This reads them back, keeps
 * each product once, and marks the one that was repeated unsure: its first writing may well be
 * right, but a model that could not stop writing it is not a witness to assert it on.
 *
 * Pure, so every case is pinned in salvage.test.ts against the shapes the model actually wrote.
 */
import { PhotoItem, PhotoResponse, isNoBrand, productKey } from "./schemas.js";

/**
 * A repeated product's confidence, below the unsure line (UNSURE_BELOW in reconcile.ts), so no
 * agreement between the two readings can make it sure.
 */
export const LOOPED_CONFIDENCE = 0.5;

/**
 * Three writings of one product is a loop. Two is not, necessarily: the prompt asks for one entry
 * per product with a count, but two packs sharing a name (clut12's whole and 2% milk are both
 * "lactose free milk, Friendly Farms" to the model) can come back as two entries.
 */
export const LOOP_WRITINGS = 3;

/**
 * Trailing whitespace past this is a stall. The loops above put up to thirteen newlines inside
 * one box; the stall wrote tens of thousands of whitespace characters.
 */
export const STALL_WHITESPACE = 256;

type Kind = PhotoResponse["subjectKind"];
type Severity = PhotoResponse["occlusion"]["severity"];

interface Written {
  subjectKind: Kind | null;
  /** Every product whose object was closed, in the order written. */
  items: PhotoItem[];
  /** The product being written when the answer stopped, if all it lacked was its box. */
  partial: PhotoItem | null;
  /** What was said about hidden items, if the list was finished and that much was written. */
  severity: Severity | null;
  reason: string | null;
}

function keyOf(item: PhotoItem): string {
  return productKey(item.name.trim(), isNoBrand(item.brand) ? null : (item.brand ?? "").trim());
}

function parsedItem(text: string): PhotoItem | null {
  try {
    const parsed = PhotoItem.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * The product cut off inside its rectangle, read as having none: everything before `"bbox_2d"`
 * is whole. A key can be matched with a pattern here because a quote inside a JSON string is
 * always escaped, so `"bbox_2d"` followed by a colon only ever appears as the key itself.
 *
 * This is why `bbox_2d` is the last field in `photoJsonSchema` and has to stay there. Moving it
 * to the front reads better to the model, and was measured to place rectangles just as well, but
 * it would leave a cut-off product with a rectangle and no name, which is nothing.
 */
function boxlessItem(partial: string): PhotoItem | null {
  const at = partial.search(/,\s*"bbox_2d"\s*:/);
  if (at < 0) return null;
  try {
    const parsed = PhotoItem.safeParse({ ...JSON.parse(`${partial.slice(0, at)}}`), bbox_2d: null });
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function readWritten(text: string): Written {
  const kind = /"subjectKind"\s*:\s*"(cart|product|shelf)"/.exec(text);
  const written: Written = { subjectKind: kind ? (kind[1] as Kind) : null, items: [], partial: null, severity: null, reason: null };
  const list = /"items"\s*:\s*\[/.exec(text);
  if (list === null) return written;

  // Walked by hand rather than by pattern, so a brace or bracket inside a product's name is
  // taken as text: only structure outside a string opens or closes anything.
  let depth = 0;
  let inString = false;
  let escaped = false;
  let start = -1;
  let closedAt = -1;
  for (let i = list.index + list[0].length; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
    } else if (c === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0) {
        const item = parsedItem(text.slice(start, i + 1));
        if (item !== null) written.items.push(item);
        start = -1;
      }
    } else if (c === "]" && depth === 0) {
      closedAt = i;
      break;
    }
  }
  if (start >= 0) written.partial = boxlessItem(text.slice(start));
  if (closedAt >= 0) {
    const rest = text.slice(closedAt);
    const severity = /"severity"\s*:\s*"(none|some|many)"/.exec(rest);
    const reason = /"reason"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(rest);
    written.severity = severity ? (severity[1] as Severity) : null;
    written.reason = reason ? (JSON.parse(`"${reason[1]}"`) as string) : null;
  }
  return written;
}

/**
 * How much two rectangles are the same rectangle, 0 to 1, on the model's own 0 to 1000 scale.
 * Not exported: nothing else compares two `bbox_2d`s, and the server's own boxes are a different
 * shape on a different scale.
 */
function sameness(a: number[], b: number[]): number {
  const box = (r: number[]) => ({
    x1: Math.min(r[0], r[2]), y1: Math.min(r[1], r[3]),
    x2: Math.max(r[0], r[2]), y2: Math.max(r[1], r[3]),
  });
  const p = box(a), q = box(b);
  const w = Math.min(p.x2, q.x2) - Math.max(p.x1, q.x1);
  const h = Math.min(p.y2, q.y2) - Math.max(p.y1, q.y1);
  if (w <= 0 || h <= 0) return 0;
  const overlap = w * h;
  const union = (p.x2 - p.x1) * (p.y2 - p.y1) + (q.x2 - q.x1) * (q.y2 - q.y1) - overlap;
  return union <= 0 ? 0 : overlap / union;
}

/**
 * Two writings of one product in one place, rather than two packages of it side by side.
 *
 * Half is a wide margin either way and nothing lands near it. A loop rewrites a product where it
 * already wrote it, wandering by a point or two, which is a sameness above 0.9; two packages of
 * one product stand next to each other and barely touch, which is a sameness near 0.
 */
const SAME_PLACE = 0.5;

/**
 * The key of a product written LOOP_WRITINGS times or more in the same place, among those whose
 * writing is finished.
 *
 * The place is the point of it. Until 2026-09-13 this counted writings by name alone, which was
 * right while the request asked for one entry per product: a name written three times could only
 * be a model repeating itself. The request now asks for one entry per package, so three tins of
 * one soup are three entries of one name and a correct answer. On clut7 that answer was cut off
 * at two products on both passes of the run of 2026-09-13, while the model was writing the third
 * of three Simply Nature black bean tins, each correctly placed on its own tin.
 *
 * A product the model placed nowhere has no place to compare, so those writings fall back to the
 * count alone and a name written three times with no rectangle is the loop it always was.
 */
export function loopedProduct(text: string): string | null {
  const writings = new Map<string, (number[] | null)[]>();
  for (const item of readWritten(text).items) {
    const key = keyOf(item);
    const seen = writings.get(key) ?? [];
    const here = item.bbox_2d !== null && item.bbox_2d.length >= 4 ? item.bbox_2d : null;
    const together =
      1 + seen.filter((other) => (here === null || other === null ? other === here : sameness(here, other) >= SAME_PLACE)).length;
    if (together >= LOOP_WRITINGS) return key;
    seen.push(here);
    writings.set(key, seen);
  }
  return null;
}

/** Whether the answer now ends in a run of whitespace no real answer writes. Counted from the end. */
export function stalled(text: string): boolean {
  let run = 0;
  for (let i = text.length - 1; i >= 0 && run < STALL_WHITESPACE; i--) {
    if (!/\s/.test(text[i])) return false;
    run++;
  }
  return run >= STALL_WHITESPACE;
}

/**
 * The answer as far as it can be read, or null when it names no product to put in the bag.
 *
 * An answer that finished and then trailed whitespace is returned exactly as written. Otherwise
 * each product is kept once, at its first writing, and a product written more than once is
 * lowered below the unsure line. What was said about hidden items is kept when the model got
 * that far, and reported as "some" when it did not: an answer that stopped cannot say nothing is
 * hidden, and a shopper asked to check is the cheap mistake.
 */
export function salvagePhoto(text: string): PhotoResponse | null {
  try {
    const whole = PhotoResponse.safeParse(JSON.parse(text));
    if (whole.success) return whole.data;
  } catch {
    // Unfinished, which is the usual case here.
  }
  const written = readWritten(text);
  if (written.subjectKind === null) return null;

  const kept: PhotoItem[] = [];
  const firstAt = new Map<string, number>();
  const repeated = new Set<number>();
  for (const item of written.partial ? [...written.items, written.partial] : written.items) {
    const key = keyOf(item);
    const at = firstAt.get(key);
    if (at !== undefined) {
      repeated.add(at);
      continue;
    }
    firstAt.set(key, kept.length);
    kept.push(item);
  }
  if (!kept.some((item) => item.isProduct)) return null;

  return {
    subjectKind: written.subjectKind,
    items: kept.map((item, i) => (repeated.has(i) ? { ...item, confidence: Math.min(item.confidence, LOOPED_CONFIDENCE) } : item)),
    occlusion: {
      severity: written.severity ?? "some",
      reason: written.reason ?? "the answer stopped before it said what is hidden",
    },
  };
}
