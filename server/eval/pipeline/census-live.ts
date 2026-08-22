/**
 * The shipped census, against the real model, on the real trolley.
 *
 * Everything here is the service's own code: `runCensus` builds the request, sends
 * `CENSUS_SYSTEM_PROMPT` and `censusUserText`, enforces `CENSUS_RESPONSE_SCHEMA` under strict
 * mode and re-derives every productKey server-side. `compositeMarks` draws the badges.
 * `applyCensus` and `bagLines` turn the answer into a bag. This file only supplies the
 * photographs and scores the result.
 *
 * Needs OPENAI_API_KEY, either in the environment or in `server/.env`, which is gitignored.
 *
 * Two things are scored, and the first matters more than its size suggests. Badge alignment is
 * what no per-crop measurement can see: whether the answer for badge 7 lands on badge 7. A 2B
 * model got none of three right on IMG_0249, the simplest photograph here, while naming products
 * that really are in the trolley. Then the bag, against hand-counted truth.
 *
 *     node --env-file=server/.env node_modules/.bin/tsx server/eval/pipeline/census-live.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { join } from 'node:path';
import type { Mark } from '../../src/compositor';
import { MAX_CANDIDATES } from '../../src/enumerate';
import { runCensus } from '../../src/recognize';
import { applyCensus, bagLines, createFusionState } from '../../../src/engine/liveVision/fusion';

const HERE = join(import.meta.dirname, '..');
/**
 * `frames-named.json` is `frames.json` with the catalog matcher's shortlist attached to each
 * box; the boxes themselves are identical. The shortlist is not an extra: `marksFromRegions`
 * attaches it on every shipped request, and rule 15 of the census prompt is written around it.
 * Reading the plain frames file withheld it and measured a question the service never asks.
 * `--no-catalog` restores that harder question, for the comparison.
 */
const withCatalog = !process.argv.includes('--no-catalog');
/**
 * `--frames=<name>` reads a different cache file from `.cache/kart/`, so a detection change can
 * be put through the same census without a second copy of this file. It has to carry the catalog
 * column, which `score_kart.py --index` writes.
 */
const framesArg = process.argv.find((a) => a.startsWith('--frames='));
const FRAMES = framesArg ? framesArg.split('=')[1] : 'frames-named.json';
/**
 * The model is not deterministic and these counts move by two or three units between identical
 * runs, so a single pass cannot tell a change from noise. `--repeat N` runs the whole set N
 * times and reports the spread as well as the mean.
 */
/**
 * `--replay=<file>` answers each photograph from a saved run instead of calling the model.
 *
 * The same instrument `video-census-live.ts` carries, and for the same reason: everything here
 * except `runCensus` is deterministic, so replaying the saved answers holds the model still and
 * lets a fusion-layer change be measured exactly rather than against this corpus's own spread.
 * The file is one this harness wrote, and each entry is matched by photograph id and pass number
 * rather than by position, so a run over a different frame set fails loudly.
 */
const replayArg = process.argv.find((a) => a.startsWith('--replay='));
const REPLAY: Map<string, any> | null = replayArg
  ? new Map(JSON.parse(readFileSync(replayArg.split('=')[1], 'utf8'))
      .map((e: any) => [`${e.id}#${e.pass}`, e.census]))
  : null;

const repeatArg = process.argv.find((a) => a.startsWith('--repeat='));
const REPEATS = repeatArg ? Math.max(1, Number(repeatArg.split('=')[1])) : 1;
const frames = JSON.parse(readFileSync(join(HERE, `.cache/kart/${FRAMES}`), 'utf8'));
const truth = JSON.parse(readFileSync(join(HERE, 'corpus/kart/counts.json'), 'utf8'));
const labels = {
  ...JSON.parse(readFileSync(join(HERE, 'corpus/kart/still-labels.json'), 'utf8')).boxes,
  ...JSON.parse(readFileSync(join(HERE, 'corpus/kart/query-labels.json'), 'utf8')).boxes,
};
const counted = new Map<string, any>(truth.counted.map((c: any) => [c.id, c]));

// What the region really holds, for scoring alignment. `out_of_catalog` is a real product the
// catalog lacks, so the census should still name it; only `skip` and `not_a_product` are not
// products at all.
const NOT_A_PRODUCT = new Set(['skip', 'not_a_product']);
const SAME: Record<string, string[]> = {
  cauliflower: ['cauliflower'], brussels_sprouts: ['brussels', 'sprout'],
  asparagus: ['asparagus'], oreo: ['oreo'], seedtastic_bread: ['bread', 'seedtastic'],
  granny_smith_apples: ['apple', 'granny'], baguette: ['baguette', 'bread'],
  // The bag holds Fuji apples: the label reads MIDWEST GROWN / FUJI and the bottom of the bag
  // reads 3 lb, 2-1/2 inch, Extra Fancy. "grape" and "plum" were here from the same wrong reading
  // that put "tomatoes on the vine" in counts.json, and they scored a correct "produce bag" as a
  // miss twice. The SKU is still kart_purple_produce_bag because the index is built on it.
  purple_produce_bag: ['apple', 'fuji', 'produce bag', 'purple'],
};

