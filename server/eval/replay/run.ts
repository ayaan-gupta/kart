/**
 * A whole scan, end to end, with no camera anywhere in it.
 *
 * This is the Node half of the replay harness. `scripts/replay-driver` is the other half: it
 * decodes a video clip and runs each frame through the real `KartFrameAnalysis` - the real
 * `AppleInstanceMaskDetector`, `MaskContour`, `FrameMetrics`, barcode reading, keyframe gate and
 * JPEG encoder. This process owns every decision the app's JavaScript owns: `processFrame`, the
 * tracker, `evaluateKeyframe` and its adaptive blur floor, `nextScanRequest`, and a real
 * `RecognitionSession` talking to a real recognition service over the app's own HTTP client.
 *
 * What that buys, and why it was worth building
 * ---------------------------------------------
 * Four separate bugs kept this app from ever uploading a single frame from a phone, and not one
 * of them could be reproduced by anything that existed: the unit tests all passed, the Simulator
 * has no camera, and `VNGenerateForegroundInstanceMaskRequest` cannot even create an inference
 * context there. Every check therefore ended in "go and try it on your phone", which is a slow
 * loop and an unreliable one.
 *
 * The gate in particular could only be tested here. It is a handshake across a process boundary:
 * JavaScript decides on frame N whether it wants a keyframe and at what blur floor, and the
 * native half re-tests that decision against frame N+1. Both sides can be individually correct
 * and still disagree - one of the four bugs was exactly that, a threshold that arrived as
 * infinity because of how a JavaScript integer boxed - and the only symptom was a scan that
 * tracked, outlined, and silently never uploaded. `gateDisagreements` below is the standing
 * check for that whole class.
 *
 * What it does not cover, said plainly: `AVCaptureSession`, and VisionCamera's JSI marshalling of
 * a `Frame` into a worklet runtime. Both are Apple's or VisionCamera's rather than this app's,
 * and the second is covered separately and partially by the probes in `frameLabNative.ts`.
 *
 * Cost: nothing, when pointed at the local model. That is the point of `--api`.
 *
 *     npm run replay -- --clip=server/eval/corpus/replay/ov-a1c7f353-1d8.mov
 *
 * Build the clip first with `python3 scripts/make-replay-clip.py <cart-id>`, and the driver with
 * `npm run build:replay-driver`. `npm run replay` does both.
 */
import './rn-globals';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, resolve } from 'node:path';
import { bagLines } from '../../../src/engine/liveVision/fusion';
import { buildScanCartArgs, toFrameScan } from '../../../src/engine/liveVision/frameScan';
import { RecognitionSession, type SessionDeps } from '../../../src/engine/liveVision/orchestrator';
import { createPipelineState, processFrame } from '../../../src/engine/liveVision/pipeline';
import { requestCensus, requestIdentify } from '../../../src/engine/liveVision/recognitionClient';
import { nextScanRequest } from '../../../src/engine/liveVision/scanStep';
import type { FrameScan, ScanRequest, Track } from '../../../src/engine/liveVision/types';

const REPO = resolve(import.meta.dirname, '..', '..', '..');

function arg(name: string, fallback: string | null = null): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
}

const CLIP = arg('clip');
if (CLIP === null) throw new Error('pass --clip=<path to a .mov built by make-replay-clip.py>');
const CLIP_PATH = resolve(REPO, CLIP);
if (!existsSync(CLIP_PATH)) throw new Error(`no clip at ${CLIP_PATH}`);

const DRIVER_BIN = resolve(REPO, arg('driver', 'build/kart-replay-driver')!);
if (!existsSync(DRIVER_BIN)) {
  throw new Error(`no replay driver at ${DRIVER_BIN}; run "npm run build:replay-driver"`);
}

/**
 * The service to scan against. Defaults to the local one, because a replay is meant to be run
 * often and a run that costs money will not be.
 *
 * Set as the app's own environment variable rather than passed around, because `apiBaseUrl()`
 * in `config.ts` reads exactly this on every call; setting it here means the harness and the app
 * resolve their endpoint through one code path.
 */
