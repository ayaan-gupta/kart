import { Image } from 'expo-image';
import React, { useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Rect } from 'react-native-svg';
import { color, overlay, radius, space } from '../design/tokens';
import { Caption } from '../design/type';
import type { PhotoItem } from '../engine/liveVision/photoScan';

/**
 * The shopper's own photograph with every item outlined: green when the wide and the close
 * reading agreed, amber when they did not, a plain outline while the close reading is still
 * on its way.
 *
 * The photograph shown is the upload itself, not the file the camera wrote, and its size is the
 * upload's own. Every box the server returns is in that frame, so drawing them on that image is
 * what makes them land on the items rather than beside them, whatever the camera did with EXIF.
 *
 * Rectangles rather than the live path's silhouettes, because that is what the model gives:
 * there is no detector on this path and no mask to trace.
 */

/** Where a `contain`-fitted image of `image` size lands inside `container`, centred. */
export function fitContain(container: { w: number; h: number }, image: { w: number; h: number }): { x: number; y: number; w: number; h: number } {
  if (!(image.w > 0) || !(image.h > 0) || !(container.w > 0) || !(container.h > 0)) return { x: 0, y: 0, w: 0, h: 0 };
  const scale = Math.min(container.w / image.w, container.h / image.h);
  const w = image.w * scale;
  const h = image.h * scale;
  return { x: (container.w - w) / 2, y: (container.h - h) / 2, w, h };
}

interface PhotoReviewProps {
  uri: string;
  width: number;
  height: number;
  items: PhotoItem[];
}

function spokenStatus(item: PhotoItem): string {
  return item.status === 'sure' ? item.name : item.status === 'unsure' ? `${item.name}, not sure` : `${item.name}, checking`;
}

export function PhotoReview({ uri, width, height, items }: PhotoReviewProps) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const onLayout = (e: LayoutChangeEvent) => {
    const { width: w, height: h } = e.nativeEvent.layout;
    setSize({ w, h });
  };
  const fit = size ? fitContain(size, { w: width, h: height }) : null;
  const boxed = items.filter((item) => item.box !== null);

  return (
    <View style={StyleSheet.absoluteFill} onLayout={onLayout} testID="photo-review">
      <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="contain" />
      {fit && size ? (
        <>
          <Svg style={StyleSheet.absoluteFill} width={size.w} height={size.h} pointerEvents="none">
            {boxed.map((item) => {
              const box = item.box!;
              const stroke =
                item.status === 'sure' ? overlay.countedStroke : item.status === 'unsure' ? overlay.closerStroke : overlay.formingStroke;
              const fill = item.status === 'sure' ? overlay.countedFill : item.status === 'unsure' ? overlay.closerFill : 'none';
              return (
                <Rect
                  key={item.id}
                  x={fit.x + box.x * fit.w}
                  y={fit.y + box.y * fit.h}
                  width={box.w * fit.w}
                  height={box.h * fit.h}
                  rx={6}
                  fill={fill}
                  stroke={stroke}
                  strokeWidth={item.status === 'checking' ? 2 : 3}
                />
              );
            })}
          </Svg>
          {boxed.map((item) => {
            const box = item.box!;
            const chipBg = item.status === 'sure' ? overlay.countedStroke : item.status === 'unsure' ? overlay.closerStroke : 'rgba(0,0,0,0.55)';
            const chipText = item.status === 'checking' ? color.white : color.black;
            return (
              <View
                key={item.id}
                accessible
                accessibilityLabel={spokenStatus(item)}
                style={[
                  styles.chip,
                  {
                    left: fit.x + box.x * fit.w,
                    top: Math.max(fit.y, fit.y + box.y * fit.h - 22),
                    maxWidth: Math.max(80, box.w * fit.w),
                    backgroundColor: chipBg,
                  },
                ]}
                pointerEvents="none"
              >
                <Caption color={chipText} numberOfLines={1}>
                  {item.qty > 1 ? `${item.name} x${item.qty}` : item.name}
                </Caption>
              </View>
            );
          })}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    position: 'absolute',
    paddingHorizontal: space.s,
    paddingVertical: 2,
    borderRadius: radius.chip,
  },
});
