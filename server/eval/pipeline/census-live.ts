/**
 * The shipped census, against the real model, on the real trolley.
 *
 * Everything here is the service's own code: `runCensus` builds the request, sends
 * `CENSUS_SYSTEM_PROMPT` and `censusUserText`, enforces `CENSUS_RESPONSE_SCHEMA` under strict
 * mode and re-derives every productKey server-side. `compositeMarks` draws the badges.
 * `applyCensus` and `bagLines` turn the answer into a bag. This file only supplies the
 * photographs and scores the result.
 *
 * Needs OPENAI_API_KEY, either in the environment or in `server/.env`, which is gitignored.
 *
 * Two things are scored, and the first matters more than its size suggests. Badge alignment is
 * what no per-crop measurement can see: whether the answer for badge 7 lands on badge 7. A 2B
 * model got none of three right on IMG_0249, the simplest photograph here, while naming products
 * that really are in the trolley. Then the bag, against hand-counted truth.
 *
 *     node --env-file=server/.env node_modules/.bin/tsx server/eval/pipeline/census-live.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Mark } from '../../src/compositor';
import { MAX_CANDIDATES } from '../../src/enumerate';
import { runCensus } from '../../src/recognize';
import { applyCensus, bagLines, createFusionState } from '../../../src/engine/liveVision/fusion';

const HERE = join(import.meta.dirname, '..');
/**
 * `frames-named.json` is `frames.json` with the catalog matcher's shortlist attached to each
 * box; the boxes themselves are identical. The shortlist is not an extra: `marksFromRegions`
 * attaches it on every shipped request, and rule 15 of the census prompt is written around it.
 * Reading the plain frames file withheld it and measured a question the service never asks.
 * `--no-catalog` restores that harder question, for the comparison.
 */
const withCatalog = !process.argv.includes('--no-catalog');
/**
 * The model is not deterministic and these counts move by two or three units between identical
 * runs, so a single pass cannot tell a change from noise. `--repeat N` runs the whole set N
 * times and reports the spread as well as the mean.
 */
const repeatArg = process.argv.find((a) => a.startsWith('--repeat='));
const REPEATS = repeatArg ? Math.max(1, Number(repeatArg.split('=')[1])) : 1;
const frames = JSON.parse(readFileSync(join(HERE, '.cache/kart/frames-named.json'), 'utf8'));
const truth = JSON.parse(readFileSync(join(HERE, 'corpus/kart/counts.json'), 'utf8'));
const labels = {
  ...JSON.parse(readFileSync(join(HERE, 'corpus/kart/still-labels.json'), 'utf8')).boxes,
  ...JSON.parse(readFileSync(join(HERE, 'corpus/kart/query-labels.json'), 'utf8')).boxes,
};
const counted = new Map<string, any>(truth.counted.map((c: any) => [c.id, c]));

// What the region really holds, for scoring alignment. `out_of_catalog` is a real product the
// catalog lacks, so the census should still name it; only `skip` and `not_a_product` are not
// products at all.
const NOT_A_PRODUCT = new Set(['skip', 'not_a_product']);
const SAME: Record<string, string[]> = {
  cauliflower: ['cauliflower'], brussels_sprouts: ['brussels', 'sprout'],
  asparagus: ['asparagus'], oreo: ['oreo'], seedtastic_bread: ['bread', 'seedtastic'],
  granny_smith_apples: ['apple', 'granny'], baguette: ['baguette', 'bread'],
  purple_produce_bag: ['grape', 'plum', 'purple'],
};

const results: any[] = [];
const passes: { aligned: number; scorable: number; units: number; real: number; exact: number }[] = [];
let alignedRight = 0;
let alignedScorable = 0;
let bagUnits = 0;
let realUnits = 0;
let exact = 0;

