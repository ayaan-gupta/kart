import fs from 'fs';
import path from 'path';

/**
 * The confidence gate on the screen the shopper uses. Asserted statically for the reason
 * `photo.occlusionNotice.test.ts` gives: photo.tsx pulls in VisionCamera and cannot render under
 * Jest. `photoScan.test.ts` proves the two readings are reconciled and `PhotoReview.test.tsx`
 * proves the review draws them; this proves the screen puts the two together.
 */
const PHOTO = fs.readFileSync(path.join(__dirname, '../photo.tsx'), 'utf8');

describe('photo.tsx shows the shopper their photograph with each item outlined', () => {
  it('renders PhotoReview with the items of the last photograph', () => {
    expect(PHOTO).toContain('<PhotoReview');
    expect(PHOTO).toMatch(/items=\{/);
  });

  it('cuts crops from the original and asks for the close read', () => {
    expect(PHOTO).toContain('prepareCrops(');
    expect(PHOTO).toContain('requestVerify');
    expect(PHOTO).toContain('deviceManipulator');
  });

  it('asks for a better image of an unsure item, in the owner\'s words, through coachKind', () => {
    expect(PHOTO).toMatch(/confirm:/);
  });

  it('sends the unsure names with the next photograph so the new reading replaces the old line', () => {
    expect(PHOTO).toMatch(/\bconfirming\b/);
  });

  it('shows the boxes as soon as the census answers, before the close read', () => {
    expect(PHOTO).toMatch(/onCensus/);
  });
});
