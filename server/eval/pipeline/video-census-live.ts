/**
 * The bag a scan session builds, with the real census answering.
 *
 * `video-census-oracle.ts` measures the same nine seconds with perfect answers, and `--local`
 * measures it with a 2B model. This is the shipped path end to end: the tracker carries
 * identity, `evaluateKeyframe` decides which frames are worth a call, `worthACensus` paces them
 * against `MAX_CENSUS_CALLS_PER_SESSION`, `runCensus` asks the model, and `applyCensus` folds
 * the answer into one bag.
 *
 * The trolley in the video is the one in IMG_0252, so its hand count is the truth: nine products.
 * (It read as ten until the purple bag and the "tomatoes on the vine" beside it were found to be
 * one Fuji apple bag. The scored number below comes from counts.json, which carries the fix.)
 *
 * The catalog shortlist is attached, from `video-frames-catalog.json`. The column in
 * `video-frames.json` is stale: `score_video.py` ran before `build_kart_catalog.py` cut this
 * trolley's references, so not one of its 137 boxes carried a single one of this trolley's eight
 * products anywhere in its five entries, and every earlier run over this video was offered
 * Pulses and Poha for a cauliflower. Refreshed against the same index, 129 of 130 boxes carry
 * one. `--no-catalog` runs it the old way.
 *
 * Those references were cut from this same video, so the shortlist here is better than a store's
 * catalog would be and this bounds the shipped path from above. The stills are where the
 * shortlist is honest, references from the video and queries from photographs it never saw.
 *
 *     node --env-file=server/.env.local server/node_modules/.bin/tsx server/eval/pipeline/video-census-live.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyCensus, bagLines, createFusionState } from '../../../src/engine/liveVision/fusion';
import type { CensusResult, FusionState } from '../../../src/engine/liveVision/fusion';
import { createPipelineState, processFrame } from '../../../src/engine/liveVision/pipeline';
import { createSessionState, marksFor, worthACensus } from '../../../src/engine/liveVision/orchestrator';
import { MAX_CANDIDATES } from '../../src/enumerate';
import { runCensus } from '../../src/recognize';
import type { Mark } from '../../src/compositor';

const HERE = join(import.meta.dirname, '..');
const withCatalog = !process.argv.includes('--no-catalog');
/** `--frames=<name>` reads a different file from `server/eval/`, so a detection change can be
 * put through the same scan without a second copy of this file. */
const framesArg = process.argv.find((a) => a.startsWith('--frames='));
const video = JSON.parse(readFileSync(join(HERE, framesArg ? framesArg.split('=')[1]
  : (withCatalog ? 'video-frames-catalog.json' : 'video-frames.json')), 'utf8'));

/** Overlap of two normalized boxes, for putting a smoothed track box back on its detection. */
function iou(a: any, b: any): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  if (x2 <= x1 || y2 <= y1) return 0;
  const overlap = (x2 - x1) * (y2 - y1);
  return overlap / (a.w * a.h + b.w * b.h - overlap);
}
const truth = JSON.parse(readFileSync(join(HERE, 'corpus/kart/counts.json'), 'utf8'));
const cart = truth.counted.find((c: any) => c.id === 'IMG_0252');
const PRODUCTS: string[] = cart.items;

/** `frame-001.jpg` is order 0, the way `score_kart_tracks.py` reads them back. */
const imageFor = (order: number) =>
  join(HERE, `.cache/kart/video/frame-${String(order + 1).padStart(3, '0')}.jpg`);

/**
 * `--max-calls=N` stops after N censuses.
 *
 * Every attempt so far has given the census more to see or say and made the scan worse. The
 * untried direction is less: the trolley is static, each call re-describes it in fresh words, and
 * nothing joins the descriptions but the words themselves. If the fourth look costs more than it
 * finds, the cap is the fix and it is free.
 */
const capArg = process.argv.find((a) => a.startsWith('--max-calls='));
const MAX_CALLS = capArg ? Number(capArg.split('=')[1]) : Infinity;

