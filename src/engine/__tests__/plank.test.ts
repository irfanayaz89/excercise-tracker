/// <reference types="jest" />
/**
 * The plank exercise: start check (high and forearm), the hold timer's rules,
 * and whole sessions at every level, in both phone orientations, facing
 * either way, with real-camera noise.
 */
import { difficultyConfig, DIFFICULTIES, type Difficulty } from '../difficulty';
import { checkPlank } from '../gates';
import { HoldTimer, type HoldEvent } from '../holdTimer';
import { forearmPlank, hold, plank, rep, type BodyParams, type TimelineOptions } from '../testing/synth';
import { LM, type BodyMetrics, type PoseSample } from '../types';
import { harness, type Harness } from './helpers';

const PORTRAIT: Partial<BodyParams> = { width: 720, height: 1280, torsoPx: 130, floorY: 1280 * 0.7 };
const FRAMES = { landscape: {} as Partial<BodyParams>, portrait: PORTRAIT };

const cfgFor = (level: Difficulty) => difficultyConfig(level, { exercise: 'plank' });

function make(level: Difficulty, base: Partial<BodyParams> = {}, extra: { targetHoldMs?: number; endOnBreak?: boolean } = {}): Harness {
  const config = cfgFor(level);
  if (extra.endOnBreak) config.hold = { ...config.hold, endOnBreak: true };
  return harness({ config, base, exercise: 'plank', targetHoldMs: extra.targetHoldMs });
}

const snap = (h: Harness) => h.session.snapshot();
const good = (h: Harness) => snap(h).hold?.goodMs ?? 0;
const holdCues = (h: Harness, state: 'warning' | 'break') =>
  h.events.filter((e) => e.type === 'cue' && e.cue.kind === 'hold' && e.cue.state === state);

/** Every 8th frame the near hip and knee jump, as measured on a real iPhone. */
const spikes: TimelineOptions['mapFrame'] = (s: PoseSample, t: number) => {
  if (Math.round(t / 33.333) % 8 !== 0 || s.landmarks.length === 0) return s;
  const lms = s.landmarks.map((l) => ({ ...l }));
  for (const i of [LM.leftHip, LM.rightHip]) lms[i].y += 0.16;
  for (const i of [LM.leftKnee, LM.rightKnee]) lms[i].y -= 0.12;
  return { ...s, landmarks: lms };
};

// ─── Start check ─────────────────────────────────────────────────────────────

const METRICS: BodyMetrics = {
  t: 0,
  side: 'left',
  elbowDeg: 172,
  bodyLineDeg: 180,
  hipOffset: 0,
  kneeDeg: 178,
  neckDeg: 160,
  trunkTiltDeg: 20,
  shoulderHeight: 1,
  wristOffset: 0.05,
  elbowStack: 0.04,
  forearmRise: 0.53,
  torsoPx: 240,
  hipCenter: { x: 0.5, y: 0.6 },
};
const FOREARM: Partial<BodyMetrics> = { elbowDeg: 90, forearmRise: 0.02, elbowStack: 0.05, shoulderHeight: 0.6, trunkTiltDeg: 11 };

describe('plank start check', () => {
  const hard = cfgFor('hard');

  it('accepts a high plank and a forearm plank for the plank exercise', () => {
    expect(checkPlank(METRICS, hard, 'plank')).toEqual({ ok: true, issues: [], variant: 'high' });
    expect(checkPlank({ ...METRICS, ...FOREARM }, hard, 'plank')).toEqual({ ok: true, issues: [], variant: 'forearm' });
  });

  it('push-ups never start from a forearm plank', () => {
    const r = checkPlank({ ...METRICS, ...FOREARM }, difficultyConfig('hard'), 'pushup');
    expect(r.ok).toBe(false);
    expect(r.issues).toContain('straighten-arms');
    expect(r.variant).toBe('high');
  });

  it('a push-up bottom (forearm upright) is not a forearm plank', () => {
    const r = checkPlank({ ...METRICS, elbowDeg: 85, forearmRise: 0.34, elbowStack: 0.42 }, hard, 'plank');
    expect(r.variant).toBe('high');
    expect(r.issues).toContain('straighten-arms');
  });

  it('asks for elbows under the shoulders when they are far off', () => {
    const r = checkPlank({ ...METRICS, ...FOREARM, elbowStack: 0.5 }, hard, 'plank');
    expect(r.issues).toEqual(['elbows-under-shoulders']);
  });

  it('will not start a hold that already breaks the hip limits', () => {
    expect(checkPlank({ ...METRICS, hipOffset: 0.13, bodyLineDeg: 169 }, hard, 'plank').issues).toEqual(['hips-sagging']);
    expect(checkPlank({ ...METRICS, hipOffset: -0.15, bodyLineDeg: 168 }, hard, 'plank').issues).toEqual(['hips-high']);
    // Easy is wider.
    expect(checkPlank({ ...METRICS, hipOffset: 0.13, bodyLineDeg: 169 }, cfgFor('easy'), 'plank').ok).toBe(true);
  });
});

