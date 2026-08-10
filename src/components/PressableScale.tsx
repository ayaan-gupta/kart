import * as Haptics from 'expo-haptics';
import React from 'react';
import { Pressable, type PressableProps, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { hit, motion } from '../design/tokens';

interface PressableScaleProps extends PressableProps {
  style?: ViewStyle | ViewStyle[];
  /** applied to the outer Pressable, needed for flex layout in rows */
  containerStyle?: ViewStyle;
  haptic?: boolean;
  children?: React.ReactNode;
}

/**
 * Scale 0.96 on press, never smaller. 44pt hit floor.
 * Every tappable control in the app routes through this.
 */
export function PressableScale({ style, containerStyle, haptic = true, onPressIn, onPressOut, onPress, children, ...rest }: PressableScaleProps) {
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Pressable
      accessibilityRole="button"
      hitSlop={4}
      style={containerStyle}
      {...rest}
      onPressIn={(e) => {
        scale.value = withSpring(motion.pressScale, motion.springFast);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        scale.value = withSpring(1, motion.spring);
        onPressOut?.(e);
      }}
      onPress={(e) => {
        if (haptic) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress?.(e);
      }}
    >
      <Animated.View style={[{ minHeight: hit.min, justifyContent: 'center' }, animated, style]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}
