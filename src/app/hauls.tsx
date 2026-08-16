import { router } from 'expo-router';
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FloatingNav } from '../components/FloatingNav';
import { HaulCard } from '../components/HaulCard';
import { color, space } from '../design/tokens';
import { Caption, LargeTitle, Sub } from '../design/type';
import { OPEN_FOOD_FACTS_ATTRIBUTION } from '../engine/liveVision/barcodeLookup';
import { useScanline } from '../engine/store';

export default function HaulsScreen() {
  const insets = useSafeAreaInsets();
  const hauls = useScanline((s) => s.hauls);

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
          <LargeTitle>All carts</LargeTitle>
          <Sub>{hauls.length === 1 ? '1 trip' : `${hauls.length} trips`}</Sub>
        </View>
        <View style={styles.grid}>
          {hauls.map((haul) => (
            <HaulCard
              key={haul.id}
              haul={haul}
              onPress={() => router.push({ pathname: '/haul/[id]', params: { id: haul.id } })}
            />
          ))}
        </View>

        {/* Names, brands and sizes for a barcode-resolved item come from Open Food Facts and
            persist into every saved haul (see store.ts), so this grid needs its own ODbL
            attribution rather than relying on the scan screen's (see BagTray.tsx). */}
        {hauls.length > 0 ? (
          <Caption color={color.sub} style={styles.attribution}>
            {OPEN_FOOD_FACTS_ATTRIBUTION}
          </Caption>
        ) : null}
      </ScrollView>

      <FloatingNav current="hauls" />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  header: {
    paddingHorizontal: space.xl,
    marginBottom: space.l,
    gap: 2,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.m,
    paddingHorizontal: space.xl,
  },
  attribution: {
    textAlign: 'center',
    marginTop: space.l,
    marginHorizontal: space.xl,
  },
});
