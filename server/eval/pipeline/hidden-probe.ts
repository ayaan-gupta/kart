/**
 * Does asking about what is hidden, on its own, see what the census does not?
 *
 * Requirement 3 is the weakest of the four. Measured on the bytes the phone sends, the census
 * flagged 2 of the 5 basket photographs that hold a hidden product, and it did it the same way
 * twice: clut2, clut3 and clut4 all came back severity "none" on both runs of 2026-09-14. On
 * clut3 and clut4 a hidden product was also never found, so the shopper loses an item and is
 * told nothing is covered.
 *
 * The census answers six things in one call: the marks, the unmarked items, the in-view counts,
 * the subject kind, the catalog resolution and the occlusion. Occlusion is the only one nothing
 * downstream checks, and it is the one it gets wrong. The package check found the same shape one
 * level down, and its fix is the one tried here: ask the question on its own.
 *
 *   census   what the shipped census said, read back from a saved run. No call is made.
 *   alone    the same upload, one call, nothing asked but what is covered. It must name the
 *            things it thinks are hidden, so a severity cannot be produced without grounding it.
 *
 * Scored against `labels.json`, which marks each product hidden or not. A photograph is a hit
 * when it holds a hidden product and the arm says something is covered, a false alarm when it
 * holds none and the arm says something is.
 *
 *     node --env-file=server/.env.local server/node_modules/.bin/tsx \
 *       server/eval/pipeline/hidden-probe.ts server/eval/clut-photos-asphone.json
 *
 *       --only <ids>     comma-separated image ids, default every cart-tier photograph
 *       --samples <n>    looks per photograph, default 3
 *       --model <name>   default MODELS.census
 *       --out <path>     default server/eval/hidden-probe.json
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import OpenAI from 'openai';
import { MODELS } from '../../src/openai';
import { orientedSize } from '../../src/compositor';
import { sharpManipulator } from './sharp-manipulator';

const { prepareUpload } = await import('../../../src/engine/liveVision/uploadImage');

const argv = process.argv.slice(2);
function arg(name: string, fallback: string): string {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (argv[i + 1] ?? fallback);
}
const takesValue = new Set(['--only', '--samples', '--model', '--out']);
const files = argv.filter((a, i) => !a.startsWith('--') && !takesValue.has(argv[i - 1] ?? ''));
const only = arg('only', '').split(',').map((s) => s.trim()).filter(Boolean);
const samples = Number(arg('samples', '3'));
const out = arg('out', join(import.meta.dirname, '../hidden-probe.json'));

const IMAGES = join(import.meta.dirname, '../.cache/clut');
const CORPUS = join(import.meta.dirname, '../corpus/clut');

interface Product { label: string; hidden: boolean }
const labels = JSON.parse(readFileSync(join(CORPUS, 'labels.json'), 'utf8')) as {
  images: { id: string; tier: string; products: Product[] }[];
};
const wanted = labels.images.filter((i) => i.tier === 'cart' && (only.length === 0 || only.includes(i.id)));

/** What the shipped census said, per photograph, read back from the runs given. */
const said = new Map<string, { severity: string; flag: boolean }>();
for (const file of files) {
  const run = JSON.parse(readFileSync(file, 'utf8')) as {
    rows: { id: string; occlusionSeverity: string; occlusionFlag: boolean }[];
  };
  for (const row of run.rows) said.set(row.id, { severity: row.occlusionSeverity, flag: row.occlusionFlag });
}

const client = new OpenAI({
  apiKey: process.env.KART_QWEN_KEY,
  baseURL: process.env.KART_OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
});
const model = arg('model', MODELS.census);
const pinned = process.env.KART_OPENROUTER_PROVIDER?.trim() || 'Parasail';
const provider = model.includes('/') && pinned.toLowerCase() !== 'none'
  ? { provider: { order: [pinned], allow_fallbacks: false } }
  : {};

/**
 * The bare question. Nothing is asked but what cannot be seen, and it must name each one, so a
 * severity has to be grounded in something it can point at rather than being a mood.
 */
const SYSTEM = `
You are looking at one photograph of groceries. Do not list what is in it.

Report only the products that are partly or wholly out of sight: under another product, behind
one, inside a bag that is closed, or turned so its label cannot be read. For each, "what" is a few
words for the thing itself and "why" is what is covering it.

A product resting beside another is not covered. A product whose front is fully visible is not
covered, however close its neighbour is. If nothing is covered, return an empty list.

Answer only with the structured object.
`.trim();

