import { outlineStateFor } from '../ItemHighlights';
import { GREEN_CONFIDENCE } from '../../engine/liveVision/config';
import type { Identity, Track } from '../../engine/liveVision/types';

const track = (over: Partial<Track> = {}): Track =>
  ({ id: 'a', box: { x: 0, y: 0, w: 0.2, h: 0.2 }, polygon: [0, 0, 0.2, 0, 0.2, 0.2],
     score: 0.9, state: 'confirmed', hits: 5, lastSeenAt: 0, barcode: null,
     filter: {} as Track['filter'], ...over }) as Track;

const identity = (over: Partial<Identity> = {}): Identity => ({
  key: '::bananas', name: 'Bananas', brand: null, size: null, category: 'Produce',
  confidence: 0.9, needsCloserLook: false, source: 'vlm', ...over,
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
});
