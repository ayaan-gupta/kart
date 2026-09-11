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
 * The product cut off inside its box, read as having none: everything before `"box"` is whole.
 * A key can be matched with a pattern here because a quote inside a JSON string is always
 * escaped, so `"box"` followed by a colon only ever appears as the key itself.
 */
function boxlessItem(partial: string): PhotoItem | null {
  const at = partial.search(/,\s*"box"\s*:/);
  if (at < 0) return null;
  try {
    const parsed = PhotoItem.safeParse({ ...JSON.parse(`${partial.slice(0, at)}}`), box: null });
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

/** The key of a product written LOOP_WRITINGS times or more, among those whose writing is finished. */
export function loopedProduct(text: string): string | null {
  const writings = new Map<string, number>();
  for (const item of readWritten(text).items) {
    const key = keyOf(item);
    const n = (writings.get(key) ?? 0) + 1;
    if (n >= LOOP_WRITINGS) return key;
    writings.set(key, n);
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
