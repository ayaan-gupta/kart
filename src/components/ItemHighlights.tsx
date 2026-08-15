import React, { useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { polygonToSvgPath } from '../engine/liveVision/geometry';
import type { Track } from '../engine/liveVision/types';

/**
 * Draws the detector's outline around each tracked item over the live camera feed.
 *
 * Plan 2 has no identities yet, so every confirmed item gets the same neutral treatment and a
 * track that is still forming is drawn fainter. The green counted state, the check mark and the
 * amber "come closer" state arrive in Plan 3, once an outline can actually mean something.
 *
 * No animation library here on purpose. Outlines update at the detector's rate, and animating
 * SVG path fills adds a moving part for smoothness the Kalman filter already provides.
 */

const OUTLINE = 'rgba(255, 255, 255, 0.95)';
const TINT = 'rgba(255, 255, 255, 0.14)';
const FORMING_OUTLINE = 'rgba(255, 255, 255, 0.45)';

interface ItemHighlightsProps {
  tracks: Track[];
  frameSize: { width: number; height: number } | null;
}

export function ItemHighlights({ tracks, frameSize }: ItemHighlightsProps) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ w: width, h: height });
  };

  // The camera renders with contentFit cover, so the frame is scaled up until it fills the
  // view and the overflow is split evenly off both edges. Outlines have to follow the same
  // mapping or they sit next to their items instead of on them.
  const ready = size !== null && frameSize !== null && frameSize.width > 0 && frameSize.height > 0;
  const scale = ready ? Math.max(size.w / frameSize.width, size.h / frameSize.height) : 1;
  const displayW = ready ? frameSize.width * scale : 0;
  const displayH = ready ? frameSize.height * scale : 0;
  const offsetX = ready ? (size.w - displayW) / 2 : 0;
  const offsetY = ready ? (size.h - displayH) / 2 : 0;

  return (
    <View style={StyleSheet.absoluteFill} onLayout={onLayout} pointerEvents="none">
      {ready ? (
        <Svg style={StyleSheet.absoluteFill} width={size.w} height={size.h}>
          {tracks.map((track) => {
            if (track.state === 'lost') return null;
            const d = polygonToSvgPath(track.polygon, displayW, displayH, offsetX, offsetY);
            if (d === '') return null;
            const forming = track.state === 'tentative';
            return (
              <Path
                key={track.id}
                d={d}
                fill={forming ? 'none' : TINT}
                stroke={forming ? FORMING_OUTLINE : OUTLINE}
                strokeWidth={2}
                strokeLinejoin="round"
              />
            );
          })}
        </Svg>
      ) : null}
    </View>
  );
}
