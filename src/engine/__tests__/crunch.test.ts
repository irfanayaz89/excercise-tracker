/// <reference types="jest" />
/**
 * Crunches, seen side-on: lying on your back, knees bent, feet flat, curling
 * the shoulders up off the floor. The start check, counting, every miss and
 * fault, pauses, and every level in both phone orientations, facing either
 * way, with each arm position and real-camera noise.
 */
import { difficultyConfig, DIFFICULTIES, type Difficulty } from '../difficulty';
import { checkPlank } from '../gates';
import type { SessionEvent, SessionSummary } from '../session';
import {
  crunch,
  crunchMove,
  crunchRest,
  hold,
  rep,
  renderPose,
  type BodyParams,
  type CrunchParams,
  type TimelineOptions,
} from '../testing/synth';
import { buildChain, computeMetrics, PoseTracker, SideSelector } from '../tracker';
import type { BodyMetrics } from '../types';
import { harness, type Harness } from './helpers';

const cfgFor = (level: Difficulty) => difficultyConfig(level, { exercise: 'crunch' });
const PORTRAIT: Partial<BodyParams> = { width: 720, height: 1280, torsoPx: 120, floorY: 1280 * 0.7 };
const FRAMES = { landscape: {} as Partial<BodyParams>, portrait: PORTRAIT };
const ARMS: CrunchParams['arms'][] = ['chest', 'head', 'reach'];

function make(level: Difficulty, base: Partial<BodyParams> = {}, targetReps?: number): Harness {
  return harness({ config: cfgFor(level), base, exercise: 'crunch', targetReps });
}
/** Lie still on your back: counting starts. */
const lieDown = (h: Harness, extra: Partial<CrunchParams> = {}, opts: TimelineOptions = {}) => h.segments([crunchRest(2600, extra)], opts);
const reps = (h: Harness) => h.events.filter((e): e is Extract<SessionEvent, { type: 'rep' }> => e.type === 'rep').map((e) => e.rep);
const faults = (h: Harness, f: string) => reps(h).filter((r) => r.faults.includes(f as never)).length;
const phase = (h: Harness) => h.session.snapshot().phase;
const ended = (h: Harness): SessionSummary | null => {
  const e = h.events.find((x): x is Extract<SessionEvent, { type: 'ended' }> => x.type === 'ended');
  return e ? e.summary : null;
};

/** Metrics for one rendered frame. */
function metricsOf(params: BodyParams, level: Difficulty = 'hard'): BodyMetrics {
  const cfg = cfgFor(level);
  const pose = new PoseTracker(cfg).update(renderPose(1000, params))!;
  const side = new SideSelector(cfg).update(pose);
  return computeMetrics(buildChain(pose, side), pose, 0, cfg)!;
}

describe('crunch start check', () => {
  const hard = cfgFor('hard');
  const at = (c: Partial<CrunchParams>, body: Partial<BodyParams> = {}) =>
    metricsOf({ elbowDeg: 90, ...body, crunch: { liftDeg: 0, ...c } });

  it('accepts lying on your back with knees bent, any arm position, either way round', () => {
    for (const facing of ['left', 'right'] as const)
      for (const arms of ARMS)
        for (const kneeDeg of [60, 85, 110, 135]) expect(checkPlank(at({ arms, kneeDeg }, { facing }), hard, 'crunch').ok).toBe(true);
  });

  it('asks you to lie down when sitting up', () => {
    expect(checkPlank(at({ liftDeg: 35 }), hard, 'crunch').issues).toContain('lie-on-back');
    expect(checkPlank(at({ liftDeg: 80 }), hard, 'crunch').issues).toContain('lie-on-back');
  });

  it('asks you to bend your knees when the legs are straight, and to move the feet out when the heels are tucked in', () => {
    expect(checkPlank(at({ kneeDeg: 170 }), hard, 'crunch').issues).toEqual(['bend-knees']);
    expect(checkPlank(at({ kneeDeg: 32 }), hard, 'crunch').issues).toEqual(['feet-forward']);
    // Easy accepts straighter legs (155°), not straight ones.
    expect(checkPlank(at({ kneeDeg: 150 }), cfgFor('easy'), 'crunch').ok).toBe(true);
    expect(checkPlank(at({ kneeDeg: 170 }), cfgFor('easy'), 'crunch').issues).toEqual(['bend-knees']);
  });

  it('asks for the feet on the floor when they are up in the air', () => {
    expect(checkPlank(at({ feetUp: 0.45 }), hard, 'crunch').issues).toContain('feet-on-floor');
  });

  it('a push-up plank is not a crunch start, and a crunch start is not a push-up start', () => {
    const pushupPlank = metricsOf({ elbowDeg: 172 });
    expect(checkPlank(pushupPlank, hard, 'crunch').ok).toBe(false);
    expect(checkPlank(at({}), difficultyConfig('hard'), 'pushup').ok).toBe(false);
    expect(checkPlank(at({}), difficultyConfig('hard', { exercise: 'plank' }), 'plank').ok).toBe(false);
  });
});

