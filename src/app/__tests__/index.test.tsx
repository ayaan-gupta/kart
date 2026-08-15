import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import HomeScreen from '../index';

/**
 * Render-level guard for the home screen, the exact place this correction found `$0.00`
 * hardcoded against the "no money at all" decision. Renders the real screen against the app's
 * own seeded demo hauls (no store setup needed: `useScanline` seeds them synchronously) and
 * inspects what it actually produces, so a stat chip or a haul card that quietly reintroduced a
 * price would fail this, not just a diff review.
 */
function renderHome() {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <SafeAreaProvider
        initialMetrics={
          initialWindowMetrics ?? {
            insets: { top: 0, left: 0, right: 0, bottom: 0 },
            frame: { x: 0, y: 0, width: 390, height: 844 },
          }
        }
      >
        <HomeScreen />
      </SafeAreaProvider>,
    );
  });
  return renderer;
}

describe('HomeScreen', () => {
  it('never renders a currency symbol', () => {
    const renderer = renderHome();
    const text = JSON.stringify(renderer.toJSON());
    expect(text).not.toMatch(/[$£€]/);
  });

  it('still shows the trip and item stats, just without a spend figure', () => {
    const renderer = renderHome();
    const text = JSON.stringify(renderer.toJSON());
    expect(text).toMatch(/carts?/);
    expect(text).toMatch(/items/);
  });
});
