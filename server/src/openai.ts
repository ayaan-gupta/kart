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
  /**
   * Census for one captured still, where the server found the regions itself.
   *
   * The same call, deliberately on a larger model, because the two paths fail differently and
   * the corpora say so. A bigger model sweeps harder for products no badge landed on. Given one
   * photograph that is more of the trolley found; given the four calls of a pan it is more
   * descriptions of the same goods in different words, and the bag fills with them.
   *
   * Measured over two independent rounds of five passes on the six trolley photographs,
   * gpt-5.4 against gpt-5.4-mini:
   *   photographs exact        44 of 60  ->  49 of 60
   *   mean absolute error       0.55     ->   0.28
   *   IMG_0252, nine products   3 of 10  ->   7 of 10   (units 7 to 11 -> 8 to 9)
   *   IMG_0254, fifteen         1 of 10  ->   3 of 10   (error 2.40 -> 1.30)
   *   the four sparse ones      10 of 10 -> 10 of 10, except one pass of IMG_0249
   *   badge alignment           21 of 23 on every pass, both models
   * And on the nine-second scan, the other way, decisively: 13.5 units against nine real, where
   * mini gives 10.2. That is why this is a second entry and not a change to the one above.
   */
  censusCapture: process.env.KART_CAPTURE_CENSUS_MODEL?.trim() || "gpt-5.4",
  /** Identify: one tight crop of an uncertain item. */
  identify: "gpt-5.4",
  /** Escalation for items identify still cannot resolve. Used sparingly. */
  escalate: "gpt-5.5",
} as const;
