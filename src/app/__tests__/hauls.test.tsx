import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import HaulsScreen from '../hauls';
import { OPEN_FOOD_FACTS_ATTRIBUTION } from '../../engine/liveVision/barcodeLookup';

/**
 * I8 (branch review): ODbL attribution appeared only on BagTray, the scan screen, even though
 * Open Food Facts names, brands and sizes persist into every saved haul (see store.ts) and this
 * grid is exactly where they are displayed afterward.
 */
function renderHauls() {
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
        <HaulsScreen />
      </SafeAreaProvider>,
    );
  });
  return renderer;
}

describe('HaulsScreen', () => {
  it('carries the ODbL attribution for the Open Food Facts data shown in every card', () => {
    const renderer = renderHauls();
    const text = JSON.stringify(renderer.toJSON());
    expect(text).toContain(OPEN_FOOD_FACTS_ATTRIBUTION);
  });
});
