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
import { DETECT_TARGET_FPS } from '../engine/liveVision/config';
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
  const [occluded, setOccluded] = useState(false);
  const [amberPersists, setAmberPersists] = useState(false);
  const [permissionAsked, setPermissionAsked] = useState(false);

  const guide = guideVisible({ occluded, coverage });
  // The gyroscope only runs while the guide is on screen. Leaving it subscribed for a whole
  // scan costs battery to produce a number nothing reads.
  const yaw = useDeviceYaw(guide);

  useEffect(() => {
    if (guide && yaw !== null) setCoverage((c) => observeYaw(c, yaw));
  }, [guide, yaw]);

  useEffect(() => () => sessionRef.current?.dispose(), []);

  useEffect(() => {
    if (!hasPermission && !permissionAsked) {
      setPermissionAsked(true);
      requestPermission();
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
        const refreshNextRequest = () => {
          nextRequestRef.current = {
            wantKeyframe: session.wantsKeyframe(result.tracks, result.keyframe.fire),
            cropTrackIds: tracksNeedingThumbnail(session.state, result.tracks),
          };
        };
        refreshNextRequest();

        // Everything below is fire and forget. Nothing on the path from a frame arriving to an
        // outline being drawn is allowed to await the network.
        const publish = () => {
          setIdentities({ ...session.state.fusion.identities });
          setOccluded(session.state.occlusion.hidden);
          setAmberPersists(persistentAmber(session.state, result.tracks, Date.now()));
          useScanline.getState().setBag(bagLines(session.state.fusion), session.state.thumbnails);
          refreshNextRequest();
        };

        if (scan.keyframe !== null) {
          void session.onKeyframe(scan.keyframe, result.tracks, now).then(publish);
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

      <CoachNotice kind={coachKind({ amberPersists, occluded })} topInset={insets.top} />
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
