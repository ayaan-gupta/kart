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
const { requestCensus } = await import('../../../src/engine/liveVision/recognitionClient');
const { prepareUpload } = await import('../../../src/engine/liveVision/uploadImage');
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
const sharpManipulator = {
  async toJpegBase64(uri: string, size: { width: number } | { height: number } | null, quality: number) {
    let image = sharp(uri).rotate();
    if (size !== null) image = image.resize({ ...size, withoutEnlargement: false });
    const buffer = await image.jpeg({ quality: Math.round(quality * 100) }).toBuffer();
    return buffer.toString('base64');
  },
};
async function imageBase64(file: string): Promise<string> {
  if (!asPhone) return readFileSync(file).toString('base64');
  const { width, height } = orientedSize(await sharp(file).metadata());
  const longEdge = Number(arg('long-edge', ''));
  const quality = Number(arg('quality', ''));
  return prepareUpload(
    { uri: file, width, height },
    {
      manipulator: sharpManipulator,
      bound: {
        ...(longEdge > 0 ? { longEdge } : {}),
        ...(quality > 0 ? { quality } : {}),
      },
    },
  );
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
  return response;
};

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Whether one bag line is this labelled product, by any of the phrasings the label allows. */
function isMatch(line: { name: string; brand: string | null }, product: Label): boolean {
  const hay = `${norm(line.brand ?? '')} ${norm(line.name)}`;
  return product.match.some((m) => hay.includes(norm(m)));
}

function qtyOk(actual: number, expected: number | [number, number]): boolean {
  return Array.isArray(expected) ? actual >= expected[0] && actual <= expected[1] : actual === expected;
}

function qtyText(expected: number | [number, number]): string {
  return Array.isArray(expected) ? `${expected[0]}-${expected[1]}` : String(expected);
}

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
  const started = Date.now();
  const outcome = await scanPhoto(state, base64, { requestCensus });
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

  // Every labelled product against the bag, then every bag line that answered to nothing.
  const claimed = new Set<number>();
  const misses: string[] = [];
  const qtyWrong: Row['qtyWrong'] = [];
  const unsureScored: Row['unsureScored'] = [];
  const brandWrong: Row['brandWrong'] = [];
  let found = 0;
  let qtyRight = 0;
  let brandRight = 0;
  let brandScored = 0;

  for (const product of image.products) {
    const hits = outcome.lines
      .map((line, index) => ({ line, index }))
      .filter(({ line, index }) => !claimed.has(index) && isMatch(line, product));
    if (hits.length === 0) {
      misses.push(product.label);
      continue;
    }
    found += 1;
    // One label may legitimately be spread across several lines when the model split a product
    // it saw twice, so the quantity is the sum of what it assigned, and every line it used is
    // claimed so no second label can also count it.
    let qty = 0;
    for (const hit of hits) {
      claimed.add(hit.index);
      qty += hit.line.qty;
    }
    if (qtyOk(qty, product.qty)) qtyRight += 1;
    else qtyWrong.push({ label: product.label, expected: qtyText(product.qty), actual: qty });

    // Scored separately from the name, and only where the packaging is legible, because the
    // brand is the field the catalog resolves on: a bag line reading "Primo" for a bag that says
    // PRIANO looks right to a shopper skimming their bag and matches no SKU at all. Requirement 1
    // counts that product as having reached the bag, which it did, so without this the whole
    // failure is invisible in the number.
    if (product.brandMatch !== null) {
      brandScored += 1;
      const actual = hits[0].line.brand;
      const ok = actual !== null && product.brandMatch.some((b) => norm(actual).includes(norm(b)));
      if (ok) brandRight += 1;
      else brandWrong.push({ label: product.label, expected: product.brandMatch[0], actual });
    }

    // Requirement 4 is about the census, not the bag: BagLine carries no confidence, so the
    // only place the model's own doubt survives is the raw response.
    if (!product.legible) {
      const raw = rawUnmarked.find((u) => product.match.some((m) => norm(u.description).includes(norm(m))));
      unsureScored.push({
        label: product.label,
        confidence: raw ? raw.confidence : null,
        flagged: raw ? raw.confidence < 0.6 : false,
      });
    }
  }

  // A line that answered to no label is not automatically an invention. The photographs have
  // things in them a shopper is not buying, and for a refrigerator drawer the shelf above it is
  // in frame, so naming those is correct behaviour rather than a hallucination. The labels say
  // which those are, per photograph, in strings narrow enough that they cannot absorb a real
  // product that was misidentified.
  const leftover = outcome.lines
    .map((line, index) => ({ line, index }))
    .filter(({ index }) => !claimed.has(index))
    .map(({ line }) => ({ name: line.name, brand: line.brand, qty: line.qty }));
  const isIgnorable = (l: { name: string; brand: string | null }): boolean =>
    image.ignoreMatch.some((m) => `${norm(l.brand ?? '')} ${norm(l.name)}`.includes(norm(m)));
  const ignoredLines = leftover.filter(isIgnorable);
  const unmatchedLines = leftover.filter((l) => !isIgnorable(l));

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
    `  ${image.id.padEnd(7)} ${image.tier.padEnd(8)} ${seconds.toFixed(1)}s  subject=${subjectKind}` +
      `${row.gated ? ' GATED' : ''}  found ${found}/${image.products.length}` +
      `  qty ${qtyRight}/${found}  brand ${brandRight}/${brandScored}  invented ${unmatchedLines.length}`,
  );
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

  console.log(`\n  ${name}: ${subset.length} scans (${subset.length / passes} photographs x ${passes})`);
  console.log(`    1. every item reaches the bag   ${found}/${labelled} products (${((100 * found) / Math.max(1, labelled)).toFixed(0)}%)`);
  console.log(`    2. quantities are right         ${qtyRight}/${found} of the products found (${((100 * qtyRight) / Math.max(1, found)).toFixed(0)}%)`);
  console.log(`       brands right                 ${brandRight}/${brandScored} legible-brand products (${((100 * brandRight) / Math.max(1, brandScored)).toFixed(0)}%)`);
  console.log(`    3. hidden items are flagged     ${hiddenFlagged}/${hiddenImages.length} photographs that have one`);
  console.log(`    4. unsure items are flagged     ${unsureFlagged}/${unsure.length} illegible products came back under 0.6`);
  console.log(`       lines matching nothing real  ${invented} (a further ${ignored} named something in frame the shopper is not buying)`);
  console.log(`       scene gate correct           ${kindRight}/${subset.length} (${gated} emptied as "shelf")`);
  console.log(`       seconds per photograph       ${seconds.toFixed(1)}`);

  return { photographs: subset.length, labelled, found, qtyRight, brandRight, brandScored, invented, ignored, gated, kindRight, hiddenImages: hiddenImages.length, hiddenFlagged, unsure: unsure.length, unsureFlagged, secondsAvg: Number(seconds.toFixed(2)) };
}

const summary = {
  all: summarise('all', rows),
  cart: summarise('tier "cart", the shipped use case', rows.filter((r) => r.tier === 'cart')),
  storage: summarise('tier "storage", pantry and refrigerator', rows.filter((r) => r.tier === 'storage')),
};

const out = arg('out', join(import.meta.dirname, '../clut-photos.json'));
writeFileSync(out, `${JSON.stringify({ ranAt: new Date().toISOString(), summary, rows }, null, 1)}\n`);
console.log(`\n  written to ${out}`);
