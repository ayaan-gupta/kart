import { createPipelineState, processFrame } from '../pipeline';
import { CATALOG } from '../../catalog';
import type { RawRegion } from '../types';

describe('processFrame', () => {
  it('turns two distinct chip-bag sightings into two separate lock events', () => {
    const regionA: RawRegion = {
      box: { x: 0, y: 0, w: 0.1, h: 0.1 },
      labels: [{ label: 'chips', confidence: 0.7 }],
    };
    const regionB: RawRegion = {
      box: { x: 0.5, y: 0.5, w: 0.1, h: 0.1 },
      labels: [{ label: 'chips', confidence: 0.7 }],
    };

    let state = createPipelineState();
    let events;
    ({ state, events } = processFrame(state, [regionA, regionB], 0, CATALOG));
    expect(events).toHaveLength(0); // not held long enough yet

    ({ state, events } = processFrame(state, [regionA, regionB], 600, CATALOG));
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.skuCode === '5561')).toBe(true);
    expect(events[0].candidateId).not.toBe(events[1].candidateId);
  });

  it('never locks a region with no catalog match', () => {
    const region: RawRegion = {
      box: { x: 0, y: 0, w: 0.1, h: 0.1 },
      labels: [{ label: 'shoe', confidence: 0.95 }],
    };
    let state = createPipelineState();
    let events;
    ({ state, events } = processFrame(state, [region], 0, CATALOG));
    ({ state, events } = processFrame(state, [region], 600, CATALOG));
    expect(events).toHaveLength(0);
    expect(state.candidates[0].state).toBe('forming');
  });

  it('falls through to a lower-ranked label when the top classifier label has no catalog mapping', () => {
    // "shoe" has no LABEL_TO_SKU entry, but the classifier's 2nd-ranked guess "grape" does.
    const region: RawRegion = {
      box: { x: 0, y: 0, w: 0.1, h: 0.1 },
      labels: [
        { label: 'shoe', confidence: 0.6 },
        { label: 'grape', confidence: 0.55 },
      ],
    };
    let state = createPipelineState();
    let events;
    ({ state, events } = processFrame(state, [region], 0, CATALOG));
    ({ state, events } = processFrame(state, [region], 600, CATALOG));
    expect(events).toHaveLength(1);
    expect(events[0].skuCode).toBe('0417');
  });

  it('does not lock a weak OCR-disambiguated match even though the raw classifier confidence alone is high', () => {
    // "bottle" is ambiguous (five candidate SKUs). High classifier confidence (0.9), but the
    // OCR text only weakly overlaps one candidate's name ("cold" out of five tokens in "Cold
    // brew concentrate, 32 oz" -> matchConfidence 0.2), well below the lock threshold — even
    // though the raw classifier confidence of 0.9 would have cleared it easily.
    const region: RawRegion = {
      box: { x: 0, y: 0, w: 0.1, h: 0.1 },
      labels: [{ label: 'bottle', confidence: 0.9 }],
      ocrText: 'COLD SOMETHING ELSE',
    };
    let state = createPipelineState();
    let events;
    ({ state, events } = processFrame(state, [region], 0, CATALOG));
    ({ state, events } = processFrame(state, [region], 600, CATALOG));
    expect(events).toHaveLength(0);
    expect(state.candidates[0].state).not.toBe('locked');
    expect(state.candidates[0].skuCode).toBe('5565');
  });
});
