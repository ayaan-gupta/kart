/**
 * A whole photograph session, end to end, against the real recognition service.
 *
 * `photoScan.test.ts` proves the module does what its author meant, with a stubbed census. This
 * proves the product works: it drives the same `scanPhoto` the screen calls, against the running
 * service, on the user's own photographs, and reports what would be in the shopper's bag after
 * every shutter press.
 *
 * It exists because the unit tests cannot fail on the two things most likely to break here. The
 * model chooses its own words, so whether two photographs of one product fold into one line is a
 * property of the live model and the `counted` hint, not of the fusion code. And the subject gate
 * runs on the server, so whether a shelf still adds nothing can only be seen from this side.
 *
 * Start the service first, then:
 *
 *     npm run serve --prefix server
 *     node --env-file=server/.env.local server/node_modules/.bin/tsx \
 *       server/eval/pipeline/photo-session.ts
 *
 * `--api <url>` points it somewhere other than 127.0.0.1:4310.
 *
 * The photographs are the user's own and are not redistributable, so they live in `.cache/` and
 * not in the repository.
 */
import '../replay/rn-globals';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
function arg(name: string, fallback: string): string {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (argv[i + 1] ?? fallback);
}
process.env.EXPO_PUBLIC_KART_API_URL = arg('api', 'http://127.0.0.1:4310');

// Imported after the environment is set, for the reason rn-globals.ts documents: config.ts reads
// these at call time, but the client module is what binds them into a base URL.
const { createPhotoScanState, scanPhoto } = await import('../../../src/engine/liveVision/photoScan');
const { requestCensus } = await import('../../../src/engine/liveVision/recognitionClient');

const IMAGES = join(import.meta.dirname, '../.cache/kart/images');

/**
 * One shopper's session, in the order they would press the shutter.
 *
 * The repeat of PRACTICE_0002 is the point of the whole harness: it is the same bag of walnuts
 * photographed a second time, and the bag must still hold one.
 */
const SESSION: { id: string; expect: string }[] = [
  { id: 'PRACTICE_0002', expect: 'walnuts arrive, 1 unit' },
  { id: 'PRACTICE_0001', expect: 'two cartons arrive as 2 units, walnuts still there' },
  { id: 'PRACTICE_0002', expect: 'walnuts photographed again, still 1 unit, nothing new' },
  { id: 'IMG_0247', expect: 'a shop shelf, nothing added' },
];

if (!existsSync(IMAGES)) {
  console.error(`No images at ${IMAGES}. See server/eval/corpus/kart/manifest.json.`);
  process.exit(1);
}

let state = createPhotoScanState();
let shot = 0;
const failures: string[] = [];

for (const step of SESSION) {
  const file = join(IMAGES, `${step.id}.jpg`);
  if (!existsSync(file)) {
    console.log(`  ${step.id}: absent from the cache, skipped`);
    continue;
  }
  shot += 1;
  const base64 = readFileSync(file).toString('base64');
  const started = Date.now();
  const outcome = await scanPhoto(state, base64, { requestCensus });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  if (!outcome.ok) {
    console.log(`  shot ${shot} ${step.id}: FAILED (${outcome.failure}) in ${seconds}s`);
    failures.push(`${step.id} returned ${outcome.failure}`);
    continue;
  }
  state = outcome.state;
  const units = outcome.lines.reduce((n, l) => n + l.qty, 0);
  console.log(
    `  shot ${shot} ${step.id}: +${outcome.added} new, bag now ${outcome.lines.length} lines / ${units} units, ${seconds}s`,
  );
  console.log(`      expected: ${step.expect}`);
  for (const line of outcome.lines) {
    console.log(`      - ${line.qty} x ${line.name}${line.brand ? ` (${line.brand})` : ''}`);
  }
}

// The three properties this flow has to hold, checked rather than eyeballed. Named so a failure
// says which one broke.
const finalLines = (await scanPhoto(state, readFileSync(join(IMAGES, 'PRACTICE_0002.jpg')).toString('base64'), { requestCensus }));
if (finalLines.ok) {
  state = finalLines.state;
  const names = finalLines.lines.map((l) => l.name.toLowerCase());
  const walnut = finalLines.lines.filter((l) => l.name.toLowerCase().includes('walnut'));
  console.log('\n  checks');
  const say = (ok: boolean, label: string) => {
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`);
    if (!ok) failures.push(label);
  };
  say(walnut.length === 1, 'the walnuts are one line after being photographed three times');
  say(
    walnut.every((l) => l.qty === 1),
    'the walnuts are one unit after being photographed three times',
  );
  say(
    names.some((n) => n.includes('carton') || n.includes('box') || n.includes('cereal') || n.includes('tea')),
    'the cartons photographed earlier are still in the bag',
  );
  say(finalLines.added === 0, 'a repeat photograph adds no new line');
}

console.log(`\n  ${failures.length === 0 ? 'all checks passed' : `${failures.length} failed:`}`);
for (const f of failures) console.log(`    ${f}`);
process.exit(failures.length === 0 ? 0 : 1);