// ─── Hold timer rules ────────────────────────────────────────────────────────

/** Feeds metrics every 33 ms from `from` to `to`; returns the events. */
function feed(
  timer: HoldTimer,
  from: number,
  to: number,
  over: Partial<BodyMetrics> | ((t: number) => Partial<BodyMetrics>) = {},
  base: Partial<BodyMetrics> = {},
): HoldEvent[] {
  const out: HoldEvent[] = [];
  for (let t = from; t <= to; t += 33) {
    const o = typeof over === 'function' ? over(t) : over;
    const ev = timer.update({ ...METRICS, ...base, ...o, t });
    if (ev) out.push(ev);
  }
  return out;
}

describe('HoldTimer', () => {
  const hard = cfgFor('hard');

  it('counts all the time while form is good', () => {
    const tm = new HoldTimer(hard, { hipOffset: 0 });
    expect(feed(tm, 0, 10000)).toEqual([]);
    const s = tm.summary();
    expect(s.goodMs).toBeGreaterThan(9900);
    expect(s.goodMs).toBe(s.totalMs);
    expect(s.breaks).toBe(0);
    expect(s.formPct).toBe(1);
  });

  it('ignores a fault shorter than the grace period, and counts that time', () => {
    const tm = new HoldTimer(hard, { hipOffset: 0 });
    const evs = feed(tm, 0, 6000, (t) => (t > 2000 && t < 2700 ? { hipOffset: 0.2, bodyLineDeg: 162 } : {}));
    expect(evs.map((e) => e.type)).toEqual(['warning']);
    expect(tm.summary().breaks).toBe(0);
    expect(tm.summary().goodMs).toBe(tm.summary().totalMs);
  });

  it('stops the clock after the grace period and does not count the grace either', () => {
    const tm = new HoldTimer(hard, { hipOffset: 0 });
    const evs = feed(tm, 0, 10000, (t) => (t > 3000 && t < 6000 ? { hipOffset: 0.2, bodyLineDeg: 162 } : {}));
    expect(evs.map((e) => e.type)).toEqual(['warning', 'break', 'restored']);
    const s = tm.summary();
    expect(s.breaks).toBe(1);
    // 3 s of sag plus the 0.5 s needed to restore are not good time.
    expect(s.totalMs - s.goodMs).toBeGreaterThan(3300);
    expect(s.totalMs - s.goodMs).toBeLessThan(3700);
    expect(s.faultMs['hips-sagging']).toBeGreaterThan(2900);
    expect(s.longestMs).toBeGreaterThan(3400);
    expect(s.longestMs).toBeLessThan(4100);
  });

  it('a confirmed fault is announced as the right kind', () => {
    const pike = new HoldTimer(hard, { hipOffset: 0 });
    const evs = feed(pike, 0, 3000, { hipOffset: -0.2, bodyLineDeg: 163 });
    expect(evs.find((e) => e.type === 'break')).toMatchObject({ fault: 'hips-piking' });
  });

  it('warns early, with the clock still running, when the hips drift towards the limit', () => {
    const tm = new HoldTimer(hard, { hipOffset: 0 });
    const evs = feed(tm, 0, 4000, (t) => (t > 1000 ? { hipOffset: 0.07 } : {}));
    expect(evs).toEqual([expect.objectContaining({ type: 'warning', fault: 'hips-sagging' })]);
    expect(tm.summary().goodMs).toBe(tm.summary().totalMs);
    expect(tm.currentState).toBe('warning');
  });

  it('warns about hips slowly sinking before they reach the warning line', () => {
    const tm = new HoldTimer(hard, { hipOffset: 0 });
    // 0.02 → 0.055 over 1.4 s (0.025/s) stays under the 0.06 warning line.
    const evs = feed(tm, 0, 4500, (t) => ({ hipOffset: t < 2600 ? 0.02 : Math.min(0.055, 0.02 + ((t - 2600) / 1000) * 0.025) }));
    expect(evs.filter((e) => e.type === 'warning')).toHaveLength(1);
    expect(tm.summary().breaks).toBe(0);
  });

  it('measures drift from the user\'s own start, not only from the fixed limit', () => {
    // Started piked at −0.05 (the camera angle makes a straight body read like this); now 0.07.
    const tm = new HoldTimer(hard, { hipOffset: -0.05 });
    const evs = feed(tm, 0, 3000, { hipOffset: 0.07 });
    expect(evs.find((e) => e.type === 'break')).toMatchObject({ fault: 'hips-sagging' });
    // Started at 0, the same 0.07 is only a warning.
    const fresh = new HoldTimer(hard, { hipOffset: 0 });
    expect(feed(fresh, 0, 3000, { hipOffset: 0.07 }).map((e) => e.type)).toEqual(['warning']);
  });

  it('getting straighter from a piked start is never a fault', () => {
    const tm = new HoldTimer(hard, { hipOffset: -0.1 });
    expect(feed(tm, 0, 3000, { hipOffset: 0.02 })).toEqual([]);
  });

  it('flags bent arms in a high plank and elbows out of place in a forearm plank', () => {
    const high = new HoldTimer(hard, { hipOffset: 0 });
    expect(feed(high, 0, 2000, { elbowDeg: 120 }).find((e) => e.type === 'break')).toMatchObject({ fault: 'arms-bent' });
    const fore = new HoldTimer(hard, { hipOffset: 0 }, 'forearm');
    expect(feed(fore, 0, 2000, {}, FOREARM)).toEqual([]);
    expect(feed(fore, 2033, 4000, { elbowStack: 0.5, elbowDeg: 55 }, FOREARM).find((e) => e.type === 'break')).toMatchObject({
      fault: 'elbows-under-shoulders',
    });
  });

  it('switching from a high plank to forearms mid-hold is allowed', () => {
    const tm = new HoldTimer(hard, { hipOffset: 0 });
    feed(tm, 0, 3000);
    // About 0.6 s through bent arms on the way down: inside the grace period.
    feed(tm, 3033, 3600, { elbowDeg: 120 });
    expect(feed(tm, 3633, 8000, {}, FOREARM)).toEqual([]);
    expect(tm.summary().breaks).toBe(0);
  });

  it('knees down or standing up counts as dropping out of the plank', () => {
    const tm = new HoldTimer(hard, { hipOffset: 0 });
    expect(feed(tm, 0, 2000, { kneeDeg: 95 }).find((e) => e.type === 'break')).toMatchObject({ fault: 'dropped' });
    const easy = new HoldTimer(cfgFor('easy'), { hipOffset: 0 });
    expect(feed(easy, 0, 3000, { kneeDeg: 95 })).toEqual([]); // knee planks are fine on Easy
  });

  it('a dropped head is a hint, never a break', () => {
    const tm = new HoldTimer(hard, { hipOffset: 0 });
    expect(feed(tm, 0, 4000, { neckDeg: 120 })).toEqual([]);
    expect(tm.summary().headDownMs).toBeGreaterThan(3900);
    expect(tm.summary().breaks).toBe(0);
  });

  it('unknown readings (no feet in view) never break the hold', () => {
    const tm = new HoldTimer(cfgFor('easy'), { hipOffset: null });
    expect(feed(tm, 0, 4000, { hipOffset: null, bodyLineDeg: null, kneeDeg: null })).toEqual([]);
    expect(tm.summary().goodMs).toBeGreaterThan(3900);
  });

  it('does not count time it did not watch', () => {
    const tm = new HoldTimer(hard, { hipOffset: 0 });
    feed(tm, 0, 2000);
    feed(tm, 6000, 8000); // a 4 s gap with no frames
    expect(tm.summary().totalMs).toBeLessThan(4100);
  });

  it('keeps totals across a pause and restart, but starts a new unbroken stretch', () => {
    const tm = new HoldTimer(hard, { hipOffset: 0 });
    feed(tm, 0, 5000);
    tm.pause();
    tm.restart({ hipOffset: 0.02 });
    feed(tm, 9000, 12000);
    const s = tm.summary();
    expect(s.goodMs).toBeGreaterThan(7800);
    expect(s.longestMs).toBeLessThan(5100);
  });

  it('the line gauge reads 0 on the line and ±1 at the limits', () => {
    const tm = new HoldTimer(hard, { hipOffset: 0 });
    tm.update({ ...METRICS, t: 0, hipOffset: 0.1 });
    expect(tm.snapshot().line).toBeCloseTo(1);
    tm.update({ ...METRICS, t: 33, hipOffset: -0.06 });
    expect(tm.snapshot().line).toBeCloseTo(-0.5);
  });
});

