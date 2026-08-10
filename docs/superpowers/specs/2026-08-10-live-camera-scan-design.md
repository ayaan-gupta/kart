# Live camera scanning + real cart persistence

Date: 2026-08-10
Status: Approved for planning

## Problem

Kart's scan screen currently plays a bundled demo video (`assets/videos/scan.mp4`) and
replays a hardcoded, pre-computed recognition track (`src/engine/recognitionTrack.ts`) keyed
to the video's playback clock. It never looks at what the user is actually holding the camera
over. Separately, cart history (`hauls`) lives only in an in-memory zustand store and
`seedHauls()` reseeds the same six demo carts on every app launch, so nothing a user actually
scans survives a restart.

This spec replaces both with the real thing: live camera capture with on-device visual
recognition matched against the product catalog, and persisted cart history.

## Goals

- Point the phone's camera at a real cart and have real items get recognized, live, no canned
  video, no barcodes.
- Multiple identical products (two bags of the same chips) each count as their own unit, not
  collapsed into one.
- Recognized items behave like the current demo's UX: outline on first sighting, tint once
  counted, a hint when it looks like items remain unscanned.
- Low-confidence reads get a distinct "look again" state instead of either silently guessing
  wrong or silently doing nothing.
- Finished carts persist across app restarts.

## Non-goals (this pass)

- Barcode/UPC scanning. Decided explicitly against it: the product goal is items being
  recognized visually, the way a person would recognize them, not scanned.
- A custom-trained model on Kart's own catalog. Planned as a later phase once this ships and
  real accuracy gaps are known; collecting the training photos that would require is its own
  project.
- Robust re-identification of the same physical item across a broken camera track (see
  "Duplicate counting" below for the accepted limitation and its mitigation).

## Architecture

Live camera + Vision inference must run in native Swift; plain Expo/RN has no access to raw
camera frames. This adds **react-native-vision-camera** (works under Expo via its config
plugin) rather than a fully bespoke native camera module, it already solves capture session
lifecycle, permissions, and preview rendering. The only new native code is a small Swift
**Frame Processor Plugin** that runs Vision on a throttled subset of frames (roughly 3-4 times
per second, not all 30fps, real-time-every-frame inference has no accuracy benefit here and
burns battery) and returns plain data to JS: for each of the frame's top few salient regions,
a bounding box, a classify label with confidence, and any OCR text found in that region.

A JS-side recognition pipeline turns that raw, noisy, per-frame stream into stable state,
matches it to the catalog, and calls the existing `store.addDetection(skuCode, confidence)`,
so the store, bag tray, and cart-detail screens don't change, only what feeds them does.

```
Camera frames (throttled ~3-4/sec)
  -> Swift Frame Processor Plugin
       - VNGenerateObjectnessBasedSaliencyImageRequest (top ~3 salient regions)
       - VNClassifyImageRequest per region
       - VNRecognizeTextRequest per region (for OCR-assisted matching)
  -> JS: raw regions [{ box, label, confidence, ocrText }]
  -> Tracker (IoU-matches regions to active candidates across frames)
  -> Label matcher (label + OCR text -> catalog SKU)
  -> Candidate state machine (forming -> yellow -> locked)
  -> store.addDetection() on lock, exactly once per candidate
```

### New modules

- `src/engine/liveVision/types.ts` — shared types: `RawRegion`, `TrackedCandidate`,
  `CandidateState`.
- `src/engine/liveVision/tracker.ts` — IoU-based frame-to-frame candidate tracking and the
  confidence state machine. Pure logic, no camera or native dependency, unit-testable without
  hardware.
- `src/engine/liveVision/labelMatcher.ts` — keyword table mapping Vision labels to catalog
  SKUs, plus fuzzy OCR-text matching against catalog names for visually ambiguous packaged
  goods. Extends the mapping pattern already started for the garlic/onion case in the old
  recognition track.
- `src/engine/liveVision/frameProcessor.ts` — thin wrapper invoking the native Frame Processor
  Plugin from a VisionCamera `useFrameProcessor` worklet.
- ios native: a Frame Processor Plugin (Swift) implementing the Vision requests above.

### Changed modules

- `src/app/scan.tsx` — swap the `expo-video` player and `onVideoTime` polling for
  VisionCamera's `<Camera>` view driving the tracker pipeline.
- `src/components/ItemHighlights.tsx` — render three tint states (was two: outline, green) and
  take live, camera-relative box coordinates each frame instead of the old fixed
  video-timeline boxes.
- `src/engine/store.ts` — add persistence (below); no change to `addDetection`/`aggregate`,
  they already support multiple detections of the same SKU correctly.

### Retired

- `src/engine/scanEngine.ts`, `src/engine/recognitionTrack.ts`, and the scan screen's use of
  `assets/videos/scan.mp4` are no longer wired into the live scan flow. `scripts/classify-regions.swift`
  stays in the repo; it's still useful for offline calibration when tuning thresholds against
  new sample footage.

## Label matching

