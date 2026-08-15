import { REQUIRED_SECTORS, SECTOR_COUNT } from './config';

export { REQUIRED_SECTORS, SECTOR_COUNT };

export interface CoverageState {
  /** One flag per sector, indexed clockwise from where the scan started. */
  sectors: boolean[];
  /** Yaw in radians at the moment the guide opened. All angles are relative to this. */
  originYaw: number | null;
}

export function createCoverageState(): CoverageState {
  return { sectors: new Array(SECTOR_COUNT).fill(false), originYaw: null };
}

const TAU = Math.PI * 2;

/** Wraps any angle into 0..2pi. Device yaw is reported in -pi..pi and wraps mid-scan. */
export function normalizeAngle(radians: number): number {
  const wrapped = radians % TAU;
  return wrapped < 0 ? wrapped + TAU : wrapped;
}

export function sectorFor(yaw: number, originYaw: number): number {
  const relative = normalizeAngle(yaw - originYaw);
  const scaled = (relative / TAU) * SECTOR_COUNT;

  // Snap to an exact boundary before flooring. Subtracting the origin loses precision, so a
  // yaw that is mathematically exactly on a sector line comes out a hair below it and floors
  // into the previous sector. Standing on a boundary would then re-mark a sector already
  // covered and the guide would never complete. Verified: 3.0 + 2*pi/3 - 3.0 scales to
  // 1.9999999999999993, not 2.
  const nearest = Math.round(scaled);
  const snapped = Math.abs(scaled - nearest) < 1e-9 ? nearest : scaled;

  return Math.min(SECTOR_COUNT - 1, Math.max(0, Math.floor(snapped)));
}

/** Records the sector the phone is currently pointing from. */
export function observeYaw(state: CoverageState, yaw: number): CoverageState {
  const originYaw = state.originYaw ?? yaw;
  const index = sectorFor(yaw, originYaw);
  if (state.sectors[index] && state.originYaw !== null) return state;
  const sectors = [...state.sectors];
  sectors[index] = true;
  return { sectors, originYaw };
}

export function coverageFraction(state: CoverageState): number {
  return state.sectors.filter(Boolean).length / SECTOR_COUNT;
}

export function isCoverageComplete(state: CoverageState): boolean {
  return state.sectors.filter(Boolean).length >= REQUIRED_SECTORS;
}
