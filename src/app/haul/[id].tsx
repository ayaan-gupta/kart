import { router, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '../../components/Button';
import { haulDateLabel } from '../../components/HaulCard';
import { IconButton } from '../../components/IconButton';
import { ProductImage } from '../../components/ProductImage';
import { cardEdge, color, radius, shadow, space } from '../../design/tokens';
import { Body, Headline, LargeTitle, Price, Sub } from '../../design/type';
import { formatPrice, skuByCode } from '../../engine/catalog';
import { haulCount, haulTotal, useScanline } from '../../engine/store';

export default function HaulDetailScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const haul = useScanline((s) => s.hauls.find((h) => h.id === id));

  if (!haul) {
    return (
      <View style={[styles.screen, styles.missing]}>
        <Body color={color.sub}>This cart is gone.</Body>
        <Button label="Back home" variant="quiet" onPress={() => router.replace('/')} />
      </View>
    );
  }

  const count = haulCount(haul.items);
  const total = haulTotal(haul.items);
  const time = new Date(haul.endedAt).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + space.s,
          paddingBottom: insets.bottom + space.xxl,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topBar}>
          <IconButton
            symbol="chevron.left"
            fallback="←"
            accessibilityLabel="Back"
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          />
        </View>

        <View style={styles.header}>
          <LargeTitle>{haul.name}</LargeTitle>
          <Sub>
            {haulDateLabel(haul.endedAt)} at {time}  ·  {count === 1 ? '1 item' : `${count} items`}
          </Sub>
        </View>

        <View style={styles.card}>
          {haul.items.map((it, i) => {
            const sku = skuByCode.get(it.skuCode);
            if (!sku) return null;
            return (
              <View key={it.skuCode}>
                {i > 0 ? <View style={styles.divider} /> : null}
                <View style={styles.line}>
                  <ProductImage skuCode={sku.code} size={46} />
                  <View style={styles.lineText}>
                    <Headline numberOfLines={2}>{sku.name}</Headline>
                    <Sub>{it.qty > 1 ? `${formatPrice(sku.price)} x ${it.qty}` : sku.category}</Sub>
                  </View>
                  <Price>{formatPrice(sku.price * it.qty)}</Price>
                </View>
              </View>
            );
          })}
          <View style={styles.divider} />
          <View style={styles.totalLine}>
            <Body color={color.sub}>Total</Body>
            <Price style={styles.total}>{formatPrice(total)}</Price>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  missing: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.l,
    padding: space.xl,
  },
  topBar: {
    paddingHorizontal: space.l,
    marginBottom: space.m,
  },
  header: {
    paddingHorizontal: space.xl,
    gap: 3,
    marginBottom: space.l,
  },
  card: {
    marginHorizontal: space.l,
    backgroundColor: color.surface,
    borderRadius: radius.card,
    paddingHorizontal: space.l,
    paddingVertical: space.s,
    ...shadow.raise,
    ...cardEdge,
  },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    paddingVertical: space.m,
  },
  lineText: { flex: 1, gap: 1 },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: color.hairline,
    marginLeft: 44 + space.m,
  },
  totalLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: space.l,
  },
  total: { fontSize: 22, lineHeight: 27, fontWeight: '800' },
});
