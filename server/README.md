# Kart recognition service

A standalone Vercel service (own `package.json`, separate from the Expo app at the repo
root) that identifies grocery products in photos of a shopping cart, for the iOS app Kart.
It wraps the OpenAI Responses API behind two HTTP endpoints and keeps the API key server
side. It does not do any on-device work, tracking, or barcode lookup; those belong to later
plans (see "What this service does not do" below).

## Status

The code is built and covered by 219 tests (`npm test`) and a clean `npm run typecheck`.
No live call to OpenAI has ever succeeded from this codebase (see "Known limitations"), no
cart photos exist in the eval corpus, and this service has never been deployed. Read
"Accuracy baseline" and "Known limitations" before relying on anything here.

## Requirements

- Node.js. The deployed Vercel runtime is `nodejs22.x` (see `vercel.json`); any reasonably
  recent Node works for local `test`/`typecheck`/`eval`, which all run through `tsx`,
  `vitest`, and `tsc`, not through the Vercel runtime itself.
- A real OpenAI API key with access to the models in `src/openai.ts` (see "Models and
  reasoning efforts"). The only key available while building this service returned 401, so
  nothing here has been exercised against the real API.

## Setup

```bash
cd server
npm install
cp .env.example .env
# edit .env and set OPENAI_API_KEY to a real key, then never commit it
```

`src/openai.ts` reads `OPENAI_API_KEY` from the environment and throws at import time if it
is unset. Anything that imports `src/recognize.ts` (which imports `src/openai.ts`) requires
the key to be present, including `npm run eval` once the corpus is non-empty. `npm test` and
`npm run typecheck` do not need a real key: the test suite mocks the OpenAI client.

## Endpoints

Both endpoints are POST-only Vercel functions (`export const config = { runtime: "nodejs" }`
in each file); any other method returns `405 { "error": "Method not allowed" }`. Both accept
a JSON body (`content-type: application/json`, no charset or other parameter) and both return
one of these two envelopes:

```json
{ "ok": true, "result": { ... } }
```

```json
{ "error": "Bad request" }
```

```json
{ "error": "Recognition failed" }
```

`"Bad request"` (status 400) means the request itself was malformed: wrong content type, body
too large, body is not a JSON object, the image did not decode, the image's decoded pixel
dimensions exceeded the ceiling, or (census only) `marks` was malformed. `"Recognition
failed"` (status 500) means the request was well-formed but the call to OpenAI failed or
timed out. Neither error body ever includes the underlying error message; the real error is
logged server side only (`src/http.ts`, `fail()`), specifically so a leaking OpenAI error
string (which can echo request context, and in some failure modes the key itself) never
reaches the client.

### `POST /api/census`

Labels every marked region in one full cart photo, plus anything else visible that has no
mark. This is the primary endpoint: one call per keyframe from the capture pipeline.

Request body:

```ts
{
  image: string;   // base64, or a data URL like "data:image/jpeg;base64,..."
  marks?: Array<{
    id: number;               // integer, unique within the request
    box: { x: number; y: number; w: number; h: number }; // normalized 0..1, origin top-left
  }>;
}
```

`marks` is optional and defaults to `[]`. Up to 40 marks are accepted per request
(`MAX_MARKS` in `api/census.ts`); more than that is rejected before any compositing or model
call happens. If `marks` is empty, the prompt asks the model to list everything it sees in
`unmarkedItems` instead of labelling numbered regions.

`result` on success (`CensusResponse`, `src/schemas.ts`):

```ts
{
  marks: Array<{
    id: number;
    name: string;                 // product name alone, e.g. "Froot Loops"
    brand: string | null;         // e.g. "Kellogg's"; null if illegible or genuinely unbranded
    size: string | null;
    category: string;             // free-text aisle category, e.g. "cereal"
    confidence: number;           // 0..1
    needsCloserLook: boolean;
  }>;
  unmarkedItems: Array<{
    description: string;
    approxLocation: string;       // free-text, e.g. "top of cart, left side"
    confidence: number;
  }>;
  inViewCounts: Array<{
    productKey: string;           // "brand::name", see productKey() below
    count: number;                // distinct physical units visible in this one image, >= 0
  }>;
  occlusion: {
    itemsLikelyHidden: boolean;   // true iff severity is "some" or "many"
    severity: "none" | "some" | "many";
    reason: string;
  };
}
```

One detail worth knowing if you consume this response: `inViewCounts[].productKey` is not
passed through verbatim from the model. `runCensus` (`src/recognize.ts`) re-derives every
`productKey` from that response's own `marks[].name`/`marks[].brand` fields (a more reliable
source than a single hand-formatted string), repairs small drift (case, punctuation, accents),
matches keys with no `::` separator against a mark by name alone when the match is
unambiguous, and merges entries that re-derive to the same canonical key, summing their
counts. This repair step is internal; the HTTP handler does not expose the diagnostics
(`CensusDiagnostics`) it can optionally produce. Only `eval/run-eval.ts` reads that
diagnostics object, to report how many keys needed repair.

