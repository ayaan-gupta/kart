/**
 * Does painting out the neighbours make the package check able to count?
 *
 * The open defect is clut4's two bags of Priano rigatoni, read as one bag and asserted. Thirteen
 * ways of asking the reader were measured (`units-probe.ts`, `CLUT.md`) and the two framings that
 * actually separate the pair every time are unusable for one reason, recorded in CLUT.md:
 *
 *     is there more than one, yes or no      5 of 5 and 5 of 5      4 of 5 false alarms on one crop
 *     count the sealed tops                  5 of 5 and 3 of 5      9 of 40 false alarms
 *
 * and the note under that table says what the false alarms are: "it counts a lid that belongs to
 * the neighbour. The clut4 Nutella crop is the clearest case, five false alarms of five: the crop
 * holds one Nutella jar, and the red lid at its left edge is the marinara sauce."
 *
 * Every one of those false alarms is a different product bleeding into the crop. That is not a
 * limit of the reader, it is a property of the crop, and the pipeline already knows exactly where
 * the neighbours are: the census put a box on each of them in the same pass that boxed this one.
 * `CROP_PADDING` was cut from 12% to 8% for this same reason, which is the blunt version of the
 * same idea; painting the boxes out is the sharp one.
 *
 * So the arms are the crop, not the question:
 *
 *   plain    the crop exactly as the phone cuts it today.
 *   masked   the same crop, with the part of every other census box that falls inside it filled
 *            flat. Three boxes are left alone: one the census gave the same product name, since
 *            another package of this product is the whole thing being counted; one covering the
 *            middle of the crop; and one covering more than `--max-cover` of it. The last two are
 *            the subject rather than a neighbour, because census boxes overlap freely.
 *   ring     the same, clipped to the part of the crop outside the subject's own box. Census
 *            boxes overlap, so `masked` can paint over the product it is asking about: on clut5
 *            it filled the bottom third of the crop and took the bottoms of both bags with it.
 *            Nothing outside the subject's box is the subject, so this cannot.
 *
 * Scored against `labels.json`: on a product the labels say there are two or more of, how often
 * does the check separate them; on a product the labels say there is one of, how often does it
 * claim two. The second number is the one that decides whether anything here can ship.
 *
 *     node --env-file=server/.env.local server/node_modules/.bin/tsx \
 *       server/eval/pipeline/mask-neighbours.ts server/eval/clut-photos-asphone.json
 *
 *       --only <ids>      comma-separated image ids, default clut4,clut5
 *       --samples <n>     looks per crop per scale, default 5
 *       --scales <list>   comma-separated long edges, default the shipped 1536,1024
 *       --arms <list>     comma-separated: plain, masked, ring. Default all three
 *       --max-cover <f>   a neighbour box covering more than this share of the crop is left
 *                         alone, default 0.4
 *       --out <path>      default server/eval/mask-neighbours.json
 *       --crops <dir>     also write every crop it asked about, to look at
 *
 * KART_OPENROUTER_PROVIDER=none is required: MODELS.check is first-party on OpenRouter and the
 * Parasail pin returns no endpoints for it.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import OpenAI from 'openai';
import { MODELS } from '../../src/openai';
import { PACKAGE_CHECK_SYSTEM_PROMPT, packageCheckUserText } from '../../src/prompts';
import { packageCheckJsonSchema } from '../../src/schemas';
import { orientedSize } from '../../src/compositor';
import { norm } from './clut-scoring';

const { cropRect, CROP_PADDING, CROP_JPEG_QUALITY } = await import('../../../src/engine/liveVision/uploadImage');

const argv = process.argv.slice(2);
function arg(name: string, fallback: string): string {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (argv[i + 1] ?? fallback);
}
const takesValue = new Set(['--only', '--samples', '--scales', '--arms', '--max-cover', '--out', '--crops']);
const files = argv.filter((a, i) => !a.startsWith('--') && !takesValue.has(argv[i - 1] ?? ''));
const only = arg('only', 'clut4,clut5').split(',').map((s) => s.trim()).filter(Boolean);
const samples = Number(arg('samples', '5'));
const scales = arg('scales', '1536,1024').split(',').map((s) => Number(s.trim())).filter((n) => n > 0);
const arms = arg('arms', 'plain,masked,ring').split(',').map((s) => s.trim()).filter(Boolean);
const maxCover = Number(arg('max-cover', '0.4'));
const out = arg('out', join(import.meta.dirname, '../mask-neighbours.json'));
const cropDir = arg('crops', '');

const IMAGES = join(import.meta.dirname, '../.cache/clut');
const CORPUS = join(import.meta.dirname, '../corpus/clut');

interface Box { x: number; y: number; w: number; h: number }
interface Item { name: string; brand: string | null; qty: number; status: string; box: Box | null }
interface Row { id: string; pass: number; items: Item[] }
interface Product { label: string; qty: number; match: string[] }

const labels = JSON.parse(readFileSync(join(CORPUS, 'labels.json'), 'utf8')) as {
  images: { id: string; products: Product[] }[];
};

/** Every row of every run given, newest file last, one entry per photograph and pass. */
const rows: Row[] = [];
for (const file of files) {
  const run = JSON.parse(readFileSync(file, 'utf8')) as { rows: Row[] };
  for (const row of run.rows) if (only.includes(row.id)) rows.push(row);
}
if (rows.length === 0) {
  console.error(`No rows for ${only.join(',')} in ${files.join(', ') || '(no run file given)'}.`);
  process.exit(1);
}

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

