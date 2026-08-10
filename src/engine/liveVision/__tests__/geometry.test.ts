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
