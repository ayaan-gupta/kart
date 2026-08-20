import {
  assessOcclusion,
  containment,
  ENCLOSING,
  hiddenFraction,
  hiddenFractions,
  OCCLUSION_THRESHOLD,
  peakOverlap,
} from '../occlusion';
import type { Box } from '../types';
import { COVERED_FRACTION } from '../config';

const B = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

describe('containment', () => {
  it('is zero for disjoint boxes', () => {
    expect(containment(B(0, 0, 0.2, 0.2), B(0.5, 0.5, 0.2, 0.2))).toBe(0);
  });

  it('is one when the other box swallows this one', () => {
    expect(containment(B(0.4, 0.4, 0.1, 0.1), B(0, 0, 1, 1))).toBeCloseTo(1, 9);
  });

  it('is a half when the other box covers half of it', () => {
    expect(containment(B(0, 0, 0.2, 0.2), B(0.1, 0, 0.2, 0.2))).toBeCloseTo(0.5, 9);
  });

  it('is asymmetric, unlike IoU', () => {
    // This asymmetry is the point. Two items stacked front to back have a small IoU because the
    // union is large, but a large containment ratio. IoU would report a clear view of a pile.
    const small = B(0.4, 0.4, 0.1, 0.1);
    const large = B(0, 0, 1, 1);
    expect(containment(small, large)).not.toBeCloseTo(containment(large, small), 3);
  });

  it('is zero, not NaN, for a zero-area box', () => {
    expect(containment(B(0, 0, 0, 0), B(0, 0, 1, 1))).toBe(0);
  });
});

describe('peakOverlap', () => {
  it('is zero for one box or none', () => {
    expect(peakOverlap([B(0, 0, 0.2, 0.2)])).toBe(0);
    expect(peakOverlap([])).toBe(0);
  });

  it('finds the worst pair', () => {
    // B(0,0,.2,.2) is 56.25% covered by B(.05,.05,.5,.5): the larger box starts at .05, so it
    // does not fully contain the smaller one. Working that out by eye is why this is a test.
    expect(peakOverlap([B(0, 0, 0.2, 0.2), B(0.5, 0.5, 0.2, 0.2), B(0.05, 0.05, 0.5, 0.5)])).toBeCloseTo(0.5625, 9);
  });
});

describe('assessOcclusion', () => {
  const clear = { itemsLikelyHidden: false, severity: 'none' } as const;
  const bad = { itemsLikelyHidden: true, severity: 'many' } as const;

  it('reports nothing for a tidy cart', () => {
    const v = assessOcclusion({ semantic: clear, boxes: [B(0, 0, 0.2, 0.2), B(0.4, 0.4, 0.2, 0.2)], unmarkedCount: 0 });
    expect(v.hidden).toBe(false);
    expect(v.score).toBe(0);
  });

  it('does not trip on the model alone', () => {
    // The model will call a merely full cart "stacked". On its own that is not enough to start
    // nagging the user to walk around it.
    expect(assessOcclusion({ semantic: bad, boxes: [B(0, 0, 0.2, 0.2)], unmarkedCount: 0 }).hidden).toBe(false);
  });

  it('does not trip on overlap alone', () => {
    // Heavy overlap is normal in a full cart seen from above.
    expect(assessOcclusion({ semantic: clear, boxes: [B(0, 0, 0.3, 0.3), B(0, 0, 0.9, 0.9)], unmarkedCount: 0 }).hidden).toBe(false);
  });

  it('trips when the model and the geometry agree', () => {
    expect(assessOcclusion({ semantic: bad, boxes: [B(0, 0, 0.3, 0.3), B(0, 0, 0.9, 0.9)], unmarkedCount: 0 }).hidden).toBe(true);
  });

  it('trips when the model and unmarked items agree', () => {
    const v = assessOcclusion({ semantic: { itemsLikelyHidden: true, severity: 'some' }, boxes: [B(0, 0, 0.2, 0.2)], unmarkedCount: 4 });
    expect(v.hidden).toBe(true);
    expect(v.reasons).toHaveLength(2);
  });

  it('never scores above one', () => {
    const v = assessOcclusion({ semantic: bad, boxes: [B(0, 0, 0.3, 0.3), B(0, 0, 0.9, 0.9)], unmarkedCount: 9 });
    expect(v.score).toBeLessThanOrEqual(1);
  });

  it('keeps the threshold above the strongest single signal', () => {
    // If this stops holding, one signal can trip the guide by itself and the "two of three"
    // design is silently gone.
    expect(OCCLUSION_THRESHOLD).toBeGreaterThan(0.45);
  });
});

