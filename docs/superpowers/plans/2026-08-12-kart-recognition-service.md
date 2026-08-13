# Kart Recognition Service Implementation Plan (Plan 1 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and measure the cloud recognition service that turns a photo of a grocery cart into an accurate, open-vocabulary list of products, and run the detector spike that gates the on-device work.

**Architecture:** A Vercel TypeScript service exposes two endpoints. `/api/census` takes a cart photo plus a list of region boxes, burns numbered Set-of-Mark labels onto the image server-side with `sharp`, and asks `gpt-5.4-mini` to label each mark under a strict JSON schema. `/api/identify` takes a tight crop of one uncertain item and asks `gpt-5.4` for a better answer. An offline eval harness runs both against a corpus of real cart photos with hand-written ground truth and scores precision and recall, so prompt and model changes are measured rather than guessed at.

**Tech Stack:** Vercel (Node runtime), TypeScript, `openai` SDK (Responses API, structured outputs), `sharp` for image compositing, `zod` + `zod-to-json-schema` for schema definition, `vitest` for tests, Python + `ultralytics` for the detector spike only.

## Global Constraints

- **No em dashes anywhere**, in code comments, prompts, docs, or user-facing copy. Use commas, colons, parentheses, or semicolons.
- **The OpenAI API key never leaves the server.** It is read from `process.env.OPENAI_API_KEY` and is never returned in a response, logged, or included in an error message.
- **Model IDs are exactly** `gpt-5.4-mini` (census) and `gpt-5.4` (identify). Do not substitute. `gpt-5.5` is the escalation tier and is used only where a task says so.
- **`reasoning_effort` is `"none"` for census and `"low"` for identify.** Census runs at near-zero reasoning on purpose: it is a perception task, and reasoning tokens are billed as output and add latency.
- **Every model call uses structured outputs** with `strict: true`, `additionalProperties: false`, and every property listed in `required`. The client never parses free text. OpenAI's strict mode has no concept of an optional property, so anything that may be absent is typed as a nullable union (`z.string().nullable()`), never `.optional()`.
- **Open vocabulary.** Never constrain the model to the 50-SKU catalog in `src/engine/catalog.ts`. That catalog is being demoted to a cache in Plan 3 and plays no part here.
- **This plan writes no React Native code and touches nothing under `src/` or `ios/`.** Those are Plans 2 and 3.
- Server code lives in `server/`, which is its own Vercel project root. It has its own `package.json` and is not part of the Expo app's dependency tree.

## Prerequisite (blocks Task 1 and Task 2)

**10 to 20 photos of real, loaded grocery carts** are required, shot from the angles a user would actually scan from, and deliberately including hard cases: items stacked on top of each other, products partially buried, produce loose in the basket, and at least two photos containing multiples of the same product. Without these the eval harness has nothing to score and the spike has nothing to run against, and every accuracy number in this plan becomes unmeasurable.

Drop them in `server/eval/corpus/images/`.

---

### Task 1: Cart photo corpus and ground truth

**Files:**
- Create: `server/eval/corpus/images/` (photos supplied by the user)
- Create: `server/eval/corpus/ground-truth.json`
- Create: `server/eval/corpus/README.md`

**Interfaces:**
- Produces: `ground-truth.json`, consumed by the eval harness in Task 9. Shape is
  `{ [imageFilename: string]: GroundTruthItem[] }` where
  `GroundTruthItem = { name: string, brand: string | null, qty: number, occluded: boolean }`.

- [ ] **Step 1: Create the corpus directory and document the labelling rules**

Create `server/eval/corpus/README.md`:

```markdown
# Cart photo eval corpus

Photos of real loaded grocery carts, with hand-written ground truth.

## Labelling rules

Write down every item a careful human can identify in the photo.

- `name`: the most specific name a shopper would use. "Kellogg's Froot Loops" not "cereal".
  Include size when it is legible ("family size", "64 oz").
- `brand`: the brand alone, or null for unbranded produce.
- `qty`: how many distinct physical units of that product are in the cart. One bunch of
  bananas is 1. Two identical bags of chips is 2.
- `occluded`: true if a human can tell the item is there but cannot fully see it, for
  example a box mostly hidden under other items.

Do not list items you cannot actually see. The eval scores the model against what is
genuinely visible, so guessing here corrupts the recall number.
```

- [ ] **Step 2: Confirm the photos are in place**

Run: `ls server/eval/corpus/images/ | wc -l`
Expected: a count between 10 and 20. If it is 0, stop. This plan cannot proceed without the corpus.

- [ ] **Step 3: Write the ground truth file**

Go through each photo and write its item list. Example shape, in `server/eval/corpus/ground-truth.json`:

```json
{
  "cart-01.jpg": [
    { "name": "Bananas", "brand": null, "qty": 1, "occluded": false },
    { "name": "Kellogg's Froot Loops, family size", "brand": "Kellogg's", "qty": 1, "occluded": false },
    { "name": "Whole milk, 1 gal", "brand": null, "qty": 2, "occluded": false },
    { "name": "Tortilla chips", "brand": "Tostitos", "qty": 1, "occluded": true }
  ]
}
```

- [ ] **Step 4: Commit**

```bash
git add server/eval/corpus
git commit -m "test: add cart photo eval corpus and ground truth"
```

---

### Task 2: Detector spike (gate for Plan 2)

This task exists to answer one question before Plan 2 is written: does an off-the-shelf
open-vocabulary segmenter find the distinct items in a top-down cart photo? It produces a
number, not production code. Nothing in Plan 1 depends on the answer, but Plan 2's whole
architecture does.

**Files:**
- Create: `spike/detector/run.py`
- Create: `spike/detector/README.md`
- Create: `spike/detector/requirements.txt`

**Interfaces:**
- Produces: `spike/detector/results.md`, a written finding consumed by Plan 2's author.

- [ ] **Step 1: Write the requirements file**

Create `spike/detector/requirements.txt`:

```
ultralytics>=8.3.0
```

- [ ] **Step 2: Write the spike script**

Create `spike/detector/run.py`:

```python
"""Detector spike: how many distinct cart items does YOLOE-seg actually find?

Runs two configurations over the eval corpus and reports per-image instance counts
so they can be compared against ground truth by hand.

  1. prompt-free  : YOLOE's internal LVIS/Objects365 vocabulary, no prompts
  2. text-prompt  : a fixed grocery vocabulary

Usage:  python run.py ../../server/eval/corpus/images
"""

import sys
from pathlib import Path

from ultralytics import YOLOE

GROCERY_VOCAB = [
    "cereal box", "milk jug", "milk carton", "egg carton", "bread loaf",
    "bag of chips", "soda bottle", "water bottle", "juice carton", "yogurt cup",
    "banana", "apple", "orange", "tomato", "onion", "potato", "lettuce",
    "canned food", "jar", "box of pasta", "bag of rice", "meat package",
    "cheese block", "frozen food bag", "paper towel roll", "detergent bottle",
    "snack bar box", "coffee bag", "shopping cart",
]

CONF = 0.15  # deliberately low: we want recall here, the VLM filters later


def main(image_dir: str) -> None:
    images = sorted(
        p for p in Path(image_dir).iterdir()
        if p.suffix.lower() in {".jpg", ".jpeg", ".png", ".heic"}
    )
    if not images:
        print(f"No images found in {image_dir}")
        sys.exit(1)

    print(f"{len(images)} images\n")

    print("=== prompt-free (internal vocabulary) ===")
    pf = YOLOE("yoloe-11l-seg-pf.pt")
    for img in images:
        r = pf.predict(str(img), conf=CONF, verbose=False)[0]
        n = 0 if r.masks is None else len(r.masks)
        print(f"  {img.name}: {n} instances")

    print("\n=== text-prompt (grocery vocabulary) ===")
    tp = YOLOE("yoloe-11l-seg.pt")
    tp.set_classes(GROCERY_VOCAB, tp.get_text_pe(GROCERY_VOCAB))
    for img in images:
        r = tp.predict(str(img), conf=CONF, verbose=False)[0]
        n = 0 if r.masks is None else len(r.masks)
        print(f"  {img.name}: {n} instances")
        r.save(filename=f"out_{img.stem}_textprompt.jpg")

    print("\nAnnotated images written as out_*.jpg. Inspect them by eye:")
    print("  - Is each physical item its own mask, or are several merged?")
    print("  - Is one item split into several masks?")
    print("  - Are masks tight to the silhouette?")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "../../server/eval/corpus/images")
```

- [ ] **Step 3: Run the spike**

```bash
cd spike/detector
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python run.py ../../server/eval/corpus/images
```

Expected: per-image instance counts for both configurations, plus annotated `out_*.jpg` files.

- [ ] **Step 4: Write up the finding**

Create `spike/detector/results.md` recording, for each configuration: the mean instances
found versus mean ground-truth item count, how often one item was split into several masks
(this is the failure mode that causes overcounting), how often several items merged into one
mask (this causes undercounting), and whether masks hug silhouettes tightly enough to tint.

State a clear verdict at the top: **GO** (either configuration recovers most distinct items
with tight masks), **GO WITH TEXT PROMPTS** (only the prompted configuration works), or
**NO GO** (neither works, and Plan 2 must instead seed tracks from model-returned points).

- [ ] **Step 5: Commit**

```bash
git add spike/detector
git commit -m "spike: measure YOLOE-seg instance recovery on real cart photos"
```

---

### Task 3: Server scaffold and a live smoke call

The first thing this task does is make one real API call and print the raw response. SDK
request shapes drift between versions, so this catches a shape mismatch in five minutes
rather than three tasks deep.

**Files:**
- Create: `server/package.json`
- Create: `server/tsconfig.json`
- Create: `server/vercel.json`
- Create: `server/.env.example`
- Create: `server/.gitignore`
- Create: `server/src/openai.ts`
- Create: `server/scripts/smoke.ts`

**Interfaces:**
- Produces: `openai` (configured client) and `MODELS` from `server/src/openai.ts`, consumed by Tasks 5 through 8.

- [ ] **Step 1: Create the package manifest**

Create `server/package.json`:

```json
{
  "name": "kart-recognition-service",
  "private": true,
  "type": "module",
  "scripts": {
    "smoke": "tsx scripts/smoke.ts",
    "eval": "tsx eval/run-eval.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "openai": "^6.10.0",
    "sharp": "^0.34.4",
    "zod": "^4.1.12"
  },
  "devDependencies": {
    "@types/node": "^24.6.0",
    "tsx": "^4.20.0",
    "typescript": "^5.9.0",
    "vitest": "^3.2.0"
  }
}
```

- [ ] **Step 2: Create the TypeScript and Vercel config**

Create `server/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["node"],
    "noEmit": true
  },
  "include": ["api", "src", "eval", "scripts", "test"]
}
```

Create `server/vercel.json`:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "functions": {
    "api/*.ts": {
      "runtime": "nodejs22.x",
      "maxDuration": 30,
      "memory": 2048
    }
  }
}
```

`sharp` needs the Node runtime, not Edge, and image compositing needs the memory headroom.

Create `server/.env.example`:

```
OPENAI_API_KEY=sk-proj-replace-me
```

Create `server/.gitignore`:

```
node_modules
.env
.env.local
.vercel
eval/results
```

- [ ] **Step 3: Install dependencies**

```bash
cd server && npm install
```

- [ ] **Step 4: Write the shared OpenAI client**

Create `server/src/openai.ts`:

```ts
import OpenAI from "openai";

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  throw new Error("OPENAI_API_KEY is not set. Copy .env.example to .env and fill it in.");
}

export const openai = new OpenAI({ apiKey });

