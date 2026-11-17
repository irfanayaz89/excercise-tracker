/// <reference types="jest" />
/**
 * Front view: the phone faces the user (push-ups and planks: on the floor
 * beyond the hands; crunches: raised beyond the feet). Bodies are built in 3D
 * and photographed by a phone camera (synth3d), so these tests describe the
 * same movements as the side-view tests, seen head-on. Every level, a range of
 * phone placements, every fault head-on can see, and the setups that must
 * never start a set.
 */
import { difficultyConfig, DIFFICULTIES, type Difficulty } from '../difficulty';
import { PushupSession, type SessionEvent } from '../session';
import {
  crunch,
  crunchRest,
  forearmPlank,
  hold,
  levelPhone,
  mulberry32,
  plank,
  rep,
  timeline,
  type Segment,
} from '../testing/synth';
import { timelineFront, type FrontParams } from '../testing/synth3d';
import type { Exercise, PoseSample } from '../types';

const PORTRAIT = { width: 720, height: 1280 };
const LANDSCAPE = { width: 1280, height: 720 };

interface Run {
  session: PushupSession;
  events: SessionEvent[];
  reps: () => number;
  misses: (r?: string) => number;
  faults: (f: string) => number;
  cues: (kind: string, issue?: string) => number;
}

function run(
  exercise: Exercise,
  level: Difficulty,
  segs: Segment[],
  front: FrontParams | ((k: number, i: number) => FrontParams) = {},
  base: Record<string, unknown> = PORTRAIT,
  map?: (s: PoseSample, t: number) => PoseSample,
): Run {
  const session = new PushupSession({ config: difficultyConfig(level, { exercise, view: 'front' }), exercise });
  const events: SessionEvent[] = [];
  session.subscribe((e) => events.push(e));
  for (const f of timelineFront(segs, { base: { noisePx: 2, ...base }, front, mapFrame: map })) {
    session.pushAttitude(levelPhone(f.t));
    session.pushPose(f);
    session.tick(f.t);
  }
  const reps = events.filter((e): e is Extract<SessionEvent, { type: 'rep' }> => e.type === 'rep').map((e) => e.rep);
  return {
    session,
    events,
    reps: () => reps.length,
    misses: (r) => events.filter((e) => e.type === 'miss' && (r === undefined || e.miss.reason === r)).length,
    faults: (f) => reps.filter((r) => r.faults.includes(f as never)).length,
    cues: (kind, issue) =>
      events.filter((e) => e.type === 'cue' && e.cue.kind === kind && (issue === undefined || ('issue' in e.cue && e.cue.issue === issue)))
        .length,
  };
}
const phase = (r: Run) => r.session.snapshot().phase;
const goodMs = (r: Run) => r.session.snapshot().hold?.goodMs ?? 0;

const PLACEMENTS: [string, FrontParams, Record<string, unknown>][] = [
  ['portrait, 1.4 m, on the floor', {}, PORTRAIT],
  ['portrait, 1.2 m', { distanceM: 1.2 }, PORTRAIT],
  ['portrait, 2.0 m', { distanceM: 2.0 }, PORTRAIT],
  ['portrait, lens 20 cm up', { cameraHeightM: 0.2 }, PORTRAIT],
  ['portrait, 30 cm off-centre', { offCentreM: 0.3 }, PORTRAIT],
  ['landscape, 2.0 m', { distanceM: 2.0 }, LANDSCAPE],
];

