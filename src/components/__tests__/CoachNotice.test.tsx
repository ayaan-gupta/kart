import { COACH_COPY, coachKind } from '../CoachNotice';

describe('coachKind', () => {
  it('shows nothing when the cart is clear and everything is confident', () => {
    expect(coachKind({ amberPersists: false, occluded: false })).toBe('none');
  });

  it('asks the user to come closer for a persistent uncertain item', () => {
    expect(coachKind({ amberPersists: true, occluded: false })).toBe('closer');
  });

  it('reports occlusion when items are hidden', () => {
    expect(coachKind({ amberPersists: false, occluded: true })).toBe('occluded');
  });

  it('prefers occlusion when both are true', () => {
    // Moving the covering items is the action that resolves both, so asking for it first
    // avoids giving two instructions at once.
    expect(coachKind({ amberPersists: true, occluded: true })).toBe('occluded');
  });
});

describe('COACH_COPY', () => {
  it('uses the exact requested wording', () => {
    expect(COACH_COPY.closer).toBe('Please bring your camera closer to items highlighted yellow');
    expect(COACH_COPY.occluded).toBe(
      "We're pretty sure you're missing stuff in your cart. Move items that are covering it and scan those items.",
    );
  });

  it('contains no em dashes', () => {
    // A project-wide rule, and user-facing copy is the easiest place for one to slip in.
    // Written as an escape so this file does not itself contain the character it forbids.
    const EM_DASH = '\u2014';
    for (const copy of Object.values(COACH_COPY)) expect(copy).not.toContain(EM_DASH);
  });
});
