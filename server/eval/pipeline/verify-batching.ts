/**
 * What a close read costs when several of them run at once, and what one call carrying every crop
 * costs instead.
 *
 * `clut-photos-chains.json` shows the close read is not one latency, it is two. On a photograph
 * with three to five crops every close read lands in about 2.1 seconds. On clut7, with eight, five
 * of the eight take 9 to 10 seconds and the photograph takes 22. The stage is already per-crop
 * parallel, so this is not our queueing: either the upstream serves a limited number of requests
 * at a time, or it batches them and every sequence in the batch decodes slower.
 *
 * That distinction decides the biggest remaining speed lever. If concurrency is what costs, then
 * sending one request that carries all the crops is worth building: one prefill of the prompt,
 * one sequence to decode, no contention. If it is not, batching saves only call overhead and the
 * accuracy risk of asking one answer to cover eight crops is not worth taking.
 *
 * So this measures both on the same crops, in one run:
 *
 *   - one by one, 1, 2, 4 and 8 crops at a time, each its own call, all issued together
 *   - all eight crops in a single call, answering an array
 *
 * The crops are cut here, from the photograph, at the boxes a real run already found
 * (`--from`), so nothing here pays for a census. Roughly sixteen close reads in total.
 *
 *     node --env-file=server/.env.local server/node_modules/.bin/tsx \
 *       server/eval/pipeline/verify-batching.ts
 *
 *     --image <id>    which photograph in server/eval/.cache/clut, default clut7
 *     --from <path>   a run holding that photograph's boxes, default clut-photos-chains.json
 *     --out <path>    where to write the result JSON
 *
 * It reads the shipped prompt and schema, and pins the provider the service pins, so the numbers
 * are the service's. It does not run the unit pass or the package check: they are separate calls
 * whose timings the chains run already reports, and they are not what is being asked about here.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { clientFor, MODELS } from '../../src/openai';
import { VERIFY_SYSTEM_PROMPT, verifyUserText } from '../../src/prompts';
import { verifyJsonSchema } from '../../src/schemas';

const argv = process.argv.slice(2);
function arg(name: string, fallback: string): string {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (argv[i + 1] ?? fallback);
}

const image = arg('image', 'clut7');
const from = arg('from', join(import.meta.dirname, '../clut-photos-chains.json'));
const out = arg('out', join(import.meta.dirname, '../verify-batching.json'));
const file = join(import.meta.dirname, '../.cache/clut', `${image}.jpg`);
if (!existsSync(file) || !existsSync(from)) {
  console.log('the photograph or the run it takes its boxes from is missing; nothing to probe.');
  process.exit(0);
}

type Item = { name: string; box?: { x: number; y: number; w: number; h: number } | null };
const row = (JSON.parse(readFileSync(from, 'utf8')) as { rows: { id: string; items: Item[] }[] }).rows.find(
  (r) => r.id === image,
);
const want = Number(arg('crops', '8'));
const boxed = (row?.items ?? []).filter((item) => item.box != null).slice(0, want);
if (boxed.length < 8) console.log(`only ${boxed.length} boxes in ${image}; the 8-wide arms will be that size.`);

// The phone's own crop bound: `CROP_PADDING`, `CROP_LONG_EDGE`, `CROP_JPEG_QUALITY`.
const meta = await sharp(file).rotate().metadata();
const crops = await Promise.all(
  boxed.map(async (item) => {
    const box = item.box as { x: number; y: number; w: number; h: number };
    const pad = 0.08;
    const left = Math.max(0, Math.round((box.x - box.w * pad) * meta.width));
    const top = Math.max(0, Math.round((box.y - box.h * pad) * meta.height));
    const width = Math.min(meta.width - left, Math.round(box.w * (1 + pad * 2) * meta.width));
    const height = Math.min(meta.height - top, Math.round(box.h * (1 + pad * 2) * meta.height));
    const buffer = await sharp(file)
      .rotate()
      .extract({ left, top, width, height })
      .resize({ width: width >= height ? 1536 : undefined, height: height > width ? 1536 : undefined, withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toBuffer();
    return { name: item.name, dataUrl: `data:image/jpeg;base64,${buffer.toString('base64')}`, bytes: buffer.length };
  }),
);

const client = clientFor(MODELS.close);
const pin = { provider: { order: [process.env.KART_OPENROUTER_PROVIDER?.trim() || 'Parasail'], allow_fallbacks: false } };

async function oneCrop(crop: (typeof crops)[number]): Promise<{ seconds: number; text: string }> {
  const started = Date.now();
  const response = await client.responses.create({
    model: MODELS.close,
    max_output_tokens: 400,
    input: [
      { role: 'system', content: VERIFY_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'input_text', text: verifyUserText({ description: crop.name, productKey: crop.name }) },
          { type: 'input_image', image_url: crop.dataUrl, detail: 'high' },
        ],
      },
    ],
    text: { format: { type: 'json_schema', name: 'verify', strict: true, schema: verifyJsonSchema } },
    ...pin,
  } as never);
  return { seconds: (Date.now() - started) / 1000, text: (response as { output_text: string }).output_text };
}

/** The same question about every crop at once, numbered, answering one entry per crop. */
async function allCrops(): Promise<{ seconds: number; text: string }> {
  const content: unknown[] = [];
  crops.forEach((crop, index) => {
    content.push({
      type: 'input_text',
      text: `Crop ${index}. ${verifyUserText({ description: crop.name, productKey: crop.name })}`,
    });
    content.push({ type: 'input_image', image_url: crop.dataUrl, detail: 'high' });
  });
  const reading = { ...verifyJsonSchema, properties: { index: { type: 'integer' }, ...verifyJsonSchema.properties } };
  const started = Date.now();
  const response = await client.responses.create({
    model: MODELS.close,
    max_output_tokens: 400 * crops.length,
    input: [
      {
        role: 'system',
        content: `${VERIFY_SYSTEM_PROMPT}\n\nSeveral crops are given, each introduced by its number. Answer once for each crop, in an array, echoing that number as index. Read each crop on its own: never carry a reading from one crop into the answer for another.`,
      },
      { role: 'user', content },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'verify_many',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            readings: { type: 'array', items: { ...reading, required: ['index', ...verifyJsonSchema.required] } },
          },
          required: ['readings'],
          additionalProperties: false,
        },
      },
    },
    ...pin,
  } as never);
  return { seconds: (Date.now() - started) / 1000, text: (response as { output_text: string }).output_text };
}

