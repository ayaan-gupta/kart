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
import sharp from 'sharp';
import { join } from 'node:path';
import { bagLines } from '../../../src/engine/liveVision/fusion';
import { RecognitionSession } from '../../../src/engine/liveVision/orchestrator';
import type { SessionDeps } from '../../../src/engine/liveVision/orchestrator';
import { createPipelineState, processFrame } from '../../../src/engine/liveVision/pipeline';
import { MAX_CANDIDATES } from '../../src/enumerate';
import { runCensus, runIdentify } from '../../src/recognize';
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
/** `--max-motion=<v>` overrides the keyframe gate's motion ceiling, which ships at 0.15. */
/**
 * `--loops=N` runs the frame sequence N times, offset in time, as one continuous session.
 *
 * Nine seconds fires 4 censuses against a budget of 8, because `minIntervalMs` spaces them two
 * seconds apart, so this corpus can never spend a whole session. A shopper scanning a trolley for
 * longer pans over it more than once, and replaying the sequence is a fair stand-in for that: the
 * same views in the same order, arriving later. It is the one way to ask what the other half of
 * the budget buys with captures *spread* across a pan rather than crowded together, which
 * `--interval` could only do by crowding them.
 *
 * The tracker is not reset between loops, exactly as it would not be mid-session.
 */
/**
 * `--sweep-once` keeps `unmarkedItems` from the first census of a session and drops it from the
 * rest, testing what the fusion rule predicts.
 *
 * Fusion absorbs a missed product and amplifies an extra description (see KART.md). `unmarkedItems`
 * is where the unjoinable descriptions come from: the trolley is static, so every later call
 * re-describes goods the first one already named, in fresh words that will not join. Letting the
 * first call sweep and the rest only correct their badges is the "less" this rule points at.
 */
const SWEEP_ONCE = process.argv.includes('--sweep-once');

/**
 * `--corroborate-unmarked` admits an unmarked description only once a second census repeats it.
 *
 * The same rule `applyCensus` already applies to a barcode and to an identify-verified identity:
 * one misread must leave no permanent trace. A paraphrase is a one-off by nature, the trolley
 * being described in fresh words each call, while a product really in the cart is still there on
 * the next look. Unlike `--sweep-once` this does not stop later calls sweeping, so an item added
 * mid-scan is still found, one census later than it would have been.
 */
const CORROBORATE = process.argv.includes('--corroborate-unmarked');
/**
 * The app sends the names it has already counted on every census (see `SessionDeps.requestCensus`),
 * so the harness does too. `--no-reuse-names` turns it off for comparison.
 */
