import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Circle as SvgCircle, Path as SvgPath } from 'react-native-svg';
import { ItemHighlights, outlineStateFor } from '../ItemHighlights';
import { COVERED_FRACTION, GREEN_CONFIDENCE } from '../../engine/liveVision/config';
import { polygonBounds, polygonCentroid, polygonToSvgPath } from '../../engine/liveVision/geometry';
import type { Identity, Track } from '../../engine/liveVision/types';

const track = (over: Partial<Track> = {}): Track =>
  ({ id: 'a', box: { x: 0, y: 0, w: 0.2, h: 0.2 }, polygon: [0, 0, 0.2, 0, 0.2, 0.2],
     score: 0.9, state: 'confirmed', hits: 5, lastSeenAt: 0, barcode: null,
     filter: {} as Track['filter'], ...over }) as Track;

const identity = (over: Partial<Identity> = {}): Identity => ({
  key: '::bananas', name: 'Bananas', brand: null, size: null, category: 'Produce',
  confidence: 0.9, needsCloserLook: false, source: 'vlm', placeholder: false,
  verifiedByIdentify: false, ...over,
});

describe('outlineStateFor', () => {
  it('is forming when nothing has named it yet', () => {
    expect(outlineStateFor(track(), undefined)).toBe('forming');
  });

  it('is forming while the track is still tentative, even with an identity', () => {
    // A tentative track may be a detector artefact. Turning it green would count it visually
    // before the tracker is convinced it exists.
    expect(outlineStateFor(track({ state: 'tentative' }), identity())).toBe('forming');
  });

  it('is counted at or above the green threshold', () => {
    expect(outlineStateFor(track(), identity({ confidence: GREEN_CONFIDENCE }))).toBe('counted');
  });

  it('needs a closer look below the threshold', () => {
    expect(outlineStateFor(track(), identity({ confidence: GREEN_CONFIDENCE - 0.01 }))).toBe('closer');
  });

  it('needs a closer look when the model says so, however confident it sounds', () => {
    expect(outlineStateFor(track(), identity({ confidence: 0.99, needsCloserLook: true }))).toBe('closer');
  });

  it('is counted for a resolved barcode', () => {
    expect(outlineStateFor(track(), identity({ source: 'barcode', confidence: 1 }))).toBe('counted');
  });

  it('is covered when enough of it sits behind the items in front', () => {
    expect(outlineStateFor(track(), undefined, COVERED_FRACTION)).toBe('covered');
  });

  it('prefers covered over forming, because only covered says what to do about it', () => {
    // Both describe an unidentified item. 'forming' invites the shopper to hold still and wait,
    // which will never work for something behind a cereal box; 'covered' asks them to move it.
    expect(outlineStateFor(track({ state: 'tentative' }), undefined, 0.9)).toBe('covered');
    expect(outlineStateFor(track({ state: 'tentative' }), undefined, 0)).toBe('forming');
  });

  it('prefers covered over closer for a half-seen item we guessed at', () => {
    const unsure = identity({ confidence: GREEN_CONFIDENCE - 0.01 });
    expect(outlineStateFor(track(), unsure, 0.9)).toBe('covered');
  });

  it('leaves an already counted item counted when something is set down in front of it', () => {
    // The answer is banked. Re-opening it because the view got worse would drop an item out of
    // the bag that we were right about.
    expect(outlineStateFor(track(), identity({ confidence: 0.99 }), 0.95)).toBe('counted');
  });

  it('stays in its old state just below the covered threshold', () => {
    expect(outlineStateFor(track(), undefined, COVERED_FRACTION - 0.001)).toBe('forming');
  });

  it('collapses to the three original states when nothing is covering anything', () => {
    // The default argument is what keeps every existing caller's behaviour intact.
    expect(outlineStateFor(track(), undefined)).toBe(outlineStateFor(track(), undefined, 0));
  });

  it('needs a closer look when confidence is NaN, and never fails open to counted', () => {
    // `NaN < GREEN_CONFIDENCE` is false, so a naive comparison would let a garbage confidence
    // through as 'counted', the most trusted state. A corrupt number must degrade, not confirm.
    expect(outlineStateFor(track(), identity({ confidence: NaN }))).toBe('closer');
  });
});

/**
 * Render-level tests. `outlineStateFor` being correct is not enough on its own: a component
 * that computed the right state and then painted every outline the same color, or that quietly
 * traced `track.box` instead of `track.polygon`, would still pass every test above unchanged.
 * These render the real component and inspect the SVG tree it produces.
 */
