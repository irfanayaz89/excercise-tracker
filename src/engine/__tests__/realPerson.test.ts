/// <reference types="jest" />
/**
 * The real-person check: a video of someone exercising, shown on a screen,
 * must never count, and a real person must never be flagged.
 */
import { mergeConfig, type DeepPartial, type EngineConfig } from '../config';
import { difficultyConfig, DIFFICULTIES, type Difficulty } from '../difficulty';
import { RealityCheck, type DepthProbe } from '../reality';
import { PushupSession, type SessionEvent } from '../session';
import { hold, levelPhone, mulberry32, plank, rep, timeline, type Segment, type TimelineOptions } from '../testing/synth';
import type { Exercise, PoseSample } from '../types';

const cfg = mergeConfig();
const rand = mulberry32(42);
const noise = (a: number) => (rand() - 0.5) * 2 * a;

/** A real person 2 m away with a wall 1.5 m behind them. */
const realProbe = (t: number): DepthProbe => ({
  t,
  body: Array.from({ length: 6 }, () => 2 + noise(0.06)),
  around: Array.from({ length: 6 }, () => 3.5 + noise(0.15)),
  torsoM: 0.5 + noise(0.05),
});
/** A life-size person on a TV 2 m away: everything on one flat surface. */
const tvProbe = (t: number): DepthProbe => ({
  t,
  body: Array.from({ length: 6 }, () => 2 + noise(0.03)),
  around: Array.from({ length: 6 }, () => 2 + noise(0.03)),
  torsoM: 0.5 + noise(0.05),
});
/** A video on a phone held up to the camera: the room behind it is far, but the person is tiny. */
const phoneProbe = (t: number): DepthProbe => ({
  t,
  body: Array.from({ length: 6 }, () => 0.5 + noise(0.01)),
  around: Array.from({ length: 6 }, () => 2.5 + noise(0.2)),
  torsoM: 0.04 + noise(0.005),
});

// ─── The check on its own ────────────────────────────────────────────────────

describe('RealityCheck: depth', () => {
  const feed = (rc: RealityCheck, make: (t: number) => DepthProbe, from: number, to: number, step = 100) => {
    for (let t = from; t <= to; t += step) rc.pushDepth(make(t));
  };

  it('a real person in a room is never flagged', () => {
    const rc = new RealityCheck(cfg);
    feed(rc, realProbe, 0, 60000);
    expect(rc.issue(60000)).toBeNull();
    expect(rc.clearFor(60000)).toBe(Infinity);
  });

  it('a person on a TV (flat) is flagged once there is enough evidence', () => {
    const rc = new RealityCheck(cfg);
    feed(rc, tvProbe, 0, 400); // 5 readings: not enough yet
    expect(rc.issue(400)).toBeNull();
    feed(rc, tvProbe, 500, 3000);
    expect(rc.issue(3000)).toBe('screen');
    expect(rc.suspectSince(3000)).toBeLessThanOrEqual(500);
  });

  it('a person on a phone screen is flagged by size even though the room behind is far', () => {
    const rc = new RealityCheck(cfg);
    feed(rc, phoneProbe, 0, 3000);
    expect(rc.issue(3000)).toBe('screen');
  });

  it('mixed evidence (60% fake) gives no verdict', () => {
    const rc = new RealityCheck(cfg);
    for (let t = 0, i = 0; t <= 3000; t += 100, i++) rc.pushDepth(i % 5 < 3 ? tvProbe(t) : realProbe(t));
    expect(rc.issue(3000)).toBeNull();
  });

  it('missing or out-of-range depth gives no verdict', () => {
    const rc = new RealityCheck(cfg);
    feed(rc, (t) => ({ t, body: [NaN, 0, -1, 9, 0.05, NaN], around: [0, 0, 0, NaN, NaN, NaN], torsoM: null }), 0, 5000);
    feed(rc, (t) => ({ t, body: [2, 2, 2], around: [2.1], torsoM: null }), 5100, 9000); // too few points around
    expect(rc.issue(9000)).toBeNull();
  });

  it('an unclear gap (between 12 and 25 cm) gives no verdict', () => {
    const rc = new RealityCheck(cfg);
    feed(rc, (t) => ({ t, body: [2, 2, 2, 2], around: [2.18, 2.18, 2.18, 2.18], torsoM: 0.5 }), 0, 5000);
    expect(rc.issue(5000)).toBeNull();
  });

  it('switched off in Settings: never flags', () => {
    const rc = new RealityCheck(mergeConfig({ reality: { enabled: false } }));
    feed(rc, tvProbe, 0, 5000);
    expect(rc.issue(5000)).toBeNull();
  });

  it('the evidence clears once the screen is gone', () => {
    const rc = new RealityCheck(cfg);
    feed(rc, tvProbe, 0, 3000);
    expect(rc.issue(3000)).toBe('screen');
    feed(rc, realProbe, 3100, 7000);
    expect(rc.issue(7000)).toBeNull();
    expect(rc.clearFor(7000)).toBeGreaterThan(3500);
  });
});