export const MODELS = {
  /** Census: labels marked regions in a full frame. Perception, not reasoning. */
  census: "gpt-5.4-mini",
  /** Identify: one tight crop of an uncertain item. */
  identify: "gpt-5.4",
  /** Escalation for items identify still cannot resolve. Used sparingly. */
  escalate: "gpt-5.5",
} as const;
```

- [ ] **Step 5: Write the smoke script**

Create `server/scripts/smoke.ts`:

```ts
/**
 * Verifies the exact Responses API request shape before anything is built on it:
 * structured outputs, image input, and reasoning_effort together.
 *
 * Run: OPENAI_API_KEY=... npm run smoke
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { openai, MODELS } from "../src/openai.js";

const CORPUS = "eval/corpus/images";

function firstImageAsDataUrl(): string {
  const file = readdirSync(CORPUS).find((f) => /\.(jpe?g|png)$/i.test(f));
  if (!file) throw new Error(`No image found in ${CORPUS}`);
  const b64 = readFileSync(join(CORPUS, file)).toString("base64");
  const mime = file.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
  console.log(`Using ${file}`);
  return `data:${mime};base64,${b64}`;
}

const response = await openai.responses.create({
  model: MODELS.census,
  reasoning: { effort: "none" },
  input: [
    {
      role: "user",
      content: [
        { type: "input_text", text: "List every distinct grocery product you can see." },
        { type: "input_image", image_url: firstImageAsDataUrl(), detail: "auto" },
      ],
    },
  ],
  text: {
    format: {
      type: "json_schema",
      name: "smoke",
      strict: true,
      schema: {
        type: "object",
        properties: {
          items: { type: "array", items: { type: "string" } },
        },
        required: ["items"],
        additionalProperties: false,
      },
    },
  },
});

console.log("\n--- output_text ---");
console.log(response.output_text);
console.log("\n--- usage ---");
console.log(JSON.stringify(response.usage, null, 2));
```

- [ ] **Step 6: Run the smoke call and fix any shape mismatch**

```bash
cd server && OPENAI_API_KEY=sk-... npm run smoke
```

Expected: a JSON object with an `items` array naming real products from the photo, plus a usage block.

If it errors, the message names the offending field. Fix the request shape here and carry the
correction into every later task. Common drift points: `reasoning.effort` versus a top-level
`reasoning_effort`, `input_image` versus `image_url`, and whether `text.format` wraps the
schema or takes it flat.

- [ ] **Step 7: Commit**

```bash
git add server/package.json server/package-lock.json server/tsconfig.json server/vercel.json \
        server/.env.example server/.gitignore server/src/openai.ts server/scripts/smoke.ts
git commit -m "feat: scaffold recognition service and verify OpenAI request shape"
```

---

### Task 4: Set-of-Mark compositor

Draws numbered labels onto a cart photo so the model can reference regions by number instead
of producing coordinates, which is the failure mode this whole design routes around.

**Files:**
- Create: `server/src/compositor.ts`
- Test: `server/test/compositor.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `type Box = { x: number; y: number; w: number; h: number }` (normalized 0 to 1, origin top-left)
  - `type Mark = { id: number; box: Box }`
  - `async function compositeMarks(image: Buffer, marks: Mark[], maxLongEdge?: number): Promise<Buffer>`
  - `function placeLabel(box: Box, imgW: number, imgH: number): { x: number; y: number }`

- [ ] **Step 1: Write the failing test**

Create `server/test/compositor.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { compositeMarks, placeLabel, type Mark } from "../src/compositor.js";

async function blankImage(w: number, h: number): Promise<Buffer> {
  return sharp({
    create: { width: w, height: h, channels: 3, background: { r: 200, g: 200, b: 200 } },
  })
    .jpeg()
    .toBuffer();
}

describe("placeLabel", () => {
  it("puts the label inside the image for a box at the top-left corner", () => {
    const p = placeLabel({ x: 0, y: 0, w: 0.1, h: 0.1 }, 1000, 1000);
    expect(p.x).toBeGreaterThanOrEqual(0);
    expect(p.y).toBeGreaterThanOrEqual(0);
  });

  it("keeps the label inside the image for a box at the bottom-right corner", () => {
    const p = placeLabel({ x: 0.9, y: 0.9, w: 0.1, h: 0.1 }, 1000, 1000);
    expect(p.x).toBeLessThanOrEqual(1000);
    expect(p.y).toBeLessThanOrEqual(1000);
  });

  it("centres the label horizontally on the box", () => {
    const p = placeLabel({ x: 0.4, y: 0.4, w: 0.2, h: 0.2 }, 1000, 1000);
    expect(p.x).toBeCloseTo(500, 0);
  });
});

describe("compositeMarks", () => {
  it("returns a valid JPEG with the same aspect ratio", async () => {
    const src = await blankImage(1600, 1200);
    const marks: Mark[] = [
      { id: 1, box: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } },
      { id: 2, box: { x: 0.5, y: 0.5, w: 0.3, h: 0.2 } },
    ];
    const out = await compositeMarks(src, marks, 1024);
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBe(1024);
    expect(meta.height).toBe(768);
  });

  it("changes the pixels (marks are actually drawn)", async () => {
    const src = await blankImage(800, 600);
    const marks: Mark[] = [{ id: 1, box: { x: 0.2, y: 0.2, w: 0.4, h: 0.4 } }];
    const withMarks = await compositeMarks(src, marks, 800);
    const without = await compositeMarks(src, [], 800);
    expect(Buffer.compare(withMarks, without)).not.toBe(0);
  });

  it("handles zero marks without throwing", async () => {
    const src = await blankImage(800, 600);
    await expect(compositeMarks(src, [], 800)).resolves.toBeInstanceOf(Buffer);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && npx vitest run test/compositor.test.ts`
Expected: FAIL, cannot resolve `../src/compositor.js`.

- [ ] **Step 3: Implement the compositor**

Create `server/src/compositor.ts`:

```ts
import sharp from "sharp";

/** Normalized to the image, origin top-left, values 0 to 1. */
export type Box = { x: number; y: number; w: number; h: number };
export type Mark = { id: number; box: Box };

const STROKE = "#00E5FF";
const LABEL_BG = "#00E5FF";
const LABEL_FG = "#000000";
const LABEL_R = 18;

/**
 * Where to draw mark N's numbered badge, in pixels.
 *
 * Centred on the box horizontally and pinned just inside its top edge, then clamped so a
 * badge on a box at the image border stays fully visible. A badge clipped by the frame is
 * the main cause of the model misreading which number belongs to which region.
 */
export function placeLabel(box: Box, imgW: number, imgH: number): { x: number; y: number } {
  const cx = (box.x + box.w / 2) * imgW;
  const top = box.y * imgH;
  return {
    x: Math.min(Math.max(cx, LABEL_R + 2), imgW - LABEL_R - 2),
    y: Math.min(Math.max(top + LABEL_R + 2, LABEL_R + 2), imgH - LABEL_R - 2),
  };
}

/**
 * Burns numbered Set-of-Mark badges and region outlines onto the image.
 *
 * Compositing happens here rather than on the device so there is exactly one implementation,
 * shared by the live app and the eval harness. That way the harness measures the real path.
 */