describe('ItemHighlights rendering', () => {
  const FRAME = { width: 400, height: 800 };

  function renderHighlights(tracks: Track[], identities: Record<string, Identity>) {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <ItemHighlights tracks={tracks} identities={identities} frameSize={FRAME} />,
      );
    });
    // The component measures itself via onLayout before it draws anything. Matching the layout
    // size to frameSize keeps the display scale at 1 and the offset at 0, so the expected `d`
    // string below can be computed with the same `polygonToSvgPath` call the component makes,
    // without duplicating its cover-fit scale/offset math.
    const outer = renderer.root.findByProps({ pointerEvents: 'none' });
    act(() => {
      outer.props.onLayout({ nativeEvent: { layout: { width: FRAME.width, height: FRAME.height } } });
    });
    return renderer.root;
  }

  it('traces the tracked item\'s actual polygon, not a bounding rectangle', () => {
    // Deliberately not a box: three points whose bounding rectangle is a visibly different
    // shape, so a component that silently substituted `track.box` for `track.polygon` would
    // draw a detectably different path, not merely a differently-sized version of this one.
    const polygon = [0.1, 0.1, 0.3, 0.15, 0.25, 0.4];
    const t = track({ id: 'shape-1', polygon });
    const root = renderHighlights([t], { 'shape-1': identity() });

    const expectedD = polygonToSvgPath(polygon, FRAME.width, FRAME.height, 0, 0);
    const bounds = polygonBounds(polygon);
    const boxPolygon = [
      bounds.x, bounds.y,
      bounds.x + bounds.w, bounds.y,
      bounds.x + bounds.w, bounds.y + bounds.h,
      bounds.x, bounds.y + bounds.h,
    ];
    const boxD = polygonToSvgPath(boxPolygon, FRAME.width, FRAME.height, 0, 0);
    // Sanity check on the fixture itself: if these matched, this test would prove nothing.
    expect(boxD).not.toBe(expectedD);

    const paths = root.findAllByType(SvgPath);
    expect(paths.some((p) => p.props.d === expectedD)).toBe(true);
    expect(paths.some((p) => p.props.d === boxD)).toBe(false);
  });

  it('gives tracks in different states visually distinct stroke colors', () => {
    const counted = track({ id: 'counted-1', polygon: [0.1, 0.1, 0.3, 0.15, 0.25, 0.4] });
    const closer = track({ id: 'closer-1', polygon: [0.5, 0.05, 0.75, 0.2, 0.7, 0.5, 0.45, 0.35] });
    const forming = track({ id: 'forming-1', polygon: [0.1, 0.6, 0.3, 0.55, 0.35, 0.8, 0.15, 0.85] });
    const identities: Record<string, Identity> = {
      'counted-1': identity({ confidence: 0.9 }),
      'closer-1': identity({ confidence: 0.2 }),
      // 'forming-1' has no identity entry: still forming.
    };
    const root = renderHighlights([counted, closer, forming], identities);
    const dFor = (t: Track) => polygonToSvgPath(t.polygon, FRAME.width, FRAME.height, 0, 0);

    const paths = root.findAllByType(SvgPath);
    const countedOutline = paths.find((p) => p.props.d === dFor(counted));
    const closerOutline = paths.find((p) => p.props.d === dFor(closer));
    const formingOutline = paths.find((p) => p.props.d === dFor(forming));

    expect(countedOutline).toBeDefined();
    expect(closerOutline).toBeDefined();
    expect(formingOutline).toBeDefined();

    // A component that painted every outline the same color (e.g. always FORMING_STROKE)
    // collapses this set to size 1.
    const strokes = [countedOutline!.props.stroke, closerOutline!.props.stroke, formingOutline!.props.stroke];
    expect(new Set(strokes).size).toBe(3);

    expect(countedOutline!.props.fill).not.toBe('none');
    expect(closerOutline!.props.fill).not.toBe('none');
    expect(formingOutline!.props.fill).toBe('none');
  });

  it('draws the check badge only for a counted item, centered on its own centroid', () => {
    const counted = track({ id: 'counted-1', polygon: [0.1, 0.1, 0.3, 0.15, 0.25, 0.4] });
    const forming = track({ id: 'forming-1', polygon: [0.5, 0.5, 0.7, 0.55, 0.65, 0.8] });
    const identities: Record<string, Identity> = { 'counted-1': identity({ confidence: 0.9 }) };
    const root = renderHighlights([counted, forming], identities);

    const circles = root.findAllByType(SvgCircle);
    expect(circles.length).toBe(1);

    const centroid = polygonCentroid(counted.polygon);
    expect(circles[0].props.cx).toBeCloseTo(centroid.x * FRAME.width);
    expect(circles[0].props.cy).toBeCloseTo(centroid.y * FRAME.height);
  });
});

describe('outlineStateFor, examined but unnamed', () => {
  it('is closer when recognition ran and produced no confident name', () => {
    // The matcher looked at this crop, declined to name it, and has a shortlist to offer. With
    // the confidence floor set where real photographs need it, this is the commonest outcome in
    // the whole pipeline, and it used to be drawn as a plain outline: identical to an item
    // nothing had looked at yet, and giving the shopper nothing to act on.
    expect(outlineStateFor(track(), undefined, 0, true)).toBe('closer');
  });

  it('is still forming when nothing has looked at it yet', () => {
    expect(outlineStateFor(track(), undefined, 0, false)).toBe('forming');
  });

  it('does not promote a tentative track to closer on the strength of a look', () => {
    // A tentative track may be a detector artefact. Recognition running over it does not make
    // it an item worth asking the shopper about.
    expect(outlineStateFor(track({ state: 'tentative' }), undefined, 0, true)).toBe('forming');
  });

  it('still prefers covered over closer for an examined item that is buried', () => {
    expect(outlineStateFor(track(), undefined, 0.9, true)).toBe('covered');
  });

  it('leaves a confidently named item green', () => {
    expect(outlineStateFor(track(), identity({ confidence: 0.99 }), 0, true)).toBe('counted');
  });
});