describe('crunch settings', () => {
  it('crunch marks are ordered at every level (hysteresis gaps)', () => {
    for (const d of DIFFICULTIES) {
      const c = difficultyConfig(d, { exercise: 'crunch' }).crunch;
      expect(c.downDeg).toBeLessThan(c.leaveDeg);
      expect(c.leaveDeg).toBeLessThan(c.partialDeg);
      expect(c.partialDeg).toBeLessThan(c.upDeg);
      expect(c.upDeg).toBeLessThan(c.satUpDeg);
      expect(c.satUpDeg).toBeLessThan(c.outLiftDeg);
    }
  });
});

describe('the crunch measurements', () => {
  it('shoulder lift follows the curl, the same either way round and in either frame', () => {
    for (const facing of ['left', 'right'] as const)
      for (const frame of Object.values(FRAMES)) {
        const rest = metricsOf({ elbowDeg: 90, facing, ...frame, crunch: { liftDeg: 0 } }).trunkLiftDeg!;
        const up = metricsOf({ elbowDeg: 90, facing, ...frame, crunch: { liftDeg: 30 } }).trunkLiftDeg!;
        expect(up - rest).toBeGreaterThan(27);
        expect(up - rest).toBeLessThan(33);
      }
  });

  it('feet lifting raises the foot reading; a pulled chin closes the neck angle', () => {
    const base = metricsOf({ elbowDeg: 90, crunch: { liftDeg: 20 } });
    expect(metricsOf({ elbowDeg: 90, crunch: { liftDeg: 20, feetUp: 0.3 } }).footRise! - base.footRise!).toBeGreaterThan(0.25);
    expect(base.neckDeg! - metricsOf({ elbowDeg: 90, crunch: { liftDeg: 20, neckFlexDeg: 50 } }).neckDeg!).toBeGreaterThan(40);
  });
});

