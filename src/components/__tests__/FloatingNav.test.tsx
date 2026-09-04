import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { SafeAreaProvider, type Metrics } from 'react-native-safe-area-context';
import { color } from '../../design/tokens';
// babel-plugin-jest-hoist lifts the jest.mock below above this import, so the mocked router is
// already in place by the time the component is loaded.
import { FloatingNav } from '../FloatingNav';

/**
 * Which way in the thumb lands on.
 *
 * Both entrances exist on purpose: photographing one item is the interaction the product owner
 * asked for on 2026-09-02 ("take a photo, press a button"), and live scanning is kept whole
 * because the plan is to move back to it later. Keeping both is not the same as being neutral
 * about which one the app leads with, and a diff cannot show that: two `router.push` calls read
 * identically whether the photo button is the big coloured one or the small grey one beside it.
 *
 * So these assert on what the button looks like, not just where it points. The brand-coloured
 * circle is the app's primary action everywhere else in the design, and it must be the one that
 * opens the camera.
 */

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args), replace: jest.fn() },
}));


// The nav reads a safe-area inset, which has no value outside a provider. Fixed metrics rather
// than a mocked hook, so the real component runs unmodified.
const metrics: Metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

function render() {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <FloatingNav current="home" />
      </SafeAreaProvider>,
    );
  });
  return renderer;
}

/**
 * The background colour of the circle inside a labelled pressable.
 *
 * Not simply the first styled View: `PressableScale` wraps its children in an Animated.View that
 * carries only a min-height and the press transform, so the first hit has no background at all.
 * Reading that one returns undefined, which quietly satisfies a `not.toBe(brand)` assertion for
 * the wrong reason. Take the first descendant that actually paints a background.
 */
function backgroundOf(renderer: TestRenderer.ReactTestRenderer, label: string): unknown {
  const pressable = renderer.root.findAll(
    (n) => n.props.accessibilityLabel === label && n.props.onPress !== undefined,
  )[0];
  for (const node of pressable.findAll(() => true)) {
    const raw = node.props.style;
    if (raw === undefined) continue;
    const style = Array.isArray(raw) ? Object.assign({}, ...raw.filter(Boolean)) : raw;
    if (style.backgroundColor !== undefined) return style.backgroundColor;
  }
  return undefined;
}

beforeEach(() => mockPush.mockClear());

test('the primary, brand-coloured button opens the photo screen', () => {
  const renderer = render();
  const photo = renderer.root.findAll(
    (n) => n.props.accessibilityLabel === 'Photograph an item' && n.props.onPress !== undefined,
  )[0];

  act(() => photo.props.onPress());

  expect(mockPush).toHaveBeenCalledWith('/photo');
  expect(backgroundOf(renderer, 'Photograph an item')).toBe(color.brand);
});

test('live scanning is still reachable, as the secondary action', () => {
  const renderer = render();
  const scan = renderer.root.findAll(
    (n) => n.props.accessibilityLabel === 'Start a new scan' && n.props.onPress !== undefined,
  )[0];

  act(() => scan.props.onPress());

  expect(mockPush).toHaveBeenCalledWith('/scan');
  expect(backgroundOf(renderer, 'Start a new scan')).toBe(color.surface);
});
