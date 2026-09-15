/**
 * Counts the lines the server held back and the bag asserted anyway, on every run already saved.
 *
 * `reconcile` and `doubtByPackages` answer with two separate things: a confidence, and a verdict.
 * The bag only ever saw the first. `bagLines` decides a line by `identity.confidence <
 * UNSURE_BELOW` and there is nothing else in fusion to decide it by, so the verdict had to be
 * carried in as a capped confidence, and `photoScan` capped it for two of the three doubts and
 * not the third. A line both readings agreed on carries their average, about 0.96, and
 * `doubtByPackages` may take its certainty away afterwards without touching that number, which is
 * a line the review screen showed in amber and the bag asserted.
 *
 *     node server/node_modules/.bin/tsx server/eval/pipeline/gate-leak.ts server/eval/clut-photos-head.json ...
 *
 * No model call: every run file already holds the server's verdict per crop and the bag line it
 * became, so this is arithmetic over runs that are already paid for. Each crop is matched to its
 * line by the same `productKey` fold fusion uses, which is how the line got its key in the first
 * place. A crop the unit pass split is skipped: those lines are asserted by nobody and the split
 * replaces the crop's own line, so there is no one verdict to attribute.
 */
import { readFileSync } from 'node:fs';

const { productKey } = await import('../../../src/engine/liveVision/fusion');

type Outcome = 'right' | 'wrong' | 'invented' | 'ignored';
interface SavedRow {
  id: string;
  pass?: number;
  lines?: { name: string; brand: string | null; qty: number; sure?: boolean }[];
  lineOutcomes?: (Outcome | null)[];
  verify?: {
    items: {
      id: string;
      line: { description: string; brand: string | null; sure: boolean; confidence: number };
      split?: unknown[];
    }[];
  };
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('usage: gate-leak.ts <run.json> [run.json ...]');
  process.exit(1);
}

for (const file of files) {
  const data = JSON.parse(readFileSync(file, 'utf8')) as { rows: SavedRow[] };
  const tally: Record<Outcome, number> = { right: 0, wrong: 0, invented: 0, ignored: 0 };
  let asserted = 0;
  let leaked = 0;
  const examples: string[] = [];
  for (const row of data.rows) {
    if (!row.lines || !row.verify) continue;
    // The server's verdict per product, keyed the way the bag keys a line.
    const verdict = new Map<string, boolean>();
    for (const item of row.verify.items) {
      if (item.split !== undefined && item.split.length > 1) continue;
      verdict.set(productKey(item.line.description, item.line.brand), item.line.sure);
    }
    row.lines.forEach((line, i) => {
      if (line.sure !== true) return;
      asserted += 1;
      const held = verdict.get(productKey(line.name, line.brand));
      if (held !== false) return;
      leaked += 1;
      const outcome = row.lineOutcomes?.[i];
      if (outcome != null) tally[outcome] += 1;
      if (examples.length < 12) {
        examples.push(`${row.id}${row.pass === undefined ? '' : ` pass${row.pass}`}  ${outcome ?? '?'}  ${line.qty} x ${line.name}${line.brand === null ? '' : ` (${line.brand})`}`);
      }
    });
  }
  console.log(`\n${file}`);
  console.log(`  lines the bag asserted                 ${asserted}`);
  console.log(`  of those, lines the server held back   ${leaked}`);
  console.log(`    wrong ${tally.wrong}   invented ${tally.invented}   ignored ${tally.ignored}   right ${tally.right}`);
  for (const line of examples) console.log(`    ${line}`);
}
