/**
 * What a plain "list everything in this photo" call gets on the clut corpus, scored exactly the
 * way the shipped pipeline is scored, so the two can be put side by side.
 *
 * The owner's report is that ChatGPT reads these photographs completely and the pipeline does
 * not. ChatGPT runs the flagship tier with reasoning on the full image and a one-line question;
 * the census runs `gpt-5.6-luna`, the smallest tier, at reasoning effort "none", on a 1536-pixel
 * composite, under a sixteen-rule prompt. Any of those four could be the gap. This harness
 * varies them one at a time and scores every arm on the same labels with the same matcher as
 * `clut-photos.ts`, so a number here and a number there mean the same thing.
 *
 *     node --env-file=server/.env.local server/node_modules/.bin/tsx \
 *       server/eval/pipeline/plain-baseline.ts --model gpt-5.6-sol --effort medium
 *
 *     --model <id>       Responses API model (default gpt-5.6-luna)
 *     --effort <e>       none | low | medium | high (default none)
 *     --long-edge <n>    resize to this long edge first; 0 sends the original file (default 0)
 *     --detail <d>       input_image detail, auto | high | low (default high)
 *     --repeat <n>       passes over the corpus (default 1)
 *     --only <ids>       comma-separated image ids
 *     --out <path>       result JSON (default server/eval/plain-baseline-<model>-<effort>.json)
 *
 * It calls the model directly, not the service: the point is to measure the model with the
 * pipeline's prompt and image handling taken away, not to measure the pipeline again.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { openai } from '../../src/openai';
import { PRICES_PER_MTOK } from '../../src/usage';
import { scoreImage, type ScoreLine } from './clut-scoring';

const argv = process.argv.slice(2);
function arg(name: string, fallback: string): string {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (argv[i + 1] ?? fallback);
}

const model = arg('model', 'gpt-5.6-luna');
const effort = arg('effort', 'none') as 'none' | 'low' | 'medium' | 'high';
const longEdge = Number(arg('long-edge', '0'));
const detail = arg('detail', 'high') as 'auto' | 'high' | 'low';
const passes = Math.max(1, Number(arg('repeat', '1')));
const only = arg('only', '');
const out = arg('out', join(import.meta.dirname, `../plain-baseline-${model}-${effort}.json`));

const IMAGES = join(import.meta.dirname, '../.cache/clut');
const CORPUS = join(import.meta.dirname, '../corpus/clut');

/** One price table for the whole project: server/src/usage.ts. */
const PRICE = PRICES_PER_MTOK;

/** The question a person asks. No badges, no rules, no scene gate, no counted list. */
const PROMPT = `This is a photograph of groceries: a shopping basket or cart, or a home pantry or refrigerator.
List every distinct grocery product you can see, as a careful person would.
For each: the brand exactly as printed on the packaging when it is legible, or null if the product is unbranded or the brand cannot be read; a short product name without the brand; the size if printed, else null; how many units of it are visible, counting packages rather than pieces (one bunch of bananas is 1, two identical bags is 2); and your confidence from 0 to 1 that a shopper would agree with the identification. Include a product that is partly hidden if you can still name it. Do not list furniture, the cart itself, or things that are not groceries.
Finally, say whether some products are probably hidden under or behind others.`;

const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['products', 'itemsLikelyHidden'],
  properties: {
    products: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['brand', 'name', 'size', 'count', 'confidence'],
        properties: {
          brand: { type: ['string', 'null'] },
          name: { type: 'string' },
          size: { type: ['string', 'null'] },
          count: { type: 'integer' },
          confidence: { type: 'number' },
        },
      },
    },
    itemsLikelyHidden: { type: 'boolean' },
  },
} as const;

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
  products: Label[];
  ignoreMatch: string[];
}
const labels = JSON.parse(readFileSync(join(CORPUS, 'labels.json'), 'utf8')) as { images: ImageLabels[] };

type Line = ScoreLine & { confidence: number };

async function imageDataUrl(file: string): Promise<string> {
  if (longEdge <= 0) return `data:image/jpeg;base64,${readFileSync(file).toString('base64')}`;
  const buffer = await sharp(file).rotate().resize({ width: longEdge, height: longEdge, fit: 'inside' }).jpeg({ quality: 88 }).toBuffer();
  return `data:image/jpeg;base64,${buffer.toString('base64')}`;
}

interface Row {
  pass: number;
  id: string;
  tier: string;
  seconds: number;
  costUsd: number;
  found: number;
  labelled: number;
  qtyRight: number;
  brandRight: number;
  brandScored: number;
  misses: string[];
  qtyWrong: { label: string; expected: string; actual: number }[];
  brandWrong: { label: string; expected: string; actual: string | null }[];
  lines: Line[];
  unmatchedLines: ScoreLine[];
  ignoredLines: ScoreLine[];
  hiddenExpected: boolean;
  hiddenFlagged: boolean;
  unsureScored: { label: string; confidence: number | null; flagged: boolean }[];
}

const wanted = labels.images.filter((image) => only === '' || only.split(',').includes(image.id));
const rows: Row[] = [];
console.log(`model ${model}, effort ${effort}, long edge ${longEdge || 'original'}, detail ${detail}, ${passes} pass(es)`);

