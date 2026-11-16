import type { PhoneOrientation } from './types';

/**
 * Converts the gravity vector (device axes: x right, y up, z out of the
 * screen) into the angles the phone gate checks, relative to the orientation
 * the user picked:
 * - roll: in-plane tilt away from that orientation (0 = level; ±90 = turned
 *   the other way, e.g. portrait when landscape was chosen)
 * - pitch: how far the screen leans back or forward (±90 = lying flat)
 *
 * Roll is signed so the same physical turn reads the same on either
 * landscape side (or portrait upright / upside down). Multiplying by the
 * sign of the "down" axis also cancels iOS vs Android sign conventions,
 * which flip every axis at once.
 */
export function attitudeFromGravity(
  x: number,
  y: number,
  z: number,
  orientation: PhoneOrientation,
): { rollDeg: number; pitchDeg: number } | null {
  if (![x, y, z].every(Number.isFinite)) return null;
  if (!(Math.hypot(x, y, z) > 1)) return null; // free fall or bogus reading
  const rad = 180 / Math.PI;
  const sx = x < 0 ? -1 : 1;
  const sy = y < 0 ? -1 : 1;
  const rollDeg = orientation === 'landscape' ? Math.atan2(y * sx, Math.abs(x)) * rad : Math.atan2(-x * sy, Math.abs(y)) * rad;
  const pitchDeg = Math.atan2(z, Math.hypot(x, y)) * rad;
  return { rollDeg, pitchDeg };
}
