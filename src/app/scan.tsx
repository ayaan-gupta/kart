import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SymbolView } from 'expo-symbols';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Linking, Platform, StyleSheet, View } from 'react-native';
import { Camera, runAtTargetFps, useCameraDevice, useCameraPermission, useFrameProcessor } from 'react-native-vision-camera';
import { Worklets } from 'react-native-worklets-core';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  FadeInDown,
  FadeOutUp,
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
import { DetectionRow } from '../components/DetectionRow';
import { GlassSurface } from '../components/GlassSurface';
import { IconButton } from '../components/IconButton';
import { ItemHighlights } from '../components/ItemHighlights';
import { color, motion, radius, space } from '../design/tokens';
import { Caption, Sub } from '../design/type';
import { DETECT_TARGET_FPS } from '../engine/liveVision/config';
import { scanCart } from '../engine/liveVision/frameProcessor';
import { createPipelineState, processFrame } from '../engine/liveVision/pipeline';
import type { FrameScan, KeyframeReason, Track } from '../engine/liveVision/types';
import { aggregate, haulCount, useScanline } from '../engine/store';

const VISIBLE_MS = 6000;

/**
 * Ceiling on distinct frame processor error messages logged per scan session. Deduping by
 * message assumes the messages repeat; one carrying a frame-specific value would not, and
 * would both spam the log and grow the set unboundedly at three frames a second.
 */
const MAX_REPORTED_ERRORS = 20;

