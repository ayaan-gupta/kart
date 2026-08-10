import { createPipelineState, processFrame } from '../pipeline';
import { CATALOG } from '../../catalog';
import type { RawRegion } from '../types';

describe('processFrame', () => {
  it('turns two distinct chip-bag sightings into two separate lock events', () => {
    const regionA: RawRegion = { box: { x: 0, y: 0, w: 0.1, h: 0.1 }, label: 'chips', confidence: 0.7 };
    const regionB: RawRegion = { box: { x: 0.5, y: 0.5, w: 0.1, h: 0.1 }, label: 'chips', confidence: 0.7 };

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
    const region: RawRegion = { box: { x: 0, y: 0, w: 0.1, h: 0.1 }, label: 'shoe', confidence: 0.95 };
    let state = createPipelineState();
    let events;
    ({ state, events } = processFrame(state, [region], 0, CATALOG));
    ({ state, events } = processFrame(state, [region], 600, CATALOG));
    expect(events).toHaveLength(0);
    expect(state.candidates[0].state).toBe('forming');
  });
});
