import { SymbolView } from 'expo-symbols';
import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { color } from '../design/tokens';
import { Sub } from '../design/type';
import { formatPrice, skuByCode } from '../engine/catalog';
import type { Detection } from '../engine/types';
import { ProductImage } from './ProductImage';

/**
 * A recognized item, cardless: the photo floats over the footage with the
 * name beside it and a brand check stamped on the photo's corner. Text gets
 * a soft shadow; the feed's bottom scrim does the rest.
 */
export function DetectionRow({ detection, repeatIndex }: { detection: Detection; repeatIndex: number }) {
  const sku = skuByCode.get(detection.skuCode);
  if (!sku) return null;
  return (
    <View style={styles.row}>
      <View>
        <ProductImage skuCode={sku.code} size={56} />
        <View style={styles.check}>
          {Platform.OS === 'ios' ? (
            <SymbolView name="checkmark" size={11} tintColor={color.white} weight="heavy" />
          ) : null}
        </View>
      </View>
      <View style={styles.text}>
        <Sub color={color.white} style={styles.name} numberOfLines={1}>
          {sku.name}
        </Sub>
        <Sub color="rgba(255,255,255,0.78)" style={styles.meta}>
          Added · {formatPrice(sku.price)}
          {detection.confidence != null
            ? ` · ${Math.round(detection.confidence * 100)}% match`
            : repeatIndex > 1
              ? ` · ${repeatIndex} in bag`
              : ''}
        </Sub>
      </View>
    </View>
  );
}

const shadow = {
  textShadowColor: 'rgba(0,0,0,0.55)',
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 6,
} as const;

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  check: {
    position: 'absolute',
    right: -5,
    bottom: -5,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: color.brand,
    borderWidth: 2,
    borderColor: color.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, gap: 1 },
  name: { fontSize: 17, lineHeight: 22, fontWeight: '700', ...shadow },
  meta: { fontSize: 14, lineHeight: 18, fontWeight: '500', ...shadow },
});