describe('RealityCheck: handheld screen', () => {
  const shakeAt = (t: number) => ({
    x: 0.5 + 0.01 * Math.sin((2 * Math.PI * 3 * t) / 1000),
    y: 0.7 + 0.006 * Math.cos((2 * Math.PI * 2.3 * t) / 1000),
  });
  const feed = (rc: RealityCheck, at: (t: number) => { x: number; y: number }, still: boolean | null, from: number, to: number) => {
    for (let t = from; t <= to; t += 33) {
      const c = at(t);
      rc.pushContacts(t, [c, { x: c.x + 0.4, y: c.y }], still);
    }
  };

  it('hands and feet shaking together while the phone is still: flagged after 3 s', () => {
    const rc = new RealityCheck(cfg);
    feed(rc, shakeAt, true, 0, 2500);
    expect(rc.issue(2500)).toBeNull();
    feed(rc, shakeAt, true, 2533, 4500);
    expect(rc.issue(4500)).toBe('handheld');
  });

  it('the phone itself moving is not a screen (the phone check handles it)', () => {
    const rc = new RealityCheck(cfg);
    feed(rc, shakeAt, false, 0, 6000);
    expect(rc.issue(6000)).toBeNull();
  });

  it('without a motion sensor the handheld check stays off', () => {
    const rc = new RealityCheck(cfg);
    feed(rc, shakeAt, null, 0, 6000);
    expect(rc.issue(6000)).toBeNull();
  });

  it('planted hands with camera noise, or one hand moved once, are never flagged', () => {
    const rc = new RealityCheck(cfg);
    feed(rc, () => ({ x: 0.5 + noise(0.0015), y: 0.7 + noise(0.0015) }), true, 0, 20000);
    feed(rc, (t) => ({ x: 0.5 + Math.min(0.1, (t - 20000) / 5000), y: 0.7 }), true, 20033, 21000); // a deliberate move
    feed(rc, () => ({ x: 0.6 + noise(0.0015), y: 0.7 + noise(0.0015) }), true, 21033, 30000);
    expect(rc.issue(30000)).toBeNull();
  });
});

// ─── Whole sets ──────────────────────────────────────────────────────────────

interface Run {
  session: PushupSession;
  events: SessionEvent[];
  t: number;
  /** Plays frames; `depth` (if given) is read every 3rd frame, as the camera does. */
  play(segs: Segment[], depth?: ((t: number) => DepthProbe) | null, opts?: TimelineOptions & { motion?: number }): void;
}