/** How often the keyframe histogram prints even when the reason has not changed. */
const KEYFRAME_LOG_INTERVAL_MS = 5000;

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
  const scan = useScanline((s) => s.scan);
  const finishHaul = useScanline((s) => s.finishHaul);
  const discardScan = useScanline((s) => s.discardScan);
  const [tick, setTick] = useState(Date.now());

  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');
  const pipelineStateRef = useRef(createPipelineState());
  const keyframeReasonsRef = useRef<Record<KeyframeReason, number>>({
    fire: 0,
    blurry: 0,
    moving: 0,
    'too-soon': 0,
    'nothing-to-see': 0,
  });
  const lastKeyframeReasonRef = useRef<KeyframeReason | null>(null);
  const lastKeyframeLogAtRef = useRef(0);
  const reportedErrorsRef = useRef<Set<string>>(new Set());
  const errorCapNotedRef = useRef(false);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [frameSize, setFrameSize] = useState<{ width: number; height: number } | null>(null);
  const [permissionAsked, setPermissionAsked] = useState(false);

  useEffect(() => {
    if (!hasPermission && !permissionAsked) {
      setPermissionAsked(true);
      requestPermission();
    }
  }, [hasPermission, permissionAsked, requestPermission]);

  // Stable identity across renders: react-native-vision-camera requires the frame processor
  // (and therefore this handler) not to change identity every render, or the native Frame
  // Processor Context gets torn down and reinstalled repeatedly. Safe to build once, because
  // the body only closes over refs and stable setState and module imports.
  const handleScan = useMemo(
    () =>
      // The React Compiler lint rules model every function defined in a component body as
      // reachable during render. This one is not: react-native-worklets-core only invokes it
      // when the frame processor worklet calls it via runOnJS, on the JS thread, after render.
      // eslint-disable-next-line react-hooks/refs -- invoked from a worklet callback, never during render
      Worklets.createRunOnJS((scan: FrameScan) => {
        // eslint-disable-next-line react-hooks/purity -- runs on the JS thread from runOnJS, not during render
        const now = Date.now();
        if (scan.width > 0 && scan.height > 0) {
          setFrameSize({ width: scan.width, height: scan.height });
        }

        const result = processFrame(pipelineStateRef.current, scan, now);
        pipelineStateRef.current = result.state;
        setTracks(result.tracks);

        // Plan 2 only decides that a frame is worth uploading. Plan 3 is what uploads it, so
        // until then the only evidence that the gate works on real hardware is watching why it
        // is holding. A bare count of fires could not tell a gate stuck on 'blurry' from one
        // stuck on 'moving' or one that never sees a confirmed track, and it could not tell any
        // of those from a gate that is simply correct. Logging the histogram says which, and
        // carrying the raw signals alongside it is what makes minSharpness and maxMotion
        // tunable against a real camera at all.
        //
        // On a transition OR every few seconds. Transitions alone are the wrong trigger for the
        // case that matters most: a gate stuck on one reason prints a single early line with
        // counts near zero and then goes silent forever, which is exactly the failure you need
        // to watch. The interval turns it into the rolling sample a tuning session needs.
        const reason = result.keyframe.reason;
        keyframeReasonsRef.current[reason] += 1;
        if (reason !== lastKeyframeReasonRef.current || now - lastKeyframeLogAtRef.current >= KEYFRAME_LOG_INTERVAL_MS) {
          lastKeyframeReasonRef.current = reason;
          lastKeyframeLogAtRef.current = now;
          const counts = keyframeReasonsRef.current;
          console.log(
            `[kart] keyframe ${reason}: fire=${counts.fire} blurry=${counts.blurry} ` +
              `moving=${counts.moving} too-soon=${counts['too-soon']} ` +
              `nothing-to-see=${counts['nothing-to-see']} | sharpness=${scan.sharpness.toFixed(0)} ` +
              `motion=${scan.motion.toFixed(3)} tracks=${result.tracks.length}`,
          );
        }

        // A detector that throws on every frame reports zero instances, which is exactly what
        // an empty cart reports. Once per distinct message, because at three frames a second a
        // permanent failure would otherwise bury the log it is supposed to make readable.
        //
        // Capped, because dedupe by message only works while the messages repeat. An error
        // carrying a frame-specific value (a timestamp, a buffer address) is distinct every
        // frame, which degrades to logging all of them and grows the set for the life of the
        // screen. The cap notice is what stops that looking like the errors simply stopped.
        if (scan.error != null && !reportedErrorsRef.current.has(scan.error)) {
          if (reportedErrorsRef.current.size < MAX_REPORTED_ERRORS) {
            reportedErrorsRef.current.add(scan.error);
            console.warn(`[kart] frame processor error: ${scan.error}`);
          } else if (!errorCapNotedRef.current) {
            errorCapNotedRef.current = true;
            console.warn(
              `[kart] frame processor errors exceeded ${MAX_REPORTED_ERRORS} distinct messages, silencing`,
            );
          }
        }
      }),
    [],
  );

  const frameProcessor = useFrameProcessor(
    (frame) => {
      'worklet';
      // Detection is the expensive call, so it runs a few times a second rather than every
      // frame. The overlay stays smooth because the tracker predicts between detections, and
      // the frame's upright dimensions now come back from native with the result.
      runAtTargetFps(DETECT_TARGET_FPS, () => {
        'worklet';
        // wantKeyframe and cropTrackIds are wired up once fusion (later in Plan 3) decides
        // there are tracks worth an upload and items worth a thumbnail; until then this asks
        // for neither, so the gate simply never fires.
        handleScan(scanCart(frame, { wantKeyframe: false, cropTrackIds: [] }));
      });
    },
    [handleScan],
  );

  useEffect(() => {
    useScanline.getState().startScan();
  }, []);

  // The tick exists only to expire detection rows as they pass VISIBLE_MS. This plan never puts
  // anything in that list (naming belongs to Plan 3), so with no detections the timer re-renders
  // the whole screen once a second, during a live camera session, to recompute an empty array,
  // on top of the three renders a second the tracker already causes. Nothing is deleted here:
  // the moment Plan 3 puts a detection in the list the timer starts itself again.
  const hasDetections = scan.detections.length > 0;
  useEffect(() => {
    if (!hasDetections) return;
    const t = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, [hasDetections]);

  const items = useMemo(() => aggregate(scan.detections), [scan.detections]);
  const count = haulCount(items);
  const bagBySku = useMemo(() => new Map(items.map((it) => [it.skuCode, it.qty])), [items]);

  const visibleDetections = useMemo(() => {
    const fresh = scan.detections.filter((d) => tick - d.detectedAt < VISIBLE_MS);
    // One row per product: a repeat scan refreshes its row instead of stacking a twin.
    const bySku = new Map(fresh.map((d) => [d.skuCode, d]));
    return [...bySku.values()].slice(-2);
  }, [scan.detections, tick]);

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
          <ItemHighlights tracks={tracks} frameSize={frameSize} />
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
        <RecordChip startedAt={scan.startedAt} />
      </View>

      {scan.hint ? (
        <Animated.View
          entering={FadeInDown.springify().duration(motion.spring.duration + 100).dampingRatio(1)}
          exiting={FadeOutUp.duration(220)}
          style={[styles.hint, { top: insets.top + space.s + 58 }]}
        >
          {Platform.OS === 'ios' ? (
            <SymbolView name="exclamationmark.circle.fill" size={20} tintColor={color.brand} />
          ) : null}
          <Sub color={color.white} style={styles.hintText}>
            {scan.hint}
          </Sub>
        </Animated.View>
      ) : null}

      <View
        style={[styles.detections, { bottom: 76 + insets.bottom + space.xl }]}
        pointerEvents="none"
      >
        {visibleDetections.map((d) => (
          <Animated.View
            key={d.id}
            entering={FadeInDown.springify().duration(motion.spring.duration + 140).dampingRatio(1)}
            exiting={dropIntoBag}
            layout={LinearTransition.springify().duration(motion.spring.duration)}
          >
            <DetectionRow detection={d} repeatIndex={bagBySku.get(d.skuCode) ?? 1} />
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
  hint: {
    position: 'absolute',
    left: space.xl,
    right: space.xl,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
  },
  hintText: {
    flex: 1,
    fontWeight: '600',
    textShadowColor: 'rgba(0,0,0,0.55)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
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
