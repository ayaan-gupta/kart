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
  /** Identify: one tight crop of an uncertain item. */
  identify: "gpt-5.4",
  /** Escalation for items identify still cannot resolve. Used sparingly. */
  escalate: "gpt-5.5",
} as const;
