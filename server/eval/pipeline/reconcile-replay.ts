/**
 * What the store's catalog would rescue, replayed over runs that already happened.
 *
 * `reconcile` holds a line back when either reading reports a confidence under `UNSURE_BELOW`,
 * and it does that *before* asking the catalog. Qwen's confidence is quantised and it answers
 * 0.5 constantly: over the runs of 2026-09-14 that is most of the lines on some photographs, and
 * every one of them reports `catalog: "not-reached"`. So on exactly the lines where the shop's own
 * product list is the strongest evidence available, the leg built to use it is switched off.
 *
 * The closed-world assumption in CLAUDE.md is that the catalog is the complete set of things that
 * can be in the cart. A reading both passes agree on, which resolves to exactly one entry of that
 * list and clearly beats the next, has been corroborated by something outside the reader. That is
 * a different and better kind of evidence than the reader's opinion of itself.
 *
 *   rescue    a line held back only by a low self-reported confidence is asserted when the catalog
 *             resolves it to one entry. Every other reason to hold a line back is untouched: a
 *             close read that disagrees, a different brand, a different count, an illegible label,
 *             a count above one, and the package check.
 *   reasons   why each line the gate holds back was held back, counted against what the scorer
 *             said the line was. The gate's cost is its biggest number and nothing said which of
 *             its eight exits produced it.
 *   spelling  a line the catalog matched is shown under the entry's brand rather than the
 *             reader's. `resolve` matches a brand fuzzily and `matched` already requires it to be
 *             this shop's brand, clear of the next entry, so the reading that got there wrote a
 *             misspelling of a brand the shop stocks. Qwen writes PAIANO and PALANO for PRIANO.
 *             The line carries the misreading to the shopper anyway, and is scored wrong for it.
 *
 * No model call. Every input is in the saved runs, so the policy is chosen against real output
 * rather than against phrases invented to suit it.
 *
 *     node --env-file=server/.env.local server/node_modules/.bin/tsx \
 *       server/eval/pipeline/reconcile-replay.ts server/eval/clut-photos-asphone.json [more...]
 *
 *       --catalog <path>  default server/eval/corpus/clut/catalog.json
 *       --show            print every line the policy changes
 *
 * The two numbers pull against each other, as they do in `catalog-replay.ts`:
 *
 *   rescued        lines held back that were right, now asserted. The gate's cost, recovered.
 *   newly wrong    lines held back that were wrong, now asserted. This is the bar in CLAUDE.md,
 *                  and it must stay 0.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
function arg(name: string, fallback: string): string {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (argv[i + 1] ?? fallback);
}
const show = argv.includes('--show');
const takesValue = new Set(['--catalog']);
const runs = argv.filter((a, i) => !a.startsWith('--') && !takesValue.has(argv[i - 1] ?? ''));

const { buildCatalog, resolve } = await import('../../src/catalog.js');
const { reconcile, UNSURE_BELOW } = await import('../../src/reconcile.js');
const { norm, scoreImage } = await import('./clut-scoring.js');

const LABELS = JSON.parse(readFileSync(join(import.meta.dirname, '../corpus/clut/labels.json'), 'utf8')) as {
  images: { id: string; products: unknown[]; ignoreMatch?: string[] }[];
  ignoreMatch?: string[];
};

const catalogPath = arg('catalog', join(import.meta.dirname, '../corpus/clut/catalog.json'));
const catalog = buildCatalog(
  (JSON.parse(readFileSync(catalogPath, 'utf8')) as {
    entries: { sku: string; brand: string | null; name: string; aliases?: string[] }[];
  }).entries,
);

interface Wide { name: string; brand: string | null; qty: number; confidence: number }
interface Close {
  name: string; brand: string | null; count: number; confidence: number;
  legible: boolean; matchesHint: boolean; catalogSku: string | null;
}
interface Row {
  id: string; pass: number;
  items: Wide[];
  lines: { name: string; brand: string | null; qty: number; sure?: boolean }[];
  lineOutcomes: ('right' | 'wrong' | 'invented' | 'ignored')[];
  verify?: { items: { close: Close | null; line: { sure: boolean; catalog: string } }[] };
}

/**
 * Which of `reconcile`'s exits held a line back, tested in the order the function tests them so
 * each line is attributed to the first thing that was wrong with it and not to the last.
 */