// ─── Whole sessions ──────────────────────────────────────────────────────────

describe.each(DIFFICULTIES)('plank, %s', (level) => {
  const cfg = cfgFor(level);
  const sag = cfg.hold.sagFault * 1.8;

  describe.each(Object.keys(FRAMES) as (keyof typeof FRAMES)[])('%s frame', (frame) => {
    it.each(['left', 'right'] as const)('times a steady high plank facing %s', (facing) => {
      const h = make(level, { ...FRAMES[frame], facing, noisePx: 2 });
      h.segments([plank(20000)]);
      const s = snap(h);
      expect(s.phase).toBe('counting');
      expect(s.hold?.variant).toBe('high');
      expect(s.hold?.breaks).toBe(0);
      // Setup (phone settle + start hold) takes up to ~2.5 s of the 20.
      expect(good(h)).toBeGreaterThan(17000);
      expect(good(h)).toBeLessThan(20000);
      expect(h.cues('hold-time').map((e) => e.type === 'cue' && e.cue.kind === 'hold-time' && e.cue.seconds)).toEqual([15]);
      expect(h.cues('hold')).toHaveLength(0);
    });

    it('times a forearm plank', () => {
      const h = make(level, { ...FRAMES[frame], noisePx: 2 });
      h.segments([forearmPlank(12000)]);
      expect(snap(h).hold?.variant).toBe('forearm');
      expect(snap(h).hold?.breaks).toBe(0);
      expect(good(h)).toBeGreaterThan(9000);
    });

    it('stops the clock while the hips sag, and starts it again when fixed', () => {
      const h = make(level, FRAMES[frame]);
      h.segments([plank(8000)]);
      const before = good(h);
      h.segments([plank(4000, { sag })]);
      const during = good(h);
      expect(during - before).toBeLessThan(cfg.hold.graceMs + 600);
      expect(snap(h).hold?.state).toBe('broken');
      expect(holdCues(h, 'break')).toHaveLength(1);
      h.segments([plank(5000)]);
      expect(snap(h).hold?.state).toBe('good');
      expect(good(h) - during).toBeGreaterThan(4000);
      expect(h.cues('hold-restored')).toHaveLength(1);
      expect(snap(h).phase).toBe('counting');
    });
  });

  it('a short wobble inside the grace period costs nothing', () => {
    const h = make(level);
    h.segments([plank(6000), plank(Math.min(400, cfg.hold.graceMs - 500), { sag }), plank(6000)]);
    expect(snap(h).hold?.breaks).toBe(0);
    expect(snap(h).hold?.totalMs).toBe(good(h));
  });

  it('single misread frames from a real camera do not break the hold', () => {
    const h = make(level, { noisePx: 3 });
    h.segments([plank(25000)], { mapFrame: spikes });
    expect(snap(h).phase).toBe('counting');
    expect(snap(h).hold?.breaks).toBe(0);
    expect(holdCues(h, 'break')).toHaveLength(0);
    // Not even a warning: the coach must not nag about joints the camera misread.
    expect(holdCues(h, 'warning')).toHaveLength(0);
  });

  it('still catches a real sag through the same noise', () => {
    const h = make(level, { noisePx: 3 });
    h.segments([plank(6000), plank(4000, { sag }), plank(3000)], { mapFrame: spikes });
    expect(snap(h).hold?.breaks).toBe(1);
  });

  it('pauses when the user stands up and keeps the time for when they come back', () => {
    const h = make(level);
    h.segments([plank(10000)]);
    const before = good(h);
    // Gradual, as a real person stands (a one-frame jump reads as someone else).
    h.segments([plank(1500, (k) => ({ bodyTiltDeg: 80 * k })), plank(3000, { bodyTiltDeg: 80 })]);
    expect(snap(h).phase).toBe('paused');
    expect(snap(h).pauseReason).toBe('left-position');
    h.segments([plank(1500, (k) => ({ bodyTiltDeg: 80 * (1 - k) })), plank(6000)]);
    expect(snap(h).phase).toBe('counting');
    expect(good(h)).toBeGreaterThan(before + 3500);
  });

  it('ends at the target, counting down the last seconds', () => {
    const h = make(level, {}, { targetHoldMs: 20000 });
    h.segments([plank(30000)]);
    expect(snap(h).phase).toBe('ended');
    const summary = h.events.find((e) => e.type === 'ended');
    expect(summary?.type === 'ended' && summary.summary.endReason).toBe('target');
    expect(summary?.type === 'ended' && summary.summary.hold?.goodMs).toBeGreaterThanOrEqual(20000);
    const counts = h.events.flatMap((e) => (e.type === 'cue' && e.cue.kind === 'hold-countdown' ? [e.cue.seconds] : []));
    expect(counts).toEqual([5, 4, 3, 2, 1]);
  });

  it('test mode ends the hold at the first real form break', () => {
    const h = make(level, {}, { endOnBreak: true });
    h.segments([plank(8000), plank(4000, { sag }), plank(3000)]);
    expect(snap(h).phase).toBe('ended');
    const ended = h.events.find((e) => e.type === 'ended');
    expect(ended?.type === 'ended' && ended.summary.endReason).toBe('form-break');
    expect(ended?.type === 'ended' && ended.summary.exercise).toBe('plank');
  });

  it('never counts push-up reps during a plank', () => {
    const h = make(level);
    h.segments([plank(3000), rep(1600), rep(1600), plank(2000)]);
    expect(h.reps()).toBe(0);
  });
});

