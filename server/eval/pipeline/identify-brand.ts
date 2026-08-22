/**
 * Whether the second pass can read a brand the census guesses at.
 *
 * The census names one Mr. Lucky cauliflower "the little potato company?", "mira lucky",
 * "r. tubby lucky", "goodlife", "ducky" and plain "cauliflower" across runs, and reports
 * needsCloserLook false every time. The wrapper legibly reads MR. LUCKY, so the information is
 * in the photograph; what the census sees is the whole trolley shrunk to a fixed long edge.
 *
 * `runIdentify` exists for exactly this: one tight crop, taken at the frame's full resolution.
 * This measures whether it gets the brand right, on the six regions this corpus can score, so
 * the question "should the census flag these" has a number behind it.
 *
 *     node --env-file=server/.env.local server/node_modules/.bin/tsx server/eval/pipeline/identify-brand.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runIdentify } from '../../src/recognize';

const HERE = join(import.meta.dirname, '..');
const frames = JSON.parse(readFileSync(join(HERE, '.cache/kart/frames-named.json'), 'utf8'));
const labels = {
  ...JSON.parse(readFileSync(join(HERE, 'corpus/kart/still-labels.json'), 'utf8')).boxes,
  ...JSON.parse(readFileSync(join(HERE, 'corpus/kart/query-labels.json'), 'utf8')).boxes,
};

// The one brand this corpus can score: the wrapper reads MR. LUCKY, on every photograph of it.
const TRUTH = 'mr. lucky';
const rows: any[] = [];
let right = 0;
let total = 0;

for (const frame of frames.frames) {
  const marks: string[] = labels[frame.id] ?? [];
  for (let i = 0; i < marks.length; i += 1) {
    if (marks[i] !== 'cauliflower') continue;
    const image = readFileSync(join(HERE, `.cache/kart/images/${frame.id}.jpg`));
    const got = await runIdentify(image, null, frame.boxes[i]);
    const brand = (got.brand ?? '').toLowerCase().replace(/\./g, '');
    const ok = brand.includes('lucky') && brand.includes('mr');
    total += 1;
    if (ok) right += 1;
    rows.push({ id: frame.id, badge: i + 1, brand: got.brand, name: got.name,
      confidence: got.confidence, stillUnclear: got.stillUnclear, ok });
    console.log(`  ${frame.id} #${i + 1}  brand ${String(got.brand).padEnd(22)} ` +
      `name ${String(got.name).slice(0, 24).padEnd(26)} conf ${got.confidence.toFixed(2)} ` +
      `${ok ? 'ok' : 'X'}${got.stillUnclear ? ' (still unclear)' : ''}`);
  }
}
console.log(`\n  identify read the brand right on ${right} of ${total} crops, against ` +
  `2 of 6 for the census at 1024 and 6 of 6 at 1536 on the three it was swept over`);
writeFileSync(join(HERE, 'kart-identify-brand.json'), JSON.stringify(rows, null, 1));