const REUSE_NAMES = !process.argv.includes('--no-reuse-names');
const seenUnmarked = new Set<string>();
const foldName = (t: string) => t.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
  .filter(Boolean).map((w) => (w.length > 2 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
  .join(' ');

const loopsArg = process.argv.find((a) => a.startsWith('--loops='));
const LOOPS = loopsArg ? Math.max(1, Number(loopsArg.split('=')[1])) : 1;

const motionArg = process.argv.find((a) => a.startsWith('--max-motion='));
const MAX_MOTION = motionArg ? Number(motionArg.split('=')[1]) : undefined;

const intervalArg = process.argv.find((a) => a.startsWith('--interval='));
const MIN_INTERVAL_MS = intervalArg ? Number(intervalArg.split('=')[1]) : undefined;

const video = JSON.parse(readFileSync(
  join(HERE, framesArg ? framesArg.split('=')[1] : 'video-frames-catalog.json'), 'utf8'));
const truth = JSON.parse(readFileSync(join(HERE, 'corpus/kart/counts.json'), 'utf8'));
const cart = truth.counted.find((c: any) => c.id === 'IMG_0252');

const imageFor = (order: number) =>
  join(HERE, `.cache/kart/video/frame-${String(order + 1).padStart(3, '0')}.jpg`);

/**
 * The frame as the device would upload it, not as it sits on disk.
 *
 * `KartVisionFrameProcessorPlugin` encodes a keyframe through `KartImageTools.encodeKeyframe`, at
 * `keyframeMaxEdge` 1536 and JPEG quality 0.85. The corpus frames are 1080 by 1920, so the device
 * downscales before sending and the service composites that, which is one more JPEG generation
 * than reading the file gives. Passing the file straight through would hand the census a slightly
 * better image than the app can, and brand reading is exactly what a second compression softens.
 *
 * `--raw-frames` restores the old behaviour for comparison.
 */
const RAW_FRAMES = process.argv.includes('--raw-frames');
const encoded = new Map<number, Buffer>();
async function keyframeFor(order: number): Promise<Buffer> {
  const cached = encoded.get(order);
  if (cached) return cached;
  const file = readFileSync(imageFor(order));
  const out = RAW_FRAMES ? file : await sharp(file)
    .resize({ width: 1536, height: 1536, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
  encoded.set(order, out);
  return out;
}

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
let identifyCalls = 0;

const deps: SessionDeps = {
  // The transport only. `runCensus` is the shipped one; when the request carries no marks this
  // stands in for `enumerateRegions` with the frame's cached region column, which is what the
  // service would have returned for it.
  requestCensus: async (req) => {
    calls += 1;
    const image = await keyframeFor(currentFrame.order);
    const enumerated = req.marks === undefined || req.marks.length === 0;
    const marks: Mark[] = enumerated
      ? serverMarks(currentFrame)
      : req.marks!.map((m) => ({ id: m.id, box: m.box }));
    if (marks.length === 0) return { ok: false, failure: 'server' } as any;
    const counted = REUSE_NAMES
      ? (bagLines(session.state.fusion) as any[])
          .map((l) => `${l.brand ? `${l.brand} ` : ''}${l.name}`)
      : [];
    const census: any = await runCensus(image, marks, undefined, counted);
    let unmarked = SWEEP_ONCE && calls > 1 ? [] : (census.unmarkedItems ?? []);
    if (CORROBORATE) {
      const kept: any[] = [];
      for (const u of unmarked) {
        const key = foldName(u.description ?? '');
        if (seenUnmarked.has(key)) kept.push(u);
        else seenUnmarked.add(key);
      }
      unmarked = kept;
    }
    return {
      ok: true,
      value: {
        ...census,
        unmarkedItems: unmarked,
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
  // The real crop identify, not a stub. `onCapture` ends in `resolveUncertain`, which crops each
  // amber track and asks a closer look to settle it, and every scan figure measured here before
  // this was wired excluded that path entirely. `runIdentify` does the cropping itself when given
  // a box, exactly as the service does.
  requestIdentify: async (req) => {
    identifyCalls += 1;
    const image = await keyframeFor(currentFrame.order);
    try {
      const result: any = await runIdentify(image, req.hint, req.box);
      return { ok: true, value: result } as any;
    } catch {
      return { ok: false, failure: 'server' } as any;
    }
  },
  lookupBarcode: async () => null,
  saveThumbnail: async () => null,
};

const session = new RecognitionSession(deps);
let pipeline = createPipelineState();

const sequence: any[] = [];
for (let loop = 0; loop < LOOPS; loop += 1) {
  const span = video.frames[video.frames.length - 1].t - video.frames[0].t + 1;
  for (const f of video.frames) sequence.push(loop === 0 ? f : { ...f, t: f.t + loop * span });
}

for (const frame of sequence) {
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
  const stepped = processFrame(pipeline, scan as any, frame.t * 1000, {
    ...(MIN_INTERVAL_MS === undefined ? {} : { minIntervalMs: MIN_INTERVAL_MS }),
    ...(MAX_MOTION === undefined ? {} : { maxMotion: MAX_MOTION }),
  });
  pipeline = stepped.state;

  if (!stepped.keyframe.fire) continue;
  if (!session.wantsKeyframe(stepped.tracks, stepped.keyframe.fire)) continue;
  let image: string;
  try { image = (await keyframeFor(frame.order)).toString('base64'); } catch { continue; }

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
console.log(`\n  path=${PATHNAME}, ${DEVICE_REGIONS} device region(s) per frame, ` +
  `${calls} census call(s), ${identifyCalls} identify call(s)`);
console.log(`  bag holds ${units} units on ${lines.length} lines, against ${cart.products} real products`);
for (const l of lines) console.log(`      ${String(l.qty).padStart(2)}  ${l.brand ? `${l.brand} ` : ''}${l.name}`);

// Contents, scored against the same truth `video-census-live.ts` uses.
{
  const named = lines.map((l: any) => ({
    name: `${l.brand ? `${l.brand} ` : ''}${l.name}`.toLowerCase(),
    qty: l.qty ?? 1,
  }));
  const { found, strict, lenient, spurious } = scoreContents(named);
  console.log(`  products found ${strict} of ${VIDEO_TRUTH.length} on an unambiguous word, ` +
    `${lenient} of ${VIDEO_TRUTH.length} allowing words this trolley shares between two products`);
  const missing = VIDEO_TRUTH.filter((p) => !found.has(p.id)).map((p) => p.id);
  if (missing.length) console.log(`  missing: ${missing.join(', ')}`);
  if (spurious.length) console.log(`  lines matching nothing real: ${spurious.join(', ')}`);
}