/**
 * `--replay=<file>` answers each census from a saved run instead of calling the model.
 *
 * Everything in the loop below except `runCensus` is deterministic: `processFrame`, `marksFor`,
 * the shortlist attach, `applyCensus` and `bagLines` all return the same thing for the same
 * input, every time. So replaying the saved answers holds the model perfectly still and lets a
 * fusion-layer change be measured exactly, with none of the run-to-run spread that makes a
 * one-unit change unfalsifiable against the live model (see KART.md, seventeenth investigation).
 *
 * The file is one this harness wrote: `server/eval/kart-video-census-live.json`. Each entry is
 * consumed in call order and its `t` and `order` are checked against the frame actually reached,
 * so a replay file from a different frame set or a changed keyframe gate fails loudly instead of
 * quietly scoring the wrong pairing.
 */
/**
 * `--regions=N` keeps only the N highest-scoring regions per frame.
 *
 * This harness feeds the census Grounding DINO's regions, a median of 5.1 per frame, because that
 * is what the server's enumerator produces. **The shipped app does not use them.** `scan.tsx`
 * calls `RecognitionSession.onKeyframe`, which badges the census from the on-device tracker, and
 * those tracks come from `AppleInstanceMaskDetector`. Run over these exact frames with
 * `npm run bench:detector`, that detector returns 1 to 2 instances per frame, mean 1.1, on all 30
 * images, which `docs/detector-decision.md` had already measured as dead for enumeration.
 *
 * `--regions=1` approximates the supply the app really has, so a number here can be read against
 * the path a shopper is on rather than only against the one the server could offer. Measured that
 * way the bag roughly doubles, 15 to 18 units for nine real products against 9.8 with the full
 * set, while finding about the same 7 or 8 of 9: with one badge nearly everything arrives through
 * `unmarkedItems`, which carries no joining SKU half the time, so one product becomes several
 * lines.
 *
 * It is an optimistic approximation twice over and should be read as a bound. It keeps the
 * best-scoring grounded box rather than whatever blob Apple's segmenter returns, and it still
 * lets the tracker see every region for continuity.
 */
const regionsArg = process.argv.find((a) => a.startsWith('--regions='));
const REGIONS_PER_FRAME = regionsArg ? Math.max(1, Number(regionsArg.split('=')[1])) : Infinity;

/** `--trace` prints which track each badge resolved to, for diagnosing a split bag line. */
const TRACE = process.argv.includes('--trace');
const replayArg = process.argv.find((a) => a.startsWith('--replay='));
const REPLAY: any[] | null = replayArg
  ? JSON.parse(readFileSync(replayArg.split('=')[1], 'utf8'))
  : null;

let pipeline = createPipelineState();
let fusion: FusionState = createFusionState();
let censusCalls = 0;
let fired = 0;
const calls: any[] = [];

