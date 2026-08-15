import {
  coverageFraction,
  createCoverageState,
  isCoverageComplete,
  normalizeAngle,
  observeYaw,
  REQUIRED_SECTORS,
  SECTOR_COUNT,
  sectorFor,
} from '../coverage';

describe('normalizeAngle', () => {
  it('wraps a negative angle into the positive range', () => {
    expect(normalizeAngle(-Math.PI / 2)).toBeCloseTo((3 * Math.PI) / 2, 9);
  });

  it('wraps an angle past a full turn', () => {
    expect(normalizeAngle(Math.PI * 2.5)).toBeCloseTo(Math.PI * 0.5, 9);
  });
});

describe('sectorFor', () => {
  it('puts the origin in sector zero', () => {
    expect(sectorFor(1.234, 1.234)).toBe(0);
  });

  it('brings a full turn back to sector zero', () => {
    expect(sectorFor(1.234 + Math.PI * 2, 1.234)).toBe(0);
  });

  it('never indexes past the last sector', () => {
    expect(sectorFor(Math.PI * 2, 0)).toBeLessThan(SECTOR_COUNT);
  });

  it('puts a half turn in the opposite sector', () => {
    expect(sectorFor(Math.PI, 0)).toBe(SECTOR_COUNT / 2);
  });

  it('wraps a yaw behind the origin rather than clamping it', () => {
    expect(sectorFor(-0.2, 0)).toBe(SECTOR_COUNT - 1);
  });

  it('lands exactly on a boundary rather than a hair below it', () => {
    // The regression. `3.0 + 2*Math.PI/3 - 3.0` scales to 1.9999999999999993, not 2, so without
    // the snap in sectorFor this returns 1 and a user standing on a sector line can never
    // finish the guide.
    expect(sectorFor(3.0 + (2 * Math.PI) / 3, 3.0)).toBe(2);
  });
});

describe('observeYaw', () => {
  it('adopts the first yaw as the origin', () => {
    const s = observeYaw(createCoverageState(), 3.0);
    expect(s.originYaw).toBe(3.0);
    expect(s.sectors[0]).toBe(true);
    expect(coverageFraction(s)).toBeCloseTo(1 / SECTOR_COUNT, 9);
  });

  it('marks three distinct sectors as the user walks round', () => {
    let s = createCoverageState();
    s = observeYaw(s, 3.0);
    s = observeYaw(s, 3.0 + Math.PI / 3);
    s = observeYaw(s, 3.0 + (2 * Math.PI) / 3);
    expect(s.sectors.filter(Boolean)).toHaveLength(3);
    expect(isCoverageComplete(s)).toBe(true);
  });

  it('returns the same object when nothing changed', () => {
    // This runs off a sensor at 10Hz. Allocating a new state per sample would rerender the
    // guide constantly for no visible change.
    let s = observeYaw(createCoverageState(), 3.0);
    expect(observeYaw(s, 3.0)).toBe(s);
  });

  it('is not complete before the required number of sectors', () => {
    let s = createCoverageState();
    s = observeYaw(s, 0);
    expect(isCoverageComplete(s)).toBe(false);
    expect(REQUIRED_SECTORS).toBeLessThan(SECTOR_COUNT);
  });
});
