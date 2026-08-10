# Live Camera Scanning + Cart Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Kart's video-replay scan demo with real live camera recognition (on-device Vision, no barcodes) and make cart history survive app restarts.

**Architecture:** A Swift Frame Processor Plugin (via react-native-vision-camera) runs Apple Vision's saliency detector, classifier, and text recognizer on throttled camera frames and returns raw regions to JS. A pure JS pipeline (label matcher + IoU-based candidate tracker) turns that noisy stream into stable forming/tentative/locked items and calls the existing `store.addDetection`. The zustand store persists `hauls` via AsyncStorage.

**Tech Stack:** Expo SDK 57, React Native 0.86, react-native-vision-camera 4.7.3, react-native-worklets-core, Apple Vision (VNGenerateObjectnessBasedSaliencyImageRequest, VNClassifyImageRequest, VNRecognizeTextRequest), zustand 5 persist middleware, @react-native-async-storage/async-storage, Jest (jest-expo preset).

## Global Constraints

- No barcode/UPC scanning anywhere in this feature — recognition is visual only, per the approved spec.
- Pin `react-native-vision-camera` to `4.7.3`, not the `latest` (5.x) tag. Version 5 moved Frame Processor Plugins to a Nitro Modules codegen architecture; 4.7.3 uses the simpler, stable `FrameProcessorPlugin` Swift subclass API this plan is built on. Do not run `npm install react-native-vision-camera` without the version pin.
- Confidence thresholds (yellow floor, green/lock threshold, dwell time, IoU match threshold, loss tolerance) are starting points to tune on a real device, not fixed requirements. Default values are provided in Task 4; expect to adjust them during Task 13.
- The iOS Simulator has no real camera. Tasks 1–7 (pure logic) are fully testable without hardware. Tasks 8–12 are verified by "does it build and launch"; true recognition behavior can only be confirmed on a physical device, which is what Task 13 is for.
- Two distinct physical items of the same SKU must both count (two bags of chips = qty 2). This is validated explicitly in Task 4 and Task 5's tests — don't regress it by deduping on `skuCode` anywhere in the pipeline.
- `ios/` gets committed to git starting in Task 8 (see that task for why). Don't add it back to `.gitignore`.

---

### Task 1: Add a test runner

**Files:**
- Modify: `package.json`
- Create: `src/engine/liveVision/__tests__/smoke.test.ts`

**Interfaces:**
- Produces: `npm test` runs Jest. All later pure-logic tasks depend on this.

- [ ] **Step 1: Install Jest**

```bash
npm install --save-dev jest jest-expo @types/jest
```

- [ ] **Step 2: Add the test script and Jest config to package.json**

Add to `package.json`:

```json
  "scripts": {
    "test": "jest"
  },
  "jest": {
    "preset": "jest-expo"
  }
```
(Add `"test": "jest"` alongside the existing scripts; add the top-level `"jest"` key as a sibling of `"scripts"`.)

- [ ] **Step 3: Write a smoke test**

```typescript
// src/engine/liveVision/__tests__/smoke.test.ts
describe('test runner', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 4: Run it**

Run: `npm test`
Expected: 1 passed, 1 total.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/engine/liveVision/__tests__/smoke.test.ts
git commit -m "test: add jest-expo test runner"
```

---

### Task 2: Box geometry (IoU)

**Files:**
- Create: `src/engine/liveVision/types.ts`
- Create: `src/engine/liveVision/geometry.ts`
- Test: `src/engine/liveVision/__tests__/geometry.test.ts`

**Interfaces:**
- Produces: `Box { x, y, w, h }` (normalized 0–1, origin top-left), `intersectionOverUnion(a: Box, b: Box): number`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/engine/liveVision/__tests__/geometry.test.ts
import { intersectionOverUnion } from '../geometry';
import type { Box } from '../types';

describe('intersectionOverUnion', () => {
  it('returns 1 for identical boxes', () => {
    const a: Box = { x: 0.1, y: 0.1, w: 0.2, h: 0.2 };
    expect(intersectionOverUnion(a, a)).toBeCloseTo(1);
  });

  it('returns 0 for non-overlapping boxes', () => {
    const a: Box = { x: 0, y: 0, w: 0.1, h: 0.1 };
    const b: Box = { x: 0.5, y: 0.5, w: 0.1, h: 0.1 };
    expect(intersectionOverUnion(a, b)).toBe(0);
  });

  it('returns the correct fraction for partial overlap', () => {
    // Two 0.1x0.2 boxes overlapping by 0.05x0.2: intersection = 0.01,
    // union = 0.02 + 0.02 - 0.01 = 0.03, IoU = 1/3.
    const a: Box = { x: 0, y: 0, w: 0.1, h: 0.2 };
    const b: Box = { x: 0.05, y: 0, w: 0.1, h: 0.2 };
    expect(intersectionOverUnion(a, b)).toBeCloseTo(1 / 3, 5);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- geometry`
Expected: FAIL, `Cannot find module '../geometry'`.

- [ ] **Step 3: Write the types and implementation**

```typescript
// src/engine/liveVision/types.ts
/** Normalized to the camera frame, origin top-left, values 0-1. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
```

```typescript
// src/engine/liveVision/geometry.ts
import type { Box } from './types';

export function intersectionOverUnion(a: Box, b: Box): number {
  const ax2 = a.x + a.w;
  const ay2 = a.y + a.h;
  const bx2 = b.x + b.w;
  const by2 = b.y + b.h;

  const interX = Math.max(0, Math.min(ax2, bx2) - Math.max(a.x, b.x));
  const interY = Math.max(0, Math.min(ay2, by2) - Math.max(a.y, b.y));
  const interArea = interX * interY;

  if (interArea === 0) return 0;

  const unionArea = a.w * a.h + b.w * b.h - interArea;
  return unionArea === 0 ? 0 : interArea / unionArea;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -- geometry`
Expected: PASS, 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/engine/liveVision/types.ts src/engine/liveVision/geometry.ts src/engine/liveVision/__tests__/geometry.test.ts
git commit -m "feat: add box IoU geometry helper"
```

---

### Task 3: Label matching against the catalog

**Files:**
- Create: `src/engine/liveVision/labelCatalog.ts`
- Create: `src/engine/liveVision/labelMatcher.ts`
- Modify: `src/engine/liveVision/types.ts`
- Test: `src/engine/liveVision/__tests__/labelMatcher.test.ts`

**Interfaces:**
- Consumes: `Sku` from `src/engine/types.ts` (existing: `{ id, code, name, price, emoji, category }`), `CATALOG` from `src/engine/catalog.ts` (existing).
- Produces: `MatchResult { skuCode: string | null; matchConfidence: number }`, `matchRegion(region: { label: string; confidence: number; ocrText?: string }, catalog: Sku[]): MatchResult`.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/engine/liveVision/__tests__/labelMatcher.test.ts
import { matchRegion } from '../labelMatcher';
import { CATALOG } from '../../catalog';

describe('matchRegion', () => {
  it('matches a produce label directly, no OCR needed', () => {
    const result = matchRegion({ label: 'grape', confidence: 0.61 }, CATALOG);
    expect(result.skuCode).toBe('0417');
    expect(result.matchConfidence).toBeCloseTo(0.61);
  });

  it('resolves an ambiguous packaged-goods label using OCR text', () => {
    const result = matchRegion(
      { label: 'bottle', confidence: 0.4, ocrText: 'OAT MILK 64 OZ UNSWEETENED' },
      CATALOG,
    );
    expect(result.skuCode).toBe('1126'); // Oat milk, 64 oz
  });

  it('picks the better OCR match among several ambiguous candidates', () => {
    const result = matchRegion(
      { label: 'bottle', confidence: 0.4, ocrText: 'COLD BREW CONCENTRATE' },
      CATALOG,
    );
    expect(result.skuCode).toBe('5565'); // Cold brew concentrate, 32 oz
  });

  it('returns null when a label is ambiguous and there is no OCR text', () => {
    const result = matchRegion({ label: 'bottle', confidence: 0.4 }, CATALOG);
    expect(result.skuCode).toBeNull();
    expect(result.matchConfidence).toBe(0);
  });

  it('returns null for a label with no catalog mapping at all', () => {
    const result = matchRegion({ label: 'shoe', confidence: 0.9 }, CATALOG);
    expect(result.skuCode).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- labelMatcher`
Expected: FAIL, `Cannot find module '../labelMatcher'`.

- [ ] **Step 3: Add the MatchResult type**

Append to `src/engine/liveVision/types.ts`:

```typescript
export interface MatchResult {
  skuCode: string | null;
  /** 0-1. How confident this match is, combining the model's label confidence and, for
   * ambiguous labels, how well the OCR text matched the winning candidate's name. */
  matchConfidence: number;
}
```

- [ ] **Step 4: Write the keyword table**

```typescript
// src/engine/liveVision/labelCatalog.ts
/**
 * Maps a Vision classify label to one or more candidate SKU codes.
 * A single-entry array means the label alone is enough (mainly produce,
 * where shape and color are distinctive). Multi-entry arrays are visually
 * ambiguous categories (mainly packaged goods) that need OCR text on the
 * package to disambiguate, the same way a person reads the label to tell
 * two boxes apart.
 */
export const LABEL_TO_SKU: Record<string, string[]> = {
  banana: ['0411'],
  apple: ['0412'],
  avocado: ['0413'],
  spinach: ['0414'],
  tomato: ['0415'],
  onion: ['0416', '0425'], // Vision reads garlic as onion more often than not
  grape: ['0417'],
  lemon: ['0418'],
  orange: ['0419'],
  pineapple: ['0420'],
  watermelon: ['0421'],
  strawberry: ['0422'],
  bell_pepper: ['0423'],
  corn: ['0424'],
  garlic: ['0425'],
  egg: ['1122'],
  butter: ['1123'],
  cheese: ['1125'],
  bread: ['2231'],
  bagel: ['2232'],
  croissant: ['2233'],
  tortilla: ['2234'],
  chicken: ['3341'],
  ground_meat: ['3342'],
  salmon: ['3343'],
  bacon: ['3344'],
  pasta: ['4451'],
  rice: ['4453'],
  peanut_butter: ['4454'],
  olive_oil: ['4456'],
  can: ['4457', '4458'],
  chips: ['5561'],
  chocolate_bar: ['5562'],
  trail_mix: ['5563'],
  paper_towels: ['6671'],
  trash_bags: ['6674'],
  // Ambiguous silhouettes: several catalog SKUs all look like "a bottle"
  // or "a carton" from the outside. Label alone isn't enough here.
  bottle: ['1121', '1126', '5564', '5565', '5566'],
  jug: ['1121', '1126'],
  box: ['4455', '6673'],
};
```

- [ ] **Step 5: Write the matcher**

```typescript
// src/engine/liveVision/labelMatcher.ts
import type { Sku } from '../types';
import type { MatchResult } from './types';
import { LABEL_TO_SKU } from './labelCatalog';

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 1),
  );
}

