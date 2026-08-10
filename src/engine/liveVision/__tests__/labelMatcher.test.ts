import { matchRegion } from '../labelMatcher';
import { CATALOG } from '../../catalog';

describe('matchRegion', () => {
  it('matches a produce label directly, no OCR needed', () => {
    const result = matchRegion({ labels: [{ label: 'grape', confidence: 0.61 }] }, CATALOG);
    expect(result.skuCode).toBe('0417');
    expect(result.matchConfidence).toBeCloseTo(0.61);
  });

  it('resolves an ambiguous packaged-goods label using OCR text', () => {
    const result = matchRegion(
      { labels: [{ label: 'bottle', confidence: 0.4 }], ocrText: 'OAT MILK 64 OZ UNSWEETENED' },
      CATALOG,
    );
    expect(result.skuCode).toBe('1126'); // Oat milk, 64 oz
  });

  it('picks the better OCR match among several ambiguous candidates', () => {
    const result = matchRegion(
      { labels: [{ label: 'bottle', confidence: 0.4 }], ocrText: 'COLD BREW CONCENTRATE' },
      CATALOG,
    );
    expect(result.skuCode).toBe('5565'); // Cold brew concentrate, 32 oz
  });

  it('returns null when a label is ambiguous and there is no OCR text', () => {
    const result = matchRegion({ labels: [{ label: 'bottle', confidence: 0.4 }] }, CATALOG);
    expect(result.skuCode).toBeNull();
    expect(result.matchConfidence).toBe(0);
  });

  it('returns null for a label with no catalog mapping at all', () => {
    const result = matchRegion({ labels: [{ label: 'shoe', confidence: 0.9 }] }, CATALOG);
    expect(result.skuCode).toBeNull();
  });

  it('falls through to the 2nd-ranked label when the top label has no catalog mapping', () => {
    const result = matchRegion(
      {
        labels: [
          { label: 'shoe', confidence: 0.9 },
          { label: 'grape', confidence: 0.55 },
        ],
      },
      CATALOG,
    );
    expect(result.skuCode).toBe('0417');
    expect(result.matchConfidence).toBeCloseTo(0.55);
  });

  it('falls through to the 3rd-ranked label when neither the 1st nor 2nd has a catalog mapping', () => {
    const result = matchRegion(
      {
        labels: [
          { label: 'shoe', confidence: 0.9 },
          { label: 'material', confidence: 0.7 },
          { label: 'banana', confidence: 0.4 },
        ],
      },
      CATALOG,
    );
    expect(result.skuCode).toBe('0411');
    expect(result.matchConfidence).toBeCloseTo(0.4);
  });

  it('returns null when no candidate label in the list has a catalog mapping', () => {
    const result = matchRegion(
      {
        labels: [
          { label: 'shoe', confidence: 0.9 },
          { label: 'material', confidence: 0.7 },
        ],
      },
      CATALOG,
    );
    expect(result.skuCode).toBeNull();
  });
});