process.env.EXPO_PUBLIC_KART_API_URL = arg('api', process.env.EXPO_PUBLIC_KART_API_URL ?? 'http://127.0.0.1:4310')!;
process.env.EXPO_PUBLIC_KART_REQUEST_TIMEOUT_MS =
  arg('timeout', process.env.EXPO_PUBLIC_KART_REQUEST_TIMEOUT_MS ?? '600000')!;

const MAX_FRAMES = Number(arg('frames', '0')) || Infinity;

/**
 * Measure the gate alone, with no census at all.
 *
 * `RecognitionSession.wantsKeyframe` returns false for as long as a census is in flight, and the
 * local stand-in model answers in twenty to eighty seconds, which is longer than a whole clip.
 * A full replay therefore requests exactly one keyframe per clip no matter what the gate does,
 * and cannot tell a change to the gate from no change at all: keyed on the decision and keyed on
 * delivery both measured four encodes across four clips.
 *
 * That is not a defect in the app. On the shipped model a census answers in seconds, so the lock
 * is brief and the gate is what paces the scan. It is a property of the free stand-in, and this
 * flag is how the gate gets measured without waiting on a model that this harness deliberately
 * chose for being free rather than fast.
 */
const GATE_ONLY = process.argv.includes('--gate-only');

/** See the comment where this is used: it stands in for a real Unix clock. */
const CLOCK_EPOCH = 1_000_000;
const OUT = arg('out');

interface SidecarFrame {
  index: number;
  t: number;
  regime: string;
  speedPxPerFrame: number;
}

/** The clip's own ground truth, when it was built by `make-replay-clip.py`. */
function loadSidecar(): SidecarFrame[] | null {
  const path = CLIP_PATH.replace(/\.mov$/, '.frames.json');
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8')).frames as SidecarFrame[];
}

/**
 * One line in, one line out, to the native half.
 *
 * Deliberately lock-step rather than pipelined. A replay is a sequence, and the request for
 * frame N+1 is a function of what frame N produced; overlapping them would be measuring a
 * different app.
 */
class NativeReplay {
  private readonly child = spawn(DRIVER_BIN, [CLIP_PATH], { stdio: ['pipe', 'pipe', 'inherit'] });
  private readonly lines = createInterface({ input: this.child.stdout });
  private readonly waiting: ((value: Record<string, unknown>) => void)[] = [];
  private readonly pending: Record<string, unknown>[] = [];

  constructor() {
    this.lines.on('line', (line) => {
      if (line.trim().length === 0) return;
      const parsed = JSON.parse(line) as Record<string, unknown>;
      const next = this.waiting.shift();
      if (next === undefined) this.pending.push(parsed);
      else next(parsed);
    });
  }

  read(): Promise<Record<string, unknown>> {
    const ready = this.pending.shift();
    if (ready !== undefined) return Promise.resolve(ready);
    return new Promise((resolveLine) => this.waiting.push(resolveLine));
  }

