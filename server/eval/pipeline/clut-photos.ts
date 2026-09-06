/**
 * The photo capture path against fifteen of the owner's own photographs, scored on all four
 * of the requirements in CLAUDE.md.
 *
 * `photo-session.ts` proves accumulation across shutter presses on four images. This proves
 * recognition itself: each photograph is scanned into a *fresh* bag, so what is measured is what
 * one press of the button puts in front of the shopper, with no help from anything scanned
 * before it and no way for a later photograph to cover an earlier miss.
 *
 * It drives the shipped `scanPhoto` through the shipped `requestCensus` against the running
 * service, so the only thing between this harness and the phone is the camera.
 *
 * Start the service first, then:
 *
 *     npm run serve --prefix server
 *     node --env-file=server/.env.local server/node_modules/.bin/tsx \
 *       server/eval/pipeline/clut-photos.ts
 *
 *     --api <url>     point somewhere other than 127.0.0.1:4310
 *     --tier <name>   score only "cart" or only "storage"
 *     --only <ids>    comma-separated image ids, for re-running one failure
 *     --repeat <n>    scan the whole corpus n times and average, default 1
 *     --out <path>    where to write the result JSON (default server/eval/clut-photos.json)
 *     --as-phone      send what the phone sends: the shipped `prepareUpload` bound (a 2048 long
 *                     edge, JPEG 0.85) applied with sharp standing in for the device manipulator,
 *                     rather than the original file
 *     --long-edge <n> with --as-phone, measure a different bound before shipping it
 *     --quality <q>   with --as-phone, likewise for the JPEG quality, 0 to 1
 *     --no-verify     the wide pass alone: no crops, no close read, every line is the census's
 *                     own word. The shipped path reads twice; this is the "before" arm.
 *
 * Since 2026-09-06 the shipped path reads every photograph twice (docs/superpowers/specs/
 * 2026-09-06-photo-verification-design.md): the census places a box on each product, the
 * phone cuts each box out of its original photograph, and a second call reads the crop. A line
 * is asserted only when the two readings agree; otherwise the bag shows it as unsure and the
 * review asks for a better photograph of it. The crops are cut here from the original file with
 * sharp standing in for the device, through the shipped `prepareCrops`, and sent through the
 * shipped `requestVerify`. Two numbers come out of that beside the four requirements:
 * "asserted wrong", the lines shown as sure that were wrong or matched nothing real, which the
 * gate exists to make zero; and "unsure but right", the lines it held back that were in fact
 * right, which is what the gate costs the shopper in extra photographs.
 *
 * The photographs are the owner's own and are not redistributable, so they live in `.cache/`
 * and not in the repository. `corpus/clut/manifest.json` records what they are and
 * `corpus/clut/labels.json` records what is in them.
 */
import '../replay/rn-globals';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
function arg(name: string, fallback: string): string {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (argv[i + 1] ?? fallback);
}
process.env.EXPO_PUBLIC_KART_API_URL = arg('api', 'http://127.0.0.1:4310');

const { createPhotoScanState, scanPhoto } = await import('../../../src/engine/liveVision/photoScan');
const { requestCensus, requestVerify } = await import('../../../src/engine/liveVision/recognitionClient');
const { prepareCrops, prepareUpload } = await import('../../../src/engine/liveVision/uploadImage');
const { sharpManipulator } = await import('./sharp-manipulator');
const { PRICES_PER_MTOK } = await import('../../src/usage');
const { default: sharp } = await import('sharp');
const { orientedSize } = await import('../../src/compositor');

/**
 * The phone does not send the photograph, it sends `prepareUpload`'s bounded JPEG of it
 * (src/engine/liveVision/uploadImage.ts). `--as-phone` runs that same rule here, with sharp
 * standing in for expo-image-manipulator: EXIF orientation applied on load, one edge bounded and
 * the other following the ratio, JPEG at the same quality. Without it the harness measures an
 * upload the phone never makes.
 */
const asPhone = argv.includes('--as-phone');
const noVerify = argv.includes('--no-verify');
async function imageBase64(file: string): Promise<string> {
  if (!asPhone) return readFileSync(file).toString('base64');
  const { width, height } = orientedSize(await sharp(file).metadata());
  const longEdge = Number(arg('long-edge', ''));
  const quality = Number(arg('quality', ''));
  const upload = await prepareUpload(
    { uri: file, width, height },
    {
      manipulator: sharpManipulator,
      bound: {
        ...(longEdge > 0 ? { longEdge } : {}),
        ...(quality > 0 ? { quality } : {}),
      },
    },
  );
  return upload.base64;
}

