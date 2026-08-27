import sharp from "sharp";
import OpenAI, { APIError, APIConnectionError, APIConnectionTimeoutError } from "openai";
import { openai, MODELS } from "./openai.js";
import { compositeMarks, orientedSize, type Box, type Mark } from "./compositor.js";
import {
  CensusResponse,
  IdentifyResponse,
  censusJsonSchema,
  identifyJsonSchema,
  productKey,
} from "./schemas.js";
import { CENSUS_SYSTEM_PROMPT, IDENTIFY_SYSTEM_PROMPT, censusUserText } from "./prompts.js";
import { localCensusUrl, runCensusLocally } from "./localCensus.js";
import { installUsageReporter, recordUsage } from "./usage.js";

/**
 * The badged frame is sent at this long edge. 1024 was chosen before there was a photograph to
 * check it against; a phone photograph is 5712 by 4284, so it was a 5.6x downscale.
 *
 * Measured on the real trolleys, six census calls per setting, against a cauliflower whose
 * wrapper legibly reads "Mr. Lucky":
 *
 *   1024   2 of 6 read the brand right, the rest "Marketside", "Mia Luck", "Kart", none
 *   1536   6 of 6                       4683 input tokens against 3531
 *   2048   6 of 6                       5551 input tokens, and nothing 1536 does not do
 *
 * needsCloserLook was false on all eighteen, so a misread here is never referred to identify
 * and reaches the shopper's bag under a brand that is not on the packet. That is what the extra
 * thousand tokens buy.
 */
const CENSUS_LONG_EDGE = (() => {
  // `KART_CENSUS_LONG_EDGE` overrides it for the eval harnesses only, and the answer is recorded
  // here so the question is not reopened. 2048 was swept once before, but against the old rule 12,
  // when every resolution returned an empty unmarkedItems and the sweep could only report zeroes.
  // Asked again on a pipeline that can answer, over two rounds of five passes on the six trolley
  // photographs, 2048 against 1536:
  //   photographs exact          49 of 60  ->  41 of 60
  //   products found, lenient   282 of 310 -> 276 of 310
  //   lines matching nothing     36        ->  46
  //   badge alignment           218 of 250 -> 210 of 250
  // Worse on everything except strict identifications, which move 260 to 262 and are noise at that
  // size. The reason is the one this corpus keeps giving: more pixels is more for the census to
  // say, and the extra things it finds are net wrong. Resolution looked like the exception, since
  // it adds legibility rather than content, and it is not one.
  // Bounded, because this is an env var in shipped server code and it sets an image dimension.
  // `15360` typed for `1536` would have `compositeMarks` build roughly a hundred times the pixels,
  // past the 60 megapixel ceiling `http.ts` enforces on incoming images and a plausible way to
  // exhaust a function's memory. The sweep that produced this number used 1024, 1536 and 2048, so
  // 4096 is generous for anything anyone would legitimately try; outside the range it falls back
  // rather than clamping, since a value that far out is a typo and not an intention.
  const raw = process.env.KART_CENSUS_LONG_EDGE?.trim();
  const value = raw ? Number(raw) : NaN;
  return Number.isFinite(value) && value >= 256 && value <= 4096 ? value : 1536;
})();

function dataUrl(jpeg: Buffer): string {
  return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
}

/**
 * Cuts a normalized, origin top-left box out of an image.
 *
 * The box is clamped to the image rather than rejected when it overhangs an edge. A tracked
 * item that is half out of frame is a normal thing for the client to ask about, and sharp's
 * extract() throws on an out-of-bounds region, so the clamp has to happen before it is called.
 *
 * `padding` widens the box by that fraction of its own size on every side. A tight crop of a
 * cereal box with the brand mark clipped off is measurably harder to identify than the same
 * crop with a little of the shelf around it.
 */
