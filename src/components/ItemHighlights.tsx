import React, { useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import { overlay } from '../design/tokens';
import { polygonCentroid, polygonToSvgPath } from '../engine/liveVision/geometry';
import { GREEN_CONFIDENCE } from '../engine/liveVision/config';
import type { Identity, Track } from '../engine/liveVision/types';

/**
 * Draws the state of every tracked item over the live camera feed.
 *
 * The tint follows the item's silhouette, not a bounding rectangle, which is the whole reason
 * the detector produces masks. A green rectangle over a bunch of bananas reads as "this area is
 * done"; a green banana-shaped tint reads as "this item is done".
 *
 * No animation library. Outlines update at the detector's rate and the Kalman filter already
 * provides the smoothness; animating SVG path fills on top of that adds a moving part and a
 * frame budget for nothing.
 */

const COUNTED_STROKE = overlay.countedStroke;
const COUNTED_FILL = overlay.countedFill;
const CLOSER_STROKE = overlay.closerStroke;
const CLOSER_FILL = overlay.closerFill;
const FORMING_STROKE = overlay.formingStroke;

export type OutlineState = 'counted' | 'closer' | 'forming';

/**
 * Which of the three states an item is in.
 *
 * Exported and pure so the rule is testable without rendering. The ordering matters:
 * `needsCloserLook` beats a high confidence number, because a model that says "I am 99% sure
 * but you should look closer" is telling us something its confidence field cannot.
 *
 * `Number.isFinite` guards against a garbage confidence (NaN, +/-Infinity): `NaN < GREEN_CONFIDENCE`
 * is `false`, so without this check a corrupt confidence value would fail open into `'counted'`,
 * the most trusted state, and tell the user an item is confirmed when it is not.
 */
export function outlineStateFor(track: Track, identity: Identity | undefined): OutlineState {
  if (track.state === 'tentative' || !identity) return 'forming';
  if (
    identity.needsCloserLook ||
    !Number.isFinite(identity.confidence) ||
    identity.confidence < GREEN_CONFIDENCE
  ) {
    return 'closer';
  }
  return 'counted';
}

interface ItemHighlightsProps {
  tracks: Track[];
  identities: Record<string, Identity>;
  frameSize: { width: number; height: number } | null;
}

export function ItemHighlights({ tracks, identities, frameSize }: ItemHighlightsProps) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ w: width, h: height });
  };

  // The camera renders with contentFit cover, so the frame is scaled up until it fills the view
  // and the overflow is split evenly off both edges. Outlines have to follow the same mapping
  // or they sit next to their items instead of on them.
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

            const state = outlineStateFor(track, identities[track.id]);
            const stroke =
              state === 'counted' ? COUNTED_STROKE : state === 'closer' ? CLOSER_STROKE : FORMING_STROKE;
            const fill =
              state === 'counted' ? COUNTED_FILL : state === 'closer' ? CLOSER_FILL : 'none';

            const centroid = polygonCentroid(track.polygon);
            const cx = offsetX + centroid.x * displayW;
            const cy = offsetY + centroid.y * displayH;

            return (
              <React.Fragment key={track.id}>
                <Path d={d} fill={fill} stroke={stroke} strokeWidth={2} strokeLinejoin="round" />
                {state === 'counted' ? (
                  <>
                    <Circle cx={cx} cy={cy} r={11} fill={COUNTED_STROKE} />
                    {/* A check drawn as a path rather than an SF Symbol: expo-symbols renders
                        native views, which cannot be children of an Svg. */}
                    <Path
                      d={`M${cx - 5} ${cy}L${cx - 1.5} ${cy + 3.5}L${cx + 5} ${cy - 3.5}`}
                      stroke="#FFFFFF"
                      strokeWidth={2.2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      fill="none"
                    />
                  </>
                ) : null}
              </React.Fragment>
            );
          })}
        </Svg>
      ) : null}
    </View>
  );
}