function heldBackBy(wide: Wide, close: Close | null, catalog: Parameters<typeof resolve>[1]): string {
  if (close === null) return 'no close read';
  const foldBrand = (b: string | null): string => norm(b ?? '');
  if (!close.legible && (foldBrand(wide.brand).length > 0 || foldBrand(close.brand).length > 0)) return 'illegible label';
  if (!close.matchesHint) return 'close read says it is something else';
  const wb = foldBrand(wide.brand);
  const cb = foldBrand(close.brand);
  if (wb.length > 0 && cb.length > 0 && wb !== cb) return 'the two brands differ';
  if (close.count !== wide.qty) return 'the two counts differ';
  if (wide.confidence < UNSURE_BELOW || close.confidence < UNSURE_BELOW) return 'low confidence';
  const verdict = resolve({ name: wide.name, brand: close.legible ? (close.brand ?? wide.brand) : wide.brand }, catalog);
  if (verdict.status === 'absent' || verdict.status === 'ambiguous') return `catalog ${verdict.status}`;
  if (wide.qty > 1) return 'a count above one';
  return 'the package check';
}
const reasons = new Map<string, { right: number; wrong: number; invented: number; ignored: number; unjoined: number }>();

const totals = {
  items: 0, replayed: 0, mismatched: 0, unjoined: 0,
  changed: 0, rescuedRight: 0, newlyWrong: 0, rescuedInvented: 0, rescuedIgnored: 0,
};

for (const file of runs) {
  const run = JSON.parse(readFileSync(file, 'utf8')) as { rows: Row[] };
  for (const row of run.rows) {
    const verified = row.verify?.items ?? [];
    // Index joins the two only when the census and the verify agree on how many items there were.
    // A split line breaks that, and a wrong join would attribute one product's reading to another.
    if (verified.length !== row.items.length) { totals.unjoined += verified.length; continue; }
    for (const [i, saved] of verified.entries()) {
      const wide = row.items[i];
      const close = saved.close;
      totals.items += 1;
      if (close === null) continue;

      // Reproduce the shipped verdict before changing it. A replay that cannot rebuild what the
      // service actually returned is measuring its own arithmetic, not the pipeline.
      const shipped = reconcile(
        { description: wide.name, brand: wide.brand, count: wide.qty, confidence: wide.confidence },
        close,
        catalog,
      );
      if (shipped.sure !== saved.line.sure) { totals.mismatched += 1; continue; }
      totals.replayed += 1;

      // Held back only by the self-report: everything else about the two readings agrees, which is
      // what re-running reconcile at a confidence over the bar tests in one step.
      if (saved.line.sure) continue;
      const at0 = row.lines.findIndex((l) => norm(l.name) === norm(wide.name));
      const was = at0 === -1 ? 'unjoined' : row.lineOutcomes[at0];
      const reason = heldBackBy(wide, close, catalog);
      const tally = reasons.get(reason) ?? { right: 0, wrong: 0, invented: 0, ignored: 0, unjoined: 0 };
      tally[was as keyof typeof tally] += 1;
      reasons.set(reason, tally);

      const lowOnly = reconcile(
        { description: wide.name, brand: wide.brand, count: wide.qty, confidence: 1 },
        { ...close, confidence: Math.max(close.confidence, UNSURE_BELOW) },
        catalog,
      );
      if (!lowOnly.sure) continue;
      if (wide.confidence >= UNSURE_BELOW && close.confidence >= UNSURE_BELOW) continue;
      const verdict = resolve({ name: wide.name, brand: lowOnly.brand }, catalog);
      if (verdict.status !== 'matched') continue;

      // What the scorer already said about the bag line this reading became.
      const at = row.lines.findIndex((l) => norm(l.name) === norm(wide.name));
      const outcome = at === -1 ? null : row.lineOutcomes[at];
      totals.changed += 1;
      if (outcome === 'right') totals.rescuedRight += 1;
      else if (outcome === 'wrong') totals.newlyWrong += 1;
      else if (outcome === 'invented') totals.rescuedInvented += 1;
      else if (outcome === 'ignored') totals.rescuedIgnored += 1;
      if (show) {
        console.log(`  ${row.id}-p${row.pass}  ${String(outcome ?? 'unjoined').padEnd(9)}`
          + ` ${wide.qty} x ${wide.name} (${wide.brand ?? '-'})  conf ${wide.confidence}/${close.confidence}`
          + `  -> ${verdict.status === 'matched' ? verdict.sku : ''}`);
      }
    }
  }
}

/**
 * The spelling arm, scored with the committed scorer rather than by counting transitions: the
 * brand a line shows is one of the things `scoreImage` grades, so the way to ask what changing it
 * is worth is to grade the bag again.
 */
