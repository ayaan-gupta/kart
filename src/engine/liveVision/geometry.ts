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
