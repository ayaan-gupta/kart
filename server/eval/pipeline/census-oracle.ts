/**
 * The bag the shipped pipeline would produce on the real trolley, if the census returned what a
 * correct model would return.
 *
 * The census is built and has never executed: it needs an OpenAI key. Its two jobs are both
 * measurable without the model. `isProduct` decides whether a region reaches the bag at all,
 * which is the whole of the over-count on this corpus. `unmarkedItems` and `inViewCounts` carry
 * the products no badge landed on, which is the whole of the under-count.
 *
 * So the marks are supplied from `corpus/kart/census-oracle.json`, written from the committed
 * per-region labels, and everything downstream is the shipped code: `applyCensus` folds them and
 * `bagLines` reads the result. What this measures is the pipeline around the model, and what it
 * puts a number on is what the key is worth.
 *
 *     census                             units in the bag   photographs exact
 *     none, detection alone                        25/33                 2/6
 *     Qwen2-VL-2B answering isProduct              31/33                 5/6
 *     a census that answers correctly              33/33                 6/6
 *
 * The middle row is `--vlm`, and the two units it loses are worth understanding. A wrong
 * `isProduct` false on a badge is unrecoverable: `applyCensus` deliberately refuses to build a
 * bag line from an `inViewCounts` entry alone, because a count against a badge that was never
 * sent is a model error and inventing a line from it would put hallucinated products in the bag.
 * So a model that rejects a real badge has to also list that product under `unmarkedItems`, or
 * the item is simply gone. That is the right trade, and it is the reason the per-badge call
 * matters more than its 85.7% accuracy suggests.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyCensus, bagLines, createFusionState } from '../../../src/engine/liveVision/fusion';
import type { CensusMark } from '../../../src/engine/liveVision/fusion';

const HERE = join(import.meta.dirname, '..');
const oracle = JSON.parse(readFileSync(join(HERE, 'corpus/kart/census-oracle.json'), 'utf8'));
const frames = JSON.parse(readFileSync(join(HERE, '.cache/kart/frames.json'), 'utf8'));
/**
 * `--vlm` swaps the oracle's `isProduct` for what a real vision-language model answered, from
 * `.cache/kart/isproduct.json`. The model is Qwen2-VL-2B, a stand-in for the census's own: the
 * point is not which vendor answers but how much a wrong answer costs, and whether the whole
 * question is answerable from a crop at all.
 */
const useVlm = process.argv.includes('--vlm');
const vlm = new Map<string, boolean>();
if (useVlm) {
  for (const r of JSON.parse(readFileSync(join(HERE, '.cache/kart/isproduct.json'), 'utf8'))) {
    vlm.set(`${r.id}#${r.box}`, r.said);
  }
}
const byId = new Map<string, any>(frames.frames.map((f: any) => [f.id, f]));

console.log(useVlm
  ? '  isProduct from Qwen2-VL-2B; everything else the oracle and the shipped code\n'
  : '  isProduct from the oracle; everything downstream is shipped code\n');
console.log(`  ${'photograph'.padEnd(12)} ${'real'.padStart(5)} ${'in the bag'.padStart(11)} ${'error'.padStart(6)}   lines`);
let realTotal = 0;
let bagTotal = 0;
let exact = 0;
const photographs = Object.entries<any>(oracle.photographs);
for (const [id, entry] of photographs) {
  const frame = byId.get(id);
  if (!frame) continue;

  // One track per region, named the way the tracker names them, so the mark-to-track map is the
  // same shape the orchestrator builds.
  const trackIds = frame.boxes.map((_: unknown, i: number) => `t${i}`);
  const markToTrack: Record<number, string> = {};
  const liveBoxes: Record<string, { x: number; y: number; w: number; h: number }> = {};
  trackIds.forEach((tid: string, i: number) => {
    markToTrack[i] = tid;
    liveBoxes[tid] = frame.boxes[i];
  });

  const marks: CensusMark[] = entry.marks.map((m: any) => ({
    id: m.id,
    name: m.name,
    brand: null,
    size: null,
    category: 'other',
    confidence: 0.9,
    needsCloserLook: false,
    isProduct: useVlm ? (vlm.get(`${id}#${m.id}`) ?? m.isProduct) : m.isProduct,
  }));

  const unmarkedItems = entry.unmarkedItems.map((name: string) => ({
    description: name,
    confidence: 0.9,
  }));

  // Every distinct product the model can see, marked or not, with how many of it there are.
  const seen = new Map<string, number>();
  // inViewCounts is the model's separate answer to "what is in this trolley", asked of the whole
  // frame rather than of one crop. A model that misjudges a badge still sees the product, so this
  // stays the oracle's even under --vlm, and what --vlm measures is the cost of a bad per-badge
  // call alone.
  for (const m of entry.marks) if (m.isProduct) seen.set(m.name, (seen.get(m.name) ?? 0) + 1);
  for (const name of entry.unmarkedItems) seen.set(name, (seen.get(name) ?? 0) + 1);
  // `brand::name`, which is the form the census prompt specifies and the form `resolveKey`
  // normalises against. A bare name does not match the identity a mark wrote and the count is
  // silently ignored, which is a mistake this harness made before it was one the model could.
  const inViewCounts = [...seen].map(([name, count]) => ({ productKey: `::${name}`, count }));

  const state = applyCensus(
    createFusionState(),
    { marks, inViewCounts, unmarkedItems },
    markToTrack,
    trackIds,
    false,
    liveBoxes,
  );
  const lines = bagLines(state);
  const units = lines.reduce((n, l: any) => n + (l.qty ?? 1), 0);
  realTotal += entry.products;
  bagTotal += units;
  if (units === entry.products) exact += 1;
  console.log(
    `  ${id.padEnd(12)} ${String(entry.products).padStart(5)} ${String(units).padStart(11)} ` +
    `${(units - entry.products >= 0 ? '+' : '') + (units - entry.products)}`.padStart(7) +
    `   ${lines.length}`,
  );
  if (units !== entry.products) {
    for (const l of lines as any[]) {
      console.log(`      ${String(l.qty ?? 1).padStart(2)} x ${l.name ?? l.key}`);
    }
  }
}
console.log(`\n  units in the bag ${bagTotal} against ${realTotal} real items`);
console.log(`  photographs whose bag holds exactly the right number: ${exact}/${photographs.length}`);