/** What the service has spent so far, so the run can be costed by difference. */
async function usageSnapshot(): Promise<Record<string, { inputTokens: number; cachedInputTokens: number; outputTokens: number; calls: number }>> {
  try {
    const res = await realFetch(`${process.env.EXPO_PUBLIC_KART_API_URL}/usage`);
    const body = (await res.json()) as { usage?: Record<string, { inputTokens: number; cachedInputTokens: number; outputTokens: number; calls: number }> };
    return body.usage ?? {};
  } catch {
    return {};
  }
}
function usageCostUsd(
  before: Awaited<ReturnType<typeof usageSnapshot>>,
  after: Awaited<ReturnType<typeof usageSnapshot>>,
): { usd: number; calls: number } | null {
  let usd = 0;
  let calls = 0;
  let priced = false;
  for (const [model, u] of Object.entries(after)) {
    const b = before[model] ?? { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, calls: 0 };
    const price = PRICES_PER_MTOK[model];
    calls += u.calls - b.calls;
    if (!price) continue;
    priced = true;
    const uncached = (u.inputTokens - b.inputTokens) - (u.cachedInputTokens - b.cachedInputTokens);
    usd += (uncached * price.input + (u.cachedInputTokens - b.cachedInputTokens) * price.cached + (u.outputTokens - b.outputTokens) * price.output) / 1e6;
  }
  return priced ? { usd, calls } : null;
}

const IMAGES = join(import.meta.dirname, '../.cache/clut');
const CORPUS = join(import.meta.dirname, '../corpus/clut');

interface Label {
  label: string;
  brand: string | null;
  qty: number | [number, number];
  match: string[];
  brandMatch: string[] | null;
  hidden: boolean;
  legible: boolean;
}
interface ImageLabels {
  id: string;
  tier: 'cart' | 'storage';
  expectSubjectKind: 'cart' | 'product' | 'shelf';
  products: Label[];
  ignore: string[];
  ignoreMatch: string[];
}

const labels = JSON.parse(readFileSync(join(CORPUS, 'labels.json'), 'utf8')) as {
  images: ImageLabels[];
};

/**
 * The raw census body for the photograph currently being scanned.
 *
 * `parseCensus` in the shipped client drops `subjectKind`, quite correctly: no caller in the app
 * needs it. A harness does. A photograph the scene gate rejects comes back with every array
 * emptied, which on this side is indistinguishable from a photograph the model simply found
 * nothing in, and those two failures have opposite fixes. Teeing the response rather than
 * calling the endpoint a second time keeps the measurement on one call per photograph, which is
 * what the shopper pays for.
 */
let lastRaw: Record<string, unknown> | null = null;
/** The close read's raw answer, both readings per item, kept on the row so a verdict can be read back. */
let lastVerifyRaw: Record<string, unknown> | null = null;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const response = await realFetch(input, init);
  if (typeof input === 'string' && input.endsWith('/api/census')) {
    try {
      lastRaw = (await response.clone().json()) as Record<string, unknown>;
    } catch {
      lastRaw = null;
    }
  }
  if (typeof input === 'string' && input.endsWith('/api/verify')) {
    try {
      lastVerifyRaw = (await response.clone().json()) as Record<string, unknown>;
    } catch {
      lastVerifyRaw = null;
    }
  }
  return response;
};

// Scoring lives in clut-scoring.ts, shared with plain-baseline.ts so the two agree on what
// "found" means. `norm` is used here for the unsure scoring below.
const { norm, scoreImage } = await import('./clut-scoring');

const tier = arg('tier', '');
const only = arg('only', '');
const wanted = labels.images.filter(
  (i) =>
    (tier === '' || i.tier === tier) &&
    (only === '' || only.split(',').map((s) => s.trim()).includes(i.id)),
);

if (!existsSync(IMAGES)) {
  console.error(`No images at ${IMAGES}. See server/eval/corpus/clut/manifest.json.`);
  process.exit(1);
}