/**
 * The words a bag line may use for each real product, per photograph.
 *
 * Unit counts cannot tell a right bag from a lucky one: the scan harness found a run scoring a
 * perfect nine that held one product twice and missed two others. The photographs were only ever
 * scored by size in this file, so the same check is applied here.
 *
 * `strong` is a word only this product would use; `weak` is one it shares with another product in
 * the same trolley. Both counts are reported because resolving "apple" between the Granny Smith
 * bag and the Fuji bag, or "bread" between the baguette and the Seedtastic loaf, is the scorer
 * inventing the answer it exists to check. Repeated entries are repeated products: IMG_0254 holds
 * two egg cartons and two packs of Muenster, and a bag naming one of each is missing one.
 */
type Truth = { id: string; strong: string[]; weak: string[] };
const CAULIFLOWER: Truth = { id: 'Mr Lucky cauliflower', strong: ['cauliflower'], weak: ['lucky'] };
const SPROUTS: Truth = { id: 'brussels sprouts bag', strong: ['brussels', 'sprout'], weak: ['green leafy', 'lettuce'] };
const ASPARAGUS: Truth = { id: 'asparagus bag', strong: ['asparagus'], weak: ['green bean', 'stalk'] };
// The purple bag is printed "WEST GROWN FUJI, Sure to please!" and holds red apples.
const FUJI: Truth = { id: 'Fuji apple bag', strong: ['fuji', 'purple'], weak: ['red apple', 'apple', 'produce bag'] };
const GRANNY: Truth = { id: 'Granny Smith apple bag', strong: ['granny'], weak: ['green apple', 'apple'] };
const SEEDTASTIC: Truth = { id: 'Seedtastic bread', strong: ['seedtastic'], weak: ['bread', 'loaf'] };
const BAGUETTE: Truth = { id: 'baguette', strong: ['baguette'], weak: ['bread'] };
const YELLOW: Truth = { id: 'yellow produce bag', strong: ['yellow'], weak: ['produce bag'] };

const TRUTH: Record<string, Truth[]> = {
  IMG_0244: [CAULIFLOWER],
  IMG_0245: [CAULIFLOWER],
  IMG_0246: [CAULIFLOWER, SPROUTS],
  IMG_0249: [CAULIFLOWER, SPROUTS, ASPARAGUS],
  IMG_0252: [
    { id: 'Oreo party size', strong: ['oreo'], weak: [] },
    BAGUETTE, FUJI, YELLOW, GRANNY, SEEDTASTIC, ASPARAGUS, SPROUTS, CAULIFLOWER,
  ],
  IMG_0254: [
    { id: 'egg carton', strong: ['egg'], weak: [] },
    { id: 'egg carton (second)', strong: ['egg'], weak: [] },
    { id: 'Muenster cheese', strong: ['muenster'], weak: ['cheese'] },
    { id: 'Muenster cheese (second)', strong: ['muenster'], weak: ['cheese'] },
    { id: 'beef pack', strong: ['beef', 'steak'], weak: ['meat'] },
    BAGUETTE,
    { id: 'jar', strong: ['jar'], weak: ['peanut butter', 'sauce', 'spread'] },
    GRANNY, SEEDTASTIC, ASPARAGUS,
    { id: 'Alaskan sockeye salmon', strong: ['salmon', 'sockeye'], weak: ['fish', 'seafood'] },
    CAULIFLOWER, FUJI, YELLOW,
    // counts.json calls this broccoli. Zoomed to native resolution the bag shows green contents
    // behind leaf-print graphics and a 1 LB weight, and no legible product name, so what it holds
    // cannot be read off the photograph. Both models miss "broccoli" on nearly every pass and
    // gpt-5.4 twice answered "brussels sprouts" for it, which the strict tier would score as an
    // invention. The weak tier exists for exactly this: strict still demands the word the truth
    // claims, and the lenient number accepts any bagged green the photograph could support.
    { id: 'broccoli (a bagged green, label not legible)', strong: ['broccoli'],
      weak: ['brussels', 'sprout', 'green bean', 'spring mix', 'romaine', 'lettuce', 'salad', 'greens'] },
  ],
};

/**
 * Greedy assignment, unambiguous words first.
 *
 * A line satisfies as many truth entries as its quantity says, because that is what the bag
 * actually claims: IMG_0254 holds two egg cartons, and one line reading "eggs" with qty 2 is a
 * correct answer, not half of one. Scoring by line name alone marked the second carton missing on
 * every pass and understated both models.
 */