/** Two census names for one product, by the same containment rule the labels are matched with. */
function sameProduct(a: string, b: string): boolean {
  const left = norm(a);
  const right = norm(b);
  return left.length > 0 && right.length > 0 && (left.includes(right) || right.includes(left));
}

/**
 * The crop the phone cuts, and the same crop with the neighbours filled flat.
 *
 * The fill is the crop's own median colour rather than a flat grey, so what is left is a dull
 * patch of the scene and not a rectangle that itself looks like something. A neighbour is skipped
 * when it covers the middle of the crop or more than `maxCover` of it: the census boxes overlap
 * freely, and a box that covers the middle is describing this product, not one beside it.
 */
async function crops(file: string, box: Box, others: Box[]): Promise<{ plain: Buffer; masked: Buffer; ring: Buffer; painted: number; paintedRing: number }> {
  const { width, height } = orientedSize(await sharp(file).metadata());
  const rect = cropRect(width, height, box, CROP_PADDING);
  if (rect === null) throw new Error('box has no area');
  const base = sharp(file).rotate().extract({
    left: rect.originX, top: rect.originY, width: rect.width, height: rect.height,
  });
  const plain = await base.clone().jpeg({ quality: Math.round(CROP_JPEG_QUALITY * 100) }).toBuffer();

  const { dominant } = await sharp(plain).stats();
  const fill = { r: dominant.r, g: dominant.g, b: dominant.b };
  const subject = {
    left: Math.round(box.x * width), top: Math.round(box.y * height),
    right: Math.round((box.x + box.w) * width), bottom: Math.round((box.y + box.h) * height),
  };
  const patch = (left: number, top: number, right: number, bottom: number): sharp.OverlayOptions | null => {
    const w = right - left;
    const h = bottom - top;
    if (w <= 0 || h <= 0) return null;
    return {
      input: { create: { width: w, height: h, channels: 3, background: fill } },
      left: left - rect.originX,
      top: top - rect.originY,
    };
  };
  const overlays: sharp.OverlayOptions[] = [];
  const ringOverlays: sharp.OverlayOptions[] = [];
  for (const other of others) {
    const left = Math.max(rect.originX, Math.round(other.x * width));
    const top = Math.max(rect.originY, Math.round(other.y * height));
    const right = Math.min(rect.originX + rect.width, Math.round((other.x + other.w) * width));
    const bottom = Math.min(rect.originY + rect.height, Math.round((other.y + other.h) * height));
    const w = right - left;
    const h = bottom - top;
    if (w <= 0 || h <= 0) continue;
    if ((w * h) / (rect.width * rect.height) > maxCover) continue;
    const midX = rect.originX + rect.width / 2;
    const midY = rect.originY + rect.height / 2;
    if (left <= midX && midX <= right && top <= midY && midY <= bottom) continue;
    const full = patch(left, top, right, bottom);
    if (full !== null) overlays.push(full);
    // The same rectangle with the subject's own box cut out of it, which leaves up to four strips:
    // above it, below it, and the two beside it over the band the box spans.
    for (const strip of [
      [left, top, right, Math.min(bottom, subject.top)],
      [left, Math.max(top, subject.bottom), right, bottom],
      [left, Math.max(top, subject.top), Math.min(right, subject.left), Math.min(bottom, subject.bottom)],
      [Math.max(left, subject.right), Math.max(top, subject.top), right, Math.min(bottom, subject.bottom)],
    ] as [number, number, number, number][]) {
      const one = patch(strip[0], strip[1], strip[2], strip[3]);
      if (one !== null) ringOverlays.push(one);
    }
  }
  const fillWith = async (list: sharp.OverlayOptions[]): Promise<Buffer> => (list.length === 0
    ? plain
    : sharp(plain).composite(list).jpeg({ quality: Math.round(CROP_JPEG_QUALITY * 100) }).toBuffer());
  return {
    plain,
    masked: await fillWith(overlays),
    ring: await fillWith(ringOverlays),
    painted: overlays.length,
    paintedRing: ringOverlays.length,
  };
}

