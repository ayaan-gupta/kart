# Replay: a camera stand-in that runs on this Mac

A whole scan, end to end, with no phone, no Simulator and no camera. Real Vision segmentation,
the real keyframe gate, the real tracker, the real recognition session, and a real service call.

```bash
python3 scripts/make-replay-clip.py ov-a1c7f353-1d8      # once per cart photograph
npm run replay -- --clip=server/eval/corpus/replay/ov-a1c7f353-1d8.mov
```

Pointed at the local model by default, so a run costs nothing.

## Why it exists

Four separate defects kept this app from ever uploading a single frame from a phone. Not one of
them could be reproduced by anything that existed at the time: the unit tests passed, the
Simulator has no camera, and `VNGenerateForegroundInstanceMaskRequest` cannot even create an
inference context there. Every check ended in "go and try it on your phone".

Three of the four lived in the seam between JavaScript and native, which is precisely what a
unit test on either side cannot see:

| defect | why no test caught it |
|---|---|
| every mask rotated 180 degrees | both sides agreed on the number; only the pixels disagreed |
| a blur threshold calibrated against a different statistic | the constant was correct, the scale was not |
| a threshold arriving as infinity because of how an integer boxed | each side individually correct |
| the scan request never crossing the worklet boundary at all | the writes typechecked and went nowhere |

The gate is a handshake, not a filter. JavaScript decides on frame N whether it wants a keyframe
and at what blur floor; native re-tests that decision against frame N+1. `gateDisagreements` in
every report is the standing check for that whole class: a keyframe asked for, and refused by a
native side that had already agreed it passed.

## The three pieces

**`scripts/make-replay-clip.py`** turns one photograph of a real loaded cart into a twelve-second
handheld clip: four framings, each reached by a whip-pan and then held. Motion blur is integrated
across a half-open shutter rather than filtered on afterwards, so a fast segment smears as far as
it travelled and `FrameMetrics.sharpness` falls for the same reason it falls on a phone. Measured
separation on `ov-a1c7f353-1d8`: sweep frames travel a median 35.9 pixels against 1.8 in the
holds, and read a median sharpness of 79.8 against 339.2.

The clip is written sensor-shaped, a quarter turn anticlockwise from display, because the back
camera's buffer is landscape even while the app is portrait-locked and the plugin corrects for
that by pinning `.right`. A sidecar JSON records each frame's regime, which is the ground truth
a report is scored against.

**`scripts/replay-driver/main.swift`** decodes the clip and runs each frame through
`KartFrameAnalysis` — the real `AppleInstanceMaskDetector`, `MaskContour`, `FrameMetrics`,
barcode reading, keyframe gate and JPEG encoder — holding one detector and one `FrameMetrics`
for the whole clip, exactly as the live plugin holds one of each for the life of a camera
session. It runs as a Mac binary rather than in the Simulator because Vision segmentation works
here and does not work there.

**`run.ts`** owns every decision the app's JavaScript owns: `processFrame`, the tracker,
`evaluateKeyframe` and its adaptive blur floor, `nextScanRequest`, and a real
`RecognitionSession` talking to a real service over the app's own HTTP client. One request in
and one reply out per frame, lock-step, because the request for frame N+1 is a function of what
frame N produced.

## What it does not cover

`AVCaptureSession`, and VisionCamera's JSI marshalling of a `Frame` into a worklet runtime. The
first is Apple's. The second is covered separately and partially by `probeWorkletBoundary` and
`probeRequestPropagation` in `src/engine/liveVision/frameLabNative.ts`, which prove that a
worklet runs `scanCart` and that a shared value written from the JS thread reaches a runtime that
was already warm — the exact defect that had kept the app from uploading anything.

## Reading a report

    frames                 how many were decoded and analysed
    gateReasons            why the gate held, by reason, over the whole clip
    byRegime               frames, keyframes fired, and median sharpness per regime
    keyframesRequested     the gate DECIDED to capture, on frame N
    keyframesEncoded       native agreed and encoded one, on frame N+1
    gateDisagreements      asked for, passed native's own tests, and still not encoded
    transportErrors        errors thrown out of the transport, which the session swallows
    gateOnly               true when --gate-only skipped the census entirely
    bag                    what a shopper would see

