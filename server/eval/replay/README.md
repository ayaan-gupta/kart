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

Measured after-numbers for that fix are not in this file yet, and no delivery-rate claim should be
made from it until they are.

The cost implication, which is a decision rather than a fact: on the shipped model a census
answers in seconds, so `censusInFlight` is brief and the gate really does pace the scan. More
captures delivered means a session reaches `MAX_CENSUS_CALLS_PER_SESSION` sooner. The cap is
unchanged and still bounds spend per scan; what changes is that a short scan spends more of its
budget than it used to, and fills the bag more. That is real money against a paid model and is
the user's call, not the harness's.

### Not a pipeline finding

`ov-1fd5fc9a-747` returns a plausible generic grocery list (milk, eggs, bread, juice, chips,
canned goods, snacks, frozen vegetables, frozen fruits, frozen meals) for a photograph
`cart-curation.json` describes as "distant and low resolution, individual products not
resolvable", and whose frames measure a median sharpness of 34.9 against 339.2 for the sharpest
clip. That is the local stand-in model inventing, not the pipeline failing, and it is one reason
this harness defaults to a free model rather than trusting one.
