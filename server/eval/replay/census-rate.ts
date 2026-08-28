/**
 * How fast does each keyframe pacing rule spend the census budget?
 *
 * `run.ts` cannot answer this and it is worth saying why, because the two files look like they
 * measure the same thing. A census against `server/localvlm` takes 20 to 50 seconds and a clip
 * is twelve, so `RecognitionSession.censusInFlight` is true for roughly 95 per cent of every
 * clip, `wantsKeyframe` refuses for that whole window, and exactly one census fits per clip no
 * matter what the gate decides. Two materially different pacing rules produce byte-identical
 * replay reports. The gate handshake is real there; the census rate is not.
 *
 * So this drives the same real modules - `processFrame`, `evaluateKeyframe`,
 * `settleKeyframeRequest`, a real `RecognitionSession`, `nextScanRequest` - on a simulated clock
 * with a census latency you choose. No native half, no server, no model, no wall-clock wait.
 *
 * The three pacing rules are reachable without touching the source, by varying only what the
 * frame reports as `wantedKeyframe`:
 *
 *     decision   always false, so every decision charges the window   (the original code)
 *     delivery   always true, so only a delivery charges              (the defect in between)
 *     fixed      what the session actually asked                      (what ships)
 *
 * Native's own behaviour is identical in all three: delivery is decided from the real request
 * and the real floor, exactly as `KartFrameAnalysis` re-tests frame N+1.
 *
 *     server/node_modules/.bin/tsx server/eval/replay/census-rate.ts
 *
 * Two things make every number here an upper bound, and both are deliberate. The frame stream is
 * synthetic: lognormal sharpness in the range the clips measure, constant low motion, one stable
 * item. And the census stand-in never names anything, so `worthACensus` never goes false and the
 * budget is spent as fast as pacing permits. What is being measured is the pacing ceiling, not a
 * prediction of a real shopper's session.
 */
import './rn-globals';
import { createPipelineState, processFrame } from '../../../src/engine/liveVision/pipeline';
import { RecognitionSession, type SessionDeps } from '../../../src/engine/liveVision/orchestrator';
import { nextScanRequest } from '../../../src/engine/liveVision/scanStep';
import type { FrameScan, ScanRequest } from '../../../src/engine/liveVision/types';

const FPS = 30, SECONDS = 60, EPOCH = 1_000_000;
const SHIPPED_INTERVAL = 6000;
const BOX = { x: 0.25, y: 0.25, w: 0.3, h: 0.3 };
const POLY = [0.25, 0.25, 0.55, 0.25, 0.55, 0.55, 0.25, 0.55];

