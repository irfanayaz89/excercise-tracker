import { DeviceMotion } from 'expo-sensors';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { attitudeFromGravity } from '@/engine/attitude';
import type { PhoneAttitude, PhoneOrientation } from '@/engine/types';

export type MotionStatus = 'starting' | 'live' | 'unavailable' | 'denied';

/**
 * Streams phone attitude from the gravity vector, relative to the orientation
 * the user picked (see `attitudeFromGravity`), plus rotation speed so the
 * engine can tell when the phone has settled.
 *
 * If the sensor is missing or permission is denied, nothing is emitted and the
 * engine offers a manual "Phone is set" confirmation instead.
 */
export function usePhoneAttitude(
  enabled: boolean,
  orientation: PhoneOrientation,
  onAttitude: (a: PhoneAttitude) => void,
): MotionStatus {
  const [status, setStatus] = useState<MotionStatus>('starting');
  const cb = useRef(onAttitude);
  useLayoutEffect(() => {
    cb.current = onAttitude;
  });

  useEffect(() => {
    if (!enabled) return;
    let sub: { remove(): void } | null = null;
    let cancelled = false;
    (async () => {
      try {
        const available = await DeviceMotion.isAvailableAsync();
        if (!available) {
          if (!cancelled) setStatus('unavailable');
          return;
        }
        const perm = await DeviceMotion.getPermissionsAsync();
        // Android's motion sensors need no permission (expo-sensors would ask for "physical activity", which isn't needed).
        const granted = Platform.OS === 'android' || perm.granted || (perm.canAskAgain && (await DeviceMotion.requestPermissionsAsync()).granted);
        if (!granted) {
          if (!cancelled) setStatus('denied');
          return;
        }
        if (cancelled) return;
        DeviceMotion.setUpdateInterval(100);
        sub = DeviceMotion.addListener((m) => {
          const g = m.accelerationIncludingGravity;
          if (!g) return;
          const att = attitudeFromGravity(g.x, g.y, g.z, orientation);
          if (!att) return;
          const rr = m.rotationRate;
          const motion = rr ? Math.hypot(rr.alpha ?? 0, rr.beta ?? 0, rr.gamma ?? 0) : 0;
          cb.current({ t: performance.now(), ...att, motionDegPerSec: motion });
        });
        setStatus('live');
      } catch {
        if (!cancelled) setStatus('unavailable');
      }
    })();
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [enabled, orientation]);

  return status;
}
