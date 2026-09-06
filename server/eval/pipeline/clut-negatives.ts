/**
 * Photographs with nothing to buy in them, through the shipped photo path.
 *
 * A tester photographed a table and the bag said "assorted chocolates". Every other harness here
 * measures what the pipeline finds; this one measures what it invents when there is nothing to
 * find. The crops are rectangles of the clut originals that hold no grocery product (see
 * `corpus/clut/negatives.json`), cut from the cached files at run time, so they carry the same
 * provenance and no new photograph is needed.
 *
 * It drives the shipped `scanPhoto` through the shipped `requestCensus` against the running
 * service, exactly as `clut-photos.ts` does, so a line here is a line the shopper would have seen.
 *
 *     ./scripts/serve.sh
 *     node --env-file=server/.env.local server/node_modules/.bin/tsx \
 *       server/eval/pipeline/clut-negatives.ts --repeat 3
 *
 *     --api <url>     point somewhere other than 127.0.0.1:4310
 *     --repeat <n>    scan every crop n times, default 1
 *     --out <path>    result JSON (default server/eval/clut-negatives.json)
 *
 * Two numbers come out. "Asserted" lines are false products shown to the shopper as products,
 * which must be zero. "Unsure" lines are false products the bag flags as unsure, which the
 * shopper is told not to trust; fewer is better, and zero is the goal.
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
const { default: sharp } = await import('sharp');
const { orientedSize } = await import('../../src/compositor');

const IMAGES = join(import.meta.dirname, '../.cache/clut');
const CORPUS = join(import.meta.dirname, '../corpus/clut');

interface Crop {
  id: string;
  source: string;
  box: [number, number, number, number];
  what: string;
  /** Phrases naming a real product that is in the crop, so a line for it is neither false nor asserted. */
  allowed?: string[];
}
const { crops } = JSON.parse(readFileSync(join(CORPUS, 'negatives.json'), 'utf8')) as { crops: Crop[] };

/**
 * The crop written out as the "original photograph", then the phone's own bound and the phone's
 * own close-read crops of it (uploadImage.ts), with sharp standing in for the device.
 */
async function cropPhoto(crop: Crop): Promise<{ uri: string; width: number; height: number; base64: string }> {
  const file = join(IMAGES, `${crop.source}.jpg`);
  const { width: W, height: H } = orientedSize(await sharp(file).metadata());
  const [fx, fy, fw, fh] = crop.box;
  const region = { left: Math.round(fx * W), top: Math.round(fy * H), width: Math.round(fw * W), height: Math.round(fh * H) };
  const cut = await sharp(file).rotate().extract(region).jpeg({ quality: 95 }).toBuffer();
  const tmp = join(IMAGES, `.negative-${crop.id}.jpg`);
  writeFileSync(tmp, cut);
  const photo = { uri: tmp, width: region.width, height: region.height };
  const upload = await prepareUpload(photo, { manipulator: sharpManipulator });
  return { ...photo, base64: upload.base64 };
}

interface Row {
  pass: number;
  id: string;
  seconds: number;
  lines: { name: string; brand: string | null; qty: number; unsure: boolean; allowed: boolean }[];
}

const passes = Math.max(1, Number(arg('repeat', '1')));
const rows: Row[] = [];
for (let pass = 1; pass <= passes; pass += 1) {
  if (passes > 1) console.log(`\n  pass ${pass} of ${passes}`);
  for (const crop of crops) {
    if (!existsSync(join(IMAGES, `${crop.source}.jpg`))) {
      console.log(`  ${crop.id}: ${crop.source} absent from the cache, skipped`);
      continue;
    }
    const photo = await cropPhoto(crop);
    const started = Date.now();
    const outcome = await scanPhoto(createPhotoScanState(), photo.base64, {
      requestCensus,
      // The shipped path reads twice: the close read's crops are cut from the "original" here
      // exactly as the phone cuts them, and a line is asserted only when both readings agree.
      crop: async (box) => (await prepareCrops(photo, [box], { manipulator: sharpManipulator }))[0],
      requestVerify,
    });
    const seconds = (Date.now() - started) / 1000;
    if (!outcome.ok) {
      console.log(`  ${crop.id}: FAILED (${outcome.failure})`);
      continue;
    }
    const norm = (t: string) => t.toLowerCase();
    const isAllowed = (name: string, brand: string | null) =>
      (crop.allowed ?? []).some((a) => `${norm(brand ?? '')} ${norm(name)}`.includes(norm(a)));
    const lines = outcome.lines.map((l) => ({ name: l.name, brand: l.brand, qty: l.qty, unsure: l.unsure, allowed: isAllowed(l.name, l.brand) }));
    rows.push({ pass, id: crop.id, seconds, lines });
    const asserted = lines.filter((l) => !l.unsure && !l.allowed).length;
    const unsure = lines.filter((l) => l.unsure && !l.allowed).length;
    console.log(`  ${crop.id.padEnd(16)} ${seconds.toFixed(1)}s  lines ${lines.length}  asserted ${asserted}  unsure ${unsure}  allowed ${lines.length - asserted - unsure}`);
    for (const l of lines) console.log(`      ${l.allowed ? 'allowed ' : l.unsure ? 'unsure  ' : 'ASSERTED'} ${l.qty} x ${l.name}${l.brand ? ` (${l.brand})` : ''}`);
  }
}

const summary = {
  scans: rows.length,
  clean: rows.filter((r) => r.lines.every((l) => l.allowed)).length,
  asserted: rows.reduce((n, r) => n + r.lines.filter((l) => !l.unsure && !l.allowed).length, 0),
  unsure: rows.reduce((n, r) => n + r.lines.filter((l) => l.unsure && !l.allowed).length, 0),
  allowed: rows.reduce((n, r) => n + r.lines.filter((l) => l.allowed).length, 0),
  secondsAvg: rows.length ? Number((rows.reduce((n, r) => n + r.seconds, 0) / rows.length).toFixed(2)) : 0,
};
console.log(`\n  ${summary.scans} scans of ${crops.length} photographs with nothing to buy in them`);
console.log(`    came back empty            ${summary.clean}/${summary.scans}  (a line for an allowed real product counts as empty)`);
console.log(`    false products, asserted   ${summary.asserted}`);
console.log(`    false products, unsure     ${summary.unsure}`);
console.log(`    allowed real products      ${summary.allowed}`);
console.log(`    seconds per photograph     ${summary.secondsAvg}`);
const out = arg('out', join(import.meta.dirname, '../clut-negatives.json'));
writeFileSync(out, `${JSON.stringify({ ranAt: new Date().toISOString(), summary, rows }, null, 1)}\n`);
console.log(`  written to ${out}`);