/** Fraction of the catalog name's own tokens that also appear in the OCR text. */
function ocrOverlapScore(catalogName: string, ocrText: string): number {
  const nameTokens = tokenize(catalogName);
  if (nameTokens.size === 0) return 0;
  const ocrTokens = tokenize(ocrText);
  let hits = 0;
  for (const token of nameTokens) {
    if (ocrTokens.has(token)) hits += 1;
  }
  return hits / nameTokens.size;
}

export function matchRegion(
  region: { label: string; confidence: number; ocrText?: string },
  catalog: Sku[],
): MatchResult {
  const candidates = LABEL_TO_SKU[region.label];
  if (!candidates || candidates.length === 0) {
    return { skuCode: null, matchConfidence: 0 };
  }

  if (candidates.length === 1) {
    return { skuCode: candidates[0], matchConfidence: region.confidence };
  }

  // Ambiguous label: use OCR text to pick the best-scoring candidate.
  if (!region.ocrText) {
    return { skuCode: null, matchConfidence: 0 };
  }

  let best: { skuCode: string; score: number } | null = null;
  for (const skuCode of candidates) {
    const sku = catalog.find((s) => s.code === skuCode);
    if (!sku) continue;
    const score = ocrOverlapScore(sku.name, region.ocrText);
    if (score > 0 && (best === null || score > best.score)) {
      best = { skuCode, score };
    }
  }

  if (!best) return { skuCode: null, matchConfidence: 0 };
  return { skuCode: best.skuCode, matchConfidence: Math.min(region.confidence, best.score) };
}
```

- [ ] **Step 6: Run it to verify it passes**

Run: `npm test -- labelMatcher`
Expected: PASS, 5 passed.

- [ ] **Step 7: Commit**

```bash
git add src/engine/liveVision/types.ts src/engine/liveVision/labelCatalog.ts src/engine/liveVision/labelMatcher.ts src/engine/liveVision/__tests__/labelMatcher.test.ts
git commit -m "feat: add Vision label to catalog SKU matching"
```

---

### Task 4: Candidate tracker (the duplicate-counting fix)

**Files:**
- Modify: `src/engine/liveVision/types.ts`
- Create: `src/engine/liveVision/tracker.ts`
- Test: `src/engine/liveVision/__tests__/tracker.test.ts`

**Interfaces:**
- Consumes: `Box` and `intersectionOverUnion` from `geometry.ts` (Task 2).
- Produces: `CandidateState = 'forming' | 'tentative' | 'locked'`, `TrackedCandidate`, `TrackerEvent { type: 'locked'; candidateId: string; skuCode: string; confidence: number }`, `createTrackerState(): TrackedCandidate[]`, `updateTracker(candidates: TrackedCandidate[], matchedRegions: MatchedRegion[], now: number, config?: Partial<TrackerConfig>): { candidates: TrackedCandidate[]; events: TrackerEvent[] }`.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/engine/liveVision/__tests__/tracker.test.ts
import { createTrackerState, updateTracker } from '../tracker';
import type { MatchedRegion } from '../types';

const CONFIG = { iouMatchThreshold: 0.3, lossToleranceMs: 600, yellowConfidence: 0.2, greenConfidence: 0.5, minDwellMs: 500 };

function region(box: MatchedRegion['box'], skuCode: string | null, confidence: number): MatchedRegion {
  return { box, skuCode, confidence };
}

describe('updateTracker', () => {
  it('creates a forming candidate for a new region with no confident match', () => {
    const { candidates, events } = updateTracker(
      createTrackerState(),
      [region({ x: 0, y: 0, w: 0.1, h: 0.1 }, null, 0)],
      0,
      CONFIG,
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0].state).toBe('forming');
    expect(events).toHaveLength(0);
  });

  it('locks a candidate after sustained high confidence for the dwell time', () => {
    const box = { x: 0, y: 0, w: 0.1, h: 0.1 };
    let state = createTrackerState();
    let events;
    ({ candidates: state, events } = updateTracker(state, [region(box, '0417', 0.7)], 0, CONFIG));
    expect(state[0].state).toBe('tentative'); // not held long enough yet
    ({ candidates: state, events } = updateTracker(state, [region(box, '0417', 0.7)], 600, CONFIG));
    expect(state[0].state).toBe('locked');
    expect(events).toEqual([{ type: 'locked', candidateId: state[0].id, skuCode: '0417', confidence: 0.7 }]);
  });

  it('stays tentative below the green threshold and never locks or fires an event', () => {
    const box = { x: 0, y: 0, w: 0.1, h: 0.1 };
    let state = createTrackerState();
    let events;
    ({ candidates: state, events } = updateTracker(state, [region(box, '0425', 0.3)], 0, CONFIG));
    ({ candidates: state, events } = updateTracker(state, [region(box, '0425', 0.3)], 600, CONFIG));
    expect(state[0].state).toBe('tentative');
    expect(events).toHaveLength(0);
  });

  it('drops a tentative candidate once it is lost, uncounted', () => {
    const box = { x: 0, y: 0, w: 0.1, h: 0.1 };
    let state = createTrackerState();
    ({ candidates: state } = updateTracker(state, [region(box, '0425', 0.3)], 0, CONFIG));
    // No matching region for longer than lossToleranceMs.
    const { candidates: after, events } = updateTracker(state, [], 1000, CONFIG);
    expect(after).toHaveLength(0);
    expect(events).toHaveLength(0);
  });

  it('counts two spatially distinct instances of the same SKU separately', () => {
    const boxA = { x: 0, y: 0, w: 0.1, h: 0.1 };
    const boxB = { x: 0.5, y: 0.5, w: 0.1, h: 0.1 };
    let state = createTrackerState();
    let events;
    ({ candidates: state, events } = updateTracker(
      state,
      [region(boxA, '5561', 0.7), region(boxB, '5561', 0.7)],
      0,
      CONFIG,
    ));
    ({ candidates: state, events } = updateTracker(
      state,
      [region(boxA, '5561', 0.7), region(boxB, '5561', 0.7)],
      600,
      CONFIG,
    ));
    const lockEvents = events.filter((e) => e.type === 'locked');
    expect(lockEvents).toHaveLength(2);
    expect(lockEvents.map((e) => e.skuCode)).toEqual(['5561', '5561']);
    expect(lockEvents[0].candidateId).not.toBe(lockEvents[1].candidateId);
  });

  it('does not unlock or re-fire once locked, even if confidence later dips', () => {
    const box = { x: 0, y: 0, w: 0.1, h: 0.1 };
    let state = createTrackerState();
    ({ candidates: state } = updateTracker(state, [region(box, '0417', 0.7)], 0, CONFIG));
    ({ candidates: state } = updateTracker(state, [region(box, '0417', 0.7)], 600, CONFIG));
    expect(state[0].state).toBe('locked');
    const { candidates: after, events } = updateTracker(state, [region(box, '0417', 0.1)], 700, CONFIG);
    expect(after[0].state).toBe('locked');
    expect(events).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- tracker`
