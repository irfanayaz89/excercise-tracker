/// <reference types="jest" />
/**
 * Side plank: you face the phone lying on one side. The start check (stacked
 * shoulders, support arm), the hold rules (hips, rolling, elbow, knees), the
 * side on the floor, and timing each side, at every level, in both phone
 * orientations, with real-camera noise.
 */
import { difficultyConfig, DIFFICULTIES, type Difficulty } from '../difficulty';
import { checkPlank } from '../gates';
import { HoldTimer } from '../holdTimer';
import type { SessionEvent, SessionSummary } from '../session';
import { plank, renderPose, sidePlank, type BodyParams, type TimelineOptions } from '../testing/synth';
import { PoseTracker, SupportSideSelector } from '../tracker';
import { LM, type BodyMetrics, type PoseSample } from '../types';
import { harness, type Harness } from './helpers';

const cfgFor = (level: Difficulty, allowKneeling = false) => difficultyConfig(level, { exercise: 'sidePlank', allowKneeling });
const PORTRAIT: Partial<BodyParams> = { width: 720, height: 1280, torsoPx: 130, floorY: 1280 * 0.7 };
const FRAMES = { landscape: {} as Partial<BodyParams>, portrait: PORTRAIT };

function make(level: Difficulty, base: Partial<BodyParams> = {}, extra: { targetHoldMs?: number; allowKneeling?: boolean } = {}): Harness {
  return harness({ config: cfgFor(level, extra.allowKneeling), base, exercise: 'sidePlank', targetHoldMs: extra.targetHoldMs });
}
const snap = (h: Harness) => h.session.snapshot();
const good = (h: Harness) => snap(h).hold?.goodMs ?? 0;
const breaks = (h: Harness) => snap(h).hold?.breaks ?? 0;
const holdCues = (h: Harness, state?: 'warning' | 'break') =>
  h.events.filter((e) => e.type === 'cue' && e.cue.kind === 'hold' && (state === undefined || e.cue.state === state));
const ended = (h: Harness): SessionSummary | null => {
  const e = h.events.find((x): x is Extract<SessionEvent, { type: 'ended' }> => x.type === 'ended');
  return e ? e.summary : null;
};
/** Getting up and turning round to the other side, as a person does. */
const turnAround = (h: Harness, facing: 'left' | 'right') => {
  h.segments([plank(1200, (k) => ({ bodyTiltDeg: 80 * k, stack: 0.7 })), plank(2500, { bodyTiltDeg: 80, stack: 0.7 })]);
  h.segments([sidePlank(800, (k) => ({ bodyTiltDeg: 80 * (1 - k) }))], { base: { facing } });
};

const METRICS: BodyMetrics = {
  t: 0,
  side: 'left',
  elbowDeg: 90,
  bodyLineDeg: 180,
  hipOffset: 0,
  kneeDeg: 178,
  neckDeg: 160,
  trunkTiltDeg: 12,
  shoulderHeight: 0.6,
  wristOffset: 0.05,
  elbowStack: 0.02,
  forearmRise: 0.02,
  shoulderStack: 0.7,
  torsoPx: 240,
  hipCenter: { x: 0.5, y: 0.6 },
};

// ─── Start check ─────────────────────────────────────────────────────────────

describe('side plank start check', () => {
  const hard = cfgFor('hard');

  it('accepts a forearm side plank and a straight-arm side plank', () => {
    expect(checkPlank(METRICS, hard, 'sidePlank')).toEqual({ ok: true, issues: [], variant: 'forearm' });
    const straight = { ...METRICS, elbowDeg: 172, forearmRise: 0.53, shoulderHeight: 1.1, trunkTiltDeg: 22 };
    expect(checkPlank(straight, hard, 'sidePlank')).toEqual({ ok: true, issues: [], variant: 'high' });
  });

  it('asks you to turn onto your side when the shoulders are not stacked', () => {
    expect(checkPlank({ ...METRICS, shoulderStack: 0.1 }, hard, 'sidePlank').issues).toEqual(['roll-onto-side']);
    expect(checkPlank({ ...METRICS, shoulderStack: null }, hard, 'sidePlank').issues).toEqual(['roll-onto-side']);
    // Easy is happy with a looser stack.
    expect(checkPlank({ ...METRICS, shoulderStack: 0.32 }, cfgFor('easy'), 'sidePlank').ok).toBe(true);
  });

  it('asks for the elbow under the shoulder, and for the hips up', () => {
    expect(checkPlank({ ...METRICS, elbowStack: 0.6 }, hard, 'sidePlank').issues).toEqual(['elbows-under-shoulders']);
    expect(checkPlank({ ...METRICS, hipOffset: 0.15, bodyLineDeg: 167 }, hard, 'sidePlank').issues).toEqual(['hips-sagging']);
  });

  it('a regular plank is not a side plank, and a side plank is not a push-up start', () => {
    expect(checkPlank({ ...METRICS, shoulderStack: null }, hard, 'sidePlank').issues).toContain('roll-onto-side');
    expect(checkPlank(METRICS, difficultyConfig('hard'), 'pushup').ok).toBe(false);
  });
});