### `POST /api/identify`

Resolves one uncertain item from a tight, high-resolution crop, optionally given an earlier
guess to confirm or correct.

Request body:

```ts
{
  image: string;    // base64, or a data URL, same rules as census
  hint?: string;     // optional; empty string is treated as no hint; truncated to 200 chars
}
```

`result` on success (`IdentifyResponse`, `src/schemas.ts`):

```ts
{
  name: string;
  brand: string | null;
  size: string | null;
  category: string;
  confidence: number;      // 0..1
  stillUnclear: boolean;   // true if the crop was too blurry/dark/partial to be sure
}
```

### `productKey`

`productKey(name, brand)` (`src/schemas.ts`) is the stable identity used to count and dedupe
products across calls, since the model will not phrase the same product identically every
time. It lowercases, NFD-normalizes and strips diacritics (accents fold to the base letter,
so "Café Bustelo" and "Cafe Bustelo" key identically), strips everything outside `[a-z0-9 ]`,
collapses whitespace, and joins as `"brand::name"` (empty string for no brand, e.g.
`"::bananas"`). See "Known limitations" for where this breaks down.

### Shared request limits (`src/http.ts`)

Both endpoints enforce the same limits before any image decoding or model call:

- Content-Length, if the client sends one, must declare no more than 20 MB
  (`MAX_REQUEST_BYTES`). This is a best-effort check against a header a client can omit or
  lie about; the real backstop is the decoded-size check below.
- Content-Type must be exactly `application/json` (parameters like a charset are stripped
  before comparing, but the media type itself must match).
- The parsed body must be a JSON object, not an array, string, number, boolean, or null.
- The `image` field must be a non-empty base64 string (an optional `data:image/...;base64,`
  prefix is stripped first). Its decoded bytes must be at most 12 MB (`MAX_IMAGE_BYTES`), must
  be non-empty, and must start with a recognized image signature: JPEG, PNG, WEBP, or an ISO
  base media container (HEIC/HEIF/AVIF, the formats an iPhone camera commonly produces). The
  base64 string itself is also bounded before decoding, so an oversized payload is rejected
  without ever allocating the full decoded buffer.
- The image's decoded pixel dimensions (width times height, read from container/header
  metadata only, not a full decode) must be at most 60,000,000 pixels (`MAX_PIXELS`). A 48MP
  iPhone photo (about 48.8 million pixels) clears this with roughly 20% headroom; this exists
  because a crafted small-file, huge-dimension image can stay well under the 12 MB byte
  ceiling while still being dangerous to composite (see the comment above `MAX_PIXELS` in
  `src/http.ts` for the measured memory profile that motivated the number).
- Each handler races the OpenAI call against a 25 second soft timeout (`REQUEST_TIMEOUT_MS`),
  comfortably inside the 30 second `maxDuration` Vercel enforces for these functions
  (`vercel.json`: `nodejs22.x`, `maxDuration: 30`, `memory: 2048`). If the model has not
  responded by then, the handler returns a clean `500 { "error": "Recognition failed" }`
  instead of letting Vercel hard-kill the process mid-request. See "Known limitations" for
  what this does not do (cancel the underlying call).
- Census additionally caps `marks` at 40 entries, each with a unique integer `id` and a box
  whose `x`/`y`/`w`/`h` are finite numbers between 0 and 1.

## Models and reasoning efforts

Defined in `src/openai.ts`:

