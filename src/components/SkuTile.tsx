import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { radius } from '../design/tokens';
import { Caption } from '../design/type';

/**
 * The item "picture": a softly tinted tile with a category symbol.
 * One hue per category so bags and haul collages read colorful but calm.
 */
const looks: Record<string, { symbol: SymbolViewProps['name']; bg: string; fg: string }> = {
  Produce: { symbol: 'leaf.fill', bg: '#E5F2E6', fg: '#3E7C4B' },
  Dairy: { symbol: 'drop.fill', bg: '#E7F0F8', fg: '#4C7FA6' },
  Bakery: { symbol: 'oven.fill', bg: '#F6ECDE', fg: '#A3703C' },
  Meat: { symbol: 'flame.fill', bg: '#F8E9E6', fg: '#B05548' },
  Pantry: { symbol: 'shippingbox.fill', bg: '#F4EFE0', fg: '#96793A' },
  Snacks: { symbol: 'takeoutbag.and.cup.and.straw.fill', bg: '#EFEAF7', fg: '#7A5FA6' },
  Beverages: { symbol: 'cup.and.saucer.fill', bg: '#E2F1F0', fg: '#1E7A74' },
  Household: { symbol: 'house.fill', bg: '#EBEDF1', fg: '#5C6675' },
  Pet: { symbol: 'pawprint.fill', bg: '#F2ECE4', fg: '#8A6B4F' },
};

const fallback = { symbol: 'barcode' as SymbolViewProps['name'], bg: '#EDEDEF', fg: '#5C6675' };

interface SkuTileProps {
  category: string;
  size?: number;
  radiusOverride?: number;
}

export function SkuTile({ category, size = 44, radiusOverride }: SkuTileProps) {
  const look = looks[category] ?? fallback;
  return (
    <View
      style={[
        styles.tile,
        {
          width: size,
          height: size,
          borderRadius: radiusOverride ?? Math.min(radius.tile, size * 0.32),
          backgroundColor: look.bg,
        },
      ]}
    >
      {Platform.OS === 'ios' ? (
        <SymbolView name={look.symbol} size={size * 0.44} tintColor={look.fg} weight="medium" />
      ) : (
        <Caption color={look.fg}>{category.slice(0, 1)}</Caption>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
