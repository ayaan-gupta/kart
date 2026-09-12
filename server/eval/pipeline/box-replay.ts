/**
 * The one-box-per-product assumption, replayed over runs that already happened.
 *
 * The close read exists to be a second witness: the wide pass puts a box on each product, the
 * phone cuts that box out of the original photograph, and a second call reads the crop. The whole
 * gate rests on the crop being of the product the line names.
 *
 * On 2026-09-12, cutting the crops of every saved run turned up scans where it is not. The wide
 * pass sometimes answers with one box repeated: on clut7 all six products carry the box
 * {0.21, 0.21, 0.21, 0.21}, and on clut10 all eight carry a box within a hundredth of each other.
 * Five of clut7's six close reads were therefore reading the tin of soup and answering about the
 * black beans, the pesto, the Nutella, the chips and the seeds; they agreed with the wide pass
 * and the lines were asserted. Across every saved clut run, 78 of 1,594 items share a box with
 * another item, in 17 of 265 scans.
 *
 * A line whose crop is another product's crop has had one witness, not two, which is the same
 * argument `countNeedsCheck` makes about a count both readings take from the same pixels. This
 * replays the rule that follows: an item sharing its box with another item is not asserted.
 *
 *     node server/node_modules/.bin/tsx server/eval/pipeline/box-replay.ts \
 *       server/eval/clut-photos-salvage.json [more runs...]
 *
 *       --out-dir <dir>  where the replayed copies go, default server/eval/.cache/box-replay
 *
 * Each run is written back out with the new verdicts, so clut-rescore.ts scores the original and
 * the replay side by side on the four requirements:
 *
 *     node server/node_modules/.bin/tsx server/eval/pipeline/clut-rescore.ts \
 *       server/eval/clut-photos-salvage.json \
 *       server/eval/.cache/box-replay/clut-photos-salvage.json
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { scoreImage, type ScoreLabel, type ScoreLine } from './clut-scoring';

const argv = process.argv.slice(2);
function arg(name: string, fallback: string): string {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (argv[i + 1] ?? fallback);
}
const outDir = arg('out-dir', join(import.meta.dirname, '../.cache/box-replay'));
const files = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--out-dir');

interface ImageLabels { id: string; tier: 'cart' | 'storage'; products: ScoreLabel[]; ignoreMatch: string[] }
const labels = JSON.parse(readFileSync(join(import.meta.dirname, '../corpus/clut/labels.json'), 'utf8')) as { images: ImageLabels[] };
const byId = new Map(labels.images.map((image) => [image.id, image]));

interface Box { x: number; y: number; w: number; h: number }
interface Item { name: string; brand: string | null; box: Box | null; status?: string }
interface Row {
  id: string;
  pass: number;
  tier: string;
  lines?: (ScoreLine & { sure?: boolean })[];
  items?: Item[];
}

/** Two boxes counted as the same crop. Equal to the hundredth, which is what the model answers in. */
const sameBox = (a: Box, b: Box): boolean =>
  Math.abs(a.x - b.x) < 0.005 && Math.abs(a.y - b.y) < 0.005 && Math.abs(a.w - b.w) < 0.005 && Math.abs(a.h - b.h) < 0.005;

mkdirSync(outDir, { recursive: true });
for (const file of files) {
  const run = JSON.parse(readFileSync(file, 'utf8')) as { rows: Row[]; [k: string]: unknown };
  let wrong = 0;
  let right = 0;
  let touched = 0;
  const rows = run.rows.map((row) => {
    const items = row.items ?? [];
    const lines = row.lines ?? [];
    const image = byId.get(row.id);
    if (items.length === 0 || lines.length !== items.length || image === undefined) return row;

    const shared = items.map((item, i) =>
      item.box !== null && items.some((other, j) => j !== i && other.box !== null && sameBox(item.box!, other.box!)),
    );
    if (!shared.some(Boolean)) return row;

    const before = scoreImage(lines, image);
    const next = lines.map((line, i) => (shared[i] && line.sure !== false ? { ...line, sure: false } : line));
    for (const [i, line] of lines.entries()) {
      if (!shared[i] || line.sure === false) continue;
      touched += 1;
      const verdict = before.assertedOutcomes[i];
      if (verdict === 'right') right += 1;
      else if (verdict !== null) wrong += 1;
      console.log(`  ${row.id} p${row.pass}: "${line.name}" (${line.brand ?? 'no brand'}) x${line.qty} was sure and ${verdict}; its crop is another product's crop`);
    }
    return { ...row, lines: next };
  });

  const to = join(outDir, basename(file));
  writeFileSync(to, `${JSON.stringify({ ...run, rows }, null, 1)}\n`);
  console.log(`${basename(file)}: ${touched} asserted lines held back, ${wrong} of them wrong and ${right} right -> ${to}\n`);
}
