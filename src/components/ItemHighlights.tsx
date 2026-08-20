import React, { useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import { overlay } from '../design/tokens';
import { polygonCentroid, polygonToSvgPath } from '../engine/liveVision/geometry';
import { hiddenFractions } from '../engine/liveVision/occlusion';
import { outlineStateFor, type OutlineState } from '../engine/liveVision/outlineState';
import type { Identity, Track } from '../engine/liveVision/types';

// Re-exported so every existing importer, and the component's own tests, keep working now that
// the rule itself lives in the engine where the offline harness can reach it too.
export { outlineStateFor };
export type { OutlineState };

const COUNTED_STROKE = overlay.countedStroke;
const COUNTED_FILL = overlay.countedFill;
const CLOSER_STROKE = overlay.closerStroke;
const CLOSER_FILL = overlay.closerFill;
const FORMING_STROKE = overlay.formingStroke;
const COVERED_STROKE = overlay.coveredStroke;
const COVERED_FILL = overlay.coveredFill;
const COVERED_DASH = overlay.coveredDash;

interface ItemHighlightsProps {
  tracks: Track[];
  identities: Record<string, Identity>;
  frameSize: { width: number; height: number } | null;
}

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
 *
 * Four states, and only two of them are colours. Green is counted and amber is unsure, which is
 * a confidence axis. Covered is not a point on that axis at all: it says the camera cannot see
 * the item, so it is drawn as a dashed edge over a dark scrim instead of a third hue competing
 * with the two that mean something. Forming stays a thin plain outline, the absence of a claim.
 */

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

  // Lost tracks are filtered before the coverage pass, not inside the map, for two reasons: an
  // item that is no longer detected cannot be established as the thing hiding another, and the
  // coverage results are positional, so a `return null` partway through the render would leave
  // every later track reading its neighbour's number.
  const visible = tracks.filter((track) => track.state !== 'lost');
  const hidden = hiddenFractions(visible.map((track) => track.box));

  return (
    <View style={StyleSheet.absoluteFill} onLayout={onLayout} pointerEvents="none">
      {ready ? (
        <Svg style={StyleSheet.absoluteFill} width={size.w} height={size.h}>
          {visible.map((track, index) => {
            const d = polygonToSvgPath(track.polygon, displayW, displayH, offsetX, offsetY);
            if (d === '') return null;

            const state = outlineStateFor(track, identities[track.id], hidden[index]);
            const stroke =
              state === 'counted'
                ? COUNTED_STROKE
                : state === 'closer'
                  ? CLOSER_STROKE
                  : state === 'covered'
                    ? COVERED_STROKE
                    : FORMING_STROKE;
            const fill =
              state === 'counted'
                ? COUNTED_FILL
                : state === 'closer'
                  ? CLOSER_FILL
                  : state === 'covered'
                    ? COVERED_FILL
                    : 'none';

            const centroid = polygonCentroid(track.polygon);
            const cx = offsetX + centroid.x * displayW;
            const cy = offsetY + centroid.y * displayH;

            return (
              <React.Fragment key={track.id}>
                <Path
                  d={d}
                  fill={fill}
                  stroke={stroke}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeDasharray={state === 'covered' ? COVERED_DASH : undefined}
                />
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
