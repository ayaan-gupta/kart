import { router, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '../../components/Button';
import { haulDateLabel } from '../../components/HaulCard';
import { IconButton } from '../../components/IconButton';
import { ItemThumbnail, itemSubtitle } from '../../components/ItemThumbnail';
import { cardEdge, color, radius, shadow, space } from '../../design/tokens';
import { Body, Caption, Headline, LargeTitle, Sub } from '../../design/type';
import { OPEN_FOOD_FACTS_ATTRIBUTION } from '../../engine/liveVision/barcodeLookup';
import { haulCount, useScanline } from '../../engine/store';

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
          {haul.items.map((it, i) => (
            <View key={it.key}>
              {i > 0 ? <View style={styles.divider} /> : null}
              <View style={styles.line}>
                <ItemThumbnail uri={it.thumbnailUri} size={46} />
                <View style={styles.lineText}>
                  <Headline numberOfLines={2}>{it.name}</Headline>
                  <Sub>{itemSubtitle(it)}</Sub>
                </View>
                {it.qty > 1 ? <Headline>{`x${it.qty}`}</Headline> : null}
              </View>
            </View>
          ))}
        </View>

        {/* Names, brands and sizes for a barcode-resolved item come from Open Food Facts and
            persist here after the scan (see store.ts), so the ODbL attribution has to follow the
            data onto every screen that shows it, not just the scan screen it was first fetched
            on (see BagTray.tsx). */}
        <Caption color={color.sub} style={styles.attribution}>
          {OPEN_FOOD_FACTS_ATTRIBUTION}
        </Caption>
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
  attribution: {
    textAlign: 'center',
    marginTop: space.l,
    marginHorizontal: space.xl,
  },
});