for (const frame of video.frames) {
  if (Number.isFinite(REGIONS_PER_FRAME) && frame.boxes.length > REGIONS_PER_FRAME) {
    const keep = frame.boxes
      .map((_: unknown, i: number) => i)
      .sort((a: number, b: number) => frame.scores[b] - frame.scores[a])
      .slice(0, REGIONS_PER_FRAME);
    frame.boxes = keep.map((i: number) => frame.boxes[i]);
    frame.scores = keep.map((i: number) => frame.scores[i]);
    if (frame.catalog) frame.catalog = keep.map((i: number) => frame.catalog[i]);
  }
  const scan = {
    instances: frame.boxes.map((box: any, i: number) => ({
      box,
      polygon: [box.x, box.y, box.x + box.w, box.y, box.x + box.w, box.y + box.h, box.x, box.y + box.h],
      score: frame.scores[i],
    })),
    barcodes: [],
    sharpness: frame.sharpness,
    motion: frame.motion,
    crops: [],
  };
  const stepped = processFrame(pipeline, scan as any, frame.t * 1000);
  pipeline = stepped.state;
  const live = stepped.tracks.filter((t) => t.state !== 'lost');

  if (censusCalls >= MAX_CALLS) continue;
  const session = { ...createSessionState(), censusCalls, fusion };
  if (!stepped.keyframe.fire || !worthACensus(session, live)) continue;

  // Over `live`, not over every track the step returned. `liveBoxes` and the id list handed to
  // applyCensus are built from `live`, and a mark pointing at a track missing from both arrives
  // with no box for the fusion to place it on.
  const { marks: bare, markToTrack } = marksFor(live);
  if (bare.length === 0) continue;
  // A track box is Kalman-smoothed, so it is near its detection rather than equal to it. Put
  // each mark back on the frame box it overlaps most and carry that box's shortlist across,
  // which is what `marksFromRegions` does when the regions and the marks are the same objects.
  const marks: Mark[] = bare.map((m) => {
    if (!withCatalog) return m;
    let best = -1;
    let bestScore = 0.1;
    frame.boxes.forEach((box: any, i: number) => {
      const score = iou(m.box, box);
      if (score > bestScore) { bestScore = score; best = i; }
    });
    const found = best >= 0 ? frame.catalog?.[best] : undefined;
    const alternatives: string[] = found?.alternatives ?? [];
    if (alternatives.length === 0) return m;
    return {
      ...m,
      candidates: alternatives.slice(0, MAX_CANDIDATES).map((sku: string) => ({
        sku, confidence: sku === found?.sku ? (found?.confidence ?? 0) : 0,
      })),
    };
  });

  let image: Buffer;
  try {
    image = readFileSync(imageFor(frame.order));
  } catch {
    console.log(`  t=${frame.t}s fired but frame-${frame.order + 1} was never written; skipped`);
    continue;
  }
  fired += 1;
  censusCalls += 1;

  let census: CensusResult;
  if (REPLAY) {
    const saved = REPLAY[censusCalls - 1];
    if (!saved) throw new Error(`replay file has no entry for census call ${censusCalls}`);
    if (saved.t !== frame.t || saved.order !== frame.order) {
      throw new Error(
        `replay entry ${censusCalls - 1} is for t=${saved.t}s frame ${saved.order}, but this run ` +
        `reached t=${frame.t}s frame ${frame.order}; the replay file does not match this frame set`,
      );
    }
    census = saved.census as CensusResult;
  } else {
    census = await runCensus(image, marks) as unknown as CensusResult;
  }
  const liveBoxes: Record<string, any> = {};
  for (const t of live) liveBoxes[t.id] = t.box;
  fusion = applyCensus(fusion, census, markToTrack, live.map((t) => t.id), false, liveBoxes);

  if (TRACE) {
    for (const m of census.marks) {
      console.log(`      trace: badge ${m.id} -> track ${markToTrack[m.id]}  ` +
        `name=${JSON.stringify(m.name)} brand=${JSON.stringify(m.brand)} sku=${JSON.stringify(m.catalogSku)}`);
    }
  }
  const named = census.marks.filter((m) => m.isProduct).map((m) => m.name);
  const unmarked = (census.unmarkedItems ?? []).map((u: any) => u.description);
  console.log(`  t=${String(frame.t).padStart(5)}s  ${marks.length} badges -> ` +
    `${named.length} products, ${unmarked.length} unmarked`);
  console.log(`      badged:   ${named.join(', ') || '(none)'}`);
  console.log(`      unmarked: ${unmarked.join(', ') || '(none)'}`);
  calls.push({ t: frame.t, order: frame.order, marks: marks.length, census });
}

/**
 * What is really in this trolley, and the words a bag line may use for each.
 *
 * A unit count cannot tell a right bag from a lucky one. Run 3 of the six captured answer sets
 * scores nine units against nine products and is still wrong: it holds the Fuji bag twice, once
 * as "Kart purple produce bag" and once as "red apple", and misses the yellow bag and the
 * brussels sprouts. Two errors cancelling is not a correct answer, so the bag is scored by
 * contents here as well as by size.
 *
 * `strong` is a word only this product would use. `weak` is one it shares with another product in
 * this same trolley, which is why both numbers are reported rather than one: "bread" fits the
 * baguette and the Seedtastic loaf, "apple" fits the Granny Smith bag and the Fuji bag, and a
 * scorer that resolves those by itself is inventing the answer it is meant to be checking.
 * Strong matches are assigned first for the same reason.
 */
