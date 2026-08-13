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