const only = arg('arms', 'both');
const arms: Record<string, unknown>[] = [];
for (const n of only === 'batched' ? [] : [1, 2, 4, 8]) {
  if (n > crops.length) continue;
  const started = Date.now();
  const settled = await Promise.all(crops.slice(0, n).map((crop) => oneCrop(crop).catch((error) => ({ seconds: -1, text: String(error).slice(0, 120) }))));
  arms.push({
    arm: `one call per crop, ${n} at once`,
    concurrency: n,
    wallSeconds: Number(((Date.now() - started) / 1000).toFixed(2)),
    perCallSeconds: settled.map((s) => Number(s.seconds.toFixed(2))),
    read: settled.map((s) => {
      try {
        const parsed = JSON.parse(s.text) as { name?: string; brand?: string | null; count?: number };
        return `${parsed.brand ?? '-'} ${parsed.name ?? '?'} x${parsed.count ?? '?'}`;
      } catch {
        return s.text.slice(0, 80);
      }
    }),
  });
  console.log(JSON.stringify(arms.at(-1)));
}

try {
  if (only === 'one-by-one') throw new Error('skipped');
  const batched = await allCrops();
  const parsed = JSON.parse(batched.text) as { readings: { index: number; name: string; brand: string | null; count: number }[] };
  arms.push({
    arm: `one call carrying all ${crops.length} crops`,
    concurrency: 1,
    wallSeconds: Number(batched.seconds.toFixed(2)),
    read: parsed.readings.map((r) => `${r.index}: ${r.brand ?? '-'} ${r.name} x${r.count}`),
  });
} catch (error) {
  arms.push({ arm: `one call carrying all ${crops.length} crops`, failed: String(error instanceof Error ? error.message : error).slice(0, 200) });
}
console.log(JSON.stringify(arms.at(-1)));

writeFileSync(out, `${JSON.stringify({ ranAt: new Date().toISOString(), image, crops: crops.map((c) => ({ name: c.name, bytes: c.bytes })), arms }, null, 1)}\n`);
