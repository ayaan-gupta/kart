import type { Mark } from "./compositor.js";
import { CensusResponse } from "./schemas.js";

/**
 * A census answered by a local vision model instead of OpenAI.
 *
 * This exists for one situation: an account with no credit. Without it the whole pipeline is
 * reachable and names nothing, which is the state `docs/running-on-a-phone.md` describes. With
 * `LOCAL_CENSUS_URL` set, `server/localvlm/serve.py` answers the same contract from weights on
 * the machine.
 *
 * **It is not as good as the shipped model.** The ninety-sixth section of `server/eval/KART.md`
 * measures both on the same alignment metric: shipped 20 of 22, local 18 of 22. It is also
 * slower, because it asks one question per region rather than one per frame. Nothing here should
 * be read as an argument for shipping it; it is the honest fallback.
 *
 * Unset is the normal state and the default. When the variable is empty this module is never
 * reached and `runCensus` behaves exactly as it did before it existed.
 */

/** Generous, because a local model answers one region at a time on whatever hardware is present. */
const DEFAULT_TIMEOUT_MS = 300_000;

export function localCensusUrl(): string {
  return (process.env.LOCAL_CENSUS_URL ?? "").trim();
}

export async function runCensusLocally(
  image: Buffer,
  marks: Mark[],
  alreadyCounted: string[],
  endpoint: string,
): Promise<CensusResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        image: image.toString("base64"),
        marks: marks.map((mark) => ({ id: mark.id, box: mark.box })),
        counted: alreadyCounted,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      // The status alone, never the body, for the same reason `enumerate.ts` documents: a
      // third-party error page is not something this service can promise carries nothing
      // sensitive.
      throw new Error(`local census returned ${response.status}`);
    }
    // Parsed through the same schema the model path uses. A local model that drifts out of shape
    // fails here loudly rather than reaching the fusion layer as a half-filled bag.
    return CensusResponse.parse(await response.json());
  } finally {
    clearTimeout(timer);
  }
}
