import React from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { color, hit, radius, space, type } from '../design/tokens';
import { Headline } from '../design/type';
import { PressableScale } from './PressableScale';

type Variant = 'primary' | 'teal' | 'quiet' | 'onFeed';

const fills: Record<Variant, { bg: string; text: string }> = {
  primary: { bg: color.cta, text: color.white },
  teal: { bg: color.teal, text: color.white },
  quiet: { bg: color.pill, text: color.ink },
  onFeed: { bg: color.feedRaise, text: color.onFeed },
};

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: Variant;
  grow?: boolean;
  style?: ViewStyle;
  accessibilityLabel?: string;
}

export function Button({ label, onPress, variant = 'quiet', grow, style, accessibilityLabel }: ButtonProps) {
  const fill = fills[variant];
  return (
    <PressableScale
      onPress={onPress}
      accessibilityLabel={accessibilityLabel ?? label}
      containerStyle={grow ? { flex: 1 } : undefined}
      style={style}
    >
      <View style={[styles.base, { backgroundColor: fill.bg }]}>
        <Headline color={fill.text}>{label}</Headline>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: hit.min + 8,
    borderRadius: radius.row,
    paddingHorizontal: space.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