| Purpose | Model | Reasoning effort | Used by |
|---|---|---|---|
| Census: label every marked region in a full frame | `gpt-5.4-mini` | `"none"` | `runCensus` (`src/recognize.ts`) |
| Identify: resolve one tight crop of an uncertain item | `gpt-5.4` | `"low"` | `runIdentify` (`src/recognize.ts`) |
| Escalation for items identify still cannot resolve | `gpt-5.5` | (not applicable) | defined in `MODELS.escalate`, not called by any code path yet |

Both calls go through the Responses API (`openai.responses.create`) with strict-mode
structured outputs (`text.format.type: "json_schema"`, `strict: true`, schemas from
`censusJsonSchema`/`identifyJsonSchema` in `src/schemas.ts`), and the census system prompt is
sent first, alone, as a frozen string so it is eligible for prompt caching (see "Cost" below).

`MODELS.escalate` (`gpt-5.5`) exists as a named constant but nothing in `src/recognize.ts`
currently calls it. Wiring up an escalation path is out of scope for this plan.

## Running the tests and typechecking

```bash
cd server
npm test         # vitest run, 219 tests, no real API key needed (OpenAI client is mocked)
npm run typecheck # tsc --noEmit
```

## Running locally

There is no working local dev server. `npx vercel dev` cannot run against this repository:
the CLI rejects the `"nodejs22.x"` runtime string in `vercel.json`. Routing, validation, and
error handling are instead proven by tests that construct real `Request` objects and call the
exported handlers directly (`test/api-census.test.ts`, `test/api-identify.test.ts`); that is
the intended way to exercise this code without a deployment.

If you have a real API key and want to sanity-check the raw OpenAI request shape (structured
outputs, image input, and `reasoning.effort` together) without going through HTTP routing at
all, use the smoke script:

```bash
OPENAI_API_KEY=sk-... npm run smoke
```

It sends the first image in `eval/corpus/images/` through `openai.responses.create` with the
census model and prints `output_text` and `usage`. It requires at least one image in that
directory and a working key; as of this writing neither has been available, so this script
has never actually been run to completion either.

## Running the eval

`npm run eval` (`eval/run-eval.ts`) scores the census endpoint against a hand-labelled corpus
of cart photos. It runs with a single whole-image mark, so it measures the model's raw naming
ability independently of any detector; once a real detector exists, feeding its boxes in here
turns the same score into an end-to-end number.

To run it for real:

1. Add cart photos (`.jpg`, `.jpeg`, or `.png`) to `eval/corpus/images/`.
2. For each photo, add an entry to `eval/corpus/ground-truth.json`, keyed by the exact
   filename, following the labelling rules in `eval/corpus/README.md`:
   - `name`: the most specific name a shopper would use, including size if legible.
   - `brand`: the brand alone, or `null` for unbranded produce.
   - `qty`: how many distinct physical units of that product are in the cart (one bunch of
     bananas is 1, two identical bags of chips is 2).
   - `occluded`: `true` if a human can tell the item is there but cannot fully see it.
   - Only list items a human can genuinely see in the photo; guessing corrupts recall.
3. `OPENAI_API_KEY=sk-... npm run eval`

With an empty or partially-labelled corpus, the script prints a specific, actionable message
(which files have no ground truth, which ground truth entries have no matching file) and
exits 1 without making any API calls; it does not import `src/openai.ts` (and so does not
require a key) until it has confirmed there is at least one evaluable image.

Results stream live: progress prints to the console one line per image as it finishes, and
the same content is appended incrementally to `eval/results/latest.md` as each image
completes, not buffered until the end, so an interrupted run keeps every already-scored
image's section. The report scores two separate things:

- **Precision and recall** (`scoreImage`, presence/absence over `productKey`, quantity not
  considered): macro-averaged, meaning each image's own precision and recall is computed
  first, then averaged across images, so a 30-item photo and a 3-item photo count equally.
  Also reported with occluded ground-truth items excluded, alongside the all-items number.
- **Count accuracy** (`scoreCounts`, `inViewCounts` against ground-truth `qty`): a separate
  measurement, reported in its own section, because a product can be correctly identified and
  badly counted, or missing entirely (which is irrelevant to count accuracy). Reports exact
  match rate, mean signed error (positive means over-counting, negative means under-counting),
  and which product keys were over-counted, under-counted, missing from the prediction, or
  missing from the ground truth.