for (let pass = 0; pass < REPEATS; pass += 1) {
if (REPEATS > 1) console.log(`\n=== pass ${pass + 1} of ${REPEATS} ===\n`);
const before = { aligned: alignedRight, scorable: alignedScorable, units: bagUnits, real: realUnits, exact };
for (const frame of frames.frames) {
  const entry = counted.get(frame.id);
  if (!entry) continue;

  // One-based, and shaped the way `marksFromRegions` shapes it, because that is what the
  // service sends. The matcher's confidence describes its own top choice, so only that row
  // carries it.
  const marks: Mark[] = frame.boxes.map((box: any, i: number) => {
    const mark: Mark = { id: i + 1, box };
    const found = withCatalog ? frame.catalog?.[i] : undefined;
    const alternatives: string[] = found?.alternatives ?? [];
    if (alternatives.length > 0) {
      mark.candidates = alternatives.slice(0, MAX_CANDIDATES).map((sku: string) => ({
        sku,
        confidence: sku === found?.sku ? (found?.confidence ?? 0) : 0,
      }));
    }
    return mark;
  });
  // `runCensus` composites the badges itself, at its own long edge. Compositing first and
  // handing it the result drew every badge twice, once at 1333 and again at 1024 over the top
  // of the first, which is not an image the service ever sends.
  const image = readFileSync(join(HERE, `.cache/kart/images/${frame.id}.jpg`));
  const census = await runCensus(image, marks);

  // Alignment: did the answer for badge i land on badge i?
  const byId = new Map<number, any>(census.marks.map((m: any) => [m.id, m]));
  const rows: any[] = [];
  for (let i = 0; i < frame.boxes.length; i += 1) {
    const label = labels[frame.id]?.[i] ?? 'unlabelled';
    const got = byId.get(i + 1);
    const said = got ? `${got.brand ? got.brand + ' ' : ''}${got.name}`.toLowerCase() : '(no mark)';
    let ok: boolean | null = null;
    if (NOT_A_PRODUCT.has(label)) ok = got ? got.isProduct === false : null;
    else if (SAME[label]) ok = got ? SAME[label].some((w) => said.includes(w)) : false;
    if (ok !== null) { alignedScorable += 1; if (ok) alignedRight += 1; }
    rows.push({ badge: i, truth: label, said, ok });
    console.log(`  ${frame.id} #${String(i).padEnd(2)} ${label.padEnd(22)} -> ` +
      `${said.slice(0, 34).padEnd(36)} ${ok === null ? '-' : ok ? 'ok' : 'X'}`);
  }

  // The bag, through the shipped fusion.
  const trackIds = frame.boxes.map((_: unknown, i: number) => `t${i}`);
  const markToTrack: Record<number, string> = {};
  const liveBoxes: Record<string, any> = {};
  trackIds.forEach((tid: string, i: number) => { markToTrack[i + 1] = tid; liveBoxes[tid] = frame.boxes[i]; });
  const state = applyCensus(createFusionState(), census, markToTrack, trackIds, false, liveBoxes);
  const lines = bagLines(state) as any[];
  const units = lines.reduce((n, l) => n + (l.qty ?? 1), 0);
  bagUnits += units; realUnits += entry.products;
  if (units === entry.products) exact += 1;
  console.log(`  ${frame.id}: bag ${units} against ${entry.products} real\n`);
  results.push({ id: frame.id, pass, rows, units, real: entry.products, lines, census });
}
passes.push({
  aligned: alignedRight - before.aligned,
  scorable: alignedScorable - before.scorable,
  units: bagUnits - before.units,
  real: realUnits - before.real,
  exact: exact - before.exact,
});
}

console.log(`\n  catalog shortlist ${withCatalog ? 'attached, as the service attaches it' : 'withheld'}`);
if (REPEATS > 1) {
  const per = (f: (p: typeof passes[0]) => number) => passes.map(f);
  console.log(`  ${REPEATS} passes`);
  console.log(`  badge alignment  per pass ${per((p) => p.aligned).join(', ')} of ${passes[0].scorable}`);
  console.log(`  units in the bag per pass ${per((p) => p.units).join(', ')} against ${passes[0].real}`);
  console.log(`  photographs exact per pass ${per((p) => p.exact).join(', ')} of 6`);
}
console.log(`  badge alignment  ${alignedRight}/${alignedScorable}` +
  ` (${(alignedRight / Math.max(alignedScorable, 1) * 100).toFixed(1)}%)`);
console.log(`  units in the bag ${bagUnits} against ${realUnits} real items`);
console.log(`  photographs exact ${exact}/${results.length}`);
writeFileSync(join(HERE, withCatalog ? 'kart-census-live.json' : 'kart-census-live-nocatalog.json'),
  JSON.stringify(results, null, 1));
