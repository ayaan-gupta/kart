import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import React, { useEffect } from 'react';
import { AccessibilityInfo, Platform, StyleSheet } from 'react-native';
import Animated, { FadeInDown, FadeOutUp } from 'react-native-reanimated';
import { color, feedTextShadow, motion, space } from '../design/tokens';
import { Sub } from '../design/type';

export type CoachKind = 'none' | 'closer' | 'occluded' | 'unavailable' | 'confirm';

/**
 * The exact wording asked for by the product owner. Do not reword these without asking; they
 * are the user-facing definition of two of this plan's three required features.
 *
 * `unavailable` is NOT product-owner copy. It was written here because the alternative was a
 * shopper scanning a full trolley, finding nothing, and being told nothing (KART.md, eighty-fifth).
 * It is deliberately plain and it needs their wording before it is final.
 *
 * It says nothing about the cause on purpose. Two different faults reach it -- the recognition
 * service not answering, and the native detector failing to load on the device -- and the advice
 * that fits one misdirects on the other. What a shopper needs from either is the same: the bag is
 * not being filled, so do not trust it being empty.
 */
export const COACH_COPY: Record<Exclude<CoachKind, 'none'>, string> = {
  closer: 'Please bring your camera closer to items highlighted yellow',
  occluded:
    "We're pretty sure you're missing stuff in your cart. Move items that are covering it and scan those items.",
  unavailable: "Scanning isn't working right now, so nothing is being added to your cart.",
  /**
   * The product owner's wording, from the request for the review on 2026-09-06: the items that
   * were high confidence highlighted green, the one that was not highlighted yellow, and this
   * sentence beside it.
   */
  confirm: 'Please give me a better image of this so I can confirm what it is.',
};

const SYMBOL: Record<Exclude<CoachKind, 'none'>, SymbolViewProps['name']> = {
  closer: 'viewfinder',
  occluded: 'square.3.layers.3d.top.filled',
  unavailable: 'exclamationmark.triangle.fill',
  confirm: 'camera.viewfinder',
};

/**
 * Picks the one notice to show.
 *
 * Only ever one. Two stacked instructions over a live camera feed is noise, and the occlusion
 * remedy (move the things on top and scan them) also resolves most amber items, so it goes
 * first when both apply.
 */
export function coachKind(
  input: { amberPersists: boolean; occluded: boolean; unavailable?: boolean; confirm?: boolean },
): CoachKind {
  // First, and above both others. If recognition is not answering, "bring your camera closer" and
  // "move the items covering it" are both instructions to work harder at something that cannot
  // succeed, which is worse than saying nothing. Neither of the other two can be true for a good
  // reason while every census is failing: they are derived from census answers.
  if (input.unavailable) return 'unavailable';
  // Above the occlusion notice, because it points at a particular item drawn in amber on the
  // photograph the shopper is looking at, and the remedy is the same one photograph either way.
  if (input.confirm) return 'confirm';
  if (input.occluded) return 'occluded';
  if (input.amberPersists) return 'closer';
  return 'none';
}

export function CoachNotice({ kind, topInset }: { kind: CoachKind; topInset: number }) {
  // `accessibilityRole`/`accessibilityLabel` only describe an element once a screen reader
  // user already reaches it; they do not make VoiceOver or TalkBack speak up on their own. This
  // notice exists to interrupt someone who is looking at their cart, not the screen, so the
  // announcement itself has to be requested explicitly. Keyed on `kind`, not on the copy string,
  // so it fires exactly once per state change, including closer-to-occluded, not on every
  // re-render while a state persists.
  useEffect(() => {
    if (kind === 'none') return;
    AccessibilityInfo.announceForAccessibility(COACH_COPY[kind]);
  }, [kind]);

  if (kind === 'none') return null;
  return (
    <Animated.View
      entering={FadeInDown.springify().duration(motion.spring.duration + 100).dampingRatio(1)}
      exiting={FadeOutUp.duration(220)}
      style={[styles.notice, { top: topInset + space.s + 58 }]}
      accessible
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
    ...feedTextShadow,
  },
});