describe.each(DIFFICULTIES)('front push-ups at %s', (level) => {
  const formOn = level !== 'easy';

  it.each(PLACEMENTS)('counts every push-up (%s)', (_, front, base) => {
    const r = run('pushup', level, [hold(3000), ...Array.from({ length: 6 }, () => rep(1800))], front, base);
    expect(phase(r)).toBe('counting');
    expect(r.reps()).toBe(6);
    expect(r.misses()).toBe(0);
    expect(r.faults('elbows-flaring') + r.faults('uneven')).toBe(0);
  });

  it('half push-ups are not counted', () => {
    const half = level === 'easy' ? 128 : 120;
    const r = run('pushup', level, [hold(3000), rep(1800, half), rep(1800, half), rep(1800)]);
    expect(r.reps()).toBe(1);
    expect(r.misses('not-deep-enough')).toBe(2);
  });

  it(formOn ? 'flaring elbows are flagged' : 'flaring elbows are not judged', () => {
    const r = run('pushup', level, [hold(3000), rep(1800), rep(1800)], { flare: 0.2 });
    expect(r.reps()).toBe(2);
    expect(r.faults('elbows-flaring')).toBe(formOn ? 2 : 0);
  });

  it(formOn ? 'an uneven push-up (one side lower) is flagged' : 'an uneven push-up is not judged', () => {
    const r = run('pushup', level, [hold(3000), rep(1800), rep(1800)], (k, i) => (i === 0 ? {} : { tiltM: 0.12 * Math.sin(Math.PI * k) }));
    expect(r.reps()).toBe(2);
    expect(r.faults('uneven')).toBe(formOn ? 2 : 0);
  });

  it(formOn ? 'rushed push-ups count, flagged' : 'fast push-ups count', () => {
    const r = run('pushup', level, [hold(3000), rep(650), rep(650), hold(600)]);
    expect(r.reps()).toBe(2);
    expect(r.faults('rushed')).toBe(formOn ? 2 : 0);
  });

  it('standing in front of the phone never starts a set', () => {
    const r = run('pushup', level, [hold(5000, { bodyTiltDeg: 80 })]);
    expect(phase(r)).not.toBe('counting');
  });

  it('a body side-on to the phone never starts a front set', () => {
    const session = new PushupSession({ config: difficultyConfig(level, { exercise: 'pushup', view: 'front' }), exercise: 'pushup' });
    for (const f of timeline([hold(4000), rep(1600), rep(1600)])) {
      session.pushAttitude(levelPhone(f.t));
      session.pushPose(f);
      session.tick(f.t);
    }
    expect(session.snapshot().phase).not.toBe('counting');
  });
});

describe.each(DIFFICULTIES)('front plank at %s', (level) => {
  it.each([
    ['forearm', forearmPlank(9000)],
    ['straight arm', plank(9000)],
  ] as const)('times a %s plank', (_, seg) => {
    const r = run('plank', level, [seg]);
    expect(phase(r)).toBe('counting');
    expect(goodMs(r)).toBeGreaterThan(6000);
    expect(r.session.snapshot().hold?.breaks).toBe(0);
  });

  it('standing up stops the clock and pauses the set', () => {
    const r = run('plank', level, [
      forearmPlank(6000),
      forearmPlank(1200, (k) => ({ bodyTiltDeg: 80 * k })),
      forearmPlank(4000, { bodyTiltDeg: 80 }),
    ]);
    const s = r.session.snapshot();
    expect(s.phase).toBe('paused');
    // Standing up right in front of a floor-level phone also takes the head out of the picture.
    expect(['left-position', 'lost-tracking']).toContain(s.pauseReason);
    expect(goodMs(r)).toBeLessThan(7000);
  });
});

describe('crunches are side-on only', () => {
  it.each(DIFFICULTIES)('asking for front view at %s still tracks crunches side-on', (level) => {
    const cfg = difficultyConfig(level, { exercise: 'crunch', view: 'front' });
    expect(cfg.view).toBe('side');
    const session = new PushupSession({ config: cfg, exercise: 'crunch' });
    for (const f of timeline([crunchRest(3000), crunch(2200, 32), crunch(2200, 32)])) {
      session.pushAttitude(levelPhone(f.t));
      session.pushPose(f);
      session.tick(f.t);
    }
    expect(session.snapshot().view).toBe('side');
    expect(session.snapshot().reps).toBe(2);
  });

  it('the side plank also ignores a front setting', () => {
    expect(difficultyConfig('medium', { exercise: 'sidePlank', view: 'front' }).view).toBe('side');
  });

  it('push-ups and the plank do switch to front', () => {
    expect(difficultyConfig('medium', { exercise: 'pushup', view: 'front' }).view).toBe('front');
    expect(difficultyConfig('medium', { exercise: 'plank', view: 'front' }).view).toBe('front');
  });
});