describe('plank, level differences', () => {
  it('knees down: fine on Easy, a break then a pause on Medium and Hard', () => {
    const easy = make('easy');
    easy.segments([plank(4000), plank(6000, { kneeDeg: 100 })]);
    expect(snap(easy).phase).toBe('counting');
    expect(snap(easy).hold?.breaks).toBe(0);
    for (const level of ['medium', 'hard'] as const) {
      const h = make(level);
      h.segments([plank(4000), plank(6000, { kneeDeg: 100 })]);
      expect(snap(h).phase).toBe('paused');
      expect(snap(h).pauseReason).toBe('left-position');
    }
  });

  it('Easy times a plank with the feet out of view; Medium and Hard ask for the feet', () => {
    const easy = make('easy', { hide: { ankle: 0.05, knee: 0.05 } });
    easy.segments([plank(8000)]);
    expect(snap(easy).phase).toBe('counting');
    expect(good(easy)).toBeGreaterThan(6000);
    for (const level of ['medium', 'hard'] as const) {
      const h = make(level, { hide: { ankle: 0.05 } });
      h.segments([plank(5000)]);
      expect(snap(h).phase).toBe('body-check');
      expect(snap(h).framing.issue).toBe('show-feet');
    }
  });

  it('a sag that breaks Hard is only a warning on Easy', () => {
    const hard = make('hard');
    hard.segments([plank(5000), plank(4000, { sag: 0.14 })]);
    expect(snap(hard).hold?.breaks).toBe(1);
    const easy = make('easy');
    easy.segments([plank(5000), plank(4000, { sag: 0.14 })]);
    expect(snap(easy).hold?.breaks).toBe(0);
    expect(holdCues(easy, 'warning').length).toBeGreaterThan(0);
  });

  it('push-up sessions are unchanged: a forearm plank never starts counting', () => {
    const h = harness({ config: difficultyConfig('hard') });
    h.segments([forearmPlank(5000)]);
    expect(snap(h).phase).toBe('body-check');
    expect(snap(h).exercise).toBe('pushup');
    expect(snap(h).hold).toBeNull();
  });

  it('the summary carries the plank details', () => {
    const h = make('medium');
    h.segments([plank(10000), plank(4000, { sag: 0.3 }), plank(6000)]);
    const s = h.session.end();
    expect(s.exercise).toBe('plank');
    expect(s.totalReps).toBe(0);
    expect(s.hold?.breaks).toBe(1);
    expect(s.hold?.faultMs['hips-sagging']).toBeGreaterThan(2500);
    expect(s.hold?.formPct).toBeGreaterThan(0.6);
    expect(s.hold?.formPct).toBeLessThan(0.95);
  });

  it('the start plank with hips already sagging does not start the clock', () => {
    const h = make('hard');
    h.segments([hold(5000, { sag: 0.16 })]);
    expect(snap(h).phase).toBe('body-check');
    expect(snap(h).plankIssues).toContain('hips-sagging');
  });
});

