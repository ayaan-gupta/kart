import { matchRegion } from '../labelMatcher';
import { CATALOG } from '../../catalog';

describe('matchRegion', () => {
  it('matches a produce label directly, no OCR needed', () => {
    const result = matchRegion({ label: 'grape', confidence: 0.61 }, CATALOG);
    expect(result.skuCode).toBe('0417');
    expect(result.matchConfidence).toBeCloseTo(0.61);
  });

  it('resolves an ambiguous packaged-goods label using OCR text', () => {
    const result = matchRegion(
      { label: 'bottle', confidence: 0.4, ocrText: 'OAT MILK 64 OZ UNSWEETENED' },
      CATALOG,
    );
    expect(result.skuCode).toBe('1126'); // Oat milk, 64 oz
  });

  it('picks the better OCR match among several ambiguous candidates', () => {
    const result = matchRegion(
      { label: 'bottle', confidence: 0.4, ocrText: 'COLD BREW CONCENTRATE' },
      CATALOG,
    );
    expect(result.skuCode).toBe('5565'); // Cold brew concentrate, 32 oz
  });

  it('returns null when a label is ambiguous and there is no OCR text', () => {
    const result = matchRegion({ label: 'bottle', confidence: 0.4 }, CATALOG);
    expect(result.skuCode).toBeNull();
    expect(result.matchConfidence).toBe(0);
  });

  it('returns null for a label with no catalog mapping at all', () => {
    const result = matchRegion({ label: 'shoe', confidence: 0.9 }, CATALOG);
    expect(result.skuCode).toBeNull();
  });
});
