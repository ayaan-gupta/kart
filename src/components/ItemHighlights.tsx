import { SymbolView } from 'expo-symbols';
import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { motion } from '../design/tokens';
import { Caption } from '../design/type';
import type { CandidateState, TrackedCandidate } from '../engine/liveVision/types';

/**
 * Draws the recognition boxes over the live camera feed: a white outline
 * locks onto whatever the model is currently reading, amber if it's a
 * tentative, not-yet-confident read, then settles into a green tint once
 * it's confidently counted. Whatever is not tinted is still left to scan.
 */

const GREEN = '48, 209, 88'; // iOS systemGreen
const AMBER = '199, 125, 34'; // matches design/tokens.ts color.amber, gentle hint tint

const PHASE_BY_STATE: Record<CandidateState, number> = { forming: 0, tentative: 1, locked: 2 };

interface Frame {
  left: number;
  top: number;
  width: number;
  height: number;
}

function HighlightBox({ state, frame }: { state: CandidateState; frame: Frame }) {
  const reducedMotion = useReducedMotion();
  const entrance = useSharedValue(reducedMotion ? 1 : 0);
  const phase = useSharedValue(PHASE_BY_STATE[state]);

  useEffect(() => {
    if (reducedMotion) return;
    entrance.value = withSpring(1, { duration: motion.spring.duration + 120, dampingRatio: 1 });
  }, [reducedMotion, entrance]);

  useEffect(() => {
    phase.value = reducedMotion ? PHASE_BY_STATE[state] : withTiming(PHASE_BY_STATE[state], { duration: 320 });
  }, [state, reducedMotion, phase]);

  const boxStyle = useAnimatedStyle(() => ({
    opacity: entrance.value,
    transform: [{ scale: 1.1 - entrance.value * 0.1 }],
    borderColor: interpolateColor(
      phase.value,
      [0, 1, 2],
      ['rgba(255,255,255,0.95)', `rgba(${AMBER}, 0.9)`, `rgba(${GREEN}, 0.85)`],
    ),
    backgroundColor: interpolateColor(
      phase.value,
      [0, 1, 2],
      ['rgba(255,255,255,0)', `rgba(${AMBER}, 0.18)`, `rgba(${GREEN}, 0.2)`],
    ),
  }));

  const badgeStyle = useAnimatedStyle(() => ({
    opacity: phase.value >= 2 ? 1 : 0,
    transform: [{ scale: 0.4 + Math.min(phase.value, 1) * 0.6 }],
  }));

  return (
    <View style={[styles.slot, frame]} pointerEvents="none">
      <Animated.View style={[styles.box, boxStyle]} />
      <Animated.View style={[styles.badge, badgeStyle]}>
        {Platform.OS === 'ios' ? (
          <SymbolView name="checkmark" size={13} tintColor="#FFFFFF" weight="bold" />
        ) : (
          <Caption color="#FFFFFF" style={styles.badgeMark}>
            ✓
          </Caption>
        )}
      </Animated.View>
    </View>
  );
}

interface ItemHighlightsProps {
  candidates: TrackedCandidate[];
  frameSize: { width: number; height: number } | null;
}

export function ItemHighlights({ candidates, frameSize }: ItemHighlightsProps) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ w: width, h: height });
  };

  // The camera renders with contentFit cover; map frame coords to view coords.
  const scale = size && frameSize ? Math.max(size.w / frameSize.width, size.h / frameSize.height) : 1;
  const dispW = frameSize ? frameSize.width * scale : 0;
  const dispH = frameSize ? frameSize.height * scale : 0;
  const offX = size ? (size.w - dispW) / 2 : 0;
  const offY = size ? (size.h - dispH) / 2 : 0;

  return (
    <View style={StyleSheet.absoluteFill} onLayout={onLayout} pointerEvents="none">
      {size && frameSize
        ? candidates.map((candidate) => (
            <HighlightBox
              key={candidate.id}
              state={candidate.state}
              frame={{
                left: offX + candidate.box.x * dispW,
                top: offY + candidate.box.y * dispH,
                width: candidate.box.w * dispW,
                height: candidate.box.h * dispH,
              }}
            />
          ))
        : null}
    </View>
  );
}

const styles = StyleSheet.create({
  slot: { position: 'absolute' },
  box: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderWidth: 2,
    borderRadius: 18,
    borderCurve: 'continuous',
  },
  badge: {
    position: 'absolute',
    top: -9,
    right: -9,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: `rgb(${GREEN})`,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeMark: { fontWeight: '700' },
});
