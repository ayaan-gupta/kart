import { runCensus } from "../src/recognize.js";
import type { Mark } from "../src/compositor.js";
import {
  assertJsonContentType,
  assertJsonObject,
  assertReasonableContentLength,
  decodeBase64Image,
  fail,
  json,
  withTimeout,
} from "../src/http.js";

export const config = { runtime: "nodejs" };

/**
 * Bounds how many regions one request can ask about. A real cart photo has at most a few
 * dozen visible products; tens of thousands of entries would mean tens of thousands of SVG
 * shapes composited onto one image and a correspondingly huge prompt, so this is rejected
 * before any of that work starts, not after.
 */
const MAX_MARKS = 40;

function parseMarks(value: unknown): Mark[] {
  if (!Array.isArray(value)) throw new Error("marks must be an array");
  if (value.length > MAX_MARKS) throw new Error("too many marks");

  const seenIds = new Set<number>();
  return value.map((raw, i) => {
    const m = raw as Record<string, unknown>;
    const b = m?.box as Record<string, unknown>;
    // Number.isInteger (not just typeof "number") rejects non-integer ids like 1.5; a mark id
    // is meant to be a small whole number the model echoes back verbatim.
    if (typeof m?.id !== "number" || !Number.isInteger(m.id) || !b || typeof b !== "object") {
      throw new Error(`marks[${i}] is malformed`);
    }
    if (seenIds.has(m.id)) throw new Error(`marks[${i}].id is a duplicate`);
    seenIds.add(m.id);
    for (const k of ["x", "y", "w", "h"] as const) {
      const v = b[k];
      // Number.isFinite (not just typeof "number" with a range comparison) is required here:
      // NaN compares false to both `< 0` and `> 1`, so a plain range check silently lets NaN
      // through. Infinity and -Infinity are already caught by the range comparison, but
      // Number.isFinite covers all three in one call and is the clearer guard to read.
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) {
        throw new Error(`marks[${i}].box.${k} must be a finite number between 0 and 1`);
      }
    }
    return {
      id: m.id,
      box: { x: b.x as number, y: b.y as number, w: b.w as number, h: b.h as number },
    };
  });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let image: Buffer;
  let marks: Mark[];
  try {
    assertReasonableContentLength(req);
    assertJsonContentType(req);
    const body = await req.json();
    assertJsonObject(body);
    image = decodeBase64Image(body.image, "image");
    marks = parseMarks(body.marks ?? []);
  } catch (err) {
    return fail(err, 400);
  }

  try {
    return json({ ok: true, result: await withTimeout(runCensus(image, marks)) });
  } catch (err) {
    return fail(err);
  }
}