describe('front framing', () => {
  it('asks for both hands when they are out of the picture', () => {
    const r = run('pushup', 'medium', [hold(4000, { hide: { wrist: 0.1 } })]);
    expect(phase(r)).not.toBe('counting');
    expect(r.session.snapshot().framing.issue).toBe('show-hands');
  });

  it('asks you to come closer when far away, and to move back when too close', () => {
    const far = run('pushup', 'medium', [hold(4000)], { distanceM: 6 });
    expect(far.session.snapshot().framing.issue).toBe('move-closer');
    const near = run('pushup', 'medium', [hold(4000)], { distanceM: 0.25 }, LANDSCAPE);
    expect(near.session.snapshot().phase).not.toBe('counting');
  });

  it.each(['pushup', 'plank'] as const)('%s: an upside-down picture never starts, and says so', (exercise) => {
    const segs = exercise === 'plank' ? [forearmPlank(4000)] : [hold(4000)];
    const flip = (s: PoseSample) => ({ ...s, landmarks: s.landmarks.map((l) => ({ ...l, x: 1 - l.x, y: 1 - l.y })) });
    const r = run(exercise, 'medium', segs, {}, PORTRAIT, flip);
    expect(phase(r)).not.toBe('counting');
    expect(r.session.snapshot().framing.issue).toBe('upside-down');
  });
});

describe('front view and the real-person check', () => {
  it('a real person doing push-ups is never mistaken for a video', () => {
    const r = run('pushup', 'hard', [hold(3000), ...Array.from({ length: 10 }, () => rep(1600))]);
    expect(r.reps()).toBe(10);
    expect(r.session.snapshot().pauseReason).toBeNull();
  });

  it('a video of push-ups held up to the camera is caught', () => {
    const shake = (s: PoseSample, t: number) => ({
      ...s,
      landmarks: s.landmarks.map((l) => ({
        ...l,
        x: l.x + 0.012 * Math.sin((2 * Math.PI * 3 * t) / 1000),
        y: l.y + 0.008 * Math.cos((2 * Math.PI * 2.3 * t) / 1000),
      })),
    });
    const r = run('pushup', 'hard', [hold(3000), ...Array.from({ length: 8 }, () => rep(1600))], {}, PORTRAIT, (s, t) =>
      t > 6000 ? shake(s, t) : s,
    );
    expect(r.cues('paused')).toBeGreaterThan(0);
    expect(r.session.end().realityFlags).toBeGreaterThan(0);
  });
});

describe.each(DIFFICULTIES)('randomised front sets at %s', (level) => {
  const TRIALS = Number(process.env.STRESS_TRIALS ?? 15);
  it.each(Array.from({ length: TRIALS }, (_, i) => 7000 + i))('seed %s', (seed) => {
    const rnd = mulberry32(seed);
    const pick = (a: number, b: number) => a + (b - a) * rnd();
    const front: FrontParams = { distanceM: pick(1.2, 2.0), cameraHeightM: pick(0.05, 0.2), offCentreM: pick(-0.25, 0.25) };
    const n = 4 + Math.floor(rnd() * 8);
    const segs: Segment[] = [hold(3000)];
    let reps = 0;
    let halves = 0;
    for (let i = 0; i < n; i++) {
      if (rnd() < 0.75) {
        segs.push(rep(pick(1300, 2600), pick(78, 92)));
        reps++;
      } else {
        segs.push(rep(pick(1300, 2400), pick(128, 140)));
        halves++;
      }
      if (rnd() < 0.3) segs.push(hold(pick(300, 1500)));
    }
    segs.push(hold(600));
    const r = run('pushup', level, segs, front, { ...PORTRAIT, noisePx: pick(1, 4) });
    expect(r.reps()).toBe(reps);
    expect(r.misses('not-deep-enough')).toBeLessThanOrEqual(halves);
  });
});