interface Row {
  pass: number;
  id: string;
  tier: string;
  seconds: number;
  subjectKind: string;
  expectSubjectKind: string;
  gated: boolean;
  occlusionSeverity: string;
  occlusionFlag: boolean;
  found: number;
  labelled: number;
  qtyRight: number;
  /** What the bag held, so a run can be re-scored without another call. `sure` is the gate's verdict. */
  lines: { name: string; brand: string | null; qty: number; confidence?: number; sure?: boolean }[];
  /** What the review would have drawn: each product's box and status, for the record. */
  items?: { name: string; brand: string | null; qty: number; confidence: number; status: string; box: { x: number; y: number; w: number; h: number } | null }[];
  /** Per line, the scorer's verdict, beside `lines`. */
  lineOutcomes?: string[];
  verifyFailure?: string;
  /** Seconds until the census answered; the rest of `seconds` is the close read. */
  censusSeconds?: number;
  /** The close read's answer as the server sent it: the close reading and the reconciled line per item. */
  verify?: unknown;
  unmatchedLines: { name: string; brand: string | null; qty: number }[];
  ignoredLines: { name: string; brand: string | null; qty: number }[];
  misses: string[];
  qtyWrong: { label: string; expected: string; actual: number }[];
  brandRight: number;
  brandScored: number;
  brandWrong: { label: string; expected: string; actual: string | null }[];
  hiddenExpected: boolean;
  unsureScored: { label: string; confidence: number | null; flagged: boolean }[];
}

const rows: Row[] = [];
const usageBefore = await usageSnapshot();

// The model is not deterministic: two scans of one photograph can differ in a name, a count, and
// occasionally in whether a product is seen at all. A single pass is therefore an anecdote, and
// the difference between two changes to the prompt is smaller than the difference between two
// runs of the same one. Every number this harness prints is a mean over `--repeat` passes, and a
// result quoted from it should say how many.
const passes = Math.max(1, Number(arg('repeat', '1')));

