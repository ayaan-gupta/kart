import { SymbolView } from 'expo-symbols';
import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  FadeIn,
  interpolate,
  LinearTransition,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { color, motion, radius, space } from '../design/tokens';
import { Body, Caption, Headline, Sub, Title } from '../design/type';
import { OPEN_FOOD_FACTS_ATTRIBUTION } from '../engine/liveVision/barcodeLookup';
import { haulCount, useScanline } from '../engine/store';
import { Button } from './Button';
import { ItemThumbnail, itemSubtitle } from './ItemThumbnail';

const PEEK_CONTENT = 76;

/**
 * The bag lives at the bottom edge of the scan screen. Collapsed, it is a
 * white tray peeking up from the bezel; opening it expands the same surface
 * upward, so the list literally comes out of the bag.
 */
export function BagTray({ onFinish }: { onFinish: () => void }) {
  const insets = useSafeAreaInsets();
  const { height: screenH } = useWindowDimensions();
  const items = useScanline((s) => s.scan.items);
  const count = haulCount(items);

  const expandedH = Math.round(screenH * 0.78);
  const peekH = PEEK_CONTENT + insets.bottom;
  const travel = expandedH - peekH;

  const open = useSharedValue(0);
  const pulse = useSharedValue(1);
  const [isOpen, setIsOpen] = useState(false);

  const setOpen = (next: boolean) => {
    setIsOpen(next);
    open.value = withSpring(next ? 1 : 0, { duration: 460, dampingRatio: 1 });
  };

  // A quick bounce when something lands in the bag.
  const prevCount = useRef(count);
  useEffect(() => {
    if (count > prevCount.current) {
      pulse.value = withSequence(
        withTiming(1.02, { duration: 110 }),
        withSpring(1, motion.spring),
      );
    }
    prevCount.current = count;
  }, [count, pulse]);

  const trayStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(open.value, [0, 1], [travel, 0]) },
      { scale: pulse.value },
    ],
  }));
  const peekStyle = useAnimatedStyle(() => ({
    opacity: interpolate(open.value, [0, 0.35], [1, 0]),
  }));
  const bodyStyle = useAnimatedStyle(() => ({
    opacity: interpolate(open.value, [0.45, 1], [0, 1]),
  }));
  const scrimStyle = useAnimatedStyle(() => ({
    opacity: open.value * 0.5,
  }));

  const openGesture = Gesture.Race(
    Gesture.Pan().onEnd((e) => {
      if (e.translationY < -24) runOnJS(setOpen)(true);
    }),
    Gesture.Tap().onEnd(() => runOnJS(setOpen)(true)),
  );
  const closeGesture = Gesture.Pan().onEnd((e) => {
    if (e.translationY > 24) runOnJS(setOpen)(false);
  });

  return (
    <>
      <Animated.View
        pointerEvents={isOpen ? 'auto' : 'none'}
        style={[StyleSheet.absoluteFill, { backgroundColor: color.black }, scrimStyle]}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} accessibilityLabel="Close the bag" />
      </Animated.View>

      <Animated.View style={[styles.tray, { height: expandedH }, trayStyle]}>
        {/* Collapsed peek row */}
        <GestureDetector gesture={openGesture}>
          <Animated.View
            style={[styles.peek, peekStyle]}
            pointerEvents={isOpen ? 'none' : 'auto'}
            accessibilityRole="button"
            accessibilityLabel="Open your bag"
          >
            <View style={styles.grabber} />
            <View style={styles.peekRow}>
              <View style={styles.bagBadge}>
                {Platform.OS === 'ios' ? (
                  <SymbolView name="bag.fill" size={17} tintColor={color.white} />
                ) : null}
              </View>
              <Headline>{count === 1 ? '1 item' : `${count} items`}</Headline>
              <View style={styles.spacer} />
              {Platform.OS === 'ios' ? (
                <SymbolView name="chevron.up" size={14} tintColor={color.sub} weight="semibold" />
              ) : null}
            </View>
          </Animated.View>
        </GestureDetector>

        {/* Expanded bag */}
        <Animated.View
          style={[styles.body, bodyStyle, { paddingBottom: insets.bottom + space.m }]}
          pointerEvents={isOpen ? 'auto' : 'none'}
        >
          <GestureDetector gesture={closeGesture}>
            <View style={styles.bodyHeader}>
              <View style={styles.grabber} />
              <View style={styles.titleRow}>
                <Title>Your bag</Title>
                <Sub>{count === 1 ? '1 item so far' : `${count} items so far`}</Sub>
              </View>
            </View>
          </GestureDetector>

          <ScrollView style={styles.list} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
            {items.length === 0 ? (
              <View style={styles.empty}>
                <Body color={color.sub}>Nothing in the bag yet.</Body>
              </View>
            ) : (
              items.map((it) => (
                <Animated.View
                  key={it.key}
                  entering={FadeIn.duration(200)}
                  layout={LinearTransition.springify().duration(motion.spring.duration)}
                  style={styles.line}
                >
                  <ItemThumbnail uri={it.thumbnailUri} size={46} />
                  <View style={styles.lineText}>
                    <Headline numberOfLines={1}>{it.name}</Headline>
                    <Sub color={it.unsure ? color.amber : undefined}>{itemSubtitle(it)}</Sub>
                  </View>
                  {it.qty > 1 ? <Headline>{`x${it.qty}`}</Headline> : null}
                </Animated.View>
              ))
            )}
          </ScrollView>

          <View style={styles.footer}>
            <Caption color={color.sub}>{OPEN_FOOD_FACTS_ATTRIBUTION}</Caption>
            <Button label="Finish cart" variant="primary" onPress={onFinish} />
          </View>
        </Animated.View>
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  tray: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: color.bg,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    shadowColor: color.black,
    shadowOpacity: 0.22,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -8 },
    elevation: 16,
  },
  peek: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingTop: space.s,
    paddingHorizontal: space.xl,
  },
  grabber: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: color.hairline,
  },
  peekRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    paddingTop: space.m,
  },
  bagBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: color.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spacer: { flex: 1 },
  body: {
    flex: 1,
    paddingHorizontal: space.xl,
  },
  bodyHeader: {
    paddingTop: space.s,
    paddingBottom: space.m,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingTop: space.l,
  },
  list: { flex: 1 },
  listContent: { gap: space.l, paddingBottom: space.s },
  empty: { paddingVertical: space.xxl, alignItems: 'center' },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
  },
  lineText: { flex: 1, gap: 1 },
  footer: {
    gap: space.m,
    paddingTop: space.l,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.hairline,
  },
});
