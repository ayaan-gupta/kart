/**
 * What reaches the shopper's bag, per kind of scene the camera is pointed at.
 *
 * `normalizeCensusResponse` holds one gate that decides whether a census reaches the bag at all.
 * It was written against a boolean, `subjectIsCart`, for a real and measured reason: pointed at a
 * shop's shelves the census named 102 of 102 badges as products and refused none, which would put
 * up to 41 items a shopper is not buying into their bag under confident names. See
 * `shelf-census.ts` for that measurement.
 *
 * One boolean cannot carry the whole question. A shopper holding a single product up to the
 * camera is also not photographing a cart, so the same gate empties their bag too, and that is the
 * interaction the product owner asked for on 2026-09-01: point the phone at a grocery item and
 * have it added to the cart. This harness scores all three scenes at once so a change that helps
 * one and breaks another is visible as one result rather than two.
 *
 * It measures the shipped path, not the model: the census runs with no marks, exactly as the
 * capture path calls it, and the response is folded through `applyCensus` and `bagLines`, which is
 * what the app really does with it. So "in the bag" here means in the bag.
 *
 *     node --env-file=server/.env.local server/node_modules/.bin/tsx \
 *       server/eval/pipeline/scene-gate.ts
 *
 * Add `--repeat N` to run every image N times, which is worth doing before trusting a change:
 * the subject verdict is one model judgement per call and it is not perfectly stable.
 *
 * The photographs are the user's own and are not redistributable, so they live in `.cache/` and
 * not in the repository. `scene-labels.json` beside the corpus records what each one is, so this
 * file can be read and reviewed without them; with the cache absent the harness says so and exits
 * rather than reporting zeroes as if it had measured something.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { applyCensus, bagLines, createFusionState } from '../../../src/engine/liveVision/fusion';
import { runCensus } from '../../src/recognize';

const HERE = join(import.meta.dirname, '..');
const IMAGES = join(HERE, '.cache/kart/images');
const labels = JSON.parse(readFileSync(join(HERE, 'corpus/kart/scene-labels.json'), 'utf8'));

if (!existsSync(IMAGES)) {
  console.error(`No images at ${IMAGES}.`);
  console.error("They are the user's own photographs and are not committed. See corpus/kart/manifest.json.");
  process.exit(1);
}

const repeatFlag = process.argv.indexOf('--repeat');
const REPEAT = repeatFlag === -1 ? 1 : Math.max(1, Number(process.argv[repeatFlag + 1] ?? 1));

type Row = {
  id: string;
  kind: string;
  expectItems: boolean;
  /** Runs where the gate did what the label asks: items for cart and product, none for shelf. */
  correct: number;
  runs: number;
  /** Units that reached the bag, per run. */
  units: number[];
  /** Every bag line name seen, for the naming check and for reading the failures. */
  names: string[];
};

const rows: Row[] = [];

for (const image of labels.images) {
  const file = join(IMAGES, `${image.id}.jpg`);
  if (!existsSync(file)) {
    console.log(`  ${image.id}: absent from the cache, skipped`);
    continue;
  }
  const bytes = readFileSync(file);
  const row: Row = {
    id: image.id,
    kind: image.kind,
    expectItems: image.expect_items,
    correct: 0,
    runs: 0,
    units: [],
    names: [],
  };

  for (let run = 0; run < REPEAT; run++) {
    // No marks, which is the capture path: the device never ran a detector, so the server is
    // being asked to find the regions as well as name them.
    const census: any = await runCensus(bytes, []);

    // Through the app's own fusion, so this counts what the shopper would actually see rather
    // than what the model said. With no marks there are no tracks, and unmarkedItems is the
    // channel everything arrives on.
    const state = applyCensus(createFusionState(), census, {}, [], false, {});
    const lines = bagLines(state) as any[];
    const units = lines.reduce((n, l) => n + (l.qty ?? 1), 0);

    const gotItems = units > 0;
    if (gotItems === row.expectItems) row.correct++;
    row.runs++;
    row.units.push(units);
    for (const line of lines) row.names.push(String(line.name ?? ''));

    const verdict = gotItems === row.expectItems ? 'ok ' : 'MISS';
    console.log(
      `  ${verdict} ${image.id} (${image.kind}): subjectIsCart=${census.subjectIsCart} ` +
        `subjectKind=${census.subjectKind ?? '-'} -> ${lines.length} lines, ${units} units` +
        (lines.length > 0 ? `: ${lines.slice(0, 6).map((l) => l.name).join(', ')}` : ''),
    );
  }
  rows.push(row);
}

// Per kind, because a change that lifts one scene and drops another is one result. Reporting a
// single overall percentage would hide exactly the trade this gate is about.
const kinds = ['cart', 'product', 'shelf'];
console.log('\n  scene            images   runs   gate correct');
for (const kind of kinds) {
  const inKind = rows.filter((r) => r.kind === kind);
  if (inKind.length === 0) continue;
  const runs = inKind.reduce((n, r) => n + r.runs, 0);
  const correct = inKind.reduce((n, r) => n + r.correct, 0);
  const pct = runs === 0 ? 0 : Math.round((correct / runs) * 100);
  console.log(
    `  ${kind.padEnd(15)} ${String(inKind.length).padStart(6)} ${String(runs).padStart(6)}   ${correct}/${runs} (${pct}%)`,
  );
}

const allRuns = rows.reduce((n, r) => n + r.runs, 0);
const allCorrect = rows.reduce((n, r) => n + r.correct, 0);
console.log(`  ${'all'.padEnd(15)} ${String(rows.length).padStart(6)} ${String(allRuns).padStart(6)}   ${allCorrect}/${allRuns}`);

// Quantity and naming, on the two labelled product stills only. These are the CLAUDE.md
// measurables that a scene gate can move without moving the gate itself, so they are reported
// here rather than left to a separate run that nobody would make.
console.log('\n  product stills, quantity and naming');
for (const image of labels.images) {
  if (image.kind !== 'product') continue;
  const row = rows.find((r) => r.id === image.id);
  if (row === undefined) continue;
  const expected = image.expect_units;
  const rightCount = row.units.filter((u) => u === expected).length;
  console.log(`  ${image.id}: units ${row.units.join(',')} against ${expected} expected, ${rightCount}/${row.runs} right`);
  const said = row.names.join(' | ').toLowerCase();
  for (const want of image.expect_name_contains ?? []) {
    console.log(`      name contains "${want}": ${said.includes(want) ? 'yes' : 'NO'}`);
  }
  for (const want of image.expect_brand_contains ?? []) {
    console.log(`      brand contains "${want}": ${said.includes(want) ? 'yes' : 'NO'}`);
  }
  if (row.names.length > 0) console.log(`      named: ${row.names.join(', ')}`);
}
