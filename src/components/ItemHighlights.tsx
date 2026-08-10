import { SymbolView } from 'expo-symbols';
import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { motion } from '../design/tokens';
import { Caption } from '../design/type';
import {
  RECOGNITION_TRACK,
  SCAN_VIDEO,
  type TrackEntry,
} from '../engine/recognitionTrack';
import type { Detection } from '../engine/types';

/**
 * Draws the recognition boxes over the video: a white outline locks onto the
 * item the moment the model recognizes it, then settles into a green tint
 * that stays for the session. Whatever is not tinted is still left to scan.
 */

const GREEN = '48, 209, 88'; // iOS systemGreen
const ADDED_DELAY_MS = 1100;

interface Frame {
  left: number;
  top: number;
  width: number;
  height: number;
}

function HighlightBox({ entry, frame }: { entry: TrackEntry; frame: Frame }) {
  const reducedMotion = useReducedMotion();
  // 0 = locked on (white outline), 1 = counted (green tint).
  const added = useSharedValue(reducedMotion ? 1 : 0);
  const entrance = useSharedValue(reducedMotion ? 1 : 0);

  useEffect(() => {
    if (reducedMotion) return;
    entrance.value = withSpring(1, { duration: motion.spring.duration + 120, dampingRatio: 1 });
    added.value = withDelay(
      ADDED_DELAY_MS,
      withTiming(1, { duration: 420, easing: Easing.inOut(Easing.quad) }),
    );
  }, [reducedMotion, entrance, added]);

  const boxStyle = useAnimatedStyle(() => ({
    opacity: entrance.value,
    transform: [{ scale: 1.1 - entrance.value * 0.1 }],
    borderColor: interpolateColor(
      added.value,
      [0, 1],
      ['rgba(255,255,255,0.95)', `rgba(${GREEN}, 0.85)`],
    ),
    backgroundColor: interpolateColor(
      added.value,
      [0, 1],
      ['rgba(255,255,255,0)', `rgba(${GREEN}, 0.2)`],
    ),
  }));

  const badgeStyle = useAnimatedStyle(() => ({
    opacity: added.value,
    transform: [{ scale: 0.4 + added.value * 0.6 }],
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
  timeSv: SharedValue<number>;
  detections: Detection[];
}

export function ItemHighlights({ timeSv, detections }: ItemHighlightsProps) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ w: width, h: height });
  };

  // The video renders with contentFit cover; map frame coords to view coords.
  const scale = size ? Math.max(size.w / SCAN_VIDEO.width, size.h / SCAN_VIDEO.height) : 1;
  const dispW = SCAN_VIDEO.width * scale;
  const dispH = SCAN_VIDEO.height * scale;
  const offX = size ? (size.w - dispW) / 2 : 0;
  const offY = size ? (size.h - dispH) / 2 : 0;

  // The camera drifts slowly; the whole layer follows so boxes stay glued on.
  const driftStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX:
          (timeSv.value - SCAN_VIDEO.boxesAtSec) * SCAN_VIDEO.driftXPerSec * dispW,
      },
    ],
  }));

  const detected = new Set(detections.map((d) => d.skuCode));

  return (
    <View style={StyleSheet.absoluteFill} onLayout={onLayout} pointerEvents="none">
      {size ? (
        <Animated.View style={[StyleSheet.absoluteFill, driftStyle]}>
          {RECOGNITION_TRACK.filter((entry) => detected.has(entry.skuCode)).map((entry) => (
            <HighlightBox
              key={entry.skuCode}
              entry={entry}
              frame={{
                left: offX + entry.box.x * dispW,
                top: offY + entry.box.y * dispH,
                width: entry.box.w * dispW,
                height: entry.box.h * dispH,
              }}
            />
          ))}
        </Animated.View>
      ) : null}
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
