/**
 * The outline a shopper would actually see, computed by the code that computes it on the phone.
 *
 * `score_carts.py` gets as far as regions, catalog matches and a coverage score. Everything
 * after that lives in TypeScript: ByteTrack decides whether a detection is a real item yet,
 * `applyCensus` folds several proposals on one physical item into one unit of quantity, and
 * `outlineStateFor` picks the colour. Re-implementing any of it in the harness would measure a
 * copy, so this reads the frames file and runs the real modules.
 *
 * Each still is replayed as a short run of frames rather than fed once, because a phone pointed
 * at a cart sees it many times a second and ByteTrack will not confirm a track it has seen once.
 * A still replayed N times is a stationary camera on a stationary cart, which is the easiest
 * version of the real input and therefore the right one for a floor.
 *
 * One substitution is made and it matters: with no census key, the identity attached to a region
 * is the catalog matcher's own decision rather than a model's. The census would normally choose
 * among the matcher's candidates, so this models a census that always agrees with the shortlist's
 * first entry. It is the most favourable assumption available, and every state below inherits it.
 *
 *   server/node_modules/.bin/tsx server/eval/pipeline/states.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createPipelineState, processFrame } from '../../../src/engine/liveVision/pipeline';
import { applyCensus, bagLines, createFusionState, type CensusMark } from '../../../src/engine/liveVision/fusion';
import { hiddenFractions } from '../../../src/engine/liveVision/occlusion';
import { outlineStateFor, type OutlineState } from '../../../src/engine/liveVision/outlineState';
import type { Box, DetectedInstance, FrameScan } from '../../../src/engine/liveVision/types';

const HERE = join(import.meta.dirname, '..');
const FRAMES = join(HERE, 'carts-frames.json');
const OUT = join(HERE, 'carts-states.json');

/** Frames of a still replayed. Above ByteTrack's minHits, with room for its confirmation lag. */
const REPLAY = 6;
const FRAME_MS = 333;

interface Frame {
  id: string;
  file: string;
  tier: string;
  width: number;
  height: number;
  boxes: Box[];
  scores: number[];
  catalog: ({ sku: string | null; confidence: number; alternatives: string[] } | null)[];
  hidden: number[];
}

/** A box as a rectangle polygon. The detector returns masks in the app; this file has boxes. */
function rectangle(box: Box): number[] {
  return [box.x, box.y, box.x + box.w, box.y, box.x + box.w, box.y + box.h, box.x, box.y + box.h];
}

function run(frame: Frame) {
  const instances: DetectedInstance[] = frame.boxes.map((box, i) => ({
    box,
    polygon: rectangle(box),
    score: frame.scores[i],
  }));

  let pipeline = createPipelineState();
  let tracks = [] as ReturnType<typeof processFrame>['tracks'];
  for (let tick = 0; tick < REPLAY; tick++) {
    const scan: FrameScan = {
      instances,
      barcodes: [],
      sharpness: 100,
      motion: 0,
      width: frame.width,
      height: frame.height,
      error: null,
      wantedKeyframe: false,
    keyframe: null,
      crops: [],
    };
    const stepped = processFrame(pipeline, scan, tick * FRAME_MS);
    pipeline = stepped.state;
    tracks = stepped.tracks;
  }

  // Tracks come back in the tracker's own order, so the detection each one came from is found
  // by position in the last update rather than assumed. A track that failed to confirm simply
  // has no mark, which is the same thing that happens on the phone.
  const live = tracks.filter((t) => t.state !== 'lost');
  const boxIndexFor = new Map<string, number>();
  live.forEach((track) => {
    let best = -1;
    let bestOverlap = 0;
    frame.boxes.forEach((box, i) => {
      const x = Math.max(track.box.x, box.x);
      const y = Math.max(track.box.y, box.y);
      const w = Math.min(track.box.x + track.box.w, box.x + box.w) - x;
      const h = Math.min(track.box.y + track.box.h, box.y + box.h) - y;
      const overlap = w > 0 && h > 0 ? w * h : 0;
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        best = i;
      }
    });
    if (best >= 0) boxIndexFor.set(track.id, best);
  });

  // Which tracks recognition actually ran over. A region the enumerator returned a `catalog`
  // field for has been examined, whether or not the matcher was confident enough to name it, and
  // that is the difference between an amber outline and a blank one.
  const examined = new Set<string>();
  live.forEach((track) => {
    const index = boxIndexFor.get(track.id);
    if (index !== undefined && frame.catalog[index]) examined.add(track.id);
  });

  const marks: CensusMark[] = [];
  const markToTrack: Record<number, string> = {};
  live.forEach((track, n) => {
    const index = boxIndexFor.get(track.id);
    const match = index === undefined ? null : frame.catalog[index];
    if (!match || !match.sku) return;
    const id = n + 1;
    marks.push({
      id,
      name: match.sku,
      brand: null,
      size: null,
      category: 'Grocery',
      confidence: match.confidence,
      needsCloserLook: false,
      isProduct: true,
    });
    markToTrack[id] = track.id;
  });

  const liveBoxes: Record<string, Box> = {};
  live.forEach((track) => {
    liveBoxes[track.id] = track.box;
  });
  const fusion = applyCensus(
    createFusionState(),
    { marks, inViewCounts: [] },
    markToTrack,
    live.map((t) => t.id),
    false,
    liveBoxes,
  );

  const hidden = hiddenFractions(live.map((t) => t.box));
  const states: OutlineState[] = live.map((track, i) =>
    outlineStateFor(track, fusion.identities[track.id], hidden[i], examined.has(track.id)),
  );

  return {
    id: frame.id,
    file: frame.file,
    tier: frame.tier,
    proposals: frame.boxes.length,
    tracks: live.length,
    confirmed: live.filter((t) => t.state === 'confirmed').length,
    states,
    hidden,
    examined: live.filter((t) => examined.has(t.id)).length,
    trackBoxes: live.map((t) => t.box),
    bag: bagLines(fusion),
    bagUnits: bagLines(fusion).reduce((sum, line) => sum + line.qty, 0),
  };
}

const payload = JSON.parse(readFileSync(FRAMES, 'utf8')) as { frames: Frame[] };
const results = payload.frames.map(run);

const tally: Record<string, number> = { counted: 0, covered: 0, closer: 0, forming: 0 };
for (const result of results) for (const state of result.states) tally[state] += 1;
const total = Object.values(tally).reduce((a, b) => a + b, 0);

console.log(`${results.length} photographs, ${total} tracked items\n`);
console.log('  outline state distribution');
for (const [state, n] of Object.entries(tally)) {
  console.log(`    ${state.padEnd(9)} ${String(n).padStart(4)}   ${((n / total) * 100).toFixed(1)}%`);
}
const proposals = results.reduce((s, r) => s + r.proposals, 0);
const units = results.reduce((s, r) => s + r.bagUnits, 0);
console.log(`\n  regions proposed        ${proposals}`);
console.log(`  tracks confirmed        ${results.reduce((s, r) => s + r.confirmed, 0)}`);
console.log(`  units reaching the bag  ${units}`);

writeFileSync(OUT, JSON.stringify({ replay: REPLAY, tally, results }, null, 1));
console.log(`\nwrote ${OUT}`);
