# Live camera scan — design

## Problem

Kart's scan screen currently replays a bundled video (`assets/videos/scan.mp4`) against a
hand-baked recognition track (`src/engine/recognitionTrack.ts`) produced offline by
`scripts/classify-regions.swift`. It looks live but recognizes nothing in real time — there is
no camera involved. The goal of this work is to make the scan screen use the phone's actual
camera and Apple's Vision framework to detect and classify real items in real time, replacing
the simulated pipeline on iOS.

## Constraints and scope decisions

- **iOS only.** Vision is an Apple framework; there is no equivalent live pipeline for
  Android or web in this iteration. Those platforms keep the existing bundled-video simulated
  scan unchanged (see "Platform split" below).
- **No Simulator support.** The iOS Simulator has no camera hardware. This feature can only be
  built and tested on a physical iPhone, connected via Xcode (free Apple ID / personal-team
  signing, consistent with the earlier distribution work). Claude cannot visually verify scan
  accuracy itself — it has no way to point a camera at real groceries. Verification is a
  build → user tests on-device → reports findings → retune loop, not a one-shot.
- **Multi-item, simultaneous detection** (like the demo), not one-item-at-a-time scanning.
- **Camera-only.** No manual search/add fallback for items Vision can't recognize. Items that
  don't resolve simply stay uncounted, consistent with the existing "model failure becomes UX"
  framing (garlic, mango, jalapenos in the demo).
- **Catalog matching is best-effort across the full 42-SKU catalog**, but only produce-like
  items (bananas, apples, avocados, tomatoes, onions, grapes, citrus, peppers, corn, garlic,
  berries, melon, pineapple — roughly SKU codes `04xx`) are expected to reliably resolve.
  Vision's general classifier is not trained to distinguish packaged goods (milk vs. oat milk,
  which cereal box, which canned good) by appearance alone, so dairy/bakery/meat/pantry/snacks/
  beverages/household/pet items will mostly stay unrecognized. This is expected, not a bug to
  chase in this iteration.

## Architecture

```
AVCaptureSession (via react-native-vision-camera)
  → Frame Processor (JS worklet, throttled to ~2.5 passes/sec)
      → native Swift plugin: KartItemDetector
          1. VNGenerateForegroundInstanceMaskRequest → N instance masks
          2. per instance: bounding box → crop → VNClassifyImageRequest
          3. return [{ box, label, confidence }]
  → JS: liveScanEngine.ts
      1. track boxes across passes (proximity match → stable trackId)
      2. match label → SKU via keyword table
      3. require 2 consecutive matching passes before committing
      4. store.addDetection(skuCode, confidence)   ← existing store API, unchanged
  → UI: ScanFeed (RNVC <Camera>) + ItemHighlights (now driven by live tracked boxes)
```

The existing `src/engine/store.ts` (`useScanline`, `addDetection`, `aggregate`, `finishHaul`,
etc.) is unchanged — this was already a clean seam. Everything upstream of `addDetection` is new.

## Components

### 1. Native: `ios/KartItemDetector` (new Swift frame processor plugin)

- Registered as an RNVC Frame Processor Plugin, callable from a JS worklet as
  `detectItems(frame)`.