// ─── The reference pose (GymNation "7 benefits of plank exercises" photo) ────

/**
 * A textbook forearm plank: forearms down with hands clasped (so the near
 * forearm points partly away from the camera), elbows under the shoulders,
 * hips raised about an inch (the article's own cue), legs straight on the
 * toes, head in line. The photo is taken from the front-side, about 40° off
 * side-on, so both shoulders show and horizontal distances look shorter.
 */
const PHOTO: Partial<BodyParams> = {
  forearm: true,
  forearmScale: 0.65,
  elbowStack: 0.03,
  sag: -0.05,
  viewScale: 0.77,
  shoulderWidth: 0.45,
  noisePx: 2,
};

describe('the reference forearm plank', () => {
  describe.each(DIFFICULTIES)('%s', (level) => {
    it.each(['left', 'right'] as const)('times it cleanly facing %s, with no cues at all', (facing) => {
      const h = make(level, { ...PHOTO, facing });
      h.segments([plank(30000)]);
      const s = snap(h);
      expect(`${s.phase} ${s.framing.issue ?? ''} ${s.plankIssues.join(',')}`.trim()).toBe('counting');
      expect(s.hold?.variant).toBe('forearm');
      expect(s.hold?.breaks).toBe(0);
      expect(s.hold?.state).toBe('good');
      expect(holdCues(h, 'warning')).toHaveLength(0);
      expect(good(h)).toBeGreaterThan(27000);
    });

    it('still catches the hips sagging out of that pose', () => {
      const cfg = cfgFor(level);
      const h = make(level, PHOTO);
      h.segments([plank(8000), plank(4000, { sag: cfg.hold.sagFault * 2 }), plank(4000)]);
      expect(snap(h).hold?.breaks).toBe(1);
      expect(snap(h).hold?.variant).toBe('forearm');
    });
  });
});