function run(level: Difficulty, exercise: Exercise, over: DeepPartial<EngineConfig> = {}): Run {
  const base = difficultyConfig(level, { exercise });
  const config = { ...base, reality: { ...base.reality, ...over.reality } } as EngineConfig;
  const session = new PushupSession({ config, exercise });
  const events: SessionEvent[] = [];
  session.subscribe((e) => events.push(e));
  const r: Run = {
    session,
    events,
    t: 1000,
    play(segs, depth = realProbe, opts = {}) {
      const frames = timeline(segs, { ...opts, startT: r.t + 33 });
      frames.forEach((s: PoseSample, i) => {
        session.pushAttitude(levelPhone(s.t, 0, 0, opts.motion ?? 0));
        session.pushPose(s);
        if (depth && i % 3 === 0) session.pushDepth(depth(s.t));
        session.tick(s.t);
        r.t = s.t;
      });
    },
  };
  return r;
}

const reps = (r: Run) => r.session.snapshot().reps;
const notReal = (r: Run) => r.events.some((e) => e.type === 'cue' && e.cue.kind === 'paused' && e.cue.reason === 'not-real');
const start = (exercise: Exercise) => (exercise === 'plank' ? [plank(3500)] : [hold(3500)]);
const work = (exercise: Exercise, ms: number): Segment[] =>
  exercise === 'plank' ? [plank(ms)] : Array.from({ length: Math.round(ms / 1600) }, () => rep(1600));

/** A video shown on a screen in front of the camera: the picture shakes back and forth. */
const handheld: TimelineOptions['mapFrame'] = (s, t) => {
  if (s.landmarks.length === 0) return s;
  const dx = 0.012 * Math.sin((2 * Math.PI * 3 * t) / 1000);
  const dy = 0.008 * Math.cos((2 * Math.PI * 2.3 * t) / 1000);
  return { ...s, landmarks: s.landmarks.map((l) => ({ ...l, x: l.x + dx, y: l.y + dy })) };
};

describe.each(DIFFICULTIES)('%s', (level) => {
  describe.each(['pushup', 'plank'] as const)('%s', (exercise) => {
    it('a real person with depth readings is never flagged', () => {
      const r = run(level, exercise);
      r.play([...start(exercise), ...work(exercise, 30000)]);
      expect(notReal(r)).toBe(false);
      expect(r.session.snapshot().phase).toBe('counting');
      if (exercise === 'pushup') expect(reps(r)).toBeGreaterThanOrEqual(17);
      else expect(r.session.snapshot().hold?.goodMs).toBeGreaterThan(27000);
    });

    it('a video on a TV from the start never starts the set', () => {
      const r = run(level, exercise);
      r.play([...start(exercise), ...work(exercise, 8000)], tvProbe);
      expect(r.session.snapshot().phase).toBe('body-check');
      expect(r.events.some((e) => e.type === 'cue' && e.cue.kind === 'not-real')).toBe(true);
      expect(r.session.snapshot().reality).toBe('screen');
    });

    it('switching to a screen mid-set pauses and takes back what the screen did', () => {
      const r = run(level, exercise);
      r.play([...start(exercise), ...work(exercise, 9600)]);
      const repsBefore = reps(r);
      const goodBefore = r.session.snapshot().hold?.goodMs ?? 0;
      r.play(work(exercise, 6400), tvProbe);
      expect(notReal(r)).toBe(true);
      expect(r.session.snapshot().phase).toBe('paused');
      expect(r.session.snapshot().pauseReason).toBe('not-real');
      if (exercise === 'pushup') {
        // At most one rep may slip in before the first fake reading.
        expect(reps(r)).toBeLessThanOrEqual(repsBefore + 1);
        expect(r.events.some((e) => e.type === 'revoke')).toBe(true);
      } else {
        expect(r.session.snapshot().hold?.goodMs ?? 0).toBeLessThan(goodBefore + 600);
      }
    });

    it('leaving the app while paused for a screen keeps the screen check', () => {
      const r = run(level, exercise);
      r.play([...start(exercise), ...work(exercise, 6400)]);
      r.play(work(exercise, 12800), tvProbe);
      expect(r.session.snapshot().pauseReason).toBe('not-real');
      r.session.interrupt(r.t + 10);
      expect(r.session.snapshot().pauseReason).toBe('interrupted');
      r.session.resumeFromInterrupt(r.t + 5000);
      r.t += 5000;
      expect(r.session.snapshot().pauseReason).toBe('not-real');
      // The screen is still there: it stays paused.
      r.play(work(exercise, 3200), tvProbe);
      expect(r.session.snapshot().phase).toBe('paused');
    });

    it('stays paused while the screen is there, and resumes once a real person is back', () => {
      const r = run(level, exercise);
      r.play([...start(exercise), ...work(exercise, 6400)]);
      r.play(work(exercise, 12800), tvProbe);
      expect(r.session.snapshot().phase).toBe('paused');
      r.play([...start(exercise), ...work(exercise, 8000)]);
      expect(r.session.snapshot().phase).toBe('counting');
      const s = r.session.end();
      expect(s.realityFlags).toBe(1);
    });

    it('a screen held up to the camera (shaking picture, still phone) is caught', () => {
      const r = run(level, exercise);
      r.play([...start(exercise), ...work(exercise, 6400)]);
      r.play(work(exercise, 8000), null, { mapFrame: handheld });
      expect(notReal(r)).toBe(true);
    });

    it('the picture shaking because the phone itself moves is not a screen', () => {
      const r = run(level, exercise);
      r.play([...start(exercise), ...work(exercise, 6400)]);
      r.play(work(exercise, 8000), null, { mapFrame: handheld, motion: 12 });
      expect(notReal(r)).toBe(false);
    });

    it('switched off in Settings: a screen is not checked', () => {
      const r = run(level, exercise, { reality: { enabled: false } });
      r.play([...start(exercise), ...work(exercise, 8000)], tvProbe);
      expect(r.session.snapshot().phase).toBe('counting');
    });
  });
});