- Input: a `Frame` (RNVC's wrapper around `CMSampleBuffer`).
- Pipeline per invocation:
  1. Convert/downscale the frame to a manageable size for Vision (target ~640px on the long
     edge — full sensor resolution is unnecessary cost for classification).
  2. Run `VNGenerateForegroundInstanceMaskRequest` via `VNImageRequestHandler`.
  3. For each returned instance (cap at 8, largest area first): derive a normalized bounding
     box from the instance mask, crop that region from the frame.
  4. Run `VNClassifyImageRequest` on each crop; keep the top label if confidence ≥ 0.15.
  5. Return an array of plain objects: `{ box: {x,y,w,h} (0..1 normalized), label: string,
     confidence: number }`.
- Defensive: wrap the whole pipeline in try/catch; on any native error, return `[]` for that
  pass rather than throwing (a dropped pass is invisible to the user; a crash is not).
- Throttling lives in the JS worklet that calls this plugin (see below), not in the plugin
  itself — the plugin always does full work when invoked.

### 2. JS: `src/engine/liveScanEngine.ts` (new, parallel to existing `scanEngine.ts`)

Responsibilities, replacing what `scanEngine.ts` does for video playback:

- **Throttle**: only invoke the native frame processor roughly every 400ms (~2.5Hz), not
  every camera frame. Exact mechanism (fps-capped `useFrameProcessor` vs. a manual
  timestamp guard inside the worklet) is an implementation detail to confirm against the
  installed RNVC version's docs during implementation.
- **Tracking**: maintain a list of live tracks (`{ trackId, box, label, confidence, streak,
  committed }`). On each pass, match new raw detections to existing tracks by center-distance
  or IoU; unmatched new detections start a new track; unmatched old tracks that miss a couple
  of passes in a row are dropped (handles items leaving frame).
- **Smoothing**: track positions feed Reanimated shared values with `withSpring` so the UI
  doesn't jump discretely every ~400ms even though detection itself is not per-frame.
- **Catalog matching**: `matchLabelToSku(label: string): Sku | null` — keyword/synonym lookup
  against `CATALOG` names (new small table living next to this function, e.g. `"bell pepper" →
  "0423"`, `"garlic" → "0425"`). Returns `null` for anything unmatched; unmatched tracks are
  still drawn (so the highlight can appear) but never committed.
- **Commit rule**: a track must resolve to the *same* SKU across 2 consecutive passes
  (~800ms) before it fires `store.addDetection(skuCode, confidence)`, and fires at most once
  per track — mirrors the existing lock-on (white outline) → counted (green tint) UX, just
  driven by real tracking instead of a fixed script index.
- Exposes `startLiveScan()` / `stopLiveScan()` mirroring the existing `startScanEngine()` /
  `stopScanEngine()` shape, plus a live boxes accessor the UI reads from (shared value or
  small zustand slice — implementation detail).

### 3. UI changes

- **`ScanFeed.tsx`**: replace `expo-video`'s `<VideoView>` with RNVC's `<Camera>` component
  (same `StyleSheet.absoluteFill`, same scrim gradients layered on top unchanged). Camera
  permission is requested before mounting the camera; a denied state shows a clear message
  instead of a blank/crashed feed.
- **`ItemHighlights.tsx`**: remove the hard dependency on `RECOGNITION_TRACK` / `SCAN_VIDEO` /
  `timeSv`. New props take a live list of boxes: `{ trackId, skuCode, box: {x,y,w,h}
  (0..1 normalized to the camera frame), locked: boolean }[]`. The existing per-box animation
  (white outline → spring in → green tint + checkmark badge after commit) is preserved as-is;
  only the data source changes. The current `contentFit: cover`-style frame-to-view mapping
  logic is generalized (today it's hardcoded to `SCAN_VIDEO`'s fixed 496×1080 dims; it needs
  to use the live camera frame's actual dimensions instead, which RNVC exposes).
- **`scan.tsx`**: swap `useVideoPlayer` / `onVideoTime` / `startScanEngine` /
  `stopScanEngine` calls for camera-permission handling + `startLiveScan()` /
  `stopLiveScan()`. `RecordChip` (elapsed-time indicator) is unaffected — it already just
  reads `startedAt` from the store.

### 4. Platform split

`scan.tsx` (or a thin wrapper) branches on `Platform.OS`:
- **iOS**: the new live camera pipeline described above.
- **Android / web**: unchanged — the existing bundled-video + `recognitionTrack.ts` +
  `scanEngine.ts` path stays exactly as it is today. This keeps the web build already
  deployed at kart-preview.vercel.app working as a demo, and gives Android a reasonable
  (simulated) experience rather than nothing.

`recognitionTrack.ts`, `scanEngine.ts`, `classify-regions.swift`, and the bundled video are
**not deleted** — they become the non-iOS code path instead of the only path.

## Data flow summary

```
camera frame → (throttled) native Vision pass → raw detections
  → JS tracking (stable trackId, smoothed position)
  → label→SKU match
  → 2-pass stability gate
  → store.addDetection(skuCode, confidence)   [existing, unchanged]
  → existing UI (BagTray, DetectionRow, cart totals) unchanged downstream of the store
```

Everything from `store.addDetection` onward (bag tray, totals, finish-cart flow, cart detail)
is already built and does not change.

## Error handling

- **Camera permission denied**: scan screen shows a message + a way to open Settings, instead
  of an empty/broken feed. Does not crash.
- **No instances in frame**: zero boxes rendered — same as the current idle/empty state, not
  an error.
- **Native Vision pipeline error on a given pass**: caught in Swift, that pass returns `[]`,
  next pass tries again. Never propagates as a crash.
- **Frame processor plugin missing/unregistered** (e.g. prebuild didn't pick it up): should
  fail loudly in development (console error) rather than silently doing nothing, so it's
  obvious during the build → test loop.
- **Device below iOS 17** (no `VNGenerateForegroundInstanceMaskRequest`): out of scope to
  handle gracefully in this iteration — the app already positions itself as "best on iOS 26,"
  so this is a documented minimum rather than a soft-degrade path.

## Testing / verification plan

Given the Simulator cannot exercise a camera at all, verification is necessarily different
from prior work in this project:

1. `npx expo prebuild --platform ios` (picks up the new RNVC config plugin + native module).
2. `npx expo run:ios --device` to the connected physical iPhone (free Apple ID / personal
   team, per the earlier distribution conversation; re-signs weekly as needed).
3. Claude verifies: app launches without crashing, camera permission prompt appears correctly,
   denied-state UI works if permission is refused, and (via console/log output, not visual
   inspection) that detection passes are firing and reaching `store.addDetection`.
4. **Recognition accuracy itself must be verified by the user**, phone in hand, pointed at
   real groceries. Expect to report back what resolved, what didn't, and any obviously wrong
   matches — that feedback drives retuning the keyword-match table and confidence/stability
   thresholds. This is an iterative loop, not a single pass.

## Out of scope (this iteration)

- Manual add/search fallback for unrecognized items.
- Android or web live camera detection.
- Per-frame optical-flow tracking (`VNTrackObjectRequest`) for smoother inter-pass motion —
  spring-smoothed interpolation between ~400ms passes is the v1 bar; revisit if it feels too
  laggy in practice.
- Handling devices below iOS 17.