const VIDEO_TRUTH: { id: string; strong: string[]; weak: string[] }[] = [
  { id: 'oreo', strong: ['oreo'], weak: [] },
  { id: 'cauliflower', strong: ['cauliflower', 'lucky'], weak: [] },
  { id: 'asparagus', strong: ['asparagus'], weak: [] },
  { id: 'brussels sprouts bag', strong: ['brussels', 'sprout'], weak: ['green leafy', 'lettuce', 'green produce'] },
  { id: 'seedtastic bread', strong: ['seedtastic'], weak: ['bread', 'loaf'] },
  { id: 'baguette', strong: ['baguette'], weak: ['bread'] },
  { id: 'granny smith apple bag', strong: ['granny'], weak: ['green apple', 'apple'] },
  // The purple bag is printed "WEST GROWN FUJI, Sure to please!" and holds red apples.
  { id: 'fuji apple bag', strong: ['fuji', 'purple'], weak: ['red apple', 'apple', 'produce bag'] },
  { id: 'yellow produce bag', strong: ['yellow'], weak: ['produce bag'] },
];

/** Greedy assignment, strong words first, each line used once and each product filled once. */
function scoreContents(names: string[]) {
  const used = new Set<number>();
  const found = new Map<string, { line: number; tier: 'strong' | 'weak' }>();
  for (const tier of ['strong', 'weak'] as const) {
    for (const product of VIDEO_TRUTH) {
      if (found.has(product.id)) continue;
      const words = product[tier];
      const at = names.findIndex((n, i) => !used.has(i) && words.some((w) => n.includes(w)));
      if (at >= 0) { used.add(at); found.set(product.id, { line: at, tier }); }
    }
  }
  const strict = [...found.values()].filter((v) => v.tier === 'strong').length;
  const spurious = names.map((_, i) => i).filter((i) => !used.has(i));
  return { found, strict, lenient: found.size, spurious };
}

const lines = bagLines(fusion) as any[];
const units = lines.reduce((n, l) => n + (l.qty ?? 1), 0);
console.log(`\n  catalog shortlist ${withCatalog ? 'attached, refreshed against the current index' : 'withheld'}`);
console.log(`  ${video.frames.length} frames, ${fired} census calls (cap is 8)`);
console.log(`  bag holds ${units} units on ${lines.length} lines, against ${cart.products} real products`);
for (const l of lines) {
  console.log(`      ${String(l.qty).padStart(2)}  ${l.brand ? `${l.brand} ` : ''}${l.name}`);
}

// Contents, not just size.
{
  const names = lines.map((l: any) => `${l.brand ? `${l.brand} ` : ''}${l.name}`.toLowerCase());
  const { found, strict, lenient, spurious } = scoreContents(names);
  console.log(`\n  products found ${strict} of ${VIDEO_TRUTH.length} on an unambiguous word, ` +
    `${lenient} of ${VIDEO_TRUTH.length} allowing words this trolley shares between two products`);
  const missing = VIDEO_TRUTH.filter((p) => !found.has(p.id)).map((p) => p.id);
  if (missing.length) console.log(`  missing: ${missing.join(', ')}`);
  if (spurious.length) console.log(`  lines matching nothing real: ${spurious.map((i) => names[i]).join(', ')}`);
}
for (const line of lines) console.log(`    ${line.qty ?? 1} x ${line.name}`);
const missing = PRODUCTS.filter((p) => !lines.some((l) => (l.name ?? '').toLowerCase().includes(p.split('_')[0])));
console.log(missing.length ? `  not obviously present: ${missing.join(', ')}` : '  nothing missing');
// A replay run answered from the file it would write here, so writing would be a no-op at best
// and, if the run was reached through different flags, would overwrite the saved answers with
// the same answers under a pairing they were not recorded against.
if (!REPLAY) {
  writeFileSync(join(HERE, 'kart-video-census-live.json'), JSON.stringify(calls, null, 1));
}
