import type { Vec2 } from './types';

/** Angle ABC at vertex B in degrees (0..180). Returns null for degenerate input. */
export function angleDeg(a: Vec2, b: Vec2, c: Vec2): number | null {
  const abx = a.x - b.x;
  const aby = a.y - b.y;
  const cbx = c.x - b.x;
  const cby = c.y - b.y;
  const n1 = Math.hypot(abx, aby);
  const n2 = Math.hypot(cbx, cby);
  if (n1 < 1e-6 || n2 < 1e-6) return null;
  const cos = clamp((abx * cbx + aby * cby) / (n1 * n2), -1, 1);
  return (Math.acos(cos) * 180) / Math.PI;
}

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Signed perpendicular distance of point P from the line A→B, positive when P
 * is below the line in image space (y grows downward), regardless of which
 * way the user faces.
 */
export function signedOffsetBelowLine(a: Vec2, b: Vec2, p: Vec2): number | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return null;
  // Cross product gives a signed distance; orient it so "down" is positive.
  let d = ((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
  // Unit normal (dy, -dx)/len points "down" only when dx < 0. Flip when needed.
  if (dx > 0) d = -d;
  return d;
}

/** Angle of the line A→B from horizontal in degrees (0..90), ignoring direction. */
export function tiltFromHorizontalDeg(a: Vec2, b: Vec2): number | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.hypot(dx, dy) < 1e-6) return null;
  const deg = Math.abs((Math.atan2(dy, dx) * 180) / Math.PI);
  return deg > 90 ? 180 - deg : deg;
}

/** Signed angle of the line A→B from horizontal in degrees (-90..90). */
export function signedTiltDeg(a: Vec2, b: Vec2): number | null {
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  if (Math.hypot(dx, dy) < 1e-6) return null;
  if (dx < 0) {
    dx = -dx;
    dy = -dy;
  }
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
