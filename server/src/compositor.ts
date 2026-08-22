import sharp from "sharp";

/** Normalized to the image, origin top-left, values 0 to 1. */
export type Box = { x: number; y: number; w: number; h: number };
/**
 * One numbered region, and what the store's catalog thinks is in it.
 *
 * `candidates` is absent when no catalog is configured, which is the degraded mode the whole
 * pipeline is built to survive. When present it is the shortlist the catalog matcher produced,
 * best first, and it changes the question asked of the model from "what is this" to "which of
 * these is this, or none of them". Measured on 465 cart crops against a 200-SKU catalog, the
 * right answer is in a shortlist of five 98.4% of the time while the matcher's own first choice
 * is right 88.0% of the time, so the shortlist carries roughly ten points the ranking loses.
 */
export type CatalogCandidate = { sku: string; confidence: number };

export type Mark = { id: number; box: Box; candidates?: CatalogCandidate[] };

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

/** Badge diameter in pixels, exposed so callers (and tests) can reason about spacing without duplicating LABEL_R. */
export const BADGE_DIAMETER_PX = LABEL_R * 2;

/** Small buffer added on top of the badge diameter so adjacent badges get a visible gap, not just a graze. */
const MIN_BADGE_GAP_PX = 4;
const MIN_BADGE_SEPARATION_PX = BADGE_DIAMETER_PX + MIN_BADGE_GAP_PX;

export type LabelPosition = { id: number; x: number; y: number };

function clampToFrame(x: number, y: number, imgW: number, imgH: number): { x: number; y: number } {
  return {
    x: Math.min(Math.max(x, LABEL_R + 2), imgW - LABEL_R - 2),
    y: Math.min(Math.max(y, LABEL_R + 2), imgH - LABEL_R - 2),
  };
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Candidate badge anchors for a single box, in priority order: placeLabel's own preferred
 * spot first, then the box's four corners, then its remaining edge midpoints. Each candidate
 * is clamped into the frame the same way placeLabel clamps its result, so every candidate is
 * independently a valid, fully visible badge position for this box; the only question
 * resolveLabelPositions has to answer is which one avoids already-placed neighbours.
 */
function candidateAnchors(box: Box, imgW: number, imgH: number): { x: number; y: number }[] {
  const left = box.x * imgW;
  const top = box.y * imgH;
  const right = (box.x + box.w) * imgW;
  const bottom = (box.y + box.h) * imgH;
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;

  const raw = [
    placeLabel(box, imgW, imgH), // preferred: centred, just inside the top edge
    { x: left, y: top },
    { x: right, y: top },
    { x: left, y: bottom },
    { x: right, y: bottom },
    { x: cx, y: bottom },
    { x: left, y: cy },
    { x: right, y: cy },
  ];
  return raw.map((p) => clampToFrame(p.x, p.y, imgW, imgH));
}

/**
 * Resolves a non-overlapping badge centre for every mark.
 *
 * placeLabel's contract is deliberately single-box: given one box, where should its badge go.
 * It has no visibility into any other mark, so two marks with nearby or touching boxes (common
 * in a cart photo, where products sit side by side) can both prefer the same spot and land on
 * top of each other. That is the only thing this function adds: it calls placeLabel for each
 * mark's first choice, then walks the marks in order and, whenever a mark's candidate badge
 * would land within MIN_BADGE_SEPARATION_PX of a badge already placed, tries the next anchor
 * on that mark's own box (its corners, then its remaining edge midpoints) until one clears the
 * gap. If none of a box's candidates clear the gap, for example because several boxes are
 * packed tightly enough that no arrangement is fully collision-free, the candidate with the
 * largest distance to its nearest already-placed neighbour is kept instead of dropping the
 * mark: a crowded badge can still be read as "some number is here"; a missing badge means the
 * model is silently never asked about that region at all, which is strictly worse.
 *
 * Deterministic: this is a single left-to-right pass over `marks` with no randomness and no
 * dependence on anything but each mark's own box and the positions already chosen earlier in
 * the same pass, so the same marks in the same order always resolve to the same positions.
 * That matters because the eval harness compares runs.
 */
export function resolveLabelPositions(
  marks: Mark[],
  imgW: number,
  imgH: number,
): LabelPosition[] {
  const placed: LabelPosition[] = [];

  for (const mark of marks) {
    const candidates = candidateAnchors(mark.box, imgW, imgH);

    let best = candidates[0];
    let bestMinDist = -Infinity;

    for (const candidate of candidates) {
      const minDist = placed.reduce((min, p) => Math.min(min, distance(p, candidate)), Infinity);
      if (minDist >= MIN_BADGE_SEPARATION_PX) {
        best = candidate;
        bestMinDist = minDist;
        break;
      }
      if (minDist > bestMinDist) {
        bestMinDist = minDist;
        best = candidate;
      }
    }

    placed.push({ id: mark.id, x: best.x, y: best.y });
  }

  return placed;
}

/**
 * Burns numbered Set-of-Mark badges and region outlines onto the image.
 *
 * Compositing happens here rather than on the device so there is exactly one implementation,
 * shared by the live app and the eval harness. That way the harness measures the real path.
 */
/**
 * The image's dimensions once EXIF orientation has been applied.
 *
 * `sharp(image).rotate()` turns the pixels, but `metadata()` goes on reporting the stored width
 * and height, so for orientations 5 to 8, which are all a quarter turn, the pair comes back the
 * wrong way round. Every photograph taken holding a phone upright is orientation 6. Resizing to
 * the unswapped pair with `fit: "fill"` squashed a 4284 by 5712 trolley into 1536 by 1152 and
 * lost a third of its width, and that distorted frame was the one the census read brands off.
 * Normalized boxes are scale free, so the badges still landed on the right products and nothing
 * downstream complained.
 */
export function orientedSize(meta: {
  width?: number;
  height?: number;
  orientation?: number;
}): { width: number; height: number } {
  if (!meta.width || !meta.height) throw new Error("Could not read image dimensions");
  const quarterTurn =
    typeof meta.orientation === "number" && meta.orientation >= 5 && meta.orientation <= 8;
  return quarterTurn
    ? { width: meta.height, height: meta.width }
    : { width: meta.width, height: meta.height };
}

export async function compositeMarks(
  image: Buffer,
  marks: Mark[],
  maxLongEdge = 1024,
): Promise<Buffer> {
  const base = sharp(image).rotate(); // honour EXIF orientation
  const { width: imgW, height: imgH } = orientedSize(await base.metadata());

  const scale = Math.min(1, maxLongEdge / Math.max(imgW, imgH));
  const w = Math.round(imgW * scale);
  const h = Math.round(imgH * scale);

  const resized = await base.resize(w, h, { fit: "fill" }).jpeg({ quality: 88 }).toBuffer();
  if (marks.length === 0) return resized;

  const positions = resolveLabelPositions(marks, w, h);

  const shapes = marks
    .map((m, i) => {
      const rx = m.box.x * w;
      const ry = m.box.y * h;
      const rw = m.box.w * w;
      const rh = m.box.h * h;
      const { x, y } = positions[i];
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