describe('real person, noisy depth for a long set', () => {
  it.each(DIFFICULTIES)('%s: noisy and sometimes missing depth never flags a real person', (level) => {
    const r = run(level, 'pushup');
    const flaky = (t: number): DepthProbe => {
      const p = realProbe(t);
      return rand() < 0.2 ? { t, body: [NaN, 0, 2], around: [NaN], torsoM: null } : { ...p, around: p.around.map((d) => d + noise(0.4)) };
    };
    r.play([hold(3500), ...Array.from({ length: 40 }, () => rep(1500))], flaky, { base: { noisePx: 4 } });
    expect(notReal(r)).toBe(false);
    expect(reps(r)).toBe(40);
  });
});

describe('real person, heavy camera noise, phone perfectly still', () => {
  it.each(DIFFICULTIES)('%s: never mistaken for a held-up screen', (level) => {
    for (const exercise of ['pushup', 'plank'] as const) {
      for (const [fps, noisePx] of [
        [30, 8],
        [15, 6],
        [30, 12],
        [15, 8],
      ]) {
        const r = run(level, exercise);
        r.play([...start(exercise), ...work(exercise, 24000)], null, { fps, base: { noisePx }, seed: fps + noisePx });
        expect(notReal(r)).toBe(false);
      }
    }
  });
});

describe('a held-up screen with real camera noise (missed before; found in the simulator demo)', () => {
  it.each(DIFFICULTIES)('%s: caught for both exercises at 3 px and 6 px of noise', (level) => {
    for (const exercise of ['pushup', 'plank'] as const) {
      for (const noisePx of [3, 6]) {
        const r = run(level, exercise);
        r.play([...start(exercise), ...work(exercise, 6400)], null, { base: { noisePx } });
        r.play(work(exercise, 8000), null, { mapFrame: handheld, base: { noisePx } });
        expect(notReal(r)).toBe(true);
      }
    }
  });
});
