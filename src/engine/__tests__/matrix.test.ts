/// <reference types="jest" />
/**
 * Edge cases run against every difficulty, in both phone orientations and
 * with the user facing either way. Each scenario states what should happen
 * at each level.
 */
import { difficultyConfig, DIFFICULTIES, type Difficulty } from '../difficulty';
import { checkPlank } from '../gates';
import type { BodyMetrics } from '../types';
import { emptySample, hold, move, rep, timeline, type BodyParams } from '../testing/synth';
import { harness, type Harness } from './helpers';

/** Portrait frames are tall; the body is smaller in pixels. */
const PORTRAIT: Partial<BodyParams> = { width: 720, height: 1280, torsoPx: 130, floorY: 1280 * 0.7 };
const LANDSCAPE: Partial<BodyParams> = {};

const FRAMES = { landscape: LANDSCAPE, portrait: PORTRAIT };

function make(level: Difficulty, base: Partial<BodyParams> = {}, extra: { allowKneeling?: boolean; targetReps?: number } = {}): Harness {
  return harness({ config: difficultyConfig(level, { allowKneeling: extra.allowKneeling }), base, targetReps: extra.targetReps });
}

function start(h: Harness, extra: Partial<BodyParams> = {}): void {
  h.segments([hold(2600, extra)]);
}

const phase = (h: Harness) => h.session.snapshot().phase;

