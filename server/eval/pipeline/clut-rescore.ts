/**
 * Re-scores saved clut runs against the current labels and the current scorer, without a
 * single model call.
 *
 * Both `clut-photos.ts` and `plain-baseline.ts` save every bag line a run produced, so a label
 * correction or a scorer fix can be applied to every run already paid for. Requirement 4
 * (unsure items flagged) is not re-scored here: it reads the model's confidence off the raw
 * census, which the pipeline rows do not carry.
 *
 *     node server/node_modules/.bin/tsx server/eval/pipeline/clut-rescore.ts a.json b.json ...
 *
 * Prints one column per file: the four requirements, brands, invented lines, seconds and cost.
 */
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { scoreImage, type ScoreLabel, type ScoreLine } from './clut-scoring';

interface ImageLabels {
  id: string;
  tier: 'cart' | 'storage';
  products: ScoreLabel[];
  ignoreMatch: string[];
}
const labels = JSON.parse(
  readFileSync(join(import.meta.dirname, '../corpus/clut/labels.json'), 'utf8'),
) as { images: ImageLabels[] };
const byId = new Map(labels.images.map((image) => [image.id, image]));

interface SavedRow {
  id: string;
  tier: string;
  seconds: number;
  costUsd?: number;
  lines?: ScoreLine[];
  hiddenExpected?: boolean;
  hiddenFlagged?: boolean;
  occlusionFlag?: boolean;
  gated?: boolean;
}

function rescore(file: string) {
  const data = JSON.parse(readFileSync(file, 'utf8')) as { rows: SavedRow[] };
  const totals = { photographs: 0, labelled: 0, found: 0, qtyRight: 0, brandRight: 0, brandScored: 0, invented: 0, hiddenImages: 0, hiddenFlagged: 0, gated: 0, seconds: 0, cost: 0 };
  const perTier: Record<string, typeof totals> = {};
  const misses = new Map<string, number>();
  const qtyWrong = new Map<string, number>();
  const brandWrong = new Map<string, number>();
  for (const row of data.rows) {
    const image = byId.get(row.id);
    if (!image || !row.lines) continue;
    const score = scoreImage(row.lines, image);
    const hiddenExpected = image.products.some((p) => p.hidden);
    const flagged = row.hiddenFlagged ?? row.occlusionFlag ?? false;
    const add = (t: typeof totals) => {
      t.photographs += 1;
      t.labelled += image.products.length;
      t.found += score.found;
      t.qtyRight += score.qtyRight;
      t.brandRight += score.brandRight;
      t.brandScored += score.brandScored;
      t.invented += score.unmatchedLines.length;
      t.hiddenImages += hiddenExpected ? 1 : 0;
      t.hiddenFlagged += hiddenExpected && flagged ? 1 : 0;
      t.gated += row.gated ? 1 : 0;
      t.seconds += row.seconds;
      t.cost += row.costUsd ?? 0;
    };
    add(totals);
    perTier[row.tier] ??= { ...totals, photographs: 0, labelled: 0, found: 0, qtyRight: 0, brandRight: 0, brandScored: 0, invented: 0, hiddenImages: 0, hiddenFlagged: 0, gated: 0, seconds: 0, cost: 0 };
    add(perTier[row.tier]);
    for (const m of score.misses) misses.set(`${row.id} ${m}`, (misses.get(`${row.id} ${m}`) ?? 0) + 1);
    for (const q of score.qtyWrong) qtyWrong.set(`${row.id} ${q.label} (${q.expected} got ${q.actual})`, (qtyWrong.get(`${row.id} ${q.label} (${q.expected} got ${q.actual})`) ?? 0) + 1);
    for (const b of score.brandWrong) brandWrong.set(`${row.id} ${b.label} (${b.expected} got ${b.actual})`, (brandWrong.get(`${row.id} ${b.label} (${b.expected} got ${b.actual})`) ?? 0) + 1);
  }
  return { totals, perTier, misses, qtyWrong, brandWrong };
}

const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const results = files.map((f) => ({ name: basename(f, '.json'), ...rescore(f) }));
const pct = (a: number, b: number) => (b ? `${a}/${b} ${Math.round((100 * a) / b)}%` : '-');
const col = (s: string) => s.padStart(20);
console.log(''.padEnd(22) + results.map((r) => col(r.name.slice(0, 19))).join(''));
const line = (label: string, f: (t: ReturnType<typeof rescore>['totals']) => string, tier?: string) =>
  console.log(label.padEnd(22) + results.map((r) => col(f(tier ? (r.perTier[tier] ?? r.totals) : r.totals))).join(''));
for (const tier of [undefined, 'cart', 'storage']) {
  console.log(`\n[${tier ?? 'all'}]`);
  line('1 found', (t) => pct(t.found, t.labelled), tier);
  line('2 qty right', (t) => pct(t.qtyRight, t.found), tier);
  line('  brands right', (t) => pct(t.brandRight, t.brandScored), tier);
  line('3 hidden flagged', (t) => pct(t.hiddenFlagged, t.hiddenImages), tier);
  line('invented lines', (t) => String(t.invented), tier);
  line('gated (emptied)', (t) => String(t.gated), tier);
  line('seconds/photo', (t) => (t.photographs ? (t.seconds / t.photographs).toFixed(1) : '-'), tier);
  line('cost/photo', (t) => (t.photographs ? `$${(t.cost / t.photographs).toFixed(4)}` : '-'), tier);
}
if (process.argv.includes('--detail')) {
  for (const r of results) {
    console.log(`\n== ${r.name}`);
    for (const [k, n] of r.misses) console.log(`  miss  x${n} ${k}`);
    for (const [k, n] of r.qtyWrong) console.log(`  qty   x${n} ${k}`);
    for (const [k, n] of r.brandWrong) console.log(`  brand x${n} ${k}`);
  }
}
