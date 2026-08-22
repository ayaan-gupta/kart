import OpenAI from "openai";

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  throw new Error("OPENAI_API_KEY is not set. Copy .env.example to .env and fill it in.");
}

/**
 * `OPENAI_BASE_URL` points the client at any OpenAI-compatible endpoint instead of OpenAI's own.
 *
 * Unset, nothing changes: the SDK's own default applies and this is the client it has always
 * built. Set, it covers the case that stopped every model-tier measurement in `server/eval` -- an
 * account with no credit -- without waiting on that one account, since Azure OpenAI, a second
 * organisation, a gateway or a locally served model all speak the same protocol.
 *
 * Validated rather than passed through. A typo here does not fail loudly at construction; it fails
 * on the first request, several layers down, as a connection error that reads like the network
 * being off, and `redactSecrets` is between you and the detail. Parsing it here says which
 * variable is wrong.
 */
const rawBaseUrl = process.env.OPENAI_BASE_URL?.trim();
let baseURL: string | undefined;
if (rawBaseUrl) {
  try {
    baseURL = new URL(rawBaseUrl).toString();
  } catch {
    throw new Error(
      `OPENAI_BASE_URL is not a valid URL: ${JSON.stringify(rawBaseUrl)}. ` +
        "Unset it to use OpenAI's own endpoint.",
    );
  }
}

export const openai = new OpenAI(baseURL ? { apiKey, baseURL } : { apiKey });

export const MODELS = {
  /**
   * Census: labels marked regions in a full frame.
   *
   * `KART_CENSUS_MODEL` overrides it, for the eval harnesses only.
   *
   * Why mini and not gpt-5.4, which reads a single photograph better. On six trolley photographs
   * scored one call at a time, gpt-5.4 wins clearly: 49 of 60 passes exact against 44, and 282 of
   * 310 products found against 258. It sweeps harder for products no badge landed on, and on one
   * image that is more of the trolley found.
   *
   * A scan is not one image. Its bag is fused from several calls, and sweeping harder there means
   * more descriptions of the same goods in words that will not join. Measured on the real frame
   * loop with `server/eval/pipeline/scan-loop.ts`, three runs each against nine real products:
   *   gpt-5.4          12, 12, 11 units   (mean 11.7)
   *   gpt-5.4-mini      8, 11, 10 units   (mean  9.7)
   *
   * The two were once selected by path, on the reasoning that a captured still and a scan frame
   * want different models. `scan.tsx` now uses the capture path for every keyframe and the app has
   * no screen that captures a single still, so every census it makes is one that will be fused.
   * The split had nothing left to select on and was removed rather than left choosing wrongly.
   */
  census: process.env.KART_CENSUS_MODEL?.trim() || "gpt-5.4-mini",
  /** Identify: one tight crop of an uncertain item. */
  identify: "gpt-5.4",
  /** Escalation for items identify still cannot resolve. Used sparingly. */
  escalate: "gpt-5.5",
} as const;
