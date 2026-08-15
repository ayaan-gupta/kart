import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { color, radius } from '../design/tokens';
import type { HaulItem } from '../engine/types';

/**
 * A photograph of the item, cut from the frame that identified it.
 *
 * The placeholder is only ever seen in two cases: a migrated haul saved before this feature
 * existed, or a device that could not write to disk. Everything scanned from now on has a
 * picture of the real thing.
 */
export function ItemThumbnail({ uri, size }: { uri: string | null; size: number }) {
  if (uri === null) {
    return (
      <View style={[styles.placeholder, { width: size, height: size, borderRadius: radius.card }]}>
        {Platform.OS === 'ios' ? <SymbolView name="basket" size={size * 0.42} tintColor={color.sub} /> : null}
      </View>
    );
  }
  return (
    <Image
      source={{ uri }}
      style={{ width: size, height: size, borderRadius: radius.card }}
      contentFit="cover"
      // These are local files that never change once written, so there is nothing to revalidate.
      cachePolicy="memory-disk"
      transition={120}
    />
  );
}

/**
 * The line under an item's name.
 *
 * Deliberately never a price. Under an open vocabulary there is no authoritative price, and a
 * confident wrong total is worse than no total.
 */
export function itemSubtitle(item: HaulItem): string {
  const parts: string[] = [];
  if (item.brand) parts.push(item.brand);
  parts.push(item.size ?? item.category);
  if (item.qty > 1) parts.push(`${item.qty} in bag`);
  return parts.join(' · ');
}

const styles = StyleSheet.create({
  placeholder: { backgroundColor: color.hairline, alignItems: 'center', justifyContent: 'center' },
});