describe.each(DIFFICULTIES)('%s', (level) => {
  describe.each(Object.keys(FRAMES) as (keyof typeof FRAMES)[])('%s frame', (frame) => {
    it.each(['left', 'right'] as const)('counts 10 steady reps facing %s', (facing) => {
      const h = make(level, { ...FRAMES[frame], facing });
      start(h);
      expect(phase(h)).toBe('counting');
      h.segments(Array.from({ length: 10 }, () => rep(1600)));
      expect(h.reps()).toBe(10);
      expect(h.misses()).toBe(0);
      expect(h.session.snapshot().placement?.headSide).toBe(facing);
    });

    it('counts noisy reps at 15 fps without double counting', () => {
      const h = make(level, { ...FRAMES[frame], noisePx: frame === 'portrait' ? 3 : 6 });
      start(h);
      h.segments(Array.from({ length: 8 }, () => rep(1500)), { fps: 15, seed: 3 });
      expect(h.reps()).toBe(8);
    });
  });

  it('never counts while the user just holds a jittery plank', () => {
    const h = make(level, { noisePx: 8 });
    start(h);
    h.segments([hold(20000)], { seed: 11 });
    expect(h.reps()).toBe(0);
  });

  it('counts slow reps (4 s each) and fast reps (0.9 s each)', () => {
    const h = make(level);
    start(h);
    h.segments([rep(4000), rep(4000), rep(900), rep(900)]);
    expect(h.reps()).toBe(4);
  });

  it('does not count a 0.2 s bounce', () => {
    const h = make(level);
    start(h);
    h.segments([rep(200), hold(500), rep(200)]);
    expect(h.reps()).toBe(0);
  });

  it('counts reps that come back to the same slightly-bent "straight" arm the user started from', () => {
    const cfg = difficultyConfig(level);
    const top = cfg.plank.minElbowDeg + 2; // just good enough to start
    const h = make(level);
    h.segments([hold(2600, { elbowDeg: top })]);
    expect(phase(h)).toBe('counting');
    h.segments([rep(1600, 80, top), rep(1600, 80, top), rep(1600, 80, top)]);
    expect(h.reps()).toBe(3);
  });

  it('pauses when the user stands up and resumes with the count kept', () => {
    const h = make(level);
    start(h);
    h.segments([rep(1600), rep(1600)]);
    // Standing up takes about a second; the body rotates up around the feet.
    h.segments([{ durationMs: 1000, at: (k) => ({ elbowDeg: 172, bodyTiltDeg: 80 * k }) }, hold(3000, { bodyTiltDeg: 80 })]);
    expect(phase(h)).toBe('paused');
    expect(h.session.snapshot().pauseReason).toBe('left-position');
    h.segments([hold(2500), rep(1600)]);
    expect(phase(h)).toBe('counting');
    expect(h.reps()).toBe(3);
  });

  it('pauses when the user walks out of view, then picks up again', () => {
    const h = make(level);
    start(h);
    h.segments([rep(1600)]);
    h.nobody(3000);
    expect(phase(h)).toBe('paused');
    expect(h.session.snapshot().pauseReason).toBe('lost-tracking');
    h.segments([hold(2500), rep(1600)]);
    expect(h.reps()).toBe(2);
  });

  it('pauses when the phone is knocked flat on its back or face', () => {
    for (const pitch of [88, -88]) {
      const h = make(level);
      start(h);
      h.play(timeline([hold(600)], { startT: h.t + 33 }), { pitch });
      expect(phase(h)).toBe('paused');
      expect(h.session.snapshot().pauseReason).toBe('phone-moved');
    }
  });

  it('pauses when the phone tips over sideways', () => {
    const h = make(level);
    start(h);
    h.play(timeline([hold(600)], { startT: h.t + 33 }), { roll: 60 });
    expect(phase(h)).toBe('paused');
  });

  it('does not pause for a small bump of the phone', () => {
    const h = make(level);
    start(h);
    h.play(timeline([hold(300)], { startT: h.t + 33 }), { roll: 3, pitch: 5, motion: 30 });
    h.segments([rep(1600)]);
    expect(phase(h)).toBe('counting');
    expect(h.reps()).toBe(1);
  });

  it('survives the app going to the background mid-rep', () => {
    const h = make(level);
    start(h);
    h.segments([rep(1600), move(500, 172, 100)]);
    h.session.interrupt(h.t + 10);
    h.t += 30000;
    h.session.resumeFromInterrupt(h.t);
    h.segments([hold(2500), rep(1600)]);
    expect(phase(h)).toBe('counting');
    expect(h.reps()).toBe(2); // the half rep before the interruption is not counted
  });

  it('ends at the target count', () => {
    const h = make(level, {}, { targetReps: 3 });
    start(h);
    h.segments([rep(1600), rep(1600), rep(1600), rep(1600)]);
    expect(phase(h)).toBe('ended');
    expect(h.reps()).toBe(3);
  });

  it('ignores a second person walking through the frame', () => {
    const h = make(level);
    start(h);
    h.segments([rep(1600)]);
    // Someone else, much bigger and in another spot, for a moment.
    h.segments([hold(300, { torsoPx: 420, wristX: 900 })]);
    h.segments([hold(1000), rep(1600)]);
    expect(h.reps()).toBe(2);
  });

  it('counts with the elbow hidden (baggy sleeve), using the shoulder drop', () => {
    const h = make(level);
    start(h);
    h.segments([rep(1700), rep(1700)], { base: { hide: { elbow: 0.1 } } });
    expect(h.reps()).toBe(2);
  });

  it('a summary with no reps has no NaN', () => {
    const h = make(level);
    start(h);
    const s = h.session.end();
    expect(s.totalReps).toBe(0);
    expect(s.avgRepMs).toBeNull();
    expect(s.avgScore).toBeNull();
    expect(Number.isFinite(s.activeMs)).toBe(true);
  });

  it('ignores garbage input', () => {
    const h = make(level);
    start(h);
    const t = h.t + 33;
    const nan = timeline([hold(33)], { startT: t })[0];
    nan.landmarks = nan.landmarks.map((l) => ({ ...l, x: NaN, y: Infinity }));
    expect(() => {
      h.session.pushPose(nan);
      h.session.pushPose({ ...emptySample(t + 33), width: 0 });
      h.session.pushPose(emptySample(NaN));
      h.session.pushAttitude({ t: t + 40, rollDeg: NaN, pitchDeg: 0, motionDegPerSec: 0 });
      h.session.tick(NaN);
    }).not.toThrow();
    h.t = t + 66;
    h.segments([rep(1600)]);
    expect(h.reps()).toBe(1);
  });
});