`keyframesRequested` is the gate's decision, not the request that reached native. Between the two
sits `RecognitionSession.wantsKeyframe`, which returns false while a census is in flight, so a
slow model suppresses requests the gate did make. That is why `--gate-only` exists: without it a
full run against the local stand-in measures the model's latency and calls it the gate's pacing.

`keyframesRequested` above `keyframesEncoded` is expected and not a defect: the one-frame lag is
the design, and a frame that got blurrier in the meantime is correctly refused. A non-empty
`gateDisagreements` is a defect.

`transportErrors` exists because `onCapture` catches every error the census path can raise and
returns null, which is right for a phone and wrong for a harness. The first version of this file
reported four successful censuses and an empty bag while every one of them was throwing a
`ReferenceError` before it reached the network, because Metro defines `__DEV__` in every app
bundle and Node does not. See `rn-globals.ts`.

## Measured, 2026-08-26

Four clips from the four distinct cart-tier photographs in `cart-curation.json` (the fifth and
sixth are a documented near-duplicate group and render to byte-identical clips). 360 frames each,
1440 in total, against `server/localvlm/serve.py` on `mlx-community/Qwen2.5-VL-7B-Instruct-4bit`.
Per-clip reports are `report-<id>.json` beside this file.

| clip | frames | native errors | keyframes asked | encoded | disagreements | censuses | bag lines |
|---|---|---|---|---|---|---|---|
| ov-16dca705-1c1 | 360 | 0 | 6 | 1 | 0 | 1 | 10 |
| ov-1fd5fc9a-747 | 360 | 0 | 4 | 1 | 0 | 1 | 10 |
| ov-a098628b-048 | 360 | 0 | 6 | 1 | 0 | 1 | 4 |
| ov-a1c7f353-1d8 | 360 | 0 | 6 | 1 | 0 | 1 | 6 |

Zero gate disagreements across 1440 frames: the two halves of the gate now apply the same
thresholds to the same frames, which is what the four defects had broken.

The single census per clip in that table is the local model's latency, not the gate's pacing.
See below.

### What it found, and what two readings of it got wrong

The first sweep showed 22 keyframe decisions producing 4 uploads and exactly one census per
twelve-second clip, and the obvious culprit was the pacing clock: `evaluateKeyframe` started its
two-second interval when it *decided* to fire, and native then re-tested the next frame against
the adaptive blur floor and refused it about 60 per cent of the time, after the interval had
already been charged. That reading was half right, and the fix first written for it was wrong.

Keying the clock on delivery alone changed the full-run numbers not at all: still four encodes
across four clips, still one census each. The reason is `RecognitionSession.wantsKeyframe`, which
returns false while a census is in flight. The local stand-in model answers in 20 to 80 seconds,
which is longer than an entire clip, so the first census suppresses every later request no matter
what the gate decides. The full-run delivery figure was measuring the model's latency, not the
gate.

`--gate-only` skips the census, and against the delivery-keyed code it appeared to show a large
improvement. It did not. A clock keyed purely on delivery never advances while `wantsKeyframe` is
suppressing requests, because nothing is ever delivered, so the gate fires on essentially every
frame: 156 fires in 180 frames, against 3 when requests really are delivered. `keyframesRequested`
counts fires, so that sweep's "after" column was counting a runaway rather than captures gained.
Every figure derived from it, including a 38 per cent improvement an earlier version of this file
reported, was measuring the defect. The 22-decisions-for-4-uploads "before" stands; the "after"
did not exist.

The correct fix distinguishes three outcomes rather than two. `settleKeyframeRequest` charges the
pacing window when a keyframe is delivered, charges it when the gate decided to fire but the
session never sent the request, and charges nothing when the request reached native and native
refused it. Only that third case was ever the defect. `FrameScan` carries `wantedKeyframe`, set by
`scanCart` from the request it actually used, so "was native asked" comes from the one place that
cannot disagree with what crossed the worklet boundary.

### Measured after the fix, 2026-08-27

All four clips re-run against the shipped configuration: the three-outcome rule with
`minIntervalMs` at 6000. Census latency on this run was 46.7s, 22.2s, 22.8s and 26.4s, against
clips of twelve seconds.

