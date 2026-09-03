import { File } from 'expo-file-system';
import React, { useEffect, useRef, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { Camera, useCameraDevice, useCameraPermission } from 'react-native-vision-camera';
import { color, shadow, space } from '../design/tokens';
import { Sub } from '../design/type';
import { Button } from './Button';
import { PressableScale } from './PressableScale';

/**
 * The camera half of the photograph screen, kept in its own module so that web never loads it.
 *
 * `react-native-vision-camera` throws `system/camera-module-not-found` when the module is
 * imported on web, not when the camera is rendered. A `Platform.OS` check inside the component
 * is therefore useless: the import at the top of the file has already run and taken the screen
 * down to a blank page, with the reason only in the browser console. Guarding the hooks instead
 * of the JSX does not help either, for the same reason.
 *
 * So the import lives here, and `PhotoCameraCapture.web.tsx` beside it is what Metro resolves on
 * web. Two files with one interface, which is the platform-extension mechanism working as
 * intended, and it keeps `photo.tsx` free of any platform branch at all.
 */
export interface PhotoCameraCaptureProps {
  busy: boolean;
  /** Distance from the bottom of the screen to the control row, so the shutter lines up with it. */
  bottom: number;
  onCapture: (base64: string) => void;
  onError: () => void;
}

export function PhotoCameraCapture({ busy, bottom, onCapture, onError }: PhotoCameraCaptureProps) {
  const { hasPermission, requestPermission } = useCameraPermission();
  const [permissionAsked, setPermissionAsked] = useState(false);
  const device = useCameraDevice('back');
  const camera = useRef<Camera>(null);

  useEffect(() => {
    if (hasPermission) return;
    let cancelled = false;
    void requestPermission().then(() => {
      if (!cancelled) setPermissionAsked(true);
    });
    return () => {
      cancelled = true;
    };
  }, [hasPermission, requestPermission]);

  const shoot = async () => {
    if (busy || camera.current == null) return;
    try {
      const photo = await camera.current.takePhoto({ enableShutterSound: false });
      // VisionCamera returns a bare filesystem path; expo-file-system wants a URI.
      const uri = photo.path.startsWith('file://') ? photo.path : `file://${photo.path}`;
      onCapture(await new File(uri).base64());
    } catch {
      onError();
    }
  };

  if (device == null || !hasPermission) {
    return (
      <View style={[StyleSheet.absoluteFill, styles.fallback]}>
        <Sub color={color.onFeedSub} style={styles.fallbackText}>
          {hasPermission === false && permissionAsked
            ? 'Kart needs camera access to photograph an item. Enable it in Settings, or choose a photo instead.'
            : hasPermission && device == null
              ? // Granted, and still no camera. On a phone this does not happen; in the Simulator
                // it always does, and saying "requesting access" there is the opposite of true.
                'No camera is available on this device. Choose a photo instead.'
              : 'Requesting camera access…'}
        </Sub>
        {hasPermission === false && permissionAsked ? (
          <Button label="Open Settings" onPress={() => Linking.openSettings()} />
        ) : null}
      </View>
    );
  }

  return (
    <>
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={!busy}
        photo={true}
        ref={camera}
      />
      <View style={[styles.shutterWrap, { bottom }]} pointerEvents="box-none">
        <PressableScale onPress={shoot} accessibilityLabel="Photograph this item">
          <View style={[styles.shutter, busy && styles.shutterBusy]}>
            <View style={styles.shutterInner} />
          </View>
        </PressableScale>
      </View>
    </>
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
  shutterWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  shutter: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: color.white,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.float,
  },
  shutterBusy: { opacity: 0.5 },
  shutterInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: color.white,
  },
});
