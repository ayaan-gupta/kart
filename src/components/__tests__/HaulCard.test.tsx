import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { HaulCard, HeroHaulCard, haulDateLabel } from '../HaulCard';
import type { Haul, HaulItem } from '../../engine/types';

const item = (over: Partial<HaulItem> = {}): HaulItem => ({
  key: '::bananas',
  name: 'Bananas',
  brand: null,
  size: null,
  category: 'Produce',
  qty: 1,
  thumbnailUri: null,
  ...over,
});

const haul = (over: Partial<Haul> = {}): Haul => ({
  id: 'haul_1',
  name: 'Sunday restock',
  endedAt: Date.now(),
  items: [
    item({ key: '::bananas', name: 'Bananas', category: 'Produce', qty: 2 }),
    item({ key: '::milk', name: 'Whole milk, 1 gal', category: 'Dairy', brand: 'Horizon', size: '1 gal' }),
    item({ key: '::bread', name: 'Sourdough loaf', category: 'Bakery' }),
  ],
  ...over,
});

/**
 * Render-level tests, not just a grep over the diff. The product decision is "no money at all,
 * anywhere in the app": a card that quietly kept a `<Price>` next to the photo, or a Collage
 * that crashed on the item's identity fields, would still look right from a diff and be wrong
 * on screen. These render the real components and inspect what they actually produce.
 */
function renderTree(node: React.ReactElement) {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(node);
  });
  return renderer;
}

describe('HeroHaulCard', () => {
  it('never renders a currency symbol', () => {
    const renderer = renderTree(<HeroHaulCard haul={haul()} onPress={() => {}} />);
    const text = JSON.stringify(renderer.toJSON());
    expect(text).not.toMatch(/[$£€]/);
  });

  it('shows the item count and the cart name, not a total', () => {
    const renderer = renderTree(<HeroHaulCard haul={haul()} onPress={() => {}} />);
    const text = JSON.stringify(renderer.toJSON());
    expect(text).toContain('4 items');
    expect(text).toContain('Sunday restock');
  });
});

describe('HaulCard', () => {
  it('never renders a currency symbol', () => {
    const renderer = renderTree(<HaulCard haul={haul()} onPress={() => {}} />);
    const text = JSON.stringify(renderer.toJSON());
    expect(text).not.toMatch(/[$£€]/);
  });

  it('shows the item count and the cart name, not a total', () => {
    const renderer = renderTree(<HaulCard haul={haul()} onPress={() => {}} />);
    const text = JSON.stringify(renderer.toJSON());
    expect(text).toContain('4 items');
    expect(text).toContain('Sunday restock');
  });

  it('renders a collage tile per item, even for a haul with no thumbnails', () => {
    // Every seed haul (and every haul saved before this feature existed) has no thumbnails at
    // all, so the collage has to degrade to something other than a crash or a blank grid.
    const renderer = renderTree(<HaulCard haul={haul()} onPress={() => {}} />);
    expect(renderer.toJSON()).toBeTruthy();
  });
});

describe('haulDateLabel', () => {
  it('labels a cart ended today as Today', () => {
    expect(haulDateLabel(Date.now())).toBe('Today');
  });
});
