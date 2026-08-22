/**
 * The scan screen's frame loop, run in Node against the real corpus.
 *
 * `video-census-live.ts` measures the census and the bag but not the loop that feeds them: it
 * badges every census from the whole region set, which is what the server's enumerator produces.
 * The app does not do that. `scan.tsx` runs `processFrame` on every frame over instances from
 * `AppleInstanceMaskDetector`, measured at mean 1.1 per frame on these images, and calls
 * `session.onKeyframe(keyframe, tracks, now)` with the marks those tracks give.
 *
 * The camera and the rendering need a device. The loop's logic does not: `processFrame`, the
 * tracker and `RecognitionSession` are all plain TypeScript. This runs the real ones.
 *
 *   --path=shipped   per frame, processFrame over one region, then onKeyframe with its marks.
 *                    What the app does today.
 *   --path=capture   the same per-frame tracking, but each keyframe goes through onCapture,
 *                    which sends no marks so the service enumerates. What
 *                    `docs/detector-decision.md` decided on and nothing calls.
 *
 * The census itself is the shipped `runCensus`. What is stubbed is only the transport, and the
 * enumerator, which is replaced by this video's cached region column: the same regions
 * `enumerateRegions` would return, from `refresh_video_catalog.py` against the same index.
 *
 *     node --env-file=server/.env.local server/node_modules/.bin/tsx \
 *       server/eval/pipeline/scan-loop.ts --path=capture
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bagLines } from '../../../src/engine/liveVision/fusion';
import { RecognitionSession } from '../../../src/engine/liveVision/orchestrator';
import type { SessionDeps } from '../../../src/engine/liveVision/orchestrator';
import { createPipelineState, processFrame } from '../../../src/engine/liveVision/pipeline';
import { MAX_CANDIDATES } from '../../src/enumerate';
import { runCensus } from '../../src/recognize';
import type { Mark } from '../../src/compositor';
import { VIDEO_TRUTH, scoreContents } from './video-truth';

const HERE = join(import.meta.dirname, '..');
const pathArg = process.argv.find((a) => a.startsWith('--path='));
const PATHNAME = pathArg ? pathArg.split('=')[1] : 'shipped';
if (PATHNAME !== 'shipped' && PATHNAME !== 'capture') {
  throw new Error(`--path must be "shipped" or "capture", got ${PATHNAME}`);
}
/** Regions the device detector supplies per frame. Measured at mean 1.1 with bench:detector. */
const deviceArg = process.argv.find((a) => a.startsWith('--device-regions='));
const DEVICE_REGIONS = deviceArg ? Math.max(1, Number(deviceArg.split('=')[1])) : 1;

/** `--frames=<name>` reads a different region set from `server/eval/`, so a detection change can
 * be put through the same loop without a second copy of this file. */
const framesArg = process.argv.find((a) => a.startsWith('--frames='));
/**
 * `--interval=<ms>` overrides the keyframe gate's `minIntervalMs`, which ships at 2000.
 *
 * Nine seconds of scanning at that pacing fires four censuses against a session budget of eight
 * (`MAX_CENSUS_CALLS_PER_SESSION`), so half the budget is never spent. Products found rose with
 * every extra call up to four, which makes "spend the rest" the obvious question.
 */
const intervalArg = process.argv.find((a) => a.startsWith('--interval='));
const MIN_INTERVAL_MS = intervalArg ? Number(intervalArg.split('=')[1]) : undefined;

const video = JSON.parse(readFileSync(
  join(HERE, framesArg ? framesArg.split('=')[1] : 'video-frames-catalog.json'), 'utf8'));
const truth = JSON.parse(readFileSync(join(HERE, 'corpus/kart/counts.json'), 'utf8'));
const cart = truth.counted.find((c: any) => c.id === 'IMG_0252');

const imageFor = (order: number) =>
  join(HERE, `.cache/kart/video/frame-${String(order + 1).padStart(3, '0')}.jpg`);

/** The frame's full region set, shaped the way `marksFromRegions` shapes it for the service. */
function serverMarks(frame: any): Mark[] {
  return frame.boxes.map((box: any, i: number) => {
    const mark: Mark = { id: i + 1, box };
    const found = frame.catalog?.[i];
    const alternatives: string[] = found?.alternatives ?? [];
    if (alternatives.length > 0) {
      mark.candidates = alternatives.slice(0, MAX_CANDIDATES).map((sku: string) => ({
        sku, confidence: sku === found?.sku ? (found?.confidence ?? 0) : 0,
      }));
    }
    return mark;
  });
}

let currentFrame: any = null;
let calls = 0;

