import OpenAI from "openai";

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  throw new Error("OPENAI_API_KEY is not set. Copy .env.example to .env and fill it in.");
}

export const openai = new OpenAI({ apiKey });

export const MODELS = {
  /**
   * Census: labels marked regions in a full frame. Perception, not reasoning.
   *
   * `KART_CENSUS_MODEL` overrides it, for the eval harnesses only. "Perception, not reasoning" is
   * an assumption about what this call needs and it had never been tested against a larger model,
   * only against more reasoning effort on this one, which does nothing.
   */
  census: process.env.KART_CENSUS_MODEL?.trim() || "gpt-5.4-mini",
  /*
   * Why mini and not gpt-5.4, which reads a single photograph better.
   *
   * On six trolley photographs scored one call at a time, gpt-5.4 wins clearly: 49 of 60 passes
   * exact against 44, and 282 of 310 products found against 258. It sweeps harder for products no
   * badge landed on, and on one image that is more of the trolley found.
   *
   * A scan is not one image. Its bag is fused from several calls, and sweeping harder there means
   * more descriptions of the same goods in words that will not join. Measured on the real frame
   * loop with `server/eval/pipeline/scan-loop.ts`, three runs each against nine real products:
   *   gpt-5.4          12, 12, 11 units   (mean 11.7)
   *   gpt-5.4-mini      8, 11, 10 units   (mean  9.7)
   *
   * Both were once selected by path, on the reasoning that a captured still and a scan frame want
   * different models. `scan.tsx` now uses the capture path for every keyframe, and the app has no
   * screen that captures a single still, so every census it makes is one that will be fused. The
   * split had nothing left to select on and was removed rather than left selecting the wrong way.
   */
  /** Identify: one tight crop of an uncertain item. */
  identify: "gpt-5.4",
  /** Escalation for items identify still cannot resolve. Used sparingly. */
  escalate: "gpt-5.5",
} as const;
