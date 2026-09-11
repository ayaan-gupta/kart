/**
 * The count rule in `reconcile`, replayed over runs that already happened.
 *
 * Since 2026-09-11 a line is not asserted when the two readings agree on a count above one
 * (`countNeedsCheck` in src/reconcile.ts): the crop is cut from the same pixels the wide pass
 * counted, so their agreement is one witness to the number, not two. The rule only ever turns a
 * sure line unsure, and it asks nothing the saved rows do not already hold, so what it would have
 * done to every scan already paid for is exact and costs no model call:
 *
 *   - a close-read line that was sure with a count the rule doubts becomes unsure;
 *   - its census item becomes unsure with it (items and close reads share the order p0, p1, ...);
 *   - a bag line becomes unsure when every sure item under its key did, because fusion keeps the
 *     most confident reading of a key (applyCensus in src/engine/liveVision/fusion.ts).
 *
 *     node server/node_modules/.bin/tsx server/eval/pipeline/count-replay.ts \
 *       server/eval/clut-photos-retry.json [more runs...]
 *
 *       --out-dir <dir>  where the replayed copies go, default server/eval/.cache/count-replay
 *
 * Every line the rule turns unsure is printed with what the scorer made of it. Each run is also
 * written back out with the new verdicts, so clut-rescore.ts can score the original and the
 * replay side by side with the one tally every other number in CLUT.md comes from:
 *
 *     node server/node_modules/.bin/tsx server/eval/pipeline/clut-rescore.ts \
 *       server/eval/clut-photos-retry.json server/eval/.cache/count-replay/clut-photos-retry.json
 *
 * Two numbers pull against each other, as in catalog-replay.ts: asserted lines that were wrong
 * and are now held back (what the rule is for), and asserted lines that were right and are now
 * held back (a shopper asked to check something already correct).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { scoreImage, type ScoreLabel, type ScoreLine } from './clut-scoring';
import { countNeedsCheck } from '../../src/reconcile';
import { productKey } from '../../src/schemas';

const argv = process.argv.slice(2);
function arg(name: string, fallback: string): string {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (argv[i + 1] ?? fallback);
}
const outDir = arg('out-dir', join(import.meta.dirname, '../.cache/count-replay'));
const files = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--out-dir');

interface ImageLabels {
  id: string;
  tier: 'cart' | 'storage';
  products: ScoreLabel[];
  ignoreMatch: string[];
}
const labels = JSON.parse(readFileSync(join(import.meta.dirname, '../corpus/clut/labels.json'), 'utf8')) as { images: ImageLabels[] };
const byId = new Map(labels.images.map((image) => [image.id, image]));

interface Item { name: string; brand: string | null; status?: string }
interface VerifyEntry { id: string; line?: { sure: boolean; count: number } }
interface Row {
  id: string;
  pass: number;
  tier: string;
  lines?: (ScoreLine & { sure?: boolean })[];
  items?: Item[];
  verify?: { items?: VerifyEntry[] } | null;
}

mkdirSync(outDir, { recursive: true });
for (const file of files) {
  const run = JSON.parse(readFileSync(file, 'utf8')) as { rows: Row[] };
  let wrong = 0;
  let right = 0;
  const rows = run.rows.map((row) => {
    const image = byId.get(row.id);
    if (!image || !row.lines || !row.items || !row.verify?.items) return row;

    // Census items whose close read was sure of a count the rule doubts.
    const doubted = new Set<number>();
    for (const entry of row.verify.items) {
      if (entry.line?.sure && countNeedsCheck(entry.line.count)) doubted.add(Number(entry.id.slice(1)));
    }
    const sureKeys = (skip: Set<number>) =>
      new Set(row.items!.flatMap((item, i) => (item.status === 'sure' && !skip.has(i) ? [productKey(item.name, item.brand)] : [])));
    const wasSure = sureKeys(new Set());
    const stillSure = sureKeys(doubted);
    const lines = row.lines.map((line) => {
      const key = productKey(line.name, line.brand);
      return line.sure !== false && wasSure.has(key) && !stillSure.has(key) ? { ...line, sure: false } : line;
    });

    const score = scoreImage(row.lines, image);
    lines.forEach((line, i) => {
      if (line.sure !== false || row.lines![i].sure === false) return;
      // Judged as clut-rescore.ts judges the gate: a line matching nothing counts against it on
      // the cart tier only, whose labels are complete, and a line naming something the shopper is
      // not buying counts neither way.
      const outcome = score.lineOutcomes[i];
      const asserted = score.assertedOutcomes[i];
      const counted = outcome === 'ignored' || (outcome === 'invented' && row.tier !== 'cart') ? 'not scored' : asserted === 'right' ? 'right' : 'wrong';
      if (counted === 'right') right += 1;
      if (counted === 'wrong') wrong += 1;
      console.log(`    ${row.id} pass ${row.pass}: ${line.qty} x ${line.name} (${line.brand ?? 'no brand'}) was asserted ${counted}, now held back`);
    });
    return { ...row, lines };
  });
  const out = join(outDir, basename(file));
  writeFileSync(out, `${JSON.stringify({ ...run, rows }, null, 1)}\n`);
  console.log(`  ${basename(file)}: the rule holds back ${wrong} wrong and ${right} right asserted lines; written to ${out}\n`);
}
