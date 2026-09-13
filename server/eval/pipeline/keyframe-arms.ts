/**
 * How many census calls a scan actually spends, and on which frames.
 *
 * The live scan of IMG_0252 was spending one call of a budget of eight. The cause is the adaptive
 * blur floor: it is a quantile of the last 40 frames, which at this frame rate is longer than the
 * whole nine seconds, so a scan that opens on its sharpest view and then pans keeps being measured
 * against a view it has left. The floor settles near 263 off the first three seconds and refuses
 * all 18 frames after it.
 *
 * Two is the ceiling on this clip, not four. `minIntervalMs` is 6000 on purpose, so 8.7 seconds
 * has room for a call at the start and one at the end; the four calls recorded in KART.md were
 * measured while it was 2000. This harness is about the second call, and about what the same rule
 * does to a longer scan, which is where the other six calls of the budget live.
 *
 * The gate is plain TypeScript and the frame signals are already measured and saved, so this
 * costs nothing to run and calls no model. What it cannot say is whether the extra calls are
 * worth paying for; `video-census-live.ts` answers that, once, on the arm this one picks.
 *
 *     server/node_modules/.bin/tsx server/eval/pipeline/keyframe-arms.ts
 *
 *     --frames <path>   frame signals (default server/eval/video-frames-catalog.json)
 *     --loops <n>       replay the sequence n times, offset in time, as one continuous session.
 *                       Nine seconds cannot spend eight calls at any setting; a shopper scanning
 *                       for a minute pans over the trolley more than once, and this is the same
 *                       views arriving later (default 1, and 7 is about a minute).
 *     --out <path>      result JSON (default server/eval/keyframe-arms.json)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createKeyframeState, evaluateKeyframe, settleKeyframeRequest } from "../../../src/engine/liveVision/keyframe";
import { MAX_CENSUS_CALLS_PER_SESSION } from "../../../src/engine/liveVision/config";
import type { KeyframeConfig, KeyframeSignals } from "../../../src/engine/liveVision/types";

const argv = process.argv.slice(2);
function arg(name: string, fallback: string): string {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (argv[i + 1] ?? fallback);
}
const HERE = join(import.meta.dirname, "..");
const FRAMES = arg("frames", join(HERE, "video-frames-catalog.json"));
const LOOPS = Math.max(1, Number(arg("loops", "1")));
const OUT = arg("out", join(HERE, "keyframe-arms.json"));

/**
 * A real session's clock does not start at zero, and `lastFiredAt` does. The first frame of a
 * scan is therefore always past its pacing interval and fires at once; replaying from zero would
 * hold it as "too-soon" and measure a session that never starts.
 */
const SESSION_START = 1_000_000;

type Frame = { t: number; sharpness: number; motion: number; boxes: unknown[] };
const video = JSON.parse(readFileSync(FRAMES, "utf8")) as { frames: Frame[] };

const span = video.frames[video.frames.length - 1].t - video.frames[0].t + 1 / 3;
const sequence: Frame[] = [];
for (let loop = 0; loop < LOOPS; loop++) {
  for (const f of video.frames) sequence.push({ ...f, t: f.t + loop * span });
}

/**
 * The arms. `starvationMs` is the new dial: how long the gate may sit past its pacing interval,
 * held back by blur alone, before the floor gives way to what the scene is offering now.
 */
const ARMS: { name: string; config: Partial<KeyframeConfig> }[] = [
  { name: "shipped", config: { starvationMs: 0 } },
  { name: "starve-1s", config: { starvationMs: 1000 } },
  { name: "starve-2s", config: { starvationMs: 2000 } },
  { name: "starve-4s", config: { starvationMs: 4000 } },
  { name: "window-12", config: { starvationMs: 0, sharpnessWindow: 12 } },
  { name: "quantile-0.3", config: { starvationMs: 0, sharpnessQuantile: 0.3 } },
];

type Fire = { atSeconds: number; sharpness: number };
type Result = { arm: string; fires: Fire[]; heldBlurry: number; heldTooSoon: number };

const results: Result[] = ARMS.map(({ name, config }) => {
  let state = createKeyframeState();
  const fires: Fire[] = [];
  let heldBlurry = 0;
  let heldTooSoon = 0;
  for (const frame of sequence) {
    const now = SESSION_START + Math.round(frame.t * 1000);
    // One track, the way `scan-loop.ts` supplies the device detector's best region per frame. The
    // blur floor is what is being measured, so the scene is held still in every other respect.
    const signals: KeyframeSignals = {
      sharpness: frame.sharpness,
      motion: frame.motion,
      trackCount: frame.boxes.length > 0 ? 3 : 0,
      now,
    };
    const result = evaluateKeyframe(state, signals, config);
    state = result.state;
    if (result.reason === "blurry") heldBlurry += 1;
    if (result.reason === "too-soon") heldTooSoon += 1;
    if (!result.fire) continue;
    if (fires.length >= MAX_CENSUS_CALLS_PER_SESSION) continue;
    fires.push({ atSeconds: Number(frame.t.toFixed(2)), sharpness: Math.round(frame.sharpness) });
    state = settleKeyframeRequest(state, { requested: true, delivered: true }, now, 3);
  }
  return { arm: name, fires, heldBlurry, heldTooSoon };
});

const seconds = sequence[sequence.length - 1].t;
console.log(`${sequence.length} frames over ${seconds.toFixed(1)}s, budget ${MAX_CENSUS_CALLS_PER_SESSION} calls\n`);
console.log("arm            calls  median sharpness  held blurry  fired at");
for (const r of results) {
  const sharp = r.fires.map((f) => f.sharpness).sort((a, b) => a - b);
  const median = sharp.length === 0 ? 0 : sharp[Math.floor(sharp.length / 2)];
  console.log(
    `${r.arm.padEnd(14)} ${String(r.fires.length).padStart(5)} ${String(median).padStart(17)} ` +
      `${String(r.heldBlurry).padStart(12)}  ${r.fires.map((f) => `${f.atSeconds}s`).join(" ")}`,
  );
}

writeFileSync(OUT, JSON.stringify({ ranAt: new Date().toISOString(), frames: FRAMES, loops: LOOPS, seconds, results }, null, 1));
console.log(`\nwrote ${OUT}`);