describe('easy is forgiving', () => {
  const easy = (base: Partial<BodyParams> = {}) => make('easy', base);

  it('starts and counts knee push-ups', () => {
    const h = easy({ kneeDeg: 95 });
    start(h);
    expect(phase(h)).toBe('counting');
    h.segments([rep(1600), rep(1600), rep(1600)]);
    expect(h.reps()).toBe(3);
  });

  it('starts and counts with legs and feet out of view (portrait, close to the phone)', () => {
    const h = easy({ ...PORTRAIT, hide: { knee: 0.05, ankle: 0.05 } });
    start(h);
    expect(phase(h)).toBe('counting');
    h.segments([rep(1600), rep(1600)]);
    expect(h.reps()).toBe(2);
  });

  it('starts with the head out of view', () => {
    const h = easy({ hide: { ear: 0.05 } });
    start(h);
    expect(phase(h)).toBe('counting');
  });

  it('starts with hips piked high', () => {
    const h = easy({ sag: -0.35 });
    start(h);
    expect(phase(h)).toBe('counting');
  });

  it('starts at a slight angle to the camera', () => {
    const h = easy({ shoulderWidth: 0.9 });
    start(h);
    expect(phase(h)).toBe('counting');
  });

  it('does not judge rushed or sagging reps', () => {
    const h = easy();
    start(h);
    h.segments([rep(700, 80, 172, { sag: 0.4 }), rep(700, 80, 172, { sag: -0.4 })]);
    expect(h.reps()).toBe(2);
    expect(h.session.snapshot().cleanReps).toBe(2);
    expect(h.cues('fault')).toHaveLength(0);
  });

  it('works with a phone leaning 30° against a wall and 10° crooked', () => {
    const h = easy();
    h.play(timeline([hold(2600), rep(1600)], { startT: 1033 }), { roll: 10, pitch: 30 });
    expect(h.reps()).toBe(1);
  });

  it('still does not start while standing or sitting', () => {
    const h = easy();
    h.segments([hold(3000, { bodyTiltDeg: 80 })]);
    expect(phase(h)).toBe('body-check');
    expect(h.session.snapshot().plankIssues).toContain('get-down');
  });

  it('still does not count a quarter rep', () => {
    const h = easy();
    start(h);
    h.segments([rep(1600, 140), rep(1600, 140)]);
    expect(h.reps()).toBe(0);
  });

  it('still does not start lying flat on the floor with bent arms', () => {
    const h = easy();
    h.segments([hold(3000, { elbowDeg: 60 })]);
    expect(phase(h)).toBe('body-check');
  });
});

describe('medium and hard keep their standards', () => {
  it.each(['medium', 'hard'] as const)('%s needs the feet in view', (level) => {
    const h = make(level, { hide: { ankle: 0.05 } });
    start(h);
    expect(phase(h)).toBe('body-check');
    expect(h.session.snapshot().framing.issue).toBe('show-feet');
  });

  it.each(['medium', 'hard'] as const)('%s rejects knee push-ups unless allowed in settings', (level) => {
    const no = make(level, { kneeDeg: 95 });
    start(no);
    expect(phase(no)).toBe('body-check');
    const yes = make(level, { kneeDeg: 95 }, { allowKneeling: true });
    start(yes);
    expect(phase(yes)).toBe('counting');
    yes.segments([rep(1600), rep(1600)]);
    expect(yes.reps()).toBe(2);
  });

  it('medium starts with a slight sag that hard rejects', () => {
    const med = make('medium', { sag: 0.25 });
    start(med);
    expect(phase(med)).toBe('counting');
    const hard = make('hard', { sag: 0.25 });
    start(hard);
    expect(phase(hard)).toBe('body-check');
  });

  it('only hard asks for hands under the shoulders', () => {
    const m: BodyMetrics = {
      t: 0,
      side: 'left',
      elbowDeg: 170,
      bodyLineDeg: 175,
      hipOffset: 0.02,
      kneeDeg: 175,
      neckDeg: 160,
      trunkTiltDeg: 15,
      shoulderHeight: 1.1,
      wristOffset: 0.7, // hands far in front of the shoulders
      torsoPx: 240,
      hipCenter: { x: 0.5, y: 0.6 },
    };
    expect(checkPlank(m, difficultyConfig('easy')).ok).toBe(true);
    expect(checkPlank(m, difficultyConfig('medium')).ok).toBe(true);
    expect(checkPlank(m, difficultyConfig('hard')).issues).toEqual(['hands-under-shoulders']);
  });

  it('easy starts with hips sagging, legs bent and the head hidden; hard lists every issue', () => {
    const m: BodyMetrics = {
      t: 0,
      side: 'left',
      elbowDeg: 142,
      bodyLineDeg: 140,
      hipOffset: 0.4,
      kneeDeg: 100,
      neckDeg: null,
      trunkTiltDeg: 40,
      shoulderHeight: 1,
      wristOffset: 0.6,
      torsoPx: 240,
      hipCenter: { x: 0.5, y: 0.6 },
    };
    expect(checkPlank(m, difficultyConfig('easy')).ok).toBe(true);
    expect(checkPlank(m, difficultyConfig('hard')).issues).toEqual([
      'get-down',
      'straighten-legs',
      'hips-sagging',
      'straighten-arms',
      'hands-under-shoulders',
    ]);
  });

  it('hard flags rushed reps; medium allows a brisk pace', () => {
    const med = make('medium');
    start(med);
    med.segments([rep(1150)]);
    const hard = make('hard');
    start(hard);
    hard.segments([rep(1150)]);
    expect(med.reps()).toBe(1);
    expect(hard.reps()).toBe(1);
    expect(med.session.snapshot().lastRep?.faults).not.toContain('rushed');
    expect(hard.session.snapshot().lastRep?.faults).toContain('rushed');
  });

  it('a medium/hard user standing far away is asked to come closer', () => {
    const h = make('hard', { torsoPx: 90 });
    start(h);
    expect(h.session.snapshot().framing.issue).toBe('move-closer');
  });
});

