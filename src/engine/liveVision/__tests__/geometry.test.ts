import { fitPolygonToBox, intersectionOverUnion, polygonBounds, polygonCentroid } from '../geometry';
import type { Box, Polygon } from '../types';

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

const SQUARE: Polygon = [0.2, 0.2, 0.4, 0.2, 0.4, 0.6, 0.2, 0.6];

describe('polygonBounds', () => {
  it('returns the tight box around the vertices', () => {
    // Per-field toBeCloseTo, not toEqual: 0.6 - 0.2 is 0.39999999999999997 in IEEE754
    // double precision, so an exact match on h is not achievable by any correct
    // min/max/subtract implementation.
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
    // SQUARE's vertex 2 and vertex 3 share the same source y (0.6), so any correct
    // affine transform must map them to the same output y. Both are 1.0 here.
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
