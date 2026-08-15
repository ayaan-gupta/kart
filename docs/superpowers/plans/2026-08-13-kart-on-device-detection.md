# Kart On-Device Detection and Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three-region saliency classifier with an on-device pipeline that finds every distinct item shape in a loaded cart, holds a stable identity for each through jitter and occlusion, and decides when a frame is worth sending to the cloud.

**Architecture:** A Swift `KartDetector` protocol returns class-agnostic instance polygons for a frame. The first implementation wraps Apple's `VNGenerateForegroundInstanceMaskRequest`, chosen because it ships free, adds nothing to the binary, and carries no licence obligation. Which detector finally ships is decided by measurement, not by this plan: Task 9 builds a command line harness that scores any detector over a folder of real cart photos, and a Core ML detector can be added behind the same protocol without touching anything above it. On the JavaScript side, detections feed a ByteTrack tracker with per-box Kalman prediction, which is the direct fix for the duplicate-bananas bug, and a keyframe gate decides which frames are sharp and still enough to be worth a cloud call.

**Tech Stack:** Swift 5 with the Vision framework (iOS 26.2 SDK, deployment target 17.0), react-native-vision-camera 4.7.3 frame processors, react-native-worklets-core, TypeScript, react-native-svg 15.15.4 for polygon rendering, Jest for unit tests.

## Scope Boundary

This plan is the on-device half. It ends with the app drawing a correctly shaped, stable outline around every distinct item in the cart, and emitting keyframe events. It does **no naming**.

Two consequences the implementer must not treat as bugs:

1. **The bag stays empty while scanning.** Naming, the cloud client, the counting rule, and the green, amber and occlusion states are Plan 3. Between this plan and Plan 3 the branch must not be handed to a device user as a working build.
2. **Barcodes are decoded but not resolved.** `VNDetectBarcodesRequest` runs here and attaches payload strings to tracks. The Open Food Facts lookup, and its ODbL attribution requirement, belong to Plan 3.

Deliberately deferred, with reasons:

- **The Core ML detector.** Building an untestable second detector before the harness has measured the first one is speculative work. The protocol makes it a contained addition once there is a number to act on.
- **Frame-to-frame motion registration.** `VNTrackTranslationalImageRegistrationRequest` would carry polygons between detections for a smoother overlay, but Kalman prediction plus the existing spring animations should cover it. Revisit only if the overlay reads as laggy on hardware.

## Verification already done

The Swift in Tasks 6, 7 and 8 was compiled and executed before this plan was written, not
transcribed from memory. On this machine, against the iOS 26.2 SDK:

- `swiftc` builds the test runner and the benchmark from the sources exactly as given.
- All 28 checks in the test runner pass, including the concave L-shape trace.
- The benchmark runs end to end on real images: Vision instance mask, boundary trace,
  Ramer-Douglas-Peucker simplification, normalized polygons, annotated PNG, JSON report.
- Coordinate handling is confirmed correct. A disc drawn in the visual top-left of a test image
  comes back at `x=0.13, y=0.12` in top-left-origin normalized space, and the annotated overlay
  traces the disc exactly, in 20 points.
- Detection cost on the Mac is roughly 10 to 20ms per image, and 170ms for a large photograph.
  Ranking information only. Phone timings will differ.

What this does **not** establish is the only question that matters: whether Apple's segmenter
finds the individual items in a loaded cart. Every image available for that run was an app icon
or a wallpaper. That answer needs real cart photographs and Task 8's harness.

## Global Constraints

Every task's requirements implicitly include this section.

- **No em dashes anywhere.** Not in prose, code comments, documentation, or user-facing copy. Use commas, colons, parentheses, or a rewrite.
- **No Claude or Anthropic model may be used for this feature.** The user directive is: use OpenAI or some other model, not Claude.
- **No API key may ever reach the app binary**, be logged, or appear in an error message. Nothing in this plan makes a network call, so no task should introduce one.
- **Read the exact versioned Expo documentation at https://docs.expo.dev/versions/v57.0.0/ before writing any app code.** This is a repository rule from `AGENTS.md`.
- **Native consumer iOS look**, not designer styling. Verify UI changes by screenshot.
- **iOS deployment target is 17.0.** `VNGenerateForegroundInstanceMaskRequest` requires it. The repository currently sets 16.4 in `ios/Podfile` and `ios/Kart.xcodeproj/project.pbxproj`.
- **No detector-specific type may cross into TypeScript.** Everything above the frame processor sees normalized polygons, boxes and scores, never a Vision or Core ML type.
- **The barcode fast path is gated behind `ENABLE_BARCODE_FAST_PATH`** and must be switchable off without touching the pipeline.
- **All coordinates crossing the native boundary are normalized to 0..1, origin top-left.** Vision reports origin bottom-left; convert once, at the boundary, and never again.
- Work happens on the existing `kart-recognition-service` branch. Do not merge to `main`.

## File Structure

**Created, Swift:**

| File | Responsibility |
|---|---|
| `ios/Kart/KartDetector.swift` | The `DetectedInstance` value type and the `KartDetector` protocol. No implementation. |
| `ios/Kart/MaskContour.swift` | Turns a Vision instance mask buffer into one normalized polygon per instance. Pure geometry, no Vision requests. |
| `ios/Kart/AppleInstanceMaskDetector.swift` | `KartDetector` backed by `VNGenerateForegroundInstanceMaskRequest`. |
| `ios/Kart/FrameMetrics.swift` | Sharpness and inter-frame motion from a luma plane. |

**Created, TypeScript:**

| File | Responsibility |
|---|---|
| `src/engine/liveVision/kalman.ts` | A two-state constant-velocity Kalman filter, and a four-filter box wrapper. |
| `src/engine/liveVision/assignment.ts` | Hungarian solver for the association cost matrix. |
| `src/engine/liveVision/byteTrack.ts` | Two-stage association, track lifecycle, stable track identity. |
| `src/engine/liveVision/keyframe.ts` | Decides whether the current frame is worth a cloud call. |

**Created, tooling:**

| File | Responsibility |
|---|---|
| `scripts/detector-bench/main.swift` | Runs a detector over a folder of photos, writes a JSON report and an annotated PNG per image. The instrument that picks the shipping detector. |

**Modified:**

| File | Change |
|---|---|
| `ios/Kart/KartVisionFrameProcessorPlugin.swift` | Rewritten. Saliency, classification and OCR are removed; detector, barcodes and metrics take their place. |
| `src/engine/liveVision/types.ts` | `Polygon`, `DetectedInstance`, `Track` and friends replace the label-matching types. |
| `src/engine/liveVision/geometry.ts` | Gains polygon helpers alongside the existing `intersectionOverUnion`. |
| `src/engine/liveVision/frameProcessor.ts` | New plugin return shape. |
| `src/engine/liveVision/pipeline.ts` | Wired to ByteTrack and the keyframe gate. |
| `src/components/ItemHighlights.tsx` | Renders SVG polygon paths instead of rectangles. |
| `src/app/scan.tsx` | Wired to the new pipeline. Catalog matching leaves the live path. |
| `scripts/register-xcode-file.js` | Its hardcoded file list gains the four new Swift sources. |
| `ios/Podfile`, `ios/Kart.xcodeproj/project.pbxproj` | Deployment target 16.4 to 17.0. |

**Deleted:** `src/engine/liveVision/labelCatalog.ts`, `src/engine/liveVision/labelMatcher.ts`, `src/engine/liveVision/coverageHint.ts`, `src/engine/liveVision/tracker.ts`, and their tests.

---

### Task 1: Polygon geometry

The tracker associates on boxes, which is what ByteTrack does, but every track carries a polygon that has to move with it. These are the pure helpers that make that possible.

**Files:**
- Modify: `src/engine/liveVision/types.ts`
- Modify: `src/engine/liveVision/geometry.ts`
- Test: `src/engine/liveVision/__tests__/geometry.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `type Polygon = number[]` (flat, `[x0, y0, x1, y1, ...]`, normalized 0 to 1, origin top-left)
  - `function polygonBounds(polygon: Polygon): Box`
  - `function polygonCentroid(polygon: Polygon): { x: number; y: number }`
  - `function fitPolygonToBox(polygon: Polygon, from: Box, to: Box): Polygon`
  - existing `function intersectionOverUnion(a: Box, b: Box): number` stays unchanged

- [ ] **Step 1: Write the failing test**

Append to `src/engine/liveVision/__tests__/geometry.test.ts` (keep the existing `intersectionOverUnion` tests in place):

```ts
import { fitPolygonToBox, polygonBounds, polygonCentroid } from '../geometry';
import type { Polygon } from '../types';

const SQUARE: Polygon = [0.2, 0.2, 0.4, 0.2, 0.4, 0.6, 0.2, 0.6];

describe('polygonBounds', () => {
  it('returns the tight box around the vertices', () => {
    // Per-field toBeCloseTo, not toEqual: 0.6 - 0.2 is 0.39999999999999997 in IEEE754,
    // so an exact-equality assertion on h could never pass.
    const box = polygonBounds(SQUARE);
    expect(box.x).toBeCloseTo(0.2, 6);
    expect(box.y).toBeCloseTo(0.2, 6);
    expect(box.w).toBeCloseTo(0.2, 6);
    expect(box.h).toBeCloseTo(0.4, 6);
  });

  it('returns a zero box for an empty polygon', () => {
    expect(polygonBounds([])).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });

  it('returns a zero-size box for a single point', () => {
    expect(polygonBounds([0.5, 0.5])).toEqual({ x: 0.5, y: 0.5, w: 0, h: 0 });
  });
});

describe('polygonCentroid', () => {
  it('finds the centre of a rectangle', () => {
    const c = polygonCentroid(SQUARE);
    expect(c.x).toBeCloseTo(0.3, 6);
    expect(c.y).toBeCloseTo(0.4, 6);
  });

  it('falls back to the vertex mean for a zero-area polygon', () => {
    // A degenerate line has no signed area, so the shoelace centroid is undefined.
    const c = polygonCentroid([0.2, 0.2, 0.6, 0.2]);
    expect(c.x).toBeCloseTo(0.4, 6);
    expect(c.y).toBeCloseTo(0.2, 6);
  });

  it('returns the origin for an empty polygon', () => {
    expect(polygonCentroid([])).toEqual({ x: 0, y: 0 });
  });
});