export async function compositeMarks(
  image: Buffer,
  marks: Mark[],
  maxLongEdge = 1024,
): Promise<Buffer> {
  const base = sharp(image).rotate(); // honour EXIF orientation
  const meta = await base.metadata();
  if (!meta.width || !meta.height) {
    throw new Error("Could not read image dimensions");
  }

  const scale = Math.min(1, maxLongEdge / Math.max(meta.width, meta.height));
  const w = Math.round(meta.width * scale);
  const h = Math.round(meta.height * scale);

  const resized = await base.resize(w, h, { fit: "fill" }).jpeg({ quality: 88 }).toBuffer();
  if (marks.length === 0) return resized;

  const shapes = marks
    .map((m) => {
      const rx = m.box.x * w;
      const ry = m.box.y * h;
      const rw = m.box.w * w;
      const rh = m.box.h * h;
      const { x, y } = placeLabel(m.box, w, h);
      return `
        <rect x="${rx.toFixed(1)}" y="${ry.toFixed(1)}"
              width="${rw.toFixed(1)}" height="${rh.toFixed(1)}"
              fill="none" stroke="${STROKE}" stroke-width="3" rx="6" />
        <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${LABEL_R}"
                fill="${LABEL_BG}" stroke="#000000" stroke-width="2" />
        <text x="${x.toFixed(1)}" y="${(y + 7).toFixed(1)}"
              font-family="Helvetica, Arial, sans-serif" font-size="24" font-weight="bold"
              fill="${LABEL_FG}" text-anchor="middle">${m.id}</text>`;
    })
    .join("");

  const overlay = Buffer.from(
    `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">${shapes}</svg>`,
  );

  return sharp(resized)
    .composite([{ input: overlay, top: 0, left: 0 }])
    .jpeg({ quality: 88 })
    .toBuffer();
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && npx vitest run test/compositor.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/compositor.ts server/test/compositor.test.ts
git commit -m "feat: add set-of-mark compositor for cart frames"
```

---

### Task 5: Response schemas

**Files:**
- Create: `server/src/schemas.ts`
- Test: `server/test/schemas.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `CensusResponse` (zod type) and `censusJsonSchema` (raw JSON Schema object)
  - `IdentifyResponse` (zod type) and `identifyJsonSchema`
  - `function productKey(name: string, brand: string | null): string`

- [ ] **Step 1: Write the failing test**

Create `server/test/schemas.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  censusJsonSchema,
  identifyJsonSchema,
  CensusResponse,
  productKey,
} from "../src/schemas.js";

/** OpenAI strict mode rejects any object that omits these. */
function assertStrict(node: unknown): void {
  if (typeof node !== "object" || node === null) return;
  const n = node as Record<string, any>;
  if (n.type === "object") {
    expect(n.additionalProperties).toBe(false);
    expect(Object.keys(n.properties ?? {}).sort()).toEqual([...(n.required ?? [])].sort());
  }
  for (const v of Object.values(n)) {
    if (Array.isArray(v)) v.forEach(assertStrict);
    else assertStrict(v);
  }
}

describe("census schema", () => {
  it("satisfies OpenAI strict mode at every level", () => {
    assertStrict(censusJsonSchema);
  });

  it("accepts a well-formed response", () => {
    const ok = {
      marks: [
        {
          id: 1,
          name: "Kellogg's Froot Loops, family size",
          brand: "Kellogg's",
          size: "family size",
          category: "Pantry",
          confidence: 0.92,
          needsCloserLook: false,
        },
      ],
      unmarkedItems: [],
      inViewCounts: [{ productKey: "kelloggs::froot loops", count: 1 }],
      occlusion: { itemsLikelyHidden: false, severity: "none", reason: "" },
    };
    expect(() => CensusResponse.parse(ok)).not.toThrow();
  });

  it("rejects a confidence outside 0 to 1", () => {
    const bad = {
      marks: [
        {
          id: 1, name: "x", brand: null, size: null, category: "Other",
          confidence: 1.4, needsCloserLook: false,
        },
      ],
      unmarkedItems: [],
      inViewCounts: [],
      occlusion: { itemsLikelyHidden: false, severity: "none", reason: "" },
    };
    expect(() => CensusResponse.parse(bad)).toThrow();
  });
});

describe("identify schema", () => {
  it("satisfies OpenAI strict mode at every level", () => {
    assertStrict(identifyJsonSchema);
  });
});

describe("productKey", () => {
  it("is stable across capitalisation and spacing", () => {
    expect(productKey("Froot  Loops", "Kellogg's")).toBe(productKey("froot loops", "kelloggs"));
  });

  it("separates brand from name", () => {
    expect(productKey("Froot Loops", "Kellogg's")).toBe("kelloggs::froot loops");
  });

  it("handles a null brand", () => {
    expect(productKey("Bananas", null)).toBe("::bananas");
  });

  it("distinguishes different products", () => {
    expect(productKey("Froot Loops", "Kellogg's")).not.toBe(productKey("Corn Flakes", "Kellogg's"));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && npx vitest run test/schemas.test.ts`
Expected: FAIL, cannot resolve `../src/schemas.js`.

- [ ] **Step 3: Implement the schemas**

Create `server/src/schemas.ts`:

```ts
import { z } from "zod";

/**
 * Note on nullability: OpenAI strict mode has no optional properties. Every field must be
 * present and listed in `required`, so anything that can be absent is a nullable union.
 * Do not switch these to `.optional()`, the API rejects the schema.
 */

export const MarkIdentification = z.object({
  id: z.number().int(),
  name: z.string(),
  brand: z.string().nullable(),
  size: z.string().nullable(),
  category: z.string(),
  confidence: z.number().min(0).max(1),
  needsCloserLook: z.boolean(),
});

export const UnmarkedItem = z.object({
  description: z.string(),
  approxLocation: z.string(),
  confidence: z.number().min(0).max(1),
});

export const InViewCount = z.object({
  productKey: z.string(),
  count: z.number().int().min(0),
});

export const Occlusion = z.object({
  itemsLikelyHidden: z.boolean(),
  severity: z.enum(["none", "some", "many"]),
  reason: z.string(),
});

export const CensusResponse = z.object({
  marks: z.array(MarkIdentification),
  unmarkedItems: z.array(UnmarkedItem),
  inViewCounts: z.array(InViewCount),
  occlusion: Occlusion,
});
export type CensusResponse = z.infer<typeof CensusResponse>;

export const IdentifyResponse = z.object({
  name: z.string(),
  brand: z.string().nullable(),
  size: z.string().nullable(),
  category: z.string(),
  confidence: z.number().min(0).max(1),
  stillUnclear: z.boolean(),
});
export type IdentifyResponse = z.infer<typeof IdentifyResponse>;

/**
 * Stable key for one product across calls.
 *
 * The model will not phrase a name identically every time ("Froot Loops" one call,
 * "Kellogg's Froot Loops" the next). Everything downstream that counts or dedupes keys on
 * this, never on the display string.
 */
export function productKey(name: string, brand: string | null): string {
  const norm = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
  return `${brand ? norm(brand) : ""}::${norm(name)}`;
}

// Hand-written JSON Schema rather than generated, because strict mode's requirements
// (every property required, additionalProperties false everywhere) are easier to guarantee
// and review by hand than to coax out of a converter.

export const censusJsonSchema = {
  type: "object",
  properties: {
    marks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "integer" },
          name: { type: "string" },
          brand: { type: ["string", "null"] },
          size: { type: ["string", "null"] },
          category: { type: "string" },
          confidence: { type: "number" },
          needsCloserLook: { type: "boolean" },
        },
        required: ["id", "name", "brand", "size", "category", "confidence", "needsCloserLook"],
        additionalProperties: false,
      },
    },
    unmarkedItems: {
      type: "array",
      items: {
        type: "object",
        properties: {
          description: { type: "string" },
          approxLocation: { type: "string" },
          confidence: { type: "number" },
        },
        required: ["description", "approxLocation", "confidence"],
        additionalProperties: false,
      },
    },
    inViewCounts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          productKey: { type: "string" },
          count: { type: "integer" },
        },
        required: ["productKey", "count"],
        additionalProperties: false,
      },
    },
    occlusion: {
      type: "object",
      properties: {
        itemsLikelyHidden: { type: "boolean" },
        severity: { type: "string", enum: ["none", "some", "many"] },
        reason: { type: "string" },
      },
      required: ["itemsLikelyHidden", "severity", "reason"],
      additionalProperties: false,
    },
  },
  required: ["marks", "unmarkedItems", "inViewCounts", "occlusion"],
  additionalProperties: false,
} as const;

export const identifyJsonSchema = {
  type: "object",
  properties: {
    name: { type: "string" },
    brand: { type: ["string", "null"] },
    size: { type: ["string", "null"] },
    category: { type: "string" },
    confidence: { type: "number" },
    stillUnclear: { type: "boolean" },
  },
  required: ["name", "brand", "size", "category", "confidence", "stillUnclear"],
  additionalProperties: false,
} as const;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && npx vitest run test/schemas.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/schemas.ts server/test/schemas.test.ts
git commit -m "feat: add strict response schemas and stable product keys"
```

---

### Task 6: Prompts

**Files:**
- Create: `server/src/prompts.ts`

**Interfaces:**
- Consumes: `Mark` from `src/compositor.ts`.
- Produces: `CENSUS_SYSTEM_PROMPT`, `IDENTIFY_SYSTEM_PROMPT`, `function censusUserText(marks: Mark[]): string`

- [ ] **Step 1: Write the prompts**

Create `server/src/prompts.ts`:

```ts
import type { Mark } from "./compositor.js";

/**
 * Kept as one frozen string and placed first in the request so it caches. Cached input is
 * $0.075/1M on gpt-5.4-mini against $0.75/1M uncached, so anything volatile must come after.
 */
export const CENSUS_SYSTEM_PROMPT = `
You identify grocery products in a photo of a shopping cart.

The image has numbered cyan badges drawn on it. Each badge sits on one region that an object
detector found. Your job is to say what product is in each numbered region.

Rules:

1. Identify at brand level whenever the packaging is legible. "Kellogg's Froot Loops, family
   size" is a good answer. "Cereal" is a poor answer if the box is readable.
2. If you genuinely cannot read the packaging, give the most specific honest description you
   can ("boxed cereal, brand not legible") and set needsCloserLook to true.
3. confidence is your real confidence that a shopper would agree with your identification.
   Be calibrated. Do not report 0.9 for a guess. Anything you would not bet on belongs below
   0.6 with needsCloserLook set to true.
4. Set needsCloserLook to true when a closer or sharper view would plausibly change your
   answer, even if you have a guess.
5. Report every numbered badge exactly once, using its number as id. Do not invent numbers
   that are not drawn, and do not skip numbers.
6. If you can see a product that has no badge on it, add it to unmarkedItems instead. Never
   attach it to an unrelated badge.
7. inViewCounts is how many distinct physical units of each product you can see in this one
   image. One bunch of bananas is 1, not the number of bananas in it. Two identical bags of
   chips is 2. Count only what is visible in this image, and do not speculate about the rest
   of the cart.
8. productKey in inViewCounts is lowercase "brand::name" with punctuation removed, for
   example "kelloggs::froot loops". Use "" for the brand of unbranded produce, giving
   "::bananas".
9. occlusion describes whether items appear stacked or buried such that products are present
   but not visible. severity "none" means you can see everything in the basket. "some" means
   a few things are partly covered. "many" means the cart is stacked and a significant part
   of the contents is hidden.

Answer only with the structured object.
`.trim();

export const IDENTIFY_SYSTEM_PROMPT = `
You identify a single grocery product from a close crop of it.

This crop was taken because an earlier pass was not confident. Read whatever text, logo, and
packaging detail is visible and give the most specific identification you can support.

Be calibrated. If the crop is still too blurry, too dark, or too partial to identify the
product, say what you can ("a red 12 oz can, brand not legible"), set confidence low, and set
stillUnclear to true. A confident wrong answer is worse than an honest uncertain one, because
the app will stop asking the user for a better view.

Answer only with the structured object.
`.trim();

/**
 * The volatile half of the census request. Listing the boxes as text alongside the drawn
 * badges gives the model a second, independent way to bind a number to a region, which is
 * the documented weak point of set-of-mark prompting.
 */
export function censusUserText(marks: Mark[]): string {
  if (marks.length === 0) {
    return "No regions were detected. List every grocery product you can see in unmarkedItems.";
  }
  const rows = marks
    .map((m) => {
      const cx = (m.box.x + m.box.w / 2).toFixed(2);
      const cy = (m.box.y + m.box.h / 2).toFixed(2);
      return `  ${m.id}: centre (${cx}, ${cy}), size ${m.box.w.toFixed(2)} by ${m.box.h.toFixed(2)}`;
    })
    .join("\n");
  return `There are ${marks.length} numbered regions. Their normalized positions, where (0,0) is top-left and (1,1) is bottom-right:\n${rows}\n\nIdentify the product in each.`;
}
```

- [ ] **Step 2: Typecheck**

Run: `cd server && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add server/src/prompts.ts
git commit -m "feat: add census and identify prompts"
```

---

### Task 7: Recognition core

The model-calling logic lives here rather than in the route handlers, so the eval harness in
Task 9 exercises exactly the same code path the app does.

**Files:**
- Create: `server/src/recognize.ts`

**Interfaces:**
- Consumes: `openai`, `MODELS`, `compositeMarks`, `Mark`, `CensusResponse`, `IdentifyResponse`, `censusJsonSchema`, `identifyJsonSchema`, prompts.
- Produces:
  - `async function runCensus(image: Buffer, marks: Mark[]): Promise<CensusResponse>`
  - `async function runIdentify(crop: Buffer, hint: string | null): Promise<IdentifyResponse>`

- [ ] **Step 1: Implement the recognition core**

Create `server/src/recognize.ts`:

```ts
import { openai, MODELS } from "./openai.js";
import { compositeMarks, type Mark } from "./compositor.js";
import {
  CensusResponse,
  IdentifyResponse,
  censusJsonSchema,
  identifyJsonSchema,
} from "./schemas.js";
import { CENSUS_SYSTEM_PROMPT, IDENTIFY_SYSTEM_PROMPT, censusUserText } from "./prompts.js";

const CENSUS_LONG_EDGE = 1024;

function dataUrl(jpeg: Buffer): string {
  return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
}

/** Labels every marked region in a full cart frame. */
export async function runCensus(image: Buffer, marks: Mark[]): Promise<CensusResponse> {
  const composited = await compositeMarks(image, marks, CENSUS_LONG_EDGE);

  const response = await openai.responses.create({
    model: MODELS.census,
    reasoning: { effort: "none" },
    input: [
      { role: "system", content: CENSUS_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "input_text", text: censusUserText(marks) },
          { type: "input_image", image_url: dataUrl(composited), detail: "auto" },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "cart_census",
        strict: true,
        schema: censusJsonSchema,
      },
    },
  });

  return CensusResponse.parse(JSON.parse(response.output_text));
}

/** Resolves one uncertain item from a tight, high-resolution crop. */
export async function runIdentify(
  crop: Buffer,
  hint: string | null,
): Promise<IdentifyResponse> {
  const text = hint
    ? `An earlier pass guessed: "${hint}". Confirm or correct it.`
    : "Identify this product.";

  const response = await openai.responses.create({
    model: MODELS.identify,
    reasoning: { effort: "low" },
    input: [
      { role: "system", content: IDENTIFY_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "input_text", text },
          { type: "input_image", image_url: dataUrl(crop), detail: "auto" },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "product_identification",
        strict: true,
        schema: identifyJsonSchema,
      },
    },
  });

  return IdentifyResponse.parse(JSON.parse(response.output_text));
}
```

- [ ] **Step 2: Typecheck**

Run: `cd server && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Verify against a real photo**

Create a scratch script and run it to confirm the full path works end to end with one mark:

```bash
cd server && cat > /tmp/try.ts <<'EOF'
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { runCensus } from "./src/recognize.js";
const dir = "eval/corpus/images";
const f = readdirSync(dir).find((x) => /\.(jpe?g|png)$/i.test(x))!;
const out = await runCensus(readFileSync(join(dir, f)), [
  { id: 1, box: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } },
]);
console.log(JSON.stringify(out, null, 2));
EOF
OPENAI_API_KEY=sk-... npx tsx /tmp/try.ts
```

Expected: a parsed object naming a real product for mark 1, with `inViewCounts` and an
`occlusion` block. If `CensusResponse.parse` throws, the schema and the prompt disagree; fix
the schema rather than loosening the parse.

- [ ] **Step 4: Commit**

```bash
git add server/src/recognize.ts
git commit -m "feat: add census and identify recognition core"
```

---

### Task 8: HTTP endpoints

**Files:**
- Create: `server/api/census.ts`
- Create: `server/api/identify.ts`
- Create: `server/src/http.ts`

**Interfaces:**
- Consumes: `runCensus`, `runIdentify`.
- Produces: `POST /api/census` and `POST /api/identify`, consumed by the app in Plan 3.

- [ ] **Step 1: Write the shared HTTP helpers**

Create `server/src/http.ts`:

```ts
export type Json = Record<string, unknown>;

