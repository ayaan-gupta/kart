/**
 * Can the package check settle a count the two readings disagree on?
 *
 * `reconcile-replay.ts` counted why the gate holds a line back. The second largest reason is that
 * the wide pass and the close read returned different counts, 19 lines over six saved runs, and
 * fourteen of them were right: the wide count was the true one and the close read's was not. Those
 * lines never get a third opinion, because the package check is asked only of lines that are
 * already sure.
 *
 * It is the natural third witness. It counts packages in the crop by enumerating them, which is a
 * different method from either reading, and the two candidate counts already exist, so using it as
 * a tiebreaker never invents a number: the answer is one of the two the readers proposed.
 *
 * This measures whether it can. For every line held back on a count disagreement it cuts the crop
 * the phone would cut, paints the neighbours out exactly as the service does, and asks the check
 * at the shipped scales, then compares its count to both candidates and to the labels.
 *
 *     KART_OPENROUTER_PROVIDER=none node --env-file=server/.env.local \
 *       server/node_modules/.bin/tsx server/eval/pipeline/count-tiebreak.ts \
 *       server/eval/clut-photos-asphone.json [more runs...]
 *
 *       --samples <n>    looks per crop per scale, default 3
 *       --scales <list>  default the shipped 1536,1024
 *       --out <path>     default server/eval/count-tiebreak.json
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import OpenAI from 'openai';
import { MODELS } from '../../src/openai';
import { PACKAGE_CHECK_SYSTEM_PROMPT, packageCheckUserText } from '../../src/prompts';
import { packageCheckJsonSchema } from '../../src/schemas';
import { neighbourPatches, maskPatches, orientedSize } from '../../src/compositor';
import { CROP_PADDING } from '../../src/recognize';
import { norm } from './clut-scoring';

const { cropRect, CROP_JPEG_QUALITY } = await import('../../../src/engine/liveVision/uploadImage');

const argv = process.argv.slice(2);
function arg(name: string, fallback: string): string {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (argv[i + 1] ?? fallback);
}
const takesValue = new Set(['--samples', '--scales', '--out']);
const runs = argv.filter((a, i) => !a.startsWith('--') && !takesValue.has(argv[i - 1] ?? ''));
const samples = Number(arg('samples', '3'));
const scales = arg('scales', '1536,1024').split(',').map((s) => Number(s.trim())).filter((n) => n > 0);
const out = arg('out', join(import.meta.dirname, '../count-tiebreak.json'));

const IMAGES = join(import.meta.dirname, '../.cache/clut');
const CORPUS = join(import.meta.dirname, '../corpus/clut');
const labels = JSON.parse(readFileSync(join(CORPUS, 'labels.json'), 'utf8')) as {
  images: { id: string; products: { label: string; qty: number | [number, number]; match: string[] }[] }[];
};

interface Box { x: number; y: number; w: number; h: number }
interface Wide { name: string; brand: string | null; qty: number; confidence: number; box: Box | null }
interface Close { name: string; brand: string | null; count: number; confidence: number; legible: boolean; matchesHint: boolean }
interface Row { id: string; pass: number; items: Wide[]; verify?: { items: { close: Close | null; line: { sure: boolean } }[] } }

const client = new OpenAI({
  apiKey: process.env.KART_QWEN_KEY,
  baseURL: process.env.KART_OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
});
const model = process.env.KART_CHECK_MODEL?.trim() || MODELS.check;
const pinned = process.env.KART_OPENROUTER_PROVIDER?.trim() || 'none';
const provider = model.includes('/') && pinned.toLowerCase() !== 'none'
  ? { provider: { order: [pinned], allow_fallbacks: false } }
  : {};

let calls = 0;
async function ask(crop: Buffer, edge: number, name: string): Promise<number | null> {
  const small = await sharp(crop).resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 90 }).toBuffer();
  try {
    const response = (await client.responses.create({
      model,
      reasoning: { effort: 'none' },
      max_output_tokens: 400,
      input: [
        { role: 'system', content: PACKAGE_CHECK_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'input_text', text: packageCheckUserText(name) },
            { type: 'input_image', image_url: `data:image/jpeg;base64,${small.toString('base64')}`, detail: 'high' },
          ],
        },
      ],
      text: { format: { type: 'json_schema', name: 'package_check', strict: true, schema: packageCheckJsonSchema } },
      ...provider,
    } as never)) as { output_text?: string };
    calls += 1;
    return (JSON.parse(response.output_text ?? '') as { packages: unknown[] }).packages.length;
  } catch (error) {
    console.warn(`  ask failed at ${edge}: ${(error as Error).message}`);
    return null;
  }
}

const qtyOk = (n: number, truth: number | [number, number]): boolean =>
  Array.isArray(truth) ? n >= truth[0] && n <= truth[1] : n === truth;

interface Probe {
  run: string; id: string; pass: number; index: number; name: string; label: string | null;
  truth: number | [number, number] | null; wide: number; close: number; looks: number[];
}
const probes: Probe[] = [];

for (const file of runs) {
  const run = JSON.parse(readFileSync(file, 'utf8')) as { rows: Row[] };
  for (const row of run.rows) {
    const verified = row.verify?.items ?? [];
    if (verified.length !== row.items.length) continue;
    const image = labels.images.find((i) => i.id === row.id);
    const path = join(IMAGES, `${row.id}.jpg`);
    if (image === undefined || !existsSync(path)) continue;
    const boxed = row.items.filter((i) => i.box !== null);
    for (const [i, saved] of verified.entries()) {
      const wide = row.items[i];
      const close = saved.close;
      if (close === null || wide.box === null) continue;
      // Only the exit this harness is about: two readings that otherwise agree, on different counts.
      if (close.count === wide.qty || !close.matchesHint || !close.legible) continue;

      const { width, height } = orientedSize(await sharp(path).metadata());
      const rect = cropRect(width, height, wide.box, CROP_PADDING);
      if (rect === null) continue;
      const plain = await sharp(path).rotate()
        .extract({ left: rect.originX, top: rect.originY, width: rect.width, height: rect.height })
        .jpeg({ quality: Math.round(CROP_JPEG_QUALITY * 100) }).toBuffer();
      const others = boxed
        .filter((o) => o !== wide && !(norm(o.name).includes(norm(wide.name)) || norm(wide.name).includes(norm(o.name))))
        .map((o) => o.box as Box);
      const size = orientedSize(await sharp(plain).metadata());
      const crop = await maskPatches(plain, neighbourPatches(wide.box, others, size, CROP_PADDING));

      const looks: number[] = [];
      for (const edge of scales) {
        for (let s = 0; s < samples; s += 1) {
          const n = await ask(crop, edge, wide.name);
          if (n !== null) looks.push(n);
        }
      }
      const product = image.products.find((p) => p.match.some((m) => norm(wide.name).includes(norm(m))));
      probes.push({
        run: file, id: row.id, pass: row.pass, index: i, name: wide.name,
        label: product?.label ?? null, truth: product?.qty ?? null,
        wide: wide.qty, close: close.count, looks,
      });
      console.log(`  ${row.id}-p${row.pass}  ${wide.name.slice(0, 26).padEnd(26)}`
        + ` wide ${wide.qty}  close ${close.count}  truth ${product ? JSON.stringify(product.qty) : '?'}`
        + `  check ${looks.join('')}`);
    }
  }
}

/** The most any look found, which is how `runVerify` reads the check today. */
const most = (looks: number[]): number => looks.reduce((n, look) => Math.max(n, look), 0);