Expected: FAIL, `Cannot find module '../tracker'`.

- [ ] **Step 3: Add the tracker types**

Append to `src/engine/liveVision/types.ts`:

```typescript
export type CandidateState = 'forming' | 'tentative' | 'locked';

export interface TrackedCandidate {
  id: string;
  box: Box;
  skuCode: string | null;
  confidence: number;
  state: CandidateState;
  lastSeenAt: number;
  /** When the current skuCode guess first reached greenConfidence, continuously. Null if not currently above it. */
  stableSince: number | null;
}

export interface TrackerConfig {
  iouMatchThreshold: number;
  lossToleranceMs: number;
  yellowConfidence: number;
  greenConfidence: number;
  minDwellMs: number;
}

export interface MatchedRegion {
  box: Box;
  skuCode: string | null;
  confidence: number;
}

export interface TrackerEvent {
  type: 'locked';
  candidateId: string;
  skuCode: string;
  confidence: number;
}
```

- [ ] **Step 4: Write the tracker**

```typescript
// src/engine/liveVision/tracker.ts
import { intersectionOverUnion } from './geometry';
import type { MatchedRegion, TrackedCandidate, TrackerConfig, TrackerEvent } from './types';

const DEFAULT_CONFIG: TrackerConfig = {
  iouMatchThreshold: 0.3,
  lossToleranceMs: 600,
  yellowConfidence: 0.2,
  greenConfidence: 0.5,
  minDwellMs: 500,
};

let idCounter = 0;
function nextCandidateId(): string {
  idCounter += 1;
  return `cand_${idCounter}`;
}

export function createTrackerState(): TrackedCandidate[] {
  return [];
}

function stateFor(confidence: number, hasSku: boolean, config: TrackerConfig): 'forming' | 'tentative' {
  if (!hasSku || confidence < config.yellowConfidence) return 'forming';
  return 'tentative';
}

export function updateTracker(
  candidates: TrackedCandidate[],
  matchedRegions: MatchedRegion[],
  now: number,
  configOverrides: Partial<TrackerConfig> = {},
): { candidates: TrackedCandidate[]; events: TrackerEvent[] } {
  const config = { ...DEFAULT_CONFIG, ...configOverrides };
  const events: TrackerEvent[] = [];
  const claimedRegions = new Set<number>();
  const nextCandidates: TrackedCandidate[] = [];

  for (const candidate of candidates) {
    // Find the best-IoU unclaimed region for this candidate.
    let bestIndex = -1;
    let bestIou = 0;
    matchedRegions.forEach((region, index) => {
      if (claimedRegions.has(index)) return;
      const iou = intersectionOverUnion(candidate.box, region.box);
      if (iou > bestIou) {
        bestIou = iou;
        bestIndex = index;
      }
    });

    if (bestIndex === -1 || bestIou < config.iouMatchThreshold) {
      // Not matched this frame. Drop if past the loss tolerance, otherwise keep as-is.
      if (now - candidate.lastSeenAt <= config.lossToleranceMs) {
        nextCandidates.push(candidate);
      }
      continue;
    }

    claimedRegions.add(bestIndex);
    const region = matchedRegions[bestIndex];

    if (candidate.state === 'locked') {
      // Already counted. Keep tracking its position, never re-evaluate or re-fire.
      nextCandidates.push({ ...candidate, box: region.box, lastSeenAt: now });
      continue;
    }

    const sameGuess = region.skuCode !== null && region.skuCode === candidate.skuCode;
    const aboveGreen = region.skuCode !== null && region.confidence >= config.greenConfidence;
    const stableSince = aboveGreen ? (sameGuess && candidate.stableSince !== null ? candidate.stableSince : now) : null;

    const updated: TrackedCandidate = {
      ...candidate,
      box: region.box,
      skuCode: region.skuCode,
      confidence: region.confidence,
      lastSeenAt: now,
      stableSince,
      state: stateFor(region.confidence, region.skuCode !== null, config),
    };

    if (stableSince !== null && now - stableSince >= config.minDwellMs) {
      updated.state = 'locked';
      events.push({ type: 'locked', candidateId: updated.id, skuCode: region.skuCode as string, confidence: region.confidence });
    }

    nextCandidates.push(updated);
  }

  // Any unclaimed region starts a brand new candidate.
  matchedRegions.forEach((region, index) => {
    if (claimedRegions.has(index)) return;
    const aboveGreen = region.skuCode !== null && region.confidence >= config.greenConfidence;
    nextCandidates.push({
      id: nextCandidateId(),
      box: region.box,
      skuCode: region.skuCode,
      confidence: region.confidence,
      lastSeenAt: now,
      stableSince: aboveGreen ? now : null,
      state: stateFor(region.confidence, region.skuCode !== null, config),
    });
  });

  return { candidates: nextCandidates, events };
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npm test -- tracker`
Expected: PASS, 6 passed.