export function json(body: Json, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Never let an upstream error message reach the client. It can contain request context and,
 * in some failure modes, fragments of the credential.
 */
export function fail(error: unknown, status = 500): Response {
  console.error("[recognition]", error);
  return json({ error: status === 400 ? "Bad request" : "Recognition failed" }, status);
}

export function decodeBase64Image(value: unknown, field: string): Buffer {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${field} must be a base64 string`);
  }
  const stripped = value.replace(/^data:image\/[a-z+]+;base64,/, "");
  const buf = Buffer.from(stripped, "base64");
  if (buf.length === 0) throw new Error(`${field} did not decode to any bytes`);
  if (buf.length > 12 * 1024 * 1024) throw new Error(`${field} is too large`);
  return buf;
}
```

- [ ] **Step 2: Write the census endpoint**

Create `server/api/census.ts`:

```ts
import { runCensus } from "../src/recognize.js";
import type { Mark } from "../src/compositor.js";
import { decodeBase64Image, fail, json } from "../src/http.js";

export const config = { runtime: "nodejs" };

function parseMarks(value: unknown): Mark[] {
  if (!Array.isArray(value)) throw new Error("marks must be an array");
  if (value.length > 40) throw new Error("too many marks");
  return value.map((raw, i) => {
    const m = raw as Record<string, any>;
    const b = m?.box as Record<string, any>;
    if (typeof m?.id !== "number" || !b) throw new Error(`marks[${i}] is malformed`);
    for (const k of ["x", "y", "w", "h"]) {
      if (typeof b[k] !== "number" || b[k] < 0 || b[k] > 1) {
        throw new Error(`marks[${i}].box.${k} must be between 0 and 1`);
      }
    }
    return { id: m.id, box: { x: b.x, y: b.y, w: b.w, h: b.h } };
  });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let image: Buffer;
  let marks: Mark[];
  try {
    const body = (await req.json()) as Record<string, unknown>;
    image = decodeBase64Image(body.image, "image");
    marks = parseMarks(body.marks ?? []);
  } catch (err) {
    return fail(err, 400);
  }

  try {
    return json({ ok: true, result: await runCensus(image, marks) });
  } catch (err) {
    return fail(err);
  }
}
```

- [ ] **Step 3: Write the identify endpoint**

Create `server/api/identify.ts`:

```ts
import { runIdentify } from "../src/recognize.js";
import { decodeBase64Image, fail, json } from "../src/http.js";

export const config = { runtime: "nodejs" };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let crop: Buffer;
  let hint: string | null;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    crop = decodeBase64Image(body.image, "image");
    hint = typeof body.hint === "string" && body.hint.length > 0 ? body.hint.slice(0, 200) : null;
  } catch (err) {
    return fail(err, 400);
  }

  try {
    return json({ ok: true, result: await runIdentify(crop, hint) });
  } catch (err) {
    return fail(err);
  }
}
```

- [ ] **Step 4: Run locally and verify with curl**

```bash
cd server && npx vercel dev --listen 3000
```

In another shell:

```bash
IMG=$(ls eval/corpus/images/* | head -1)
python3 -c "import base64,sys;print(base64.b64encode(open(sys.argv[1],'rb').read()).decode())" "$IMG" > /tmp/img.b64
python3 - <<'EOF' > /tmp/req.json
import json
print(json.dumps({
  "image": open("/tmp/img.b64").read().strip(),
  "marks": [{"id": 1, "box": {"x": 0.25, "y": 0.25, "w": 0.5, "h": 0.5}}]
}))
EOF
curl -s -X POST localhost:3000/api/census -H 'content-type: application/json' -d @/tmp/req.json | head -c 2000
```

Expected: `{"ok":true,"result":{"marks":[{"id":1,"name":"..."}]...}}`

Also verify the error path returns no internal detail:

```bash
curl -s -X POST localhost:3000/api/census -H 'content-type: application/json' -d '{"image":""}'
```

Expected: exactly `{"error":"Bad request"}`.

- [ ] **Step 5: Commit**

```bash
git add server/api server/src/http.ts
git commit -m "feat: add census and identify HTTP endpoints"
```

---

### Task 9: Eval harness

Without this, prompt changes are guesswork. This is the task that would have caught the
current shipped pipeline before it reached a device.

**Files:**
- Create: `server/eval/score.ts`
- Create: `server/eval/run-eval.ts`
- Test: `server/test/score.test.ts`

**Interfaces:**
- Consumes: `runCensus`, `productKey`, `ground-truth.json`.
- Produces: `function scoreImage(predicted, truth): ImageScore` and a printed report.

- [ ] **Step 1: Write the failing test for scoring**

Create `server/test/score.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { scoreImage, type TruthItem } from "../eval/score.js";

const truth: TruthItem[] = [
  { name: "Bananas", brand: null, qty: 1, occluded: false },
  { name: "Froot Loops", brand: "Kellogg's", qty: 1, occluded: false },
];

describe("scoreImage", () => {
  it("scores a perfect prediction as 1 and 1", () => {
    const s = scoreImage(
      [
        { name: "Bananas", brand: null },
        { name: "Froot Loops", brand: "Kellogg's" },
      ],
      truth,
    );
    expect(s.precision).toBe(1);
    expect(s.recall).toBe(1);
  });

  it("penalises a miss in recall but not precision", () => {
    const s = scoreImage([{ name: "Bananas", brand: null }], truth);
    expect(s.recall).toBe(0.5);
    expect(s.precision).toBe(1);
  });

  it("penalises a hallucination in precision but not recall", () => {
    const s = scoreImage(
      [
        { name: "Bananas", brand: null },
        { name: "Froot Loops", brand: "Kellogg's" },
        { name: "Motor Oil", brand: "Castrol" },
      ],
      truth,
    );
    expect(s.recall).toBe(1);
    expect(s.precision).toBeCloseTo(2 / 3);
  });

  it("matches despite capitalisation and punctuation differences", () => {
    const s = scoreImage([{ name: "froot loops", brand: "kelloggs" }], truth);
    expect(s.matched).toContain("kelloggs::froot loops");
  });

  it("returns zero recall and zero precision for an empty prediction", () => {
    const s = scoreImage([], truth);
    expect(s.recall).toBe(0);
    expect(s.precision).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && npx vitest run test/score.test.ts`
Expected: FAIL, cannot resolve `../eval/score.js`.

- [ ] **Step 3: Implement scoring**

Create `server/eval/score.ts`:

```ts
import { productKey } from "../src/schemas.js";

export type TruthItem = {
  name: string;
  brand: string | null;
  qty: number;
  occluded: boolean;
};

export type PredictedItem = { name: string; brand: string | null };

export type ImageScore = {
  precision: number;
  recall: number;
  matched: string[];
  missed: string[];
  hallucinated: string[];
};

/**
 * Set-based precision and recall over product keys.
 *
 * Quantity is deliberately not scored here. It depends on the tracker, which does not exist
 * in this plan, so scoring it now would measure nothing real.
 */
export function scoreImage(predicted: PredictedItem[], truth: TruthItem[]): ImageScore {
  const predKeys = new Set(predicted.map((p) => productKey(p.name, p.brand)));
  const truthKeys = new Set(truth.map((t) => productKey(t.name, t.brand)));

  const matched = [...predKeys].filter((k) => truthKeys.has(k));
  const hallucinated = [...predKeys].filter((k) => !truthKeys.has(k));
  const missed = [...truthKeys].filter((k) => !predKeys.has(k));

  return {
    precision: predKeys.size === 0 ? 0 : matched.length / predKeys.size,
    recall: truthKeys.size === 0 ? 0 : matched.length / truthKeys.size,
    matched,
    missed,
    hallucinated,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && npx vitest run test/score.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Write the eval runner**

Create `server/eval/run-eval.ts`:

```ts
/**
 * Scores the census endpoint against the cart corpus.
 *
 * Runs with a single whole-image mark, so it measures the model's raw naming ability
 * independently of any detector. Once Plan 2 lands a real detector, feed its boxes in here
 * instead and the same score becomes an end-to-end number.
 *
 * Run: OPENAI_API_KEY=... npm run eval
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { runCensus } from "../src/recognize.js";
import { scoreImage, type TruthItem, type PredictedItem } from "./score.js";

const IMAGES = "eval/corpus/images";
const TRUTH = "eval/corpus/ground-truth.json";
const OUT = "eval/results";

const truth = JSON.parse(readFileSync(TRUTH, "utf8")) as Record<string, TruthItem[]>;
const files = readdirSync(IMAGES).filter((f) => /\.(jpe?g|png)$/i.test(f));

mkdirSync(OUT, { recursive: true });

let totalP = 0;
let totalR = 0;
let n = 0;
const report: string[] = [];

for (const file of files) {
  const expected = truth[file];
  if (!expected) {
    console.warn(`skipping ${file}, no ground truth`);
    continue;
  }

  const image = readFileSync(join(IMAGES, file));
  const census = await runCensus(image, [{ id: 1, box: { x: 0, y: 0, w: 1, h: 1 } }]);

  const predicted: PredictedItem[] = [
    ...census.marks.map((m) => ({ name: m.name, brand: m.brand })),
    ...census.unmarkedItems.map((u) => ({ name: u.description, brand: null })),
  ];

  const s = scoreImage(predicted, expected);
  totalP += s.precision;
  totalR += s.recall;
  n += 1;

  report.push(
    `## ${file}`,
    `precision ${s.precision.toFixed(2)}  recall ${s.recall.toFixed(2)}`,
    `occlusion: ${census.occlusion.severity} (${census.occlusion.reason})`,
    `missed: ${s.missed.join(", ") || "none"}`,
    `hallucinated: ${s.hallucinated.join(", ") || "none"}`,
    "",
  );
  console.log(`${file}  P ${s.precision.toFixed(2)}  R ${s.recall.toFixed(2)}`);
}

const summary = `mean precision ${(totalP / n).toFixed(3)}, mean recall ${(totalR / n).toFixed(3)}, over ${n} images`;
console.log(`\n${summary}`);
writeFileSync(join(OUT, "latest.md"), `# Eval\n\n${summary}\n\n${report.join("\n")}`);
```

- [ ] **Step 6: Run the eval**

```bash
cd server && OPENAI_API_KEY=sk-... npm run eval
```

Expected: a per-image score line for every corpus photo, a mean precision and recall summary,
and `eval/results/latest.md` written.

- [ ] **Step 7: Commit**

```bash
git add server/eval/score.ts server/eval/run-eval.ts server/test/score.test.ts
git commit -m "test: add recognition eval harness scoring precision and recall"
```

---

### Task 10: Tune against the eval and record the baseline

**Files:**
- Modify: `server/src/prompts.ts`
- Create: `server/eval/BASELINE.md`

**Interfaces:**
- Consumes: the eval harness.
- Produces: a recorded baseline that Plans 2 and 3 are measured against.

- [ ] **Step 1: Record the first baseline**

Copy the summary line and the per-image table from `eval/results/latest.md` into
`server/eval/BASELINE.md` under a heading giving the date, both model IDs, and the prompt
version. This is the number every later change is compared against.

- [ ] **Step 2: Read the misses and hallucinations**

Go through the `missed` and `hallucinated` lines. Sort them into: the model could not see it
(a detector or viewpoint problem, not fixable here), the model saw it and named it too
generically (a prompt problem), the model named it differently from the ground truth but
correctly (a `productKey` normalisation problem), and the model invented it (a calibration
problem).

Only the second and third categories are fixable in this task. Note the first category in
`BASELINE.md` as input to Plan 2.

- [ ] **Step 3: Make one prompt change at a time and re-measure**

For each fixable issue, change `CENSUS_SYSTEM_PROMPT`, re-run `npm run eval`, and keep the
change only if mean recall or mean precision improved. Revert it otherwise. Changing several
things at once makes the result unattributable.

- [ ] **Step 4: Try the escalation model on the worst image**

For the single lowest-recall image, temporarily switch `MODELS.census` to `MODELS.escalate`
and re-run. Record in `BASELINE.md` how much of the gap is a model-capability limit rather
than a prompt limit. Revert the model change afterwards.

- [ ] **Step 5: Commit**

```bash
git add server/src/prompts.ts server/eval/BASELINE.md
git commit -m "perf: tune census prompt against eval corpus and record baseline"
```

---

### Task 11: Deploy

**Files:**
- Create: `server/README.md`

- [ ] **Step 1: Link and configure the Vercel project**

```bash
cd server
npx vercel link
npx vercel env add OPENAI_API_KEY production
npx vercel env add OPENAI_API_KEY preview
```

- [ ] **Step 2: Deploy a preview and verify it**

```bash
npx vercel deploy
```

Then run the same curl from Task 8 Step 4 against the returned preview URL and confirm an
identical response shape.

- [ ] **Step 3: Write the service README**

Create `server/README.md` documenting: the two endpoints with their exact request and response
shapes, the models and reasoning efforts in use, how to run the eval, the current baseline
numbers, roughly what a cart scan costs, and the Open Food Facts attribution requirement that
Plan 2 will need (ODbL).

- [ ] **Step 4: Promote to production**

```bash
npx vercel deploy --prod
```

- [ ] **Step 5: Commit**

```bash
git add server/README.md
git commit -m "docs: document the recognition service and deployment"
```

---

## Self-Review

**Spec coverage.** Open-vocabulary brand-level naming, Tasks 6 and 7. Set-of-Mark prompting,
Task 4. Strict structured outputs, Task 5. Census and identify tiers with the specified models
and reasoning efforts, Task 7. Key held server-side, Tasks 3 and 8. Occlusion assessment as a
model output, Tasks 5 and 6. Per-view counts feeding the counting clamp, Task 5. Eval harness,
Task 9. Detector spike, Task 2.

Deliberately **not** in this plan, and carried forward:

- Barcode fast path and Open Food Facts lookup → Plan 2 (on-device, needs `VNDetectBarcodesRequest`)
- YOLOE Core ML export, ByteTrack, keyframe sharpness and stillness gating → Plan 2
- Track-based counting with the in-view clamp, green/amber mask rendering, the "move closer"
  banner, guided multi-angle capture, deleting `labelCatalog.ts` / `labelMatcher.ts` /
  `coverageHint.ts`, demoting `CATALOG` to a cache → Plan 3
- ARKit anchoring and EdgeTAM → explicitly deferred by the spec

**Placeholder scan.** No TBD or TODO. Every code step carries complete code. Task 10 is
judgment work by nature, so it specifies the exact procedure (one change, re-measure, keep or
revert) rather than pretending to know the outcome.

**Type consistency.** `Box` and `Mark` are defined once in `compositor.ts` and imported by
`prompts.ts`, `recognize.ts`, and `api/census.ts`. `productKey` is defined in `schemas.ts` and
used by `eval/score.ts`, with the prompt in Task 6 instructing the model to use the same
format. `CensusResponse` and `IdentifyResponse` are the zod types; `censusJsonSchema` and
`identifyJsonSchema` are the wire schemas, and the Task 5 test asserts strict-mode conformance
so the two cannot silently diverge.

**One known risk carried into execution.** Task 3 Step 6 exists because the Responses API
shape (`reasoning.effort`, `input_image`, `text.format`) is verified against documentation but
not against the installed SDK version. If it differs, correct it there and propagate to Tasks
7 and 9 before continuing.