describe('legs, raised hips and hands', () => {
  const hard = cfgFor('hard');

  it('soft knees mid-hold stop the clock on Medium and Hard, not on Easy', () => {
    const at = (level: Difficulty, knee: number) => {
      const tm = new HoldTimer(cfgFor(level), { hipOffset: 0 });
      return feed(tm, 0, 3000, { kneeDeg: knee }).find((e) => e.type === 'break');
    };
    expect(at('hard', 140)).toMatchObject({ fault: 'knees-bent' }); // Hard limit: under 145°
    expect(at('hard', 150)).toBeUndefined();
    expect(at('medium', 130)).toMatchObject({ fault: 'knees-bent' }); // Medium limit: under 135°
    expect(at('medium', 140)).toBeUndefined();
    expect(at('easy', 120)).toBeUndefined(); // knee planks are fine on Easy
  });

  it('soft knees in a whole session break the hold', () => {
    const h = make('hard');
    h.segments([plank(6000), plank(4000, { kneeDeg: 138 })]);
    expect(snap(h).hold?.breaks).toBe(1);
    expect(snap(h).hold?.fault).toBe('knees-bent');
  });

  it('hips raised about an inch (0.05) or a little more never draw a cue; a real pike does', () => {
    const tm = new HoldTimer(hard, { hipOffset: 0 });
    expect(feed(tm, 0, 4000, { hipOffset: -0.08, bodyLineDeg: 172 })).toEqual([]);
    expect(feed(tm, 4033, 8000, { hipOffset: -0.1, bodyLineDeg: 170 }).map((e) => e.type)).toEqual(['warning']);
    expect(feed(tm, 8033, 11000, { hipOffset: -0.15, bodyLineDeg: 167 }).find((e) => e.type === 'break')).toMatchObject({
      fault: 'hips-piking',
    });
  });

  it('sagging keeps the stricter warning line', () => {
    const tm = new HoldTimer(hard, { hipOffset: 0 });
    expect(feed(tm, 0, 3000, { hipOffset: 0.07 }).map((e) => e.type)).toEqual(['warning']);
  });

  it('hands drifting forward in a high plank: a warning on Hard, never a stop', () => {
    const tm = new HoldTimer(hard, { hipOffset: 0 });
    const evs = feed(tm, 0, 6000, { wristOffset: 0.7 });
    expect(evs).toEqual([expect.objectContaining({ type: 'warning', fault: 'hands-under-shoulders' })]);
    expect(tm.summary().breaks).toBe(0);
    expect(tm.summary().goodMs).toBe(tm.summary().totalMs);
    const med = new HoldTimer(cfgFor('medium'), { hipOffset: 0 });
    expect(feed(med, 0, 4000, { wristOffset: 0.7 })).toEqual([]);
    // Forearm planks are judged on elbows, not hands.
    const fore = new HoldTimer(hard, { hipOffset: 0 }, 'forearm');
    expect(feed(fore, 0, 4000, { ...FOREARM, wristOffset: 0.7 })).toEqual([]);
  });
});