const schema = {
  type: 'object',
  properties: {
    covered: {
      type: 'array',
      items: {
        type: 'object',
        properties: { what: { type: 'string' }, why: { type: 'string' } },
        required: ['what', 'why'],
        additionalProperties: false,
      },
    },
  },
  required: ['covered'],
  additionalProperties: false,
} as const;

let calls = 0;
async function askAlone(base64: string): Promise<{ what: string; why: string }[] | null> {
  try {
    const response = (await client.responses.create({
      model,
      reasoning: { effort: 'none' },
      max_output_tokens: 600,
      input: [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content: [
            { type: 'input_text', text: 'Which products in this photograph are covered?' },
            { type: 'input_image', image_url: `data:image/jpeg;base64,${base64}`, detail: 'high' },
          ],
        },
      ],
      text: { format: { type: 'json_schema', name: 'covered', strict: true, schema } },
      ...provider,
    } as never)) as { output_text?: string };
    calls += 1;
    return (JSON.parse(response.output_text ?? '') as { covered: { what: string; why: string }[] }).covered;
  } catch (error) {
    console.warn(`  ask failed: ${(error as Error).message}`);
    return null;
  }
}

interface Probe {
  id: string; hiddenExpected: boolean; hiddenLabels: string[];
  census: { severity: string; flag: boolean } | null;
  alone: ({ what: string; why: string }[] | null)[];
}
const probes: Probe[] = [];

for (const image of wanted) {
  const file = join(IMAGES, `${image.id}.jpg`);
  if (!existsSync(file)) continue;
  const { width, height } = orientedSize(await sharp(file).metadata());
  const upload = await prepareUpload({ uri: file, width, height }, { manipulator: sharpManipulator });
  const alone: Probe['alone'] = [];
  for (let s = 0; s < samples; s += 1) alone.push(await askAlone(upload.base64));
  const hiddenLabels = image.products.filter((p) => p.hidden).map((p) => p.label);
  probes.push({
    id: image.id,
    hiddenExpected: hiddenLabels.length > 0,
    hiddenLabels,
    census: said.get(image.id) ?? null,
    alone,
  });
  const shape = alone.map((a) => (a === null ? '.' : String(a.length))).join('');
  console.log(`  ${image.id}  hidden ${hiddenLabels.length > 0 ? 'yes' : 'no '}  census ${(probes.at(-1)?.census?.severity ?? '?').padEnd(4)}`
    + `  alone ${shape}   ${(alone[0] ?? []).map((c) => c.what).join('; ').slice(0, 70)}`);
}

/** A photograph counts as flagged by an arm when a majority of its looks say something is covered. */
function flaggedAlone(probe: Probe): boolean {
  const seen = probe.alone.filter((a): a is { what: string; why: string }[] => a !== null);
  if (seen.length === 0) return false;
  return seen.filter((a) => a.length > 0).length * 2 > seen.length;
}

const summary = { census: { hits: 0, falseAlarms: 0 }, alone: { hits: 0, falseAlarms: 0 }, withHidden: 0, without: 0 };
for (const probe of probes) {
  if (probe.hiddenExpected) {
    summary.withHidden += 1;
    if (probe.census?.flag === true) summary.census.hits += 1;
    if (flaggedAlone(probe)) summary.alone.hits += 1;
  } else {
    summary.without += 1;
    if (probe.census?.flag === true) summary.census.falseAlarms += 1;
    if (flaggedAlone(probe)) summary.alone.falseAlarms += 1;
  }
}

console.log('');
console.log(`  census   ${summary.census.hits}/${summary.withHidden} photographs with a hidden product flagged`
  + `   ${summary.census.falseAlarms}/${summary.without} without one wrongly flagged`);
console.log(`  alone    ${summary.alone.hits}/${summary.withHidden} photographs with a hidden product flagged`
  + `   ${summary.alone.falseAlarms}/${summary.without} without one wrongly flagged`);
console.log(`  ${calls} calls`);

writeFileSync(out, `${JSON.stringify({ ranAt: new Date().toISOString(), model, samples, runs: files, calls, summary, probes }, null, 1)}\n`);
console.log(`  written to ${out}`);
