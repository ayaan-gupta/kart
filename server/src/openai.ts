import OpenAI from "openai";

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  throw new Error(
    "OPENAI_API_KEY is not set. Put it in server/.env.local, which is the only file " +
      "`npm run serve` loads, or run ./scripts/setup.sh from the repository root.",
  );
}

/**
 * `OPENAI_BASE_URL` points the client at any OpenAI-compatible endpoint instead of OpenAI's own.
 *
 * Unset, nothing changes: the SDK's own default applies and this is the client it has always
 * built. Set, it covers the case that stopped every model-tier measurement in `server/eval` -- an
 * account with no credit -- without waiting on that one account.
 *
 * **It will not reach a locally served model, and an earlier version of this comment wrongly said
 * it would.** Everything here goes through `openai.responses.create`, the Responses API, and the
 * local servers people reach for -- llama.cpp, vLLM, Ollama, mlx-vlm -- implement
 * `/v1/chat/completions` instead. A base URL only helps against an endpoint that implements
 * `/v1/responses` with `json_schema` strict mode: another OpenAI organisation or key, an OpenAI
 * gateway or proxy, or Azure OpenAI where the deployment exposes it. Pointing this at a local
 * server produces a 404 on the first request, not a working pipeline.
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
  /**
   * Moved from gpt-5.4-mini to gpt-5.6-luna on 2026-09-03, for cost, measured rather than assumed.
   *
   * `server/eval/pipeline/scene-gate.ts --repeat 3`, the same twelve labelled photographs three
   * times each, one arm per model:
   *
   *                      gate        cart      product    shelf     cache   cost/call
   *     gpt-5.4-mini     36 of 36    18 of 18  6 of 6     12 of 12   73%    $0.0027
   *     gpt-5.6-luna     36 of 36    18 of 18  6 of 6     12 of 12  100%    $0.0005
   *
   * Identical on every accuracy axis measured, including quantity on both product stills (3 of 3
   * each), and 5.4x cheaper. Latency is a wash: 1.5 to 1.8 seconds a call either way.
   *
   * The one difference is wording, not reading. mini tends to repeat the brand inside the
   * free-text description ("Southern Grove shelled walnuts"), luna does not ("Shelled walnuts").
   * Both read the brand correctly: luna put "southern grove::shelled walnuts" in the productKey on
   * 5 of 5 runs. That difference used to be invisible in the bag, because the bag hardcoded a null
   * brand for every unmarked product; `brandFromKey` in fusion.ts now reads it back out, so the
   * subtitle shows the brand on either model.
   */
  census: process.env.KART_CENSUS_MODEL?.trim() || "gpt-5.6-luna",
  /**
   * Identify: one tight crop of an uncertain item.
   *
   * `KART_IDENTIFY_MODEL` overrides it, for the eval harnesses only, exactly as
   * `KART_CENSUS_MODEL` does above.
   *
   * The override exists because this tier has never been measured, and it is the expensive one:
   * census runs on mini and identify runs on the full model, up to six times per scan
   * (`MAX_IDENTIFY_CALLS_PER_SESSION`), so these calls dominate what a scan costs. The choice
   * was made by assumption -- a hard case deserves the better model -- and `identify-brand.ts`,
   * the only harness that exercises it, is single-arm: it calls `runIdentify` and therefore
   * whatever this constant already says, so no cheaper tier was ever in the comparison.
   *
   * What that harness did measure argues the task is easier than the tier implies: six of six
   * brands read correctly at confidence 0.97 to 0.99. Reading MR. LUCKY off a sharp,
   * full-resolution crop is closer to OCR than to the whole-trolley reasoning the census does,
   * and the census's own bakeoff showed the bigger model actively worse at that harder task
   * (it over-counts, 11.7 units against a truth of 9). Neither result predicts the other; both
   * say this is worth an arm rather than an assumption.
   *
   * `gpt-5.4-nano` is available on the account and used nowhere in this project. It is the
   * obvious third arm.
   */
  /**
   * Moved from gpt-5.4 to gpt-5.6-luna on 2026-09-03, and this tier is finally measured.
   *
   * The comment above is right that the choice was an assumption and that `identify-brand.ts` was
   * single-arm. It is now two-armed, `KART_IDENTIFY_MODEL` selecting the arm, over the six crops
   * this corpus can score against a wrapper that legibly reads MR. LUCKY:
   *
   *     gpt-5.4         6 of 6 brands right, confidence 0.96 to 0.98, $0.0069 a call
   *     gpt-5.6-luna    6 of 6 brands right, confidence 0.99,         $0.0005 a call
   *
   * Same answer on every crop, slightly higher confidence, 13x cheaper. The assumption that a
   * hard case deserves the better tier did not survive being measured: this task is reading large
   * text off a sharp crop, which is not where the expensive tiers earn their price.
   *
   * Neither arm gets any prompt cache discount and neither can. IDENTIFY_SYSTEM_PROMPT is about
   * 260 tokens and OpenAI's cache needs a stable prefix of at least 1,024, so the only thing long
   * enough to matter here is the crop, which is different every call by construction. The
   * `prompt_cache_key` on the call is correct and simply has nothing to bite on; the "no prompt
   * cache hits" warning is expected on this path and is not a fault to chase.
   */
  identify: process.env.KART_IDENTIFY_MODEL?.trim() || "gpt-5.6-luna",
  /**
   * Photograph census: one shopper photograph, no badges, every product through unmarkedItems.
   *
   * `KART_PHOTO_MODEL` overrides it, for the eval harnesses only.
   *
   * gpt-5.6-sol, the flagship tier, at reasoning effort "none". Measured on the fifteen clut
   * photographs on 2026-09-05, one pass per arm, same labels and the same scorer for every arm
   * (server/eval/CLUT.md, "The tier is the lever"):
   *
   *                             found   brands   seconds   per photo
   *     gpt-5.6-luna, none        82%      76%      4.6     $0.001
   *     gpt-5.6-terra, medium     83%      80%      9.9     $0.013
   *     gpt-5.6-sol, none         89%      94%      5.4     $0.017
   *     gpt-5.6-sol, low          90%      85%     14.8     $0.027
   *     gpt-5.6-sol, medium       89%      94%     33.3     $0.05
   *
   * Per photo at the rates in usage.ts. Through the shipped path, three passes, Sol reads 90%
   * of brands and flags every photograph that has something hidden; the table is in CLUT.md.
   *
   * Luna and Terra both read PRIANO as Piano, Primo, Prano or Praino on every pass and Simply
   * Nature as Muir Glen or Rao's; Sol reads them. Reasoning buys Sol nothing here that its eyes
   * do not already have, and costs six times the wait, so the effort is "none". The live scan's
   * census stays on Luna: it is fused from several calls and its bakeoff was measured on that.
   */
  photo: process.env.KART_PHOTO_MODEL?.trim() || "gpt-5.6-sol",
  /** Escalation for items identify still cannot resolve. Used sparingly. */
  escalate: "gpt-5.5",
} as const;
