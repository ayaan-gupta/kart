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
