import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { color, hit } from '../design/tokens';
import { Headline } from '../design/type';
import { PressableScale } from './PressableScale';

interface IconButtonProps {
  symbol: SymbolViewProps['name'];
  fallback: string;
  /** action-based label, "Close the scan", not "x icon" */
  accessibilityLabel: string;
  onPress: () => void;
  scheme?: 'light' | 'dark';
}

export function IconButton({ symbol, fallback, accessibilityLabel, onPress, scheme = 'light' }: IconButtonProps) {
  const dark = scheme === 'dark';
  return (
    <PressableScale onPress={onPress} accessibilityLabel={accessibilityLabel}>
      <View style={[styles.circle, { backgroundColor: dark ? color.feedRaise : color.pill }]}>
        {Platform.OS === 'ios' ? (
          <SymbolView name={symbol} size={16} tintColor={dark ? color.onFeed : color.ink} weight="semibold" />
        ) : (
          <Headline color={dark ? color.onFeed : color.ink}>{fallback}</Headline>
        )}
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  circle: {
    width: hit.min - 2,
    height: hit.min - 2,
    borderRadius: (hit.min - 2) / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
