/**
 * A scan session, simulated frame by frame over real footage.
 *
 * `states.ts` replays one still and asks what colour each item is. This runs the thing the app
 * actually does: frames arrive at the detector's rate, ByteTrack follows items across them, the
 * keyframe gate decides which frames are worth a census call, and identities accumulate in one
 * fusion state so that an item named once stays named while it remains tracked.
 *
 * Every constant that bounds a real session is honoured, because they are what make the result
 * a session rather than a batch job: `MAX_CENSUS_CALLS_PER_SESSION` caps how many census calls
 * a scan may make, and the keyframe gate decides when they happen, using the sharpness and
 * motion measured off the real frames rather than numbers invented by the harness.
 *
 * The one substitution is the same one `states.ts` makes: with no census key, the identity for a
 * region is the catalog matcher's own decision. It models a census that always agrees with the
 * first entry of the shortlist it is offered.
 *
 *   server/node_modules/.bin/tsx server/eval/pipeline/video-states.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createSessionState, worthACensus } from '../../../src/engine/liveVision/orchestrator';
import { applyCensus, bagLines, createFusionState, type CensusMark, type FusionState } from '../../../src/engine/liveVision/fusion';
import { hiddenFractions } from '../../../src/engine/liveVision/occlusion';
import { outlineStateFor, type OutlineState } from '../../../src/engine/liveVision/outlineState';
import { createPipelineState, processFrame } from '../../../src/engine/liveVision/pipeline';
import type { Box, DetectedInstance, FrameScan, Track } from '../../../src/engine/liveVision/types';

const HERE = join(import.meta.dirname, '..');
const IN = join(HERE, 'video-frames.json');
const OUT = join(HERE, 'video-states.json');

interface Frame {
  segment: string;
  t: number;
  order: number;
  width: number;
  height: number;
  sharpness: number;
  motion: number;
  boxes: Box[];
  scores: number[];
  catalog: ({ sku: string | null; confidence: number; alternatives: string[] } | null)[];
  hidden: number[];
}

function rectangle(box: Box): number[] {
  return [box.x, box.y, box.x + box.w, box.y, box.x + box.w, box.y + box.h, box.x, box.y + box.h];
}

/** Which detection each track is currently on, by largest overlap. */
function detectionFor(tracks: Track[], boxes: Box[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const track of tracks) {
    let best = -1;
    let bestOverlap = 0;
    boxes.forEach((box, i) => {
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
    if (best >= 0) out.set(track.id, best);
  }
  return out;
}

function runSession(frames: Frame[], label: string) {
  let pipeline = createPipelineState();
  let fusion: FusionState = createFusionState();
  const examined = new Set<string>();
  const seenTracks = new Set<string>();
  // Distinct ids alone is a misleading number and was the first thing this harness reported.
  // Every unmatched detection mints an id, so an unstable detector inflates it without the
  // tracker doing anything wrong: 90 frames of this footage produce 131 ids against a peak of
  // 15 concurrent items, and almost all of the difference is tracks that appear for one frame
  // and never reach `minHits`. What the product depends on is how long a track survives once it
  // is confirmed, because that is the window in which an identity can attach to it and stay.
  const everConfirmed = new Set<string>();
  const firstSeen = new Map<string, number>();
  const lastSeen = new Map<string, number>();
  let censusCalls = 0;
  const timeline: {
    t: number;
    tracks: number;
    confirmed: number;
    keyframe: string;
    census: boolean;
    bagUnits: number;
    states: Record<OutlineState, number>;
  }[] = [];

  for (const frame of frames) {
    const instances: DetectedInstance[] = frame.boxes.map((box, i) => ({
      box,
      polygon: rectangle(box),
      score: frame.scores[i],
    }));
    const scan: FrameScan = {
      instances,
      barcodes: [],
      sharpness: frame.sharpness,
      motion: frame.motion,
      width: frame.width,
      height: frame.height,
      error: null,
      keyframe: null,
      crops: [],
    };
    const stepped = processFrame(pipeline, scan, frame.t * 1000);
    pipeline = stepped.state;
    const live = stepped.tracks.filter((t) => t.state !== 'lost');
    live.forEach((track) => {
      seenTracks.add(track.id);
      if (!firstSeen.has(track.id)) firstSeen.set(track.id, frame.order);
      lastSeen.set(track.id, frame.order);
      if (track.state === 'confirmed') everConfirmed.add(track.id);
    });

    // A census call only happens on a keyframe, and only when the session judges the frame worth
    // one. That is what makes an identity worth anything here: it has to survive frames in which
    // nothing is re-examined. `worthACensus` is the shipped rule, not a copy of it.
    let ranCensus = false;
    const session = { ...createSessionState(), censusCalls, fusion };
    if (stepped.keyframe.fire && worthACensus(session, live)) {
      censusCalls += 1;
      ranCensus = true;
      const detection = detectionFor(live, frame.boxes);
      const marks: CensusMark[] = [];
      const markToTrack: Record<number, string> = {};
      live.forEach((track, n) => {
        const index = detection.get(track.id);
        if (index === undefined) return;
        const match = frame.catalog[index];
        if (!match) return;
        examined.add(track.id);
        if (!match.sku) return;
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
      live.forEach((t) => {
        liveBoxes[t.id] = t.box;
      });
      fusion = applyCensus(
        fusion,
        { marks, inViewCounts: [] },
        markToTrack,
        live.map((t) => t.id),
        false,
        liveBoxes,
      );
    }

    const hidden = hiddenFractions(live.map((t) => t.box));
    const tally: Record<OutlineState, number> = { counted: 0, covered: 0, closer: 0, forming: 0 };
    live.forEach((track, i) => {
      tally[outlineStateFor(track, fusion.identities[track.id], hidden[i], examined.has(track.id))] += 1;
    });

    timeline.push({
      t: frame.t,
      tracks: live.length,
      confirmed: live.filter((t) => t.state === 'confirmed').length,
      keyframe: stepped.keyframe.reason,
      census: ranCensus,
      bagUnits: bagLines(fusion).reduce((s, l) => s + l.qty, 0),
      states: tally,
    });
  }

  const bag = bagLines(fusion);
  const lifetimes = [...everConfirmed]
    .map((id) => (lastSeen.get(id) ?? 0) - (firstSeen.get(id) ?? 0) + 1)
    .sort((a, b) => a - b);
  const median = lifetimes.length ? lifetimes[Math.floor(lifetimes.length / 2)] : 0;
  return {
    segment: label,
    frames: frames.length,
    distinctTracks: seenTracks.size,
    confirmedTracks: everConfirmed.size,
    medianConfirmedLifetimeFrames: median,
    longestConfirmedLifetimeFrames: lifetimes.length ? lifetimes[lifetimes.length - 1] : 0,
    peakConcurrent: Math.max(...timeline.map((t) => t.tracks), 0),
    censusCalls,
    keyframeReasons: timeline.reduce<Record<string, number>>((acc, t) => {
      acc[t.keyframe] = (acc[t.keyframe] ?? 0) + 1;
      return acc;
    }, {}),
    finalBagUnits: bag.reduce((s, l) => s + l.qty, 0),
    finalBagLines: bag.length,
    timeline,
  };
}

const payload = JSON.parse(readFileSync(IN, 'utf8')) as { frames: Frame[]; video: string };
const bySegment = new Map<string, Frame[]>();
for (const frame of payload.frames) {
  if (!bySegment.has(frame.segment)) bySegment.set(frame.segment, []);
  bySegment.get(frame.segment)!.push(frame);
}

const sessions = [...bySegment.entries()].map(([label, frames]) =>
  runSession(frames.sort((a, b) => a.t - b.t), label),
);

console.log(`${payload.video}\n`);
console.log('  segment  frames   ids  confirmed  median life  longest  peak  census  bag units');
for (const s of sessions) {
  console.log(
    `  ${s.segment.padEnd(8)} ${String(s.frames).padStart(6)} ${String(s.distinctTracks).padStart(5)}` +
      ` ${String(s.confirmedTracks).padStart(10)} ${String(s.medianConfirmedLifetimeFrames).padStart(12)}` +
      ` ${String(s.longestConfirmedLifetimeFrames).padStart(8)} ${String(s.peakConcurrent).padStart(5)}` +
      ` ${String(s.censusCalls).padStart(7)} ${String(s.finalBagUnits).padStart(10)}`,
  );
}
console.log('\n  ids counts every track ever created, including one-frame tracks a single stray');
console.log('  detection mints. confirmed counts those that reached minHits and could carry an');
console.log('  identity; median life is how many frames one of those survived, at 3 frames a second.');

const reasons: Record<string, number> = {};
for (const s of sessions) for (const [k, v] of Object.entries(s.keyframeReasons)) reasons[k] = (reasons[k] ?? 0) + v;
console.log('\n  keyframe gate over every frame');
for (const [reason, n] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${reason.padEnd(14)} ${String(n).padStart(4)}`);
}

const last = sessions.flatMap((s) => s.timeline.slice(-1));
const tally: Record<string, number> = { counted: 0, covered: 0, closer: 0, forming: 0 };
for (const frame of last) for (const [state, n] of Object.entries(frame.states)) tally[state] += n;
const total = Object.values(tally).reduce((a, b) => a + b, 0);
console.log('\n  outline states on the last frame of each segment');
for (const [state, n] of Object.entries(tally)) {
  console.log(`    ${state.padEnd(9)} ${String(n).padStart(4)}   ${total ? ((n / total) * 100).toFixed(1) : '0.0'}%`);
}

writeFileSync(OUT, JSON.stringify({ video: payload.video, sessions }, null, 1));
console.log(`\nwrote ${OUT}`);
