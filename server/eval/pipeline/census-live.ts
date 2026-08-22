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
import { compositeMarks } from '../../src/compositor';
import type { Mark } from '../../src/compositor';
import { runCensus } from '../../src/recognize';
import { applyCensus, bagLines, createFusionState } from '../../../src/engine/liveVision/fusion';

const HERE = join(import.meta.dirname, '..');
const frames = JSON.parse(readFileSync(join(HERE, '.cache/kart/frames.json'), 'utf8'));
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
let alignedRight = 0;
let alignedScorable = 0;
let bagUnits = 0;
let realUnits = 0;
let exact = 0;

for (const frame of frames.frames) {
  const entry = counted.get(frame.id);
  if (!entry) continue;

  const marks: Mark[] = frame.boxes.map((box: any, i: number) => ({ id: i, box }));
  const image = readFileSync(join(HERE, `.cache/kart/images/${frame.id}.jpg`));
  const composed = await compositeMarks(image, marks, 1333);
  const census = await runCensus(composed, marks);

  // Alignment: did the answer for badge i land on badge i?
  const byId = new Map<number, any>(census.marks.map((m: any) => [m.id, m]));
  const rows: any[] = [];
  for (let i = 0; i < frame.boxes.length; i += 1) {
    const label = labels[frame.id]?.[i] ?? 'unlabelled';
    const got = byId.get(i);
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
  trackIds.forEach((tid: string, i: number) => { markToTrack[i] = tid; liveBoxes[tid] = frame.boxes[i]; });
  const state = applyCensus(createFusionState(), census, markToTrack, trackIds, false, liveBoxes);
  const lines = bagLines(state) as any[];
  const units = lines.reduce((n, l) => n + (l.qty ?? 1), 0);
  bagUnits += units; realUnits += entry.products;
  if (units === entry.products) exact += 1;
  console.log(`  ${frame.id}: bag ${units} against ${entry.products} real\n`);
  results.push({ id: frame.id, rows, units, real: entry.products, lines, census });
}

console.log(`  badge alignment  ${alignedRight}/${alignedScorable}` +
  ` (${(alignedRight / Math.max(alignedScorable, 1) * 100).toFixed(1)}%)`);
console.log(`  units in the bag ${bagUnits} against ${realUnits} real items`);
console.log(`  photographs exact ${exact}/${results.length}`);
writeFileSync(join(HERE, 'kart-census-live.json'), JSON.stringify(results, null, 1));