Exit code is `0` for a clean run (every evaluable image scored, zero errors), `1` for total
failure (empty corpus, or every evaluable image errored before producing a score), `2` for
partial failure (at least one image scored and at least one errored; the summary numbers only
cover the images that scored). `eval/results/latest.md` states this scheme at the top of every
run's output. The eval writes with no file lock, so do not run two `npm run eval` invocations
against the same corpus at once; their appends to `latest.md` would interleave into one
garbled file.

## Accuracy baseline

**There is no baseline.** `eval/corpus/images/` currently contains only a `.gitkeep` file, and
`eval/corpus/ground-truth.json` is an empty object. No cart photos have been supplied and the
eval has never been run. Every accuracy claim about this service, precision, recall, count
accuracy, all of it, is unverified until someone adds photos, writes matching ground truth per
`eval/corpus/README.md`, sets a valid `OPENAI_API_KEY`, and runs `npm run eval` end to end. Do
not treat any number in this document as a measured result; none is given because none exists
yet.

## Cost

**No live call to this service has ever succeeded, so there is no measured per-scan cost.**
Treat everything in this section as an unverified estimate, not a bill anyone has seen.

The one concrete pricing data point in this codebase is a comment in `src/prompts.ts`: on
`gpt-5.4-mini` (the census model), cached input tokens are priced at $0.075 per 1M tokens
against $0.75 per 1M uncached. That is why `CENSUS_SYSTEM_PROMPT` is a single frozen string
placed first in the request, so it is eligible for that caching discount; anything volatile
(the per-request marks list, the image) is sent after it. This codebase does not have
confirmed output-token pricing for `gpt-5.4-mini`, or any pricing for `gpt-5.4` (the identify
model), so a full estimate of what one cart scan costs cannot be built from what is
documented here without guessing at numbers nobody has verified.

