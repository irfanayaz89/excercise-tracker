/// <reference types="jest" />
/**
 * Ways to earn screen time without doing the exercise, found in an audit of
 * the engine (research: miscounts that grant time matter most). Each test is
 * a cheat that used to work.
 */
import { difficultyConfig, DIFFICULTIES, type Difficulty } from '../difficulty';
import { PushupSession, type SessionEvent } from '../session';
import { forearmPlank, hold, levelPhone, rep, sidePlank, timeline, type Segment } from '../testing/synth';
import { pullupSample } from '../testing/pullupSynth';
import { LM, type Exercise, type PoseSample } from '../types';

function make(level: Difficulty, exercise: Exercise = 'pushup') {
  const s = new PushupSession({ config: difficultyConfig(level, { exercise }), exercise });
  const events: SessionEvent[] = [];
  s.subscribe((e) => events.push(e));
  let t = 1000;
  const play = (samples: PoseSample[], motion = 0) => {
    for (const p of samples) {
      s.pushAttitude(levelPhone(p.t, 0, 0, motion));
      s.pushPose(p);
      s.tick(p.t);
      t = p.t;
    }
  };
  const segs = (x: Segment[], motion = 0, mapFrame?: (s: PoseSample, t: number) => PoseSample) =>
    play(timeline(x, { startT: t + 33, mapFrame }), motion);
  return { s, events, segs, play };
}

describe('plank: dipping in and out of form', () => {
  test.each(DIFFICULTIES)('at %s, sagging for most of every second breaks the hold and earns little', (level) => {
    const h = make(level, 'plank');
    h.segs([forearmPlank(3000)]);
    const before = h.s.snapshot().hold!.goodMs;
    const cycle: Segment[] = [];
    for (let i = 0; i < 27; i++) cycle.push(forearmPlank(850, { sag: 0.3 }), forearmPlank(250));
    h.segs(cycle);
    const snap = h.s.snapshot().hold!;
    // ~30 s watched, ~23 s of it sagging: at most the straight moments (~7 s) plus a grace period count.
    expect(snap.goodMs - before).toBeLessThan(12_000);
    expect(snap.breaks).toBeGreaterThan(0);
  });

  test('a side plank that keeps dipping is not time in good form either', () => {
    const h = make('hard', 'sidePlank');
    h.segs([sidePlank(3000)]);
    const cycle: Segment[] = [];
    for (let i = 0; i < 27; i++) cycle.push(sidePlank(850, { sag: 0.3 }), sidePlank(250));
    h.segs(cycle);
    const sides = h.s.snapshot().holdSides ?? {};
    const good = Object.values(sides).reduce<number>((n, x) => n + (typeof x === "number" ? x : 0), 0);
    expect(good).toBeLessThan(15_000);
  });

  test('one short wobble in a long steady plank still costs nothing', () => {
    const h = make('medium', 'plank');
    h.segs([forearmPlank(3000), forearmPlank(10_000), forearmPlank(700, { sag: 0.3 }), forearmPlank(10_000)]);
    expect(h.s.snapshot().hold!.breaks).toBe(0);
  });
});

