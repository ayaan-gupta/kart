import { router } from 'expo-router';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color, radius, shadow, space } from '../design/tokens';
import { Caption } from '../design/type';
import { GlassSurface } from './GlassSurface';
import { PressableScale } from './PressableScale';

/**
 * Floating pill nav with a separate circular scan button, the pattern from
 * the reference apps: chrome floats above content, content scrolls beneath.
 */

type Tab = 'home' | 'hauls';

const tabs: Array<{ key: Tab; label: string; symbol: SymbolViewProps['name']; active: SymbolViewProps['name']; href: '/' | '/hauls' }> = [
  { key: 'home', label: 'Home', symbol: 'house', active: 'house.fill', href: '/' },
  { key: 'hauls', label: 'Carts', symbol: 'cart', active: 'cart.fill', href: '/hauls' },
];

export function FloatingNav({ current }: { current: Tab }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.wrap, { bottom: insets.bottom + space.s }]} pointerEvents="box-none">
      <GlassSurface radius={radius.pill}>
        <View style={styles.pill}>
          {tabs.map((tab) => {
            const active = tab.key === current;
            return (
              <PressableScale
                key={tab.key}
                onPress={() => {
                  if (!active) router.replace(tab.href);
                }}
                accessibilityLabel={tab.label}
                accessibilityState={{ selected: active }}
              >
                <View style={styles.tab}>
                  {Platform.OS === 'ios' ? (
                    <SymbolView
                      name={active ? tab.active : tab.symbol}
                      size={22}
                      tintColor={active ? color.ink : color.sub}
                    />
                  ) : null}
                  <Caption color={active ? color.ink : color.sub}>{tab.label}</Caption>
                </View>
              </PressableScale>
            );
          })}
        </View>
      </GlassSurface>

      <PressableScale
        onPress={() => router.push('/scan')}
        accessibilityLabel="Start a new scan"
      >
        <View style={styles.scanButton}>
          {Platform.OS === 'ios' ? (
            <SymbolView name="plus" size={24} tintColor={color.white} weight="semibold" />
          ) : (
            <Caption color={color.white}>+</Caption>
          )}
        </View>
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: space.l,
    right: space.l,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.m,
    paddingVertical: 6,
    gap: space.s,
  },
  tab: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    minWidth: 64,
    paddingHorizontal: space.s,
    paddingVertical: 4,
  },
  scanButton: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: color.brand,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.float,
  },
});
