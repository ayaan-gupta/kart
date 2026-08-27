/**
 * Every confirmed track in the video, with the box it occupied in each frame it survived.
 *
 * This exists to build a catalog. The closed-world assumption in CLAUDE.md is that the store's
 * full product list is known, and the honest way to test naming on this corpus is to build the
 * references from one capture and query from another. The video and the stills are exactly that:
 * different sessions, different angles, different lighting, the same trolley.
 *
 * Identity linkage comes from the shipped tracker rather than from a rule written here. A track
 * is what the product itself considers one item across frames, so the references a track yields
 * are the references the product could actually have collected. Labelling then costs one
 * judgement per track instead of one per box: 137 regions across 27 frames reduce to a handful
 * of items.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createPipelineState, processFrame } from '../../../src/engine/liveVision/pipeline';
import type { Box, FrameScan } from '../../../src/engine/liveVision/types';

const HERE = join(import.meta.dirname, '..');
const IN = join(HERE, 'video-frames.json');

/**
 * Tracker thresholds, overridable so they can be swept. `maxLostMs` and `recoverMinIou` govern
 * whether a track that missed a few frames may re-acquire, and on real handheld footage that is
 * the setting that decides between two opposite failures: too generous and a coasting track
 * re-binds to a different item, too strict and a buried item that resurfaces is counted twice.
 * Both are measurable here, so neither has to be guessed.
 */
const TRACKER_OVERRIDES: { maxLostMs?: number; recoverMinIou?: number } = {};
let OUT = join(HERE, 'video-tracks.json');
for (let i = 2; i < process.argv.length; i += 1) {
  const next = process.argv[i + 1];
  if (process.argv[i] === '--max-lost-ms') TRACKER_OVERRIDES.maxLostMs = Number(next);
  if (process.argv[i] === '--recover-min-iou') TRACKER_OVERRIDES.recoverMinIou = Number(next);
  if (process.argv[i] === '--out') OUT = next;
}

interface Frame {
  t: number;
  order: number;
  width: number;
  height: number;
  sharpness: number;
  motion: number;
  boxes: Box[];
  scores: number[];
}

function rectangle(box: Box): number[] {
  return [box.x, box.y, box.x + box.w, box.y, box.x + box.w, box.y + box.h, box.x, box.y + box.h];
}

const payload = JSON.parse(readFileSync(IN, 'utf8')) as { frames: Frame[]; video: string };
const frames = [...payload.frames].sort((a, b) => a.order - b.order);

let pipeline = createPipelineState();
const seen = new Map<string, { frame: number; t: number; box: Box }[]>();
const everConfirmed = new Set<string>();

for (const frame of frames) {
  const scan: FrameScan = {
    instances: frame.boxes.map((box, i) => ({
      box,
      polygon: rectangle(box),
      score: frame.scores[i],
    })),
    barcodes: [],
    sharpness: frame.sharpness,
    motion: frame.motion,
    crops: [],
    width: frame.width,
    height: frame.height,
    error: null,
    wantedKeyframe: false,
    keyframe: null,
  };
  const stepped = processFrame(pipeline, scan, frame.t * 1000, {}, TRACKER_OVERRIDES);
  pipeline = stepped.state;
  for (const track of stepped.tracks) {
    if (track.state === 'lost') continue;
    if (track.state === 'confirmed') everConfirmed.add(track.id);
    const list = seen.get(track.id) ?? [];
    list.push({ frame: frame.order, t: track.box ? frame.t : frame.t, box: track.box });
    seen.set(track.id, list);
  }
}

// Only tracks the product would have trusted enough to carry an identity. An unconfirmed track
// is a stray detection, and a stray detection makes a bad catalog reference.
const tracks = [...seen.entries()]
  .filter(([id]) => everConfirmed.has(id))
  .map(([id, appearances]) => ({ id, appearances }))
  .sort((a, b) => b.appearances.length - a.appearances.length);

writeFileSync(OUT, JSON.stringify({ video: payload.video, tracks }, null, 1));
console.log(`  ${tracks.length} confirmed tracks over ${frames.length} frames`);
for (const track of tracks) {
  console.log(`    ${track.id}  ${track.appearances.length} frames`);
}
console.log(`\nwrote ${OUT}`);