const tally = { lines: 0, labelled: 0, agreesWide: 0, agreesClose: 0, agreesNeither: 0, settledRight: 0, settledWrong: 0, unsettled: 0 };
for (const probe of probes) {
  tally.lines += 1;
  if (probe.truth === null) continue;
  tally.labelled += 1;
  const n = most(probe.looks);
  const wide = n === probe.wide;
  const close = n === probe.close;
  if (wide && !close) tally.agreesWide += 1;
  else if (close && !wide) tally.agreesClose += 1;
  else tally.agreesNeither += 1;
  // The policy: the check agrees with exactly one candidate, so that candidate is asserted.
  if (wide !== close) {
    if (qtyOk(n, probe.truth)) tally.settledRight += 1;
    else tally.settledWrong += 1;
  } else tally.unsettled += 1;
}

console.log('');
console.log(`  ${tally.lines} lines held back on a count disagreement, ${tally.labelled} of them labelled`);
console.log(`    the check agrees with the wide count      ${tally.agreesWide}`);
console.log(`    the check agrees with the close count     ${tally.agreesClose}`);
console.log(`    the check agrees with neither, or both    ${tally.agreesNeither}`);
console.log('  taking the candidate the check agrees with:');
console.log(`    settled RIGHT   ${tally.settledRight}`);
console.log(`    settled WRONG   ${tally.settledWrong}   (must be 0)`);
console.log(`    left unsure     ${tally.unsettled}`);
console.log(`  ${calls} calls`);

writeFileSync(out, `${JSON.stringify({ ranAt: new Date().toISOString(), model, scales, samples, runs, calls, tally, probes }, null, 1)}\n`);
console.log(`  written to ${out}`);
