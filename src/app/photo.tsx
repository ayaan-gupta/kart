import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BagTray } from '../components/BagTray';
import { CoachNotice, coachKind } from '../components/CoachNotice';
import { GlassSurface } from '../components/GlassSurface';
import { IconButton } from '../components/IconButton';
import { PhotoCameraCapture } from '../components/PhotoCameraCapture';
import { PressableScale } from '../components/PressableScale';
import { color, radius, space } from '../design/tokens';
import { Caption } from '../design/type';
import { PHOTO_REQUEST_TIMEOUT_MS } from '../engine/liveVision/config';
import { deviceManipulator } from '../engine/liveVision/deviceManipulator';
import { createPhotoScanState, scanPhoto } from '../engine/liveVision/photoScan';
import { lastRecognitionEndpoint, requestCensus } from '../engine/liveVision/recognitionClient';
import { describeScanFailure, type PhotoFailure } from '../engine/liveVision/scanFailure';
import { prepareUpload, type SourcePhoto } from '../engine/liveVision/uploadImage';
import { haulCount, useScanline } from '../engine/store';

/**
 * Photograph an item, and it goes in the cart.
 *
 * The shopper chooses the moment, so none of the live path's frame selection applies here: no
 * sharpness gate, no motion gate, no keyframe pacing, no session call ceiling, no tracker. Those
 * exist because a live camera produces thirty frames a second and something has to decide which
 * one is worth a recognition call. A photograph has already been decided.
 *
 * This screen owns no counting rules and no sizing rules. It turns a shutter press into a file,
 * `uploadImage.ts` turns the file into the bounded JPEG the service actually reads, and
 * `photoScan.ts` folds the answer through the same fusion the live path uses, so two photographs
 * of one orange stay one orange. See `src/engine/liveVision/photoScan.ts`.
 *
 * When nothing goes in the bag, the screen says why, in one line under the notice, with the
 * address it tried. "It just didn't work" on a phone is otherwise unanswerable from a Mac.
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
  const [failure, setFailure] = useState<PhotoFailure | null>(null);
  const [added, setAdded] = useState<number | null>(null);

  // What the last photograph said about things buried under other things. Held per photograph
  // rather than for the session, because the remedy the notice asks for is another photograph:
  // a shopper who moves the bag off the top and presses the button again has answered it, and a
  // latched flag would leave them being told to do what they have just done.
  const [occluded, setOccluded] = useState(false);

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
  const ingest = async (photo: SourcePhoto) => {
    setBusy(true);
    setFailure(null);
    try {
      // The bounded JPEG, not the file. A 48MP phone photograph is refused by the service for
      // its size alone, and a 12MP one is an eight megabyte upload the server's first resize
      // throws away. See uploadImage.ts for the bound and why it is what it is.
      let imageBase64: string;
      try {
        imageBase64 = await prepareUpload(photo, { manipulator: deviceManipulator });
      } catch {
        setFailure('capture');
        setOccluded(false);
        return;
      }

      const outcome = await scanPhoto(session.current, imageBase64, {
        // A photograph gets its own budget: the shopper is waiting on this one call, and it has
        // to outlast the service's 25 second race so the server's answer arrives before the
        // phone gives up on it.
        requestCensus: (request) => requestCensus(request, undefined, { timeoutMs: PHOTO_REQUEST_TIMEOUT_MS }),
      });
      if (outcome.ok) {
        session.current = outcome.state;
        setBag(outcome.lines, {});
        setAdded(outcome.added);
        setOccluded(outcome.occlusion.itemsLikelyHidden);
      } else {
        setFailure(outcome.failure);
        // Nothing was recognised, so the previous photograph's verdict is the only thing that
        // could still be on screen, and it is now unsupported by anything. `coachKind` puts
        // "unavailable" first in any case; this stops the occluded notice reappearing behind it
        // when the next call succeeds and finds nothing hidden.
        setOccluded(false);
      }
    } finally {
      setBusy(false);
    }
  };

  const pick = async () => {
    if (busy) return;
    let result: ImagePicker.ImagePickerResult;
    try {
      // Not asked for base64. The asset's uri and dimensions are all `prepareUpload` needs, and
      // asking the picker to base64 the whole file first is asking for the very upload it is
      // there to shrink.
      result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'] });
    } catch {
      // The picker is someone else's UI and can reject for reasons this screen cannot see or
      // fix: a permission revoked mid-flight, a file the system cannot read, or its own DOM
      // teardown on web. Without this the rejection escapes `pick`, nothing clears, and the
      // shopper is left looking at a screen that has silently stopped responding to the button.
      setFailure('capture');
      return;
    }
    if (result.canceled) return;
    const asset = result.assets?.[0];
    if (!asset?.uri) {
      setFailure('capture');
      return;
    }
    await ingest({ uri: asset.uri, width: asset.width, height: asset.height });
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
        onCapture={(photo) => void ingest(photo)}
        // A capture that fails shows the same notice as one that could not be recognized, and
        // a different line under it: nothing was sent, so no address is to blame.
        onError={() => setFailure('capture')}
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

      {/* The same two notices the live path shows, chosen by the same function, so the two
          screens cannot drift apart on which one wins. `amberPersists` is false and not a bug:
          it drives "bring your camera closer to items highlighted yellow", and this path draws
          no outlines to highlight, because the device runs no detector and the server's
          enumerator is unconfigured. The other two are both reachable here. */}
      <CoachNotice
        kind={coachKind({ amberPersists: false, occluded, unavailable: failure !== null })}
        topInset={insets.top}
      />

      <View style={[styles.controls, { bottom: controlsBottom }]} pointerEvents="box-none">
        {busy ? (
          <GlassSurface radius={radius.pill}>
            <View style={styles.status}>
              <ActivityIndicator color={color.white} />
              <Caption color={color.white}>Looking at your photo…</Caption>
            </View>
          </GlassSurface>
        ) : failure !== null ? (
          // Where the outcome of the last press is shown, so the reason sits where "Added 2
          // items" would have. The notice above keeps the product owner's wording; this is the
          // line for whoever has to fix it.
          <GlassSurface radius={radius.row}>
            <View style={styles.status}>
              <Caption color={color.white} style={styles.detail}>
                {describeScanFailure(failure, lastRecognitionEndpoint())}
              </Caption>
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
  detail: { flexShrink: 1, textAlign: 'center' },
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
