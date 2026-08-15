import React from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import {
  isCoverageComplete,
  SECTOR_COUNT,
  type CoverageState,
} from '../engine/liveVision/coverage';
import { captureGuide, color, feedTextShadow, motion, overlay, space } from '../design/tokens';
import { Sub } from '../design/type';

/**
 * Whether to show the guide at all.
 *
 * Two ways out, and both are needed. Coverage completing is the obvious one. Occlusion clearing
 * is the one that keeps this from becoming a chore: if the user moves the box that was covering
 * things, the cart is visible and there is no reason left to walk around it.
 */
export function guideVisible(input: { occluded: boolean; coverage: CoverageState }): boolean {
  if (!input.occluded) return false;
  return !isCoverageComplete(input.coverage);
}

const RADIUS = captureGuide.ringRadius;
const STROKE = captureGuide.ringStroke;
const SIZE = (RADIUS + STROKE) * 2;
const GAP_RADIANS = captureGuide.sectorGapRadians;

/** One arc per sector, drawn clockwise from twelve o'clock. */
function sectorPath(index: number): string {
  const sweep = (Math.PI * 2) / SECTOR_COUNT;
  const start = index * sweep - Math.PI / 2 + GAP_RADIANS / 2;
  const end = start + sweep - GAP_RADIANS;
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const x1 = cx + RADIUS * Math.cos(start);
  const y1 = cy + RADIUS * Math.sin(start);
  const x2 = cx + RADIUS * Math.cos(end);
  const y2 = cy + RADIUS * Math.sin(end);
  // largeArcFlag is always 0: a sector is 360/SECTOR_COUNT degrees, which is under 180 for any
  // SECTOR_COUNT above 2.
  return `M${x1} ${y1}A${RADIUS} ${RADIUS} 0 0 1 ${x2} ${y2}`;
}

export function CaptureGuide({ coverage, visible }: { coverage: CoverageState; visible: boolean }) {
  if (!visible) return null;
  return (
    <Animated.View
      entering={FadeIn.duration(motion.guideFadeInMs)}
      exiting={FadeOut.duration(motion.guideFadeOutMs)}
      style={styles.wrap}
      pointerEvents="none"
      accessibilityRole="progressbar"
      accessibilityLabel="Walk around your cart so nothing is hidden"
    >
      <Svg width={SIZE} height={SIZE}>
        <Circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} stroke={overlay.guideTrack} strokeWidth={STROKE} fill="none" />
        {coverage.sectors.map((done, index) => (
          <Path
            key={index}
            d={sectorPath(index)}
            stroke={done ? color.brand : overlay.guidePending}
            strokeWidth={STROKE}
            strokeLinecap="round"
            fill="none"
          />
        ))}
      </Svg>
      <Sub color={color.white} style={styles.caption}>
        Move around your cart
      </Sub>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', alignSelf: 'center', top: captureGuide.top, alignItems: 'center', gap: space.m },
  caption: {
    fontWeight: '600',
    ...feedTextShadow,
  },
});