- [ ] **Step 6: Commit**

```bash
git add src/engine/liveVision/types.ts src/engine/liveVision/tracker.ts src/engine/liveVision/__tests__/tracker.test.ts
git commit -m "feat: add IoU candidate tracker with forming/tentative/locked states"
```

---

### Task 5: Pipeline orchestrator (end-to-end frame processing)

**Files:**
- Create: `src/engine/liveVision/pipeline.ts`
- Modify: `src/engine/liveVision/types.ts`
- Test: `src/engine/liveVision/__tests__/pipeline.test.ts`

**Interfaces:**
- Consumes: `matchRegion` (Task 3), `updateTracker`/`createTrackerState` (Task 4), `CATALOG` from `../catalog`.
- Produces: `RawRegion { box: Box; label: string; confidence: number; ocrText?: string }`, `PipelineState { candidates: TrackedCandidate[] }`, `createPipelineState(): PipelineState`, `processFrame(state: PipelineState, rawRegions: RawRegion[], now: number, catalog: Sku[]): { state: PipelineState; events: TrackerEvent[] }`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/engine/liveVision/__tests__/pipeline.test.ts
import { createPipelineState, processFrame } from '../pipeline';
import { CATALOG } from '../../catalog';
import type { RawRegion } from '../types';

describe('processFrame', () => {
  it('turns two distinct chip-bag sightings into two separate lock events', () => {
    const regionA: RawRegion = { box: { x: 0, y: 0, w: 0.1, h: 0.1 }, label: 'chips', confidence: 0.7 };
    const regionB: RawRegion = { box: { x: 0.5, y: 0.5, w: 0.1, h: 0.1 }, label: 'chips', confidence: 0.7 };

    let state = createPipelineState();
    let events;
    ({ state, events } = processFrame(state, [regionA, regionB], 0, CATALOG));
    expect(events).toHaveLength(0); // not held long enough yet

    ({ state, events } = processFrame(state, [regionA, regionB], 600, CATALOG));
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.skuCode === '5561')).toBe(true);
    expect(events[0].candidateId).not.toBe(events[1].candidateId);
  });

  it('never locks a region with no catalog match', () => {
    const region: RawRegion = { box: { x: 0, y: 0, w: 0.1, h: 0.1 }, label: 'shoe', confidence: 0.95 };
    let state = createPipelineState();
    let events;
    ({ state, events } = processFrame(state, [region], 0, CATALOG));
    ({ state, events } = processFrame(state, [region], 600, CATALOG));
    expect(events).toHaveLength(0);
    expect(state.candidates[0].state).toBe('forming');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- pipeline`
Expected: FAIL, `Cannot find module '../pipeline'`.

- [ ] **Step 3: Add the RawRegion and PipelineState types**

Append to `src/engine/liveVision/types.ts`:

```typescript
export interface RawRegion {
  box: Box;
  label: string;
  confidence: number;
  ocrText?: string;
}

export interface PipelineState {
  candidates: TrackedCandidate[];
}
```

- [ ] **Step 4: Write the pipeline**

```typescript
// src/engine/liveVision/pipeline.ts
import type { Sku } from '../types';
import { matchRegion } from './labelMatcher';
import { createTrackerState, updateTracker } from './tracker';
import type { PipelineState, RawRegion, TrackerEvent } from './types';

export function createPipelineState(): PipelineState {
  return { candidates: createTrackerState() };
}

export function processFrame(
  state: PipelineState,
  rawRegions: RawRegion[],
  now: number,
  catalog: Sku[],
): { state: PipelineState; events: TrackerEvent[] } {
  const matchedRegions = rawRegions.map((region) => {
    const match = matchRegion(region, catalog);
    return { box: region.box, skuCode: match.skuCode, confidence: match.skuCode ? region.confidence : 0 };
  });

  const { candidates, events } = updateTracker(state.candidates, matchedRegions, now);
  return { state: { candidates }, events };
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npm test -- pipeline`
Expected: PASS, 2 passed.

- [ ] **Step 6: Commit**

```bash
git add src/engine/liveVision/types.ts src/engine/liveVision/pipeline.ts src/engine/liveVision/__tests__/pipeline.test.ts
git commit -m "feat: add live vision pipeline orchestrator"
```

---

### Task 6: Coverage hint trigger

**Files:**
- Create: `src/engine/liveVision/coverageHint.ts`
- Test: `src/engine/liveVision/__tests__/coverageHint.test.ts`

**Interfaces:**
- Consumes: `TrackedCandidate` (Task 4).
- Produces: `evaluateCoverageHint(candidates: TrackedCandidate[], lastLockedAt: number | null, now: number, hintActive: boolean, idleMs?: number): { showHint: boolean }`.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/engine/liveVision/__tests__/coverageHint.test.ts
import { evaluateCoverageHint } from '../coverageHint';
import type { TrackedCandidate } from '../types';

function candidate(state: TrackedCandidate['state']): TrackedCandidate {
  return { id: 'c1', box: { x: 0, y: 0, w: 0.1, h: 0.1 }, skuCode: null, confidence: 0, state, lastSeenAt: 0, stableSince: null };
}

describe('evaluateCoverageHint', () => {
  it('does not show a hint with no active candidates', () => {
    expect(evaluateCoverageHint([], null, 5000, false).showHint).toBe(false);
  });

  it('does not show a hint before the idle threshold', () => {
    expect(evaluateCoverageHint([candidate('tentative')], 0, 1000, false, 4000).showHint).toBe(false);
  });

  it('shows a hint once idle time with unresolved candidates passes the threshold', () => {
    expect(evaluateCoverageHint([candidate('tentative')], 0, 4001, false, 4000).showHint).toBe(true);
  });

  it('does not re-trigger while already active', () => {
    expect(evaluateCoverageHint([candidate('tentative')], 0, 9000, true, 4000).showHint).toBe(false);
  });

  it('does not show a hint once everything present is locked', () => {
    expect(evaluateCoverageHint([candidate('locked')], 0, 9000, false, 4000).showHint).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- coverageHint`
Expected: FAIL, `Cannot find module '../coverageHint'`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/engine/liveVision/coverageHint.ts
import type { TrackedCandidate } from './types';

export function evaluateCoverageHint(
  candidates: TrackedCandidate[],
  lastLockedAt: number | null,
  now: number,
  hintActive: boolean,
  idleMs = 4000,
): { showHint: boolean } {
  if (hintActive) return { showHint: false };

  const hasUnresolved = candidates.some((c) => c.state === 'forming' || c.state === 'tentative');
  if (!hasUnresolved) return { showHint: false };

  const since = lastLockedAt ?? 0;
  if (now - since < idleMs) return { showHint: false };

  return { showHint: true };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -- coverageHint`
Expected: PASS, 5 passed.

- [ ] **Step 5: Commit**

```bash
git add src/engine/liveVision/coverageHint.ts src/engine/liveVision/__tests__/coverageHint.test.ts
git commit -m "feat: add dynamic coverage hint trigger"
```

---

### Task 7: Cart persistence

**Files:**
- Modify: `package.json`
- Modify: `src/engine/store.ts`
- Test: `src/engine/__tests__/store.test.ts`

**Interfaces:**
- Consumes: existing `useScanline` store shape (`hauls`, `scan`, `startScan`, `addDetection`, `finishHaul`, etc. — unchanged).
- Produces: no API change. `hauls` now survives a simulated app restart (fresh module import) when AsyncStorage has prior data.

- [ ] **Step 1: Install AsyncStorage**

```bash
npm install @react-native-async-storage/async-storage
```

- [ ] **Step 2: Wire the Jest mock**

Add `setupFiles` to the `"jest"` block in `package.json` (alongside the existing `"preset": "jest-expo"`):

```json
  "jest": {
    "preset": "jest-expo",
    "setupFiles": ["@react-native-async-storage/async-storage/jest/async-storage-mock"]
  }
```

- [ ] **Step 3: Write the failing test**

```typescript
// src/engine/__tests__/store.test.ts
import AsyncStorage from '@react-native-async-storage/async-storage';

describe('useScanline persistence', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.resetModules();
  });

  it('keeps a finished haul after a simulated app restart', async () => {
    const { useScanline } = require('../store');
    useScanline.getState().startScan();
    useScanline.getState().addDetection('0417', 0.61);
    const haulId = useScanline.getState().finishHaul();
    expect(haulId).not.toBeNull();

    await useScanline.persist.rehydrate();
    const countBeforeRestart = useScanline.getState().hauls.length;

    // Simulate an app restart: fresh module registry, same underlying AsyncStorage.
    jest.resetModules();
    const restarted = require('../store').useScanline;
    await restarted.persist.rehydrate();

    expect(restarted.getState().hauls.length).toBe(countBeforeRestart);
    expect(restarted.getState().hauls.find((h: { id: string }) => h.id === haulId)).toBeDefined();
  });

  it('seeds demo hauls only on a genuinely empty store', async () => {
    const { useScanline } = require('../store');
    await useScanline.persist.rehydrate();
    expect(useScanline.getState().hauls.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `npm test -- store`
Expected: FAIL — `useScanline.persist` is undefined, the store isn't wrapped in `persist` yet.

- [ ] **Step 5: Wrap the store with persist**

In `src/engine/store.ts`, add the imports near the top:

```typescript
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CATALOG, skuByCode } from './catalog';
import type { Detection, Haul, HaulItem, ScanSession } from './types';
```

Change the store creation (currently `export const useScanline = create<ScanlineState>((set, get) => ({ ... }))`) to:

```typescript
export const useScanline = create<ScanlineState>()(
  persist(
    (set, get) => ({
      hauls: seedHauls(),
      scan: idleScan,

      startScan() {
        set(() => ({
          scan: { status: 'scanning', startedAt: Date.now(), detections: [], hint: null },
        }));
      },

      addDetection(skuCode, confidence) {
        set((s) => {
          if (s.scan.status !== 'scanning') return s;
          const detection: Detection = {
            id: nextId('det'),
            skuCode,
            detectedAt: Date.now(),
            confidence,
          };
          return { scan: { ...s.scan, detections: [...s.scan.detections, detection] } };
        });
      },

      setHint(hint) {
        set((s) => (s.scan.status === 'scanning' ? { scan: { ...s.scan, hint } } : s));
      },

      discardScan() {
        set(() => ({ scan: idleScan }));
      },

      finishHaul() {
        const s = get();
        const items = aggregate(s.scan.detections);
        if (items.length === 0) {
          set(() => ({ scan: idleScan }));
          return null;
        }
        const haul: Haul = {
          id: nextId('haul'),
          name: haulName(new Date()),
          endedAt: Date.now(),
          items,
        };
        set((st) => ({ hauls: [haul, ...st.hauls], scan: idleScan }));
        return haul.id;
      },
    }),
    {
      name: 'kart-hauls',
      storage: createJSONStorage(() => AsyncStorage),
      // Only hauls persist. Scan sessions are always transient, in-progress
      // work should not survive a restart, and re-seeding it is meaningless.
      partialize: (state) => ({ hauls: state.hauls }),
    },
  ),
);
```

(The rest of the file — `aggregate`, `haulTotal`, `haulCount`, `seedHauls`, `haulName`, the `ScanlineState` interface, `idleScan` — stays exactly as-is above this.)

- [ ] **Step 6: Run it to verify it passes**

Run: `npm test -- store`
Expected: PASS, 2 passed.

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: all tests from Tasks 1–7 pass.

Note on storage failures: zustand's `persist` middleware already catches errors thrown while reading from `AsyncStorage` during rehydration and falls back to the store's initial state (the seeded demo hauls) rather than crashing, this is built into the library, no extra code needed here.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json src/engine/store.ts src/engine/__tests__/store.test.ts
git commit -m "feat: persist cart history across app restarts"
```

---

### Task 8: Native project setup

**Files:**
- Modify: `app.json`
- Create: `babel.config.js`
- Modify: `package.json`
- Create: `ios/` (generated, then committed)

**Interfaces:**
- Produces: a buildable native iOS project with `react-native-vision-camera`, `react-native-worklets-core`, and `@react-native-async-storage/async-storage` linked. Nothing here calls Vision yet, the existing (still video-based) app must still boot after this task.

- [ ] **Step 1: Install the native camera dependencies**

```bash
npx expo install react-native-vision-camera@4.7.3
npm install react-native-worklets-core
npm install --save-dev xcode
```
(`xcode` is a devDependency used once in Task 9 to register new native files into the generated Xcode project.)

- [ ] **Step 2: Add the Babel worklets-core plugin**

Create `babel.config.js` (the project currently has none; Expo's zero-config default already applies `babel-preset-expo`, this file needs to exist only to add the extra plugin):

```javascript
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: ['react-native-worklets-core/plugin'],
  };
};
```

- [ ] **Step 3: Add the VisionCamera Expo plugin**

In `app.json`, add an entry to the existing `"plugins"` array (alongside `"expo-router"`, the `"expo-splash-screen"` tuple, and `"expo-video"`):

```json
    [
      "react-native-vision-camera",
      {
        "cameraPermissionText": "Kart needs your camera to scan items as you shop.",
        "enableFrameProcessors": true
      }
    ]
```

- [ ] **Step 4: Generate the native iOS project**

```bash
npx expo prebuild --platform ios
```

- [ ] **Step 5: Commit ios/ to git going forward**

This project has no `ios/` entry in `.gitignore` yet (it never had a native folder before). From here on `ios/` is committed and edited directly, it is not treated as disposable/regenerate-on-demand, because Task 9 adds real custom Swift source into it. Confirm nothing ignores it:

```bash
grep -n "^ios" .gitignore || echo "not ignored, good"
```

If that grep finds a match, remove the `ios` line from `.gitignore` before continuing.

- [ ] **Step 6: Verify the app still builds and launches**

Run: `npx expo run:ios`
Expected: the app builds, launches in the Simulator, and lands on the Home screen exactly as before (the scan screen still plays the old demo video at this point, that doesn't change until Task 10).

- [ ] **Step 7: Commit**

```bash
git add app.json babel.config.js package.json package-lock.json ios .gitignore
git commit -m "chore: add react-native-vision-camera and prebuild the iOS project"
```

---

### Task 9: Swift Frame Processor Plugin

**Files:**
- Create: `ios/Kart/KartVisionFrameProcessorPlugin.swift`
- Create: `ios/Kart/KartVisionFrameProcessorPlugin.m`
- Create: `scripts/register-xcode-file.js`

**Interfaces:**
- Produces: a native frame processor plugin callable from JS as `scanGroceryItem(frame)`, returning `Array<{ box: { x, y, w, h }; label: string; confidence: number; ocrText: string }>` for up to the 3 most salient regions in the frame.

- [ ] **Step 1: Write the Swift plugin**

```swift
// ios/Kart/KartVisionFrameProcessorPlugin.swift
import VisionCamera
import Vision
import CoreVideo

@objc(KartVisionFrameProcessorPlugin)
public class KartVisionFrameProcessorPlugin: FrameProcessorPlugin {
  public override init(proxy: VisionCameraProxyHolder, options: [AnyHashable: Any]! = [:]) {
    super.init(proxy: proxy, options: options)
  }

  public override func callback(_ frame: Frame, withArguments arguments: [AnyHashable: Any]?) -> Any {
    guard let pixelBuffer = CMSampleBufferGetImageBuffer(frame.buffer) else { return [] }

    let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, options: [:])

    let saliencyRequest = VNGenerateObjectnessBasedSaliencyImageRequest()
    do {
      try handler.perform([saliencyRequest])
    } catch {
      return []
    }

    guard
      let observation = saliencyRequest.results?.first,
      let salientObjects = observation.salientObjects
    else {
      return []
    }

    let topRegions = salientObjects
      .sorted { $0.confidence > $1.confidence }
      .prefix(3)

    var results: [[String: Any]] = []

    for region in topRegions {
      // Vision's coordinate space is normalized with origin bottom-left.
      // Flip to top-left origin to match the app's Box convention.
      let visionBox = region.boundingBox
      let appBox: [String: Any] = [
        "x": visionBox.origin.x,
        "y": 1 - visionBox.origin.y - visionBox.height,
        "w": visionBox.width,
        "h": visionBox.height,
      ]

      let classifyRequest = VNClassifyImageRequest()
      classifyRequest.regionOfInterest = visionBox

      let textRequest = VNRecognizeTextRequest()
      textRequest.recognitionLevel = .fast
      textRequest.regionOfInterest = visionBox

      try? handler.perform([classifyRequest, textRequest])

      let topLabel = classifyRequest.results?.max { $0.confidence < $1.confidence }
      let ocrText = (textRequest.results ?? [])
        .compactMap { $0.topCandidates(1).first?.string }
        .joined(separator: " ")

      results.append([
        "box": appBox,
        "label": topLabel?.identifier ?? "",
        "confidence": Double(topLabel?.confidence ?? 0),
        "ocrText": ocrText,
      ])
    }

    return results
  }
}
```

- [ ] **Step 2: Write the Objective-C registration file**

```objc
// ios/Kart/KartVisionFrameProcessorPlugin.m
#import <VisionCamera/FrameProcessorPlugin.h>
#import <VisionCamera/FrameProcessorPluginRegistry.h>
#import "Kart-Swift.h"

VISION_EXPORT_SWIFT_FRAME_PROCESSOR(KartVisionFrameProcessorPlugin, scanGroceryItem)
```

- [ ] **Step 3: Register both files in the Xcode project**

The generated `ios/Kart.xcodeproj` doesn't know about these two new files yet, adding them to disk isn't enough, Xcode needs them in its Sources build phase. Write a one-off script using the `xcode` package installed in Task 8:

```javascript
// scripts/register-xcode-file.js
const path = require('path');
const xcode = require('xcode');

const projectPath = path.join(__dirname, '..', 'ios', 'Kart.xcodeproj', 'project.pbxproj');
const project = xcode.project(projectPath);
project.parseSync();

const target = project.getFirstTarget().uuid;
const groupKey = project.findPBXGroupKey({ name: 'Kart' });

for (const file of ['KartVisionFrameProcessorPlugin.swift', 'KartVisionFrameProcessorPlugin.m']) {
  const alreadyPresent = Object.values(project.hash.project.objects.PBXFileReference || {}).some(
    (ref) => typeof ref === 'object' && ref.path === file,
  );
  if (alreadyPresent) {
    console.log(`${file} already registered, skipping`);
    continue;
  }
  project.addSourceFile(`Kart/${file}`, { target }, groupKey);
  console.log(`Registered ${file}`);
}

require('fs').writeFileSync(projectPath, project.writeSync());
```

Run: `node scripts/register-xcode-file.js`
Expected: logs `Registered KartVisionFrameProcessorPlugin.swift` and `Registered KartVisionFrameProcessorPlugin.m`.

- [ ] **Step 4: Build**

Run: `npx expo run:ios`

Expected: the build succeeds. If the compiler reports a type error on `frame.buffer` or a missing symbol, open `node_modules/react-native-vision-camera/ios/Frame.swift` in the installed package to check the exact property name/type for the resolved `4.7.3` install and adjust the Swift file above to match, this is normal for pinning against a real installed native dependency, not a sign the approach is wrong.

- [ ] **Step 5: Commit**

```bash
git add ios/Kart/KartVisionFrameProcessorPlugin.swift ios/Kart/KartVisionFrameProcessorPlugin.m scripts/register-xcode-file.js ios/Kart.xcodeproj package.json package-lock.json
git commit -m "feat: add native Vision frame processor plugin"
```

---

### Task 10: Camera wiring in the scan screen

**Files:**
- Create: `src/engine/liveVision/frameProcessor.ts`
- Modify: `src/app/scan.tsx`

**Interfaces:**
- Consumes: `scanGroceryItem(frame): RawRegion[]` (this task), `createPipelineState`/`processFrame` (Task 5), `useScanline` (Task 7, unchanged API).
- Produces: the scan screen shows a live camera preview and drives `store.addDetection` from real frame data instead of the video/recognitionTrack replay.

- [ ] **Step 1: Write the JS bridge to the native plugin**

```typescript
// src/engine/liveVision/frameProcessor.ts
import { VisionCameraProxy, type Frame } from 'react-native-vision-camera';
import type { RawRegion } from './types';

const plugin = VisionCameraProxy.initFrameProcessorPlugin('scanGroceryItem');

export function scanGroceryItem(frame: Frame): RawRegion[] {
  'worklet';
  if (plugin == null) {
    throw new Error(
      'Failed to load Frame Processor Plugin "scanGroceryItem". Did the native build include KartVisionFrameProcessorPlugin?',
    );
  }
  const raw = plugin.call(frame) as unknown as Array<{
    box: RawRegion['box'];
    label: string;
    confidence: number;
    ocrText: string;
  }>;
  return raw.map((r) => ({
    box: r.box,
    label: r.label,
    confidence: r.confidence,
    ocrText: r.ocrText || undefined,
  }));
}
```

- [ ] **Step 2: Replace the video feed with the camera in scan.tsx**

Remove these imports from `src/app/scan.tsx`:

```typescript
import { useVideoPlayer } from 'expo-video';
```
```typescript
import { onVideoTime, startScanEngine, stopScanEngine } from '../engine/scanEngine';
```
```typescript
const scanVideo = require('../../assets/videos/scan.mp4');
```

Add these imports:

```typescript
import { Camera, runAtTargetFps, useCameraDevice, useCameraPermission, useFrameProcessor } from 'react-native-vision-camera';
import { Worklets } from 'react-native-worklets-core';
import { scanGroceryItem } from '../engine/liveVision/frameProcessor';
import { createPipelineState, processFrame } from '../engine/liveVision/pipeline';
import { evaluateCoverageHint } from '../engine/liveVision/coverageHint';
import { CATALOG } from '../engine/catalog';
```

Inside the `Scan` component (wherever the old `useVideoPlayer`/`ScanFeed` wiring lived), replace it with:

```typescript
const { hasPermission, requestPermission } = useCameraPermission();
const device = useCameraDevice('back');
const pipelineStateRef = useRef(createPipelineState());
const lastLockedAtRef = useRef<number | null>(null);
const hintActiveRef = useRef(false);
const [liveCandidates, setLiveCandidates] = useState(pipelineStateRef.current.candidates);
const [frameSize, setFrameSize] = useState<{ width: number; height: number } | null>(null);
const [permissionAsked, setPermissionAsked] = useState(false);

useEffect(() => {
  if (!hasPermission && !permissionAsked) {
    setPermissionAsked(true);
    requestPermission();
  }
}, [hasPermission, permissionAsked, requestPermission]);

const handleRegions = Worklets.createRunOnJS(
  (regions: ReturnType<typeof scanGroceryItem>, width: number, height: number) => {
    setFrameSize({ width, height });
    const now = Date.now();
    const { state, events } = processFrame(pipelineStateRef.current, regions, now, CATALOG);
    pipelineStateRef.current = state;
    setLiveCandidates(state.candidates);

    for (const event of events) {
      useScanline.getState().addDetection(event.skuCode, event.confidence);
      lastLockedAtRef.current = now;
      if (hintActiveRef.current) {
        hintActiveRef.current = false;
        useScanline.getState().setHint(null);
      }
    }

    const { showHint } = evaluateCoverageHint(state.candidates, lastLockedAtRef.current, now, hintActiveRef.current);
    if (showHint) {
      hintActiveRef.current = true;
      useScanline.getState().setHint('Looks like you have more items. Try moving the ones already scanned.');
    }
  },
);

const frameProcessor = useFrameProcessor(
  (frame) => {
    'worklet';
    runAtTargetFps(4, () => {
      'worklet';
      const regions = scanGroceryItem(frame);
      handleRegions(regions, frame.width, frame.height);
    });
  },
  [handleRegions],
);
```

Replace the old `<ScanFeed .../>` (video player) element with:

```tsx
{device != null && hasPermission ? (
  <Camera style={StyleSheet.absoluteFill} device={device} isActive={true} frameProcessor={frameProcessor} />
) : (
  <View style={[StyleSheet.absoluteFill, styles.permissionFallback]}>
    <Sub color={color.onFeedSub} style={styles.permissionText}>
      {hasPermission === false && permissionAsked
        ? 'Kart needs camera access to scan your cart. Enable it in Settings to continue.'
        : 'Requesting camera access…'}
    </Sub>
    {hasPermission === false && permissionAsked ? (
      <Button label="Open Settings" onPress={() => Linking.openSettings()} />
    ) : null}
  </View>
)}
```

Add `Linking` to the existing `react-native` import in `scan.tsx`, and add `import { Button } from '../components/Button';` if the screen doesn't already import it (check the existing imports first, this app already has a `Button` component used elsewhere). Add a `permissionFallback`/`permissionText` pair to the screen's existing `StyleSheet.create` block (centered content, matching the dark `color.feed` background already used for the scan screen).

Remove the `useEffect` that called `startScanEngine()`/`stopScanEngine()` and the `onVideoTime` subscription, they no longer exist. `useScanline.getState().startScan()` still gets called the same way it already was when the scan screen mounts (that part of `store.ts` didn't change).

- [ ] **Step 3: Verify the app still builds and the scan screen shows a camera preview**

Run: `npx expo run:ios`
Expected: the app builds, navigating to the scan screen prompts for camera permission (Simulator has no real camera hardware, so the preview itself may be black or show a placeholder, this is expected and is not a bug — full behavior needs Task 13's physical device pass). No crash, no red-box error. Deny permission once to confirm the fallback message and "Open Settings" button appear instead of a blank screen.

- [ ] **Step 4: Commit**

```bash
git add src/engine/liveVision/frameProcessor.ts src/app/scan.tsx
git commit -m "feat: wire the scan screen to the live camera pipeline"
```

---

### Task 11: Three-tier live highlights, retire the demo path

**Files:**
- Modify: `src/components/ItemHighlights.tsx` (full rewrite, shown below in full since the data source changes throughout the file)
- Delete: `src/engine/scanEngine.ts`
- Delete: `src/engine/recognitionTrack.ts`

**Interfaces:**
- Consumes: `TrackedCandidate[]` and `CandidateState` from `src/engine/liveVision/types.ts` (Task 4), `frameSize` state from `scan.tsx` (Task 10).
- Produces: `ItemHighlights` renders a white outline for `forming`, an amber tint for `tentative`, a green tint for `locked`, at each candidate's live `box`, using `color.amber` already defined in `src/design/tokens.ts` (no new token needed, that token's own comment already says "gentle hints only, never red", exactly this use).

- [ ] **Step 1: Replace the whole file**

The existing file drives two states (outline / green) off a fixed, precomputed `RECOGNITION_TRACK` keyed to video playback time, including a "camera drift" compensation transform for the bundled video's known slow pan. None of that applies to a live camera feed, positions come directly from Vision each frame, there's no synthetic drift to compensate for, and there's now a third state. Replace the full contents of `src/components/ItemHighlights.tsx` with:

```tsx
import { SymbolView } from 'expo-symbols';
import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { motion } from '../design/tokens';
import { Caption } from '../design/type';
import type { CandidateState, TrackedCandidate } from '../engine/liveVision/types';

/**
 * Draws the recognition boxes over the live camera feed: a white outline
 * locks onto whatever the model is currently reading, amber if it's a
 * tentative, not-yet-confident read, then settles into a green tint once
 * it's confidently counted. Whatever is not tinted is still left to scan.
 */

const GREEN = '48, 209, 88'; // iOS systemGreen
const AMBER = '199, 125, 34'; // matches design/tokens.ts color.amber, gentle hint tint

const PHASE_BY_STATE: Record<CandidateState, number> = { forming: 0, tentative: 1, locked: 2 };

interface Frame {
  left: number;
  top: number;
  width: number;
  height: number;
}

function HighlightBox({ state, frame }: { state: CandidateState; frame: Frame }) {
  const reducedMotion = useReducedMotion();
  const entrance = useSharedValue(reducedMotion ? 1 : 0);
  const phase = useSharedValue(PHASE_BY_STATE[state]);

  useEffect(() => {
    if (reducedMotion) return;
    entrance.value = withSpring(1, { duration: motion.spring.duration + 120, dampingRatio: 1 });
  }, [reducedMotion, entrance]);

  useEffect(() => {
    phase.value = reducedMotion ? PHASE_BY_STATE[state] : withTiming(PHASE_BY_STATE[state], { duration: 320 });
  }, [state, reducedMotion, phase]);

  const boxStyle = useAnimatedStyle(() => ({
    opacity: entrance.value,
    transform: [{ scale: 1.1 - entrance.value * 0.1 }],
    borderColor: interpolateColor(
      phase.value,
      [0, 1, 2],
      ['rgba(255,255,255,0.95)', `rgba(${AMBER}, 0.9)`, `rgba(${GREEN}, 0.85)`],
    ),
    backgroundColor: interpolateColor(
      phase.value,
      [0, 1, 2],
      ['rgba(255,255,255,0)', `rgba(${AMBER}, 0.18)`, `rgba(${GREEN}, 0.2)`],
    ),
  }));

  const badgeStyle = useAnimatedStyle(() => ({
    opacity: phase.value >= 2 ? 1 : 0,
    transform: [{ scale: 0.4 + Math.min(phase.value, 1) * 0.6 }],
  }));

  return (
    <View style={[styles.slot, frame]} pointerEvents="none">
      <Animated.View style={[styles.box, boxStyle]} />
      <Animated.View style={[styles.badge, badgeStyle]}>
        {Platform.OS === 'ios' ? (
          <SymbolView name="checkmark" size={13} tintColor="#FFFFFF" weight="bold" />
        ) : (
          <Caption color="#FFFFFF" style={styles.badgeMark}>
            ✓
          </Caption>
        )}
      </Animated.View>
    </View>
  );
}

interface ItemHighlightsProps {
  candidates: TrackedCandidate[];
  frameSize: { width: number; height: number } | null;
}

export function ItemHighlights({ candidates, frameSize }: ItemHighlightsProps) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ w: width, h: height });
  };

  // The camera renders with contentFit cover; map frame coords to view coords.
  const scale = size && frameSize ? Math.max(size.w / frameSize.width, size.h / frameSize.height) : 1;
  const dispW = frameSize ? frameSize.width * scale : 0;
  const dispH = frameSize ? frameSize.height * scale : 0;
  const offX = size ? (size.w - dispW) / 2 : 0;
  const offY = size ? (size.h - dispH) / 2 : 0;

  return (
    <View style={StyleSheet.absoluteFill} onLayout={onLayout} pointerEvents="none">
      {size && frameSize
        ? candidates.map((candidate) => (
            <HighlightBox
              key={candidate.id}
              state={candidate.state}
              frame={{
                left: offX + candidate.box.x * dispW,
                top: offY + candidate.box.y * dispH,
                width: candidate.box.w * dispW,
                height: candidate.box.h * dispH,
              }}
            />
          ))
        : null}
    </View>
  );
}

