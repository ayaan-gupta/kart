import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Linking, StyleSheet, View } from 'react-native';
import { Camera, runAtTargetFps, useCameraDevice, useCameraPermission, useFrameProcessor } from 'react-native-vision-camera';
import { Worklets } from 'react-native-worklets-core';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  FadeInDown,
  LinearTransition,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  type ExitAnimationsValues,
} from 'react-native-reanimated';
import { BagTray } from '../components/BagTray';
import { Button } from '../components/Button';
import { CaptureGuide, guideVisible } from '../components/CaptureGuide';
import { CoachNotice, coachKind } from '../components/CoachNotice';
import { DetectionRow } from '../components/DetectionRow';
import { GlassSurface } from '../components/GlassSurface';
import { IconButton } from '../components/IconButton';
import { ItemHighlights } from '../components/ItemHighlights';
import { color, motion, radius, space } from '../design/tokens';
import { Caption, Sub } from '../design/type';
import { createLookupCache, lookupBarcode } from '../engine/liveVision/barcodeLookup';
import { DETECT_TARGET_FPS, MIN_KEYFRAME_SHARPNESS } from '../engine/liveVision/config';
import { createCoverageState, observeYaw, type CoverageState } from '../engine/liveVision/coverage';
import { scanCart } from '../engine/liveVision/frameProcessor';
import { bagLines } from '../engine/liveVision/fusion';
import {
  persistentAmber,
  RecognitionSession,
  tracksNeedingThumbnail,
} from '../engine/liveVision/orchestrator';
import { createPipelineState, processFrame } from '../engine/liveVision/pipeline';
import { requestCensus, requestIdentify } from '../engine/liveVision/recognitionClient';
import { useDeviceYaw } from '../engine/liveVision/useDeviceYaw';
import type { FrameScan, Identity, ScanRequest, Track } from '../engine/liveVision/types';
import { saveThumbnail } from '../engine/thumbnails';
import { haulCount, useScanline } from '../engine/store';

function RecordChip({ startedAt }: { startedAt: number | null }) {
  const reducedMotion = useReducedMotion();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const pulseSv = useSharedValue(1);
  useEffect(() => {
    if (!reducedMotion) {
      pulseSv.value = withRepeat(
        withSequence(withTiming(0.35, { duration: 900 }), withTiming(1, { duration: 900 })),
        -1,
      );
    }
  }, [reducedMotion, pulseSv]);
  const dotStyle = useAnimatedStyle(() => ({ opacity: pulseSv.value }));

  const elapsed = startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;
  const mm = Math.floor(elapsed / 60);
  const ss = (elapsed % 60).toString().padStart(2, '0');

  return (
    <GlassSurface radius={radius.pill} scheme="dark" floating={false}>
      <View style={styles.recordChip}>
        <Animated.View style={[styles.recordDot, dotStyle]} />
        <Caption color={color.onFeed} style={styles.recordTime}>
          {mm}:{ss}
        </Caption>
      </View>
    </GlassSurface>
  );
}

/** Detections drop down toward the bag as they leave. */
function dropIntoBag(values: ExitAnimationsValues) {
  'worklet';
  return {
    initialValues: { opacity: 1, transform: [{ translateY: 0 }, { scale: 1 }] },
    animations: {
      opacity: withTiming(0, { duration: 300 }),
      transform: [
        { translateY: withTiming(30, { duration: 320 }) },
        { scale: withTiming(0.82, { duration: 320 }) },
      ],
    },
  };
}