describe('hiddenFraction', () => {
  const box = (x: number, y: number, w: number, h: number): Box => ({ x, y, w, h });

  it('is zero when nothing overlaps', () => {
    expect(hiddenFraction(box(0, 0, 0.2, 0.2), [box(0.5, 0.5, 0.2, 0.2)])).toBe(0);
  });

  it('ignores an item behind, however much of the subject it overlaps', () => {
    // The overlapping item ends higher in the frame, so it is further away. A tin at the back
    // of the cart does not hide the one at the front no matter how the boxes intersect.
    const subject = box(0, 0.4, 0.4, 0.4);
    const behind = box(0, 0.3, 0.4, 0.4);
    expect(hiddenFraction(subject, [behind])).toBe(0);
  });

  it('measures the share an item in front covers', () => {
    // Spans the subject's full height and its right half, and ends lower, so it is in front.
    const subject = box(0, 0, 0.4, 0.4);
    const front = box(0.2, 0, 0.4, 0.5);
    expect(hiddenFraction(subject, [front])).toBeCloseTo(0.5, 5);
  });

  it('only counts the part of an occluder that actually lands on the subject', () => {
    // x 0.2..0.4 of 0.4 wide and y 0.1..0.4 of 0.4 tall is 0.06 of an area of 0.16.
    const subject = box(0, 0, 0.4, 0.4);
    const front = box(0.2, 0.1, 0.4, 0.4);
    expect(hiddenFraction(subject, [front])).toBeCloseTo(0.375, 5);
  });

  it('counts overlapping occluders once rather than summing them', () => {
    // Each of these covers 0.65625 of the subject and they overlap each other down the middle.
    // Summing containment reports 1.3125, which is more of the item than exists. The union is
    // 0.875, which is what a camera would actually see.
    const subject = box(0, 0, 0.4, 0.4);
    const a = box(0, 0.05, 0.3, 0.4);
    const b = box(0.1, 0.05, 0.3, 0.4);
    expect(containment(subject, a) + containment(subject, b)).toBeGreaterThan(1);
    expect(hiddenFraction(subject, [a, b])).toBeCloseTo(0.875, 5);
  });

  it('never exceeds fully hidden', () => {
    // Occluders that each cover part of the subject and together cover all of it. None of them
    // encloses it, so none is dropped by the enclosing guard.
    const subject = box(0.4, 0.4, 0.2, 0.2);
    const swamped = [box(0.2, 0.4, 0.25, 0.25), box(0.45, 0.4, 0.3, 0.25)];
    expect(hiddenFraction(subject, swamped)).toBeCloseTo(1, 5);
  });

  it('is zero for a degenerate box rather than dividing by zero', () => {
    expect(hiddenFraction(box(0.1, 0.1, 0, 0.2), [box(0, 0, 1, 1)])).toBe(0);
  });

  it('reports one number per box, positionally', () => {
    // The overlay indexes into this by track position, so a filtered or reordered result would
    // paint one item's state onto another.
    const boxes = [box(0, 0, 0.4, 0.4), box(0.2, 0, 0.4, 0.5), box(0.8, 0.8, 0.1, 0.1)];
    const fractions = hiddenFractions(boxes);
    expect(fractions).toHaveLength(3);
    expect(fractions[0]).toBeCloseTo(0.5, 5);
    expect(fractions[2]).toBe(0);
  });
});

describe('hiddenFraction matches the harness that set the threshold', () => {
  // COVERED_FRACTION was read off a curve produced by server/eval/score_grocer_occlusion.py.
  // That measurement only describes the app if the app computes the same number, and the two
  // implementations are in different languages with no shared code. These cases come from the
  // Python one; drift in either direction fails here rather than silently making the shipped
  // threshold mean something else.
  const fixture = require('../../../../server/eval/grocer/occlusion_cases.json') as {
    cases: { subject: number[]; others: number[][]; hidden: number }[];
  };
  const toBox = ([x0, y0, x1, y1]: number[]): Box => ({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });

  it('reproduces every case', () => {
    expect(fixture.cases.length).toBeGreaterThan(40);
    for (const testCase of fixture.cases) {
      const got = hiddenFraction(toBox(testCase.subject), testCase.others.map(toBox));
      expect(got).toBeCloseTo(testCase.hidden, 9);
    }
  });

  it('covers cases on both sides of the shipped threshold', () => {
    // A fixture that happened to be all zeroes would pass the test above while proving nothing.
    const values = fixture.cases.map((c) => c.hidden);
    expect(values.some((v) => v === 0)).toBe(true);
    expect(values.some((v) => v >= COVERED_FRACTION)).toBe(true);
    expect(values.some((v) => v > 0 && v < COVERED_FRACTION)).toBe(true);
  });
});

describe('enclosing boxes are not occluders', () => {
  const box = (x: number, y: number, w: number, h: number): Box => ({ x, y, w, h });

  it('ignores a box that swallows the subject whole', () => {
    // One proposal over the whole cart, and one item inside it. The cart box has the lowest
    // bottom edge, so the depth cue calls it nearest, and it overlaps the item completely.
    // Left in, a single such proposal marks every item in the cart as covered.
    const item = box(0.3, 0.3, 0.1, 0.1);
    const wholeCart = box(0.05, 0.05, 0.9, 0.9);
    expect(hiddenFraction(item, [wholeCart])).toBe(0);
  });

  it('still counts a large item that only partly overlaps', () => {
    // Big and in front, but covering half of the subject rather than all of it. That is a real
    // occlusion and must survive the guard.
    const item = box(0.3, 0.3, 0.2, 0.2);
    const slab = box(0.4, 0.35, 0.5, 0.5);
    expect(hiddenFraction(item, [slab])).toBeGreaterThan(0.2);
  });

  it('drops an occluder exactly at the enclosing threshold', () => {
    const item = box(0.3, 0.3, 0.1, 0.1);
    // Covers 90% of the subject: 0.09 of its 0.1 width, full height, and ends lower.
    const nearlyAll = box(0.3, 0.3, 0.09, 0.6);
    expect(containment(item, nearlyAll)).toBeCloseTo(ENCLOSING, 6);
    expect(hiddenFraction(item, [nearlyAll])).toBe(0);
  });

  it('reuses containment, which already measures the direction that matters', () => {
    // `containment(a, b)` is documented as the fraction of `a` that `b` covers, which is exactly
    // the question the enclosing guard asks. A separate helper was written for it and this test
    // is what found the duplication: the two are the same function.
    const small = box(0.4, 0.4, 0.1, 0.1);
    const large = box(0.0, 0.0, 1.0, 1.0);
    expect(containment(small, large)).toBeCloseTo(1, 6);
    expect(containment(large, small)).toBeCloseTo(0.01, 6);
  });
});