describe('difficulty presets are internally consistent', () => {
  it.each(DIFFICULTIES)('%s thresholds are ordered', (level) => {
    const c = difficultyConfig(level);
    expect(c.rep.downElbowDeg).toBeLessThan(c.rep.midElbowDeg);
    expect(c.rep.midElbowDeg).toBeLessThan(c.rep.upElbowDeg - 8);
    expect(c.framing.minBodySpan).toBeLessThan(c.framing.maxBodySpan);
    expect(c.rep.minRepMs).toBeLessThan(c.rep.rushedRepMs);
  });

  it.each(DIFFICULTIES)('%s notices a phone that slid back to 75° mid-set', (level) => {
    const h = make(level);
    start(h);
    h.play(timeline([hold(600)], { startT: h.t + 33 }), { pitch: 75 });
    expect(phase(h)).toBe('paused');
    expect(h.session.snapshot().pauseReason).toBe('phone-moved');
  });

  it('measures "knocked over" from where the phone was resting, not from level', () => {
    // Easy auto-passes a phone leaning back 30°; leaning a few more degrees is not "knocked".
    const h = make('easy');
    h.play(timeline([hold(2600)], { startT: 1033 }), { pitch: 30 });
    expect(phase(h)).toBe('counting');
    h.play(timeline([hold(300), rep(1600)], { startT: h.t + 33 }), { pitch: 40 });
    expect(phase(h)).toBe('counting');
    expect(h.reps()).toBe(1);
    // Falling flat on its back from there is.
    h.play(timeline([hold(300)], { startT: h.t + 33 }), { pitch: 88 });
    expect(h.session.snapshot().pauseReason).toBe('phone-moved');
  });

  it('easy is never stricter than medium, and medium never stricter than hard', () => {
    const [e, m, h] = DIFFICULTIES.map((d) => difficultyConfig(d));
    for (const [a, b] of [
      [e, m],
      [m, h],
    ]) {
      expect(a.phone.maxRollDeg).toBeGreaterThanOrEqual(b.phone.maxRollDeg);
      expect(a.phone.maxPitchDeg).toBeGreaterThanOrEqual(b.phone.maxPitchDeg);
      expect(a.plank.maxTrunkTiltDeg).toBeGreaterThanOrEqual(b.plank.maxTrunkTiltDeg);
      expect(a.plank.minElbowDeg).toBeLessThanOrEqual(b.plank.minElbowDeg);
      expect(a.plank.holdMs).toBeLessThanOrEqual(b.plank.holdMs);
      expect(a.rep.downElbowDeg).toBeGreaterThanOrEqual(b.rep.downElbowDeg);
      expect(a.rep.upElbowDeg).toBeLessThanOrEqual(b.rep.upElbowDeg);
      expect(a.framing.minBodySpan).toBeLessThanOrEqual(b.framing.minBodySpan);
      expect(a.framing.maxShoulderWidthRatio).toBeGreaterThanOrEqual(b.framing.maxShoulderWidthRatio);
    }
  });
});

describe('lockout', () => {
  it('hard still wants arms back to straight when the user started straight', () => {
    const h = make('hard');
    start(h); // 172° plank
    h.segments([rep(1600, 80, 148), rep(1600, 80, 148), hold(400, { elbowDeg: 148 })]);
    expect(h.reps()).toBe(0);
    expect(h.misses('no-lockout')).toBeGreaterThan(0);
  });

  it('easy counts reps that stop a little short of the starting arm', () => {
    const h = make('easy');
    start(h);
    h.segments([rep(1600, 80, 150), rep(1600, 80, 150), hold(400, { elbowDeg: 150 })]);
    expect(h.reps()).toBe(2);
  });

  it('a new plank after a pause sets a new lockout', () => {
    const h = make('medium');
    start(h); // straight arms
    h.segments([rep(1600)]);
    h.nobody(3000);
    expect(phase(h)).toBe('paused');
    const tired = difficultyConfig('medium').plank.minElbowDeg + 2;
    h.segments([hold(2000, { elbowDeg: tired }), rep(1600, 80, tired), rep(1600, 80, tired), hold(400, { elbowDeg: tired })]);
    expect(h.reps()).toBe(3);
  });
});