describe('the side on the floor', () => {
  const cfg = cfgFor('hard');
  it('is the lower shoulder, and only changes after the other is clearly lower for a while', () => {
    const tr = new PoseTracker(cfg);
    const sel = new SupportSideSelector(cfg);
    expect(sel.update(tr.update(renderPose(1000, { elbowDeg: 90, forearm: true, stack: 0.7, facing: 'left' }))!)).toBe('left');
    // One frame of the other side lower is ignored.
    const t2 = new PoseTracker(cfg);
    expect(sel.update(t2.update(renderPose(1100, { elbowDeg: 90, forearm: true, stack: 0.7, facing: 'right' }))!)).toBe('left');
    let side = sel.current;
    for (let t = 1133; t < 2000; t += 33) side = sel.update(t2.update(renderPose(t, { elbowDeg: 90, forearm: true, stack: 0.7, facing: 'right' }))!);
    expect(side).toBe('right');
  });
});

// ─── Hold rules ──────────────────────────────────────────────────────────────

describe('side plank hold timer', () => {
  const hard = cfgFor('hard');
  const feed = (tm: HoldTimer, from: number, to: number, over: Partial<BodyMetrics> = {}) => {
    const evs = [];
    for (let t = from; t <= to; t += 33) {
      const ev = tm.update({ ...METRICS, ...over, t });
      if (ev) evs.push(ev);
    }
    return evs;
  };

  it('a steady side plank never breaks', () => {
    const tm = new HoldTimer(hard, { hipOffset: 0 }, 'forearm', true);
    expect(feed(tm, 0, 10000)).toEqual([]);
  });

  it('rolling forward or back stops the clock', () => {
    const tm = new HoldTimer(hard, { hipOffset: 0 }, 'forearm', true);
    expect(feed(tm, 0, 3000, { shoulderStack: 0.15 }).find((e) => e.type === 'break')).toMatchObject({ fault: 'rolled' });
  });

  it('the elbow drifting from under the shoulder stops the clock (forearm)', () => {
    const tm = new HoldTimer(hard, { hipOffset: 0 }, 'forearm', true);
    expect(feed(tm, 0, 3000, { elbowStack: 0.6 }).find((e) => e.type === 'break')).toMatchObject({ fault: 'elbows-under-shoulders' });
  });

  it('a bending support arm stops the clock (straight arm)', () => {
    const tm = new HoldTimer(hard, { hipOffset: 0 }, 'high', true);
    const straight = { forearmRise: 0.53, elbowDeg: 120 };
    expect(feed(tm, 0, 3000, straight).find((e) => e.type === 'break')).toMatchObject({ fault: 'arms-bent' });
  });

  it('unknown stack (top shoulder hidden for a moment) is never a fault', () => {
    const tm = new HoldTimer(hard, { hipOffset: 0 }, 'forearm', true);
    expect(feed(tm, 0, 4000, { shoulderStack: null })).toEqual([]);
  });
});

// ─── Whole sets ──────────────────────────────────────────────────────────────

/** Every 8th frame the near hip and knee jump, as measured on a real iPhone. */
const spikes: TimelineOptions['mapFrame'] = (s: PoseSample, t: number) => {
  if (Math.round(t / 33.333) % 8 !== 0 || s.landmarks.length === 0) return s;
  const lms = s.landmarks.map((l) => ({ ...l }));
  for (const i of [LM.leftHip, LM.rightHip]) lms[i].y += 0.16;
  for (const i of [LM.leftKnee, LM.rightKnee]) lms[i].y -= 0.12;
  return { ...s, landmarks: lms };
};