export default function ScanScreen() {
  const insets = useSafeAreaInsets();
  const startedAt = useScanline((s) => s.scan.startedAt);
  const finishHaul = useScanline((s) => s.finishHaul);
  const discardScan = useScanline((s) => s.discardScan);

  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');

  const pipelineStateRef = useRef(createPipelineState());
  const lookupCacheRef = useRef(createLookupCache());
  const sessionRef = useRef<RecognitionSession | null>(null);
  if (sessionRef.current === null) {
    // Built lazily rather than in useState so the dependencies are wired exactly once and the
    // session is never reconstructed by a re-render mid-scan. Guarded by the null check above,
    // so this write happens at most once per component instance, on the first render only, the
    // same lazy-initialization idiom useState's own lazy initializer form uses internally.
    // eslint-disable-next-line react-hooks/refs -- guarded lazy init, runs once, not a render read
    sessionRef.current = new RecognitionSession({
      requestCensus,
      requestIdentify,
      lookupBarcode: (payload, signal) => lookupBarcode(lookupCacheRef.current, payload, signal),
      saveThumbnail,
    });
  }
  // What the next frame should ask the plugin for, decided on the JS thread. `wantsKeyframe`
  // (a RecognitionSession method) and `tracksNeedingThumbnail` are plain functions with no
  // 'worklet' directive, closing over `session.state`, a live class instance. Neither the
  // worklets-core babel plugin nor the vision-camera Frame Processor runtime workletizes a
  // function just because a worklet references it: only an explicit 'worklet' directive does
  // that (react-native-worklets-core/src/plugin/index.js only visits FunctionDeclaration,
  // FunctionExpression and ArrowFunctionExpression nodes carrying that directive; it never
  // walks a call graph). A plain function crossing into the worklet runtime as a closure
  // value is wrapped as a stub that throws "Regular javascript function '<name>' cannot be
  // shared..." the moment it is called (WKTJsiObjectWrapper.h, setFunctionValue) -- confirmed
  // by reading the installed react-native-worklets-core@1.6.3 C++ source, not assumed. Calling
  // either function from inside the frame processor would throw on every single frame on a
  // real device. So the decision is made here, on the JS thread, and the worklet only ever
  // reads the plain-data result below.
  const nextRequestRef = useRef<ScanRequest>({ wantKeyframe: false, cropTrackIds: [] });

  const [tracks, setTracks] = useState<Track[]>([]);
  const [identities, setIdentities] = useState<Record<string, Identity>>({});
  const [frameSize, setFrameSize] = useState<{ width: number; height: number } | null>(null);
  const [coverage, setCoverage] = useState<CoverageState>(createCoverageState());
  // The most recent yaw already folded into `coverage`, so a repeated render does not fold the
  // same reading twice. Reset to null alongside `coverage` when a fresh occlusion episode
  // starts (see `publish` below), so the first yaw of the new episode is never mistaken for one
  // already seen.
  const [observedYaw, setObservedYaw] = useState<number | null>(null);
  const [occluded, setOccluded] = useState(false);
  const [amberPersists, setAmberPersists] = useState(false);
  /** Every census so far has failed, so the scan is broken rather than the cart empty. */
  const [unavailable, setUnavailable] = useState(false);
  /**
   * Consecutive frames the native detector reported an error on.
   *
   * `FrameScan.error` exists because a plugin that failed to register and a detector that ran
   * cleanly over an empty cart both produce zero instances, and `frameProcessor.ts` says outright
   * that this "is the one case scanCart must never let fall through to a silent, error-less empty
   * scan". Nothing read it. On a phone a failed native registration would have shown a camera that
   * detects nothing and explains nothing, which is the same fault the census side had (KART.md,
   * eighty-fifth).
   */
  const detectorErrorsRef = useRef(0);
  const [permissionAsked, setPermissionAsked] = useState(false);
  // Whether the last-published occlusion verdict was true, read (not set) outside render so
  // `publish` can detect the false-to-true edge that starts a new episode. A ref, not state:
  // nothing needs to re-render when this changes on its own.
  const wasOccludedRef = useRef(false);
  /** Development only: the device's own sharpness readings, for MIN_KEYFRAME_SHARPNESS. */
  const sharpnessSeenRef = useRef<number[]>([]);

  const guide = guideVisible({ occluded, coverage });
  // The gyroscope only runs while the guide is on screen. Leaving it subscribed for a whole
  // scan costs battery to produce a number nothing reads.
  const yaw = useDeviceYaw(guide);

  // Folds a new yaw reading into coverage. An effect here would call setState synchronously in
  // response to a value that already changed this render, cascading into an extra render for no
  // reason; adjusting state directly during render, the pattern React's own docs recommend for
  // this shape, lets React finish the adjustment before committing anything to the screen.
  // Convergent rather than looping: `observeYaw` returns the same `coverage` reference once the
  // yaw's sector is already marked, and the `yaw !== observedYaw` guard stops this from running
  // again for an unchanged reading regardless.
  if (guide && yaw !== null && yaw !== observedYaw) {
    setObservedYaw(yaw);
    setCoverage((c) => observeYaw(c, yaw));
  }

  useEffect(() => () => sessionRef.current?.dispose(), []);

  useEffect(() => {
    if (!hasPermission && !permissionAsked) {
      // `setPermissionAsked` runs once the request settles, inside the promise callback, not
      // synchronously in the effect body: `requestPermission` is the external system this effect
      // exists to talk to, and reacting to its own completion is the sanctioned shape, not a
      // same-render cascade. Nothing else in this effect depends on the timing: `hasPermission`
      // is owned entirely by `useCameraPermission` and updates on its own once the OS responds.
      void requestPermission().then(() => setPermissionAsked(true));
    }
  }, [hasPermission, permissionAsked, requestPermission]);

  // Stable identity across renders: react-native-vision-camera requires the frame processor
  // (and therefore this handler) not to change identity every render, or the native Frame
  // Processor Context is torn down and reinstalled repeatedly. Safe to build once, because the
  // body only closes over refs, stable setState, and module imports.
  const handleScan = useMemo(
    () =>
      // The React Compiler lint rules model every function defined in a component body as
      // reachable during render. This one is not: react-native-worklets-core only invokes it
      // when the frame processor worklet calls it via runOnJS, on the JS thread, after render.
      // eslint-disable-next-line react-hooks/refs -- invoked from a worklet callback, never during render
      Worklets.createRunOnJS((scan: FrameScan) => {
        // eslint-disable-next-line react-hooks/purity -- runs on the JS thread from runOnJS, not during render
        const now = Date.now();
        const session = sessionRef.current;
        if (session === null) return;

        if (scan.width > 0 && scan.height > 0) {
          setFrameSize({ width: scan.width, height: scan.height });
        }

        // Development only: what the device's own FrameMetrics actually reports, which is the one
        // reading MIN_KEYFRAME_SHARPNESS needs and cannot get here.
        //
        // That constant is 12 and was set against `score_video.py`'s figure, the variance of the
        // Laplacian over the whole frame. `FrameMetrics.sharpness` returns the largest of a 3 by 3
        // grid of 128-pixel tiles instead, which runs several times higher, so on a phone the only
        // blur test left rejects nothing (see its docstring, and KART.md's forty-fifth section).
        // Setting it properly needs a distribution from a real camera over a real trolley, which a
        // simulator cannot give: it has no camera device, so this block never runs there.
        if (__DEV__) {
          const seen = sharpnessSeenRef.current;
          seen.push(scan.sharpness);
          if (seen.length % 30 === 0) {
            const sorted = [...seen].sort((a, b) => a - b);
            console.log(
              `[kart] device sharpness over ${seen.length} frames: ` +
              `min ${sorted[0].toFixed(0)}, median ${sorted[Math.floor(sorted.length / 2)].toFixed(0)}, ` +
              `max ${sorted[sorted.length - 1].toFixed(0)} (MIN_KEYFRAME_SHARPNESS is ${MIN_KEYFRAME_SHARPNESS})`,
            );
          }
        }

        // Half a second of consecutive failures, not one frame: a single bad frame is noise, and a
        // plugin that did not load fails every frame forever.
        if (scan.error) {
          detectorErrorsRef.current += 1;
          if (detectorErrorsRef.current >= 15) setUnavailable(true);
        } else if (detectorErrorsRef.current > 0) {
          detectorErrorsRef.current = 0;
        }

        const result = processFrame(pipelineStateRef.current, scan, now);
        pipelineStateRef.current = result.state;
        setTracks(result.tracks);

        // Both of these read `session.state` and must run on the JS thread, never inside the
        // frame processor worklet (see the comment on `nextRequestRef`). Refreshed here and
        // again after each async result lands in `publish`, so the request the next frame reads
        // is never more than one detection cycle stale.
        //
        // `result.keyframe.fire` is `evaluateKeyframe`'s verdict for this same frame (sharp
        // enough, still enough, and paced by `minIntervalMs`/the scene-change interval; see
        // `pipeline.ts`, `keyframe.ts`), passed through as `wantsKeyframe`'s second argument so
        // it actually gates the request instead of being computed and discarded.
        // The tracks these read are `result.tracks` until a capture lands, and the capture's own
        // afterwards. `onCapture` builds tracks from the regions the service enumerated, and those
        // are the real items; the frame's are one blob from the device detector. Reading the frame's
        // after a capture would ask for thumbnails of the blob and never of the products, and would
        // compute the amber state from one track instead of eight.
        let current = result.tracks;
        const refreshNextRequest = () => {
          nextRequestRef.current = {
            wantKeyframe: session.wantsKeyframe(current, result.keyframe.fire),
            cropTrackIds: tracksNeedingThumbnail(session.state, current),
          };
        };
        refreshNextRequest();

        // Everything below is fire and forget. Nothing on the path from a frame arriving to an
        // outline being drawn is allowed to await the network.
        const publish = () => {
          setIdentities({ ...session.state.fusion.identities });

          const nowOccluded = session.state.occlusion.hidden;
          if (nowOccluded && !wasOccludedRef.current) {
            // A fresh occlusion episode. `orchestrator.ts` only writes `state.occlusion` from a
            // successful census, so once the census budget is spent it never changes again (see
            // I3 in the branch review): with nothing else to go on, coachKind and guideVisible
            // both key their exit on `coverage` completing instead. But coverage may already be
            // complete from an earlier episode, which would leave this one's guide and notice
            // unable to open at all. Starting a fresh episode over a fresh coverage requirement
            // is what keeps that exit meaningful the second time occlusion is detected, not just
            // the first.
            setCoverage(createCoverageState());
            setObservedYaw(null);
          }
          wasOccludedRef.current = nowOccluded;
          setOccluded(nowOccluded);

          setAmberPersists(persistentAmber(session.state, current, Date.now()));
          setUnavailable(session.state.censusFailures > 0
            && session.state.censusFailures === session.state.censusCalls);
          useScanline.getState().setBag(bagLines(session.state.fusion), session.state.thumbnails);
          refreshNextRequest();
        };

        if (scan.keyframe !== null) {
          // The capture path from `docs/detector-decision.md`: send the frame with no marks and
          // let the service enumerate it.
          //
          // `result.tracks` comes from `AppleInstanceMaskDetector` by way of `processFrame`, and
          // that detector does not enumerate a cart. Run over the corpus scan's 30 frames with
          // `npm run bench:detector` it returns 1 to 2 instances per frame, mean 1.1, and its
          // single instance outlines the whole pile of goods rather than one item. Badging the
          // census from those marks was measured on the real loop by
          // `server/eval/pipeline/scan-loop.ts`, which runs this same sequence in Node: 19, 15
          // and 15 units for a nine-product trolley, the bag filling with eighteen variations of
          // "bag of leafy greens" because with one badge almost everything arrives through
          // `unmarkedItems`, which carries no joining SKU on half its entries. The same harness
          // through `onCapture` gives 11, 11 and 12 units of recognisable products.
          //
          // The tracker is handed over and taken back so the next frame tracks against the
          // regions the service found rather than against the device's blob. `scan-loop.ts`
          // exercises exactly that, `processFrame` on every frame with the capture's tracker
          // written back between them, which is the interaction this change turns on.
          void session
            .onCapture(scan.keyframe, pipelineStateRef.current.tracker, now)
            .then((captured) => {
              if (captured !== null) {
                pipelineStateRef.current = {
                  ...pipelineStateRef.current,
                  tracker: captured.tracker,
                };
                current = captured.tracks;
                setTracks(captured.tracks);
              }
              publish();
            });
        }
        if (scan.crops.length > 0) {
          void session.onCrops(scan.crops).then(publish);
        }

        const hits = result.tracks
          .filter((t) => t.barcode !== null)
          .map((t) => ({ trackId: t.id, payload: t.barcode as string }));
        if (hits.length > 0) void session.onBarcodes(hits).then(publish);

        // Cheap, synchronous, and needs no network, so it updates every cycle rather than only
        // when a request lands.
        setAmberPersists(persistentAmber(session.state, result.tracks, now));
        setUnavailable(session.state.censusFailures > 0
          && session.state.censusFailures === session.state.censusCalls);
      }),
    [],
  );

  const frameProcessor = useFrameProcessor(
    (frame) => {
      'worklet';
      // Detection runs a few times a second rather than every frame. The overlay stays smooth
      // because the tracker predicts between detections.
      runAtTargetFps(DETECT_TARGET_FPS, () => {
        'worklet';
        // `nextRequestRef.current` is plain data (booleans, strings, numbers) computed on the
        // JS thread in `handleScan`. Do not replace this with a call to `wantsKeyframe` or
        // `tracksNeedingThumbnail`: neither carries a 'worklet' directive, and calling a
        // non-worklet function from inside a frame processor throws on every frame on device.
        // See the comment on `nextRequestRef` above for the evidence.
        handleScan(scanCart(frame, nextRequestRef.current));
      });
    },
    [handleScan],
  );

  useEffect(() => {
    useScanline.getState().startScan();
  }, []);

  const items = useScanline((s) => s.scan.items);
  const count = haulCount(items);
  const visibleDetections = useMemo(() => items.slice(-2), [items]);

  const close = () => {
    const leave = () => {
      discardScan();
      router.back();
    };
    if (count > 0) {
      Alert.alert('Discard this cart?', 'Nothing will be saved.', [
        { text: 'Keep scanning', style: 'cancel' },
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
      {device != null && hasPermission ? (
        <>
          <Camera
            style={StyleSheet.absoluteFill}
            device={device}
            isActive={true}
            frameProcessor={frameProcessor}
          />
          <ItemHighlights tracks={tracks} identities={identities} frameSize={frameSize} />
        </>
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.permissionFallback]}>
          <Sub color={color.onFeedSub} style={styles.permissionText}>
            {hasPermission === false && permissionAsked
              ? 'Kart needs camera access to scan your cart. Enable it in Settings to continue.'
              : hasPermission && device == null
                // Access was granted and there is still no camera to open. On a phone this does
                // not happen; in the Simulator it always does, and the screen used to sit on
                // "Requesting camera access" forever, which says the opposite of what is true and
                // sends whoever is looking at it to check permissions that are already fine.
                ? 'No camera is available on this device, so scanning cannot start.'
                : 'Requesting camera access…'}
          </Sub>
          {hasPermission === false && permissionAsked ? (
            <Button label="Open Settings" onPress={() => Linking.openSettings()} />
          ) : null}
        </View>
      )}

      <View style={[styles.topBar, { top: insets.top + space.s }]}>
        <IconButton symbol="xmark" fallback="✕" accessibilityLabel="Close the scan" onPress={close} scheme="dark" />
        <RecordChip startedAt={startedAt} />
      </View>

      {/* `guide` is `occluded && !isCoverageComplete(coverage)` (see guideVisible): the occluded
          notice shares the guide's own coverage exit, rather than reading raw `occluded`, which
          orchestrator.ts can stop updating for the rest of the session once the census budget is
          spent (I3 in the branch review) and would otherwise have no way to clear. */}
      <CoachNotice kind={coachKind({ amberPersists, occluded: guide, unavailable })} topInset={insets.top} />
      <CaptureGuide coverage={coverage} visible={guide} />

      <View
        style={[styles.detections, { bottom: 76 + insets.bottom + space.xl }]}
        pointerEvents="none"
      >
        {visibleDetections.map((d) => (
          <Animated.View
            key={d.key}
            entering={FadeInDown.springify().duration(motion.spring.duration + 140).dampingRatio(1)}
            exiting={dropIntoBag}
            layout={LinearTransition.springify().duration(motion.spring.duration)}
          >
            <DetectionRow item={d} />
          </Animated.View>
        ))}
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
  recordChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: space.m,
    paddingVertical: 8,
  },
  recordDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: color.record },
  recordTime: { fontVariant: ['tabular-nums'], fontWeight: '600' },
  detections: {
    position: 'absolute',
    left: space.xl,
    right: space.xl,
    gap: space.l,
  },
  permissionFallback: {
    backgroundColor: color.feed,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xl,
    gap: space.l,
  },
  permissionText: {
    textAlign: 'center',
  },
});
