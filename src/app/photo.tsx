import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BagTray } from '../components/BagTray';
import { CoachNotice } from '../components/CoachNotice';
import { GlassSurface } from '../components/GlassSurface';
import { IconButton } from '../components/IconButton';
import { PhotoCameraCapture } from '../components/PhotoCameraCapture';
import { PressableScale } from '../components/PressableScale';
import { color, radius, space } from '../design/tokens';
import { Caption } from '../design/type';
import { createPhotoScanState, scanPhoto } from '../engine/liveVision/photoScan';
import { requestCensus } from '../engine/liveVision/recognitionClient';
import type { ClientFailure } from '../engine/liveVision/recognitionClient';
import { haulCount, useScanline } from '../engine/store';

/**
 * Photograph an item, and it goes in the cart.
 *
 * The shopper chooses the moment, so none of the live path's frame selection applies here: no
 * sharpness gate, no motion gate, no keyframe pacing, no session call ceiling, no tracker. Those
 * exist because a live camera produces thirty frames a second and something has to decide which
 * one is worth a recognition call. A photograph has already been decided.
 *
 * This screen owns no counting rules. It turns a shutter press into base64 and hands it to
 * `photoScan.ts`, which folds it through the same fusion the live path uses, so two photographs
 * of one orange stay one orange. See `src/engine/liveVision/photoScan.ts`.
 *
 * Nothing here imports the camera. `PhotoCameraCapture` does, and has a `.web.tsx` beside it, so
 * this file carries no platform branch and web never loads VisionCamera at all.
 *
 * `scan.tsx` is untouched by this file. Live scanning is still there, still wired, and is the
 * screen the "+" button opens.
 */
export default function PhotoScreen() {
  const insets = useSafeAreaInsets();

  // Held in a ref rather than state: it is not rendered, and replacing it must not schedule a
  // render of its own. This is what carries the bag across shutter presses.
  const session = useRef(createPhotoScanState());

  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ClientFailure | null>(null);
  const [added, setAdded] = useState<number | null>(null);

  const startScan = useScanline((s) => s.startScan);
  const setBag = useScanline((s) => s.setBag);
  const finishHaul = useScanline((s) => s.finishHaul);
  const discardScan = useScanline((s) => s.discardScan);
  const items = useScanline((s) => s.scan.items);
  const count = haulCount(items);

  useEffect(() => {
    startScan();
  }, [startScan]);

  const controlsBottom = 76 + insets.bottom + space.xl;

  /**
   * One photograph through recognition and into the bag.
   *
   * Thumbnails are deliberately not saved. A thumbnail is a crop of the item, and cropping needs
   * a box; nothing here produces one, because the device runs no detector and the server's
   * enumerator is unconfigured. Storing the whole photograph against every line it produced would
   * show the same picture on each row, which says less than no picture at all.
   */
  const ingest = async (imageBase64: string) => {
    setBusy(true);
    setFailure(null);
    try {
      const outcome = await scanPhoto(session.current, imageBase64, { requestCensus });
      if (outcome.ok) {
        session.current = outcome.state;
        setBag(outcome.lines, {});
        setAdded(outcome.added);
      } else {
        setFailure(outcome.failure);
      }
    } finally {
      setBusy(false);
    }
  };

  const pick = async () => {
    if (busy) return;
    let result: ImagePicker.ImagePickerResult;
    try {
      result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 1,
        base64: true,
      });
    } catch {
      // The picker is someone else's UI and can reject for reasons this screen cannot see or
      // fix: a permission revoked mid-flight, a file the system cannot read, or its own DOM
      // teardown on web. Without this the rejection escapes `pick`, nothing clears, and the
      // shopper is left looking at a screen that has silently stopped responding to the button.
      setFailure('server');
      return;
    }
    if (result.canceled) return;
    const base64 = result.assets?.[0]?.base64;
    if (!base64) {
      setFailure('malformed');
      return;
    }
    await ingest(base64);
  };

  const close = () => {
    const leave = () => {
      discardScan();
      router.back();
    };
    if (count > 0) {
      Alert.alert('Discard this cart?', 'Nothing will be saved.', [
        { text: 'Keep going', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: leave },
      ]);
    } else {
      leave();
    }
  };

  const finish = () => {
    const haulId = finishHaul();
    if (haulId) {
      router.replace({ pathname: '/haul/[id]', params: { id: haulId } });
    } else {
      router.back();
    }
  };

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />

      <PhotoCameraCapture
        busy={busy}
        bottom={controlsBottom}
        onCapture={(base64) => void ingest(base64)}
        // A capture that fails is the same to the shopper as one that could not be recognized:
        // nothing arrived. Reuse the one notice rather than inventing a second vocabulary.
        onError={() => setFailure('server')}
      />

      <View style={[styles.topBar, { top: insets.top + space.s }]}>
        <IconButton
          symbol="xmark"
          fallback="✕"
          accessibilityLabel="Close"
          onPress={close}
          scheme="dark"
        />
      </View>

      {/* The same notice the live path shows when recognition is not answering. Its wording says
          nothing about the cause on purpose, and that is unchanged here. */}
      <CoachNotice kind={failure === null ? 'none' : 'unavailable'} topInset={insets.top} />

      <View style={[styles.controls, { bottom: controlsBottom }]} pointerEvents="box-none">
        {busy ? (
          <GlassSurface radius={radius.pill}>
            <View style={styles.status}>
              <ActivityIndicator color={color.white} />
              <Caption color={color.white}>Looking at your photo…</Caption>
            </View>
          </GlassSurface>
        ) : added !== null ? (
          <GlassSurface radius={radius.pill}>
            <View style={styles.status}>
              <Caption color={color.white}>
                {added === 0
                  ? 'Nothing new in that one'
                  : added === 1
                    ? 'Added 1 item'
                    : `Added ${added} items`}
              </Caption>
            </View>
          </GlassSurface>
        ) : null}

        <View style={styles.buttonRow}>
          <PressableScale onPress={pick} accessibilityLabel="Choose a photo from your library">
            <View style={styles.secondary}>
              <Caption color={color.white}>Library</Caption>
            </View>
          </PressableScale>
        </View>
      </View>

      <BagTray onFinish={finish} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.feed },
  topBar: {
    position: 'absolute',
    left: space.l,
    right: space.l,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  controls: {
    position: 'absolute',
    left: space.l,
    right: space.l,
    alignItems: 'center',
    gap: space.m,
  },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s,
    paddingHorizontal: space.l,
    paddingVertical: space.s,
  },
  buttonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
  },
  secondary: {
    paddingHorizontal: space.l,
    paddingVertical: space.m,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0,0,0,0.45)',
    minWidth: 84,
    alignItems: 'center',
  },
});