for (let pass = 1; pass <= passes; pass += 1) {
if (passes > 1) console.log(`\n  pass ${pass} of ${passes}`);
for (const image of wanted) {
  const file = join(IMAGES, `${image.id}.jpg`);
  if (!existsSync(file)) {
    console.log(`  ${image.id}: absent from the cache, skipped`);
    continue;
  }
  const base64 = await imageBase64(file);
  const state = createPhotoScanState();
  lastRaw = null;
  lastVerifyRaw = null;
  const started = Date.now();
  let censusSeconds = 0;
  const { width: origW, height: origH } = orientedSize(await sharp(file).metadata());
  const photo = { uri: file, width: origW, height: origH };
  const outcome = await scanPhoto(
    state,
    base64,
    {
      requestCensus,
      ...(noVerify
        ? {}
        : {
            // The close read, exactly as the phone does it: each box cut from the original
            // photograph through the shipped rule, sharp standing in for the device.
            crop: async (box) => (await prepareCrops(photo, [box], { manipulator: sharpManipulator }))[0],
            requestVerify,
          }),
    },
    { onCensus: () => { censusSeconds = (Date.now() - started) / 1000; } },
  );
  const seconds = (Date.now() - started) / 1000;

  if (!outcome.ok) {
    console.log(`  ${image.id}: FAILED (${outcome.failure}) in ${seconds.toFixed(1)}s`);
    continue;
  }

  // Read back through an explicit type: control flow analysis narrows `lastRaw` to null at the
  // assignment above and cannot see that the fetch wrapper writes to it in between.
  const raw = lastRaw as Record<string, unknown> | null;
  const result = (raw?.result ?? {}) as Record<string, unknown>;
  const subjectKind = typeof result.subjectKind === 'string' ? result.subjectKind : 'unknown';
  const occlusion = (result.occlusion ?? {}) as Record<string, unknown>;
  const rawUnmarked = Array.isArray(result.unmarkedItems)
    ? (result.unmarkedItems as { description: string; confidence: number }[])
    : [];

  // Every labelled product against the bag, then every bag line that answered to nothing. The
  // assignment rules are in clut-scoring.ts.
  const lines = outcome.lines.map((line) => ({ name: line.name, brand: line.brand, qty: line.qty, sure: !line.unsure }));
  const score = scoreImage(lines, image);
  const { found, qtyRight, brandRight, brandScored, misses, qtyWrong, brandWrong, unmatchedLines, ignoredLines, lineOutcomes } = score;
  const items = outcome.items.map((item) => ({
    name: item.name, brand: item.brand, qty: item.qty, confidence: item.confidence, status: item.status, box: item.box,
  }));

  // Requirement 4 is about the census, not the bag: BagLine carries no confidence, so the
  // only place the model's own doubt survives is the raw response.
  const unsureScored: Row['unsureScored'] = [];
  for (const product of image.products) {
    if (product.legible || misses.includes(product.label)) continue;
    const raw = rawUnmarked.find((u) => product.match.some((m) => norm(u.description).includes(norm(m))));
    unsureScored.push({
      label: product.label,
      confidence: raw ? raw.confidence : null,
      flagged: raw ? raw.confidence < 0.6 : false,
    });
  }

  rows.push({
    pass,
    id: image.id,
    tier: image.tier,
    seconds,
    subjectKind,
    expectSubjectKind: image.expectSubjectKind,
    gated: subjectKind === 'shelf',
    occlusionSeverity: typeof occlusion.severity === 'string' ? occlusion.severity : 'unknown',
    occlusionFlag: occlusion.itemsLikelyHidden === true,
    found,
    labelled: image.products.length,
    qtyRight,
    lines,
    items,
    lineOutcomes,
    censusSeconds: Number(censusSeconds.toFixed(2)),
    ...(lastVerifyRaw ? { verify: (lastVerifyRaw as { result?: unknown }).result } : {}),
    ...(outcome.verifyFailure ? { verifyFailure: outcome.verifyFailure } : {}),
    unmatchedLines,
    ignoredLines,
    misses,
    qtyWrong,
    brandRight,
    brandScored,
    brandWrong,
    hiddenExpected: image.products.some((p) => p.hidden),
    unsureScored,
  });

  const row = rows[rows.length - 1];
  console.log(
    `  ${image.id.padEnd(7)} ${image.tier.padEnd(8)} ${seconds.toFixed(1)}s (census ${censusSeconds.toFixed(1)}s)  subject=${subjectKind}` +
      `${row.gated ? ' GATED' : ''}  found ${found}/${image.products.length}` +
      `  qty ${qtyRight}/${found}  brand ${brandRight}/${brandScored}  invented ${unmatchedLines.length}`,
  );
  for (const [i, line] of lines.entries()) {
    const verdict = lineOutcomes[i];
    if (line.sure && (verdict === 'wrong' || (verdict === 'invented' && image.tier === 'cart'))) {
      console.log(`      ASSERTED ${verdict.padEnd(8)} ${line.qty} x ${line.name}${line.brand ? ` (${line.brand})` : ''}`);
    }
    if (!line.sure) console.log(`      unsure   ${verdict.padEnd(8)} ${line.qty} x ${line.name}${line.brand ? ` (${line.brand})` : ''}`);
  }
  if (outcome.verifyFailure) console.log(`      close read failed: ${outcome.verifyFailure}`);
  for (const miss of misses) console.log(`      miss     ${miss}`);
  for (const w of qtyWrong) console.log(`      qty      ${w.label}: expected ${w.expected}, got ${w.actual}`);
  for (const b of brandWrong) console.log(`      brand    ${b.label}: expected ${b.expected}, got ${b.actual ?? 'null'}`);
  for (const line of unmatchedLines) {
    console.log(`      invented ${line.qty} x ${line.name}${line.brand ? ` (${line.brand})` : ''}`);
  }
  for (const line of ignoredLines) {
    console.log(`      ignored  ${line.qty} x ${line.name}${line.brand ? ` (${line.brand})` : ''}`);
  }
}
}

