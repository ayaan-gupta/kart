import React from 'react';
import { SkuTile } from './SkuTile';

interface ProductImageProps {
  category: string;
  size?: number;
  radius?: number;
}

/**
 * An item's picture in a haul's photo collage: a category-tinted tile.
 *
 * Used to look up a real stock photo by SKU code first, falling back to the category tile only
 * when one was missing. Haul items are identified by an open vocabulary now (see `HaulItem` in
 * `engine/types.ts`) and carry no SKU code, so there is no longer a code to look a stock photo
 * up by; this renders the category tile directly, the same fallback `SkuTile` already provides
 * everywhere else a real photo is unavailable.
 */
export function ProductImage({ category, size = 48, radius }: ProductImageProps) {
  const r = radius ?? Math.round(size * 0.28);
  return <SkuTile category={category} size={size} radiusOverride={r} />;
}