  send(payload: Record<string, unknown>): void {
    this.child.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  close(): void {
    this.child.stdin.end();
    this.child.kill();
  }
}

/**
 * A keyframe JavaScript asked for that native declined to encode, with the numbers from both
 * sides.
 *
 * This is the shape of the defect that made this app look broken for weeks, so it is a first
 * class output rather than a log line. `wanted` is what this process asked for; `applied` is what
 * native echoed back as the threshold it actually parsed. They must be equal.
 */
interface GateDisagreement {
  index: number;
  sharpness: number;
  motion: number;
  wantedMinSharpness: number;
  appliedMinSharpness: number | undefined;
  appliedMaxMotion: number | undefined;
}

async function main(): Promise<void> {
  const sidecar = loadSidecar();
  const native = new NativeReplay();
  const opened = await native.read();
  if (opened.type !== 'open') throw new Error(`native replay did not open: ${JSON.stringify(opened)}`);

  let censusCalls = 0;
  let censusFailures = 0;
  let identifyCalls = 0;
  /** Errors thrown out of the transport, which the session would otherwise swallow. */
  const transportErrors: string[] = [];
  const inFlight: Promise<unknown>[] = [];

  const deps: SessionDeps = {
    // The app's own client, against a real service. Not a stub: this is the only harness in the
    // repository where the request the phone would send is the request that gets sent.
    requestCensus: async (req, signal) => {
      censusCalls += 1;
      const started = Date.now();
      // Wrapped, because a throw here is invisible everywhere else. `onCapture` catches every
      // error the census path can raise and returns null, which is right for a phone (a scan must
      // keep drawing) and wrong for a harness: the first version of this file reported four
      // successful censuses and an empty bag while every one of them was throwing a
      // `ReferenceError` before it reached the network. `transportErrors` is what makes that
      // loud rather than absent. See `rn-globals.ts` for the error in question.
      try {
        const result = await requestCensus(req, signal);
        const seconds = ((Date.now() - started) / 1000).toFixed(1);
        if (!result.ok) censusFailures += 1;
        process.stderr.write(result.ok
          ? `  census ${censusCalls}: ok in ${seconds}s, `
            + `${result.value.unmarkedItems.length} unmarked, ${result.value.marks.length} marks, `
            + `enumeration ${result.value.enumeration}\n`
          : `  census ${censusCalls}: failed in ${seconds}s (${result.failure})\n`);
        return result;
      } catch (error) {
        transportErrors.push(`census ${censusCalls}: ${(error as Error)?.message ?? String(error)}`);
        process.stderr.write(`  census ${censusCalls}: THREW ${(error as Error)?.message}\n`);
        throw error;
      }
    },
    requestIdentify: async (req, signal) => {
      identifyCalls += 1;
      try {
        return await requestIdentify(req, signal);
      } catch (error) {
        transportErrors.push(`identify ${identifyCalls}: ${(error as Error)?.message ?? String(error)}`);
        throw error;
      }
    },
    lookupBarcode: async () => null,
    // No filesystem: thumbnails are a rendering concern and the bag is scored on names.
    saveThumbnail: async () => null,
  };

  const session = new RecognitionSession(deps);
  let pipeline = createPipelineState();
  let request: ScanRequest = { wantKeyframe: false, cropTrackIds: [] };

  const reasons = new Map<string, number>();
  const firedByRegime = new Map<string, number>();
  const framesByRegime = new Map<string, number>();
  const disagreements: GateDisagreement[] = [];
  const sharpnessByRegime = new Map<string, number[]>();
  let frames = 0;
  let encoded = 0;
  let nativeErrors = 0;
  let instancesSeen = 0;

  for (;;) {
    if (frames >= MAX_FRAMES) break;

    native.send(buildScanCartArgs(request));
    const reply = await native.read();
    if (reply.type !== 'frame') break;

    // `request` is still the one sent for this frame; it is reassigned at the end of the loop.
    const scan: FrameScan = toFrameScan(reply, request.wantKeyframe);
    const index = reply.index as number;
    // The clip's own clock, not the wall clock. The pacing interval and the scene-change rule are
    // both functions of `now`, so driving them from real time would make a replay's result depend
    // on how fast this Mac decoded video, which is not a property of the app.
    //
    // Offset by `CLOCK_EPOCH` rather than starting at zero. A fresh `KeyframeState` has
    // `lastFiredAt: 0`, and on a phone `now` is a Unix millisecond count, so the first frame of a
    // session is always further past that than `minIntervalMs` and fires at once. Starting a
    // replay's clock at zero would instead hold the first two seconds of every clip on
    // `too-soon`, which no session on a device has ever done.
    const now = CLOCK_EPOCH + Math.round((reply.ptsSeconds as number) * 1000);
    const regime = sidecar?.[index]?.regime ?? 'unknown';

    frames += 1;
    instancesSeen += scan.instances.length;
    if (scan.error !== null) nativeErrors += 1;
    if (scan.keyframe !== null) encoded += 1;
    framesByRegime.set(regime, (framesByRegime.get(regime) ?? 0) + 1);
    const bucket = sharpnessByRegime.get(regime) ?? [];
    bucket.push(scan.sharpness);
    sharpnessByRegime.set(regime, bucket);

    const result = processFrame(pipeline, scan, now);
    pipeline = result.state;
    reasons.set(result.keyframe.reason, (reasons.get(result.keyframe.reason) ?? 0) + 1);

    // The frame this request was judged against is the *previous* one, so a disagreement is only
    // meaningful where this process asked for a keyframe and the same frame came back without
    // one despite passing both of native's own tests.
    if (request.wantKeyframe && scan.keyframe === null) {
      const applied = scan.gateMinSharpness;
      const passesSharp = applied !== undefined && scan.sharpness >= applied;
      const passesMotion = scan.gateMaxMotion !== undefined && scan.motion <= scan.gateMaxMotion;
      if (passesSharp && passesMotion) {
        disagreements.push({
          index, sharpness: scan.sharpness, motion: scan.motion,
          wantedMinSharpness: request.minSharpness ?? NaN,
          appliedMinSharpness: applied, appliedMaxMotion: scan.gateMaxMotion,
        });
      }
    }
    // A threshold that arrives as something other than what was sent is the fail-closed parsing
    // defect, and it is worth catching even on a frame that was going to be held anyway.
    if (
      request.minSharpness !== undefined && scan.gateMinSharpness !== undefined
      && Math.abs(scan.gateMinSharpness - request.minSharpness) > 1e-6
    ) {
      disagreements.push({
        index, sharpness: scan.sharpness, motion: scan.motion,
        wantedMinSharpness: request.minSharpness,
        appliedMinSharpness: scan.gateMinSharpness, appliedMaxMotion: scan.gateMaxMotion,
      });
    }

    let current: Track[] = result.tracks;
    if (result.keyframe.fire) {
      firedByRegime.set(regime, (firedByRegime.get(regime) ?? 0) + 1);
    }

    if (scan.keyframe !== null && !GATE_ONLY) {
      // Not awaited, exactly as the scan screen does not await it: a census takes seconds and the
      // frame loop must never stop for one. The tracker is handed over and taken back so the next
      // frames track against the regions the service enumerated rather than the detector's blob.
      const capture = session
        .onCapture(scan.keyframe, pipeline.tracker, now)
        .then((captured) => {
          if (captured !== null) {
            pipeline = { ...pipeline, tracker: captured.tracker };
            current = captured.tracks;
          }
        })
        .catch(() => undefined);
      inFlight.push(capture);
    }
    if (scan.crops.length > 0 && !GATE_ONLY) {
      inFlight.push(session.onCrops(scan.crops).catch(() => undefined));
    }

    request = nextScanRequest(session, current, result.keyframe.fire, result.keyframe.minSharpness);

    if (frames % 30 === 0) {
      process.stderr.write(
        `  frame ${frames}  ${regime}  sharp ${scan.sharpness.toFixed(1)}/`
        + `${result.keyframe.minSharpness.toFixed(1)}  motion ${scan.motion.toFixed(3)}`
        + `  ${result.keyframe.reason}  census ${censusCalls}\n`);
    }
  }

  native.send({ type: 'close' });
  native.close();
  await Promise.all(inFlight);

  const median = (values: number[]): number => {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };

  const report = {
    clip: CLIP,
    gateOnly: GATE_ONLY,
    api: process.env.EXPO_PUBLIC_KART_API_URL,
    frames,
    nativeErrors,
    meanInstancesPerFrame: frames === 0 ? 0 : Number((instancesSeen / frames).toFixed(2)),
    keyframesRequested: [...firedByRegime.values()].reduce((a, b) => a + b, 0),
    keyframesEncoded: encoded,
    gateReasons: Object.fromEntries([...reasons.entries()].sort((a, b) => b[1] - a[1])),
    byRegime: Object.fromEntries([...framesByRegime.entries()].map(([name, count]) => [name, {
      frames: count,
      fired: firedByRegime.get(name) ?? 0,
      medianSharpness: Number(median(sharpnessByRegime.get(name) ?? []).toFixed(1)),
    }])),
    gateDisagreements: disagreements,
    censusCalls,
    censusFailures,
    // The session's own count, not this file's. They differ when the transport throws rather
    // than returning a failure, which is the case worth seeing.
    sessionCensusFailures: session.state.censusFailures,
    transportErrors,
    identifyCalls,
    bag: bagLines(session.state.fusion).map((line) => ({
      name: line.name, brand: line.brand, size: line.size, qty: line.qty,
    })),
  };

  session.dispose();

  process.stdout.write(`${JSON.stringify(report, null, 1)}\n`);
  if (OUT !== null) {
    const path = resolve(REPO, OUT);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(report, null, 1)}\n`);
    process.stderr.write(`wrote ${path}\n`);
  }
}

void main().then(() => process.exit(0));
