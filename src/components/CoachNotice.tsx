import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import React from 'react';
import { Platform, StyleSheet } from 'react-native';
import Animated, { FadeInDown, FadeOutUp } from 'react-native-reanimated';
import { color, motion, space } from '../design/tokens';
import { Sub } from '../design/type';

export type CoachKind = 'none' | 'closer' | 'occluded';

/**
 * The exact wording asked for by the product owner. Do not reword these without asking; they
 * are the user-facing definition of two of this plan's three required features.
 */
export const COACH_COPY: Record<Exclude<CoachKind, 'none'>, string> = {
  closer: 'Please bring your camera closer to items highlighted yellow',
  occluded:
    "We're pretty sure you're missing stuff in your cart. Move items that are covering it and scan those items.",
};

const SYMBOL: Record<Exclude<CoachKind, 'none'>, SymbolViewProps['name']> = {
  closer: 'viewfinder',
  occluded: 'square.3.layers.3d.top.filled',
};

/**
 * Picks the one notice to show.
 *
 * Only ever one. Two stacked instructions over a live camera feed is noise, and the occlusion
 * remedy (move the things on top and scan them) also resolves most amber items, so it goes
 * first when both apply.
 */
export function coachKind(input: { amberPersists: boolean; occluded: boolean }): CoachKind {
  if (input.occluded) return 'occluded';
  if (input.amberPersists) return 'closer';
  return 'none';
}

export function CoachNotice({ kind, topInset }: { kind: CoachKind; topInset: number }) {
  if (kind === 'none') return null;
  return (
    <Animated.View
      entering={FadeInDown.springify().duration(motion.spring.duration + 100).dampingRatio(1)}
      exiting={FadeOutUp.duration(220)}
      style={[styles.notice, { top: topInset + space.s + 58 }]}
      accessibilityRole="alert"
      accessibilityLabel={COACH_COPY[kind]}
    >
      {Platform.OS === 'ios' ? (
        <SymbolView name={SYMBOL[kind]} size={20} tintColor={color.white} fallback={undefined} />
      ) : null}
      <Sub color={color.white} style={styles.text}>
        {COACH_COPY[kind]}
      </Sub>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  notice: {
    position: 'absolute',
    left: space.xl,
    right: space.xl,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
  },
  text: {
    flex: 1,
    fontWeight: '600',
    // The feed behind this is arbitrary, so the text carries its own contrast rather than
    // sitting on a card that would cover the cart the user is being asked to look at.
    textShadowColor: 'rgba(0,0,0,0.55)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
});
