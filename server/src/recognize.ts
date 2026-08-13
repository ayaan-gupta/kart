import OpenAI, { APIError } from "openai";
import { openai, MODELS } from "./openai.js";
import { compositeMarks, type Mark } from "./compositor.js";
import {
  CensusResponse,
  IdentifyResponse,
  censusJsonSchema,
  identifyJsonSchema,
  productKey,
} from "./schemas.js";
import { CENSUS_SYSTEM_PROMPT, IDENTIFY_SYSTEM_PROMPT, censusUserText } from "./prompts.js";

const CENSUS_LONG_EDGE = 1024;

function dataUrl(jpeg: Buffer): string {
  return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
}

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

/** Matches an OpenAI-style secret key so one can never reach a thrown message or a log line. */
const SECRET_PATTERN = /sk-[A-Za-z0-9_-]{10,}/g;

function redactSecrets(text: string): string {
  return text.replace(SECRET_PATTERN, "[redacted]");
}

/**
 * Turns a failed OpenAI call into a safe error to throw.
 *
 * This is deliberately narrow about what it reads off the SDK's error object. OpenAI's own
 * 401 invalid_api_key response echoes the offending key back inside `error.message` so a
 * human can spot their typo, which means forwarding that message verbatim would print the
 * key straight into our own thrown error, and from there into whatever log catches it.
 * `APIError.headers` is the raw response Headers object and is never read either. So this
 * builds the message only from small categorical fields (HTTP status, the SDK's `code` or
 * `type` string), never from `error.message` or the parsed error body, and the composed
 * result is still passed through redactSecrets as a last line of defence in case one of
 * those fields is ever key-shaped. Non-APIError failures (network errors, aborts) fall back
 * to `err.message`, which is not known to carry the key, but is redacted for the same
 * reason.
 */
function toSafeError(context: string, err: unknown): Error {
  if (err instanceof APIError) {
    const label = err.code ?? err.type ?? "api_error";
    const status = err.status ?? "unknown status";
    return new Error(redactSecrets(`${context}: OpenAI request failed (${status} ${label})`));
  }
  const message = err instanceof Error ? err.message : String(err);
  return new Error(redactSecrets(`${context}: ${message}`));
}

/**
 * Calls the Responses API and returns its text output, translating any failure into a safe
 * error before it can propagate. This is the only place either exported function touches
 * `openai.responses.create`, so it is also the only place that needs to guard against a
 * leaking error message.
 */
async function requestOutputText(
  context: string,
  params: OpenAI.Responses.ResponseCreateParamsNonStreaming,
): Promise<string> {
  try {
    const response = await openai.responses.create(params);
    return response.output_text;
  } catch (err) {
    throw toSafeError(context, err);
  }
}

// ---------------------------------------------------------------------------
// productKey re-derivation
//
// The census response's inViewCounts[].productKey is a string the model hand-builds by
// following the prompt's formatting rules (lowercase, strip punctuation, fold accents,
// join as "brand::name"). A model will not do that perfectly every time, and the eval
// harness compares these exact strings, so nothing here trusts that raw string as-is.
// ---------------------------------------------------------------------------

/**
 * Treats an empty or whitespace-only brand the same as a genuinely absent one.
 *
 * Both prompts ask the model for `null` when there is no brand (illegible packaging for
 * IDENTIFY, illegible packaging or genuinely brandless items for CENSUS), but a "string or
 * null" JSON Schema field does not stop a model from emitting "" instead of null. Left
 * alone, that would make productKey("Bananas", "") differ from productKey("Bananas", null)
 * even though both mean the same product, so every brand value read in this file is passed
 * through this first. This is also the defence against the carried known gap in
 * IDENTIFY_SYSTEM_PROMPT: it never states "" is unacceptable, but whatever it returns is
 * normalised here before use.
 */
function normalizeBrand(brand: string | null): string | null {
  if (brand === null) return null;
  const trimmed = brand.trim();
  return trimmed.length === 0 ? null : brand;
}

/**
 * Re-derives a canonical productKey from the model's raw "brand::name" string by reusing
 * productKey() itself rather than re-implementing its normalisation rules a second time.
 * Splits on the first "::" (a brand should never legitimately contain the separator); a
 * string with no separator at all is treated as an all-name, no-brand key, which is the
 * shape a well-formed key for an unbranded item takes anyway.
 */
