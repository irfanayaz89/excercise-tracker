/// <reference types="jest" />
/**
 * The guide animation's figure: every frame of every exercise stays inside
 * the camera view, keeps its contact points on the floor, and moves the way
 * the exercise does.
 */
import { EXERCISE_IDS } from '@/engine/exercises';
import { FLOOR_Y, STILL_P, figureAt, figureFrontAt } from '../exerciseMotion';

const frames = (n = 120) => Array.from({ length: n + 1 }, (_, i) => i / n);
const angle = (a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }) => {
  const v1 = Math.atan2(a.y - b.y, a.x - b.x);
  const v2 = Math.atan2(c.y - b.y, c.x - b.x);
  let d = Math.abs(((v1 - v2) * 180) / Math.PI);
  if (d > 180) d = 360 - d;
  return d;
};

describe.each(EXERCISE_IDS)('%s animation', (exercise) => {
  it('stays inside the camera view, with valid paths, on every frame', () => {
    for (const p of frames()) {
      const f = figureAt(exercise, p);
      for (const q of [...Object.values(f.pts), f.head]) {
        expect(Number.isFinite(q.x) && Number.isFinite(q.y)).toBe(true);
        expect(q.x).toBeGreaterThan(10);
        expect(q.x).toBeLessThan(220);
        expect(q.y).toBeGreaterThan(78);
        expect(q.y).toBeLessThanOrEqual(FLOOR_Y);
      }
      expect(f.body).toMatch(/^M[\d. -]+( L[\d. -]+)+$/);
      expect(f.arm).toMatch(/^M[\d. -]+( L[\d. -]+)+$/);
    }
  });

  it('feet stay on the floor', () => {
    for (const p of frames()) expect(FLOOR_Y - figureAt(exercise, p).pts.ankle.y).toBeLessThan(6);
  });

  it('loops without a jump (the side plank swaps sides while lying down) and has a still frame', () => {
    const start = figureAt(exercise, 0).pts;
    const end = figureAt(exercise, 0.9999).pts;
    for (const k of Object.keys(start)) {
      const e = exercise === 'sidePlank' ? { x: 228 - end[k].x, y: end[k].y } : end[k];
      expect(Math.hypot(start[k].x - e.x, start[k].y - e.y)).toBeLessThan(0.5);
    }
    expect(figureAt(exercise, STILL_P[exercise]).body).toBeTruthy();
  });
});

describe('the movements', () => {
  it('push-up: elbows lock at the top and reach about 85° at the bottom', () => {
    const ang = frames().map((p) => {
      const f = figureAt('pushup', p);
      return angle(f.pts.shoulder, f.pts.elbow, f.pts.wrist);
    });
    expect(Math.max(...ang)).toBeGreaterThan(168);
    expect(Math.min(...ang)).toBeLessThan(90);
    expect(Math.min(...ang)).toBeGreaterThan(80);
  });

  it('crunch: shoulders lift about 30° about the hips, the hips and feet stay down', () => {
    const lifts = frames().map((p) => {
      const f = figureAt('crunch', p);
      return (Math.atan2(f.pts.hip.y - f.pts.shoulder.y, f.pts.hip.x - f.pts.shoulder.x) * 180) / Math.PI;
    });
    expect(Math.min(...lifts)).toBeLessThan(4);
    expect(Math.max(...lifts)).toBeGreaterThan(28);
    expect(Math.max(...lifts)).toBeLessThan(36);
    const hips = frames().map((p) => figureAt('crunch', p).pts.hip.y);
    expect(Math.max(...hips) - Math.min(...hips)).toBe(0);
  });

  it('plank: the hips stay in line with shoulders and heels', () => {
    for (const p of frames()) {
      const f = figureAt('plank', p);
      const { shoulder: s, hip: h, ankle: a } = f.pts;
      const lineY = s.y + ((h.x - s.x) / (a.x - s.x)) * (a.y - s.y);
      expect(Math.abs(h.y - lineY)).toBeLessThan(3);
    }
  });

  it('side plank: hips lift into line, then the other side is held (mirrored)', () => {
    const left = figureAt('sidePlank', 0.2);
    const right = figureAt('sidePlank', 0.7);
    expect(left.pts.shoulder.x).toBeLessThan(114);
    expect(right.pts.shoulder.x).toBeGreaterThan(114);
    expect(right.pts.shoulder.x).toBeCloseTo(228 - left.pts.shoulder.x, 5);
    // Lifted mid-hold, down on the floor between sides.
    expect(FLOOR_Y - figureAt('sidePlank', 0.2).pts.hip.y).toBeGreaterThan(12);
    expect(FLOOR_Y - figureAt('sidePlank', 0.47).pts.hip.y).toBeLessThan(7);
    expect(left.extra).toMatch(/^M/);
  });
});

describe('head-on figures (front view)', () => {
  it.each(['pushup', 'plank'] as const)('%s stays in the camera view and draws both sides', (e) => {
    for (const p of frames()) {
      const f = figureFrontAt(e, p);
      for (const q of [...Object.values(f.pts), f.head]) {
        expect(q.x).toBeGreaterThan(10);
        expect(q.x).toBeLessThan(220);
        expect(q.y).toBeGreaterThan(60);
        expect(q.y).toBeLessThanOrEqual(FLOOR_Y);
      }
      expect(f.arm).toMatch(/^M/);
      expect(f.extra).toMatch(/^M/);
    }
  });

  it('push-ups go down and up; the plank holds still; hands stay on the floor', () => {
    const sh = frames().map((p) => figureFrontAt('pushup', p).pts.shoulder.y);
    expect(Math.max(...sh) - Math.min(...sh)).toBeGreaterThan(30);
    const pl = frames().map((p) => figureFrontAt('plank', p).pts.shoulder.y);
    expect(Math.max(...pl) - Math.min(...pl)).toBeLessThan(3);
    for (const p of frames()) expect(FLOOR_Y - figureFrontAt('pushup', p).pts.wrist.y).toBeLessThan(3);
  });
});
