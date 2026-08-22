import sharp from "sharp";

export type Json = Record<string, unknown>;

export function json(body: Json, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Never let an upstream error message reach the client. It can contain request context and,
 * in some failure modes, fragments of the credential. Only the two fixed strings below are
 * ever sent; the real error is logged server side and nowhere else.
 */
export function fail(error: unknown, status = 500): Response {
  console.error("[recognition]", error);
  return json({ error: status === 400 ? "Bad request" : "Recognition failed" }, status);
}

/** Decoded image ceiling. Chosen to comfortably fit a modern phone photo while bounding memory use. */
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

/**
 * Base64 inflates size by roughly 4/3. Bounding the encoded string length before Buffer.from
 * ever runs stops a hostile client from making the process allocate a large decoded buffer
 * just to find out, one line later, that it was always going to be rejected for being too big.
 */
const MAX_BASE64_CHARS = Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 4096;

/**
 * Best-effort request body ceiling, checked against the Content-Length header before the body
 * is ever read. A hostile or buggy client can omit Content-Length, or send it under chunked
 * transfer encoding where there is no such header at all, in which case this check cannot
 * fire; the post-decode size checks in decodeBase64Image are the real backstop in that case.
 * This header check exists purely to avoid buffering an enormous, honestly labelled body when
 * we can see the size coming without reading a single byte of it.
 */
const MAX_REQUEST_BYTES = 20 * 1024 * 1024;

/** Throws if the caller declared (via Content-Length) a body bigger than we will ever accept. */
export function assertReasonableContentLength(req: Request): void {
  const header = req.headers.get("content-length");
  if (header === null) return;
  const declared = Number(header);
  if (!Number.isFinite(declared) || declared < 0) {
    throw new Error("content-length header is malformed");
  }
  if (declared > MAX_REQUEST_BYTES) {
    throw new Error("request body is too large");
  }
}

/** Throws unless the request is honestly labelled as a JSON body. */
export function assertJsonContentType(req: Request): void {
  const header = req.headers.get("content-type");
  const mediaType = header?.split(";")[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    throw new Error("content-type must be application/json");
  }
}

/**
 * Throws unless the parsed JSON body is a plain object. `req.json()` happily returns an
 * array, a string, a number, a boolean, or null for a technically valid JSON document, and
 * every field access below assumes an object; catching the mismatch here with one clear
 * message is better than letting a later property read on a non-object silently produce
 * `undefined` (harmless) or throw on `null` with a confusing internal message (still safe,
 * since fail() never echoes it, but this is clearer in the server log).
 */
export function assertJsonObject(body: unknown): asserts body is Record<string, unknown> {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("request body must be a JSON object");
  }
}

/**
 * Confirms the decoded bytes actually start with the signature of an image format sharp is
 * expected to handle, rather than letting arbitrary decoded bytes (text, HTML, a PDF, random
 * garbage) reach sharp and fail deeper in the stack with a less predictable error shape.
 * Deliberately only a cheap header sniff, not full decoding: sharp itself remains the source
 * of truth for whether the bytes are a well-formed image, this just rejects the obviously
 * wrong case early and cheaply.
 */
function looksLikeImage(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  // JPEG
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;
  // PNG
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return true;
  }
  // WEBP: "RIFF" .... "WEBP"
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return true;
  }
  // ISO base media container (HEIC/HEIF/AVIF), the formats an iPhone camera commonly produces:
  // bytes 4 through 7 spell "ftyp".
  if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) return true;
  return false;
}

export function decodeBase64Image(value: unknown, field: string): Buffer {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${field} must be a base64 string`);
  }
  const stripped = value.replace(/^data:image\/[a-z+]+;base64,/, "");
  if (stripped.length > MAX_BASE64_CHARS) {
    throw new Error(`${field} is too large`);
  }
  const buf = Buffer.from(stripped, "base64");
  if (buf.length === 0) throw new Error(`${field} did not decode to any bytes`);
  if (buf.length > MAX_IMAGE_BYTES) throw new Error(`${field} is too large`);
  if (!looksLikeImage(buf)) throw new Error(`${field} does not look like a supported image`);
  return buf;
}

/**
 * Ceiling on decoded pixel count (width * height), independent of the compressed byte size
 * check above. A crafted solid-colour JPEG can be well under the 12MB compressed-size ceiling
 * while still decoding to hundreds of millions of pixels: sharp/libvips's own default safety
 * limit (around 268 million pixels) is a last-resort backstop, not a sane operating ceiling,
 * and compositing a near-that-limit image has been measured (see task-8 review) at roughly
 * 1.68GB peak RSS, most of this function's 2048MB budget, for a single request.
 *
 * 60 megapixels is the chosen ceiling. A modern 48MP phone camera photo (the largest
 * mainstream case this service needs to accept, for example an 8064x6048 iPhone capture, about
 * 48.8 million pixels) clears this with roughly 20% headroom, while staying more than 4x below
 * sharp/libvips's own default 268 million pixel safety limit and nowhere near the memory
 * profile that made the crafted attack image dangerous.
 */
const MAX_PIXELS = 60_000_000;

/**
 * Rejects an image whose decoded pixel dimensions would be dangerous to composite, before any
 * of the expensive decode work in compositeMarks/sharp's resize pipeline runs. sharp's
 * `.metadata()` reads container/header fields only; for JPEG, PNG, WEBP, and the ISO base
 * media formats this service accepts, that means it does not decode full pixel data, so this
 * check stays cheap even against a maximal-size attack payload.
 */
export async function assertReasonablePixelDimensions(buf: Buffer): Promise<void> {
  let width: number | undefined;
  let height: number | undefined;
  try {
    ({ width, height } = await sharp(buf).metadata());
  } catch {
    throw new Error("image could not be read");
  }
  if (!width || !height) {
    throw new Error("image dimensions could not be determined");
  }
  if (width * height > MAX_PIXELS) {
    throw new Error("image dimensions are too large");
  }
}

/**
 * Function budget is 30s (server/vercel.json maxDuration). Racing the model call against a
 * budget comfortably inside that means a slow or hung upstream call ends in a clean JSON
 * error response the caller can parse, instead of Vercel hard-killing the function mid
 * flight and the caller seeing a bare connection failure. The losing side of the race (the
 * still-pending model call, if the timeout wins) is not cancelled: the OpenAI SDK call has no
 * cheap abort hook wired up here, and letting it run to completion in the background costs
 * nothing extra since the function process is bounded by the platform's own 30s ceiling
 * regardless.
 */
export const REQUEST_TIMEOUT_MS = 25_000;

/**
 * The 25s ceiling above is a property of the deployment, not of recognition: it exists because
 * Vercel hard-kills the function at 30s. A local host has no such platform ceiling, and the
 * local census (see `localCensus.ts`) asks one question per region on CPU or MPS, which takes
 * minutes rather than seconds on a loaded trolley.
 *
 * So the budget is overridable, and only upward in practice. Unset it behaves exactly as
 * before. It must never be raised on a Vercel deployment: a budget above the platform's own
 * ceiling turns the clean JSON error this race exists to produce back into the bare connection
 * failure it was written to prevent.
 */
function configuredTimeoutMs(): number {
  const raw = Number((process.env.RECOGNITION_TIMEOUT_MS ?? "").trim());
  return Number.isFinite(raw) && raw > 0 ? raw : REQUEST_TIMEOUT_MS;
}

export async function withTimeout<T>(promise: Promise<T>, ms = configuredTimeoutMs()): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("recognition timed out")), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}