export async function cropToBox(image: Buffer, box: Box, padding = 0.08): Promise<Buffer> {
  const base = sharp(image).rotate(); // honour EXIF orientation, as compositeMarks does
  // Post-rotation dimensions. Against the stored pair this threw "bad extract area" outright on
  // an orientation 6 photograph, so identify never got to look at anything the census flagged.
  const meta = orientedSize(await base.metadata());

  const padX = box.w * padding;
  const padY = box.h * padding;
  const left = Math.max(0, Math.min(1, box.x - padX));
  const top = Math.max(0, Math.min(1, box.y - padY));
  const right = Math.max(0, Math.min(1, box.x + box.w + padX));
  const bottom = Math.max(0, Math.min(1, box.y + box.h + padY));

  const px = {
    left: Math.floor(left * meta.width),
    top: Math.floor(top * meta.height),
    width: Math.round((right - left) * meta.width),
    height: Math.round((bottom - top) * meta.height),
  };
  if (px.width < 1 || px.height < 1) throw new Error("box has no area inside the image");
  // Rounding can push the far edge one pixel past the image on a box flush with the border.
  px.width = Math.min(px.width, meta.width - px.left);
  px.height = Math.min(px.height, meta.height - px.top);
  if (px.width < 1 || px.height < 1) throw new Error("box has no area inside the image");

  return base.extract(px).jpeg({ quality: 90 }).toBuffer();
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
 * Extracts a short, safe label for what actually failed inside an APIConnectionError's cause
 * chain, without ever surfacing the cause verbatim.
 *
 * The SDK's underlying fetch call commonly wraps the real failure as `TypeError: fetch
 * failed` with a `.cause` holding the low-level error, which itself usually carries a short
 * `.code` such as "ECONNRESET", "ENOTFOUND", or "ECONNREFUSED" (a fixed-vocabulary syscall
 * identifier). That `.code` is what this walks the cause chain looking for, never `.message`:
 * `.message` on some cause chains echoes the request URL, and this file has no way to prove
 * that URL never carries anything sensitive, so it is never read here. If no `.code` turns up
 * within a few hops, the cause's own `.name` (also a short, fixed string such as "TypeError"
 * or "AbortError") is used instead; if there is no Error-shaped cause at all, a generic label
 * is returned.
 */
function describeConnectionCause(cause: unknown, depth = 0): string {
  if (depth > 3 || !(cause instanceof Error)) return "connection failed";
  const code = (cause as NodeJS.ErrnoException).code;
  if (typeof code === "string" && code.length > 0) return code;
  const inner = (cause as { cause?: unknown }).cause;
  if (inner !== undefined) return describeConnectionCause(inner, depth + 1);
  return cause.name;
}

/**
 * Turns a failed OpenAI call into a safe error to throw.
 *
 * This is deliberately narrow about what it reads off the SDK's error object.
 *
 * `APIConnectionError` and its subclass `APIConnectionTimeoutError` (thrown for fetch
 * failures, timeouts, and aborts, per `node_modules/openai/client.mjs`) carry no `status`,
 * `code`, or `type`: those fields are always `undefined` on a connection failure, which is
 * why they must be checked, and handled, before the generic `APIError` branch below. Without
 * this a timeout, a DNS failure, a connection reset, and a client abort were all
 * indistinguishable, collapsing to the same "unknown status api_error" string. Only the
 * error's class (timeout or not) and a short, safe cause label (see describeConnectionCause)
 * are surfaced, never `.message` and never `.cause` verbatim, since a connection error's
 * cause chain can in principle carry request metadata.
 *
 * The generic `APIError` branch (401, 429, 500, and so on) reads only small categorical
 * fields (HTTP status, the SDK's `code` or `type` string), never `error.message` or the
 * parsed error body: OpenAI's own 401 invalid_api_key response echoes the offending key back
 * inside `error.message` so a human can spot their typo, and `APIError.headers` is the raw
 * response Headers object, so neither is ever read here.
 *
 * Every branch's composed result is still passed through redactSecrets as a last line of
 * defence in case one of the fields used above is ever key-shaped. Non-APIError failures
 * (a thrown non-Error value, or a genuine bug elsewhere) fall back to `err.message` /
 * `String(err)`, which is not known to carry the key, but is redacted for the same reason.
 */
function toSafeError(context: string, err: unknown): Error {
  if (err instanceof APIConnectionTimeoutError) {
    return new Error(redactSecrets(`${context}: OpenAI request timed out`));
  }
  if (err instanceof APIConnectionError) {
    const reason = describeConnectionCause(err.cause);
    return new Error(redactSecrets(`${context}: OpenAI connection failed (${reason})`));
  }
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
/**
 * Sampling temperature for the census call, for the eval harnesses only.
 *
 * The shipped call sends no temperature, so the API default applies. This override exists to
 * answer one question, and the answer is recorded here so it is not asked twice: pinning the
 * sampling does NOT reduce the run-to-run spread, and does not improve the counts.
 *
 * The API offers exactly two determinism handles and neither works here. `seed` is rejected
 * outright by this model on the Responses API (400, "Unknown parameter: 'seed'"). `temperature`
 * is accepted, and at 0 the model is still not deterministic: fifteen passes over the six
 * photographs returned 26 to 33 units for the same fixed inputs.
 *
 * Measured over three independent rounds of five passes, temperature 0 against the default:
 *   photographs exact  22, 21, 22 of 30   ->  24, 23, 22 of 30   (65/90 -> 69/90)
 *   units in the bag   29.0 mean          ->  30.0 mean          (31 real)
 *   badge alignment    21 of 23, every pass, in both arms
 * The first two rounds favoured temperature 0 and the third tied, with the two arms' unit
 * means converging as passes accumulated. Four counts in ninety is 0.7 standard errors. That
 * is the corpus's own noise, not an effect, so the shipped call is left as it was.
 *
 * The consequence is the useful part: the spread on this corpus is irreducible through
 * sampling controls, so a change worth one or two units cannot be told from noise here. That
 * is a property of the measurement, not of any particular fix.
 */
const CENSUS_TEMPERATURE = (() => {
  // Bounded to the range the API accepts, for the same reason as the long edge above: an
  // out-of-range value here would fail every census call with a 400 rather than fall back.
  const raw = process.env.KART_CENSUS_TEMPERATURE?.trim();
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && value <= 2 ? value : undefined;
})();

/**
 * Reasoning effort for `runIdentify`, overridable for the eval harnesses only.
 *
 * Bounded to the values the API accepts, for the same reason as the census temperature above: an
 * unrecognised value would fail every identify call with a 400 rather than fall back to the
 * default. Unset is the shipped behaviour and leaves the call exactly as it was.
 */
const IDENTIFY_EFFORT: "none" | "low" | "medium" | "high" = (() => {
  const raw = process.env.KART_IDENTIFY_EFFORT?.trim();
  return raw === "none" || raw === "low" || raw === "medium" || raw === "high" ? raw : "low";
})();

async function requestOutputText(
  context: string,
  params: OpenAI.Responses.ResponseCreateParamsNonStreaming,
): Promise<string> {
  // Every OpenAI call in this project comes through here, which is the whole reason the token
  // count is taken here and not in the callers. See `usage.ts` for what went wrong without it.
  installUsageReporter();
  try {
    const response = await openai.responses.create(params);
    // After the await, so a failed call is not counted as spend. A 429 or a 400 bills nothing,
    // and counting it would inflate the total in exactly the situation someone is reading it.
    recordUsage(
      typeof params.model === "string" ? params.model : "unknown",
      response.usage?.input_tokens,
      response.usage?.output_tokens,
      response.usage?.input_tokens_details?.cached_tokens,
    );
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
 *
 * Splits on the first "::" (a brand should never legitimately contain the separator). A
 * string with no separator at all is treated here as an all-name, no-brand guess; the caller
 * (normalizeCensusResponse) may improve on that guess afterwards by matching the whole
 * string against a mark's name alone, since a missing separator does not actually mean the
 * item has no brand, only that the model did not delimit one.
 *
 * A string with more than one "::" is handled explicitly rather than left to a naive split:
 * productKey()'s own normalisation strips ":" characters outright with no word boundary, so
 * a stray "::" left inside the name half would silently concatenate the words on either side
 * of it, for example "Kellogg's::Froot::Loops" naively re-deriving to "kelloggs::frootloops"
 * instead of "kelloggs::froot loops". Any "::" beyond the first is therefore replaced with a
 * space before the name half is normalised, preserving the word boundary the model was
 * clearly trying to express.
 */
function reDeriveFromRawKey(raw: string): string {
  const sep = raw.indexOf("::");
  if (sep === -1) return productKey(raw, null);
  const brandPart = raw.slice(0, sep);
  const namePart = raw.slice(sep + 2).split("::").join(" ");
  return productKey(namePart, normalizeBrand(brandPart));
}

/**
 * Per-entry outcome of re-deriving one inViewCounts productKey, and the merge record for
 * entries that collapsed into the same canonical key. Exported so callers can distinguish a
 * legitimate case (an entry that turned out to describe something in unmarkedItems) from a
 * real failure (a key that could not be resolved at all), which a single console.warn line
 * cannot express on its own.
 */
export type CensusKeyOutcome = { raw: string; canonical: string };
export type CensusMergedEntry = { canonical: string; rawKeys: string[]; count: number };

/**
 * Optional diagnostics sink for runCensus's productKey re-derivation. `CensusResponse` is the
 * strict wire schema shared with the model and other tasks, so it cannot grow a field for
 * this without breaking that contract; passing a sink object here instead lets a caller
 * observe what happened without changing the response shape. runCensus populates (overwrites)
 * every array on the object passed in; it does not require the caller to pre-fill them with
 * anything other than empty arrays.
 */
export type CensusDiagnostics = {
  /** Entries resolved to a mark in this response, whether or not the raw string needed correcting. */
  repaired: CensusKeyOutcome[];
  /** Entries that matched no mark but whose name matches an unmarkedItems description, a legitimate case, not a failure. */
  plausiblyUnmarked: CensusKeyOutcome[];
  /** Entries that could not be resolved to a mark or an unmarked item at all. */
  unrepaired: CensusKeyOutcome[];
  /** Sets of raw entries that re-derived to the same canonical key and were merged, with their summed count. */
  merged: CensusMergedEntry[];
};

/**
 * Replaces every inViewCounts[].productKey with a value re-derived server-side, normalises
 * every mark's brand the same way marks are used to derive those keys, merges entries that
 * re-derive to the same canonical key, and optionally records what happened into `diagnostics`.
 *
 * Matching strategy: an inViewCounts entry carries no numeric mark id, only the productKey
 * string, so there is no direct foreign key from an entry to the mark or marks it is
 * counting. Instead, every mark in this same response has its own name and brand fields,
 * independently typed and validated field-by-field by the schema, which is a more reliable
 * source of truth than a single hand-formatted composite string. Those fields are run through
 * productKey() to build the set of canonical keys this response could legitimately be
 * counting, the entry's raw key is re-derived the same way (see reDeriveFromRawKey), and the
 * two are compared:
 *
 * - If the re-derived key matches a mark's canonical key, that canonical key is used
 *   ("repaired"). This covers both the no-op case (the raw key was already correct) and the
 *   common repair: same product, but the model's hand-formatted "brand::name" string
 *   drifted in case, punctuation, or accents from what it separately put in that mark's own
 *   name/brand fields.
 * - If the raw key had no "::" separator at all and still matches no mark, its normalised
 *   text is compared against every mark's name alone (ignoring brand). A single, unambiguous
 *   match is still a repair: the model simply failed to delimit a brand it otherwise got
 *   right, and defaulting to "no brand" here would silently discard a real one.
 * - If it still matches no mark, its normalised name is checked against every description in
 *   unmarkedItems. A match there is a legitimate, expected case ("plausiblyUnmarked"): the
 *   model is counting something it only ever described as unmarked, not a broken key. This
 *   case does not warn, and is recorded separately from a genuine failure.
 * - Only if none of the above apply is the entry treated as a genuine failure
 *   ("unrepaired"): a warning is logged naming both the original and re-derived strings, and
 *   the entry is kept, not dropped, carrying its best-effort re-derived key. The eval harness
 *   reads the returned data, not stderr, so this cannot silently corrupt a comparison the way
 *   passing the untouched raw string through would; logging surfaces the drift instead of
 *   hiding it.
 *
 * Finally, any entries that re-derived to the same canonical key (for example two different
 * raw phrasings of the same product) are merged into one, their counts summed, so a
 * downstream reduction that assumes at most one entry per key is not silently short a count.
 */
function normalizeCensusResponse(
  response: CensusResponse,
  diagnostics?: CensusDiagnostics,
): CensusResponse {
  // A photograph of a shop's shelves is not a cart, and nothing that comes back about one may
  // reach a bag.
  //
  // Rule 13 already forbids counting "shelves, displays, other shoppers' carts, the floor and
  // anything held in a hand", and the model ignores it per badge: measured on the four shelf
  // photographs in the kart corpus it called 102 of 102 badges products and refused none, which
  // would have put up to 41 items a shopper is not buying into their bag, silently and with
  // confident names. Asked the same question once about the whole photograph instead, it is right
  // 10 times out of 10, false on all four shelves and true on all six trolleys.
  //
  // Emptied here rather than at a caller so that every client is covered by one check, including
  // one too old to know the field exists. `occlusion` is kept because it describes the photograph
  // rather than the goods, and the absent case reads as a cart, which is what every caller
  // assumed before this field existed.
  if (response.subjectIsCart === false) {
    return { ...response, marks: [], unmarkedItems: [], inViewCounts: [] };
  }

  const marks = response.marks.map((m) => ({ ...m, brand: normalizeBrand(m.brand) }));
  const markKeys = new Set(marks.map((m) => productKey(m.name, m.brand)));

  // Index every mark's canonical key by its normalised name segment alone, so a raw
  // productKey that omitted "::" entirely can still be matched to the mark it almost
  // certainly means, instead of defaulting to "no brand" and silently discarding a real one.
  const byNameSegment = new Map<string, string[]>();
  for (const key of markKeys) {
    const nameSegment = key.slice(key.indexOf("::") + 2);
    const list = byNameSegment.get(nameSegment) ?? [];
    list.push(key);
    byNameSegment.set(nameSegment, list);
  }

  // Match on the name segment either way: the model's own key is the reliable one now that
  // unmarkedItems carries it, but a key derived from the description still catches the case
  // where the model reports a name-only key alongside a branded count for the same product.
  const unmarkedNameSegments = new Set(
    response.unmarkedItems.flatMap((u) => [
      u.productKey.slice(u.productKey.indexOf("::") + 2),
      productKey(u.description, null).slice(2),
    ]),
  );

  const repaired: CensusKeyOutcome[] = [];
  const plausiblyUnmarked: CensusKeyOutcome[] = [];
  const unrepaired: CensusKeyOutcome[] = [];
  const merged = new Map<string, { count: number; rawKeys: string[] }>();

  for (const entry of response.inViewCounts) {
    const hasSeparator = entry.productKey.includes("::");
    let canonical = reDeriveFromRawKey(entry.productKey);
    let matchedMark = markKeys.has(canonical);

    if (!matchedMark && !hasSeparator) {
      // canonical is "::" + norm(raw) here, since there was no separator to split on.
      const nameOnly = canonical.slice(2);
      const candidates = byNameSegment.get(nameOnly);
      if (candidates && candidates.length === 1) {
        canonical = candidates[0];
        matchedMark = true;
      }
    }

    if (matchedMark) {
      repaired.push({ raw: entry.productKey, canonical });
    } else {
      const nameSegment = canonical.slice(canonical.indexOf("::") + 2);
      if (unmarkedNameSegments.has(nameSegment)) {
        plausiblyUnmarked.push({ raw: entry.productKey, canonical });
      } else {
        console.warn(
          `[recognize] inViewCounts productKey "${entry.productKey}" (re-derived as ` +
            `"${canonical}") does not match any mark or unmarked item in this response; ` +
            "keeping the re-derived key rather than dropping the entry.",
        );
        unrepaired.push({ raw: entry.productKey, canonical });
      }
    }

    const existing = merged.get(canonical);
    if (existing) {
      existing.count += entry.count;
      existing.rawKeys.push(entry.productKey);
    } else {
      merged.set(canonical, { count: entry.count, rawKeys: [entry.productKey] });
    }
  }

  const inViewCounts = [...merged.entries()].map(([key, { count }]) => ({
    productKey: key,
    count,
  }));

  if (diagnostics) {
    diagnostics.repaired = repaired;
    diagnostics.plausiblyUnmarked = plausiblyUnmarked;
    diagnostics.unrepaired = unrepaired;
    diagnostics.merged = [...merged.entries()]
      .filter(([, v]) => v.rawKeys.length > 1)
      .map(([canonical, v]) => ({ canonical, rawKeys: v.rawKeys, count: v.count }));
  }

  // Rule 16 defines itemsLikelyHidden as a function of severity: true for "some" or "many",
  // false only for "none". Two fields carrying one fact will disagree eventually, and on a real
  // response they did, coming back "some" with itemsLikelyHidden false. Derive it here so the
  // pair cannot contradict itself downstream. The model is still asked for both, because being
  // asked to state the consequence is part of what makes it choose the severity carefully.
  const occlusion = {
    ...response.occlusion,
    itemsLikelyHidden: response.occlusion.severity !== "none",
  };

  return { ...response, marks, inViewCounts, occlusion };
}

// ---------------------------------------------------------------------------
// Recognition core
// ---------------------------------------------------------------------------

/**
 * Labels every marked region in a full cart frame.
 *
 * `diagnostics` is optional and defaults to nothing: existing two-argument callers are
 * unaffected. Pass an (empty-array-initialised) CensusDiagnostics object to have this call
 * populate it with how inViewCounts productKeys were resolved.
 */
export async function runCensus(
  image: Buffer,
  marks: Mark[],
  diagnostics?: CensusDiagnostics,
  /** Product names the session has already counted, so this call can reuse them verbatim. */
  alreadyCounted: string[] = [],
): Promise<CensusResponse> {
  // The local fallback, for an account with no credit. Unset is the normal state: when
  // LOCAL_CENSUS_URL is empty this branch never runs and everything below is unchanged. See
  // localCensus.ts for what it costs in accuracy, which is real and measured.
  const localUrl = localCensusUrl();
  if (localUrl.length > 0) {
    // Normalized like every other census, not returned raw. This branch used to return early and
    // so skipped `normalizeCensusResponse` entirely, which meant brand normalization, canonical
    // productKey re-derivation, same-key merging and the not-a-cart guard all applied to the
    // OpenAI census and to nothing else. That guard's own comment says it lives there "so that
    // every client is covered by one check"; one census answering by a different set of rules
    // than the other is exactly what it was written to prevent.
    //
    // Measured consequence of the gap, on a real trolley photograph through the local model:
    // `subjectIsCart` came back false and twelve named products came back with it, when the
    // shipped path would have emptied all twelve. Two censuses, same field, opposite meanings.
    //
    // Safe to apply now only because `localvlm/serve.py` no longer reports a cart verdict it
    // cannot make; see the measurement recorded there before changing that back.
    return normalizeCensusResponse(
      await runCensusLocally(image, marks, alreadyCounted, localUrl),
      diagnostics,
    );
  }

  const composited = await compositeMarks(image, marks, CENSUS_LONG_EDGE);

  const outputText = await requestOutputText("runCensus", {
    model: MODELS.census,
    // Routes calls sharing this prefix to the same cache. CENSUS_SYSTEM_PROMPT is 2,177 tokens
    // and sits first in `input`, comfortably over the 1,024-token minimum, so the discount is
    // available with or without this; the key raises the hit rate by keeping these requests on
    // one cache rather than scattering them. Caching is what makes the prompt nearly free on
    // every call after the first, and the retention window is far longer than one scan, so the
    // saving carries across sessions and across shoppers rather than resetting each time.
    //
    // One key per task, not per user: the prefix is identical for everyone, so splitting by user
    // would fragment the cache and lose the thing it is for. At high volume this needs sharding
    // instead, since a single key is only reliable to roughly 15 requests per minute.
    prompt_cache_key: "kart-census",
    reasoning: { effort: "none" },
    ...(CENSUS_TEMPERATURE === undefined ? {} : { temperature: CENSUS_TEMPERATURE }),
    input: [
      { role: "system", content: CENSUS_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "input_text", text: censusUserText(marks, alreadyCounted) },
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
  return normalizeCensusResponse(parsed, diagnostics);
}

/**
 * Resolves one uncertain item from a tight, high-resolution crop.
 *
 * `image` is the full keyframe the client already uploaded; when `box` is given, it is
 * cropped down to that region here (see cropToBox) before being sent to the model. Without a
 * box, `image` is sent as-is, which is what every existing caller of this function still does.
 */
export async function runIdentify(
  image: Buffer,
  hint: string | null,
  box: Box | null = null,
): Promise<IdentifyResponse> {
  // Cropping here rather than on the device means one upload per keyframe instead of one per
  // uncertain item, and the crop is taken at the frame's full resolution.
  const crop = box ? await cropToBox(image, box) : image;

  const text = hint
    ? `An earlier pass guessed: "${hint}". Confirm or correct it.`
    : "Identify this product.";

  const outputText = await requestOutputText("runIdentify", {
    model: MODELS.identify,
    prompt_cache_key: "kart-identify",
    // IDENTIFY_SYSTEM_PROMPT is 260 tokens, well under the 1,024-token cache minimum, so unlike
    // the census nothing here is cacheable and the whole input is billed at full rate every call.
    //
    // Which puts the weight on output, and reasoning tokens bill at the output rate. That rate is
    // the expensive one: at six calls a scan, identify's output is roughly half of what identify
    // costs. The census next door runs at effort "none"; this has always run at "low", and the
    // difference was never measured. The task is one tight crop of one product, closer to reading
    // a label than to reasoning about a scene, so "none" is plausible and untested rather than
    // known to be wrong. `KART_IDENTIFY_EFFORT` exists to put a number on it before changing it.
    reasoning: { effort: IDENTIFY_EFFORT },
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
