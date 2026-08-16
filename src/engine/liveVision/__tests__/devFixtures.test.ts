import { GREEN_CONFIDENCE } from '../config';
import { devRequestCensus, devRequestIdentify } from '../devFixtures';

describe('devRequestCensus', () => {
  it('names one mark per requested mark, in request order, at a below-green confidence', async () => {
    const result = await devRequestCensus({
      imageBase64: '',
      marks: [
        { id: 1, box: { x: 0, y: 0, w: 0.2, h: 0.2 } },
        { id: 2, box: { x: 0.5, y: 0, w: 0.2, h: 0.2 } },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.marks).toHaveLength(2);
    expect(result.value.marks[0].id).toBe(1);
    expect(result.value.marks[1].id).toBe(2);
    // Below GREEN_CONFIDENCE on purpose: see the doc comment in devFixtures.ts. This is what
    // sends every dev-run item through resolveUncertain -> devRequestIdentify, not just a
    // single-call green result.
    for (const mark of result.value.marks) {
      expect(mark.confidence).toBeLessThan(GREEN_CONFIDENCE);
    }
  });

  it('reports no occlusion, since the harness models none', async () => {
    const result = await devRequestCensus({ imageBase64: '', marks: [] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.occlusion.itemsLikelyHidden).toBe(false);
    expect(result.value.occlusion.severity).toBe('none');
  });

  it('drops the mark id from an unrecognized index cleanly rather than throwing', async () => {
    // The fixture name list is finite; a huge mark id set must still resolve every mark by
    // cycling through it rather than throwing on an out-of-range read.
    const marks = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, box: { x: 0, y: 0, w: 0.1, h: 0.1 } }));
    const result = await devRequestCensus({ imageBase64: '', marks });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.marks).toHaveLength(12);
    expect(result.value.marks.every((m) => typeof m.name === 'string' && m.name.length > 0)).toBe(true);
  });
});

describe('devRequestIdentify', () => {
  it('echoes the census hint back at a confident, resolved score', async () => {
    const result = await devRequestIdentify({ imageBase64: '', box: null, hint: 'Cobalt Bottle' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.name).toBe('Cobalt Bottle');
    expect(result.value.confidence).toBeGreaterThanOrEqual(GREEN_CONFIDENCE);
    expect(result.value.stillUnclear).toBe(false);
  });

  it('falls back to a generic name when no hint was given', async () => {
    const result = await devRequestIdentify({ imageBase64: '', box: null, hint: null });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.name.length).toBeGreaterThan(0);
  });
});
