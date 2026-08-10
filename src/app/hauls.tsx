import { router } from 'expo-router';
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FloatingNav } from '../components/FloatingNav';
import { HaulCard } from '../components/HaulCard';
import { color, space } from '../design/tokens';
import { LargeTitle, Sub } from '../design/type';
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
});
