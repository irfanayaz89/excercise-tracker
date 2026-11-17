import type { Exercise } from '@/engine/types';

/**
 * Figure poses for the guide animation: a stick figure doing each exercise as
 * the phone sees it (side-on; facing it for the side plank). Pure functions of
 * progress 0..1 through one loop, marked as worklets so they run on the UI
 * thread every frame. Drawn in the animation's box (320 wide, y 44–160): the
 * camera view spans x 8–222 and y 60–152, the floor is at y 142.
 */

export interface P {
  x: number;
  y: number;
}

export interface Figure {
  /** Joints, for tests. */
  pts: Record<string, P>;
  /** Trunk and legs. */
  body: string;
  /** Near arm. */
  arm: string;
  /** Side plank: the top arm. Empty path otherwise. */
  extra: string;
  head: P;
}

export const FLOOR_Y = 142;

/** One loop of the animation, in ms: a rep, a few breaths, or both sides of a side plank. */
export const MOTION_MS: Record<Exercise, number> = {
  pushup: 2600,
  crunch: 3000,
  plank: 4000,
  sidePlank: 12000,
};

function ease(x: number): number {
  'worklet';
  const c = x < 0 ? 0 : x > 1 ? 1 : x;
  return (1 - Math.cos(Math.PI * c)) / 2;
}

/** 0 → 1 → 0 over a loop, with a short pause at both ends. */
function repWave(p: number): number {
  'worklet';
  if (p < 0.1) return 0;
  if (p < 0.45) return ease((p - 0.1) / 0.35);
  if (p < 0.55) return 1;
  if (p < 0.9) return 1 - ease((p - 0.55) / 0.35);
  return 0;
}

function pt(p: P): string {
  'worklet';
  return `${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
}

function line(ps: P[]): string {
  'worklet';
  let d = `M${pt(ps[0])}`;
  for (let i = 1; i < ps.length; i++) d += ` L${pt(ps[i])}`;
  return d;
}

/** Push-up: elbows from locked (172°) to about 85° and back. */
function pushup(p: number): Figure {
  'worklet';
  const w = repWave(p);
  const U = 27.6;
  const F = 24.8;
  const th = ((172 - 87 * w) * Math.PI) / 180;
  const d = Math.sqrt(U * U + F * F - 2 * U * F * Math.cos(th));
  const wrist = { x: 40, y: FLOOR_Y };
  const shoulder = { x: 40, y: FLOOR_Y - d };
  const a = (U * U - F * F + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, U * U - a * a));
  const elbow = { x: 40 + h, y: FLOOR_Y - d + a };
  const ankle = { x: 206, y: FLOOR_Y - 3 };
  const hip = { x: shoulder.x + 0.36 * (ankle.x - shoulder.x), y: shoulder.y + 0.36 * (ankle.y - shoulder.y) };
  const len = Math.hypot(ankle.x - shoulder.x, ankle.y - shoulder.y);
  const ux = (ankle.x - shoulder.x) / len;
  const uy = (ankle.y - shoulder.y) / len;
  const head = { x: shoulder.x - ux * 12, y: shoulder.y - uy * 12 - 3 };
  return {
    pts: { shoulder, elbow, wrist, hip, ankle },
    body: line([shoulder, hip, ankle]),
    arm: line([shoulder, elbow, wrist]),
    extra: '',
    head,
  };
}

/** Crunch: shoulders curl up about 30° about the hips, pause, and lower. */
function crunch(p: number): Figure {
  'worklet';
  const c = repWave(p);
  const L = ((2 + 30 * c) * Math.PI) / 180;
  const T = 46 * (1 - 0.1 * c);
  const hip = { x: 118, y: FLOOR_Y - 6 };
  const shoulder = { x: hip.x - T * Math.cos(L), y: hip.y - T * Math.sin(L) };
  const knee = { x: 146, y: FLOOR_Y - 34 };
  const ankle = { x: 170, y: FLOOR_Y - 3 };
  const toe = { x: 178, y: FLOOR_Y - 2 };
  const ux = (hip.x - shoulder.x) / T;
  const uy = (hip.y - shoulder.y) / T;
  // Up from the trunk (away from the floor).
  const nx = uy;
  const ny = -ux;
  const hand = { x: shoulder.x + ux * 26 + nx * 7, y: shoulder.y + uy * 26 + ny * 7 };
  const head = { x: shoulder.x - ux * 12 + nx * 3, y: shoulder.y - uy * 12 + ny * 3 };
  return {
    pts: { shoulder, hip, knee, ankle, hand },
    body: line([shoulder, hip, knee, ankle, toe]),
    arm: line([shoulder, hand]),
    extra: '',
    head,
  };
}

/** Forearm plank: held still, breathing. */
function plank(p: number): Figure {
  'worklet';
  const b = Math.sin(2 * Math.PI * p);
  const shoulder = { x: 42, y: FLOOR_Y - 24 };
  const elbow = { x: 43, y: FLOOR_Y - 2 };
  const wrist = { x: 22, y: FLOOR_Y - 2 };
  const ankle = { x: 206, y: FLOOR_Y - 4 };
  const hip = { x: 122, y: FLOOR_Y - 14 + 0.8 * b };
  return {
    pts: { shoulder, elbow, wrist, hip, ankle },
    body: line([shoulder, hip, ankle]),
    arm: line([shoulder, elbow, wrist]),
    extra: '',
    head: { x: 30, y: FLOOR_Y - 29 + 0.3 * b },
  };
}

/**
 * Side plank, facing the phone: hips lift, hold, lower; then the other side
 * (the picture mirrors). First half of the loop is the left side.
 */
function sidePlank(p: number): Figure {
  'worklet';
  const second = p >= 0.5;
  const k = second ? (p - 0.5) * 2 : p * 2;
  const h = k < 0.12 ? ease(k / 0.12) : k < 0.7 ? 1 : k < 0.82 ? 1 - ease((k - 0.7) / 0.12) : 0;
  const shoulder = { x: 44, y: FLOOR_Y - 28 };
  const elbow = { x: 42, y: FLOOR_Y - 2 };
  const ankle = { x: 206, y: FLOOR_Y - 3 };
  const lineY = shoulder.y + ((124 - shoulder.x) / (ankle.x - shoulder.x)) * (ankle.y - shoulder.y);
  const floorHip = FLOOR_Y - 5;
  const hip = { x: 124, y: floorHip - (floorHip - lineY) * h };
  const hand = { x: shoulder.x - 2, y: shoulder.y - 6 - 24 * h };
  const head = { x: 32, y: FLOOR_Y - 33 };
  const m = (q: P): P => (second ? { x: 228 - q.x, y: q.y } : q);
  const S = m(shoulder);
  return {
    pts: { shoulder: S, elbow: m(elbow), hip: m(hip), ankle: m(ankle), hand: m(hand) },
    body: line([S, m(hip), m(ankle)]),
    arm: line([S, m(elbow)]),
    extra: line([S, m(hand)]),
    head: m(head),
  };
}

export function figureAt(exercise: Exercise, p: number): Figure {
  'worklet';
  switch (exercise) {
    case 'pushup':
      return pushup(p);
    case 'crunch':
      return crunch(p);
    case 'plank':
      return plank(p);
    case 'sidePlank':
      return sidePlank(p);
  }
}

/** A still frame for reduced motion: the exercise's working position. */
export const STILL_P: Record<Exercise, number> = { pushup: 0.5, crunch: 0.5, plank: 0.25, sidePlank: 0.3 };
