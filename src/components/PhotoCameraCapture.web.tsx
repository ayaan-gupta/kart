import React from 'react';
import { StyleSheet, View } from 'react-native';
import { color, space } from '../design/tokens';
import { Sub } from '../design/type';
import type { PhotoCameraCaptureProps } from './PhotoCameraCapture';

/**
 * What the photograph screen shows on web, where there is no VisionCamera.
 *
 * Metro resolves this file instead of `PhotoCameraCapture.tsx` when the platform is web, which is
 * the whole point: importing `react-native-vision-camera` on web throws at import time, so the
 * native file must never be reached rather than merely never rendered.
 *
 * The screen stays useful because the library picker works here, and that is what makes the whole
 * photograph path testable in a browser with no device and no Xcode.
 */
export function PhotoCameraCapture(_props: PhotoCameraCaptureProps) {
  return (
    <View style={[StyleSheet.absoluteFill, styles.fallback]}>
      <Sub color={color.onFeedSub} style={styles.fallbackText}>
        No camera here. Choose a photo instead.
      </Sub>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.l,
    paddingHorizontal: space.xl,
  },
  fallbackText: { textAlign: 'center' },
});
