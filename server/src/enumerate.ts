/**
 * Finds the regions worth asking about in a captured cart frame.
 *
 * This is the seam the detector decision left open. Live per-item segmentation on the phone is
 * dead (`docs/detector-decision.md`), and the only enumerator measured that produces boxes tight
 * enough to refine into real outlines is a grounded open-vocabulary detector, which is a 700MB
 * PyTorch model with a text encoder. It cannot run on a phone and it cannot run in a standard
 * serverless function, so it runs behind an HTTP endpoint on a GPU host and this module is the
 * only thing that knows that.
 *
 * The contract below is deliberately provider neutral: Replicate, Modal and fal all differ in
 * how they wrap a model, and none of those differences belong in the recognition service. The
 * reference implementation of the far side is `runs/2026-08-16-pipeline-run/harness/grounded.py`,
 * which is the exact script the measured run used.
 *
 * Nothing here is required for the service to work. With no endpoint configured, enumeration
 * returns nothing and the census still runs: the model names what it can see in unmarkedItems,
 * which measured 72% of hand-labelled units on real photographs with no usable detector at all.
 * That is the honest degraded mode, and it is why this returns an empty list rather than
 * throwing when unconfigured.
 */
import { z } from "zod";

/** Normalized to the frame, origin top-left, matching every other box in this codebase. */
export const EnumeratedBox = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0).max(1),
  h: z.number().min(0).max(1),
});

export const EnumeratedRegion = z.object({
  box: EnumeratedBox,
  /**
   * Flat `[x0, y0, x1, y1, ...]`, normalized, origin top-left. The same shape
   * `AppleInstanceMaskDetector` produced on device, so everything above the detector, the
   * tracker, the overlay, the counting rule, is unchanged by where the polygon came from.
   */
  polygon: z.array(z.number()),
  /**
   * Confidence that this region is one distinct object, 0 to 1. Not a class score.
   *
   * This is the same contract `KartDetector.detect` states, and it is not a formality. A
   * grounded detector's native output is a text-match score running about 0.21 to 0.46 on cart
   * photographs, and ByteTrack only seeds a track at 0.5 or above, so passing that through
   * unmapped produced zero tracks and an empty bag on every photograph tried. The far side owes
   * a score in these units; `grounded.py` documents the mapping it uses.
   */
  score: z.number().min(0).max(1),
});

export const EnumerateResponse = z.object({ instances: z.array(EnumeratedRegion) });

export type EnumeratedRegion = z.infer<typeof EnumeratedRegion>;

/**
 * Ceiling on regions accepted from the enumerator, matching `MAX_MARKS` in `api/census.ts`.
 *
 * Both ends need a bound and they need the same one: past roughly thirty badges on one frame
 * the numbers stop being legible to the model anyway, and every extra region is another SVG
 * shape composited onto the image and another line in the prompt. Highest scoring survive.
 */
export const MAX_REGIONS = 40;

/** A polygon needs three points to enclose anything; fewer is a malformed region, not a shape. */
const MIN_POLYGON_POINTS = 3;

export interface EnumerateOptions {
  /** Overrides the environment, for tests. */
  endpoint?: string;
  token?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 60_000;

/** True when an endpoint is configured, so callers can report the degraded mode honestly. */
export function enumeratorConfigured(options: EnumerateOptions = {}): boolean {
  return (options.endpoint ?? process.env.ENUMERATOR_URL ?? "").trim().length > 0;
}

/**
 * Drops regions that cannot be drawn or counted, rather than letting a malformed one through to
 * the compositor. A box with no area produces a badge on nothing; a polygon with two points
 * produces an outline that renders as a line across the item.
 */
function usable(region: EnumeratedRegion): boolean {
  if (region.box.w <= 0 || region.box.h <= 0) return false;
  if (region.polygon.length < MIN_POLYGON_POINTS * 2) return false;
  if (region.polygon.length % 2 !== 0) return false;
  return region.polygon.every((value) => Number.isFinite(value));
}

/**
 * Asks the enumerator for the regions in one captured frame.
 *
 * Never throws. An enumerator that is unconfigured, unreachable, slow, or returning something
 * unexpected must not take the whole capture down with it: the census degrades to naming what it
 * can see rather than failing, which is a far better outcome for the shopper than an error. The
 * reason is returned so the caller can log it and surface the degraded mode.
 */
export async function enumerateRegions(
  jpeg: Buffer,
  options: EnumerateOptions = {},
): Promise<{ regions: EnumeratedRegion[]; degraded: string | null }> {
  const endpoint = (options.endpoint ?? process.env.ENUMERATOR_URL ?? "").trim();
  if (endpoint.length === 0) return { regions: [], degraded: "no enumerator configured" };

  const token = (options.token ?? process.env.ENUMERATOR_TOKEN ?? "").trim();
  const doFetch = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const response = await doFetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // Only sent when set, so a host that authenticates by URL alone is not handed an
        // empty bearer token to reject.
        ...(token.length > 0 ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ image: jpeg.toString("base64") }),
      signal: controller.signal,
    });

    if (!response.ok) {
      // The status alone, never the body: a third-party error page is not something this
      // service can promise carries nothing sensitive.
      return { regions: [], degraded: `enumerator returned ${response.status}` };
    }

    const parsed = EnumerateResponse.safeParse(await response.json());
    if (!parsed.success) return { regions: [], degraded: "enumerator response did not parse" };

    const regions = parsed.data.instances
      .filter(usable)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_REGIONS);

    return { regions, degraded: null };
  } catch (err) {
    // AbortError for the timeout, TypeError for a fetch failure. Neither message is echoed:
    // the same discipline `recognize.ts` documents at length for the OpenAI client.
    const reason = err instanceof Error && err.name === "AbortError" ? "timed out" : "unreachable";
    return { regions: [], degraded: `enumerator ${reason}` };
  } finally {
    clearTimeout(timer);
  }
}