for (let pass = 1; pass <= passes; pass += 1) {
  if (passes > 1) console.log(`\n  pass ${pass} of ${passes}`);
  for (const image of wanted) {
    const file = join(IMAGES, `${image.id}.jpg`);
    if (!existsSync(file)) {
      console.log(`  ${image.id}: absent from the cache, skipped`);
      continue;
    }
    const started = Date.now();
    let parsed: { products: { brand: string | null; name: string; size: string | null; count: number; confidence: number }[]; itemsLikelyHidden: boolean };
    let costUsd = 0;
    try {
      const response = await openai.responses.create({
        model,
        ...(effort === 'none' ? { reasoning: { effort: 'none' } } : { reasoning: { effort } }),
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: PROMPT },
              { type: 'input_image', image_url: await imageDataUrl(file), detail },
            ],
          },
        ],
        text: { format: { type: 'json_schema', name: 'grocery_list', strict: true, schema } },
      });
      parsed = JSON.parse(response.output_text);
      const price = PRICE[model];
      const usage = response.usage;
      if (price && usage) {
        const cached = usage.input_tokens_details?.cached_tokens ?? 0;
        costUsd =
          ((usage.input_tokens - cached) * price.input + cached * price.cached + usage.output_tokens * price.output) /
          1_000_000;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`  ${image.id}: FAILED ${message.replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]').slice(0, 200)}`);
      continue;
    }
    const seconds = (Date.now() - started) / 1000;
    const lines: Line[] = parsed.products.map((p) => ({ name: p.name, brand: p.brand, qty: Math.max(0, p.count), confidence: p.confidence }));

    const score = scoreImage(lines, image);
    const { found, qtyRight, brandRight, brandScored, misses, qtyWrong, brandWrong, unmatchedLines, ignoredLines } = score;
    const unsureScored: Row['unsureScored'] = [];
    image.products.forEach((product, l) => {
      const mine = score.assigned.get(l) ?? [];
      if (product.legible || mine.length === 0) return;
      const c = lines[mine[0]].confidence;
      unsureScored.push({ label: product.label, confidence: c, flagged: c < 0.6 });
    });
    rows.push({
      pass, id: image.id, tier: image.tier, seconds, costUsd, found, labelled: image.products.length, qtyRight, lines,
      brandRight, brandScored, misses, qtyWrong, brandWrong, unmatchedLines, ignoredLines,
      hiddenExpected: image.products.some((p) => p.hidden), hiddenFlagged: parsed.itemsLikelyHidden, unsureScored,
    });
    console.log(
      `  ${image.id.padEnd(7)} ${image.tier.padEnd(8)} ${seconds.toFixed(1)}s $${costUsd.toFixed(4)}  found ${found}/${image.products.length}` +
        `  qty ${qtyRight}/${found}  brand ${brandRight}/${brandScored}  invented ${unmatchedLines.length}  hidden=${parsed.itemsLikelyHidden}`,
    );
    for (const miss of misses) console.log(`      miss     ${miss}`);
    for (const w of qtyWrong) console.log(`      qty      ${w.label}: expected ${w.expected}, got ${w.actual}`);
    for (const b of brandWrong) console.log(`      brand    ${b.label}: expected ${b.expected}, got ${b.actual ?? 'null'}`);
    for (const line of unmatchedLines) console.log(`      invented ${line.qty} x ${line.name}${line.brand ? ` (${line.brand})` : ''}`);
  }
}

function summarise(subset: Row[]) {
  const sum = (f: (r: Row) => number) => subset.reduce((a, r) => a + f(r), 0);
  return {
    photographs: subset.length,
    labelled: sum((r) => r.labelled),
    found: sum((r) => r.found),
    qtyRight: sum((r) => r.qtyRight),
    brandRight: sum((r) => r.brandRight),
    brandScored: sum((r) => r.brandScored),
    invented: sum((r) => r.unmatchedLines.length),
    hiddenImages: subset.filter((r) => r.hiddenExpected).length,
    hiddenFlagged: subset.filter((r) => r.hiddenExpected && r.hiddenFlagged).length,
    unsure: sum((r) => r.unsureScored.length),
    unsureFlagged: sum((r) => r.unsureScored.filter((u) => u.flagged).length),
    secondsAvg: subset.length ? Number((sum((r) => r.seconds) / subset.length).toFixed(2)) : 0,
    costUsdAvg: subset.length ? Number((sum((r) => r.costUsd) / subset.length).toFixed(4)) : 0,
  };
}
const summary = {
  all: summarise(rows),
  cart: summarise(rows.filter((r) => r.tier === 'cart')),
  storage: summarise(rows.filter((r) => r.tier === 'storage')),
};
const s = summary.all;
console.log(`\n  ${model} effort=${effort} edge=${longEdge || 'orig'} detail=${detail}`);
console.log(`  1 found   ${s.found}/${s.labelled} ${((100 * s.found) / s.labelled).toFixed(0)}%`);
console.log(`  2 qty     ${s.qtyRight}/${s.found} ${s.found ? ((100 * s.qtyRight) / s.found).toFixed(0) : 0}%   brands ${s.brandRight}/${s.brandScored} ${s.brandScored ? ((100 * s.brandRight) / s.brandScored).toFixed(0) : 0}%`);
console.log(`  3 hidden  ${s.hiddenFlagged}/${s.hiddenImages}   4 unsure ${s.unsureFlagged}/${s.unsure}   invented ${s.invented}`);
console.log(`  seconds ${s.secondsAvg}   cost/photo $${s.costUsdAvg}`);
writeFileSync(out, `${JSON.stringify({ ranAt: new Date().toISOString(), model, effort, longEdge, detail, summary, rows }, null, 1)}\n`);
console.log(`  written to ${out}`);