function scoreContents(lines: { name: string; qty: number }[], truth: Truth[]) {
  const left = lines.map((l) => Math.max(1, l.qty));
  const found = new Map<number, 'strong' | 'weak'>();
  for (const tier of ['strong', 'weak'] as const) {
    truth.forEach((product, t) => {
      if (found.has(t)) return;
      const at = lines.findIndex((l, i) => left[i] > 0 && product[tier].some((w) => l.name.includes(w)));
      if (at >= 0) { left[at] -= 1; found.set(t, tier); }
    });
  }
  const strict = [...found.values()].filter((v) => v === 'strong').length;
  return {
    strict,
    lenient: found.size,
    missing: truth.filter((_, t) => !found.has(t)).map((p) => p.id),
    // Units left over after every real product has been satisfied: things in the bag that are not
    // in the trolley, counted in units rather than lines so a qty-2 invention counts twice.
    spurious: lines.flatMap((l, i) => (left[i] > 0 ? [`${l.name}${left[i] > 1 ? ` x${left[i]}` : ''}`] : [])),
  };
}

/**
 * `--as-keyframe` sends each photograph the way the app would send a frame of the same scene.
 *
 * These photographs are 5712 by 4284 and sharp, and `compositeMarks` downscales that to
 * `CENSUS_LONG_EDGE`. The app never has such an image: `KartImageTools.encodeKeyframe` takes a
 * 1080 by 1920 video frame, resizes to 1536 and encodes at JPEG quality 0.85, so the service
 * composites something already compressed once, from a source with motion blur in it. Every
 * photograph figure in this file is therefore an upper bound on the app rather than a description
 * of it, and this flag measures how much of the gap is the encoding alone.
 */