describe.each(DIFFICULTIES)('crunches at %s', (level) => {
  const formOn = level !== 'easy';

  describe.each(Object.entries(FRAMES))('%s frame', (_, frame) => {
    it.each(['left', 'right'] as const)('counts every crunch, facing %s, with every arm position', (facing) => {
      for (const arms of ARMS) {
        const h = make(level, { ...frame, facing });
        lieDown(h, { arms });
        expect(phase(h)).toBe('counting');
        h.segments(Array.from({ length: 6 }, () => crunch(2200, 32, { arms })));
        expect(reps(h)).toHaveLength(6);
        expect(reps(h).every((r) => r.clean)).toBe(true);
        expect(h.misses()).toBe(0);
      }
    });
  });

  it('half crunches are not counted' + (formOn ? ', and are called out' : ''), () => {
    const h = make(level);
    lieDown(h);
    const up = cfgFor(level).crunch.upDeg;
    h.segments(Array.from({ length: 4 }, () => crunch(1800, up - 4)));
    expect(reps(h)).toHaveLength(0);
    expect(h.misses('not-high-enough')).toBe(4);
    h.segments([crunch(2000, 32)]);
    expect(reps(h)).toHaveLength(1);
  });

  it('a small wobble at rest is never a rep or a miss', () => {
    const h = make(level, { noisePx: 2 });
    lieDown(h);
    h.segments(Array.from({ length: 10 }, () => crunch(900, 4)));
    expect(reps(h)).toHaveLength(0);
    expect(h.misses()).toBe(0);
  });

  it(formOn ? 'sitting all the way up counts, flagged "sat-up"' : 'sitting all the way up counts (no form checks)', () => {
    const h = make(level);
    lieDown(h);
    h.segments([crunch(2600, 75), crunch(2600, 75)]);
    expect(reps(h)).toHaveLength(2);
    expect(faults(h, 'sat-up')).toBe(formOn ? 2 : 0);
  });

  it(formOn ? 'feet coming off the floor are flagged' : 'feet coming off the floor are not judged', () => {
    const h = make(level);
    lieDown(h);
    h.segments([crunch(2400, 34, (k) => ({ feetUp: 0.45 * Math.sin(Math.PI * k) }))]);
    expect(reps(h)).toHaveLength(1);
    expect(faults(h, 'feet-lifting')).toBe(formOn ? 1 : 0);
  });

  it(formOn ? 'rushed crunches count, flagged "rushed"' : 'fast crunches count', () => {
    const h = make(level);
    lieDown(h);
    h.segments([crunch(650, 32), crunch(650, 32), crunchRest(400)]);
    expect(reps(h)).toHaveLength(2);
    expect(faults(h, 'rushed')).toBe(formOn ? 2 : 0);
  });

  it(formOn ? 'pulling the chin to the chest is a tip, the rep stays clean' : 'neck position is not judged', () => {
    const h = make(level);
    lieDown(h);
    h.segments([crunch(2400, 32, (k) => ({ neckFlexDeg: 55 * Math.sin(Math.PI * k) }))]);
    expect(reps(h)).toHaveLength(1);
    expect(faults(h, 'neck-pulling')).toBe(formOn ? 1 : 0);
    expect(reps(h)[0].clean).toBe(true);
  });

  it('pulsing at the top without lowering is one crunch, not several', () => {
    const h = make(level);
    lieDown(h);
    const c = cfgFor(level).crunch;
    const mid = (c.upDeg + c.downDeg) / 2 - 1;
    h.segments([
      crunchMove(900, 0, 32),
      crunchMove(700, 32, mid),
      crunchMove(700, mid, 32),
      crunchMove(700, 32, mid),
      crunchMove(700, mid, 32),
      crunchMove(900, 32, 0),
      crunchRest(400),
    ]);
    expect(reps(h)).toHaveLength(1);
    expect(h.misses('not-back-down')).toBe(2);
  });

  it('holding at the top for a long time resets, then counting carries on', () => {
    const h = make(level);
    lieDown(h);
    h.segments([crunchMove(800, 0, 30), crunchMove(11000, 30, 30), crunchMove(800, 30, 0), crunchRest(500)]);
    expect(reps(h)).toHaveLength(0);
    expect(h.misses('too-slow')).toBe(1);
    h.segments([crunch(2000, 32), crunch(2000, 32)]);
    expect(reps(h)).toHaveLength(2);
  });

  it('counts exactly with real-camera noise and a crooked phone', () => {
    for (const roll of [-4, 4]) {
      const h = make(level, { noisePx: 3, imageRollDeg: roll });
      lieDown(h);
      h.segments(Array.from({ length: 8 }, () => crunch(2000, 30)));
      expect(reps(h)).toHaveLength(8);
    }
  });

  it('hands behind the head with the wrist hidden still counts', () => {
    const h = make(level, { hide: { wrist: 0.1, elbow: 0.2 } });
    lieDown(h, { arms: 'head' });
    expect(phase(h)).toBe('counting');
    h.segments(Array.from({ length: 4 }, () => crunch(2000, 32, { arms: 'head' })));
    expect(reps(h)).toHaveLength(4);
  });

  it('sitting up to rest pauses the set; lying back down carries on with the count kept', () => {
    const h = make(level);
    lieDown(h);
    h.segments([crunch(2000, 32), crunch(2000, 32), crunchMove(1000, 0, 85), crunchMove(3000, 85, 85)]);
    expect(phase(h)).toBe('paused');
    expect(h.session.snapshot().pauseReason).toBe('left-position');
    h.segments([crunchMove(1000, 85, 0), crunchRest(2600)]);
    expect(phase(h)).toBe('counting');
    h.segments([crunch(2000, 32)]);
    expect(reps(h)).toHaveLength(3);
  });

  it('stretching the legs out flat pauses the set', () => {
    const h = make(level);
    lieDown(h);
    h.segments([crunch(2000, 32), crunchRest(3500, { kneeDeg: 178 })]);
    expect(phase(h)).toBe('paused');
  });

  it('walking out of view pauses the set', () => {
    const h = make(level);
    lieDown(h);
    h.segments([crunch(2000, 32)]);
    h.nobody(3000);
    expect(phase(h)).toBe('paused');
    expect(h.session.snapshot().pauseReason).toBe('lost-tracking');
  });

  it('ends at the target', () => {
    const h = make(level, {}, 5);
    lieDown(h);
    h.segments(Array.from({ length: 7 }, () => crunch(2000, 32)));
    expect(ended(h)?.totalReps).toBe(5);
    expect(ended(h)?.endReason).toBe('target');
    expect(ended(h)?.exercise).toBe('crunch');
  });

  it('a real person crunching is never mistaken for a video', () => {
    const h = make(level, { noisePx: 3 });
    lieDown(h);
    h.segments(Array.from({ length: 12 }, () => crunch(1600, 34)));
    expect(reps(h)).toHaveLength(12);
    expect(h.session.snapshot().pauseReason).toBeNull();
  });
});

describe('crunch timing and summary', () => {
  it('records the peak lift and builds a summary', () => {
    const h = make('hard', {}, 3);
    lieDown(h);
    h.segments([crunch(2000, 30), crunch(2000, 40), crunch(2000, 70)]);
    const s = ended(h)!;
    expect(s.totalReps).toBe(3);
    expect(s.cleanReps).toBe(2);
    expect(s.faultCounts['sat-up']).toBe(1);
    expect(s.reps[1].peakLiftDeg).toBeGreaterThan(35);
    expect(s.hold).toBeUndefined();
  });

  it('a crunch body never starts a push-up set, and push-ups never start a crunch set', () => {
    const p = harness({ config: difficultyConfig('hard'), exercise: 'pushup' });
    p.segments([crunchRest(3000), crunch(2000, 32)]);
    expect(p.session.snapshot().phase).not.toBe('counting');
    const c = make('hard');
    c.segments([hold(3000), rep(1600), rep(1600)]);
    expect(c.session.snapshot().phase).not.toBe('counting');
    expect(reps(c)).toHaveLength(0);
  });
});
