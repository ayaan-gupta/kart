import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { FadeOut } from 'react-native-reanimated';
import { AnimatedKartLogo } from '../components/AnimatedKartLogo';
import { ReduceTransparencyProvider } from '../components/GlassSurface';
import { color } from '../design/tokens';

/** Brief branded open: the cart rolls in, then the app fades through. */
function LaunchOverlay({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 1150);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <Animated.View exiting={FadeOut.duration(320)} style={styles.launch} pointerEvents="none">
      <AnimatedKartLogo height={62} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  launch: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: color.bg,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
});

export default function RootLayout() {
  const [launching, setLaunching] = useState(true);
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ReduceTransparencyProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerShown: false,
            animation: 'fade',
            contentStyle: { backgroundColor: color.bg },
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="hauls" />
          <Stack.Screen
            name="scan"
            options={{
              presentation: 'fullScreenModal',
              animation: 'slide_from_bottom',
              contentStyle: { backgroundColor: color.feed },
            }}
          />
          <Stack.Screen name="haul/[id]" options={{ animation: 'slide_from_right' }} />
        </Stack>
        {launching ? <LaunchOverlay onDone={() => setLaunching(false)} /> : null}
      </ReduceTransparencyProvider>
    </GestureHandlerRootView>
  );
}
