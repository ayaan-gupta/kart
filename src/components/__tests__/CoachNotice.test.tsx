import React from 'react';
import { AccessibilityInfo } from 'react-native';
import TestRenderer, { act, type ReactTestRendererJSON } from 'react-test-renderer';
import { COACH_COPY, CoachNotice, coachKind } from '../CoachNotice';
import { guideVisible } from '../CaptureGuide';
import { createCoverageState, REQUIRED_SECTORS, type CoverageState } from '../../engine/liveVision/coverage';

type Json = ReactTestRendererJSON | ReactTestRendererJSON[] | string | null;

/**
 * The literal words rendered anywhere in the tree, joined into one string.
 *
 * Walks `toJSON()`'s plain object/array/string shape rather than `root.findAllByType`: a test
 * instance's `.children` holds live fiber-wrapped test instances (circular, and not the raw
 * text), where `toJSON()`'s children are the same plain strings the host platform actually
 * paints, which is what "shows the right copy" needs to check.
 */
function renderedWords(node: Json): string {
  if (node === null) return '';
  if (Array.isArray(node)) return node.map(renderedWords).join(' ');
  if (typeof node === 'string') return node;
  return (node.children ?? []).map(renderedWords).join(' ');
}

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

  it('reports unavailable when every census has failed', () => {
    expect(coachKind({ amberPersists: false, occluded: false, unavailable: true }))
      .toBe('unavailable');
  });

  it('prefers unavailable over both other notices', () => {
    // "Bring your camera closer" and "move the items covering it" are both instructions to work
    // harder at something that cannot succeed while recognition is not answering, which is worse
    // than saying nothing. See KART.md's eighty-fifth section for how the silent version read to
    // a shopper: an empty bag and a broken scan were the same screen.
    expect(coachKind({ amberPersists: true, occluded: true, unavailable: true }))
      .toBe('unavailable');
  });

  it('says nothing about availability when the flag is absent, as older callers pass', () => {
    expect(coachKind({ amberPersists: false, occluded: false })).toBe('none');
  });

  it('says nothing about the cause of the outage', () => {
    // Two faults reach this notice, a service that will not answer and a native detector that did
    // not load, and advice fitting one misdirects on the other. See CoachNotice.tsx.
    expect(COACH_COPY.unavailable).not.toMatch(/connection|network|offline|wifi/i);
    expect(COACH_COPY.unavailable).toMatch(/cart/i);
  });

  it('has copy for every kind it can return', () => {
    // A kind with no entry renders undefined text and announces undefined to a screen reader.
    for (const kind of ['closer', 'occluded', 'unavailable'] as const) {
      expect(typeof COACH_COPY[kind]).toBe('string');
      expect(COACH_COPY[kind].length).toBeGreaterThan(0);
    }
  });
});

describe('I3: the occluded notice has an exit even when the occlusion verdict itself is stuck', () => {
  // Regression: orchestrator.ts's state.occlusion is only ever written by a successful census
  // (see onKeyframe), so once the census budget is spent it can freeze at `true` for the rest
  // of the session with nothing left to clear it. scan.tsx now feeds coachKind the same
  // `guideVisible` value the capture guide already uses, rather than the raw occluded flag, so
  // the notice shares the guide's own coverage-based exit. This reproduces exactly that stuck
  // scenario: `occluded` itself never flips back to false, ever.
  const stuckOccluded = true;

  const complete = (): CoverageState => {
    let state = createCoverageState();
    for (let i = 0; i < REQUIRED_SECTORS; i++) {
      state = { sectors: state.sectors.map((s, idx) => (idx === i ? true : s)), originYaw: 0 };
    }
    return state;
  };

  it('shows the occluded notice while coverage is incomplete', () => {
    const guide = guideVisible({ occluded: stuckOccluded, coverage: createCoverageState() });
    expect(coachKind({ amberPersists: false, occluded: guide })).toBe('occluded');
  });

  it('clears the occluded notice once coverage completes, even though the underlying verdict never does', () => {
    const guide = guideVisible({ occluded: stuckOccluded, coverage: complete() });
    expect(guide).toBe(false);
    expect(coachKind({ amberPersists: false, occluded: guide })).toBe('none');
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

describe('CoachNotice', () => {
  let tree: TestRenderer.ReactTestRenderer | null = null;
  // The React Native jest preset already replaces `AccessibilityInfo.announceForAccessibility`
  // with a persistent `jest.fn()` (see `@react-native/jest-preset/jest/mocks/AccessibilityInfo`),
  // shared for the life of this file. `jest.spyOn` on a function that is already a mock hands
  // back that same mock rather than a fresh one, so `jest.restoreAllMocks()` cannot clear its
  // call history between tests; only `mockClear()` on the mock itself does. Referencing it
  // directly, instead of wrapping it in another spy, is both the fix and the simpler test.
  const announce = jest.mocked(AccessibilityInfo.announceForAccessibility);

  afterEach(async () => {
    // Wrapped in act(): unmounting is itself an update, and doing it outside act() only logs a
    // warning under this React version rather than throwing, so it is easy to leave in by
    // mistake.
    await act(async () => {
      tree?.unmount();
    });
    tree = null;
    announce.mockClear();
  });

  // A component that ignores `kind` and always renders (or never renders) must fail at least
  // one of these three: the 'none' case demands nothing on screen, and the other two each
  // demand their own copy be present and the other kind's copy be absent.

  it('renders nothing for kind "none"', async () => {
    await act(async () => {
      tree = TestRenderer.create(<CoachNotice kind="none" topInset={0} />);
    });
    expect(tree!.toJSON()).toBeNull();
  });

  it('shows the closer copy, and only the closer copy, for kind "closer"', async () => {
    await act(async () => {
      tree = TestRenderer.create(<CoachNotice kind="closer" topInset={0} />);
    });
    const words = renderedWords(tree!.toJSON());
    expect(words).toContain(COACH_COPY.closer);
    expect(words).not.toContain(COACH_COPY.occluded);
  });

  it('shows the occluded copy, and only the occluded copy, for kind "occluded"', async () => {
    await act(async () => {
      tree = TestRenderer.create(<CoachNotice kind="occluded" topInset={0} />);
    });
    const words = renderedWords(tree!.toJSON());
    expect(words).toContain(COACH_COPY.occluded);
    expect(words).not.toContain(COACH_COPY.closer);
  });

  it('proactively announces the copy for accessibility, since the point is to interrupt someone looking at their cart rather than the screen', async () => {
    await act(async () => {
      tree = TestRenderer.create(<CoachNotice kind="occluded" topInset={0} />);
    });
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith(COACH_COPY.occluded);
  });

  it('does not announce anything for kind "none"', async () => {
    await act(async () => {
      tree = TestRenderer.create(<CoachNotice kind="none" topInset={0} />);
    });
    expect(announce).not.toHaveBeenCalled();
  });
});