Vision's classifier returns generic labels ("grape," "corn," "bottle," "box"), the same
classifier already validated in the offline pipeline. A keyword table maps labels to catalog
SKUs. Produce matches on label alone, shape and color are usually distinctive enough. Packaged
goods (Pantry, Household, Beverages, categories where multiple SKUs share a generic silhouette
like "bottle" or "box") add the OCR text pulled from the same crop as a tiebreaker, fuzzy-matched
against catalog names, this is how a person actually tells two boxes apart too, by reading them,
not by outline.

## Candidate tracking and confidence tiers

Each throttled frame produces zero to three raw regions. A tracker maintains a list of active
candidates:

- A raw region is matched to an existing active candidate if their boxes overlap above an IoU
  threshold; if matched, the candidate's label history and last-seen box update. If unmatched,
  a new candidate is created.
- A candidate not matched by any region for longer than a short tolerance (allowing brief
  occlusion or a dropped frame, on the order of half a second) is considered lost and removed
  from active tracking.
- Each candidate's rolling label history drives its visual/logical state:
  - **Forming** (white outline): seen, not yet stable. Not counted.
  - **Tentative** (yellow tint): a stable label with confidence below the "confident"
    threshold, or an ambiguous packaged-goods match. Not yet added to the bag. The scan
    screen's existing hint banner nudges the user to bring it closer or hold the label
    steadier for a better OCR read. If confidence later crosses the confident threshold, it
    promotes to locked. If the candidate is lost while still tentative, it's dropped
    uncounted, no wrong add, no penalty, it can be picked up as a fresh candidate later.
  - **Locked** (green tint): confidence crossed the confident threshold and held for a short
    minimum dwell time. `store.addDetection(skuCode, confidence)` fires exactly once, at the
    moment of the forming/tentative -> locked transition. Stays green while tracked; once
    lost, nothing further happens, it's already counted.
- Exact confidence thresholds (yellow floor, confident threshold, dwell time, IoU match
  threshold, loss tolerance) are starting points to tune against real items on a physical
  device during implementation; they are not fixed requirements of this spec.

### Duplicate counting

Because locking happens per tracked candidate, not per SKU, two physically distinct bags of
the same chips in view (whether simultaneously or swept over one after another) each get their
own candidate, each independently locks, each independently calls `addDetection`. The store's
existing `aggregate()` already sums same-SKU detections into a quantity, so two bags of chips
correctly become qty 2 with no change needed at the store layer.

**Accepted limitation**: if a single physical item is fully lost from tracking after being
counted (leaves the frame, or is occluded past the loss tolerance) and the camera later sweeps
back over that same, still-unmoved item, the tracker has no way to tell it apart from a
genuinely new one, there's no barcode or persistent identity to check against. This can
double-count an item the user never actually duplicated. The mitigation is the workflow this
whole design was built around: physically moving counted (green) items out of the main pile as
they lock, so the camera doesn't pass back over them. This is a real limit of vision-only
recognition, not something a smarter threshold fixes; true re-identification is a
P2B-class problem alongside the custom-trained-model phase.

## Coverage hint

The current hint banner fires once, hardcoded to a fixed timestamp about the garlic. This
becomes dynamic: if the camera keeps finding candidates but nothing new has locked to green
(or a tentative candidate lingers unresolved) for a few seconds, the same top hint banner UI
fires a generic "looks like you have more items, try moving what's already scanned" message.

## Persistence

Wrap the existing zustand store with the `persist` middleware (`zustand/middleware`, already
available in the installed zustand version) backed by `@react-native-async-storage/async-storage`
(new dependency). `hauls` serializes to storage on every change. `seedHauls()` runs only when
storage is genuinely empty (first-ever launch), never on subsequent launches, so a finished
cart survives an app restart.

## Error handling

- Camera permission denied: standard friendly explanation with a settings deep link, matching
  platform conventions.
- A Vision request failing on a given frame (malformed frame, momentary resource pressure):
  skip that frame's results, don't crash, the next throttled frame tries again.
- AsyncStorage read failure on boot: fall back to seed data rather than crashing, log the
  failure.
- No network dependency anywhere in this pipeline, everything is on-device, so there's no
  offline/connectivity error path to handle.

## Testing

This is heavily hardware-dependent (no live camera in the iOS Simulator), so testing splits
into what can be verified without a device and what can't:

- **Without hardware** (unit tests): the tracker's IoU matching and state transitions, the
  label matcher's keyword/OCR fuzzy matching, and the persistence serialization round-trip.
  All pure logic, no camera or native code involved.
- **On physical hardware only**: pointing the camera at real groceries and confirming the
  white -> yellow -> green progression, the coverage hint firing appropriately, duplicate
  items counting as separate quantities, and confidence thresholds actually behaving
  reasonably against real lighting and real products. This cannot be meaningfully faked in the
  simulator or with synthetic test images; it needs a real device and real items.

## Open items to tune during implementation

- Actual threshold values (yellow floor, confident threshold, dwell time, IoU match, loss
  tolerance) — start with reasonable defaults, tune against real-device testing.
- The label-to-SKU keyword table and OCR fuzzy-match rules — will grow as real-device testing
  surfaces mismatches, same iterative process the offline pipeline already went through for
  the garlic/onion case.
