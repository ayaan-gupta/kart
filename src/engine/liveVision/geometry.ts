import type { Box, Polygon } from './types';

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

/**
 * Converts a normalized polygon into an SVG path in view coordinates.
 *
 * Coordinates are rounded to whole pixels. Sub-pixel precision costs path string length on
 * every track on every update and buys nothing at the size these outlines are drawn.
 *
 * Rejects a polygon carrying a NaN or an Infinity outright rather than rounding it into the
 * path string: `Math.round` passes both through unchanged, and either one lands in `d` as a
 * literal "NaN" or "Infinity" token, which is not valid SVG path data. The detector, the
 * Kalman filter and fitPolygonToBox can all produce one under degenerate input, so this is a
 * guard against real upstream failure modes, not a hypothetical.
 */
export function polygonToSvgPath(
  polygon: Polygon,
  width: number,
  height: number,
  offsetX = 0,
  offsetY = 0,
): string {
  if (polygon.length < 6 || polygon.some((n) => !Number.isFinite(n))) return '';

  let path = '';
  for (let i = 0; i < polygon.length - 1; i += 2) {
    const x = Math.round(offsetX + polygon[i] * width);
    const y = Math.round(offsetY + polygon[i + 1] * height);
    path += `${i === 0 ? 'M' : 'L'}${x} ${y}`;
  }
  return `${path}Z`;
}
