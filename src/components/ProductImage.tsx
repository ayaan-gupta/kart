import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { color } from '../design/tokens';
import { skuByCode } from '../engine/catalog';
import { productImages } from '../engine/productImages';
import { SkuTile } from './SkuTile';

interface ProductImageProps {
  skuCode: string;
  size?: number;
  radius?: number;
}

/**
 * Real product photo on a clean white tile, the grocery-app convention.
 * Falls back to the category tile only if a photo is missing.
 */
export function ProductImage({ skuCode, size = 48, radius }: ProductImageProps) {
  const source = productImages[skuCode];
  const r = radius ?? Math.round(size * 0.28);
  if (!source) {
    const category = skuByCode.get(skuCode)?.category ?? 'Pantry';
    return <SkuTile category={category} size={size} radiusOverride={r} />;
  }
  return (
    <View style={[styles.tile, { width: size, height: size, borderRadius: r }]}>
      <Image
        source={source}
        style={{ width: size * 0.84, height: size * 0.84 }}
        resizeMode="contain"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    backgroundColor: color.white,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.hairline,
  },
});