const AS_KEYFRAME = process.argv.includes('--as-keyframe');
async function sendable(file: Buffer): Promise<Buffer> {
  if (!AS_KEYFRAME) return file;
  // `.rotate()` with no argument applies the EXIF orientation and drops the tag, which is what
  // the device produces: `KartImageTools.encodeKeyframe` encodes from an already-upright pixel
  // buffer, so its JPEG carries no orientation to apply. Without this the re-encode leaves an
  // orientation-6 photograph unrotated but strips the tag, `compositeMarks` then draws badges on
  // an image a quarter turn from the one the marks describe, and badge alignment collapses from
  // 88% to 20%. That is the same EXIF fault this corpus found in the shipped compositor, arrived
  // at from the other direction.
  return sharp(file)
    .rotate()
    .resize({ width: 1536, height: 1536, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
}

const results: any[] = [];
const passes: { aligned: number; scorable: number; units: number; real: number; exact: number }[] = [];
let alignedRight = 0;
let alignedScorable = 0;
let bagUnits = 0;
let realUnits = 0;
let exact = 0;
let foundStrict = 0;
let foundLenient = 0;
let truthTotal = 0;
let spuriousTotal = 0;

for (let pass = 0; pass < REPEATS; pass += 1) {
if (REPEATS > 1) console.log(`\n=== pass ${pass + 1} of ${REPEATS} ===\n`);
const before = { aligned: alignedRight, scorable: alignedScorable, units: bagUnits, real: realUnits, exact };
for (const frame of frames.frames) {
  const entry = counted.get(frame.id);
  if (!entry) continue;

  // One-based, and shaped the way `marksFromRegions` shapes it, because that is what the
  // service sends. The matcher's confidence describes its own top choice, so only that row
  // carries it.
  const marks: Mark[] = frame.boxes.map((box: any, i: number) => {
    const mark: Mark = { id: i + 1, box };
    const found = withCatalog ? frame.catalog?.[i] : undefined;
    const alternatives: string[] = found?.alternatives ?? [];
    if (alternatives.length > 0) {
      mark.candidates = alternatives.slice(0, MAX_CANDIDATES).map((sku: string) => ({
        sku,
        confidence: sku === found?.sku ? (found?.confidence ?? 0) : 0,
      }));
    }
    return mark;
  });
  // `runCensus` composites the badges itself, at its own long edge. Compositing first and
  // handing it the result drew every badge twice, once at 1333 and again at 1024 over the top
  // of the first, which is not an image the service ever sends.
  const image = readFileSync(join(HERE, `.cache/kart/images/${frame.id}.jpg`));
  let census: Awaited<ReturnType<typeof runCensus>>;
  if (REPLAY) {
    const saved = REPLAY.get(`${frame.id}#${pass}`);
    if (!saved) throw new Error(`replay file has no entry for ${frame.id} pass ${pass}`);
    census = saved;
  } else {
    census = await runCensus(await sendable(image), marks);
  }

  // Alignment: did the answer for badge i land on badge i?
  const byId = new Map<number, any>(census.marks.map((m: any) => [m.id, m]));
  const rows: any[] = [];
  for (let i = 0; i < frame.boxes.length; i += 1) {
    const label = labels[frame.id]?.[i] ?? 'unlabelled';
    const got = byId.get(i + 1);
    const said = got ? `${got.brand ? got.brand + ' ' : ''}${got.name}`.toLowerCase() : '(no mark)';
    let ok: boolean | null = null;
    if (NOT_A_PRODUCT.has(label)) ok = got ? got.isProduct === false : null;
    else if (SAME[label]) ok = got ? SAME[label].some((w) => said.includes(w)) : false;
    if (ok !== null) { alignedScorable += 1; if (ok) alignedRight += 1; }
    rows.push({ badge: i, truth: label, said, ok });
    console.log(`  ${frame.id} #${String(i).padEnd(2)} ${label.padEnd(22)} -> ` +
      `${said.slice(0, 34).padEnd(36)} ${ok === null ? '-' : ok ? 'ok' : 'X'}`);
  }

  // The bag, through the shipped fusion.
  const trackIds = frame.boxes.map((_: unknown, i: number) => `t${i}`);
  const markToTrack: Record<number, string> = {};
  const liveBoxes: Record<string, any> = {};
  trackIds.forEach((tid: string, i: number) => { markToTrack[i + 1] = tid; liveBoxes[tid] = frame.boxes[i]; });
  const state = applyCensus(createFusionState(), census, markToTrack, trackIds, false, liveBoxes);
  const lines = bagLines(state) as any[];
  const units = lines.reduce((n, l) => n + (l.qty ?? 1), 0);
  bagUnits += units; realUnits += entry.products;
  if (units === entry.products) exact += 1;
  // Contents as well as size. A right total can still be a wrong bag.
  const truth = TRUTH[frame.id];
  let contents: ReturnType<typeof scoreContents> | null = null;
  if (truth) {
    const named = lines.map((l: any) => ({
      name: `${l.brand ? `${l.brand} ` : ''}${l.name}`.toLowerCase(),
      qty: l.qty ?? 1,
    }));
    contents = scoreContents(named, truth);
    foundStrict += contents.strict;
    foundLenient += contents.lenient;
    truthTotal += truth.length;
    spuriousTotal += contents.spurious.length;
  }
  console.log(`  ${frame.id}: bag ${units} against ${entry.products} real` +
    (contents ? `, products found ${contents.strict}/${contents.lenient} of ${truth.length}` +
      (contents.missing.length ? `, missing ${contents.missing.join(', ')}` : '') +
      (contents.spurious.length ? `, extra: ${contents.spurious.join(', ')}` : '') : '') + `\n`);
  results.push({ id: frame.id, pass, rows, units, real: entry.products, lines, census, contents });
}
passes.push({
  aligned: alignedRight - before.aligned,
  scorable: alignedScorable - before.scorable,
  units: bagUnits - before.units,
  real: realUnits - before.real,
  exact: exact - before.exact,
});
}

console.log(`\n  catalog shortlist ${withCatalog ? 'attached, as the service attaches it' : 'withheld'}`);
if (REPEATS > 1) {
  const per = (f: (p: typeof passes[0]) => number) => passes.map(f);
  console.log(`  ${REPEATS} passes`);
  console.log(`  badge alignment  per pass ${per((p) => p.aligned).join(', ')} of ${passes[0].scorable}`);
  console.log(`  units in the bag per pass ${per((p) => p.units).join(', ')} against ${passes[0].real}`);
  console.log(`  photographs exact per pass ${per((p) => p.exact).join(', ')} of 6`);
}
console.log(`  badge alignment  ${alignedRight}/${alignedScorable}` +
  ` (${(alignedRight / Math.max(alignedScorable, 1) * 100).toFixed(1)}%)`);
console.log(`  units in the bag ${bagUnits} against ${realUnits} real items`);
console.log(`  photographs exact ${exact}/${results.length}`);
console.log(`  products found ${foundStrict}/${truthTotal} on an unambiguous word, ` +
  `${foundLenient}/${truthTotal} allowing words a trolley shares between two products`);
console.log(`  lines matching nothing real ${spuriousTotal}`);
const stem = FRAMES === 'frames-named.json' ? '' : `-${FRAMES.replace(/\.json$/, '')}`;
// A replay run answered from this file, so writing it back would at best be a no-op.
if (!REPLAY) {
  writeFileSync(
    join(HERE, withCatalog ? `kart-census-live${stem}.json` : 'kart-census-live-nocatalog.json'),
    JSON.stringify(results, null, 1));
}