const spelling = { brandRight: 0, brandScored: 0, found: 0, labelled: 0, changed: 0, assertedWrong: 0 };
const unsureToo = { brandRight: 0, brandScored: 0, found: 0, labelled: 0, changed: 0, assertedWrong: 0 };
const shippedScore = { brandRight: 0, brandScored: 0, found: 0, labelled: 0, assertedWrong: 0 };
for (const file of runs) {
  const run = JSON.parse(readFileSync(file, 'utf8')) as { rows: (Row & { tier: string })[] };
  for (const row of run.rows) {
    const image = LABELS.images.find((i) => i.id === row.id);
    if (image === undefined) continue;
    const scene = { products: image.products, ignoreMatch: (image.ignoreMatch ?? LABELS.ignoreMatch ?? []) } as never;
    const before = scoreImage(row.lines as never, scene);
    const after = scoreImage(
      row.lines.map((line) => {
        // The reading is respelled only where the shipped rule respells it: the line has to be one
        // the catalog actually resolved. An unsure line never reaches `resolve` in the pipeline,
        // so respelling it here would measure a change the service does not make.
        if (line.sure !== true) return line;
        const verdict = resolve({ name: line.name, brand: line.brand }, catalog);
        if (verdict.status !== 'matched' || verdict.entry.brand === null) return line;
        if (norm(verdict.entry.brand) === norm(line.brand ?? '')) return line;
        spelling.changed += 1;
        return { ...line, brand: verdict.entry.brand };
      }) as never,
      scene,
    );
    // And the same rule lifted to the lines the gate is holding back. Respelling one asserts
    // nothing: the line stays unsure and the shopper is still asked for another photograph. It
    // decides only which spelling of the brand that question is asked under, and the scorer grades
    // the brand of an unsure line too, which is where every brand error on this corpus lives.
    const everywhere = scoreImage(
      row.lines.map((line) => {
        const verdict = resolve({ name: line.name, brand: line.brand }, catalog);
        if (verdict.status !== 'matched' || verdict.entry.brand === null) return line;
        if (norm(verdict.entry.brand) === norm(line.brand ?? '')) return line;
        unsureToo.changed += 1;
        return { ...line, brand: verdict.entry.brand };
      }) as never,
      scene,
    );
    for (const [score, into] of [[before, shippedScore], [after, spelling], [everywhere, unsureToo]] as const) {
      into.brandRight += score.brandRight;
      into.brandScored += score.brandScored;
      into.found += score.found;
      into.labelled += (image.products as { legible: boolean }[]).length;
      into.assertedWrong += score.assertedOutcomes.filter((o) => o === 'wrong' || o === 'invented').length;
    }
  }
}

console.log('');
console.log(`  ${totals.replayed} of ${totals.items} lines replayed exactly`
  + `${totals.mismatched > 0 ? `, ${totals.mismatched} the replay could not reproduce` : ''}`
  + `${totals.unjoined > 0 ? `, ${totals.unjoined} in scans whose census and verify counts differ` : ''}`);
console.log(`  ${totals.changed} lines the catalog would assert that the gate holds back:`);
console.log(`    right       ${totals.rescuedRight}   (the gate's cost, recovered)`);
console.log(`    WRONG       ${totals.newlyWrong}   (must be 0)`);
console.log(`    invented    ${totals.rescuedInvented}   (must be 0)`);
console.log(`    ignored     ${totals.rescuedIgnored}`);

console.log('');
console.log(`  spelling: ${spelling.changed} lines shown under the shop's spelling instead of the reader's`);
console.log(`    brands right    ${shippedScore.brandRight}/${shippedScore.brandScored}  ->  ${spelling.brandRight}/${spelling.brandScored}`);
console.log(`    found           ${shippedScore.found}/${shippedScore.labelled}  ->  ${spelling.found}/${spelling.labelled}`);
console.log(`    asserted wrong  ${shippedScore.assertedWrong}  ->  ${spelling.assertedWrong}`);
console.log('');
console.log(`  the same rule on the lines the gate holds back too: ${unsureToo.changed} lines`);
console.log(`    brands right    ${shippedScore.brandRight}/${shippedScore.brandScored}  ->  ${unsureToo.brandRight}/${unsureToo.brandScored}`);
console.log(`    found           ${shippedScore.found}/${shippedScore.labelled}  ->  ${unsureToo.found}/${unsureToo.labelled}`);
console.log(`    asserted wrong  ${shippedScore.assertedWrong}  ->  ${unsureToo.assertedWrong}`);

console.log('');
console.log('  why the gate held a line back, and what the scorer said that line was:');
const ordered = [...reasons.entries()].sort((a, b) => {
  const n = (t: typeof a[1]): number => t.right + t.wrong + t.invented + t.ignored + t.unjoined;
  return n(b[1]) - n(a[1]);
});
for (const [reason, t] of ordered) {
  const n = t.right + t.wrong + t.invented + t.ignored + t.unjoined;
  console.log(`    ${String(n).padStart(3)}  ${reason.padEnd(34)}`
    + ` right ${t.right}  wrong ${t.wrong}  invented ${t.invented}  ignored ${t.ignored}`);
}
