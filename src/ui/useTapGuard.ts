import { useCallback, useRef } from 'react';

/**
 * Wraps a navigation handler so a quick double tap runs it once. Expo Router
 * does not dedupe pushes, and two session screens would both open the camera.
 */
export function useTapGuard(windowMs = 1000) {
  const last = useRef(0);
  return useCallback(
    (fn: () => void) => () => {
      const now = Date.now();
      if (now - last.current < windowMs) return;
      last.current = now;
      fn();
    },
    [windowMs],
  );
}
