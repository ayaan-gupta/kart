import React from 'react';
import TestRenderer, { act, type ReactTestRendererJSON } from 'react-test-renderer';
import { ItemThumbnail, itemSubtitle } from '../ItemThumbnail';
import type { HaulItem } from '../../engine/types';

const item = (over: Partial<HaulItem> = {}): HaulItem => ({
  key: '::bananas', name: 'Bananas', brand: null, size: null,
  category: 'Produce', qty: 1, thumbnailUri: null, ...over,
});

type Json = ReactTestRendererJSON | ReactTestRendererJSON[] | string | null;

/** Whether any node anywhere in the rendered tree has the given host component type. */
function containsType(node: Json, type: string): boolean {
  if (node === null || typeof node === 'string') return false;
  if (Array.isArray(node)) return node.some((n) => containsType(n, type));
  if (node.type === type) return true;
  return (node.children ?? []).some((n) => containsType(n, type));
}

describe('itemSubtitle for an unsure item', () => {
  it('says so first, before anything else on the line', () => {
    expect(itemSubtitle(item({ unsure: true, brand: 'Priano', size: '500g' }))).toBe('Not sure · Priano · 500g');
  });

  it('says nothing extra for a sure one', () => {
    expect(itemSubtitle(item({ unsure: false, size: '1 gal' }))).toBe('1 gal');
  });
});

describe('itemSubtitle', () => {
  it('falls back to the category when there is nothing else to say', () => {
    expect(itemSubtitle(item())).toBe('Produce');
  });

  it('prefers the size over the category', () => {
    expect(itemSubtitle(item({ size: '1 gal' }))).toBe('1 gal');
  });

  it('leads with the brand when there is one', () => {
    expect(itemSubtitle(item({ brand: 'Horizon', size: '1 gal' }))).toBe('Horizon · 1 gal');
  });

  it('shows the count for a repeated item', () => {
    expect(itemSubtitle(item({ qty: 3, size: '1 gal' }))).toBe('1 gal · 3 in bag');
  });

  it('never contains a currency symbol', () => {
    // Prices are gone by decision, not by omission. This is the guard against one creeping back.
    expect(itemSubtitle(item({ brand: 'X', size: 'Y', qty: 2 }))).not.toMatch(/[$£€]/);
  });
});

/**
 * Render-level tests. `itemSubtitle` being correct says nothing about what a row actually
 * paints: a component that always showed the placeholder basket, or that quietly rendered
 * `<Price>` next to the photo, would still pass every test above unchanged. These render the
 * real component and inspect the tree it produces, the same way ItemHighlights' tests do.
 */
describe('ItemThumbnail rendering', () => {
  it('degrades to a placeholder, never a crash or a blank row, when the thumbnail is missing', () => {
    let tree: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<ItemThumbnail uri={null} size={46} />);
    });
    const json = tree!.toJSON();
    expect(json).not.toBeNull();
    // No photo to show, so no Image node, but a real placeholder box is still there.
    expect(containsType(json, 'Image')).toBe(false);
    expect(containsType(json, 'View')).toBe(true);
  });

  it('shows the actual photograph, not the placeholder, once a thumbnail exists', () => {
    let tree: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<ItemThumbnail uri="file:///thumb.jpg" size={46} />);
    });
    const json = tree!.toJSON() as ReactTestRendererJSON;
    expect(json.type).toBe('Image');
    expect(json.props.source).toEqual({ uri: 'file:///thumb.jpg' });
  });
});
