import { assessOcclusion, containment, OCCLUSION_THRESHOLD, peakOverlap } from '../occlusion';

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