describe('recordings at every level', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Recorder, replay } = require('../recording') as typeof import('../recording');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PushupSession } = require('../session') as typeof import('../session');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { difficultyOverrides } = require('../difficulty') as typeof import('../difficulty');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { levelPhone } = require('../testing/synth') as typeof import('../testing/synth');

  it.each(DIFFICULTIES)('%s replays to the same count, with feet hidden and a crooked phone', (level) => {
    const live = new PushupSession({ config: difficultyConfig(level) });
    const rec = new Recorder();
    const frames = timeline([hold(2600), rep(1500, 105), rep(1500, 85), rep(1500, 75), hold(400)], {
      base: { hide: { ankle: 0.1 }, noisePx: 3 },
    });
    for (const f of frames) {
      const a = levelPhone(f.t, 7, 22, 0);
      live.pushAttitude(a);
      rec.phone(a);
      live.pushPose(f);
      rec.pose(f);
      live.tick(f.t);
    }
    const want = live.end('user');
    const json = JSON.parse(JSON.stringify(rec.finish({ platform: 'test', model: 'synthetic', config: difficultyOverrides(level) })));
    expect(replay(json).totalReps).toBe(want.totalReps);
    // Easy counts all three (feet optional, shallow ok); medium and hard never start without feet.
    expect(want.totalReps).toBe(level === 'easy' ? 3 : 0);
  });

  it('a tuning override keeps the rest of the recorded section', () => {
    const rec = new Recorder();
    const frames = timeline([hold(2600), rep(1500, 105), rep(1500, 105), hold(400)]);
    frames.forEach((f) => {
      rec.phone(levelPhone(f.t));
      rec.pose(f);
    });
    const r = rec.finish({ platform: 'test', model: 'synthetic', config: difficultyOverrides('easy') });
    // Changing only minRepMs must not bring back hard's 95° depth.
    expect(replay(r, { rep: { minRepMs: 250 } }).totalReps).toBe(2);
  });
});

describe('body line colour', () => {
  it('easy never shows a sagging rep as a fault; hard does', () => {
    const states = (level: Difficulty) => {
      const h = make(level);
      start(h);
      const seen = new Set<number>();
      for (const s of timeline([rep(1700, 80, 172, { sag: 0.4 })], { startT: h.t + 33 })) {
        h.play([s]);
        seen.add(h.session.bodyState);
      }
      return seen;
    };
    expect(states('easy').has(2)).toBe(false);
    expect(states('hard').has(2)).toBe(true);
  });
});

describe('interruptions', () => {
  it('an interruption the user has not come back from never ends the set on its own', () => {
    const h = make('easy');
    start(h);
    h.segments([rep(1600)]);
    h.session.interrupt(h.t + 10);
    h.silence(5 * 60 * 1000, false); // camera error screen left open for 5 minutes
    expect(phase(h)).toBe('paused');
    h.session.resumeFromInterrupt(h.t);
    h.silence(61000, false); // back, but walked off: now it may end
    expect(phase(h)).toBe('ended');
    expect(h.reps()).toBe(1);
  });
});

describe('real-phone start problems', () => {
  it.each([
    [11, 11],
    [11, -11],
    [-11, 11],
    [-11, -11],
  ])('a phone 11° crooked does not block the start (image rotated %i°, sensor roll %i°)', (imageRoll, phoneRoll) => {
    // Which way the image turns depends on the camera (the front one is mirrored),
    // so every combination must work. The body slopes about 43° (feet low, shoulders
    // high, e.g. hands on a step): inside Easy's 55° once the crooked phone is allowed for.
    const body = { imageRollDeg: imageRoll, bodyTiltDeg: 20 };
    const h = make('easy', body);
    h.play(timeline([hold(2600)], { startT: 1033, base: body }), { roll: phoneRoll });
    expect(phase(h)).toBe('counting');
  });

  it('easy starts with arms only mostly straight and still counts', () => {
    const h = make('easy');
    h.segments([hold(2000, { elbowDeg: 133 })]);
    expect(phase(h)).toBe('counting');
    h.segments([rep(1600, 85, 133), rep(1600, 85, 133), hold(400, { elbowDeg: 133 })]);
    expect(h.reps()).toBe(2);
  });

  it('easy still waits while the user kneels upright or stands', () => {
    const h = make('easy');
    h.segments([hold(3000, { bodyTiltDeg: 65 })]);
    expect(phase(h)).toBe('body-check');
  });
});