describe('fitPolygonToBox', () => {
  it('translates the polygon when the box only moves', () => {
    const from = { x: 0.2, y: 0.2, w: 0.2, h: 0.4 };
    const to = { x: 0.5, y: 0.2, w: 0.2, h: 0.4 };
    expect(fitPolygonToBox(SQUARE, from, to)).toEqual([0.5, 0.2, 0.7, 0.2, 0.7, 0.6, 0.5, 0.6]);
  });

  it('scales the polygon when the box grows', () => {
    const from = { x: 0.2, y: 0.2, w: 0.2, h: 0.4 };
    const to = { x: 0.2, y: 0.2, w: 0.4, h: 0.8 };
    const out = fitPolygonToBox(SQUARE, from, to);
    expect(out[0]).toBeCloseTo(0.2, 6);
    expect(out[2]).toBeCloseTo(0.6, 6);
    // SQUARE vertices 2 and 3 share the same source y (0.6), so out[5] and out[7] must
    // agree. sy is 2, so both land at 0.2 + (0.6 - 0.2) * 2 = 1.0.
    expect(out[5]).toBeCloseTo(1.0, 6);
    expect(out[7]).toBeCloseTo(1.0, 6);
  });

  it('translates without scaling when the source box has zero size', () => {
    // Guards the divide. A zero-size source box carries no scale information, so the only
    // sane move is to shift the polygon to the destination origin.
    const from = { x: 0.2, y: 0.2, w: 0, h: 0 };
    const to = { x: 0.5, y: 0.5, w: 0.1, h: 0.1 };
    const out = fitPolygonToBox(SQUARE, from, to);
    expect(out[0]).toBeCloseTo(0.5, 6);
    expect(out[1]).toBeCloseTo(0.5, 6);
  });

  it('returns an empty polygon unchanged', () => {
    expect(fitPolygonToBox([], { x: 0, y: 0, w: 1, h: 1 }, { x: 0, y: 0, w: 2, h: 2 })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/engine/liveVision/__tests__/geometry.test.ts`
Expected: FAIL, `fitPolygonToBox` is not exported from `../geometry`.

- [ ] **Step 3: Add the Polygon type**

Add to `src/engine/liveVision/types.ts`, directly under the existing `Box` interface:

```ts
/**
 * A closed outline, flat as `[x0, y0, x1, y1, ...]`, normalized to the frame with origin
 * top-left. Flat rather than an array of points because this crosses the JSI boundary on
 * every detection, where one contiguous number array is markedly cheaper than N objects.
 */
export type Polygon = number[];
```

- [ ] **Step 4: Implement the helpers**

In `src/engine/liveVision/geometry.ts`, widen the existing import at the top of the file from `import type { Box } from './types';` to:

```ts
import type { Box, Polygon } from './types';
```

then append:

```ts
export function polygonBounds(polygon: Polygon): Box {
  if (polygon.length < 2) return { x: 0, y: 0, w: 0, h: 0 };

  let minX = polygon[0];
  let maxX = polygon[0];
  let minY = polygon[1];
  let maxY = polygon[1];

  for (let i = 2; i < polygon.length - 1; i += 2) {
    const x = polygon[i];
    const y = polygon[i + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function polygonCentroid(polygon: Polygon): { x: number; y: number } {
  const n = Math.floor(polygon.length / 2);
  if (n === 0) return { x: 0, y: 0 };

  // Shoelace centroid. Correct for any simple polygon, but undefined when the signed area is
  // zero (a point, a line, or a self-cancelling outline), so fall through to the vertex mean.
  let twiceArea = 0;
  let cx = 0;
  let cy = 0;

  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;
    const x0 = polygon[i * 2];
    const y0 = polygon[i * 2 + 1];
    const x1 = polygon[j * 2];
    const y1 = polygon[j * 2 + 1];
    const cross = x0 * y1 - x1 * y0;
    twiceArea += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }

  if (twiceArea !== 0) {
    const scale = 1 / (3 * twiceArea);
    return { x: cx * scale, y: cy * scale };
  }

  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i += 1) {
    sumX += polygon[i * 2];
    sumY += polygon[i * 2 + 1];
  }
  return { x: sumX / n, y: sumY / n };
}

/**
 * Moves a polygon so that the box it was captured in maps onto a new box.
 *
 * Used when the tracker predicts where an item went between detections: the Kalman filter
 * gives a new box, and the polygon has to follow it so the tinted silhouette does not lag
 * behind the item it belongs to.
 */
export function fitPolygonToBox(polygon: Polygon, from: Box, to: Box): Polygon {
  if (polygon.length < 2) return [];

  const sx = from.w === 0 ? 1 : to.w / from.w;
  const sy = from.h === 0 ? 1 : to.h / from.h;
  const out = new Array<number>(polygon.length);

  for (let i = 0; i < polygon.length - 1; i += 2) {
    out[i] = to.x + (polygon[i] - from.x) * sx;
    out[i + 1] = to.y + (polygon[i + 1] - from.y) * sy;
  }

  return out;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest src/engine/liveVision/__tests__/geometry.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/engine/liveVision/geometry.ts src/engine/liveVision/types.ts src/engine/liveVision/__tests__/geometry.test.ts
git commit -m "feat: add polygon geometry helpers for tracked item shapes"
```

---

### Task 2: Kalman filter for boxes

Detection boxes jitter frame to frame. Unsmoothed jitter is what breaks IoU association, and broken association is what turns one bunch of bananas into three. This is the smoothing layer.

**Files:**
- Create: `src/engine/liveVision/kalman.ts`
- Test: `src/engine/liveVision/__tests__/kalman.test.ts`

**Interfaces:**
- Consumes: `Box` from `./types`.
- Produces:
  - `function createBoxFilter(box: Box): BoxFilter`
  - `function predictBox(filter: BoxFilter): BoxFilter`
  - `function updateBox(filter: BoxFilter, measurement: Box): BoxFilter`
  - `function filterToBox(filter: BoxFilter): Box`
  - `type BoxFilter = { cx: Scalar1D; cy: Scalar1D; w: Scalar1D; h: Scalar1D }`
  - `type Scalar1D = { x: number; v: number; p00: number; p01: number; p10: number; p11: number }`

All four functions are pure: they return a new filter rather than mutating.

- [ ] **Step 1: Write the failing test**

Create `src/engine/liveVision/__tests__/kalman.test.ts`:

```ts
import { createBoxFilter, filterToBox, predictBox, updateBox } from '../kalman';
import type { Box } from '../types';

const START: Box = { x: 0.2, y: 0.2, w: 0.1, h: 0.1 };

describe('createBoxFilter', () => {
  it('starts centred on the seed box with no velocity', () => {
    const f = createBoxFilter(START);
    expect(filterToBox(f)).toEqual(START);
    expect(f.cx.v).toBe(0);
    expect(f.cy.v).toBe(0);
  });
});

describe('predictBox', () => {
  it('leaves a stationary filter where it is', () => {
    const f = predictBox(createBoxFilter(START));
    expect(filterToBox(f).x).toBeCloseTo(START.x, 6);
    expect(filterToBox(f).y).toBeCloseTo(START.y, 6);
  });

  it('grows positional uncertainty when there is no measurement', () => {
    const f = createBoxFilter(START);
    const p = predictBox(f);
    expect(p.cx.p00).toBeGreaterThan(f.cx.p00);
  });
});

describe('updateBox', () => {
  it('converges on a stationary measurement', () => {
    let f = createBoxFilter(START);
    for (let i = 0; i < 20; i += 1) {
      f = updateBox(predictBox(f), START);
    }
    const out = filterToBox(f);
    expect(out.x).toBeCloseTo(START.x, 4);
    expect(out.y).toBeCloseTo(START.y, 4);
    expect(out.w).toBeCloseTo(START.w, 4);
    expect(out.h).toBeCloseTo(START.h, 4);
  });

  it('learns constant velocity and predicts one step ahead', () => {
    // Walk a box right by a fixed step per frame, then predict without measuring. A filter
    // that has learned the velocity lands near the next true position; one that has not
    // stays put at the last observation.
    const step = 0.02;
    let f = createBoxFilter(START);
    let truth = START.x;
    for (let i = 0; i < 25; i += 1) {
      truth += step;
      f = updateBox(predictBox(f), { ...START, x: truth });
    }
    const predicted = filterToBox(predictBox(f)).x;
    expect(predicted).toBeGreaterThan(truth + step * 0.6);
    expect(predicted).toBeLessThan(truth + step * 1.4);
  });

  it('smooths measurement jitter rather than following it exactly', () => {
    // The regression this filter exists for: alternating noisy observations of a still object
    // must not make the tracked box bounce, because bouncing boxes break IoU association.
    let f = createBoxFilter(START);
    const jitter = [0.01, -0.01];
    for (let i = 0; i < 30; i += 1) {
      f = updateBox(predictBox(f), { ...START, x: START.x + jitter[i % 2] });
    }
    const settled = filterToBox(f).x;
    expect(Math.abs(settled - START.x)).toBeLessThan(0.006);
  });

  it('keeps width and height positive under a shrinking measurement', () => {
    let f = createBoxFilter(START);
    for (let i = 0; i < 10; i += 1) {
      f = updateBox(predictBox(f), { ...START, w: 0.001, h: 0.001 });
    }
    const out = filterToBox(f);
    expect(out.w).toBeGreaterThan(0);
    expect(out.h).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/engine/liveVision/__tests__/kalman.test.ts`
Expected: FAIL, cannot resolve `../kalman`.

- [ ] **Step 3: Implement the filter**

Create `src/engine/liveVision/kalman.ts`:

```ts
import type { Box } from './types';

/**
 * One constant-velocity Kalman filter over a single scalar, holding the estimate `x`, its
 * velocity `v`, and the 2x2 covariance `p`.
 */
export interface Scalar1D {
  x: number;
  v: number;
  p00: number;
  p01: number;
  p10: number;
  p11: number;
}

export interface BoxFilter {
  cx: Scalar1D;
  cy: Scalar1D;
  w: Scalar1D;
  h: Scalar1D;
}

/**
 * The textbook SORT tracker uses one seven-dimensional filter over centre, area, aspect and
 * their velocities. With diagonal process and measurement noise, and no coupling between
 * dimensions beyond each position-velocity pair, that filter decomposes exactly into four
 * independent two-state filters. Same estimates, a tenth of the code, and no matrix library.
 */
const POSITION_PROCESS_NOISE = 1e-5;
const VELOCITY_PROCESS_NOISE = 1e-6;
const POSITION_MEASUREMENT_NOISE = 1e-3;
const SIZE_MEASUREMENT_NOISE = 4e-3;
const INITIAL_POSITION_VARIANCE = 1e-2;
const INITIAL_VELOCITY_VARIANCE = 1e-1;

/** Keeps a filtered dimension from collapsing to zero or negative width. */
const MIN_EXTENT = 1e-4;

function seed(x: number): Scalar1D {
  return {
    x,
    v: 0,
    p00: INITIAL_POSITION_VARIANCE,
    p01: 0,
    p10: 0,
    p11: INITIAL_VELOCITY_VARIANCE,
  };
}

/** One time step of `x' = x + v`, `v' = v`, with the covariance pushed through F P Fᵀ + Q. */
function predict1D(s: Scalar1D): Scalar1D {
  const p00 = s.p00 + s.p01 + s.p10 + s.p11 + POSITION_PROCESS_NOISE;
  const p01 = s.p01 + s.p11;
  const p10 = s.p10 + s.p11;
  const p11 = s.p11 + VELOCITY_PROCESS_NOISE;
  return { x: s.x + s.v, v: s.v, p00, p01, p10, p11 };
}

/** Standard scalar Kalman update against a direct observation of `x`. */
function update1D(s: Scalar1D, z: number, r: number): Scalar1D {
  const innovation = z - s.x;
  const innovationVariance = s.p00 + r;
  if (innovationVariance === 0) return s;

  const k0 = s.p00 / innovationVariance;
  const k1 = s.p10 / innovationVariance;

  return {
    x: s.x + k0 * innovation,
    v: s.v + k1 * innovation,
    p00: s.p00 - k0 * s.p00,
    p01: s.p01 - k0 * s.p01,
    p10: s.p10 - k1 * s.p00,
    p11: s.p11 - k1 * s.p01,
  };
}

export function createBoxFilter(box: Box): BoxFilter {
  return {
    cx: seed(box.x + box.w / 2),
    cy: seed(box.y + box.h / 2),
    w: seed(box.w),
    h: seed(box.h),
  };
}

export function predictBox(filter: BoxFilter): BoxFilter {
  return {
    cx: predict1D(filter.cx),
    cy: predict1D(filter.cy),
    w: predict1D(filter.w),
    h: predict1D(filter.h),
  };
}

export function updateBox(filter: BoxFilter, measurement: Box): BoxFilter {
  return {
    cx: update1D(filter.cx, measurement.x + measurement.w / 2, POSITION_MEASUREMENT_NOISE),
    cy: update1D(filter.cy, measurement.y + measurement.h / 2, POSITION_MEASUREMENT_NOISE),
    w: update1D(filter.w, measurement.w, SIZE_MEASUREMENT_NOISE),
    h: update1D(filter.h, measurement.h, SIZE_MEASUREMENT_NOISE),
  };
}

export function filterToBox(filter: BoxFilter): Box {
  const w = Math.max(MIN_EXTENT, filter.w.x);
  const h = Math.max(MIN_EXTENT, filter.h.x);
  return { x: filter.cx.x - w / 2, y: filter.cy.x - h / 2, w, h };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest src/engine/liveVision/__tests__/kalman.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/liveVision/kalman.ts src/engine/liveVision/__tests__/kalman.test.ts
git commit -m "feat: add constant-velocity Kalman filter for detection boxes"
```

---

### Task 3: Hungarian assignment

ByteTrack matches tracks to detections by solving a linear assignment problem. Greedy nearest-match is the usual shortcut and it drops matches whenever two tracks contend for the same detection, which is exactly the situation a crowded cart produces.

**Files:**
- Create: `src/engine/liveVision/assignment.ts`
- Test: `src/engine/liveVision/__tests__/assignment.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `function solveAssignment(cost: number[][]): [number, number][]` returning `[rowIndex, columnIndex]` pairs of minimum total cost. Handles rectangular matrices in either orientation and returns at most `min(rows, cols)` pairs.

- [ ] **Step 1: Write the failing test**

Create `src/engine/liveVision/__tests__/assignment.test.ts`:

```ts
import { solveAssignment } from '../assignment';

function totalCost(cost: number[][], pairs: [number, number][]): number {
  return pairs.reduce((sum, [r, c]) => sum + cost[r][c], 0);
}

describe('solveAssignment', () => {
  it('returns no pairs for an empty matrix', () => {
    expect(solveAssignment([])).toEqual([]);
    expect(solveAssignment([[]])).toEqual([]);
  });

  it('picks the only cell of a one by one matrix', () => {
    expect(solveAssignment([[5]])).toEqual([[0, 0]]);
  });

  it('finds the optimum where greedy would not', () => {
    // Greedy grabs the global minimum, 1 at (0,0), which strands row 1 on 100 for a total of
    // 101. The optimum pairs 2 with 2 for a total of 4. This is the crowded-cart case: two
    // tracks contending for the same detection.
    const cost = [
      [1, 2],
      [2, 100],
    ];
    const pairs = solveAssignment(cost);
    expect(pairs).toHaveLength(2);
    expect(totalCost(cost, pairs)).toBe(4);
  });

  it('solves the classic three by three case optimally', () => {
    const cost = [
      [4, 1, 3],
      [2, 0, 5],
      [3, 2, 2],
    ];
    const pairs = solveAssignment(cost);
    expect(pairs).toHaveLength(3);
    expect(totalCost(cost, pairs)).toBe(5);
  });

  it('assigns every row when there are more columns than rows', () => {
    const cost = [
      [9, 1, 9, 9],
      [9, 9, 2, 9],
    ];
    const pairs = solveAssignment(cost);
    expect(pairs).toHaveLength(2);
    expect(totalCost(cost, pairs)).toBe(3);
    expect(new Set(pairs.map(([, c]) => c)).size).toBe(2);
  });

  it('assigns every column when there are more rows than columns', () => {
    const cost = [
      [9, 9],
      [1, 9],
      [9, 2],
    ];
    const pairs = solveAssignment(cost);
    expect(pairs).toHaveLength(2);
    expect(totalCost(cost, pairs)).toBe(3);
    expect(new Set(pairs.map(([r]) => r)).size).toBe(2);
  });

  it('never assigns a row or a column twice', () => {
    const cost = [
      [3, 3, 3],
      [3, 3, 3],
      [3, 3, 3],
    ];
    const pairs = solveAssignment(cost);
    expect(pairs).toHaveLength(3);
    expect(new Set(pairs.map(([r]) => r)).size).toBe(3);
    expect(new Set(pairs.map(([, c]) => c)).size).toBe(3);
  });

  it('handles negative costs', () => {
    const cost = [
      [-5, 0],
      [0, -3],
    ];
    expect(totalCost(cost, solveAssignment(cost))).toBe(-8);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/engine/liveVision/__tests__/assignment.test.ts`
Expected: FAIL, cannot resolve `../assignment`.

- [ ] **Step 3: Implement the solver**

Create `src/engine/liveVision/assignment.ts`:

```ts
/**
 * Hungarian algorithm, shortest-augmenting-path form with dual potentials, O(n^2 m).
 *
 * Returns the set of `[row, column]` pairs whose costs sum to the minimum possible total.
 * Rectangular input is handled by padding to a square with zeros and discarding any pair
 * that lands on padding, which is valid because padded cells are identical in every column.
 */
export function solveAssignment(cost: number[][]): [number, number][] {
  const rows = cost.length;
  const cols = rows === 0 ? 0 : cost[0].length;
  if (rows === 0 || cols === 0) return [];

  const size = Math.max(rows, cols);
  const padded: number[][] = [];
  for (let i = 0; i < size; i += 1) {
    const row = new Array<number>(size).fill(0);
    if (i < rows) {
      for (let j = 0; j < cols; j += 1) row[j] = cost[i][j];
    }
    padded.push(row);
  }

  // One-based working arrays: index 0 is the algorithm's virtual starting column.
  const u = new Array<number>(size + 1).fill(0);
  const v = new Array<number>(size + 1).fill(0);
  const columnRow = new Array<number>(size + 1).fill(0);
  const way = new Array<number>(size + 1).fill(0);

  for (let i = 1; i <= size; i += 1) {
    columnRow[0] = i;
    let j0 = 0;
    const minv = new Array<number>(size + 1).fill(Infinity);
    const used = new Array<boolean>(size + 1).fill(false);

    do {
      used[j0] = true;
      const i0 = columnRow[j0];
      let delta = Infinity;
      let j1 = 0;

      for (let j = 1; j <= size; j += 1) {
        if (used[j]) continue;
        const cur = padded[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }

      for (let j = 0; j <= size; j += 1) {
        if (used[j]) {
          u[columnRow[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }

      j0 = j1;
    } while (columnRow[j0] !== 0);

    do {
      const j1 = way[j0];
      columnRow[j0] = columnRow[j1];
      j0 = j1;
    } while (j0 !== 0);
  }

  const pairs: [number, number][] = [];
  for (let j = 1; j <= size; j += 1) {
    const i = columnRow[j] - 1;
    if (i >= 0 && i < rows && j - 1 < cols) pairs.push([i, j - 1]);
  }
  return pairs.sort((a, b) => a[0] - b[0]);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest src/engine/liveVision/__tests__/assignment.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/liveVision/assignment.ts src/engine/liveVision/__tests__/assignment.test.ts
git commit -m "feat: add Hungarian solver for track to detection assignment"
```

---

### Task 4: ByteTrack tracker

The heart of the plan. One physical item must map to exactly one track that survives jitter, brief occlusion and a low-confidence frame, because in Plan 3 the number of tracks carrying an identity **is** the quantity. The existing greedy-IoU matcher in `tracker.ts` is what produced three bunches of bananas from one, and it is deleted here.

**Files:**
- Create: `src/engine/liveVision/byteTrack.ts`
- Modify: `src/engine/liveVision/types.ts`
- Test: `src/engine/liveVision/__tests__/byteTrack.test.ts`

**Interfaces:**
- Consumes: `intersectionOverUnion`, `fitPolygonToBox`, `polygonBounds` from `./geometry`; `createBoxFilter`, `predictBox`, `updateBox`, `filterToBox`, `type BoxFilter` from `./kalman`; `solveAssignment` from `./assignment`; `Box`, `Polygon` from `./types`.
- Produces:
  - `interface DetectedInstance { box: Box; polygon: Polygon; score: number }`
  - `type TrackState = 'tentative' | 'confirmed' | 'lost'`
  - `interface Track { id: string; box: Box; polygon: Polygon; score: number; state: TrackState; hits: number; lastSeenAt: number; barcode: string | null; filter: BoxFilter }`
  - `interface TrackerState { tracks: Track[]; nextId: number }`
  - `interface ByteTrackConfig { highThreshold: number; lowThreshold: number; minIou: number; maxLostMs: number; minHits: number }`
  - `function createTrackerState(): TrackerState`
  - `function updateTracks(state: TrackerState, detections: DetectedInstance[], now: number, overrides?: Partial<ByteTrackConfig>): TrackerState`

`nextId` lives in the state, not in a module-level counter. The counter in the old `tracker.ts` made every test order-dependent and leaked ids between scans.

- [ ] **Step 1: Write the failing test**

Create `src/engine/liveVision/__tests__/byteTrack.test.ts`:

```ts
import { createTrackerState, updateTracks } from '../byteTrack';
import type { DetectedInstance, TrackerState } from '../types';

function boxAt(x: number, y: number, size = 0.1): DetectedInstance['box'] {
  return { x, y, w: size, h: size };
}

function detection(x: number, y: number, score = 0.9, size = 0.1): DetectedInstance {
  const box = boxAt(x, y, size);
  return {
    box,
    polygon: [box.x, box.y, box.x + box.w, box.y, box.x + box.w, box.y + box.h, box.x, box.y + box.h],
    score,
  };
}

/** Drive the tracker for `frames` steps, 300ms apart, with detections from `at`. */
function run(
  state: TrackerState,
  frames: number,
  at: (frame: number) => DetectedInstance[],
  startAt = 1000,
): { state: TrackerState; now: number } {
  let now = startAt;
  let s = state;
  for (let i = 0; i < frames; i += 1) {
    s = updateTracks(s, at(i), now);
    now += 300;
  }
  return { state: s, now };
}

describe('updateTracks', () => {
  it('creates a track for a high-confidence detection', () => {
    const s = updateTracks(createTrackerState(), [detection(0.2, 0.2)], 1000);
    expect(s.tracks).toHaveLength(1);
    expect(s.tracks[0].state).toBe('tentative');
  });

  it('does not start a track from a low-confidence detection alone', () => {
    // ByteTrack's defining rule: low-score boxes may recover an existing track, never seed one.
    const s = updateTracks(createTrackerState(), [detection(0.2, 0.2, 0.2)], 1000);
    expect(s.tracks).toHaveLength(0);
  });

  it('ignores detections below the low threshold entirely', () => {
    const s = updateTracks(createTrackerState(), [detection(0.2, 0.2, 0.01)], 1000);
    expect(s.tracks).toHaveLength(0);
  });

  it('promotes a track to confirmed after minHits', () => {
    const { state } = run(createTrackerState(), 4, () => [detection(0.2, 0.2)]);
    expect(state.tracks).toHaveLength(1);
    expect(state.tracks[0].state).toBe('confirmed');
  });

  it('holds one identity for one jittery object', () => {
    // The duplicate-bananas regression. One bunch of bananas, detection boxes wobbling by a
    // few percent per frame, must stay exactly one track with one unchanging id. The old
    // greedy matcher dropped association on the wobble and minted a new candidate each time,
    // and Plan 3 counts quantity by counting tracks, so every spurious track is a phantom item.
    const wobble = [0, 0.012, -0.009, 0.015, -0.013, 0.006, -0.004];
    const { state } = run(createTrackerState(), 30, (i) =>
      [detection(0.4 + wobble[i % wobble.length], 0.4 + wobble[(i + 3) % wobble.length])],
    );
    expect(state.tracks).toHaveLength(1);
    expect(state.tracks[0].id).toBe('track_1');
    expect(state.tracks[0].hits).toBe(30);
  });

  it('recovers a track from a low-confidence detection', () => {
    // Second-stage association. A confirmed item that dims below the high threshold for a
    // frame keeps its identity instead of dying and being reborn with a new id.
    let { state } = run(createTrackerState(), 4, () => [detection(0.3, 0.3)]);
    const id = state.tracks[0].id;
    state = updateTracks(state, [detection(0.3, 0.3, 0.2)], 2200);
    expect(state.tracks).toHaveLength(1);
    expect(state.tracks[0].id).toBe(id);
    expect(state.tracks[0].state).toBe('confirmed');
  });

  it('keeps a vanished track alive briefly, then drops it', () => {
    let { state, now } = run(createTrackerState(), 4, () => [detection(0.3, 0.3)]);
    state = updateTracks(state, [], now);
    expect(state.tracks).toHaveLength(1);
    expect(state.tracks[0].state).toBe('lost');

    state = updateTracks(state, [], now + 5000);
    expect(state.tracks).toHaveLength(0);
  });

  it('resumes the same identity when an occluded item reappears', () => {
    let { state, now } = run(createTrackerState(), 4, () => [detection(0.3, 0.3)]);
    const id = state.tracks[0].id;
    state = updateTracks(state, [], now);
    state = updateTracks(state, [detection(0.3, 0.3)], now + 400);
    expect(state.tracks).toHaveLength(1);
    expect(state.tracks[0].id).toBe(id);
    expect(state.tracks[0].state).toBe('confirmed');
  });

  it('drops a tentative track the moment it misses', () => {
    // An unconfirmed track is more likely to be a detector artefact than a real item, so it
    // does not get the grace period a confirmed track gets.
    let state = updateTracks(createTrackerState(), [detection(0.3, 0.3)], 1000);
    state = updateTracks(state, [], 1300);
    expect(state.tracks).toHaveLength(0);
  });

  it('keeps two neighbouring items apart without swapping identities', () => {
    // Two items tracked side by side over 8 frames, drifting at the same rate. This confirms
    // ids stay attached to their own item and neither track absorbs the other's detection.
    // Note it does NOT discriminate the assignment solver from greedy matching, because each
    // track's own detection is unambiguously its best here. The test below does.
    const { state } = run(createTrackerState(), 8, (i) => [
      detection(0.30 + i * 0.005, 0.4),
      detection(0.38 + i * 0.005, 0.4),
    ]);
    expect(state.tracks).toHaveLength(2);
    const sorted = [...state.tracks].sort((a, b) => a.box.x - b.box.x);
    expect(sorted[0].id).toBe('track_1');
    expect(sorted[1].id).toBe('track_2');
    expect(sorted[0].box.x).toBeLessThan(sorted[1].box.x);
  });

  it('resolves a genuine assignment conflict without swapping identities', () => {
    // A scenario that actually discriminates the Hungarian solver from a greedy per-track
    // matcher, verified against a greedy substitute in a throwaway scratch script (not
    // committed): two confirmed tracks sit close together, then the left item jumps far away
    // in the same frame the right item barely moves. Now both tracks want the right-hand
    // detection. The solver picks the globally cheaper total assignment: track_2 (already
    // closer) keeps the right-hand item, track_1 gets nothing within minIou and goes lost,
    // and a new track seeds at the jumped position. A greedy matcher, which lets track_1
    // claim its locally-best option first, instead steals the right-hand item out from under
    // track_2, an identity swap this tracker exists to prevent.
    let { state, now } = run(createTrackerState(), 3, () => [
      detection(0.44, 0.4),
      detection(0.49, 0.4),
    ]);
    expect(state.tracks.every((t) => t.state === 'confirmed')).toBe(true);

    state = updateTracks(state, [detection(0.2, 0.4), detection(0.5, 0.4)], now);

    const track1 = state.tracks.find((t) => t.id === 'track_1');
    const track2 = state.tracks.find((t) => t.id === 'track_2');
    const track3 = state.tracks.find((t) => t.id === 'track_3');

    expect(state.tracks).toHaveLength(3);
    expect(track2?.state).toBe('confirmed');
    expect(track2?.box.x).toBeCloseTo(0.5, 1);
    expect(track1?.state).toBe('lost');
    expect(track1?.box.x).toBeCloseTo(0.44, 1);
    expect(track3?.state).toBe('tentative');
    expect(track3?.box.x).toBeCloseTo(0.2, 1);
  });

  it('does not let low-score detections promote a tentative track to confirmed', () => {
    // A tentative track is one hit old and unproven, more likely a detector artefact (a
    // shadow, a fold in a bag) than a real item. It must not get the second-stage recovery
    // that a confirmed track gets: two low-score hits in the same spot must never be enough,
    // on their own, to build hits toward confirmation and mint a phantom item downstream.
    let state = updateTracks(createTrackerState(), [detection(0.3, 0.3)], 1000);
    expect(state.tracks).toHaveLength(1);
    expect(state.tracks[0].state).toBe('tentative');

    // Excluded from second-stage recovery, the tentative track counts this as a miss like
    // any other, and a tentative track is dropped the moment it misses (see the dedicated
    // test below), so it does not linger either. Either way it never reaches 'confirmed'.
    state = updateTracks(state, [detection(0.3, 0.3, 0.15)], 1300);
    state = updateTracks(state, [detection(0.3, 0.3, 0.15)], 1600);
    expect(state.tracks.some((t) => t.state === 'confirmed')).toBe(false);
    expect(state.tracks).toHaveLength(0);
  });

  it('starts a second track when a genuinely new item appears', () => {
    let { state, now } = run(createTrackerState(), 4, () => [detection(0.2, 0.2)]);
    state = updateTracks(state, [detection(0.2, 0.2), detection(0.7, 0.7)], now);
    expect(state.tracks).toHaveLength(2);
    expect(new Set(state.tracks.map((t) => t.id)).size).toBe(2);
  });

  it('carries the polygon onto the filtered box', () => {
    const { state } = run(createTrackerState(), 6, () => [detection(0.4, 0.4)]);
    const track = state.tracks[0];
    const xs = track.polygon.filter((_, i) => i % 2 === 0);
    const ys = track.polygon.filter((_, i) => i % 2 === 1);
    expect(Math.min(...xs)).toBeCloseTo(track.box.x, 5);
    expect(Math.min(...ys)).toBeCloseTo(track.box.y, 5);
    expect(Math.max(...xs)).toBeCloseTo(track.box.x + track.box.w, 5);
  });

  it('does not mutate the state it was given', () => {
    const initial = updateTracks(createTrackerState(), [detection(0.2, 0.2)], 1000);
    const snapshot = JSON.stringify(initial);
    updateTracks(initial, [detection(0.5, 0.5)], 1300);
    expect(JSON.stringify(initial)).toBe(snapshot);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/engine/liveVision/__tests__/byteTrack.test.ts`
Expected: FAIL, cannot resolve `../byteTrack`.

- [ ] **Step 3: Add the tracking types**

Replace the contents of `src/engine/liveVision/types.ts` below the `Box` interface and the `Polygon` type from Task 1 with these. Delete `MatchResult`, `CandidateState`, `TrackedCandidate`, `TrackerConfig`, `MatchedRegion`, `TrackerEvent`, `LabelCandidate`, `RawRegion` and `PipelineState`; they belong to the label-matching design being removed.

```ts
import type { BoxFilter } from './kalman';

/** One class-agnostic instance from the detector. The detector never names anything. */
export interface DetectedInstance {
  box: Box;
  polygon: Polygon;
  /** Detector confidence that this region is a distinct object, 0 to 1. Not a class score. */
  score: number;
}

export type TrackState = 'tentative' | 'confirmed' | 'lost';

/**
 * One physical item, followed across frames. The id is the unit of quantity in Plan 3, so it
 * must be stable for as long as the item is the same item, and never reused.
 */
export interface Track {
  id: string;
  box: Box;
  polygon: Polygon;
  score: number;
  state: TrackState;
  hits: number;
  lastSeenAt: number;
  /** Decoded UPC if the barcode fast path saw one over this track. Resolved in Plan 3. */
  barcode: string | null;
  filter: BoxFilter;
}

export interface TrackerState {
  tracks: Track[];
  nextId: number;
}

export interface ByteTrackConfig {
  /** At or above this score a detection can both match and seed a track. */
  highThreshold: number;
  /** Below this score a detection is discarded outright. */
  lowThreshold: number;
  /** Minimum IoU for a track and a detection to be allowed to pair. */
  minIou: number;
  /** How long a confirmed track survives with no detection before it is removed. */
  maxLostMs: number;
  /** Detections needed before a track is trusted enough to be confirmed. */
  minHits: number;
}
```

- [ ] **Step 4: Implement the tracker**

Create `src/engine/liveVision/byteTrack.ts`:

```ts
import { solveAssignment } from './assignment';
import { fitPolygonToBox, intersectionOverUnion } from './geometry';
import { createBoxFilter, filterToBox, predictBox, updateBox } from './kalman';
import type { ByteTrackConfig, DetectedInstance, Track, TrackerState } from './types';

const DEFAULT_CONFIG: ByteTrackConfig = {
  highThreshold: 0.5,
  lowThreshold: 0.1,
  minIou: 0.2,
  maxLostMs: 2000,
  minHits: 3,
};

export function createTrackerState(): TrackerState {
  return { tracks: [], nextId: 1 };
}

/**
 * Solves one association round and returns the accepted pairs.
 *
 * Cost is `1 - IoU`, and any pair whose IoU falls below `minIou` is rejected after the solve
 * rather than before it. Rejecting first would change the problem the solver sees and can
 * strand a pairing that was only optimal in combination with another.
 */
function associate(
  tracks: Track[],
  detections: DetectedInstance[],
  minIou: number,
): [number, number][] {
  if (tracks.length === 0 || detections.length === 0) return [];

  const cost = tracks.map((track) =>
    detections.map((detection) => 1 - intersectionOverUnion(track.box, detection.box)),
  );

  return solveAssignment(cost).filter(([t, d]) => cost[t][d] <= 1 - minIou);
}

function applyDetection(track: Track, detection: DetectedInstance, now: number, config: ByteTrackConfig): Track {
  const filter = updateBox(track.filter, detection.box);
  const box = filterToBox(filter);
  const hits = track.hits + 1;

  return {
    ...track,
    filter,
    box,
    // The polygon arrives in the raw detection's frame of reference. Move it onto the filtered
    // box so the tinted silhouette sits where the smoothed item is, not where the noisy
    // measurement was.
    polygon: fitPolygonToBox(detection.polygon, detection.box, box),
    score: detection.score,
    hits,
    lastSeenAt: now,
    state: track.state === 'lost' || hits >= config.minHits ? 'confirmed' : 'tentative',
  };
}

export function updateTracks(
  state: TrackerState,
  detections: DetectedInstance[],
  now: number,
  overrides: Partial<ByteTrackConfig> = {},
): TrackerState {
  const config = { ...DEFAULT_CONFIG, ...overrides };

  const high: DetectedInstance[] = [];
  const low: DetectedInstance[] = [];
  for (const detection of detections) {
    if (detection.score >= config.highThreshold) high.push(detection);
    else if (detection.score >= config.lowThreshold) low.push(detection);
  }

  // Predict every track forward before matching, so association compares this frame's
  // detections against where each item is expected to be, not where it last was.
  const predicted = state.tracks.map((track) => {
    const filter = predictBox(track.filter);
    const box = filterToBox(filter);
    return { ...track, filter, box, polygon: fitPolygonToBox(track.polygon, track.box, box) };
  });

  const next: Track[] = [];
  const matchedTracks = new Set<number>();
  const matchedHigh = new Set<number>();

  // Stage one: every track competes for the confident detections.
  for (const [t, d] of associate(predicted, high, config.minIou)) {
    next.push(applyDetection(predicted[t], high[d], now, config));
    matchedTracks.add(t);
    matchedHigh.add(d);
  }

  // Stage two: tracks that found nothing get a second chance against the faint detections.
  // This is the whole point of ByteTrack. An item that dims for a frame keeps its identity.
  const leftoverTracks: number[] = [];
  for (let t = 0; t < predicted.length; t += 1) {
    if (!matchedTracks.has(t)) leftoverTracks.push(t);
  }

  // Only confirmed and lost tracks get the low-score second chance. A tentative track is
  // more likely a detector artefact, and letting faint detections recover it would let noise
  // promote it to confirmed, which everything downstream counts as a real item.
  const recoverable = leftoverTracks.filter((t) => predicted[t].state !== 'tentative');

  const recovered = associate(
    recoverable.map((t) => predicted[t]),
    low,
    config.minIou,
  );
  const recoveredTracks = new Set<number>();
  for (const [i, d] of recovered) {
    const t = recoverable[i];
    next.push(applyDetection(predicted[t], low[d], now, config));
    recoveredTracks.add(t);
  }

  // Tracks that matched nothing at all. A confirmed track gets a grace period, because real
  // items get buried and resurface. A tentative one is more likely a detector artefact.
  for (const t of leftoverTracks) {
    if (recoveredTracks.has(t)) continue;
    const track = predicted[t];
    if (track.state === 'tentative') continue;
    if (now - track.lastSeenAt > config.maxLostMs) continue;
    next.push({ ...track, state: 'lost' });
  }

  // Confident detections nobody claimed become new items.
  let nextId = state.nextId;
  for (let d = 0; d < high.length; d += 1) {
    if (matchedHigh.has(d)) continue;
    const detection = high[d];
    const filter = createBoxFilter(detection.box);
    next.push({
      id: `track_${nextId}`,
      box: filterToBox(filter),
      polygon: detection.polygon,
      score: detection.score,
      state: config.minHits <= 1 ? 'confirmed' : 'tentative',
      hits: 1,
      lastSeenAt: now,
      barcode: null,
      filter,
    });
    nextId += 1;
  }

  return { tracks: next, nextId };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest src/engine/liveVision/__tests__/byteTrack.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/engine/liveVision/byteTrack.ts src/engine/liveVision/types.ts src/engine/liveVision/__tests__/byteTrack.test.ts
git commit -m "feat: add ByteTrack tracker with Kalman prediction and two-stage association"
```

---

### Task 5: Keyframe gate

Blurry frames are both the most common and the most expensive to get wrong, so the cheapest accuracy win available is refusing to upload them. This decides which frames Plan 3 will send.

**Files:**
- Create: `src/engine/liveVision/keyframe.ts`
- Test: `src/engine/liveVision/__tests__/keyframe.test.ts`
- Delete: `src/engine/liveVision/coverageHint.ts`, `src/engine/liveVision/__tests__/coverageHint.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface KeyframeSignals { sharpness: number; motion: number; trackCount: number; now: number }`
  - `interface KeyframeState { lastFiredAt: number; lastTrackCount: number }`
  - `type KeyframeReason = 'fire' | 'blurry' | 'moving' | 'too-soon' | 'nothing-to-see'`
  - `interface KeyframeConfig { minSharpness: number; maxMotion: number; minIntervalMs: number; sceneChangeCount: number; sceneChangeIntervalMs: number }`
  - `function createKeyframeState(): KeyframeState`
  - `function evaluateKeyframe(state: KeyframeState, signals: KeyframeSignals, overrides?: Partial<KeyframeConfig>): { fire: boolean; reason: KeyframeReason; state: KeyframeState }`

`reason` is returned rather than a bare boolean so a gate that never opens on real hardware can be diagnosed from a log instead of guesswork.

- [ ] **Step 1: Write the failing test**

Create `src/engine/liveVision/__tests__/keyframe.test.ts`:

```ts
import { createKeyframeState, evaluateKeyframe } from '../keyframe';
import type { KeyframeSignals } from '../types';

const GOOD: KeyframeSignals = { sharpness: 400, motion: 0.004, trackCount: 6, now: 10_000 };

describe('evaluateKeyframe', () => {
  it('fires on the first sharp, still frame with something in view', () => {
    const r = evaluateKeyframe(createKeyframeState(), GOOD);
    expect(r.fire).toBe(true);
    expect(r.reason).toBe('fire');
    expect(r.state.lastFiredAt).toBe(GOOD.now);
    expect(r.state.lastTrackCount).toBe(6);
  });

  it('holds a blurry frame', () => {
    const r = evaluateKeyframe(createKeyframeState(), { ...GOOD, sharpness: 20 });
    expect(r.fire).toBe(false);
    expect(r.reason).toBe('blurry');
  });

  it('holds a frame taken mid-sweep', () => {
    const r = evaluateKeyframe(createKeyframeState(), { ...GOOD, motion: 0.2 });
    expect(r.fire).toBe(false);
    expect(r.reason).toBe('moving');
  });

  it('holds when the detector found nothing', () => {
    const r = evaluateKeyframe(createKeyframeState(), { ...GOOD, trackCount: 0 });
    expect(r.fire).toBe(false);
    expect(r.reason).toBe('nothing-to-see');
  });

  it('does not fire twice inside the minimum interval', () => {
    const first = evaluateKeyframe(createKeyframeState(), GOOD);
    const second = evaluateKeyframe(first.state, { ...GOOD, now: GOOD.now + 500 });
    expect(second.fire).toBe(false);
    expect(second.reason).toBe('too-soon');
  });

  it('fires again once the interval has passed', () => {
    const first = evaluateKeyframe(createKeyframeState(), GOOD);
    const second = evaluateKeyframe(first.state, { ...GOOD, now: GOOD.now + 2500 });
    expect(second.fire).toBe(true);
  });

  it('fires early when the scene changes substantially', () => {
    // Walking round the cart reveals a shelf of new items. Waiting out the full interval
    // would leave them unnamed for two seconds while the user is looking straight at them.
    const first = evaluateKeyframe(createKeyframeState(), GOOD);
    const second = evaluateKeyframe(first.state, { ...GOOD, now: GOOD.now + 1100, trackCount: 11 });
    expect(second.fire).toBe(true);
  });

  it('does not fire early on a small change in track count', () => {
    const first = evaluateKeyframe(createKeyframeState(), GOOD);
    const second = evaluateKeyframe(first.state, { ...GOOD, now: GOOD.now + 1100, trackCount: 7 });
    expect(second.fire).toBe(false);
    expect(second.reason).toBe('too-soon');
  });

  it('will not fire early on a scene change that is also blurry', () => {
    const first = evaluateKeyframe(createKeyframeState(), GOOD);
    const second = evaluateKeyframe(first.state, {
      ...GOOD,
      now: GOOD.now + 1100,
      trackCount: 20,
      sharpness: 15,
    });
    expect(second.fire).toBe(false);
    expect(second.reason).toBe('blurry');
  });

  it('leaves state untouched when it holds', () => {
    const first = evaluateKeyframe(createKeyframeState(), GOOD);
    const second = evaluateKeyframe(first.state, { ...GOOD, now: GOOD.now + 100, sharpness: 5 });
    expect(second.state).toEqual(first.state);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/engine/liveVision/__tests__/keyframe.test.ts`
Expected: FAIL, cannot resolve `../keyframe`.

- [ ] **Step 3: Add the keyframe types**

Append to `src/engine/liveVision/types.ts`:

```ts
export interface KeyframeSignals {
  /** Variance of the Laplacian over the luma plane. Higher is sharper. Not normalized. */
  sharpness: number;
  /** Mean absolute luma difference against the previous frame, 0 to 1. Higher is more motion. */
  motion: number;
  trackCount: number;
  now: number;
}

export interface KeyframeState {
  lastFiredAt: number;
  lastTrackCount: number;
}

export type KeyframeReason = 'fire' | 'blurry' | 'moving' | 'too-soon' | 'nothing-to-see';

export interface KeyframeConfig {
  minSharpness: number;
  maxMotion: number;
  minIntervalMs: number;
  /** Change in track count that counts as a new scene worth an early look. */
  sceneChangeCount: number;
  /** Floor on the interval even for a scene change, so a churning detector cannot spam. */
  sceneChangeIntervalMs: number;
}
```

- [ ] **Step 4: Implement the gate**

Create `src/engine/liveVision/keyframe.ts`:

```ts
import type { KeyframeConfig, KeyframeReason, KeyframeSignals, KeyframeState } from './types';

/**
 * Thresholds are starting points, not measurements. `minSharpness` in particular is in the
 * arbitrary units of variance-of-Laplacian over an 8-bit luma plane and depends on the camera
 * and the downsample factor, so it has to be re-tuned against the numbers a real device
 * reports before this gate can be trusted. Task 9's harness prints the values it sees.
 */
const DEFAULT_CONFIG: KeyframeConfig = {
  minSharpness: 100,
  maxMotion: 0.02,
  minIntervalMs: 2000,
  sceneChangeCount: 4,
  sceneChangeIntervalMs: 800,
};

export function createKeyframeState(): KeyframeState {
  return { lastFiredAt: 0, lastTrackCount: 0 };
}

export function evaluateKeyframe(
  state: KeyframeState,
  signals: KeyframeSignals,
  overrides: Partial<KeyframeConfig> = {},
): { fire: boolean; reason: KeyframeReason; state: KeyframeState } {
  const config = { ...DEFAULT_CONFIG, ...overrides };
  const hold = (reason: KeyframeReason) => ({ fire: false, reason, state });

  if (signals.trackCount === 0) return hold('nothing-to-see');
  if (signals.sharpness < config.minSharpness) return hold('blurry');
  if (signals.motion > config.maxMotion) return hold('moving');

  const elapsed = signals.now - state.lastFiredAt;
  const sceneChanged =
    Math.abs(signals.trackCount - state.lastTrackCount) >= config.sceneChangeCount;
  const required = sceneChanged ? config.sceneChangeIntervalMs : config.minIntervalMs;

  if (elapsed < required) return hold('too-soon');

  return {
    fire: true,
    reason: 'fire',
    state: { lastFiredAt: signals.now, lastTrackCount: signals.trackCount },
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest src/engine/liveVision/__tests__/keyframe.test.ts`
Expected: PASS.

- [ ] **Step 6: Delete the timer heuristic it replaces**

```bash
git rm src/engine/liveVision/coverageHint.ts src/engine/liveVision/__tests__/coverageHint.test.ts
```

`scan.tsx` still imports `evaluateCoverageHint` at this point and will not typecheck until Task 13. That is expected; do not patch `scan.tsx` here.

- [ ] **Step 7: Commit**

```bash
git add src/engine/liveVision/keyframe.ts src/engine/liveVision/types.ts src/engine/liveVision/__tests__/keyframe.test.ts
git commit -m "feat: add keyframe gate on sharpness, stillness and scene change"
```

---

### Task 6: Detector protocol and mask contours

Turns Vision's per-pixel instance mask into one closed, simplified outline per item. This is the piece that makes a tinted silhouette possible instead of a rectangle.

The Swift here is deliberately kept out of the frame processor file, because the frame processor imports `VisionCamera`, which only exists inside an app build. Everything in this task compiles standalone on the Mac, so it can be unit tested and benchmarked without a device.

**Files:**
- Create: `ios/Kart/KartDetector.swift`
- Create: `ios/Kart/MaskContour.swift`
- Create: `scripts/swift-tests/main.swift`
- Modify: `package.json` (add the `test:swift` script)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `struct DetectedInstance { let box: CGRect; let polygon: [Float]; let score: Float }` where `box` is normalized with origin top-left and `polygon` is flat `[x0, y0, x1, y1, ...]` normalized with origin top-left
  - `protocol KartDetector { func detect(pixelBuffer: CVPixelBuffer, orientation: CGImagePropertyOrientation) throws -> [DetectedInstance] }`
  - `struct MaskInstance { let index: Int; let pixelCount: Int; let box: CGRect; let polygon: [Float] }`
  - `enum MaskContour` with
    - `static func instances(labels: [UInt8], width: Int, height: Int, minPixelFraction: Double, simplifyEpsilon: Double) -> [MaskInstance]`
    - `static func labels(from mask: CVPixelBuffer) -> (labels: [UInt8], width: Int, height: Int)?`

- [ ] **Step 1: Write the failing test**

Create `scripts/swift-tests/main.swift`. This is a plain executable compiled against the app's Swift sources, not an Xcode test target, because the project is an Expo prebuild and adding a test target would put a generated Xcode file under source control.

The file must be named `main.swift` inside its own directory. `swiftc` only permits top-level statements in a file with that exact name, so `scripts/swift-tests.swift` would fail to compile the moment it is passed alongside the app sources.

```swift
// scripts/swift-tests/main.swift
//
// Unit tests for the parts of the detector that are pure geometry. Compiled together with the
// app's Swift sources by `npm run test:swift`, so there is no Xcode test target to keep in
// sync with a project file that Expo regenerates.

import CoreGraphics
import Foundation

var failures = 0

func check(_ condition: Bool, _ message: String) {
  if condition {
    print("  ok   \(message)")
  } else {
    print("  FAIL \(message)")
    failures += 1
  }
}

func suite(_ name: String, _ body: () -> Void) {
  print(name)
  body()
}

/// Builds a label grid with `value` filled inside `rect` and 0 everywhere else.
func grid(width: Int, height: Int, rect: (x: Int, y: Int, w: Int, h: Int), value: UInt8) -> [UInt8] {
  var labels = [UInt8](repeating: 0, count: width * height)
  for y in rect.y..<(rect.y + rect.h) {
    for x in rect.x..<(rect.x + rect.w) {
      labels[y * width + x] = value
    }
  }
  return labels
}

suite("MaskContour.instances") {
  let labels = grid(width: 100, height: 100, rect: (20, 30, 40, 20), value: 1)
  let found = MaskContour.instances(
    labels: labels, width: 100, height: 100, minPixelFraction: 0.001, simplifyEpsilon: 0.004)

  check(found.count == 1, "finds exactly one instance in a single-rectangle mask")

  if let only = found.first {
    check(only.index == 1, "reports the instance label as its index")
    check(only.pixelCount == 800, "counts the filled pixels")
    check(abs(only.box.minX - 0.20) < 0.02, "normalizes the box origin x")
    check(abs(only.box.minY - 0.30) < 0.02, "normalizes the box origin y")
    check(abs(only.box.width - 0.40) < 0.03, "normalizes the box width")
    check(abs(only.box.height - 0.20) < 0.03, "normalizes the box height")
    check(only.polygon.count % 2 == 0, "emits an even number of polygon coordinates")
    check(only.polygon.count >= 6, "emits at least three points")
    check(only.polygon.count <= 40, "simplifies a rectangle down to a handful of points")
    check(only.polygon.allSatisfy { $0 >= -0.001 && $0 <= 1.001 }, "keeps polygon points normalized")
  }
}

suite("MaskContour.instances with several objects") {
  var labels = grid(width: 100, height: 100, rect: (5, 5, 20, 20), value: 1)
  let second = grid(width: 100, height: 100, rect: (60, 60, 30, 30), value: 2)
  for i in 0..<labels.count where second[i] != 0 { labels[i] = second[i] }

  let found = MaskContour.instances(
    labels: labels, width: 100, height: 100, minPixelFraction: 0.001, simplifyEpsilon: 0.004)

  check(found.count == 2, "separates two disjoint instances")
  check(found.map(\.index).sorted() == [1, 2], "keeps both instance labels")
  check(found[0].box.minX < found[1].box.minX, "returns instances ordered by label")
}

suite("MaskContour.instances filtering") {
  // A four-pixel speck in a 100x100 grid is 0.04 percent of the frame. Specks are detector
  // noise, and every one that survives becomes a phantom item in the Plan 3 count.
  let labels = grid(width: 100, height: 100, rect: (50, 50, 2, 2), value: 1)
  let found = MaskContour.instances(
    labels: labels, width: 100, height: 100, minPixelFraction: 0.002, simplifyEpsilon: 0.004)
  check(found.isEmpty, "discards instances below the minimum pixel fraction")
}

suite("MaskContour.instances edge cases") {
  let empty = MaskContour.instances(
    labels: [UInt8](repeating: 0, count: 100), width: 10, height: 10,
    minPixelFraction: 0.0, simplifyEpsilon: 0.004)
  check(empty.isEmpty, "returns nothing for an all-background mask")

  let full = MaskContour.instances(
    labels: [UInt8](repeating: 1, count: 100), width: 10, height: 10,
    minPixelFraction: 0.0, simplifyEpsilon: 0.004)
  check(full.count == 1, "handles a mask that covers the whole frame")

  let degenerate = MaskContour.instances(
    labels: [], width: 0, height: 0, minPixelFraction: 0.0, simplifyEpsilon: 0.004)
  check(degenerate.isEmpty, "returns nothing for a zero-size mask")
}

suite("MaskContour.instances concave shapes") {
  // An L shape. A radial or convex-hull approximation would fill in the notch; a real
  // boundary trace keeps it, which is the difference between tinting the banana bunch and
  // tinting the rectangle around it.
  var labels = grid(width: 100, height: 100, rect: (20, 20, 50, 20), value: 1)
  let leg = grid(width: 100, height: 100, rect: (20, 40, 20, 40), value: 1)
  for i in 0..<labels.count where leg[i] != 0 { labels[i] = 1 }

  let found = MaskContour.instances(
    labels: labels, width: 100, height: 100, minPixelFraction: 0.001, simplifyEpsilon: 0.002)
  check(found.count == 1, "traces an L shape as one instance")

  if let only = found.first {
    // Shoelace area of the outline, normalized. The L covers 1800 of 10000 pixels, 0.18.
    // A shape that had lost its notch would come out near the 0.30 bounding-box area.
    var twiceArea: Float = 0
    let n = only.polygon.count / 2
    for i in 0..<n {
      let j = (i + 1) % n
      twiceArea += only.polygon[i * 2] * only.polygon[j * 2 + 1]
      twiceArea -= only.polygon[j * 2] * only.polygon[i * 2 + 1]
    }
    let area = abs(twiceArea) / 2
    check(area > 0.14 && area < 0.23, "preserves the concave notch rather than filling it")
  }
}

print("")
if failures == 0 {
  print("All Swift checks passed.")
  exit(0)
} else {
  print("\(failures) Swift check(s) failed.")
  exit(1)
}
```

- [ ] **Step 2: Add the npm script**

In `package.json`, add to `scripts`:

```json
"test:swift": "swiftc -O ios/Kart/KartDetector.swift ios/Kart/MaskContour.swift scripts/swift-tests/main.swift -o /tmp/kart-swift-tests && /tmp/kart-swift-tests"
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test:swift`
Expected: FAIL, `ios/Kart/MaskContour.swift` does not exist.

- [ ] **Step 4: Write the protocol**

Create `ios/Kart/KartDetector.swift`:

```swift
// ios/Kart/KartDetector.swift
import CoreGraphics
import CoreVideo
import ImageIO

/// One class-agnostic object proposal.
///
/// The detector answers "how many distinct things are here, and what shape is each". It never
/// answers "what is it". Naming belongs to the cloud layer, which is far better at it, and
/// keeping the two apart is what lets the detector be swapped on measurement alone.
public struct DetectedInstance {
  /// Normalized to the frame, origin top-left.
  public let box: CGRect
  /// Flat `[x0, y0, x1, y1, ...]`, normalized to the frame, origin top-left.
  public let polygon: [Float]
  /// Confidence that this region is one distinct object, 0 to 1. Not a class score.
  public let score: Float

  public init(box: CGRect, polygon: [Float], score: Float) {
    self.box = box
    self.polygon = polygon
    self.score = score
  }
}

/// The single seam between "find the shapes" and everything else.
///
/// Nothing above this protocol may know which model produced the instances. That is what makes
/// the choice between Apple's segmenter and a bundled Core ML model a measurement outcome
/// rather than an architectural commitment.
public protocol KartDetector {
  /// A short, stable identifier used in benchmark output, for example "apple-instance-mask".
  var name: String { get }

  func detect(
    pixelBuffer: CVPixelBuffer,
    orientation: CGImagePropertyOrientation
  ) throws -> [DetectedInstance]
}
```

- [ ] **Step 5: Implement the contour extraction**

Create `ios/Kart/MaskContour.swift`:

```swift
// ios/Kart/MaskContour.swift
import CoreGraphics
import CoreVideo
import Foundation

/// Ceiling on polygon vertices after simplification. An overlay outline does not read
/// better beyond this many points, it is far above the 8 vertices an L-shape trace needs,
/// and it bounds what crosses the JSI boundary and gets re-fit by the tracker every frame.
private let MAX_POLYGON_VERTICES = 64

public struct MaskInstance {
  public let index: Int
  public let pixelCount: Int
  /// Normalized to the mask, origin top-left.
  public let box: CGRect
  /// Flat `[x0, y0, x1, y1, ...]`, normalized to the mask, origin top-left.
  public let polygon: [Float]
}

/// Converts a Vision instance mask into one outline per instance.
///
/// The boundary is traced directly out of the label grid rather than by running a
/// `VNDetectContoursRequest` per instance. One pass over a buffer we already have beats twenty
/// more Vision requests per detection cycle, and it removes any dependency on which pixel
/// formats that request happens to accept.
public enum MaskContour {

  /// Reads a Vision instance mask into a plain label grid.
  ///
  /// `VNInstanceMaskObservation.instanceMask` labels each pixel with its instance index, 0 for
  /// background. Both the one-component 8-bit and 32-bit float layouts are handled, because
  /// the format is not contractual and has differed between revisions.
  public static func labels(from mask: CVPixelBuffer) -> (labels: [UInt8], width: Int, height: Int)? {
    CVPixelBufferLockBaseAddress(mask, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(mask, .readOnly) }

    let width = CVPixelBufferGetWidth(mask)
    let height = CVPixelBufferGetHeight(mask)
    let bytesPerRow = CVPixelBufferGetBytesPerRow(mask)
    guard width > 0, height > 0, let base = CVPixelBufferGetBaseAddress(mask) else { return nil }

    var out = [UInt8](repeating: 0, count: width * height)
    let format = CVPixelBufferGetPixelFormatType(mask)

    switch format {
    case kCVPixelFormatType_OneComponent8:
      let src = base.assumingMemoryBound(to: UInt8.self)
      for y in 0..<height {
        let row = src.advanced(by: y * bytesPerRow)
        for x in 0..<width { out[y * width + x] = row[x] }
      }
    case kCVPixelFormatType_OneComponent32Float:
      let src = base.assumingMemoryBound(to: UInt8.self)
      for y in 0..<height {
        let row = UnsafeRawPointer(src.advanced(by: y * bytesPerRow))
          .assumingMemoryBound(to: Float.self)
        for x in 0..<width {
          let v = row[x]
          out[y * width + x] = v <= 0 ? 0 : UInt8(min(255, max(0, v.rounded())))
        }
      }
    default:
      return nil
    }

    return (out, width, height)
  }

  public static func instances(
    from mask: CVPixelBuffer,
    minPixelFraction: Double = 0.002,
    simplifyEpsilon: Double = 0.004
  ) -> [MaskInstance] {
    guard let read = labels(from: mask) else { return [] }
    return instances(
      labels: read.labels, width: read.width, height: read.height,
      minPixelFraction: minPixelFraction, simplifyEpsilon: simplifyEpsilon)
  }

  public static func instances(
    labels: [UInt8],
    width: Int,
    height: Int,
    minPixelFraction: Double,
    simplifyEpsilon: Double
  ) -> [MaskInstance] {
    guard width > 0, height > 0, labels.count >= width * height else { return [] }

    // One pass to learn which labels exist, how big each is, and where each lives.
    var counts = [Int](repeating: 0, count: 256)
    var minX = [Int](repeating: Int.max, count: 256)
    var minY = [Int](repeating: Int.max, count: 256)
    var maxX = [Int](repeating: Int.min, count: 256)
    var maxY = [Int](repeating: Int.min, count: 256)

    for y in 0..<height {
      let row = y * width
      for x in 0..<width {
        let label = Int(labels[row + x])
        if label == 0 { continue }
        counts[label] += 1
        if x < minX[label] { minX[label] = x }
        if x > maxX[label] { maxX[label] = x }
        if y < minY[label] { minY[label] = y }
        if y > maxY[label] { maxY[label] = y }
      }
    }

    let minPixels = Int((Double(width * height) * minPixelFraction).rounded())
    let epsilonPixels = simplifyEpsilon * Double(max(width, height))
    var out: [MaskInstance] = []

    for label in 1..<256 where counts[label] > 0 && counts[label] >= max(minPixels, 3) {
      guard
        let traced = traceBoundary(
          labels: labels, width: width, height: height, label: UInt8(label),
          minX: minX[label], minY: minY[label], maxX: maxX[label], maxY: maxY[label])
      else { continue }

      let simplified = simplifyBounded(
        traced, epsilon: epsilonPixels, maxVertices: MAX_POLYGON_VERTICES)
      guard simplified.count >= 3 else { continue }

      var polygon = [Float]()
      polygon.reserveCapacity(simplified.count * 2)
      for point in simplified {
        polygon.append(Float(Double(point.x) / Double(width)))
        polygon.append(Float(Double(point.y) / Double(height)))
      }

      let box = CGRect(
        x: Double(minX[label]) / Double(width),
        y: Double(minY[label]) / Double(height),
        width: Double(maxX[label] - minX[label] + 1) / Double(width),
        height: Double(maxY[label] - minY[label] + 1) / Double(height))

      out.append(
        MaskInstance(index: label, pixelCount: counts[label], box: box, polygon: polygon))
    }

    return out
  }

  // MARK: - Boundary tracing

  private struct Point {
    let x: Int
    let y: Int
  }

  /// Eight-connected neighbours, clockwise from east.
  private static let neighbours: [(dx: Int, dy: Int)] = [
    (1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0), (-1, -1), (0, -1), (1, -1),
  ]

  /// Moore neighbourhood boundary tracing.
  ///
  /// Walks the outer edge of one label, keeping every turn, so concave shapes survive. The
  /// iteration cap is a guard against a pathological mask, not an expected exit.
  private static func traceBoundary(
    labels: [UInt8], width: Int, height: Int, label: UInt8,
    minX: Int, minY: Int, maxX: Int, maxY: Int
  ) -> [Point]? {
    func isLabel(_ x: Int, _ y: Int) -> Bool {
      guard x >= 0, y >= 0, x < width, y < height else { return false }
      return labels[y * width + x] == label
    }

    var start: Point?
    outer: for y in minY...maxY {
      for x in minX...maxX where isLabel(x, y) {
        start = Point(x: x, y: y)
        break outer
      }
    }
    guard let first = start else { return nil }

    var contour = [first]
    // Scanning found `first` moving left to right, so the pixel to its west is known background
    // and is the correct place to start looking from.
    let firstBacktrack = Point(x: first.x - 1, y: first.y)
    var backtrack = firstBacktrack
    var current = first
    let limit = 4 * (maxX - minX + 1) * (maxY - minY + 1) + 16

    for _ in 0..<limit {
      let entry =
        neighbours.firstIndex { current.x + $0.dx == backtrack.x && current.y + $0.dy == backtrack.y }
        ?? 4

      var moved = false
      var closed = false
      for step in 1...8 {
        let index = (entry + step) % 8
        let nx = current.x + neighbours[index].dx
        let ny = current.y + neighbours[index].dy
        if isLabel(nx, ny) {
          let previous = (entry + step - 1) % 8
          let newBacktrack = Point(
            x: current.x + neighbours[previous].dx, y: current.y + neighbours[previous].dy)

          // Jacob's stopping criterion. A region that touches itself at a single pixel, a
          // bowtie or dumbbell, revisits that pixel's coordinates mid-trace while arriving
          // from a different neighbor than the artificial backtrack used to start the walk.
          // That revisit is a genuine boundary vertex belonging to the other lobe, not the end
          // of the loop, so it must be kept and the walk must continue through it. The walk is
          // only closed when it returns to the start pixel by arriving from the exact same
          // neighbor it started from, which means the very first step is about to repeat.
          if nx == first.x, ny == first.y, newBacktrack.x == firstBacktrack.x,
            newBacktrack.y == firstBacktrack.y
          {
            closed = true
          } else {
            backtrack = newBacktrack
            current = Point(x: nx, y: ny)
            contour.append(current)
          }
          moved = true
          break
        }
      }

      // A single isolated pixel has no boundary to walk.
      if !moved { break }
      if closed { break }
    }

    return contour.count >= 3 ? contour : nil
  }

  // MARK: - Simplification

  /// Simplifies a closed contour to at most `maxVertices` points.
  ///
  /// Escalates `epsilon` first, since coarsening the tolerance is what turns a jagged
  /// trace into a clean outline, and doubling converges fast. Uniform decimation is a
  /// last-resort fallback for the rare contour escalation cannot tame in a bounded number
  /// of attempts (or a caller-supplied epsilon so small doubling cannot catch up), so the
  /// ceiling is guaranteed rather than merely likely. Decimation is not the primary
  /// strategy because picking every Nth point deforms a shape instead of coarsening it.
  private static func simplifyBounded(_ points: [Point], epsilon: Double, maxVertices: Int) -> [Point] {
    var result = simplify(points, epsilon: epsilon)
    if result.count <= maxVertices { return result }

    // A non-positive epsilon means simplify() left the contour untouched, so doubling it
    // would multiply zero by two forever. Start escalation from a nominal floor instead.
    var currentEpsilon = epsilon > 0 ? epsilon : 0.5
    for _ in 0..<8 {
      currentEpsilon *= 2
      result = simplify(points, epsilon: currentEpsilon)
      if result.count <= maxVertices { return result }
    }

    return decimate(result, maxVertices: maxVertices)
  }

  /// Keeps every Nth point of a closed contour so the result is guaranteed to fit within
  /// `maxVertices`. Used only once escalating epsilon has failed to converge, because
  /// picking points by position rather than by geometric significance can land on an
  /// awkward vertex instead of a genuine corner.
  private static func decimate(_ points: [Point], maxVertices: Int) -> [Point] {
    guard points.count > maxVertices, maxVertices >= 3 else { return points }
    var out: [Point] = []
    out.reserveCapacity(maxVertices)
    let step = Double(points.count) / Double(maxVertices)
    var cursor = 0.0
    for _ in 0..<maxVertices {
      out.append(points[Int(cursor) % points.count])
      cursor += step
    }
    return out
  }

  /// Ramer-Douglas-Peucker on a closed contour, applied to the open run and then re-closed.
  private static func simplify(_ points: [Point], epsilon: Double) -> [Point] {
    guard points.count > 3, epsilon > 0 else { return points }

    var keep = [Bool](repeating: false, count: points.count)
    keep[0] = true
    keep[points.count - 1] = true

    var stack = [(0, points.count - 1)]
    while let (from, to) = stack.popLast() {
      guard to > from + 1 else { continue }

      let ax = Double(points[from].x)
      let ay = Double(points[from].y)
      let bx = Double(points[to].x)
      let by = Double(points[to].y)
      let dx = bx - ax
      let dy = by - ay
      let length = (dx * dx + dy * dy).squareRoot()

      var worst = 0.0
      var worstIndex = from

      for i in (from + 1)..<to {
        let px = Double(points[i].x)
        let py = Double(points[i].y)
        // Perpendicular distance, degrading to plain distance when the segment is a point.
        let distance =
          length == 0
          ? ((px - ax) * (px - ax) + (py - ay) * (py - ay)).squareRoot()
          : abs(dy * px - dx * py + bx * ay - by * ax) / length
        if distance > worst {
          worst = distance
          worstIndex = i
        }
      }

      if worst > epsilon {
        keep[worstIndex] = true
        stack.append((from, worstIndex))
        stack.append((worstIndex, to))
      }
    }

    return points.enumerated().filter { keep[$0.offset] }.map(\.element)
  }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm run test:swift`
Expected: PASS, every check reports `ok`.

- [ ] **Step 7: Commit**

```bash
git add ios/Kart/KartDetector.swift ios/Kart/MaskContour.swift scripts/swift-tests/main.swift package.json
git commit -m "feat: add detector protocol and instance mask contour extraction"
```

---

### Task 7: Frame metrics

Sharpness and motion, the two numbers the keyframe gate runs on. Both read the luma plane of the camera buffer, which is already there, so neither costs a colour conversion.

**Files:**
- Create: `ios/Kart/FrameMetrics.swift`
- Modify: `scripts/swift-tests/main.swift` (append a suite)
- Modify: `package.json` (add the new source to `test:swift`)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `final class FrameMetrics` with
    - `func measure(pixelBuffer: CVPixelBuffer) -> (sharpness: Double, motion: Double)`
    - `func reset()`
  - `enum FrameMetricsMath` with
    - `static func varianceOfLaplacian(_ luma: [UInt8], width: Int, height: Int) -> Double`
    - `static func meanAbsoluteDifference(_ a: [UInt8], _ b: [UInt8]) -> Double`

The class holds the previous downsample, which is why motion needs an instance while the maths stays static and testable.

- [ ] **Step 1: Write the failing test**

Append to `scripts/swift-tests/main.swift`, before the final `print("")` block:

```swift
suite("FrameMetricsMath.varianceOfLaplacian") {
  let flat = [UInt8](repeating: 128, count: 64 * 64)
  check(
    FrameMetricsMath.varianceOfLaplacian(flat, width: 64, height: 64) < 1.0,
    "reports near zero for a flat grey image")

  var checker = [UInt8](repeating: 0, count: 64 * 64)
  for y in 0..<64 {
    for x in 0..<64 { checker[y * 64 + x] = (x / 4 + y / 4) % 2 == 0 ? 0 : 255 }
  }
  let sharp = FrameMetricsMath.varianceOfLaplacian(checker, width: 64, height: 64)
  check(sharp > 100.0, "reports a large value for a hard-edged checkerboard")

  // A blurred checkerboard must score below a crisp one. This ordering is the whole contract:
  // the gate only ever compares sharpness against a threshold.
  var blurred = checker
  for y in 1..<63 {
    for x in 1..<63 {
      let sum =
        Int(checker[(y - 1) * 64 + x]) + Int(checker[(y + 1) * 64 + x])
        + Int(checker[y * 64 + x - 1]) + Int(checker[y * 64 + x + 1]) + Int(checker[y * 64 + x])
      blurred[y * 64 + x] = UInt8(sum / 5)
    }
  }
  check(
    FrameMetricsMath.varianceOfLaplacian(blurred, width: 64, height: 64) < sharp,
    "ranks a blurred image below a crisp one")

  check(
    FrameMetricsMath.varianceOfLaplacian([], width: 0, height: 0) == 0,
    "returns zero for an empty image")
}

suite("FrameMetricsMath.meanAbsoluteDifference") {
  let a = [UInt8](repeating: 100, count: 256)
  check(FrameMetricsMath.meanAbsoluteDifference(a, a) == 0, "reports zero for identical frames")

  let b = [UInt8](repeating: 200, count: 256)
  let diff = FrameMetricsMath.meanAbsoluteDifference(a, b)
  check(abs(diff - 100.0 / 255.0) < 0.001, "normalizes the difference to 0 to 1")

  check(
    FrameMetricsMath.meanAbsoluteDifference(a, [UInt8](repeating: 1, count: 4)) == 1.0,
    "reports maximum motion when the frames are different sizes")

  check(FrameMetricsMath.meanAbsoluteDifference([], []) == 0, "returns zero for empty frames")
}
```

- [ ] **Step 2: Add the source to the test script**

In `package.json`, update `test:swift` to include the new file:

```json
"test:swift": "swiftc -O ios/Kart/KartDetector.swift ios/Kart/MaskContour.swift ios/Kart/FrameMetrics.swift scripts/swift-tests/main.swift -o /tmp/kart-swift-tests && /tmp/kart-swift-tests"
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test:swift`
Expected: FAIL, `ios/Kart/FrameMetrics.swift` does not exist.

- [ ] **Step 4: Implement the metrics**

Create `ios/Kart/FrameMetrics.swift`:

```swift
// ios/Kart/FrameMetrics.swift
import CoreVideo
import Foundation

/// The dimension the luma plane is sampled down to before either metric runs. Small enough to
/// be nearly free at camera frame rate, large enough that a genuinely blurry frame still scores
/// distinctly below a sharp one.
private let SAMPLE_EDGE = 96

public enum FrameMetricsMath {

  /// Variance of the Laplacian, the standard cheap focus measure. A sharp image has strong
  /// second derivatives at edges and therefore high variance; a blurred one does not.
  public static func varianceOfLaplacian(_ luma: [UInt8], width: Int, height: Int) -> Double {
    guard width > 2, height > 2, luma.count >= width * height else { return 0 }

    var sum = 0.0
    var sumSquares = 0.0
    var count = 0

    for y in 1..<(height - 1) {
      for x in 1..<(width - 1) {
        let centre = Int(luma[y * width + x])
        let value =
          Double(
            Int(luma[(y - 1) * width + x]) + Int(luma[(y + 1) * width + x])
              + Int(luma[y * width + x - 1]) + Int(luma[y * width + x + 1]) - 4 * centre)
        sum += value
        sumSquares += value * value
        count += 1
      }
    }

    guard count > 0 else { return 0 }
    let mean = sum / Double(count)
    return max(0, sumSquares / Double(count) - mean * mean)
  }

  /// Mean absolute difference between two same-size samples, normalized to 0 to 1.
  ///
  /// Mismatched sizes report maximum motion rather than zero. A size change means the camera
  /// reconfigured, and treating that as "perfectly still" would let the gate fire on the one
  /// frame least likely to be usable.
  public static func meanAbsoluteDifference(_ a: [UInt8], _ b: [UInt8]) -> Double {
    if a.isEmpty && b.isEmpty { return 0 }
    guard a.count == b.count, !a.isEmpty else { return 1.0 }

    var total = 0
    for i in 0..<a.count { total += abs(Int(a[i]) - Int(b[i])) }
    return Double(total) / (Double(a.count) * 255.0)
  }
}

/// Stateful wrapper: sharpness is per frame, motion needs the frame before it.
public final class FrameMetrics {
  private var previous: [UInt8]?

  public init() {}

  public func reset() {
    previous = nil
  }

  public func measure(pixelBuffer: CVPixelBuffer) -> (sharpness: Double, motion: Double) {
    guard let sample = FrameMetrics.sampleLuma(pixelBuffer) else {
      previous = nil
      return (0, 1.0)
    }

    let sharpness = FrameMetricsMath.varianceOfLaplacian(
      sample.luma, width: sample.width, height: sample.height)

    // The first frame of a session has nothing to compare against. Reporting maximum motion
    // holds the gate shut for one frame, which is the safe direction to fail.
    let motion =
      previous.map { FrameMetricsMath.meanAbsoluteDifference($0, sample.luma) } ?? 1.0
    previous = sample.luma

    return (sharpness, motion)
  }

  /// Nearest-neighbour downsample of plane 0. Biplanar YUV keeps luma in plane 0, and a
  /// single-plane buffer is already luma-only, so both cases read the same way.
  private static func sampleLuma(_ pixelBuffer: CVPixelBuffer) -> (luma: [UInt8], width: Int, height: Int)? {
    CVPixelBufferLockBaseAddress(pixelBuffer, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, .readOnly) }

    let planar = CVPixelBufferGetPlaneCount(pixelBuffer) > 0
    let srcWidth = planar ? CVPixelBufferGetWidthOfPlane(pixelBuffer, 0) : CVPixelBufferGetWidth(pixelBuffer)
    let srcHeight = planar ? CVPixelBufferGetHeightOfPlane(pixelBuffer, 0) : CVPixelBufferGetHeight(pixelBuffer)
    let bytesPerRow =
      planar
      ? CVPixelBufferGetBytesPerRowOfPlane(pixelBuffer, 0) : CVPixelBufferGetBytesPerRow(pixelBuffer)
    let base =
      planar
      ? CVPixelBufferGetBaseAddressOfPlane(pixelBuffer, 0) : CVPixelBufferGetBaseAddress(pixelBuffer)

    guard srcWidth > 0, srcHeight > 0, let address = base else { return nil }

    let scale = max(1, max(srcWidth, srcHeight) / SAMPLE_EDGE)
    let width = max(1, srcWidth / scale)
    let height = max(1, srcHeight / scale)
    let src = address.assumingMemoryBound(to: UInt8.self)

    var out = [UInt8](repeating: 0, count: width * height)
    for y in 0..<height {
      let row = src.advanced(by: min(y * scale, srcHeight - 1) * bytesPerRow)
      for x in 0..<width { out[y * width + x] = row[min(x * scale, srcWidth - 1)] }
    }

    return (out, width, height)
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test:swift`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add ios/Kart/FrameMetrics.swift scripts/swift-tests/main.swift package.json
git commit -m "feat: add sharpness and motion metrics for keyframe gating"
```

---

### Task 8: Apple detector and the measurement harness

The first `KartDetector`, and the instrument that decides whether it is the one that ships.

Nothing about the detector choice is settled by this plan. The harness runs any detector over a folder of real cart photos and reports how many distinct items it found, how big they were, how many polygon points each outline needed, and how long it took. That report, against the user's own photos, is what a Core ML detector would have to beat.

**Files:**
- Create: `ios/Kart/AppleInstanceMaskDetector.swift`
- Create: `scripts/detector-bench/main.swift`
- Modify: `package.json` (add the `bench:detector` script)
- Create: `docs/detector-measurement.md`

**Interfaces:**
- Consumes: `KartDetector`, `DetectedInstance` from `KartDetector.swift`; `MaskContour` from `MaskContour.swift`; `FrameMetricsMath` from `FrameMetrics.swift`.
- Produces: `final class AppleInstanceMaskDetector: KartDetector`, `init(minPixelFraction: Double = 0.002, simplifyEpsilon: Double = 0.004)`.

- [ ] **Step 1: Implement the detector**

Create `ios/Kart/AppleInstanceMaskDetector.swift`:

```swift
// ios/Kart/AppleInstanceMaskDetector.swift
import CoreGraphics
import CoreVideo
import ImageIO
import Vision

/// `KartDetector` backed by `VNGenerateForegroundInstanceMaskRequest` (iOS 17 and later).
///
/// Chosen as the first implementation because it costs nothing to ship, adds nothing to the
/// binary, and carries no licence obligation, not because it is known to be the best. Apple
/// describes it as segmenting "salient objects that can be separated from the background",
/// which is a weaker promise than enumerating every item in a stacked cart. Whether it holds
/// up is exactly what the benchmark in this task exists to find out.
public final class AppleInstanceMaskDetector: KartDetector {
  public let name = "apple-instance-mask"

  private let minPixelFraction: Double
  private let simplifyEpsilon: Double

  public init(minPixelFraction: Double = 0.002, simplifyEpsilon: Double = 0.004) {
    self.minPixelFraction = minPixelFraction
    self.simplifyEpsilon = simplifyEpsilon
  }

  public func detect(
    pixelBuffer: CVPixelBuffer,
    orientation: CGImagePropertyOrientation
  ) throws -> [DetectedInstance] {
    let request = VNGenerateForegroundInstanceMaskRequest()
    let handler = VNImageRequestHandler(
      cvPixelBuffer: pixelBuffer, orientation: orientation, options: [:])
    try handler.perform([request])

    guard let observation = request.results?.first else { return [] }

    // Apple exposes one confidence for the whole observation and none per instance, so every
    // instance carries the same score. The practical consequence is that ByteTrack's
    // second-stage recovery pass never engages under this detector: with no score spread there
    // are no low-confidence detections to recover from. A Core ML detector would supply real
    // per-instance scores and light that stage up. Do not paper over this by inventing a score
    // out of mask area; a fabricated confidence is worse than an honest constant one.
    let score = min(1, max(0, observation.confidence))

    return MaskContour.instances(
      from: observation.instanceMask,
      minPixelFraction: minPixelFraction,
      simplifyEpsilon: simplifyEpsilon
    ).map { DetectedInstance(box: $0.box, polygon: $0.polygon, score: score) }
  }
}
```

- [ ] **Step 2: Build the harness**

Create `scripts/detector-bench/main.swift`:

```swift
// scripts/detector-bench/main.swift
//
// Runs a KartDetector over a folder of photographs and reports what it found.
//
//   npm run bench:detector -- --input server/eval/corpus/images --output /tmp/kart-bench
//
// Writes one annotated PNG per input image plus a report.json, and prints a summary table.
// This is the instrument that decides which detector ships: run it against real cart photos
// and compare the instance counts to what is actually in the cart.

import CoreGraphics
import CoreText
import CoreVideo
import Foundation
import ImageIO
import UniformTypeIdentifiers

// MARK: - Arguments

func argument(_ name: String, default fallback: String? = nil) -> String? {
  let args = CommandLine.arguments
  guard let i = args.firstIndex(of: "--\(name)"), i + 1 < args.count else { return fallback }
  return args[i + 1]
}

guard let inputPath = argument("input") else {
  print("usage: detector-bench --input <dir> [--output <dir>] [--min-pixel-fraction N] [--epsilon N]")
  exit(2)
}

let outputPath = argument("output", default: "/tmp/kart-bench")!
let minPixelFraction = Double(argument("min-pixel-fraction", default: "0.002")!) ?? 0.002
let epsilon = Double(argument("epsilon", default: "0.004")!) ?? 0.004

let detector: KartDetector = AppleInstanceMaskDetector(
  minPixelFraction: minPixelFraction, simplifyEpsilon: epsilon)

// MARK: - Image loading

func loadImage(_ url: URL) -> CGImage? {
  guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
  return CGImageSourceCreateImageAtIndex(source, 0, nil)
}

func makeBuffer(_ image: CGImage, gray: Bool) -> CVPixelBuffer? {
  var buffer: CVPixelBuffer?
  let format = gray ? kCVPixelFormatType_OneComponent8 : kCVPixelFormatType_32BGRA
  let attributes: [CFString: Any] = [
    kCVPixelBufferCGImageCompatibilityKey: true,
    kCVPixelBufferCGBitmapContextCompatibilityKey: true,
  ]
  guard
    CVPixelBufferCreate(
      kCFAllocatorDefault, image.width, image.height, format, attributes as CFDictionary, &buffer)
      == kCVReturnSuccess,
    let out = buffer
  else { return nil }

  CVPixelBufferLockBaseAddress(out, [])
  defer { CVPixelBufferUnlockBaseAddress(out, []) }

  let space = gray ? CGColorSpaceCreateDeviceGray() : CGColorSpaceCreateDeviceRGB()
  let info =
    gray
    ? CGImageAlphaInfo.none.rawValue
    : CGImageAlphaInfo.noneSkipFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue

  guard
    let context = CGContext(
      data: CVPixelBufferGetBaseAddress(out), width: image.width, height: image.height,
      bitsPerComponent: 8, bytesPerRow: CVPixelBufferGetBytesPerRow(out), space: space,
      bitmapInfo: info)
  else { return nil }

  context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
  return out
}

func grayBytes(_ buffer: CVPixelBuffer) -> (luma: [UInt8], width: Int, height: Int) {
  CVPixelBufferLockBaseAddress(buffer, .readOnly)
  defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
  let width = CVPixelBufferGetWidth(buffer)
  let height = CVPixelBufferGetHeight(buffer)
  let stride = CVPixelBufferGetBytesPerRow(buffer)
  guard let base = CVPixelBufferGetBaseAddress(buffer)?.assumingMemoryBound(to: UInt8.self) else {
    return ([], 0, 0)
  }
  var out = [UInt8](repeating: 0, count: width * height)
  for y in 0..<height {
    let row = base.advanced(by: y * stride)
    for x in 0..<width { out[y * width + x] = row[x] }
  }
  return (out, width, height)
}

// MARK: - Annotation

let palette: [(r: Double, g: Double, b: Double)] = [
  (0.00, 0.90, 1.00), (1.00, 0.42, 0.42), (0.45, 0.95, 0.45), (1.00, 0.85, 0.20),
  (0.85, 0.45, 1.00), (1.00, 0.60, 0.20), (0.35, 0.65, 1.00), (1.00, 0.35, 0.75),
]

func annotate(_ image: CGImage, instances: [DetectedInstance], to url: URL) {
  let width = image.width
  let height = image.height
  guard
    let context = CGContext(
      data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
      space: CGColorSpaceCreateDeviceRGB(),
      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
  else { return }

  context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
  context.setLineWidth(max(2, Double(max(width, height)) / 400))

  for (i, instance) in instances.enumerated() {
    let colour = palette[i % palette.count]
    guard instance.polygon.count >= 6 else { continue }

    let path = CGMutablePath()
    // The detector reports origin top-left; CoreGraphics draws origin bottom-left, so y flips.
    for point in stride(from: 0, to: instance.polygon.count - 1, by: 2) {
      let x = Double(instance.polygon[point]) * Double(width)
      let y = (1 - Double(instance.polygon[point + 1])) * Double(height)
      if point == 0 { path.move(to: CGPoint(x: x, y: y)) } else { path.addLine(to: CGPoint(x: x, y: y)) }
    }
    path.closeSubpath()

    context.setFillColor(red: colour.r, green: colour.g, blue: colour.b, alpha: 0.28)
    context.addPath(path)
    context.fillPath()
    context.setStrokeColor(red: colour.r, green: colour.g, blue: colour.b, alpha: 1.0)
    context.addPath(path)
    context.strokePath()

    // CoreText attribute keys, not the AppKit or UIKit ones. `.font` and `.foregroundColor`
    // are extensions those frameworks add, and neither is linked here.
    let font = CTFontCreateWithName("Helvetica-Bold" as CFString, Double(max(width, height)) / 40, nil)
    let label = NSAttributedString(
      string: "\(i + 1)",
      attributes: [
        NSAttributedString.Key(kCTFontAttributeName as String): font,
        NSAttributedString.Key(kCTForegroundColorAttributeName as String):
          CGColor(red: 1, green: 1, blue: 1, alpha: 1),
      ])
    context.textPosition = CGPoint(
      x: Double(instance.box.minX) * Double(width) + 6,
      y: (1 - Double(instance.box.minY)) * Double(height) - Double(max(width, height)) / 34)
    CTLineDraw(CTLineCreateWithAttributedString(label), context)
  }

  guard
    let output = context.makeImage(),
    let destination = CGImageDestinationCreateWithURL(
      url as CFURL, UTType.png.identifier as CFString, 1, nil)
  else { return }
  CGImageDestinationAddImage(destination, output, nil)
  CGImageDestinationFinalize(destination)
}

// MARK: - Run

let inputURL = URL(fileURLWithPath: inputPath)
let outputURL = URL(fileURLWithPath: outputPath)
try? FileManager.default.createDirectory(at: outputURL, withIntermediateDirectories: true)

let extensions: Set<String> = ["jpg", "jpeg", "png", "heic", "heif"]
let files =
  ((try? FileManager.default.contentsOfDirectory(at: inputURL, includingPropertiesForKeys: nil)) ?? [])
  .filter { extensions.contains($0.pathExtension.lowercased()) }
  .sorted { $0.lastPathComponent < $1.lastPathComponent }

if files.isEmpty {
  print("No images found in \(inputPath).")
  print("Drop cart photos there and run again. Without photos this reports nothing,")
  print("which is the honest outcome and not a bug.")
  exit(1)
}

/// String(format:) does not honour a width specifier for %@, so columns are padded by hand.
func pad(_ text: String, _ width: Int) -> String {
  text.count >= width ? String(text.prefix(width)) : text + String(repeating: " ", count: width - text.count)
}
func padLeft(_ text: String, _ width: Int) -> String {
  text.count >= width ? text : String(repeating: " ", count: width - text.count) + text
}

var rows: [[String: Any]] = []
print("")
print(pad("image", 32) + padLeft("items", 7) + padLeft("ms", 9) + padLeft("sharp", 9) + padLeft("pts/item", 10))
print(String(repeating: "-", count: 67))

for file in files {
  guard let image = loadImage(file), let colour = makeBuffer(image, gray: false) else {
    print("\(file.lastPathComponent): could not decode")
    continue
  }

  let started = Date()
  let instances = (try? detector.detect(pixelBuffer: colour, orientation: .up)) ?? []
  let elapsedMs = Date().timeIntervalSince(started) * 1000

  var sharpness = 0.0
  if let gray = makeBuffer(image, gray: true) {
    let sample = grayBytes(gray)
    sharpness = FrameMetricsMath.varianceOfLaplacian(
      sample.luma, width: sample.width, height: sample.height)
  }

  annotate(image, instances: instances, to: outputURL.appendingPathComponent(
    file.deletingPathExtension().lastPathComponent + ".annotated.png"))

  let averagePoints =
    instances.isEmpty ? 0 : instances.map { $0.polygon.count / 2 }.reduce(0, +) / instances.count

  print(
    pad(file.lastPathComponent, 32) + padLeft("\(instances.count)", 7)
      + padLeft(String(format: "%.1f", elapsedMs), 9)
      + padLeft(String(format: "%.0f", sharpness), 9) + padLeft("\(averagePoints)", 10))

  rows.append([
    "image": file.lastPathComponent,
    "width": image.width,
    "height": image.height,
    "detector": detector.name,
    "instanceCount": instances.count,
    "detectMs": elapsedMs,
    "sharpness": sharpness,
    "instances": instances.map { instance in
      [
        "areaFraction": instance.box.width * instance.box.height,
        "points": instance.polygon.count / 2,
        "score": instance.score,
        "box": [
          "x": instance.box.minX, "y": instance.box.minY,
          "w": instance.box.width, "h": instance.box.height,
        ],
      ] as [String: Any]
    },
  ])
}

let counts = rows.compactMap { $0["instanceCount"] as? Int }
print(String(repeating: "-", count: 67))
if !counts.isEmpty {
  // Double, not integer division. An integer mean reads 0 for any run averaging under one
  // item per image, which is exactly the failing case this table exists to show.
  let mean = Double(counts.reduce(0, +)) / Double(counts.count)
  print(String(
    format: "images: %d   min items: %d   max: %d   mean: %.1f",
    counts.count, counts.min()!, counts.max()!, mean))
}
print("annotated images written to \(outputPath)")
print("")
print("Open the annotated images before reading anything into the numbers. A count that looks")
print("right can still be twenty outlines on the wrong things.")

let report: [String: Any] = [
  "detector": detector.name,
  "minPixelFraction": minPixelFraction,
  "simplifyEpsilon": epsilon,
  "images": rows,
]
if let data = try? JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]) {
  try? data.write(to: outputURL.appendingPathComponent("report.json"))
}
```

- [ ] **Step 3: Add the npm script**

In `package.json`, add to `scripts`:

```json
"bench:detector": "swiftc -O ios/Kart/KartDetector.swift ios/Kart/MaskContour.swift ios/Kart/FrameMetrics.swift ios/Kart/AppleInstanceMaskDetector.swift scripts/detector-bench/main.swift -o /tmp/kart-detector-bench && /tmp/kart-detector-bench"
```

- [ ] **Step 4: Verify it compiles and runs**

Run: `npm run bench:detector -- --input server/eval/corpus/images --output /tmp/kart-bench`

The corpus is empty until the user supplies photos, so the expected result today is a clean exit reporting no images found. That is the pass condition for this step: the harness compiles, runs, and reports honestly. **Do not fabricate test images to make the table print.**

To confirm the detection path itself executes, run it once against any folder holding at least one photograph, confirm a non-zero exit table is printed and an annotated PNG appears in the output directory, then delete the output. Do not add any image to the repository.

- [ ] **Step 5: Write the measurement note**

Create `docs/detector-measurement.md`:

```markdown
# Choosing the detector

The on-device detector is chosen by measurement, not by argument. This is how.

## Run it

    npm run bench:detector -- --input server/eval/corpus/images --output /tmp/kart-bench

You need real photographs of loaded carts in `server/eval/corpus/images`, shot the way the app
will see them: from above, items stacked, nothing tidied up for the camera.

## Read it

Open the annotated PNGs first. The numbers are meaningless until you have seen where the
outlines actually landed. Then compare against the ground truth in
`server/eval/corpus/ground-truth.json`.

| Signal | What it tells you |
|---|---|
| `instanceCount` versus the true item count | Whether the detector sees items or sees one pile |
| Annotated overlay | Whether outlines are on items or on shadows, cart mesh and floor |
| `detectMs` | Whether it can run at three detections per second on a phone |
| `points` per instance | Whether outlines are usable shapes or noise |
| `sharpness` | The real range for tuning `minSharpness` in `keyframe.ts` |

## Decide

**Apple's segmenter is enough** if it finds most items with outlines on the right things. Ship
it. Nothing is added to the binary and there is no licence to buy.

**It is not enough** if it collapses the cart into a few blobs. Then a Core ML detector goes in
behind the same `KartDetector` protocol, which is a contained change: no tracker, pipeline, or
UI code moves.

Two candidates, and the licence is the deciding factor between them:

- **YOLOE**, open vocabulary over 1200-plus LVIS and Objects365 categories, which includes the
  packaged goods a COCO-trained model has never heard of. Released under AGPL-3.0. Shipping it
  inside a closed-source app means buying a commercial licence from Ultralytics or Roboflow.
  **This has to be settled before it goes in a build, not after.**
- **A permissively licensed model**, Apache-2.0, no fee. SAM-family models segment anything
  regardless of category but tend to over-segment, splitting one cereal box into several
  pieces. RF-DETR-Seg is Apache-2.0 but COCO-trained, so out of the box it misses most packaged
  goods and would need fine-tuning on a grocery dataset.

## Caveats worth keeping in mind

- The harness runs on the Mac against still images, where orientation is always upright. It
  **cannot** catch a mask that comes back in raw sensor orientation on device. That only shows
  up on hardware, as outlines rotated or mirrored away from the items. The single place to fix
  it is the normalization in `MaskContour.instances`.
- Timings on a Mac are not phone timings. Treat `detectMs` as a ranking between detectors, not
  as a budget.
- Apple's segmenter reports one confidence for the whole observation, so every instance carries
  the same score and ByteTrack's second-stage recovery never engages. A detector with real
  per-instance scores would enable it.
```

- [ ] **Step 6: Commit**

```bash
git add ios/Kart/AppleInstanceMaskDetector.swift scripts/detector-bench/main.swift docs/detector-measurement.md package.json
git commit -m "feat: add Apple instance mask detector and measurement harness"
```

---

### Task 9: Frame processor rewrite

Replaces the saliency, classify and OCR path with the detector, barcodes and metrics. This is where the three-region cap dies.

**Files:**
- Modify: `ios/Kart/KartVisionFrameProcessorPlugin.swift` (rewrite)
- Modify: `scripts/register-xcode-file.js`
- Modify: `package.json`
- Create: `src/engine/liveVision/config.ts`

**Interfaces:**
- Consumes: `KartDetector`, `AppleInstanceMaskDetector`, `FrameMetrics`.
- Produces: the plugin's return value, which Task 10 binds. Shape:

```
{
  instances: [{ box: { x, y, w, h }, polygon: [Number], score: Number }],
  barcodes:  [{ payload: String, symbology: String, box: { x, y, w, h } }],
  sharpness: Number,
  motion:    Number,
  width:     Number,   // upright frame width
  height:    Number,   // upright frame height
}
```

All boxes and polygon points are normalized 0 to 1 with origin top-left. `width` and `height` are the upright dimensions, computed natively, so JavaScript no longer has to reason about sensor rotation.

- [ ] **Step 1: Add the feature flag**

Create `src/engine/liveVision/config.ts`:

```ts
/**
 * The barcode fast path decodes any UPC that happens to face the camera and resolves it
 * against Open Food Facts in Plan 3, skipping the model entirely for that item.
 *
 * It reverses a documented product decision. The 2026-08-10 spec listed barcode scanning as a
 * non-goal, on the grounds that items should be recognized visually the way a person would.
 * The reversal is narrow and invisible: the user is never asked to find, aim at, or scan a
 * barcode, and nothing about the interaction changes. Set this to false to restore the
 * original behaviour without touching the pipeline.
 *
 * Enabling it obliges the app to carry Open Food Facts attribution under ODbL. That belongs
 * with the lookup, in Plan 3.
 */
export const ENABLE_BARCODE_FAST_PATH = true;

/** How many times a second the detector runs. Rendering stays at 60fps via Kalman prediction. */
export const DETECT_TARGET_FPS = 3;
```

- [ ] **Step 2: Rewrite the plugin**

Replace the entire contents of `ios/Kart/KartVisionFrameProcessorPlugin.swift`:

```swift
// ios/Kart/KartVisionFrameProcessorPlugin.swift
import CoreVideo
import Vision
import VisionCamera

/// `Frame.orientation` is a `UIImage.Orientation` describing the rotation needed to make the raw
/// sensor buffer appear upright. `VNImageRequestHandler` wants the equivalent
/// `CGImagePropertyOrientation`. The two enums are NOT raw-value compatible (their cases are
/// ordered differently), so this needs an explicit mapping rather than a cast.
private extension CGImagePropertyOrientation {
  init(_ uiOrientation: UIImage.Orientation) {
    switch uiOrientation {
    case .up: self = .up
    case .upMirrored: self = .upMirrored
    case .down: self = .down
    case .downMirrored: self = .downMirrored
    case .left: self = .left
    case .leftMirrored: self = .leftMirrored
    case .right: self = .right
    case .rightMirrored: self = .rightMirrored
    @unknown default: self = .up
    }
  }

  /// True when making the buffer upright swaps its width and height.
  var swapsDimensions: Bool {
    switch self {
    case .left, .leftMirrored, .right, .rightMirrored: return true
    default: return false
    }
  }
}

@objc(KartVisionFrameProcessorPlugin)
public class KartVisionFrameProcessorPlugin: FrameProcessorPlugin {

  /// The one place a concrete detector is named. Swapping in a Core ML detector, once the
  /// benchmark says to, is a change to this line and nothing else.
  private let detector: KartDetector = AppleInstanceMaskDetector()
  private let metrics = FrameMetrics()

  public override init(proxy: VisionCameraProxyHolder, options: [AnyHashable: Any]!) {
    super.init(proxy: proxy, options: options)
  }

  public override func callback(
    _ frame: Frame, withArguments arguments: [AnyHashable: Any]?
  ) -> Any? {
    guard let pixelBuffer = CMSampleBufferGetImageBuffer(frame.buffer) else {
      return Self.empty(width: 0, height: 0)
    }

    let orientation = CGImagePropertyOrientation(frame.orientation)
    let width = orientation.swapsDimensions ? frame.height : frame.width
    let height = orientation.swapsDimensions ? frame.width : frame.height

    let measured = metrics.measure(pixelBuffer: pixelBuffer)
    let instances = (try? detector.detect(pixelBuffer: pixelBuffer, orientation: orientation)) ?? []

    var barcodes: [[String: Any]] = []
    if (arguments?["barcodes"] as? Bool) ?? false {
      barcodes = Self.readBarcodes(pixelBuffer: pixelBuffer, orientation: orientation)
    }

    return [
      "instances": instances.map { instance in
        [
          "box": Self.box(instance.box),
          // Bridged as Double rather than Float: JSI numbers are doubles, and converting once
          // here avoids a per-element boxing surprise on the JavaScript side.
          "polygon": instance.polygon.map { Double($0) },
          "score": Double(instance.score),
        ] as [String: Any]
      },
      "barcodes": barcodes,
      "sharpness": measured.sharpness,
      "motion": measured.motion,
      "width": width,
      "height": height,
    ]
  }

  private static func empty(width: Int, height: Int) -> [String: Any] {
    [
      "instances": [], "barcodes": [], "sharpness": 0.0, "motion": 1.0,
      "width": width, "height": height,
    ]
  }

  /// Vision reports normalized boxes with origin bottom-left. Everything above the native
  /// boundary uses origin top-left, so the flip happens here, once.
  private static func box(_ rect: CGRect) -> [String: Any] {
    ["x": rect.minX, "y": rect.minY, "w": rect.width, "h": rect.height]
  }

  private static func visionBox(_ rect: CGRect) -> [String: Any] {
    ["x": rect.minX, "y": 1 - rect.minY - rect.height, "w": rect.width, "h": rect.height]
  }

  private static func readBarcodes(
    pixelBuffer: CVPixelBuffer, orientation: CGImagePropertyOrientation
  ) -> [[String: Any]] {
    let request = VNDetectBarcodesRequest()
    // Retail symbologies only. Every extra symbology is scan time spent on formats that will
    // never appear on a grocery item.
    request.symbologies = [.ean13, .ean8, .upce, .code128]

    let handler = VNImageRequestHandler(
      cvPixelBuffer: pixelBuffer, orientation: orientation, options: [:])
    guard (try? handler.perform([request])) != nil else { return [] }

    return (request.results ?? []).compactMap { observation in
      guard let payload = observation.payloadStringValue, !payload.isEmpty else { return nil }
      return [
        "payload": payload,
        "symbology": observation.symbology.rawValue,
        "box": visionBox(observation.boundingBox),
      ]
    }
  }
}
```

Note that `MaskContour` already emits polygons and boxes with origin top-left, so `box(_:)` does not flip. Barcode observations come straight from Vision and do, which is why `visionBox(_:)` exists separately. Do not merge the two.

- [ ] **Step 3: Register the new Swift files with the Xcode target**

Tasks 6 through 8 created four Swift files that `swiftc` compiled directly. The app build will not see them until they are members of the Xcode target. The repository already has `scripts/register-xcode-file.js` for exactly this, and it currently hardcodes a two-file list.

Replace its file list:

```js
const FILES = [
  'KartVisionFrameProcessorPlugin.swift',
  'KartVisionFrameProcessorPlugin.m',
  'KartDetector.swift',
  'MaskContour.swift',
  'FrameMetrics.swift',
  'AppleInstanceMaskDetector.swift',
];

for (const file of FILES) {
```

The rest of the script already skips files it has seen, so it is safe to run repeatedly.

Add an npm script for it in `package.json`:

```json
"xcode:register": "node scripts/register-xcode-file.js"
```

Run: `npm run xcode:register`
Expected: four `Registered ...` lines and two `already registered, skipping` lines.

- [ ] **Step 4: Verify the plugin compiles**

The plugin imports `VisionCamera` and therefore only compiles inside an app build, not under `npm run test:swift`.

Run: `npx expo run:ios --no-bundler`

Expected: the build succeeds. If the pod project has not picked up the new Swift files, run `cd ios && pod install` first. Do not run the app yet; Task 12 wires the screen.

A Swift compile error naming `DetectedInstance` or `MaskContour` as unresolved means Step 3 did not take. Check the target membership before touching the source.

- [ ] **Step 5: Commit**

```bash
git add ios/Kart/KartVisionFrameProcessorPlugin.swift src/engine/liveVision/config.ts scripts/register-xcode-file.js ios/Kart.xcodeproj/project.pbxproj package.json
git commit -m "feat: rewrite frame processor around the detector, barcodes and metrics"
```

---

### Task 10: Pipeline rewiring

Binds the new plugin shape and joins the tracker to the keyframe gate. This is also where the label-matching design is deleted.

**Files:**
- Modify: `src/engine/liveVision/frameProcessor.ts`
- Modify: `src/engine/liveVision/pipeline.ts`
- Modify: `src/engine/liveVision/types.ts`
- Test: `src/engine/liveVision/__tests__/pipeline.test.ts` (rewrite)
- Delete: `src/engine/liveVision/labelCatalog.ts`, `src/engine/liveVision/labelMatcher.ts`, `src/engine/liveVision/tracker.ts`, and the tests `__tests__/labelMatcher.test.ts`, `__tests__/tracker.test.ts`, `__tests__/integration.test.ts`

**Interfaces:**
- Consumes: `updateTracks`, `createTrackerState`; `evaluateKeyframe`, `createKeyframeState`; `ENABLE_BARCODE_FAST_PATH`.
- Produces:
  - `interface BarcodeHit { payload: string; symbology: string; box: Box }`
  - `interface FrameScan { instances: DetectedInstance[]; barcodes: BarcodeHit[]; sharpness: number; motion: number; width: number; height: number }`
  - `function scanCart(frame: Frame): FrameScan` (a worklet)
  - `interface PipelineState { tracker: TrackerState; keyframe: KeyframeState }`
  - `function createPipelineState(): PipelineState`
  - `function processFrame(state: PipelineState, scan: FrameScan, now: number): { state: PipelineState; tracks: Track[]; keyframe: { fire: boolean; reason: KeyframeReason } }`

- [ ] **Step 1: Write the failing test**

Replace the contents of `src/engine/liveVision/__tests__/pipeline.test.ts`:

```ts
import { createPipelineState, processFrame } from '../pipeline';
import type { FrameScan } from '../types';

function scan(overrides: Partial<FrameScan> = {}): FrameScan {
  return {
    instances: [
      {
        box: { x: 0.2, y: 0.2, w: 0.2, h: 0.2 },
        polygon: [0.2, 0.2, 0.4, 0.2, 0.4, 0.4, 0.2, 0.4],
        score: 0.9,
      },
    ],
    barcodes: [],
    sharpness: 400,
    motion: 0.003,
    width: 1080,
    height: 1920,
    ...overrides,
  };
}

describe('processFrame', () => {
  it('turns detections into tracks', () => {
    const { tracks } = processFrame(createPipelineState(), scan(), 1000);
    expect(tracks).toHaveLength(1);
    expect(tracks[0].polygon).toHaveLength(8);
  });

  it('opens the keyframe gate on a sharp, still frame', () => {
    const { keyframe } = processFrame(createPipelineState(), scan(), 1000);
    expect(keyframe.fire).toBe(true);
  });

  it('holds the gate on a blurry frame but still tracks', () => {
    const { keyframe, tracks } = processFrame(createPipelineState(), scan({ sharpness: 5 }), 1000);
    expect(keyframe.fire).toBe(false);
    expect(keyframe.reason).toBe('blurry');
    expect(tracks).toHaveLength(1);
  });

  it('attaches a barcode whose centre falls inside a track', () => {
    const hit = {
      payload: '0038000138416',
      symbology: 'VNBarcodeSymbologyEAN13',
      box: { x: 0.26, y: 0.26, w: 0.06, h: 0.03 },
    };
    const { tracks } = processFrame(createPipelineState(), scan({ barcodes: [hit] }), 1000);
    expect(tracks[0].barcode).toBe('0038000138416');
  });

  it('ignores a barcode that falls outside every track', () => {
    const hit = {
      payload: '0038000138416',
      symbology: 'VNBarcodeSymbologyEAN13',
      box: { x: 0.8, y: 0.8, w: 0.06, h: 0.03 },
    };
    const { tracks } = processFrame(createPipelineState(), scan({ barcodes: [hit] }), 1000);
    expect(tracks[0].barcode).toBeNull();
  });

  it('keeps a barcode once seen, even when the next frame cannot read it', () => {
    // Barcodes decode intermittently as the cart shifts. Forgetting one the instant it stops
    // decoding would throw away the only certain identification the pipeline ever gets.
    const hit = {
      payload: '0038000138416',
      symbology: 'VNBarcodeSymbologyEAN13',
      box: { x: 0.26, y: 0.26, w: 0.06, h: 0.03 },
    };
    let result = processFrame(createPipelineState(), scan({ barcodes: [hit] }), 1000);
    result = processFrame(result.state, scan(), 1300);
    expect(result.tracks[0].barcode).toBe('0038000138416');
  });

  it('carries tracker and keyframe state forward', () => {
    let result = processFrame(createPipelineState(), scan(), 1000);
    result = processFrame(result.state, scan(), 1300);
    expect(result.tracks).toHaveLength(1);
    expect(result.tracks[0].hits).toBe(2);
    expect(result.keyframe.fire).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/engine/liveVision/__tests__/pipeline.test.ts`
Expected: FAIL, `processFrame` has the wrong signature.

- [ ] **Step 3: Add the remaining types**

Append to `src/engine/liveVision/types.ts`:

```ts
export interface BarcodeHit {
  payload: string;
  symbology: string;
  box: Box;
}

/** Exactly what the native frame processor returns for one frame. */
export interface FrameScan {
  instances: DetectedInstance[];
  barcodes: BarcodeHit[];
  sharpness: number;
  motion: number;
  /** Upright frame dimensions, already corrected for sensor rotation natively. */
  width: number;
  height: number;
}

export interface PipelineState {
  tracker: TrackerState;
  keyframe: KeyframeState;
}
```

- [ ] **Step 4: Bind the plugin**

Replace the contents of `src/engine/liveVision/frameProcessor.ts`:

```ts
import { VisionCameraProxy, type Frame } from 'react-native-vision-camera';
import { ENABLE_BARCODE_FAST_PATH } from './config';
import type { FrameScan } from './types';

// Wrapped in try/catch: this runs at module scope, and route modules under expo-router load
// eagerly at app boot, before the scan screen even mounts. If frame processors are ever
// unavailable (for example a build that dropped the native plugin), this must degrade to null
// here rather than throw and crash the whole app before the user ever reaches the scan screen.
let plugin: ReturnType<typeof VisionCameraProxy.initFrameProcessorPlugin> | null = null;
try {
  plugin = VisionCameraProxy.initFrameProcessorPlugin('scanGroceryItem', {});
} catch {
  plugin = null;
}

const EMPTY: FrameScan = {
  instances: [],
  barcodes: [],
  sharpness: 0,
  motion: 1,
  width: 0,
  height: 0,
};

export function scanCart(frame: Frame): FrameScan {
  'worklet';
  if (plugin == null) {
    throw new Error(
      'Failed to load Frame Processor Plugin "scanGroceryItem". Did the native build include KartVisionFrameProcessorPlugin?',
    );
  }

  const raw = plugin.call(frame, { barcodes: ENABLE_BARCODE_FAST_PATH }) as unknown as FrameScan | null;
  if (raw == null) return EMPTY;

  // The plugin returns plain JSI values, so this is a shape guard rather than a parse. A
  // malformed frame must degrade to "saw nothing", never take the camera down.
  return {
    instances: raw.instances ?? [],
    barcodes: raw.barcodes ?? [],
    sharpness: raw.sharpness ?? 0,
    motion: raw.motion ?? 1,
    width: raw.width ?? 0,
    height: raw.height ?? 0,
  };
}
```

- [ ] **Step 5: Rewire the pipeline**

Replace the contents of `src/engine/liveVision/pipeline.ts`:

```ts
import { createTrackerState, updateTracks } from './byteTrack';
import { createKeyframeState, evaluateKeyframe } from './keyframe';
import type { BarcodeHit, FrameScan, KeyframeReason, PipelineState, Track } from './types';

export function createPipelineState(): PipelineState {
  return { tracker: createTrackerState(), keyframe: createKeyframeState() };
}

/**
 * Assigns each decoded barcode to the track it sits on top of.
 *
 * A barcode already attached to a track is never cleared by a frame that failed to decode it.
 * Barcodes read intermittently as the cart shifts, and a decoded UPC is the only certain
 * identification this pipeline ever produces, so it is kept once earned.
 */
function attachBarcodes(tracks: Track[], barcodes: BarcodeHit[]): Track[] {
  if (barcodes.length === 0) return tracks;

  return tracks.map((track) => {
    if (track.barcode !== null) return track;

    const hit = barcodes.find((barcode) => {
      const cx = barcode.box.x + barcode.box.w / 2;
      const cy = barcode.box.y + barcode.box.h / 2;
      return (
        cx >= track.box.x &&
        cx <= track.box.x + track.box.w &&
        cy >= track.box.y &&
        cy <= track.box.y + track.box.h
      );
    });

    return hit ? { ...track, barcode: hit.payload } : track;
  });
}

export function processFrame(
  state: PipelineState,
  scan: FrameScan,
  now: number,
): { state: PipelineState; tracks: Track[]; keyframe: { fire: boolean; reason: KeyframeReason } } {
  const tracker = updateTracks(state.tracker, scan.instances, now);
  const tracks = attachBarcodes(tracker.tracks, scan.barcodes);

  // The gate counts confirmed tracks, not raw detections. A frame whose only content is
  // unconfirmed noise is not worth an upload.
  const confirmed = tracks.filter((track) => track.state === 'confirmed').length;
  const keyframe = evaluateKeyframe(state.keyframe, {
    sharpness: scan.sharpness,
    motion: scan.motion,
    trackCount: confirmed,
    now,
  });

  return {
    state: { tracker: { ...tracker, tracks }, keyframe: keyframe.state },
    tracks,
    keyframe: { fire: keyframe.fire, reason: keyframe.reason },
  };
}
```

- [ ] **Step 6: Delete the label-matching design**

```bash
git rm src/engine/liveVision/labelCatalog.ts \
       src/engine/liveVision/labelMatcher.ts \
       src/engine/liveVision/tracker.ts \
       src/engine/liveVision/__tests__/labelMatcher.test.ts \
       src/engine/liveVision/__tests__/tracker.test.ts \
       src/engine/liveVision/__tests__/integration.test.ts
```

The old tracker tests are deleted rather than ported because they assert against `TrackedCandidate` and SKU matching, neither of which exists any more. Their intent lives on in `byteTrack.test.ts`, which covers the same jitter and occlusion behaviour against the replacement.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx jest src/engine/liveVision`
Expected: PASS. `scan.tsx` still references removed modules and will not typecheck until Task 12.

- [ ] **Step 8: Commit**

```bash
git add -A src/engine/liveVision
git commit -m "feat: rewire pipeline to tracker and keyframe gate, drop label matching"
```

---

### Task 11: Polygon overlay

Draws the item silhouette instead of a rectangle. This is the visible deliverable of the whole plan: point the camera at a cart and see an outline on each item.

The green tint, the check mark and the amber low-confidence state are removed here rather than kept, because they are currently driven by the SKU matcher being deleted and would otherwise be showing confidence the pipeline no longer has. Plan 3 restores them, attached to real identities.

**Files:**
- Modify: `src/engine/liveVision/geometry.ts`
- Modify: `src/components/ItemHighlights.tsx` (rewrite)
- Test: `src/engine/liveVision/__tests__/geometry.test.ts` (append)

**Interfaces:**
- Consumes: `Track` from `../engine/liveVision/types`.
- Produces: `function polygonToSvgPath(polygon: Polygon, width: number, height: number, offsetX?: number, offsetY?: number): string`, and `ItemHighlights` now taking `{ tracks: Track[]; frameSize: { width: number; height: number } | null }`.

- [ ] **Step 1: Write the failing test**

Append to `src/engine/liveVision/__tests__/geometry.test.ts`:

```ts
import { polygonToSvgPath } from '../geometry';

describe('polygonToSvgPath', () => {
  it('builds a closed path in view coordinates', () => {
    const path = polygonToSvgPath([0, 0, 0.5, 0, 0.5, 0.5], 100, 200);
    expect(path).toBe('M0 0L50 0L50 100Z');
  });

  it('applies the offset for a cover-fit camera', () => {
    // Three points, not two: a two-point fixture here would be rejected by the "fewer than
    // three points" guard asserted in the next test, so the two expectations would contradict.
    expect(polygonToSvgPath([0, 0, 1, 0, 1, 1], 100, 100, 10, 20)).toBe('M10 20L110 20L110 120Z');
  });

  it('returns an empty string for a polygon with fewer than three points', () => {
    expect(polygonToSvgPath([0.1, 0.1, 0.2, 0.2], 100, 100)).toBe('');
    expect(polygonToSvgPath([], 100, 100)).toBe('');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/engine/liveVision/__tests__/geometry.test.ts`
Expected: FAIL, `polygonToSvgPath` is not exported.

- [ ] **Step 3: Implement the path builder**

Append to `src/engine/liveVision/geometry.ts`:

```ts
/**
 * Converts a normalized polygon into an SVG path in view coordinates.
 *
 * Coordinates are rounded to whole pixels. Sub-pixel precision costs path string length on
 * every track on every update and buys nothing at the size these outlines are drawn.
 */
export function polygonToSvgPath(
  polygon: Polygon,
  width: number,
  height: number,
  offsetX = 0,
  offsetY = 0,
): string {
  // Length alone is not enough. Polygons arrive from the device pipeline, where a
  // degenerate filter state can yield NaN or Infinity, and those would render as a
  // literal "LNaN 50" inside the path data rather than being skipped.
  if (polygon.length < 6 || polygon.some((n) => !Number.isFinite(n))) return '';

  let path = '';
  for (let i = 0; i < polygon.length - 1; i += 2) {
    const x = Math.round(offsetX + polygon[i] * width);
    const y = Math.round(offsetY + polygon[i + 1] * height);
    path += `${i === 0 ? 'M' : 'L'}${x} ${y}`;
  }
  return `${path}Z`;
}
```

- [ ] **Step 4: Rewrite the overlay**

Replace the contents of `src/components/ItemHighlights.tsx`:

```tsx
import React, { useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { polygonToSvgPath } from '../engine/liveVision/geometry';
import type { Track } from '../engine/liveVision/types';

/**
 * Draws the detector's outline around each tracked item over the live camera feed.
 *
 * Plan 2 has no identities yet, so every confirmed item gets the same neutral treatment and a
 * track that is still forming is drawn fainter. The green counted state, the check mark and the
 * amber "come closer" state arrive in Plan 3, once an outline can actually mean something.
 *
 * No animation library here on purpose. Outlines update at the detector's rate, and animating
 * SVG path fills adds a moving part for smoothness the Kalman filter already provides.
 */

const OUTLINE = 'rgba(255, 255, 255, 0.95)';
const TINT = 'rgba(255, 255, 255, 0.14)';
const FORMING_OUTLINE = 'rgba(255, 255, 255, 0.45)';

interface ItemHighlightsProps {
  tracks: Track[];
  frameSize: { width: number; height: number } | null;
}

export function ItemHighlights({ tracks, frameSize }: ItemHighlightsProps) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ w: width, h: height });
  };

  // The camera renders with contentFit cover, so the frame is scaled up until it fills the
  // view and the overflow is split evenly off both edges. Outlines have to follow the same
  // mapping or they sit next to their items instead of on them.
  const ready = size !== null && frameSize !== null && frameSize.width > 0 && frameSize.height > 0;
  const scale = ready ? Math.max(size.w / frameSize.width, size.h / frameSize.height) : 1;
  const displayW = ready ? frameSize.width * scale : 0;
  const displayH = ready ? frameSize.height * scale : 0;
  const offsetX = ready ? (size.w - displayW) / 2 : 0;
  const offsetY = ready ? (size.h - displayH) / 2 : 0;

  return (
    <View style={StyleSheet.absoluteFill} onLayout={onLayout} pointerEvents="none">
      {ready ? (
        <Svg style={StyleSheet.absoluteFill} width={size.w} height={size.h}>
          {tracks.map((track) => {
            if (track.state === 'lost') return null;
            const d = polygonToSvgPath(track.polygon, displayW, displayH, offsetX, offsetY);
            if (d === '') return null;
            const forming = track.state === 'tentative';
            return (
              <Path
                key={track.id}
                d={d}
                fill={forming ? 'none' : TINT}
                stroke={forming ? FORMING_OUTLINE : OUTLINE}
                strokeWidth={2}
                strokeLinejoin="round"
              />
            );
          })}
        </Svg>
      ) : null}
    </View>
  );
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest src/engine/liveVision/__tests__/geometry.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/engine/liveVision/geometry.ts src/components/ItemHighlights.tsx src/engine/liveVision/__tests__/geometry.test.ts
git commit -m "feat: draw item silhouettes as SVG polygons instead of rectangles"
```

---

### Task 12: Scan screen and deployment target

Joins everything to the camera and lifts the deployment target to the version the instance mask request needs. After this task the branch typechecks again.

**Files:**
- Modify: `src/app/scan.tsx`
- Modify: `ios/Podfile`
- Modify: `ios/Kart.xcodeproj/project.pbxproj`
- Modify: `app.json`
- Modify: `package.json`

**Interfaces:**
- Consumes: `scanCart`, `createPipelineState`, `processFrame`, `DETECT_TARGET_FPS`, `ItemHighlights`.
- Produces: nothing downstream. This is the leaf.

- [ ] **Step 1: Raise the deployment target**

`VNGenerateForegroundInstanceMaskRequest` is iOS 17.0 and later. Three places hold the current 16.4.

In `ios/Podfile`, line 26:

```ruby
platform :ios, podfile_properties['ios.deploymentTarget'] || '17.0'
```

In `ios/Kart.xcodeproj/project.pbxproj`, replace all three occurrences:

```bash
sed -i '' 's/IPHONEOS_DEPLOYMENT_TARGET = 16.4;/IPHONEOS_DEPLOYMENT_TARGET = 17.0;/g' ios/Kart.xcodeproj/project.pbxproj
```

Then make it survive a future prebuild, which would otherwise regenerate both files back to the default:

```bash
npx expo install expo-build-properties
```

In `app.json`, add to `expo.plugins`:

```json
[
  "expo-build-properties",
  {
    "ios": { "deploymentTarget": "17.0" }
  }
]
```

**Never run `npx expo prebuild --clean` on this project.** The custom Swift files under `ios/Kart/` are not generated by any config plugin, and a clean prebuild deletes them.

- [ ] **Step 2: Rewire the scan screen**

In `src/app/scan.tsx`, replace the import block for the live vision modules:

```tsx
import { DETECT_TARGET_FPS } from '../engine/liveVision/config';
import { scanCart } from '../engine/liveVision/frameProcessor';
import { createPipelineState, processFrame } from '../engine/liveVision/pipeline';
import type { FrameScan, Track } from '../engine/liveVision/types';
```

and delete these three imports, whose modules no longer exist:

```tsx
import { CATALOG } from '../engine/catalog';
import { evaluateCoverageHint } from '../engine/liveVision/coverageHint';
import { scanGroceryItem } from '../engine/liveVision/frameProcessor';
```

`CATALOG` leaves the live path entirely. Under an open vocabulary it is no longer a whitelist of what can be recognized, and Plan 3 reintroduces it as a cache of products already seen.

Replace the four state and ref declarations:

```tsx
const pipelineStateRef = useRef(createPipelineState());
const keyframeCountRef = useRef(0);
const [tracks, setTracks] = useState<Track[]>([]);
const [frameSize, setFrameSize] = useState<{ width: number; height: number } | null>(null);
```

and delete `lastLockedAtRef`, `hintActiveRef` and `liveCandidates`.

Replace `handleRegions` and `frameProcessor` with:

```tsx
// Stable identity across renders: react-native-vision-camera requires the frame processor
// (and therefore this handler) not to change identity every render, or the native Frame
// Processor Context gets torn down and reinstalled repeatedly. Safe to build once, because
// the body only closes over refs and stable setState and module imports.
const handleScan = useMemo(
  () =>
    Worklets.createRunOnJS((scan: FrameScan) => {
      const now = Date.now();
      if (scan.width > 0 && scan.height > 0) {
        setFrameSize({ width: scan.width, height: scan.height });
      }

      const result = processFrame(pipelineStateRef.current, scan, now);
      pipelineStateRef.current = result.state;
      setTracks(result.tracks);

      // Plan 2 only decides that a frame is worth uploading. Plan 3 is what uploads it. The
      // counter exists so the gate can be shown to be opening on real hardware rather than
      // assumed to be.
      if (result.keyframe.fire) keyframeCountRef.current += 1;
    }),
  [],
);

const frameProcessor = useFrameProcessor(
  (frame) => {
    'worklet';
    // Detection is the expensive call, so it runs a few times a second rather than every
    // frame. The overlay stays smooth because the tracker predicts between detections, and
    // the frame's upright dimensions now come back from native with the result.
    runAtTargetFps(DETECT_TARGET_FPS, () => {
      'worklet';
      handleScan(scanCart(frame));
    });
  },
  [handleScan],
);
```

Replace the startup effect, which seeded the deleted hint timer:

```tsx
useEffect(() => {
  useScanline.getState().startScan();
}, []);
```

Update the overlay usage:

```tsx
<ItemHighlights tracks={tracks} frameSize={frameSize} />
```

Leave `BagTray`, `DetectionRow`, `aggregate` and the close confirmation alone. They read from `scan.detections`, which stays empty for the whole of Plan 2 because nothing is named yet. An empty bag is the expected state here, not a regression to chase.

- [ ] **Step 3: Typecheck and test the whole project**

```bash
npx tsc --noEmit
npx jest
npm run test:swift
```

Expected: all three clean. If `tsc` still reports missing modules, a reference to a deleted module was missed; find it with `grep -rn "labelMatcher\|labelCatalog\|coverageHint\|scanGroceryItem\|TrackedCandidate" src/`.

- [ ] **Step 4: Build and verify on hardware**

```bash
npx expo run:ios --device
```

The camera cannot be exercised in the Simulator, so the live overlay can only be confirmed on a real phone. Verify by screenshot, per the project's UI rule, and check all four:

1. Outlines appear on cart items, not on the floor, the cart mesh, or shadows.
2. There are far more than three of them. The old cap was the single largest cause of the original bug.
3. Outlines are **not** rotated or mirrored relative to the items. If they are, the instance mask is arriving in raw sensor orientation rather than upright. Fix it at the one conversion point in `MaskContour.instances`, not by rotating the polygons in the overlay.
4. An outline stays on its item while the phone moves, and does not flicker between shapes.

If the Simulator is all that is available, the honest partial check is that the app launches, the scan route mounts, and the camera permission prompt appears. Say so explicitly rather than reporting the overlay as verified.

- [ ] **Step 5: Commit**

```bash
git add src/app/scan.tsx ios/Podfile ios/Kart.xcodeproj/project.pbxproj app.json package.json package-lock.json
git commit -m "feat: wire the scan screen to the tracked detector overlay"
```

---

## After this plan

Two things are true at the end of Task 12 and both should be said plainly rather than discovered later.

**The detector is unmeasured.** Every piece of the pipeline above it is tested, but whether Apple's segmenter actually enumerates twenty stacked grocery items is unknown until `npm run bench:detector` runs against real photographs. That is the first thing to do when the corpus has images in it, and `docs/detector-measurement.md` is how to read the result. If the answer is bad, the fix is a Core ML detector behind the same protocol, and the licensing question in that document has to be settled before any model ships.

**The app names nothing.** Plan 3 adds the cloud client, the counting rule keyed on track identity, the in-view count clamp, and the three states the user asked for: green with a check for counted items, amber with "bring your camera closer", and the occlusion notice. Until then the branch is not something to put in front of a user.