async function ask(crop: Buffer, edge: number, name: string): Promise<number | null> {
  const small = await sharp(crop)
    .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 90 })
    .toBuffer();
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
    const text = response.output_text ?? '';
    return (JSON.parse(text) as { packages: { label: string }[] }).packages.length;
  } catch (error) {
    console.warn(`  ask failed at ${edge}: ${(error as Error).message}`);
    return null;
  }
}

if (cropDir.length > 0 && !existsSync(cropDir)) mkdirSync(cropDir, { recursive: true });

interface Probe {
  id: string; pass: number; index: number; name: string; label: string; truth: number; painted: number;
  looks: Record<string, (number | null)[]>;
}
const probes: Probe[] = [];

for (const row of rows) {
  const image = labels.images.find((i) => i.id === row.id);
  if (image === undefined) continue;
  const file = join(IMAGES, `${row.id}.jpg`);
  if (!existsSync(file)) continue;
  const boxed = row.items.filter((item) => item.box !== null);
  for (const [index, item] of boxed.entries()) {
    const product = image.products.find((p) => p.match.some((m) => norm(item.name).includes(norm(m))));
    if (product === undefined) continue;
    // A box the census gave the same product name is not a neighbour. On clut4 the census splits
    // one bag of quinoa into two boxes; painting the second one out erased half the subject and the
    // check answered "no packages" five times of five.
    const others = boxed
      .filter((o, i) => i !== index && !sameProduct(o.name, item.name))
      .map((o) => o.box as Box);
    const cut = await crops(file, item.box as Box, others);
    if (cropDir.length > 0) {
      writeFileSync(join(cropDir, `${row.id}-p${row.pass}-${index}-plain.jpg`), cut.plain);
      writeFileSync(join(cropDir, `${row.id}-p${row.pass}-${index}-masked.jpg`), cut.masked);
      writeFileSync(join(cropDir, `${row.id}-p${row.pass}-${index}-ring.jpg`), cut.ring);
    }
    const looks: Probe['looks'] = {};
    for (const armName of arms) {
      const crop = armName === 'masked' ? cut.masked : armName === 'ring' ? cut.ring : cut.plain;
      for (const edge of scales) {
        const key = `${armName}@${edge}`;
        looks[key] = [];
        for (let s = 0; s < samples; s += 1) looks[key].push(await ask(crop, edge, item.name));
      }
    }
    probes.push({
      id: row.id, pass: row.pass, index, name: item.name, label: product.label,
      truth: product.qty, painted: cut.painted, looks,
    });
    const shape = arms.map((a) => `${a} ${scales.map((e) => looks[`${a}@${e}`].map((n) => n ?? '.').join('')).join('/')}`).join('  ');
    console.log(`  ${row.id}-p${row.pass}  ${product.label.padEnd(28)} truth ${product.qty}  painted ${cut.painted}  ${shape}`);
  }
}

/** Per arm: separated on the products there are two or more of, false alarms on the ones there is one of. */
const summary: Record<string, { pairs: number; separated: number; singles: number; falseAlarms: number }> = {};
for (const armName of arms) {
  const keys = scales.map((e) => `${armName}@${e}`);
  const s = { pairs: 0, separated: 0, singles: 0, falseAlarms: 0 };
  for (const probe of probes) {
    const all = keys.flatMap((k) => probe.looks[k] ?? []).filter((n): n is number => n !== null);
    if (all.length === 0) continue;
    if (probe.truth > 1) {
      s.pairs += all.length;
      s.separated += all.filter((n) => n >= probe.truth).length;
    } else {
      s.singles += all.length;
      s.falseAlarms += all.filter((n) => n > 1).length;
    }
  }
  summary[armName] = s;
}

console.log('');
for (const [armName, s] of Object.entries(summary)) {
  console.log(`  ${armName.padEnd(8)} separated ${s.separated}/${s.pairs} looks at a real pair`
    + `   false alarms ${s.falseAlarms}/${s.singles} looks at one package`);
}
console.log(`  ${calls} calls`);

writeFileSync(out, `${JSON.stringify({
  ranAt: new Date().toISOString(), model, scales, samples, arms, maxCover, runs: files, calls, summary, probes,
}, null, 1)}\n`);
console.log(`  written to ${out}`);
