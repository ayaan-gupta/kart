import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import HaulDetailScreen from '../haul/[id]';
import { OPEN_FOOD_FACTS_ATTRIBUTION } from '../../engine/liveVision/barcodeLookup';
import { useScanline } from '../../engine/store';

jest.mock('expo-router', () => ({
  router: { canGoBack: () => false, back: () => {}, replace: () => {} },
  // Required lazily, inside the factory, since jest.mock() factories are hoisted above imports
  // and cannot close over an out-of-scope module-level binding.
  useLocalSearchParams: () => ({
    id: (require('../../engine/store') as typeof import('../../engine/store')).useScanline.getState().hauls[0]?.id,
  }),
}));

/**
 * I8 (branch review): ODbL attribution appeared only on BagTray, the scan screen, even though
 * Open Food Facts names, brands and sizes persist into every saved haul (see store.ts) and this
 * detail screen is exactly where an individual haul's items are displayed afterward.
 */
function renderDetail() {
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
        <HaulDetailScreen />
      </SafeAreaProvider>,
    );
  });
  return renderer;
}

describe('HaulDetailScreen', () => {
  it('carries the ODbL attribution for the haul\'s Open Food Facts-derived items', () => {
    expect(useScanline.getState().hauls.length).toBeGreaterThan(0);
    const renderer = renderDetail();
    const text = JSON.stringify(renderer.toJSON());
    expect(text).toContain(OPEN_FOOD_FACTS_ATTRIBUTION);
  });
});