| clip | asked | encoded | disagreements | censuses | bag lines |
|---|---|---|---|---|---|
| ov-16dca705-1c1 | 6 -> 2 | 1 -> 1 | 0 -> 0 | 1 -> 1 | 10 -> 10 |
| ov-1fd5fc9a-747 | 4 -> 2 | 1 -> 1 | 0 -> 0 | 1 -> 1 | 10 -> 10 |
| ov-a098628b-048 | 6 -> 2 | 1 -> 1 | 0 -> 0 | 1 -> 1 | 4 -> 4 |
| ov-a1c7f353-1d8 | 6 -> 2 | 1 -> 1 | 0 -> 0 | 1 -> 1 | 6 -> 6 |
| **total** | **22 -> 8** | **4 -> 4** | **0 -> 0** | **4 -> 4** | |

Zero gate disagreements and zero native errors on both sides. Encodes, censuses and bag are
unchanged; the decision count falls because the interval tripled, so the same four captures now
cost eight decisions instead of twenty-two. Read that as fewer wasted decisions, not as more
captures: the ratio moves from 4-in-22 to 4-in-8 without a single extra keyframe reaching the
service. An earlier draft of this section reported the two runs as identical field for field.
They are identical on encodes, censuses, disagreements and bag, and they are not identical on
`byRegime.fired`, which shifts by one between regimes on two clips.

That is the honest result and it is not a null one. **This harness cannot measure a change to
keyframe pacing at all.** A census outlasts the clip that started it, so `censusInFlight` is true
for roughly 95 per cent of every clip, and one census per clip is the only reachable outcome
whatever the gate does. Two materially different pacing rules produce byte-identical reports here.
Do not read a pacing result out of this file; read `gateDisagreements`, native errors, per-regime
sharpness and the bag, which it does measure soundly.

What does answer it is `census-rate.ts` beside this file, which drives the same real modules -
`processFrame`, `settleKeyframeRequest`, a real `RecognitionSession`, `nextScanRequest` - on a
simulated clock with a census latency you choose, and no native half, server or model.

```bash
npm run census-rate
```

The three rules are reachable without touching the source, by varying only what the frame reports
as `wantedKeyframe`: always false is the old decision-keyed rule, always true is the delivery-only
one, and the session's real answer is the shipped rule. Sixty-second scan, two-second census, the
budget of eight, at the old `minIntervalMs` of 2000:

| rule | fires | asked | delivered | censuses | budget gone |
|---|---|---|---|---|---|
| decision-keyed | 29 | 24 | 8 | 8 | 48.9s |
| delivery-only | 498 | 17 | 8 | 8 | 16.3s |
| three outcomes | 37 | 17 | 8 | 8 | 16.3s |

The ceiling does not move: `MAX_CENSUS_CALLS_PER_SESSION` binds first and every rule spends eight.
What moves is the rate. Fixing the defect made a scan reach its budget three times sooner, so a
twenty-second scan in a checkout queue would spend eight calls where it used to spend about three.

So `minIntervalMs` went from 2000 to 6000 in the same change. The dial is close to linear -
2000/16.3s, 3000/23.0s, 4000/29.3s, 5000/37.1s, 6000/45.1s, 8000/57.7s - and 6000 puts the spend
back where the old rule had it while keeping the correctness fix. The standing constraint is to
minimise paid-model usage, so it starts at the conservative end and can be lowered once there are
real per-scan cost figures from a phone rather than from a stand-in.

At the 6000 that ships, the same run gives the fixed rule its eight calls in 45.1s while the old
decision-keyed rule manages only three in the whole minute. The fix is doing the work; the
interval only sets the rate.

Two caveats on those tables, both of which make them an upper bound. The frame stream is
synthetic: lognormal sharpness in the range the clips measure, constant low motion, one stable
item. And the census stand-in never names anything, so `worthACensus` never goes false and the
budget is spent as fast as pacing permits. They are a measurement of the pacing ceiling, not a
prediction of a real shopper's session.

### Not a pipeline finding

`ov-1fd5fc9a-747` returns a plausible generic grocery list (milk, eggs, bread, juice, chips,
canned goods, snacks, frozen vegetables, frozen fruits, frozen meals) for a photograph
`cart-curation.json` describes as "distant and low resolution, individual products not
resolvable", and whose frames measure a median sharpness of 34.9 against 339.2 for the sharpest
clip. That is the local stand-in model inventing, not the pipeline failing, and it is one reason
this harness defaults to a free model rather than trusting one.
