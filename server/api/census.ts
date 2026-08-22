import { runCensus } from "../src/recognize.js";
import { enumerateRegions, marksFromRegions, type EnumeratedRegion } from "../src/enumerate.js";
import type { Mark } from "../src/compositor.js";
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
 * Bounds how many regions one request can ask about. A real cart photo has at most a few
 * dozen visible products; tens of thousands of entries would mean tens of thousands of SVG
 * shapes composited onto one image and a correspondingly huge prompt, so this is rejected
 * before any of that work starts, not after.
 */
const MAX_MARKS = 40;

/** Exported so tests can exercise malformed box coordinates (e.g. NaN) directly as JS
 * values, bypassing JSON.stringify, which cannot produce a literal NaN over the wire. */
export function parseMarks(value: unknown): Mark[] {
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
      // Number.isFinite, not just typeof "number" with a range comparison, is belt-and-braces
      // defence in depth: NaN compares false to both `< 0` and `> 1`, so a plain range check
      // alone would silently let NaN through. No valid JSON-over-HTTP body can actually produce
      // a literal NaN here (JSON has no NaN literal, per RFC 8259), so this specific case is not
      // reachable over the wire; Infinity is reachable (e.g. the source text `1e400`, which
      // overflows to Infinity) and is already caught by the plain `v > 1` comparison on its own.
      // Number.isFinite is kept anyway because it costs nothing and covers both in one guard.
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
    await assertReasonablePixelDimensions(image);
    marks = parseMarks(body.marks ?? []);
  } catch (err) {
    return fail(err, 400);
  }

  try {
    // Capture then process. A client that sends no marks is not telling us there is nothing in
    // the frame, it is telling us it does not know: live per-item segmentation on the phone was
    // measured dead (docs/detector-decision.md), so finding the regions is the server's job now.
    // A client that does send marks keeps the old behaviour exactly, which is what lets the
    // on-device path and the captured path coexist while the transition lands.
    const capture = marks.length === 0;
    let regions: EnumeratedRegion[] = [];
    let degraded: string | null = null;
    let enumeratedHere = false;
    if (marks.length === 0) {
      enumeratedHere = true;
      const enumerated = await enumerateRegions(image);
      regions = enumerated.regions;
      degraded = enumerated.degraded;
      if (degraded !== null) console.warn("[census] enumeration degraded:", degraded);
      // Through marksFromRegions, not by hand: it carries each region's catalog shortlist
      // across as candidates, and building the marks here without it silently drops them, which
      // turns the question the model is asked back into open-world naming.
      marks = marksFromRegions(regions);
    }

    // `capture` is the path, not a heuristic: the orchestrator's two call sites are exactly
    // "no marks, server please find them" for a captured still and "here are the tracker's
    // marks" for a scan frame, so an empty list on arrival is the still path. The models differ
    // because the two paths fail differently; see MODELS.censusCapture.
    const result = await withTimeout(runCensus(image, marks, undefined, capture));

    // The geometry goes back with the identifications. The device no longer has it: it never ran
    // a detector, so without this there is nothing to draw an outline around and nothing for the
    // tracker to follow. Ids match marks[].id by construction, so the client can join the two
    // without trusting anything the model echoed.
    return json({
      ok: true,
      result,
      regions: regions.map((region, index) => ({
        id: index + 1,
        box: region.box,
        polygon: region.polygon,
        score: region.score,
      })),
      // Stated rather than hidden, and distinguishing the three real cases: the client brought
      // its own regions, the server found them, or the server tried and could not, in which case
      // the census still names what it can see and the client is running without outlines.
      enumeration: !enumeratedHere ? "client" : degraded === null ? "ok" : "degraded",
    });
  } catch (err) {
    return fail(err);
  }
}
