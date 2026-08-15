import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Circle as SvgCircle, Path as SvgPath } from 'react-native-svg';
import { CaptureGuide, guideVisible } from '../CaptureGuide';
import { createCoverageState, observeYaw, SECTOR_COUNT, type CoverageState } from '../../engine/liveVision/coverage';
import { color, overlay } from '../../design/tokens';

const covered = (count: number) => {
  let s = createCoverageState();
  for (let i = 0; i < count; i++) s = observeYaw(s, (i * Math.PI) / 3);
  return s;
};

describe('guideVisible', () => {
  it('stays hidden while the cart looks fully visible', () => {
    // The product decision: this is not always-on chrome. It appears only when we believe the
    // user is not showing us everything.
    expect(guideVisible({ occluded: false, coverage: createCoverageState() })).toBe(false);
  });

  it('appears when the cart is hiding items', () => {
    expect(guideVisible({ occluded: true, coverage: createCoverageState() })).toBe(true);
  });

  it('retracts once enough angles are covered', () => {
    expect(guideVisible({ occluded: true, coverage: covered(3) })).toBe(false);
  });

  it('retracts when occlusion clears, even with coverage unfinished', () => {
    // Moving one box off a pile can resolve the occlusion outright. Continuing to march the
    // user around a cart that is now fully visible would be nagging.
    expect(guideVisible({ occluded: false, coverage: covered(1) })).toBe(false);
  });
});

/**
 * Render-level tests. `guideVisible` being correct is not enough on its own: a `CaptureGuide`
 * that ignored `visible` and always (or never) rendered the ring, or that ignored `coverage`
 * and painted every sector the same, would still pass every test above unchanged. These render
 * the real component and inspect the tree it produces, the same discipline `ItemHighlights`'
 * render tests use.
 */
describe('CaptureGuide rendering', () => {
  function renderGuide(coverage: CoverageState, visible: boolean) {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<CaptureGuide coverage={coverage} visible={visible} />);
    });
    return renderer;
  }

  it('renders nothing when not visible, even with items hidden and coverage unfinished', () => {
    // A component that ignored `visible` and always drew the ring would fail this.
    const renderer = renderGuide(covered(1), false);
    expect(renderer.toJSON()).toBeNull();
  });

  it('draws one arc per sector, plus the base track circle, when visible', () => {
    const renderer = renderGuide(createCoverageState(), true);
    const paths = renderer.root.findAllByType(SvgPath);
    const circles = renderer.root.findAllByType(SvgCircle);
    // A component that ignored `visible` and never drew the ring would fail this.
    expect(paths.length).toBe(SECTOR_COUNT);
    expect(circles.length).toBe(1);
  });

  it('colors a covered sector differently from a pending one, and matches which sector is which', () => {
    // Sectors 0 and 2 done, the rest not. A component that ignored `coverage` and painted every
    // sector the same (all pending, or all done) collapses this set to size 1.
    const coverage: CoverageState = {
      sectors: [true, false, true, false, false, false],
      originYaw: 0,
    };
    const renderer = renderGuide(coverage, true);
    const paths = renderer.root.findAllByType(SvgPath);
    expect(paths.length).toBe(SECTOR_COUNT);

    const strokes = paths.map((p) => p.props.stroke);
    expect(new Set(strokes).size).toBe(2);
    expect(strokes[0]).toBe(color.brand);
    expect(strokes[2]).toBe(color.brand);
    expect(strokes[1]).toBe(overlay.guidePending);
    expect(strokes[3]).toBe(overlay.guidePending);
    expect(strokes[4]).toBe(overlay.guidePending);
    expect(strokes[5]).toBe(overlay.guidePending);
  });

  it('shows the walk-around caption and an accessibility label describing the same instruction', () => {
    const renderer = renderGuide(createCoverageState(), true);
    const words = JSON.stringify(renderer.toJSON());
    expect(words).toContain('Move around your cart');

    const progressbar = renderer.root.findByProps({ accessibilityRole: 'progressbar' });
    expect(progressbar.props.accessibilityLabel).toBe('Walk around your cart so nothing is hidden');
  });
});