const deps: SessionDeps = {
  // The transport only. `runCensus` is the shipped one; when the request carries no marks this
  // stands in for `enumerateRegions` with the frame's cached region column, which is what the
  // service would have returned for it.
  requestCensus: async (req) => {
    calls += 1;
    const image = readFileSync(imageFor(currentFrame.order));
    const enumerated = req.marks === undefined || req.marks.length === 0;
    const marks: Mark[] = enumerated
      ? serverMarks(currentFrame)
      : req.marks!.map((m) => ({ id: m.id, box: m.box }));
    if (marks.length === 0) return { ok: false, failure: 'server' } as any;
    const census: any = await runCensus(image, marks);
    return {
      ok: true,
      value: {
        ...census,
        regions: marks.map((m) => ({
          id: m.id,
          box: m.box,
          polygon: [m.box.x, m.box.y, m.box.x + m.box.w, m.box.y,
                    m.box.x + m.box.w, m.box.y + m.box.h, m.box.x, m.box.y + m.box.h],
          score: 0.6,
        })),
        enumeration: enumerated ? 'ok' : 'client',
      },
    } as any;
  },
  requestIdentify: async () => ({ ok: false, failure: 'server' }) as any,
  lookupBarcode: async () => null,
  saveThumbnail: async () => null,
};

const session = new RecognitionSession(deps);
let pipeline = createPipelineState();

for (const frame of video.frames) {
  currentFrame = frame;
  // The device's supply, not the server's: the highest-scoring regions only.
  const order = frame.boxes
    .map((_: unknown, i: number) => i)
    .sort((a: number, b: number) => frame.scores[b] - frame.scores[a])
    .slice(0, DEVICE_REGIONS);
  const scan = {
    instances: order.map((i: number) => ({
      box: frame.boxes[i],
      polygon: [frame.boxes[i].x, frame.boxes[i].y, frame.boxes[i].x + frame.boxes[i].w,
                frame.boxes[i].y, frame.boxes[i].x + frame.boxes[i].w,
                frame.boxes[i].y + frame.boxes[i].h, frame.boxes[i].x, frame.boxes[i].y + frame.boxes[i].h],
      score: frame.scores[i],
    })),
    barcodes: [], sharpness: frame.sharpness, motion: frame.motion, crops: [],
  };
  const stepped = processFrame(pipeline, scan as any, frame.t * 1000,
    MIN_INTERVAL_MS === undefined ? {} : { minIntervalMs: MIN_INTERVAL_MS });
  pipeline = stepped.state;

  if (!stepped.keyframe.fire) continue;
  if (!session.wantsKeyframe(stepped.tracks, stepped.keyframe.fire)) continue;
  let image: string;
  try { image = readFileSync(imageFor(frame.order)).toString('base64'); } catch { continue; }

  // Which frames the loop actually captures, and how many tracks it had going in. Worth printing
  // rather than inferring: the capture path paces differently from the old one (frames 7, 13, 19,
  // 25 against 4, 10, 16, 22), and that is how the yellow produce bag's absence was ruled out as a
  // pacing problem. Frame 13 is inside the window where that bag is plainly visible, the census
  // sees it there, and "yellow" still appears nowhere in any answer. The track counts also show
  // `onCapture` seeding: one live track going into the first capture, eight into the second.
  console.log(`  capture at t=${frame.t}s, frame-${String(frame.order + 1).padStart(3, '0')}, ` +
    `${stepped.tracks.length} live track(s) going in`);
  if (PATHNAME === 'shipped') {
    await session.onKeyframe(image, stepped.tracks, frame.t * 1000);
  } else {
    const result = await session.onCapture(image, pipeline.tracker, frame.t * 1000);
    // What `scan.tsx` would have to do: take the tracker the capture advanced, so the next
    // frame tracks against the server's regions rather than against the device's blob.
    if (result) pipeline = { ...pipeline, tracker: result.tracker };
  }
}

const lines = bagLines(session.state.fusion) as any[];
const units = lines.reduce((n, l) => n + (l.qty ?? 1), 0);
console.log(`\n  path=${PATHNAME}, ${DEVICE_REGIONS} device region(s) per frame, ${calls} census call(s)`);
console.log(`  bag holds ${units} units on ${lines.length} lines, against ${cart.products} real products`);
for (const l of lines) console.log(`      ${String(l.qty).padStart(2)}  ${l.brand ? `${l.brand} ` : ''}${l.name}`);

// Contents, scored against the same truth `video-census-live.ts` uses.
{
  const names = lines.map((l: any) => `${l.brand ? `${l.brand} ` : ''}${l.name}`.toLowerCase());
  const { found, strict, lenient, spurious } = scoreContents(names);
  console.log(`  products found ${strict} of ${VIDEO_TRUTH.length} on an unambiguous word, ` +
    `${lenient} of ${VIDEO_TRUTH.length} allowing words this trolley shares between two products`);
  const missing = VIDEO_TRUTH.filter((p) => !found.has(p.id)).map((p) => p.id);
  if (missing.length) console.log(`  missing: ${missing.join(', ')}`);
  if (spurious.length) console.log(`  lines matching nothing real: ${spurious.map((i) => names[i]).join(', ')}`);
}
