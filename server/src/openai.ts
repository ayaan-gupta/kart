import OpenAI from "openai";

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  throw new Error("OPENAI_API_KEY is not set. Copy .env.example to .env and fill it in.");
}

export const openai = new OpenAI({ apiKey });

export const MODELS = {
  /** Census: labels marked regions in a full frame. Perception, not reasoning. */
  census: "gpt-5.4-mini",
  /** Identify: one tight crop of an uncertain item. */
  identify: "gpt-5.4",
  /** Escalation for items identify still cannot resolve. Used sparingly. */
  escalate: "gpt-5.5",
} as const;
