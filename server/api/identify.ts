import { runIdentify } from "../src/recognize.js";
import type { Box } from "../src/compositor.js";
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

const MAX_HINT_CHARS = 200;

/** Exported so tests can pass malformed coordinates directly, bypassing JSON.stringify. */
export function parseBox(value: unknown): Box | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("box must be an object");
  const b = value as Record<string, unknown>;
  for (const k of ["x", "y", "w", "h"] as const) {
    const v = b[k];
    // Number.isFinite rather than a bare range check: NaN compares false to both `< 0` and
    // `> 1`, so a range check alone would let it through. This mirrors parseMarks in census.ts.
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) {
      throw new Error(`box.${k} must be a finite number between 0 and 1`);
    }
  }
  if ((b.w as number) <= 0 || (b.h as number) <= 0) throw new Error("box must have area");
  return { x: b.x as number, y: b.y as number, w: b.w as number, h: b.h as number };
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let crop: Buffer;
  let hint: string | null;
  let box: Box | null;
  try {
    assertReasonableContentLength(req);
    assertJsonContentType(req);
    const body = await req.json();
    assertJsonObject(body);
    crop = decodeBase64Image(body.image, "image");
    await assertReasonablePixelDimensions(crop);
    hint =
      typeof body.hint === "string" && body.hint.length > 0
        ? body.hint.slice(0, MAX_HINT_CHARS)
        : null;
    box = parseBox(body.box);
  } catch (err) {
    return fail(err, 400);
  }

  try {
    return json({ ok: true, result: await withTimeout(runIdentify(crop, hint, box)) });
  } catch (err) {
    return fail(err);
  }
}