const styles = StyleSheet.create({
  slot: { position: 'absolute' },
  box: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderWidth: 2,
    borderRadius: 18,
    borderCurve: 'continuous',
  },
  badge: {
    position: 'absolute',
    top: -9,
    right: -9,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: `rgb(${GREEN})`,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeMark: { fontWeight: '700' },
});
```

- [ ] **Step 2: Wire it from scan.tsx**

In `src/app/scan.tsx`, replace the old `<ItemHighlights timeSv={...} detections={...} />` usage with the live data computed in Task 10:

```tsx
<ItemHighlights candidates={liveCandidates} frameSize={frameSize} />
```

- [ ] **Step 3: Delete the retired demo files**

```bash
git rm src/engine/scanEngine.ts src/engine/recognitionTrack.ts
```

Search for any remaining imports of either file and remove them:

```bash
grep -rn "scanEngine\|recognitionTrack" src
```
Expected: no matches (Task 10 already removed the `scanEngine` import from `scan.tsx`; the old `ItemHighlights.tsx` was the only other place `recognitionTrack` was imported, and Step 1 already replaced that file's contents).

- [ ] **Step 4: Verify**

Run: `npx expo run:ios`
Expected: builds clean, no unresolved imports, scan screen still renders (camera preview + hint banner + bag tray), no red-box error.

- [ ] **Step 5: Commit**

```bash
git add src/components/ItemHighlights.tsx src/app/scan.tsx
git commit -m "feat: render three-tier live highlights, retire the video-replay demo"
```

---

### Task 12: Wire the coverage hint end-to-end

**Files:**
- Modify: `src/app/scan.tsx` (verify only, no new code — Task 10 already wired `evaluateCoverageHint` into `handleRegions`)

**Interfaces:**
- Consumes: `evaluateCoverageHint` (Task 6), the existing hint banner UI already present in `scan.tsx` (driven by `useScanline`'s `scan.hint`, unchanged).

- [ ] **Step 1: Confirm the wiring from Task 10 is complete**

Re-read the `handleRegions` callback added in Task 10 and confirm it: calls `evaluateCoverageHint` every processed frame, calls `useScanline.getState().setHint(...)` when it returns `showHint: true`, and clears the hint (`setHint(null)`, `hintActiveRef.current = false`) the moment any lock event fires. If any of that is missing, add it now, it's exactly the block already shown in Task 10 Step 2.

- [ ] **Step 2: Verify the existing hint banner needs no changes**

Open the scan screen's hint banner rendering (the `GlassSurface`/hint UI that previously displayed `TRACK_HINT.text` — now retired). Confirm it reads from `useScanline`'s `scan.hint` state, same as before Task 10; if it was reading the retired `TRACK_HINT` constant directly anywhere, point it at `scan.hint` instead.

- [ ] **Step 3: Commit (only if Step 1 or 2 required a fix)**

```bash
git add src/app/scan.tsx
git commit -m "fix: ensure the hint banner reads from dynamic coverage hint state"
```

---

### Task 13: Manual on-device verification

**Files:** none — this is a verification pass, not a code change. Fix forward into the relevant earlier task's files if something's wrong; there's no dedicated "fix" file for this task.

**Interfaces:** none.

- [ ] **Step 1: Build onto a physical iPhone**

Run: `npx expo run:ios --device`
Pick your physical iPhone (not the Simulator) from the device list. Grant camera permission when prompted.

- [ ] **Step 2: Verify single-item recognition**

Hold the phone over one real grocery item at a time (start with produce, e.g. a banana or an onion). Confirm: a white outline appears first, then either turns yellow (low confidence, with a hint to bring it closer) or green (locked, added to the bag tray) within a couple of seconds.

- [ ] **Step 3: Verify duplicate counting**

Place two of the same packaged item (e.g. two identical bags of chips or two cans of the same soup) a few inches apart and sweep the camera over both. Open the bag tray and confirm the item shows quantity 2, not 1. This is the requirement from Task 4/5, confirm it holds with real camera noise, not just the synthetic test data.

- [ ] **Step 4: Verify the coverage hint**

Leave some items unscanned in frame for several seconds without moving the phone away. Confirm the "looks like you have more items" hint appears, and disappears once you scan something new.

- [ ] **Step 5: Verify persistence**

Finish a cart (tap Finish cart), force-quit the app (swipe up from the app switcher), and relaunch it. Confirm the cart you just finished is still in the trip history, not just the original six seeded demo carts.

- [ ] **Step 6: Tune thresholds against what you observed**

If real items are locking in too eagerly (wrong matches counted) or too reluctantly (correct items never leaving yellow), adjust the `DEFAULT_CONFIG` values in `src/engine/liveVision/tracker.ts` (Task 4) — `greenConfidence` up if false positives, `minDwellMs` down if it feels laggy, etc. Re-run `npm test` after any change to confirm the existing tracker tests still encode the behavior you want (update the test expectations if the intended behavior itself changed, not just the numbers).

- [ ] **Step 7: Commit any threshold tuning**

```bash
git add src/engine/liveVision/tracker.ts src/engine/liveVision/__tests__/tracker.test.ts
git commit -m "tune: adjust live recognition thresholds from real-device testing"
```
