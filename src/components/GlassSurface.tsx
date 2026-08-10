import { BlurView } from 'expo-blur';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import React, { createContext, useContext, useEffect, useState } from 'react';
import { AccessibilityInfo, Platform, StyleSheet, View, type ViewProps } from 'react-native';
import { color, shadow } from '../design/tokens';

/**
 * Floating glass chrome with three tiers:
 *   1. iOS 26+: genuine Liquid Glass
 *   2. Older iOS / Android: backdrop blur with a hairline edge
 *   3. Reduce Transparency: flat opaque fill, zero blur, full contrast
 */

const ReduceTransparencyContext = createContext(false);

export function ReduceTransparencyProvider({ children }: { children: React.ReactNode }) {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let alive = true;
    if (Platform.OS === 'ios') {
      AccessibilityInfo.isReduceTransparencyEnabled().then((v) => alive && setReduced(v));
      const sub = AccessibilityInfo.addEventListener('reduceTransparencyChanged', setReduced);
      return () => {
        alive = false;
        sub.remove();
      };
    }
    return () => {
      alive = false;
    };
  }, []);
  return (
    <ReduceTransparencyContext.Provider value={reduced}>
      {children}
    </ReduceTransparencyContext.Provider>
  );
}

export const useReduceTransparency = () => useContext(ReduceTransparencyContext);

interface GlassSurfaceProps extends ViewProps {
  radius: number;
  /** light glass over content, dark glass over the scan feed */
  scheme?: 'light' | 'dark';
  floating?: boolean;
  children?: React.ReactNode;
}

export function GlassSurface({
  radius,
  scheme = 'light',
  floating = true,
  style,
  children,
  ...rest
}: GlassSurfaceProps) {
  const reduced = useReduceTransparency();
  const lift = floating ? shadow.float : shadow.raise;
  const dark = scheme === 'dark';
  const tint = dark ? color.glassDark : color.glassLight;
  const fallback = dark ? '#1A1D22' : color.surface;
  const edge = dark ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.85)';

  if (reduced) {
    return (
      <View
        {...rest}
        style={[{ borderRadius: radius, backgroundColor: fallback, overflow: 'hidden' }, lift, style]}
      >
        {children}
      </View>
    );
  }

  if (isLiquidGlassAvailable()) {
    return (
      <View {...rest} style={[{ borderRadius: radius }, lift, style]}>
        <GlassView
          glassEffectStyle="regular"
          colorScheme={dark ? 'dark' : 'light'}
          tintColor={tint}
          style={[StyleSheet.absoluteFill, { borderRadius: radius }]}
        />
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { borderRadius: radius, borderWidth: StyleSheet.hairlineWidth, borderColor: edge },
          ]}
        />
        <View style={{ borderRadius: radius, overflow: 'hidden' }}>{children}</View>
      </View>
    );
  }

  return (
    <View {...rest} style={[{ borderRadius: radius }, lift, style]}>
      <View style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: 'hidden' }]}>
        <BlurView intensity={40} tint={dark ? 'dark' : 'extraLight'} style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: tint }]} />
      </View>
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          { borderRadius: radius, borderWidth: StyleSheet.hairlineWidth, borderColor: edge },
        ]}
      />
      <View style={{ borderRadius: radius, overflow: 'hidden' }}>{children}</View>
    </View>
  );
}