function summarise(name: string, subset: Row[]): Record<string, unknown> {
  const labelled = subset.reduce((n, r) => n + r.labelled, 0);
  const found = subset.reduce((n, r) => n + r.found, 0);
  const qtyRight = subset.reduce((n, r) => n + r.qtyRight, 0);
  const invented = subset.reduce((n, r) => n + r.unmatchedLines.length, 0);
  const ignored = subset.reduce((n, r) => n + r.ignoredLines.length, 0);
  const brandRight = subset.reduce((n, r) => n + r.brandRight, 0);
  const brandScored = subset.reduce((n, r) => n + r.brandScored, 0);
  const gated = subset.filter((r) => r.gated).length;
  const kindRight = subset.filter((r) => r.subjectKind === r.expectSubjectKind).length;
  const hiddenImages = subset.filter((r) => r.hiddenExpected);
  const hiddenFlagged = hiddenImages.filter((r) => r.occlusionFlag).length;
  const unsure = subset.flatMap((r) => r.unsureScored);
  const unsureFlagged = unsure.filter((u) => u.flagged).length;
  const seconds = subset.reduce((n, r) => n + r.seconds, 0) / Math.max(1, subset.length);

  // The gate, line by line. A line matching nothing real counts against the gate only on the
  // cart tier, whose labels are complete; on the storage tier such a line usually names something
  // that is there and unlisted (see labels.json's limitations).
  const gate = { assertedRight: 0, assertedWrong: 0, unsureRight: 0, unsureWrong: 0, gated: 0 };
  for (const r of subset) {
    if (r.lineOutcomes === undefined) continue;
    gate.gated += 1;
    r.lines.forEach((line, i) => {
      const verdict = r.lineOutcomes![i];
      if (verdict === 'ignored') return;
      const wrong = verdict === 'wrong' || (verdict === 'invented' && r.tier === 'cart');
      if (verdict === 'invented' && r.tier !== 'cart') return;
      if (line.sure !== false) wrong ? (gate.assertedWrong += 1) : (gate.assertedRight += 1);
      else wrong ? (gate.unsureWrong += 1) : (gate.unsureRight += 1);
    });
  }

  console.log(`\n  ${name}: ${subset.length} scans (${subset.length / passes} photographs x ${passes})`);
  console.log(`    1. every item reaches the bag   ${found}/${labelled} products (${((100 * found) / Math.max(1, labelled)).toFixed(0)}%)`);
  console.log(`    2. quantities are right         ${qtyRight}/${found} of the products found (${((100 * qtyRight) / Math.max(1, found)).toFixed(0)}%)`);
  console.log(`       brands right                 ${brandRight}/${brandScored} legible-brand products (${((100 * brandRight) / Math.max(1, brandScored)).toFixed(0)}%)`);
  console.log(`    3. hidden items are flagged     ${hiddenFlagged}/${hiddenImages.length} photographs that have one`);
  console.log(`    4. unsure items are flagged     ${unsureFlagged}/${unsure.length} illegible products came back under 0.6`);
  console.log(`       lines matching nothing real  ${invented} (a further ${ignored} named something in frame the shopper is not buying)`);
  console.log(`       scene gate correct           ${kindRight}/${subset.length} (${gated} emptied as "shelf")`);
  if (gate.gated > 0) {
    const asserted = gate.assertedRight + gate.assertedWrong;
    const held = gate.unsureRight + gate.unsureWrong;
    console.log(`    5. asserted lines wrong         ${gate.assertedWrong}/${asserted} lines shown as sure were wrong (must be 0)`);
    console.log(`       unsure lines                 ${held}, of which ${gate.unsureWrong} wrong and ${gate.unsureRight} right (the gate's cost)`);
  }
  console.log(`       seconds per photograph       ${seconds.toFixed(1)}`);

  return { photographs: subset.length, labelled, found, qtyRight, brandRight, brandScored, invented, ignored, gated, kindRight, hiddenImages: hiddenImages.length, hiddenFlagged, unsure: unsure.length, unsureFlagged, secondsAvg: Number(seconds.toFixed(2)), ...(gate.gated > 0 ? { gate } : {}) };
}

const summary = {
  all: summarise('all', rows),
  cart: summarise('tier "cart", the shipped use case', rows.filter((r) => r.tier === 'cart')),
  storage: summarise('tier "storage", pantry and refrigerator', rows.filter((r) => r.tier === 'storage')),
};

// Costed by what the service reports it spent between the two snapshots, at the prices in
// usage.ts. Null when the service does not answer /usage (a deployment rather than serve.ts).
const cost = usageCostUsd(usageBefore, await usageSnapshot());
if (cost && rows.length > 0) {
  console.log(`\n  cost: $${cost.usd.toFixed(3)} for ${rows.length} scans, $${(cost.usd / rows.length).toFixed(4)} and ${(cost.calls / rows.length).toFixed(1)} calls per photograph`);
}

const out = arg('out', join(import.meta.dirname, '../clut-photos.json'));
writeFileSync(out, `${JSON.stringify({ ranAt: new Date().toISOString(), arms: { asPhone, verify: !noVerify }, cost: cost && rows.length > 0 ? { usd: Number(cost.usd.toFixed(4)), perPhotoUsd: Number((cost.usd / rows.length).toFixed(4)), callsPerPhoto: Number((cost.calls / rows.length).toFixed(2)) } : null, summary, rows }, null, 1)}\n`);
console.log(`\n  written to ${out}`);
