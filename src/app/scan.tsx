import { useEventListener } from 'expo';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SymbolView } from 'expo-symbols';
import { useVideoPlayer } from 'expo-video';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Platform, StyleSheet, View } from 'react-native';
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
  withSpring,
  withTiming,
  type ExitAnimationsValues,
} from 'react-native-reanimated';
import { BagTray } from '../components/BagTray';
import { DetectionRow } from '../components/DetectionRow';
import { GlassSurface } from '../components/GlassSurface';
import { IconButton } from '../components/IconButton';
import { ScanFeed } from '../components/ScanFeed';
import { color, motion, radius, space } from '../design/tokens';
import { Caption, Sub } from '../design/type';
import { onVideoTime, startScanEngine, stopScanEngine } from '../engine/scanEngine';
import { aggregate, haulCount, useScanline } from '../engine/store';

const scanVideo = require('../../assets/videos/scan.mp4');

const VISIBLE_MS = 6000;

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

  const player = useVideoPlayer(scanVideo, (p) => {
    p.loop = true;
    p.muted = true;
    p.timeUpdateEventInterval = 0.2;
    p.play();
  });

  // Detections fire in sync with where the vision model saw each item, and
  // the highlight layer follows the footage's slow camera drift.
  const timeSv = useSharedValue(0);
  useEventListener(player, 'timeUpdate', (e) => {
    timeSv.value = e.currentTime;
    onVideoTime(e.currentTime);
  });

  useEffect(() => {
    startScanEngine();
    return () => stopScanEngine();
  }, []);

  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

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
      stopScanEngine();
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
    stopScanEngine();
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
      <ScanFeed player={player} timeSv={timeSv} detections={scan.detections} />

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
});
