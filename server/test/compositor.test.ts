import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  compositeMarks,
  orientedSize,
  placeLabel,
  resolveLabelPositions,
  BADGE_DIAMETER_PX,
  type Mark,
} from "../src/compositor.js";

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

  it("keeps the aspect ratio of a photograph that EXIF turns a quarter", async () => {
    // A phone held upright writes 5712 by 4284 pixels with orientation 6, and is 4284 by 5712
    // once turned. sharp rotates the pixels but keeps reporting the stored pair, so sizing from
    // metadata and resizing with fit "fill" squashed a portrait trolley into a landscape frame
    // and lost a third of its width. Normalized boxes are scale free, so the badges still landed
    // on the right products and nothing downstream noticed.
    const src = await sharp({
      create: { width: 1200, height: 900, channels: 3, background: { r: 200, g: 200, b: 200 } },
    })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    const out = await compositeMarks(src, [{ id: 1, box: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } }], 1024);
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(768);
    expect(meta.height).toBe(1024);
  });
});

describe("orientedSize", () => {
  it("leaves an upright photograph alone", () => {
    expect(orientedSize({ width: 1600, height: 1200, orientation: 1 })).toEqual({ width: 1600, height: 1200 });
  });

  it("swaps the pair for every quarter-turn orientation", () => {
    for (const orientation of [5, 6, 7, 8]) {
      expect(orientedSize({ width: 1600, height: 1200, orientation })).toEqual({ width: 1200, height: 1600 });
    }
  });

  it("leaves the pair alone for the mirrored orientations that are not a quarter turn", () => {
    for (const orientation of [2, 3, 4]) {
      expect(orientedSize({ width: 1600, height: 1200, orientation })).toEqual({ width: 1600, height: 1200 });
    }
  });

  it("treats a missing orientation tag as upright", () => {
    expect(orientedSize({ width: 800, height: 600 })).toEqual({ width: 800, height: 600 });
  });
});

describe("resolveLabelPositions", () => {
  it("keeps a single isolated mark exactly where placeLabel puts it", () => {
    const box = { x: 0.3, y: 0.3, w: 0.2, h: 0.2 };
    const marks: Mark[] = [{ id: 1, box }];

    const resolved = resolveLabelPositions(marks, 1000, 1000);
    const expected = placeLabel(box, 1000, 1000);

    expect(resolved).toEqual([{ id: 1, x: expected.x, y: expected.y }]);
  });

  it("gives every mark a badge, even when boxes are packed tightly together", () => {
    const marks: Mark[] = [
      { id: 1, box: { x: 0.1, y: 0.3, w: 0.08, h: 0.2 } },
      { id: 2, box: { x: 0.18, y: 0.3, w: 0.08, h: 0.2 } },
      { id: 3, box: { x: 0.26, y: 0.3, w: 0.08, h: 0.2 } },
      { id: 4, box: { x: 0.34, y: 0.3, w: 0.08, h: 0.2 } },
    ];

    const resolved = resolveLabelPositions(marks, 400, 400);

    expect(resolved).toHaveLength(marks.length);
    expect(resolved.map((p) => p.id)).toEqual([1, 2, 3, 4]);
  });

  it("keeps every resolved badge at least a badge diameter from every other, for touching adjacent boxes", () => {
    // Four product-sized (8% wide), touching boxes on a small frame: their preferred
    // (placeLabel) centres alone would land closer together than a badge diameter, so this
    // only passes if the de-confliction pass actually nudges the later badges apart.
    const marks: Mark[] = [
      { id: 1, box: { x: 0.1, y: 0.3, w: 0.08, h: 0.2 } },
      { id: 2, box: { x: 0.18, y: 0.3, w: 0.08, h: 0.2 } },
      { id: 3, box: { x: 0.26, y: 0.3, w: 0.08, h: 0.2 } },
      { id: 4, box: { x: 0.34, y: 0.3, w: 0.08, h: 0.2 } },
    ];

    const resolved = resolveLabelPositions(marks, 400, 400);

    for (let i = 0; i < resolved.length; i++) {
      for (let j = i + 1; j < resolved.length; j++) {
        const dx = resolved[i].x - resolved[j].x;
        const dy = resolved[i].y - resolved[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        expect(dist).toBeGreaterThanOrEqual(BADGE_DIAMETER_PX);
      }
    }
  });

  it("is deterministic: the same marks in the same order resolve to identical positions every time", () => {
    const marks: Mark[] = [
      { id: 1, box: { x: 0.1, y: 0.3, w: 0.08, h: 0.2 } },
      { id: 2, box: { x: 0.18, y: 0.3, w: 0.08, h: 0.2 } },
      { id: 3, box: { x: 0.26, y: 0.3, w: 0.08, h: 0.2 } },
      { id: 4, box: { x: 0.34, y: 0.3, w: 0.08, h: 0.2 } },
    ];

    const first = resolveLabelPositions(marks, 400, 400);
    const second = resolveLabelPositions(marks, 400, 400);

    expect(second).toEqual(first);
  });
});
