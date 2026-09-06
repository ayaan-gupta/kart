import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Rect as SvgRect } from 'react-native-svg';
import { fitContain, PhotoReview } from '../PhotoReview';
import { overlay } from '../../design/tokens';
import type { PhotoItem } from '../../engine/liveVision/photoScan';

/**
 * The review: the shopper's own photograph with every item outlined, green when both readings
 * agreed and amber when they did not. The owner's design, in their words: the items that were
 * high confidence highlighted green, the one in the middle highlighted yellow.
 */
const item = (over: Partial<PhotoItem> = {}): PhotoItem => ({
  id: 'a', key: '::rigatoni', name: 'Rigatoni', brand: 'Priano', qty: 1, confidence: 0.95, status: 'sure',
  box: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 }, ...over,
});

describe('fitContain', () => {
  it('fits a portrait photograph inside a taller container by width', () => {
    const fit = fitContain({ w: 400, h: 1000 }, { w: 1536, h: 2048 });
    expect(fit.x).toBe(0);
    expect(fit.w).toBe(400);
    expect(fit.h).toBeCloseTo(400 * (2048 / 1536));
    expect(fit.y).toBeCloseTo((1000 - 400 * (2048 / 1536)) / 2);
  });

  it('fits a landscape photograph inside a portrait container by width, centred vertically', () => {
    const fit = fitContain({ w: 400, h: 800 }, { w: 2048, h: 1536 });
    expect(fit.w).toBe(400);
    expect(fit.h).toBe(300);
    expect(fit.y).toBe(250);
  });

  it('fits by height when the container is wider than the photograph', () => {
    const fit = fitContain({ w: 1000, h: 400 }, { w: 1536, h: 2048 });
    expect(fit.h).toBe(400);
    expect(fit.w).toBe(300);
    expect(fit.x).toBe(350);
  });

  it('draws nothing for a photograph with no size', () => {
    expect(fitContain({ w: 400, h: 800 }, { w: 0, h: 0 })).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });
});

describe('PhotoReview rendering', () => {
  const CONTAINER = { width: 400, height: 800 };

  function render(items: PhotoItem[]) {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <PhotoReview uri="data:image/jpeg;base64,QUJD" width={1536} height={2048} items={items} />,
      );
    });
    const outer = renderer.root.findByProps({ testID: 'photo-review' });
    act(() => {
      outer.props.onLayout({ nativeEvent: { layout: { width: CONTAINER.width, height: CONTAINER.height } } });
    });
    return renderer.root;
  }

  it('draws one rectangle per boxed item, on the photograph and in its frame', () => {
    const root = render([item({ id: 'a' }), item({ id: 'b', box: { x: 0.5, y: 0.5, w: 0.2, h: 0.2 } }), item({ id: 'c', box: null })]);
    const rects = root.findAllByType(SvgRect);
    expect(rects).toHaveLength(2);
    // A 1536 by 2048 photograph in a 400 by 800 container is 400 by 533.33, offset 133.33 down.
    const first = rects[0].props;
    expect(first.x).toBeCloseTo(0.1 * 400);
    expect(first.y).toBeCloseTo(133.333 + 0.2 * 533.333, 1);
    expect(first.width).toBeCloseTo(0.3 * 400);
    expect(first.height).toBeCloseTo(0.4 * 533.333, 1);
  });

  it('paints a sure item green and an unsure item amber, and a checking item with neither', () => {
    const root = render([item({ id: 'a', status: 'sure' }), item({ id: 'b', status: 'unsure' }), item({ id: 'c', status: 'checking' })]);
    const [sure, unsure, checking] = root.findAllByType(SvgRect).map((r) => r.props);
    expect(sure.stroke).toBe(overlay.countedStroke);
    expect(sure.fill).toBe(overlay.countedFill);
    expect(unsure.stroke).toBe(overlay.closerStroke);
    expect(unsure.fill).toBe(overlay.closerFill);
    expect(checking.stroke).toBe(overlay.formingStroke);
    expect(checking.fill).toBe('none');
  });

  it('labels every box with the product name, and says so to a screen reader', () => {
    const root = render([item({ id: 'a', name: 'Rigatoni', status: 'unsure' })]);
    const labels = root.findAllByProps({ accessibilityLabel: 'Rigatoni, not sure' });
    expect(labels.length).toBeGreaterThan(0);
  });
});