function reDeriveFromRawKey(raw: string): string {
  const sep = raw.indexOf("::");
  if (sep === -1) return productKey(raw, null);
  const brandPart = raw.slice(0, sep);
  const namePart = raw.slice(sep + 2);
  return productKey(namePart, normalizeBrand(brandPart));
}

/**
 * Replaces every inViewCounts[].productKey with a value re-derived server-side, and
 * normalises every mark's brand the same way marks are used to derive those keys.
 *
 * Matching strategy: an inViewCounts entry carries no numeric mark id, only the productKey
 * string, so there is no direct foreign key from an entry to the mark or marks it is
 * counting. Instead, every mark in this same response has its own name and brand fields,
 * independently typed and validated field-by-field by the schema, which is a more reliable
 * source of truth than a single hand-formatted composite string. Those fields are run
 * through productKey() to build the set of canonical keys this response could legitimately
 * be counting, the entry's raw key is re-derived the same way (see reDeriveFromRawKey), and
 * the two are compared:
 *
 * - If the re-derived key matches a mark's canonical key, that canonical key is used. This
 *   is the common repair: same product, but the model's hand-formatted "brand::name"
 *   string drifted in case, punctuation, or accents from what it separately put in that
 *   mark's own name/brand fields.
 * - If it matches no mark in this response (for example, a count of duplicates the model
 *   only described through unmarkedItems, or a drift too large to repair, such as a missing
 *   word that normalisation cannot restore), the entry is kept, not dropped, carrying its
 *   own best-effort re-derived key, and a warning is logged naming both the original and
 *   re-derived strings. The eval harness reads the returned data, not stderr, so this
 *   cannot silently corrupt a comparison the way passing the untouched raw string through
 *   would; logging surfaces the drift instead of hiding it.
 */
function normalizeCensusResponse(response: CensusResponse): CensusResponse {
  const marks = response.marks.map((m) => ({ ...m, brand: normalizeBrand(m.brand) }));
  const markKeys = new Set(marks.map((m) => productKey(m.name, m.brand)));

  const inViewCounts = response.inViewCounts.map((entry) => {
    const rederived = reDeriveFromRawKey(entry.productKey);
    if (!markKeys.has(rederived)) {
      console.warn(
        `[recognize] inViewCounts productKey "${entry.productKey}" (re-derived as ` +
          `"${rederived}") does not match any mark in this response; keeping the ` +
          "re-derived key rather than dropping the entry.",
      );
    }
    return { ...entry, productKey: rederived };
  });

  return { ...response, marks, inViewCounts };
}

// ---------------------------------------------------------------------------
// Recognition core
// ---------------------------------------------------------------------------

/** Labels every marked region in a full cart frame. */
export async function runCensus(image: Buffer, marks: Mark[]): Promise<CensusResponse> {
  const composited = await compositeMarks(image, marks, CENSUS_LONG_EDGE);

  const outputText = await requestOutputText("runCensus", {
    model: MODELS.census,
    reasoning: { effort: "none" },
    input: [
      { role: "system", content: CENSUS_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "input_text", text: censusUserText(marks) },
          { type: "input_image", image_url: dataUrl(composited), detail: "auto" },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "cart_census",
        strict: true,
        schema: censusJsonSchema,
      },
    },
  });

  const parsed = CensusResponse.parse(JSON.parse(outputText));
  return normalizeCensusResponse(parsed);
}

/** Resolves one uncertain item from a tight, high-resolution crop. */
export async function runIdentify(crop: Buffer, hint: string | null): Promise<IdentifyResponse> {
  const text = hint
    ? `An earlier pass guessed: "${hint}". Confirm or correct it.`
    : "Identify this product.";

  const outputText = await requestOutputText("runIdentify", {
    model: MODELS.identify,
    reasoning: { effort: "low" },
    input: [
      { role: "system", content: IDENTIFY_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "input_text", text },
          { type: "input_image", image_url: dataUrl(crop), detail: "auto" },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "product_identification",
        strict: true,
        schema: identifyJsonSchema,
      },
    },
  });

  const parsed = IdentifyResponse.parse(JSON.parse(outputText));
  return { ...parsed, brand: normalizeBrand(parsed.brand) };
}
