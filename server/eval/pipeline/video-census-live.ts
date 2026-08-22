/**
 * The bag a scan session builds, with the real census answering.
 *
 * `video-census-oracle.ts` measures the same nine seconds with perfect answers, and `--local`
 * measures it with a 2B model. This is the shipped path end to end: the tracker carries
 * identity, `evaluateKeyframe` decides which frames are worth a call, `worthACensus` paces them
 * against `MAX_CENSUS_CALLS_PER_SESSION`, `runCensus` asks the model, and `applyCensus` folds
 * the answer into one bag.
 *
 * The trolley in the video is the one in IMG_0252, so its hand count is the truth: ten products.
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

let pipeline = createPipelineState();
let fusion: FusionState = createFusionState();
let censusCalls = 0;
let fired = 0;
const calls: any[] = [];

for (const frame of video.frames) {
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

  const census = await runCensus(image, marks) as unknown as CensusResult;
  const liveBoxes: Record<string, any> = {};
  for (const t of live) liveBoxes[t.id] = t.box;
  fusion = applyCensus(fusion, census, markToTrack, live.map((t) => t.id), false, liveBoxes);

  const named = census.marks.filter((m) => m.isProduct).map((m) => m.name);
  const unmarked = (census.unmarkedItems ?? []).map((u: any) => u.description);
  console.log(`  t=${String(frame.t).padStart(5)}s  ${marks.length} badges -> ` +
    `${named.length} products, ${unmarked.length} unmarked`);
  console.log(`      badged:   ${named.join(', ') || '(none)'}`);
  console.log(`      unmarked: ${unmarked.join(', ') || '(none)'}`);
  calls.push({ t: frame.t, order: frame.order, marks: marks.length, census });
}

const lines = bagLines(fusion) as any[];
const units = lines.reduce((n, l) => n + (l.qty ?? 1), 0);
console.log(`\n  catalog shortlist ${withCatalog ? 'attached, refreshed against the current index' : 'withheld'}`);
console.log(`  ${video.frames.length} frames, ${fired} census calls (cap is 8)`);
console.log(`  bag holds ${units} units on ${lines.length} lines, against ${cart.products} real products`);
for (const line of lines) console.log(`    ${line.qty ?? 1} x ${line.name}`);
const missing = PRODUCTS.filter((p) => !lines.some((l) => (l.name ?? '').toLowerCase().includes(p.split('_')[0])));
console.log(missing.length ? `  not obviously present: ${missing.join(', ')}` : '  nothing missing');
writeFileSync(join(HERE, 'kart-video-census-live.json'), JSON.stringify(calls, null, 1));
