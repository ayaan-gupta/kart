import type { Box } from './types';

/**
 * One constant-velocity Kalman filter over a single scalar, holding the estimate `x`, its
 * velocity `v`, and the 2x2 covariance `p`.
 */
export interface Scalar1D {
  x: number;
  v: number;
  p00: number;
  p01: number;
  p10: number;
  p11: number;
}

export interface BoxFilter {
  cx: Scalar1D;
  cy: Scalar1D;
  w: Scalar1D;
  h: Scalar1D;
}

/**
 * The textbook SORT tracker uses one seven-dimensional filter over centre, area, aspect and
 * their velocities. With diagonal process and measurement noise, and no coupling between
 * dimensions beyond each position-velocity pair, that filter decomposes exactly into four
 * independent two-state filters. Same estimates, a tenth of the code, and no matrix library.
 */
const POSITION_PROCESS_NOISE = 1e-5;
const VELOCITY_PROCESS_NOISE = 1e-6;
const POSITION_MEASUREMENT_NOISE = 1e-3;
const SIZE_MEASUREMENT_NOISE = 4e-3;
const INITIAL_POSITION_VARIANCE = 1e-2;
const INITIAL_VELOCITY_VARIANCE = 1e-1;

/** Keeps a filtered dimension from collapsing to zero or negative width. */
const MIN_EXTENT = 1e-4;

function seed(x: number): Scalar1D {
  return {
    x,
    v: 0,
    p00: INITIAL_POSITION_VARIANCE,
    p01: 0,
    p10: 0,
    p11: INITIAL_VELOCITY_VARIANCE,
  };
}

/** One time step of `x' = x + v`, `v' = v`, with the covariance pushed through F P Fᵀ + Q. */
function predict1D(s: Scalar1D): Scalar1D {
  const p00 = s.p00 + s.p01 + s.p10 + s.p11 + POSITION_PROCESS_NOISE;
  const p01 = s.p01 + s.p11;
  const p10 = s.p10 + s.p11;
  const p11 = s.p11 + VELOCITY_PROCESS_NOISE;
  return { x: s.x + s.v, v: s.v, p00, p01, p10, p11 };
}

/** Standard scalar Kalman update against a direct observation of `x`. */
function update1D(s: Scalar1D, z: number, r: number): Scalar1D {
  const innovation = z - s.x;
  const innovationVariance = s.p00 + r;
  if (innovationVariance === 0) return s;

  const k0 = s.p00 / innovationVariance;
  const k1 = s.p10 / innovationVariance;

  return {
    x: s.x + k0 * innovation,
    v: s.v + k1 * innovation,
    p00: s.p00 - k0 * s.p00,
    p01: s.p01 - k0 * s.p01,
    p10: s.p10 - k1 * s.p00,
    p11: s.p11 - k1 * s.p01,
  };
}

export function createBoxFilter(box: Box): BoxFilter {
  return {
    cx: seed(box.x + box.w / 2),
    cy: seed(box.y + box.h / 2),
    w: seed(box.w),
    h: seed(box.h),
  };
}

export function predictBox(filter: BoxFilter): BoxFilter {
  return {
    cx: predict1D(filter.cx),
    cy: predict1D(filter.cy),
    w: predict1D(filter.w),
    h: predict1D(filter.h),
  };
}

export function updateBox(filter: BoxFilter, measurement: Box): BoxFilter {
  return {
    cx: update1D(filter.cx, measurement.x + measurement.w / 2, POSITION_MEASUREMENT_NOISE),
    cy: update1D(filter.cy, measurement.y + measurement.h / 2, POSITION_MEASUREMENT_NOISE),
    w: update1D(filter.w, measurement.w, SIZE_MEASUREMENT_NOISE),
    h: update1D(filter.h, measurement.h, SIZE_MEASUREMENT_NOISE),
  };
}

export function filterToBox(filter: BoxFilter): Box {
  const w = Math.max(MIN_EXTENT, filter.w.x);
  const h = Math.max(MIN_EXTENT, filter.h.x);
  return { x: filter.cx.x - w / 2, y: filter.cy.x - h / 2, w, h };
}
