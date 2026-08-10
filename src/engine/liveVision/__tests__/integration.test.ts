import { createPipelineState, processFrame } from '../pipeline';
import { CATALOG } from '../../catalog';
import { aggregate, useScanline } from '../../store';
import type { RawRegion } from '../types';

// End-to-end integration path: raw regions -> processFrame -> TrackerEvent -> the *real*
// useScanline store's addDetection -> aggregate. Every other test in this suite stops at the
// TrackerEvent output; this is the only one that proves the full chain still produces the
// headline requirement — two physically distinct same-SKU items both count — through the
// actual store, not just the pure pipeline in isolation.
describe('live vision pipeline -> store integration', () => {
  it('feeds two lock events for the same SKU into the real store and aggregates to quantity 2', () => {
    const regionA: RawRegion = {
      box: { x: 0, y: 0, w: 0.1, h: 0.1 },
      labels: [{ label: 'chips', confidence: 0.7 }],
    };
    const regionB: RawRegion = {
      box: { x: 0.5, y: 0.5, w: 0.1, h: 0.1 },
      labels: [{ label: 'chips', confidence: 0.7 }],
    };

    let pipelineState = createPipelineState();
    let events;
    ({ state: pipelineState, events } = processFrame(pipelineState, [regionA, regionB], 0, CATALOG));
    expect(events).toHaveLength(0); // not held long enough yet

    ({ state: pipelineState, events } = processFrame(pipelineState, [regionA, regionB], 600, CATALOG));
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.skuCode === '5561')).toBe(true);

    useScanline.getState().startScan();
    for (const event of events) {
      useScanline.getState().addDetection(event.skuCode, event.confidence);
    }

    const items = aggregate(useScanline.getState().scan.detections);
    const chips = items.find((it) => it.skuCode === '5561');
    expect(chips).toBeDefined();
    expect(chips!.qty).toBe(2);
  });
});
