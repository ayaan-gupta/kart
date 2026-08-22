/**
 * The bag a scan session builds, given a census that answers correctly.
 *
 * `census-oracle.ts` does this for the six still photographs. A scan is not six stills: the
 * tracker carries identity across frames, the keyframe gate decides which frames are worth a
 * census call at all, and `MAX_CENSUS_CALLS_PER_SESSION` caps how many there can be. Whether the
 * bag fills up under those constraints is a different question from whether it fills up given
 * one perfect answer per photograph, and it is the question the product actually asks.
 *
 * The trolley in the video is the one in IMG_0252, so its hand count is the truth here: ten
 * products, of which detection finds nine somewhere across the 27 frames and never isolates the
 * tomatoes.
 *
 * Everything is shipped code except the census answers: processFrame tracks, evaluateKeyframe
 * gates, worthACensus paces, applyCensus folds, bagLines reads.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyCensus, bagLines, createFusionState } from '../../../src/engine/liveVision/fusion';
import type { CensusMark, CensusResult, FusionState } from '../../../src/engine/liveVision/fusion';
import { createPipelineState, processFrame } from '../../../src/engine/liveVision/pipeline';
import { worthACensus } from '../../../src/engine/liveVision/orchestrator';
import { createSessionState } from '../../../src/engine/liveVision/orchestrator';

const HERE = join(import.meta.dirname, '..');
const video = JSON.parse(readFileSync(join(HERE, 'video-frames.json'), 'utf8'));
const truth = JSON.parse(readFileSync(join(HERE, 'corpus/kart/counts.json'), 'utf8'));
const cart = truth.counted.find((c: any) => c.id === 'IMG_0252');

/**
 * `--local` swaps the oracle's answers for a real model's, from
 * `.cache/kart/video-census-local.json`, asked the same three questions on the frames the
 * keyframe gate actually fires on. The stills have been measured that way; the video had only
 * ever been measured with detection alone or with an oracle.
 */
const useLocal = process.argv.includes('--local');
const localAnswers = useLocal
  ? JSON.parse(readFileSync(join(HERE, '.cache/kart/video-census-local.json'), 'utf8'))
  : null;
let firedIndex = -1;

/**
 * What a correct census returns for a frame of this trolley. It cannot be per-badge here, the
 * way the stills oracle is, because the boxes move: what a census sees is the trolley, and every
 * product in it is either marked or unmarked depending on where the boxes happened to land. So
 * the model's whole-frame answer is the item list, and the marks it can attach are whichever
 * regions exist in that frame.
 */
const PRODUCTS: string[] = cart.items;

const mark = (id: number, name: string): CensusMark => ({
  id, name, brand: null, size: null, category: 'other',
  confidence: 0.9, needsCloserLook: false, isProduct: true,
});

let pipeline = createPipelineState();
let fusion: FusionState = createFusionState();
let censusCalls = 0;
let fired = 0;

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
  fired += 1;
  censusCalls += 1;

  // A census on this frame: every visible region gets the right name, and every product the
  // regions missed arrives unmarked. Which products are marked depends on how many regions this
  // frame has, so a frame with three boxes marks three and leaves seven unmarked.
  const detection = live.slice(0, frame.boxes.length);
  const markToTrack: Record<number, string> = {};
  const liveBoxes: Record<string, any> = {};
  const marks: CensusMark[] = [];
  detection.forEach((track, i) => {
    markToTrack[i] = track.id;
    liveBoxes[track.id] = track.box;
    marks.push(mark(i, PRODUCTS[i % PRODUCTS.length]));
  });
  firedIndex += 1;
  let census: CensusResult;
  if (localAnswers) {
    const key = Object.keys(localAnswers)[firedIndex];
    const answer = key === undefined ? { marks: [], listed: [] } : localAnswers[key];
    const localMarks: CensusMark[] = answer.marks
      .filter((m: any) => m.id < detection.length)
      .map((m: any) => ({
        ...mark(m.id, m.name), isProduct: m.isProduct,
        // What the shortlist in the request would have supplied. The same SKU whichever way the
        // model phrased the name, which is the whole point of the field.
        catalogSku: m.catalogSku ?? null,
      }));
    // An unmarked sighting keys the same way a mark does when the catalog knows it, so a product
    // named on one keyframe and listed on the next is one product rather than two.
    const listedSku: Record<string, string | null> = answer.listedSku ?? {};
    const keyOf = (name: string) => (listedSku[name] ? `sku:${listedSku[name]}` : `::${name}`);
    const kept = new Set(localMarks.filter((m) => m.isProduct)
      .map((m) => (m.catalogSku ? `sku:${m.catalogSku}` : `::${m.name}`)));
    const unmarked = (answer.listed as string[])
      .filter((p) => !kept.has(keyOf(p)))
      .map((description) => ({ description, productKey: listedSku[description] ? `sku:${listedSku[description]}` : undefined, confidence: 0.8 }));
    const tally = new Map<string, number>();
    for (const m of localMarks) {
      if (!m.isProduct) continue;
      const k = m.catalogSku ? `sku:${m.catalogSku}` : `::${m.name}`;
      tally.set(k, (tally.get(k) ?? 0) + 1);
    }
    for (const u of unmarked) tally.set(keyOf(u.description), (tally.get(keyOf(u.description)) ?? 0) + 1);
    census = {
      marks: localMarks,
      unmarkedItems: unmarked,
      inViewCounts: [...tally].map(([productKey, count]) => ({ productKey, count })),
    };
  } else {
    const markedNames = new Set(marks.map((m) => m.name));
    census = {
      marks,
      unmarkedItems: PRODUCTS.filter((p) => !markedNames.has(p))
        .map((description) => ({ description, confidence: 0.9 })),
      inViewCounts: PRODUCTS.map((p) => ({ productKey: `::${p}`, count: 1 })),
    };
  }
  fusion = applyCensus(fusion, census, markToTrack, live.map((t) => t.id), false, liveBoxes);
}

const lines = bagLines(fusion);
const units = lines.reduce((n, l) => n + (l.qty ?? 1), 0);
console.log(`  ${video.frames.length} frames, ${fired} census calls (cap is 8)`);
console.log(`  bag holds ${units} units on ${lines.length} lines, against ${cart.products} real products`);
const missing = PRODUCTS.filter((p) => !lines.some((l) => l.name === p));
console.log(missing.length ? `  missing: ${missing.join(', ')}` : '  nothing missing');