describe('pull-ups: no bar', () => {
  /** Standing still under no bar, hands lowered from overhead to the mouth and back (k: 0 = overhead, 1 = at the mouth). */
  function airPull(t: number, k: number): PoseSample {
    const sw = 115;
    const W = 720;
    const H = 1280;
    const cx = W / 2;
    const L = 0.8 * sw;
    const shY = 0.12 * H + 1.6 * sw;
    const mouthY = shY - 0.45 * sw;
    const p = pullupSample(t, { rise: 0 });
    const lm = p.landmarks.map((l) => ({ ...l }));
    for (const [S, E, Wr, out] of [
      [LM.leftShoulder, LM.leftElbow, LM.leftWrist, -1],
      [LM.rightShoulder, LM.rightElbow, LM.rightWrist, 1],
    ] as const) {
      const sh = { x: lm[S].x * W, y: lm[S].y * H };
      const w0 = { x: lm[Wr].x * W, y: lm[Wr].y * H };
      const w = { x: cx + out * (0.75 - 0.4 * k) * sw, y: w0.y + k * (mouthY + 0.15 * sw - w0.y) };
      const dx = w.x - sh.x;
      const dy = w.y - sh.y;
      const D = Math.hypot(dx, dy);
      const d = Math.min(2 * L - 1e-6, D);
      const m = { x: sh.x + (dx * d) / D / 2, y: sh.y + (dy * d) / D / 2 };
      const hh = Math.sqrt(Math.max(0, L * L - (d / 2) ** 2));
      const nx = -dy / D;
      const ny = dx / D;
      const sign = nx * out > 0 ? 1 : -1;
      const e = { x: m.x + sign * nx * hh, y: m.y + sign * ny * hh };
      lm[Wr] = { ...lm[Wr], x: w.x / W, y: w.y / H };
      lm[E] = { ...lm[E], x: e.x / W, y: e.y / H };
      for (const i of out < 0 ? [17, 19, 21] : [18, 20, 22]) lm[i] = { ...lm[i], x: w.x / W, y: (w.y - 0.08 * sw) / H };
    }
    return { ...p, landmarks: lm };
  }

  test.each(DIFFICULTIES)('at %s, pulling the hands down to the mouth while standing counts nothing', (level) => {
    const h = make(level, 'pullup');
    let t = 1000;
    const seq: PoseSample[] = [];
    for (let i = 0; i < 90; i++) seq.push(airPull((t += 33), 0));
    for (let r = 0; r < 5; r++)
      for (const [a, b, ms] of [
        [0, 1, 400],
        [1, 1, 1100],
        [1, 0, 900],
        [0, 0, 900],
      ] as const) {
        const n = Math.round(ms / 33);
        for (let i = 1; i <= n; i++) seq.push(airPull((t += 33), a + (b - a) * (i / n)));
      }
    h.play(seq);
    expect(h.s.snapshot().reps).toBe(0);
  });
});

describe('a video shown to a moving phone', () => {
  const shake = (s: PoseSample, t: number): PoseSample => ({
    ...s,
    landmarks: s.landmarks.map((l) => ({
      ...l,
      x: l.x + 0.01 * Math.sin((2 * Math.PI * 3 * t) / 1000),
      y: l.y + 0.006 * Math.cos((2 * Math.PI * 2.3 * t) / 1000),
    })),
  });
  const paused = (h: ReturnType<typeof make>) =>
    h.events.some((e) => e.type === 'cue' && e.cue.kind === 'paused' && e.cue.reason === 'phone-moved');

  test.each([6, 20])('a phone held and turning at %s°/s pauses the set instead of counting the screen', (motion) => {
    const h = make('hard');
    h.segs([hold(2600)]);
    h.segs(Array.from({ length: 10 }, () => rep(1600)), motion, shake);
    expect(paused(h)).toBe(true);
    expect(h.s.snapshot().reps).toBeLessThanOrEqual(1);
  });

  test('a phone lying still never pauses for movement', () => {
    const h = make('hard');
    h.segs([hold(2600)]);
    h.segs(Array.from({ length: 6 }, () => rep(1600)), 1);
    expect(paused(h)).toBe(false);
    expect(h.s.snapshot().reps).toBe(6);
  });
});

describe('push-ups', () => {
  test.each([125, 140])('Hard: knees let down to %s° mid-set still counts, but never as clean', (knee) => {
    const h = make('hard');
    h.segs([hold(2600)]);
    expect(h.s.currentPhase).toBe('counting');
    h.segs(Array.from({ length: 5 }, () => rep(1600, 80, 172, { kneeDeg: knee })));
    const snap = h.s.snapshot();
    expect(snap.cleanReps).toBe(0);
    const faults = h.events.flatMap((e) => (e.type === 'rep' ? e.rep.faults : []));
    expect(faults).toContain('knees-bent');
  });

  test('Easy: small wiggles from a bent-arm start are not reps', () => {
    const h = make('easy');
    h.segs([hold(2000, { elbowDeg: 133 })]);
    h.segs(Array.from({ length: 5 }, () => rep(900, 104, 133)));
    expect(h.s.snapshot().reps).toBe(0);
  });
});
