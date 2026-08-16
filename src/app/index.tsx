import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FloatingNav } from '../components/FloatingNav';
import { HaulCard, HeroHaulCard } from '../components/HaulCard';
import { KartLogo } from '../components/KartLogo';
import { PressableScale } from '../components/PressableScale';
import { cardEdge, color, radius, shadow, space } from '../design/tokens';
import { Caption, Headline, LargeTitle, Sub, Title } from '../design/type';
import { OPEN_FOOD_FACTS_ATTRIBUTION } from '../engine/liveVision/barcodeLookup';
import { haulCount, useScanline } from '../engine/store';

const MONTH = 30 * 24 * 60 * 60 * 1000;

function StatChip({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.statChip}>
      <Headline>{value}</Headline>
      <Caption>{label}</Caption>
    </View>
  );
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const hauls = useScanline((s) => s.hauls);

  // `Date.now()` is impure and may not be called during render (see the React Compiler's
  // purity rule): a component's output has to be a deterministic function of its props and
  // state, and "now" is neither. `useState`'s lazy-initializer form calls it exactly once, on
  // first mount, the same idiom React's own docs use for expensive or impure initial state, and
  // never again on a later re-render, so a haul crossing the month boundary waits for whatever
  // next re-render already comes from `hauls` changing rather than this reading a fresh "now".
  const [now] = useState(() => Date.now());

  const monthStats = useMemo(() => {
    const recent = hauls.filter((h) => now - h.endedAt < MONTH);
    const items = recent.reduce((sum, h) => sum + haulCount(h.items), 0);
    return { items, trips: recent.length };
  }, [hauls, now]);

  const [latest, ...rest] = hauls;

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + space.l,
          paddingBottom: insets.bottom + 130,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={styles.brandRow}>
            <KartLogo height={32} />
            <LargeTitle color={color.brand} style={styles.brandName}>
              Kart
            </LargeTitle>
          </View>
          <View style={styles.avatar}>
            <Headline color={color.white}>A</Headline>
          </View>
        </View>

        <View style={styles.stats}>
          <StatChip value={`${monthStats.trips}`} label={monthStats.trips === 1 ? 'cart' : 'carts'} />
          <StatChip value={`${monthStats.items}`} label="items" />
        </View>

        {latest ? (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Title>Latest cart</Title>
            </View>
            <HeroHaulCard
              haul={latest}
              onPress={() => router.push({ pathname: '/haul/[id]', params: { id: latest.id } })}
            />
          </View>
        ) : null}

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Title>Earlier</Title>
            <PressableScale onPress={() => router.replace('/hauls')} accessibilityLabel="See all carts">
              <Sub color={color.brand} style={styles.seeAll}>
                See all
              </Sub>
            </PressableScale>
          </View>
          <View style={styles.grid}>
            {rest.slice(0, 4).map((haul) => (
              <HaulCard
                key={haul.id}
                haul={haul}
                onPress={() => router.push({ pathname: '/haul/[id]', params: { id: haul.id } })}
              />
            ))}
          </View>
        </View>

        {/* Names, brands and sizes for a barcode-resolved item come from Open Food Facts and
            persist into every saved haul (see store.ts), so this screen needs its own ODbL
            attribution rather than relying on the scan screen's (see BagTray.tsx). */}
        {latest ? (
          <Caption color={color.sub} style={styles.attribution}>
            {OPEN_FOOD_FACTS_ATTRIBUTION}
          </Caption>
        ) : null}
      </ScrollView>

      <FloatingNav current="home" />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.xl,
    marginBottom: space.l,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  brandName: { fontSize: 26, lineHeight: 32, letterSpacing: -0.4 },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: color.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stats: {
    flexDirection: 'row',
    gap: space.m,
    paddingHorizontal: space.xl,
    marginBottom: space.xl,
  },
  statChip: {
    flex: 1,
    backgroundColor: color.surface,
    borderRadius: radius.row,
    paddingVertical: space.m,
    paddingHorizontal: space.l,
    gap: 1,
    ...shadow.raise,
    ...cardEdge,
  },
  section: {
    paddingHorizontal: space.xl,
    marginBottom: space.xl,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.m,
  },
  seeAll: { fontWeight: '600' },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.m,
  },
  attribution: {
    textAlign: 'center',
    marginTop: space.xl,
    paddingHorizontal: space.xl,
  },
});