Qualitatively, the cost drivers per scan are: one census call per keyframe (image resized to a
1024px long edge before compositing, `CENSUS_LONG_EDGE` in `src/recognize.ts`, which bounds
image-token cost regardless of the source photo's resolution), plus zero or more identify
calls, one per item the census pass flagged with low confidence or `needsCloserLook`. A cart
with many uncertain items costs more than one where census resolves everything confidently in
a single call. Get a real number by running `npm run eval` (or a manual call) with a working
key and reading `response.usage` off the result; nothing here should be treated as that
number until someone has actually done that.

## Deploying

**This task did not run any `vercel` command.** No project has been linked, no environment
variable has been set on Vercel, and nothing has been deployed. The steps below are what you
run yourself, from `server/`, once you have a valid `OPENAI_API_KEY`.

```bash
cd server
npx vercel link
```

Confirm which Vercel account and project this links to before continuing; running `vercel
link` (or any `vercel` command without a linked project) can create a new project if you are
not careful about the prompts.

```bash
npx vercel env add OPENAI_API_KEY production
npx vercel env add OPENAI_API_KEY preview
```

Paste a real key when prompted, not the placeholder in `.env.example`.

```bash
npx vercel deploy
```

Verify the preview deployment before promoting it. Using one of the images already in the
corpus (once you have added some, see "Running the eval"):

```bash
PREVIEW_URL="https://your-preview-url.vercel.app"   # printed by the deploy command above
IMG=$(ls eval/corpus/images/* | head -1)
python3 -c "import base64,sys;print(base64.b64encode(open(sys.argv[1],'rb').read()).decode())" "$IMG" > /tmp/img.b64
python3 - <<'EOF' > /tmp/req.json
import json
print(json.dumps({
  "image": open("/tmp/img.b64").read().strip(),
  "marks": [{"id": 1, "box": {"x": 0.25, "y": 0.25, "w": 0.5, "h": 0.5}}]
}))
EOF
curl -s -X POST "$PREVIEW_URL/api/census" -H 'content-type: application/json' -d @/tmp/req.json | head -c 2000
```

Expected: `{"ok":true,"result":{"marks":[{"id":1,"name":"..."}],...}}`. Also confirm the error
path leaks nothing:

```bash
curl -s -X POST "$PREVIEW_URL/api/census" -H 'content-type: application/json' -d '{"image":""}'
```

Expected: exactly `{"error":"Bad request"}`.

Once you have verified the preview, promote to production:

```bash
npx vercel deploy --prod
```

## Open Food Facts attribution (needed by a later plan)

This service does not call Open Food Facts today; nothing in `server/` depends on it. A later
plan is expected to add a barcode fast path (on-device `VNDetectBarcodesRequest`, resolved
through Open Food Facts) as a free, no-API-key shortcut that skips the vision model when a UPC
is available. Whoever builds that needs to satisfy Open Food Facts' license:

- The Open Food Facts database is licensed under the **Open Database License (ODbL) v1.0**.
  Its data records are additionally available under the Database Contents License; product
  photos are separately licensed, commonly under Creative Commons Attribution-ShareAlike.
- ODbL's core obligations are attribution, share-alike, and keep-open: you must credit Open
  Food Facts and its contributors wherever you display data drawn from it; if you publicly
  produce a derivative database built from OFF data, that derivative must also be offered
  under ODbL; and you may not apply technical restrictions (like DRM) that would prevent
  others from exercising the same rights ODbL grants you.
- In practice for Kart, this means any screen that shows a product name, brand, or image
  resolved via an Open Food Facts barcode lookup needs a visible attribution to Open Food
  Facts near that data, and any local cache or derived dataset built from OFF responses needs
  to stay open under the same terms rather than becoming a private, closed catalog.
- Confirm current terms directly against Open Food Facts' own license page before shipping;
  this section is a starting point for that later plan, not a substitute for reading it.

## What this service does not do

Deliberately out of scope for this plan, carried forward to later ones (see the plan's
self-review for the full mapping):

- No barcode fast path or Open Food Facts lookup (on-device, needs `VNDetectBarcodesRequest`).
- No on-device detection, segmentation, or tracking (YOLOE Core ML export, ByteTrack,
  keyframe sharpness/stillness gating). `spike/detector/` holds an unrun spike for this; see
  "Known limitations".
- No track-based counting, in-view clamp, mask rendering, "move closer" guidance, or guided
  multi-angle capture.
- No ARKit anchoring or EdgeTAM; both are explicitly deferred by the product spec.

## Known limitations

These are real, current gaps, each surfaced during implementation review, not hypothetical
concerns:

- **No live API call has ever succeeded from this codebase.** The Responses API request shape
  (`reasoning.effort`, `input_image`, `text.format`) was verified against the installed
  `openai@6.49.0` type definitions, not against the real API over the wire. A first real call
  may still surface a mismatch that only shows up at runtime.
- **Whether OpenAI strict mode honors `minimum`/`maximum` for JSON Schema type `"integer"` is
  unresolved.** OpenAI's structured-outputs docs document that support for type `"number"` but
  are silent on `"integer"`. `InViewCount.count` therefore keeps its lower bound (`>= 0`) only
  in the zod schema, not in the wire JSON Schema sent to the model; a test in
  `test/schemas.test.ts` pins this asymmetry deliberately so it cannot silently change.
- **The 25 second soft timeout abandons the model call rather than cancelling it.** No
  `AbortSignal` is passed to `openai.responses.create`, so when the timeout fires first, the
  underlying call keeps running (and keeps billing) in the background until it finishes or
  Vercel's 30 second `maxDuration` kills the whole process.
- **`productKey` collapses some distinct products to the same or an empty key.** Non-Latin-
  script names (Cyrillic, CJK, and similar) and names that are emoji-only or punctuation-only
  strip down to an empty or partial key under the `[^a-z0-9 ]` filter, so genuinely different
  products in those cases can collide in the eval's scoring.
- **The eval has no write lock.** Two overlapping `npm run eval` runs against the same corpus
  would both append to `eval/results/latest.md` at once, truncating and interleaving into one
  garbled file.
- **`vercel dev` does not run locally against this repository**, because the CLI rejects the
  `"nodejs22.x"` runtime string in `vercel.json`. Routing and validation are proven instead by
  tests that invoke the handlers directly with real `Request` objects.
- **`spike/detector/` holds an unrun YOLOE detection spike** that is meant to gate the next
  plan's architecture (whether an off-the-shelf open-vocabulary segmenter can find distinct
  items in a cart photo reliably enough to drive track-based counting). It has no results and
  no verdict; it needs the same cart photos this eval corpus needs before anyone can run it.
