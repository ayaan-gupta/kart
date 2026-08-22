/**
 * The bag, with a real model in the loop and no API key.
 *
 * The census's answers come from a local model asked three separate questions, each in the form
 * that measured best:
 *
 *   isProduct   a yes-or-no question about one crop, with the exclusions spelled out. 24 of 28
 *               correct, and it rejects both plastic discs. Asking "name it, or say NOT A
 *               PRODUCT" instead calls the disc a product: one question doing two jobs does
 *               both worse.
 *   name        one crop at a time. 17 of 23 correct, alignment exact by construction, where
 *               set-of-mark on the composite attached all three answers to the wrong badge.
 *   unmarked    one question about the whole frame, for products no crop covered.
 *
 * Everything downstream is shipped code. This is not a proposal to ship a 2B model; it is what
 * the pipeline delivers when the census is answered by something rather than by nothing.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyCensus, bagLines, createFusionState } from '../../../src/engine/liveVision/fusion';
import type { CensusMark, CensusResult } from '../../../src/engine/liveVision/fusion';

const HERE = join(import.meta.dirname, '..');
import { TRUTH, scoreContents } from './still-truth';

const FRAMES = process.env.KART_FRAMES ?? '.cache/kart/frames.json';
const frames = JSON.parse(readFileSync(join(HERE, FRAMES), 'utf8'));
// `KART_CENSUS_IN`/`KART_FRAMES` pair with the same variables on `census_local.py`, so one
// region set can be swapped for another and scored without a second copy of either file.
const CENSUS_IN = process.env.KART_CENSUS_IN ?? '.cache/kart/census-local.json';
const local = JSON.parse(readFileSync(join(HERE, CENSUS_IN), 'utf8'));
const isProduct = new Map<string, boolean>(
  JSON.parse(readFileSync(join(HERE, '.cache/kart/isproduct.json'), 'utf8'))
    .map((r: any) => [`${r.id}#${r.box}`, r.said]),
);
const truth = JSON.parse(readFileSync(join(HERE, 'corpus/kart/counts.json'), 'utf8'));
const counted = new Map<string, any>(truth.counted.map((c: any) => [c.id, c]));

let found = 0;
let strictFound = 0;
let truthTotal = 0;
let spuriousTotal = 0;
let units = 0;
let real = 0;
let exact = 0;
let n = 0;
console.log(`  ${'photograph'.padEnd(12)} ${'real'.padStart(5)} ${'in the bag'.padStart(11)} ${'error'.padStart(6)}`);
for (const [id, answers] of Object.entries<any>(local)) {
  const entry = counted.get(id);
  const frame = frames.frames.find((f: any) => f.id === id);
  if (!entry || !frame) continue;

  const trackIds = frame.boxes.map((_: unknown, i: number) => `t${i}`);
  const markToTrack: Record<number, string> = {};
  const liveBoxes: Record<string, any> = {};
  trackIds.forEach((tid: string, i: number) => { markToTrack[i] = tid; liveBoxes[tid] = frame.boxes[i]; });

  const marks: CensusMark[] = answers.marks.map((m: any) => ({
    id: m.id, name: m.name, brand: null, size: null, category: 'other',
    confidence: 0.9, needsCloserLook: false,
    // The dedicated yes-or-no answer, not the one folded into the naming question.
    isProduct: isProduct.get(`${id}#${m.id}`) ?? m.isProduct,
  }));
  const marked = new Set(marks.filter((m) => m.isProduct).map((m) => m.name));
  const unmarkedItems = (answers.listed as string[])
    .filter((p) => !marked.has(p))
    .map((description) => ({ description, confidence: 0.8 }));
  const seen = new Map<string, number>();
  for (const m of marks) if (m.isProduct) seen.set(m.name, (seen.get(m.name) ?? 0) + 1);
  for (const u of unmarkedItems) seen.set(u.description, (seen.get(u.description) ?? 0) + 1);

  const census: CensusResult = {
    marks,
    unmarkedItems,
    inViewCounts: [...seen].map(([name, count]) => ({ productKey: `::${name}`, count })),
  };
  const state = applyCensus(createFusionState(), census, markToTrack, trackIds, false, liveBoxes);
  const lines = bagLines(state);
  const got = lines.reduce((s, l) => s + (l.qty ?? 1), 0);
  units += got; real += entry.products; n += 1;
  if (got === entry.products) exact += 1;

  // Contents as well as units. A detector that finds one more real product while inventing one
  // more line is indistinguishable from one that invents two, if only the total is reported.
  const truth = TRUTH[id];
  let note = '';
  if (truth) {
    const named = lines.map((l: any) => ({
      name: `${l.brand ? `${l.brand} ` : ''}${l.name}`.toLowerCase(),
      qty: l.qty ?? 1,
    }));
    const c = scoreContents(named, truth);
    found += c.lenient; strictFound += c.strict; truthTotal += truth.length;
    spuriousTotal += c.spurious.length;
    note = `  found ${c.strict}/${c.lenient} of ${truth.length}`;
  }
  console.log(`  ${id.padEnd(12)} ${String(entry.products).padStart(5)} ${String(got).padStart(11)} ` +
    `${(got - entry.products >= 0 ? '+' : '') + (got - entry.products)}`.padStart(7) + note);
}
console.log(`\n  units in the bag ${units} against ${real} real items`);
console.log(`  photographs exact ${exact}/${n}`);
console.log(`  products found ${strictFound}/${truthTotal} on an unambiguous word, ` +
  `${found}/${truthTotal} allowing words a trolley shares between two products`);
console.log(`  lines matching nothing real ${spuriousTotal}`);