function mulberry32(a: number) {
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

/** One fixed frame stream, shared by all three variants so the comparison is like for like. */
function stream(): number[] {
  const rnd = mulberry32(20260827);
  return Array.from({ length: FPS * SECONDS }, () => {
    const g = Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
    return Math.exp(5.2 + 0.7 * g); // lognormal, median ~181, the range the clips measure
  });
}

async function run(variant: 'decision' | 'delivery' | 'fixed', latencyMs: number, minIntervalMs?: number) {
  const sharp = stream();
  const due: { at: number; go: () => void }[] = [];
  let now = EPOCH, censusCalls = 0;
  const callAt: number[] = [];

  const deps: SessionDeps = {
    requestCensus: (_req) => {
      censusCalls += 1;
      callAt.push(now - EPOCH);
      return new Promise((res) => due.push({ at: now + latencyMs, go: () => res({
        ok: true,
        value: {
          marks: [], inViewCounts: [], regions: [{ id: 1, box: BOX, polygon: POLY, score: 0.9 }],
          occlusion: { itemsLikelyHidden: false, severity: 'none', reason: 'sim' },
          // Deliberately never named: this measures the pacing ceiling, so `worthACensus` must
          // not go false because the bag filled up. It is an upper bound on calls, by design.
          unmarkedItems: [], enumeration: 'ok',
        },
      }) }));
    },
    requestIdentify: () => new Promise(() => {}),
    lookupBarcode: async () => null,
    saveThumbnail: async () => null,
  };

  const session = new RecognitionSession(deps);
  let pipeline = createPipelineState();
  let request: ScanRequest = { wantKeyframe: false, cropTrackIds: [] };
  let fires = 0, delivers = 0, asks = 0;

  for (let i = 0; i < sharp.length; i += 1) {
    // Native's real rule: it re-tests THIS frame against the floor the previous one sent.
    const delivered = request.wantKeyframe && sharp[i] >= (request.minSharpness ?? 0);
    if (request.wantKeyframe) asks += 1;
    if (delivered) delivers += 1;

    const scan: FrameScan = {
      instances: [{ box: BOX, polygon: POLY, score: 0.9 }],
      barcodes: [], sharpness: sharp[i], motion: 0.005, width: 1080, height: 1920, error: null,
      wantedKeyframe: variant === 'decision' ? false
        : variant === 'delivery' ? true : request.wantKeyframe,
      keyframe: delivered ? 'BASE64' : null, crops: [],
    };

    const result = processFrame(pipeline, scan, now, minIntervalMs === undefined ? {} : { minIntervalMs });
    pipeline = result.state;
    if (result.keyframe.fire) fires += 1;
    let current = result.tracks;
    if (delivered) {
      void session.onCapture('BASE64', pipeline.tracker, now)
        .then((c) => { if (c !== null) { pipeline = { ...pipeline, tracker: c.tracker }; current = c.tracks; } })
        .catch(() => undefined);
    }
    request = nextScanRequest(session, current, result.keyframe.fire, result.keyframe.minSharpness);

    now += 1000 / FPS;
    while (due.length > 0 && due[0].at <= now) due.shift()!.go();
    for (let k = 0; k < 4; k += 1) await new Promise((r) => setImmediate(r));
  }
  session.dispose();
  return { fires, asks, delivers, censusCalls, callAt };
}

async function main() {
  const table = async (interval: number, latency: number) => {
    console.log(`\ncensus latency ${latency / 1000}s, minIntervalMs ${interval}, ${SECONDS}s scan, budget 8`);
    console.log(`  ${'rule'.padEnd(10)} ${'fires'.padStart(6)} ${'asked'.padStart(6)} `
      + `${'delivered'.padStart(10)} ${'censuses'.padStart(9)} ${'budget gone'.padStart(12)}`);
    for (const v of ['decision', 'delivery', 'fixed'] as const) {
      const r = await run(v, latency, interval);
      const spent = r.callAt.length >= 8 ? `${(r.callAt[7] / 1000).toFixed(1)}s` : 'not spent';
      console.log(`  ${v.padEnd(10)} ${String(r.fires).padStart(6)} ${String(r.asks).padStart(6)} `
        + `${String(r.delivers).padStart(10)} ${String(r.censusCalls).padStart(9)} ${spent.padStart(12)}`);
    }
  };

  // The comparison that justified raising the interval: at the 2000 it had while the clock
  // started at the decision, fixing the defect spends the whole budget three times sooner.
  console.log('\n== why the interval moved: all three rules at the old minIntervalMs of 2000 ==');
  for (const latency of [1000, 2000, 5000, 20000]) await table(2000, latency);

  // What ships.
  console.log(`\n\n== what ships: minIntervalMs ${SHIPPED_INTERVAL} ==`);
  for (const latency of [1000, 2000, 5000]) await table(SHIPPED_INTERVAL, latency);

  console.log('\n\n== the interval as the spend dial (rule "fixed", census latency 2s) ==');
  console.log(`  ${'minIntervalMs'.padStart(13)} ${'delivered'.padStart(10)} ${'censuses'.padStart(9)} ${'budget gone'.padStart(12)}`);
  for (const iv of [2000, 3000, 4000, 5000, 6000, 8000]) {
    const r = await run('fixed', 2000, iv);
    const spent = r.callAt.length >= 8 ? `${(r.callAt[7] / 1000).toFixed(1)}s` : 'not spent';
    console.log(`  ${String(iv).padStart(13)} ${String(r.delivers).padStart(10)} ${String(r.censusCalls).padStart(9)} ${spent.padStart(12)}`);
  }
}
void main();
