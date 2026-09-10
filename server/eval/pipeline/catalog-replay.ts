/**
 * The text catalog leg, replayed over runs that already happened.
 *
 * Every line of every scan in a saved `clut-photos.ts` run is already labelled: `lineOutcomes`
 * says whether the scorer found it right, wrong, invented or ignorable, and `sure` says whether
 * the gate asserted it. That is exactly the data needed to ask what resolving each line against
 * the store's catalog would have done, and it costs no model call, so a threshold can be chosen
 * against real model output instead of against phrases invented to suit it.
 *
 *     node server/node_modules/.bin/tsx server/eval/pipeline/catalog-replay.ts \
 *       eval/clut-photos-qwen235-parasail-both.json [more runs...]
 *
 *       --catalog <path>  default server/eval/corpus/clut/catalog.json
 *       --show            print every line and its verdict
 *
 * Two numbers matter, and they pull against each other:
 *
 *   rescued   lines the gate asserted that were wrong, which the catalog declines. This is the
 *             bar in CLAUDE.md: asserted lines wrong must be 0.
 *   cost      lines the gate asserted that were right, which the catalog also declines. Each one
 *             is a shopper asked for a second photograph of something already correct.
 *
 * A resolver that declines everything scores perfectly on the first and uselessly on the second.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
function arg(name: string, fallback: string): string {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (argv[i + 1] ?? fallback);
}
const show = argv.includes('--show');
const runs = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--') && argv[i - 1] !== '--show'));

const { buildCatalog, resolve } = await import('../../src/catalog.js');

const catalogPath = arg('catalog', join(import.meta.dirname, '../corpus/clut/catalog.json'));
const catalog = buildCatalog(
  (JSON.parse(readFileSync(catalogPath, 'utf8')) as { entries: { sku: string; brand: string | null; name: string; aliases?: string[] }[] }).entries,
);

interface Line { name: string; brand: string | null; qty: number; sure?: boolean }
interface Row {
  id: string;
  tier: string;
  lines: Line[];
  lineOutcomes?: string[];
  qtyWrong?: { label: string }[];
  brandWrong?: { label: string }[];
}

type Bucket = 'rescued' | 'cost' | 'kept' | 'still wrong' | 'held right' | 'held wrong';
const tally = new Map<string, number>();
/**
 * Why a wrong line is wrong, so that what survives the catalog can be read rather than assumed.
 *
 * A text catalog answers "which of the things this shop sells is this". It cannot see how many of
 * them are in the basket, so a line naming the right product and the wrong number is outside its
 * reach by construction, and saying so is different from saying it slipped through.
 */
const causes = new Map<string, number>();
const bump = (key: string): void => { tally.set(key, (tally.get(key) ?? 0) + 1); };
const verdicts = new Map<string, number>();

for (const run of runs) {
  const data = JSON.parse(readFileSync(run, 'utf8')) as { rows: Row[] };
  const rows = data.rows.filter((r) => Array.isArray(r.lineOutcomes));
  console.log(`\n  ${run}: ${rows.length} scans`);
  for (const row of rows) {
    row.lines.forEach((line, i) => {
      const outcome = row.lineOutcomes![i];
      if (outcome === 'ignored') return;
      // A line naming something real but unlisted only counts against the gate on the cart tier,
      // whose labels are complete. clut-photos.ts scores it the same way.
      if (outcome === 'invented' && row.tier !== 'cart') return;
      const wrong = outcome === 'wrong' || outcome === 'invented';
      const verdict = resolve({ name: line.name, brand: line.brand }, catalog);
      verdicts.set(verdict.status, (verdicts.get(verdict.status) ?? 0) + 1);
      const declined = verdict.status !== 'matched';
      const asserted = line.sure !== false;
      const bucket: Bucket = !asserted
        ? (wrong ? 'held wrong' : 'held right')
        : wrong
          ? (declined ? 'rescued' : 'still wrong')
          : (declined ? 'cost' : 'kept');
      bump(`${row.tier}/${bucket}`);
      bump(bucket);
      if (bucket === 'still wrong') {
        const qty = (row.qtyWrong ?? []).length > 0;
        const brand = (row.brandWrong ?? []).length > 0;
        const cause = outcome === 'invented' ? 'invented' : qty ? 'quantity' : brand ? 'brand' : 'identity';
        causes.set(cause, (causes.get(cause) ?? 0) + 1);
      }
      if (show && asserted) {
        console.log(
          `    ${row.id.padEnd(7)} ${outcome.padEnd(8)} ${bucket.padEnd(11)} ${verdict.status.padEnd(13)} ` +
            `${line.qty} x ${line.name}${line.brand ? ` (${line.brand})` : ''}` +
            `${verdict.status === 'matched' ? ` -> ${verdict.sku}` : ''}`,
        );
      }
    });
  }
}

const n = (key: string): number => tally.get(key) ?? 0;
for (const tier of ['cart', 'storage', '']) {
  const p = tier === '' ? '' : `${tier}/`;
  const label = tier === '' ? 'both tiers' : `tier "${tier}"`;
  const assertedWrong = n(`${p}rescued`) + n(`${p}still wrong`);
  const assertedRight = n(`${p}kept`) + n(`${p}cost`);
  if (assertedWrong + assertedRight === 0) continue;
  console.log(`\n  ${label}: ${assertedRight + assertedWrong} lines the gate asserted`);
  console.log(`    wrong, and the catalog declines them   ${n(`${p}rescued`)}/${assertedWrong}  (asserted wrong falls to ${n(`${p}still wrong`)})`);
  console.log(`    right, and the catalog declines them   ${n(`${p}cost`)}/${assertedRight}  (the cost: a second photograph of something correct)`);
  console.log(`    right, and the catalog agrees          ${n(`${p}kept`)}/${assertedRight}`);
}
if (causes.size > 0) {
  console.log(`\n  the lines the catalog does not catch: ${[...causes].map(([k, v]) => `${k} ${v}`).join(', ')}`);
  console.log('    "quantity" is the right product and the wrong number of it, which a text catalog cannot see.');
}
console.log(`\n  resolver verdicts over every scored line: ${[...verdicts].map(([k, v]) => `${k} ${v}`).join(', ')}`);
console.log(`  lines the gate already held back: ${n('held right')} right, ${n('held wrong')} wrong`);
