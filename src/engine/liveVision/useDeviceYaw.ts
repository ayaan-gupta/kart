import { DeviceMotion } from 'expo-sensors';
import { useEffect, useRef, useState } from 'react';

/**
 * The phone's yaw in radians, or null when motion is unavailable or not permitted.
 *
 * `rotation.alpha` is the yaw component of the device attitude. Only yaw is used: guided capture
 * cares which side of the cart the user is standing on, not how the phone is tilted.
 *
 * Sampled at 10Hz. The guide's granularity is a sixty degree sector, so anything faster is
 * spending battery to produce state changes that render identically.
 */
export function useDeviceYaw(active: boolean): number | null {
  const [yaw, setYaw] = useState<number | null>(null);
  // Held in a ref as well so the effect never re-subscribes when the value changes.
  const latest = useRef<number | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let subscription: { remove: () => void } | null = null;

    (async () => {
      const available = await DeviceMotion.isAvailableAsync();
      if (!available || cancelled) return;

      const permission = await DeviceMotion.requestPermissionsAsync();
      if (!permission.granted || cancelled) return;

      DeviceMotion.setUpdateInterval(100);
      subscription = DeviceMotion.addListener((data) => {
        const alpha = data.rotation?.alpha;
        if (typeof alpha !== 'number' || Number.isNaN(alpha)) return;
        latest.current = alpha;
        setYaw(alpha);
      });
    })();

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [active]);

  return yaw;
}
