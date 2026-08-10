import React, { useEffect } from 'react';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { KartLogo } from './KartLogo';

const RATIO = 637 / 488;
/** Timing from kart-logo-animated.svg: 1.497s cycle, overshoot in, ease out. */
const CYCLE = 1497;
const overshoot = Easing.bezier(0.45, 1.45, 0.8, 1);
const easeOut = Easing.bezier(0.478, 0, 0.58, 1);

interface AnimatedKartLogoProps {
  height?: number;
  /** loop the full slide-through like the source SVG; off = settle in center */
  loop?: boolean;
}

export function AnimatedKartLogo({ height = 64, loop = false }: AnimatedKartLogoProps) {
  const reducedMotion = useReducedMotion();
  const width = height * RATIO;
  const travel = width * 1.16;
  const x = useSharedValue(reducedMotion ? 0 : -travel);
  const opacity = useSharedValue(reducedMotion ? 1 : 0);

  useEffect(() => {
    if (reducedMotion) return;
    if (loop) {
      x.value = withRepeat(
        withSequence(
          withTiming(0, { duration: CYCLE * 0.217, easing: overshoot }),
          withDelay(CYCLE * 0.245, withTiming(travel, { duration: CYCLE * 0.217, easing: easeOut })),
          withDelay(CYCLE * 0.321, withTiming(-travel, { duration: 1 })),
        ),
        -1,
      );
      opacity.value = withRepeat(
        withSequence(
          withTiming(1, { duration: CYCLE * 0.328, easing: Easing.linear }),
          withDelay(CYCLE * 0.077, withTiming(0, { duration: CYCLE * 0.28, easing: Easing.linear })),
          withTiming(0, { duration: CYCLE * 0.315 }),
        ),
        -1,
      );
    } else {
      x.value = withTiming(0, { duration: CYCLE * 0.217, easing: overshoot });
      opacity.value = withTiming(1, { duration: CYCLE * 0.2, easing: Easing.linear });
    }
  }, [loop, reducedMotion, travel, x, opacity]);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateX: x.value }],
  }));

  return (
    <Animated.View style={[{ width, height, overflow: 'visible' }]}>
      <Animated.View style={style}>
        <KartLogo height={height} />
      </Animated.View>
    </Animated.View>
  );
}
