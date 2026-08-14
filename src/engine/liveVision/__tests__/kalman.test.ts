import { createBoxFilter, filterToBox, predictBox, updateBox } from '../kalman';
import type { Box } from '../types';

const START: Box = { x: 0.2, y: 0.2, w: 0.1, h: 0.1 };

describe('createBoxFilter', () => {
  it('starts centred on the seed box with no velocity', () => {
    const f = createBoxFilter(START);
    expect(filterToBox(f)).toEqual(START);
    expect(f.cx.v).toBe(0);
    expect(f.cy.v).toBe(0);
  });
});

describe('predictBox', () => {
  it('leaves a stationary filter where it is', () => {
    const f = predictBox(createBoxFilter(START));
    expect(filterToBox(f).x).toBeCloseTo(START.x, 6);
    expect(filterToBox(f).y).toBeCloseTo(START.y, 6);
  });

  it('grows positional uncertainty when there is no measurement', () => {
    const f = createBoxFilter(START);
    const p = predictBox(f);
    expect(p.cx.p00).toBeGreaterThan(f.cx.p00);
  });
});

describe('updateBox', () => {
  it('converges on a stationary measurement', () => {
    let f = createBoxFilter(START);
    for (let i = 0; i < 20; i += 1) {
      f = updateBox(predictBox(f), START);
    }
    const out = filterToBox(f);
    expect(out.x).toBeCloseTo(START.x, 4);
    expect(out.y).toBeCloseTo(START.y, 4);
    expect(out.w).toBeCloseTo(START.w, 4);
    expect(out.h).toBeCloseTo(START.h, 4);
  });

  it('learns constant velocity and predicts one step ahead', () => {
    // Walk a box right by a fixed step per frame, then predict without measuring. A filter
    // that has learned the velocity lands near the next true position; one that has not
    // stays put at the last observation.
    const step = 0.02;
    let f = createBoxFilter(START);
    let truth = START.x;
    for (let i = 0; i < 25; i += 1) {
      truth += step;
      f = updateBox(predictBox(f), { ...START, x: truth });
    }
    const predicted = filterToBox(predictBox(f)).x;
    expect(predicted).toBeGreaterThan(truth + step * 0.6);
    expect(predicted).toBeLessThan(truth + step * 1.4);
  });

  it('smooths measurement jitter rather than following it exactly', () => {
    // The regression this filter exists for: alternating noisy observations of a still object
    // must not make the tracked box bounce, because bouncing boxes break IoU association.
    let f = createBoxFilter(START);
    const jitter = [0.01, -0.01];
    for (let i = 0; i < 30; i += 1) {
      f = updateBox(predictBox(f), { ...START, x: START.x + jitter[i % 2] });
    }
    const settled = filterToBox(f).x;
    expect(Math.abs(settled - START.x)).toBeLessThan(0.006);
  });

  it('keeps width and height positive under a shrinking measurement', () => {
    let f = createBoxFilter(START);
    for (let i = 0; i < 10; i += 1) {
      f = updateBox(predictBox(f), { ...START, w: 0.001, h: 0.001 });
    }
    const out = filterToBox(f);
    expect(out.w).toBeGreaterThan(0);
    expect(out.h).toBeGreaterThan(0);
  });
});