describe.each(DIFFICULTIES)('side plank, %s', (level) => {
  const cfg = cfgFor(level);
  const sag = cfg.hold.sagFault * 1.8;

  describe.each(Object.keys(FRAMES) as (keyof typeof FRAMES)[])('%s frame', (frame) => {
    it.each(['left', 'right'] as const)('times a forearm side plank on the %s side', (facing) => {
      const h = make(level, { ...FRAMES[frame], facing, noisePx: 2 });
      h.segments([sidePlank(20000)]);
      const s = snap(h);
      expect(`${s.phase} ${s.framing.issue ?? ''} ${s.plankIssues.join(',')}`.trim()).toBe('counting');
      expect(s.hold?.variant).toBe('forearm');
      expect(s.activeSide).toBe(facing);
      expect(s.holdSides?.[facing]).toBeGreaterThan(17000);
      expect(breaks(h)).toBe(0);
      expect(holdCues(h)).toHaveLength(0);
    });

    it('stops the clock while the hips sag, and runs again when lifted', () => {
      const h = make(level, FRAMES[frame]);
      h.segments([sidePlank(8000)]);
      const before = good(h);
      h.segments([sidePlank(4000, { sag })]);
      expect(good(h) - before).toBeLessThan(cfg.hold.graceMs + 600);
      expect(snap(h).hold?.fault).toBe('hips-sagging');
      h.segments([sidePlank(5000)]);
      expect(snap(h).hold?.state).toBe('good');
      expect(breaks(h)).toBe(1);
    });
  });

  it('times a straight-arm side plank', () => {
    const h = make(level, { noisePx: 2 });
    h.segments([plank(12000, { stack: 0.7 })]);
    expect(snap(h).phase).toBe('counting');
    expect(snap(h).hold?.variant).toBe('high');
    expect(breaks(h)).toBe(0);
  });

  it('rolling towards the floor stops the clock', () => {
    const h = make(level);
    h.segments([sidePlank(6000), sidePlank(4000, { stack: 0.08 })]);
    expect(breaks(h)).toBe(1);
    expect(snap(h).hold?.fault).toBe('rolled');
  });

  it('a regular plank never starts a side plank', () => {
    const h = make(level);
    h.segments([plank(6000, { forearm: true })]);
    expect(snap(h).phase).toBe('body-check');
    expect(snap(h).plankIssues).toContain('roll-onto-side');
  });

  it('single misread frames from a real camera do not break the hold', () => {
    const h = make(level, { noisePx: 3 });
    h.segments([sidePlank(25000)], { mapFrame: spikes });
    expect(snap(h).phase).toBe('counting');
    expect(breaks(h)).toBe(0);
    expect(holdCues(h, 'warning')).toHaveLength(0);
  });

  it('with a target: one side done → "switch sides", the other side done → finished', () => {
    const h = make(level, { facing: 'left' }, { targetHoldMs: 10000 });
    h.segments([sidePlank(14000)]);
    expect(snap(h).phase).toBe('paused');
    expect(snap(h).pauseReason).toBe('switch-sides');
    expect(snap(h).doneSides).toEqual(['left']);
    // Holding the same side again does not restart it, not even for a moment.
    const before = h.events.length;
    h.segments([sidePlank(4000)]);
    expect(snap(h).phase).toBe('paused');
    expect(h.events.slice(before).some((e) => e.type === 'phase' && e.phase === 'counting')).toBe(false);
    expect(h.events.filter((e) => e.type === 'cue' && e.cue.kind === 'switch-sides').length).toBeGreaterThanOrEqual(2);
    // The other side.
    turnAround(h, 'right');
    h.segments([sidePlank(14000)], { base: { facing: 'right' } });
    const s = ended(h);
    expect(s?.endReason).toBe('target');
    expect(s?.exercise).toBe('sidePlank');
    expect(s?.holdSides?.left?.goodMs).toBeGreaterThanOrEqual(10000);
    expect(s?.holdSides?.right?.goodMs).toBeGreaterThanOrEqual(10000);
    expect(s?.hold?.goodMs).toBe((s?.holdSides?.left?.goodMs ?? 0) + (s?.holdSides?.right?.goodMs ?? 0));
  });

  it('without a target: each side is timed on its own', () => {
    const h = make(level, { facing: 'left' });
    h.segments([sidePlank(9000)]);
    turnAround(h, 'right');
    h.segments([sidePlank(9000)], { base: { facing: 'right' } });
    const s = snap(h);
    expect(s.activeSide).toBe('right');
    expect(s.holdSides?.left).toBeGreaterThan(6000);
    expect(s.holdSides?.right).toBeGreaterThan(6000);
    const sum = h.session.end();
    expect(Object.keys(sum.holdSides ?? {}).sort()).toEqual(['left', 'right']);
  });

  it(level === 'easy' ? 'Easy accepts a side plank on the knees' : 'knees down: never starts, and stops the clock mid-hold', () => {
    if (level === 'easy') {
      const h = make(level);
      h.segments([sidePlank(8000, { kneeDeg: 100 })]);
      expect(snap(h).phase).toBe('counting');
      expect(breaks(h)).toBe(0);
    } else {
      const start = make(level);
      start.segments([sidePlank(6000, { kneeDeg: 100 })]);
      expect(start.session.snapshot().phase).toBe('body-check');
      const mid = make(level);
      mid.segments([sidePlank(5000), sidePlank(4000, { kneeDeg: 130 })]);
      expect(mid.session.snapshot().hold?.breaks).toBe(1);
    }
  });
});

describe('side plank and the rest of the app', () => {
  it('turning onto the other side mid-hold starts that side, it does not add to this one', () => {
    const h = make('medium', { facing: 'left' });
    h.segments([sidePlank(8000)]);
    const leftBefore = snap(h).holdSides?.left ?? 0;
    turnAround(h, 'right');
    h.segments([sidePlank(6000)], { base: { facing: 'right' } });
    // Only the first moment of getting up (still a valid hold) may count.
    expect(snap(h).holdSides?.left ?? 0).toBeLessThan(leftBefore + 1000);
    expect(snap(h).holdSides?.right).toBeGreaterThan(3000);
  });

  it('push-ups and the regular plank are untouched by the side plank rules', () => {
    const push = harness({ config: difficultyConfig('hard') });
    push.segments([plank(3500), plank(3000)]);
    expect(push.session.snapshot().holdSides).toBeNull();
    const pl = harness({ config: difficultyConfig('hard', { exercise: 'plank' }), exercise: 'plank' });
    pl.segments([plank(8000)]);
    expect(pl.session.snapshot().holdSides).toBeNull();
    expect(pl.session.snapshot().hold?.breaks).toBe(0);
  });
});
