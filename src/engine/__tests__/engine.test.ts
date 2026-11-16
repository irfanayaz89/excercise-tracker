/// <reference types="jest" />
import { mergeConfig } from '../config';
import { angleDeg, signedOffsetBelowLine } from '../geometry';
import { OneEuroFilter } from '../oneEuro';
import { PushupSession } from '../session';
import { emptySample, hold, levelPhone, move, renderPose, rep, timeline } from '../testing/synth';
import type { PoseSample } from '../types';
import { harness, startCounting } from './helpers';

const tenReps = (ms = 1600, bottom = 80, extra = {}) => Array.from({ length: 10 }, () => rep(ms, bottom, 172, extra));

describe('geometry', () => {
  it('measures joint angles', () => {
    expect(angleDeg({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 })).toBeCloseTo(180);
    expect(angleDeg({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 })).toBeCloseTo(90);
    expect(angleDeg({ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 2 })).toBeNull();
  });

  it('signs hip offset as positive below the line whichever way the user faces', () => {
    expect(signedOffsetBelowLine({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 2 })).toBeCloseTo(2);
    expect(signedOffsetBelowLine({ x: 10, y: 0 }, { x: 0, y: 0 }, { x: 5, y: 2 })).toBeCloseTo(2);
    expect(signedOffsetBelowLine({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: -2 })).toBeCloseTo(-2);
  });

  it('one euro filter is stable on constant input and ignores repeated timestamps', () => {
    const f = new OneEuroFilter(1, 0.007, 1);
    for (let t = 0; t < 1000; t += 33) expect(f.filter(0.5, t)).toBeCloseTo(0.5);
    expect(f.filter(0.9, 990)).toBeCloseTo(0.5);
  });
});

describe('happy path', () => {
  it.each(['left', 'right'] as const)('counts 10 clean reps facing %s', (facing) => {
    const h = harness({ base: { facing } });
    startCounting(h);
    expect(h.session.snapshot().phase).toBe('counting');
    expect(h.cues('start')).toHaveLength(1);
    h.segments([...tenReps(), hold(500)]);
    const s = h.session.snapshot();
    expect(s.reps).toBe(10);
    expect(s.cleanReps).toBe(10);
    expect(h.misses()).toBe(0);
  });

  it('builds a summary with tempo and streaks', () => {
    const h = harness();
    startCounting(h);
    h.segments([...tenReps(1500), hold(400)]);
    const sum = h.session.end('user');
    expect(sum.totalReps).toBe(10);
    expect(sum.bestCleanStreak).toBe(10);
    expect(sum.avgRepMs).toBeGreaterThan(1000);
    expect(sum.avgRepMs).toBeLessThan(1700);
    expect(sum.activeMs).toBeGreaterThan(15000);
    // Ending twice returns the same summary and emits once.
    expect(h.session.end('user')).toBe(sum);
    expect(h.events.filter((e) => e.type === 'ended')).toHaveLength(1);
  });
});

describe('signal robustness', () => {
  it('does not double count with heavy landmark jitter', () => {
    const h = harness({ base: { noisePx: 9 } });
    startCounting(h);
    h.segments([...tenReps(), hold(500)]);
    expect(h.reps()).toBe(10);
  });

  it('jitter while holding a plank never counts reps', () => {
    const h = harness({ base: { noisePx: 9 } });
    startCounting(h);
    h.segments([hold(15000)]);
    expect(h.reps()).toBe(0);
  });

  it('counts at a low or uneven frame rate', () => {
    const h = harness();
    startCounting(h);
    h.segments([...tenReps(), hold(500)], { fps: 15, dropFrame: (i) => i % 7 === 3 });
    expect(h.reps()).toBe(10);
  });

  it('bridges short dropouts without pausing', () => {
    const h = harness();
    startCounting(h);
    h.segments([rep(1600), rep(1600)]);
    h.nobody(600);
    h.segments([rep(1600), rep(1600), hold(400)]);
    expect(h.session.snapshot().phase).toBe('counting');
    expect(h.reps()).toBe(4);
  });

  it('ignores stale, duplicate and malformed frames without throwing', () => {
    const h = harness();
    startCounting(h);
    const good = renderPose(h.t + 33, { elbowDeg: 172 });
    const bad: PoseSample[] = [
      { ...good, t: h.t - 500 },
      { ...good, t: NaN },
      { ...good, t: h.t + 40, width: 0 },
      { ...good, t: h.t + 50, landmarks: good.landmarks.map((l) => ({ ...l, x: NaN })) },
      { ...good, t: h.t + 60, landmarks: good.landmarks.slice(0, 10) },
    ];
    expect(() => bad.forEach((s) => h.session.pushPose(s))).not.toThrow();
    h.t += 60;
    h.segments([rep(1600), hold(400)]);
    expect(h.reps()).toBe(1);
  });

  it('counts using shoulder drop when the elbow is hidden', () => {
    const h = harness();
    startCounting(h);
    h.segments([...Array.from({ length: 5 }, () => rep(1600, 70, 172, { hide: { elbow: 0.1 } })), hold(400)]);
    expect(h.reps()).toBe(5);
  });

  it('keeps counting when the user turns around mid-session', () => {
    const h = harness();
    startCounting(h, { facing: 'left' });
    h.segments([rep(1600), rep(1600)]);
    h.nobody(800);
    h.segments([
      hold(1500, { facing: 'right' }),
      rep(1600, 80, 172, { facing: 'right' }),
      rep(1600, 80, 172, { facing: 'right' }),
      hold(400, { facing: 'right' }),
    ]);
    expect(h.reps()).toBe(4);
  });
});

describe('rep quality', () => {
  it('does not count half reps and cues "go lower"', () => {
    const h = harness();
    startCounting(h);
    h.segments([...Array.from({ length: 5 }, () => rep(1600, 118)), hold(400)]);
    expect(h.reps()).toBe(0);
    expect(h.misses('not-deep-enough')).toBe(5);
    expect(h.cues('miss').length).toBeGreaterThan(0);
  });

  it('ignores tiny dips at the top', () => {
    const h = harness();
    startCounting(h);
    h.segments([...Array.from({ length: 5 }, () => rep(1200, 150)), hold(400)]);
    expect(h.reps()).toBe(0);
    expect(h.misses()).toBe(0);
  });

  it('flags reps that skip lockout and only counts the one that locks out', () => {
    const h = harness();
    startCounting(h);
    h.segments([
      move(700, 172, 80),
      move(700, 80, 138),
      move(700, 138, 80),
      move(700, 80, 138),
      move(700, 138, 80),
      move(800, 80, 172),
      hold(400),
    ]);
    expect(h.misses('no-lockout')).toBe(2);
    expect(h.reps()).toBe(1);
  });

  it('counts sagging reps but marks them not clean', () => {
    const h = harness();
    startCounting(h);
    h.segments([...Array.from({ length: 4 }, () => rep(1600, 80, 172, (k: number) => ({ sag: 0.35 * Math.sin(Math.PI * k) }))), hold(400)]);
    const s = h.session.snapshot();
    expect(s.reps).toBe(4);
    expect(s.cleanReps).toBe(0);
    expect(s.lastRep?.faults).toContain('hips-sagging');
  });

  it('detects piking hips', () => {
    const h = harness();
    startCounting(h);
    h.segments([
      ...Array.from({ length: 3 }, () => rep(1600, 80, 172, (k: number) => ({ sag: -0.35 * Math.sin(Math.PI * k) }))),
      hold(400),
    ]);
    expect(h.session.snapshot().lastRep?.faults).toContain('hips-piking');
  });

  it('flags rushed reps and drops impossible bounces', () => {
    const h = harness();
    startCounting(h);
    h.segments([rep(650), rep(650), hold(300)]);
    expect(h.reps()).toBe(2);
    expect(h.session.snapshot().lastRep?.faults).toContain('rushed');
    const before = h.reps();
    h.segments([rep(250), hold(300), rep(250), hold(300)]);
    expect(h.reps()).toBe(before);
  });

  it('abandons an attempt that stalls at the bottom', () => {
    const h = harness();
    startCounting(h);
    h.segments([move(800, 172, 75), hold(11000, { elbowDeg: 75 }), move(800, 75, 172), hold(400)]);
    expect(h.misses('too-slow')).toBe(1);
    expect(h.reps()).toBe(0);
    // And counting recovers afterwards.
    h.segments([rep(1600), hold(400)]);
    expect(h.reps()).toBe(1);
  });
});

describe('setup gates', () => {
  it('waits for a level, steady phone', () => {
    const h = harness();
    h.play(timeline([hold(3000)], { startT: 1000 }), { roll: 14 });
    expect(h.session.snapshot().phase).toBe('phone-setup');
    expect(h.session.snapshot().phone.issue).toBe('tilted-sideways');
    h.play(timeline([hold(3000)], { startT: h.t + 33 }), { pitch: 30 });
    expect(h.session.snapshot().phone.issue).toBe('leaning');
    h.play(timeline([hold(3000)], { startT: h.t + 33 }), { motion: 40 });
    expect(h.session.snapshot().phone.issue).toBe('moving');
    h.play(timeline([hold(3500)], { startT: h.t + 33 }), { roll: 3 });
    expect(h.session.snapshot().phase).toBe('counting');
  });

  it('explains a phone lying flat or turned the wrong way', () => {
    const flat = harness();
    flat.play(timeline([hold(1500)], { startT: 1000 }), { pitch: 85 });
    expect(flat.session.snapshot().phone.issue).toBe('stand-up');
    const portrait = harness();
    portrait.play(timeline([hold(1500)], { startT: 1000 }), { roll: 88 });
    expect(portrait.session.snapshot().phone.issue).toBe('wrong-orientation');
  });

  it('falls back to manual confirmation without a motion sensor', () => {
    const h = harness();
    h.play(timeline([hold(2000)], { startT: 1000 }), null);
    expect(h.session.snapshot().phone.issue).toBe('no-sensor');
    expect(h.session.snapshot().phase).toBe('phone-setup');
    h.session.confirmPhoneManually();
    h.play(timeline([hold(2000)], { startT: h.t + 33 }), null);
    expect(h.session.snapshot().phase).toBe('counting');
  });

  it('corrects body tilt for a slightly crooked phone', () => {
    const h = harness({ base: { imageRollDeg: 4 } });
    h.play(timeline([hold(3000, { imageRollDeg: 4 })], { startT: 1000 }), { roll: 4 });
    expect(h.session.snapshot().phase).toBe('counting');
  });

  it('tells the user what is out of frame', () => {
    const feet = harness();
    feet.play(timeline([hold(2500, { hide: { ankle: 0.1 } })], { startT: 1000 }));
    expect(feet.session.snapshot().framing.issue).toBe('show-feet');

    const tooFar = harness();
    tooFar.play(timeline([hold(2500, { torsoPx: 120 })], { startT: 1000 }));
    expect(tooFar.session.snapshot().framing.issue).toBe('move-closer');

    const tooClose = harness();
    tooClose.play(timeline([hold(2500, { torsoPx: 450 })], { startT: 1000 }));
    expect(['move-back', 'show-feet']).toContain(tooClose.session.snapshot().framing.issue);

    const facing = harness();
    facing.play(timeline([hold(2500, { shoulderWidth: 2.2, visFar: 0.9 })], { startT: 1000 }));
    expect(facing.session.snapshot().framing.issue).toBe('turn-sideways');

    const empty = harness();
    for (let t = 1000; t < 3000; t += 33) {
      empty.session.pushAttitude(levelPhone(t));
      empty.session.pushPose(emptySample(t));
    }
    expect(empty.session.snapshot().framing.issue).toBe('no-person');
    expect(empty.session.snapshot().phase).toBe('body-check');
  });

  it('warns about low light when the model is unsure of every joint', () => {
    const h = harness();
    h.play(timeline([hold(4000, { visNear: 0.52 })], { startT: 1000 }));
    const f = h.session.snapshot().framing;
    expect(f.hint ?? f.issue).toBe('low-light');
  });

  it('rejects knee push-ups unless allowed', () => {
    const h = harness();
    h.play(timeline([hold(3000, { kneeDeg: 95 })], { startT: 1000 }));
    expect(h.session.snapshot().phase).toBe('body-check');
    expect(h.session.snapshot().plankIssues).toContain('straighten-legs');

    const k = harness({ config: { allowKneeling: true } });
    k.play(timeline([hold(3000, { kneeDeg: 95 })], { startT: 1000 }));
    expect(k.session.snapshot().phase).toBe('counting');
  });

  it('does not start from a sagging or bent-arm plank', () => {
    const sag = harness();
    sag.play(timeline([hold(3000, { sag: 0.4 })], { startT: 1000 }));
    expect(sag.session.snapshot().plankIssues).toContain('hips-sagging');

    const bent = harness();
    bent.play(timeline([hold(3000, { elbowDeg: 120 })], { startT: 1000 }));
    expect(bent.session.snapshot().plankIssues).toContain('straighten-arms');
    expect(bent.session.snapshot().phase).toBe('body-check');
  });

  it('does not start while the user is standing', () => {
    const h = harness();
    h.play(timeline([hold(3000, { bodyTiltDeg: 75 })], { startT: 1000 }));
    expect(h.session.snapshot().phase).toBe('body-check');
  });
});

describe('pause, resume and end', () => {
  it('pauses when tracking is lost and resumes from a new plank, keeping the count', () => {
    const h = harness();
    startCounting(h);
    h.segments([rep(1600), rep(1600), hold(300)]);
    h.nobody(3000);
    expect(h.session.snapshot().phase).toBe('paused');
    expect(h.session.snapshot().pauseReason).toBe('lost-tracking');
    h.segments([hold(1500), rep(1600), hold(400)]);
    expect(h.session.snapshot().phase).toBe('counting');
    expect(h.cues('resume')).toHaveLength(1);
    expect(h.reps()).toBe(3);
  });

  it('pauses when the camera stops sending frames', () => {
    const h = harness();
    startCounting(h);
    h.silence(3000);
    expect(h.session.snapshot().phase).toBe('paused');
  });

  it('pauses when the user stands up', () => {
    const h = harness();
    startCounting(h);
    // People stand up over about a second, not in one frame.
    const standUp = { durationMs: 1000, at: (k: number) => ({ elbowDeg: 172, bodyTiltDeg: 80 * k }) };
    h.segments([rep(1600), standUp, hold(3000, { bodyTiltDeg: 80 })]);
    expect(h.session.snapshot().phase).toBe('paused');
    expect(h.session.snapshot().pauseReason).toBe('left-position');
  });

  it('pauses when the phone is knocked over and waits for it to be level again', () => {
    const h = harness();
    startCounting(h);
    h.play(timeline([hold(500)], { startT: h.t + 33 }), { roll: 50, motion: 200 });
    expect(h.session.snapshot().pauseReason).toBe('phone-moved');
    h.play(timeline([hold(2500)], { startT: h.t + 33 }), { roll: 25 });
    expect(h.session.snapshot().phase).toBe('paused');
    h.play(timeline([hold(3000)], { startT: h.t + 33 }), { roll: 1 });
    expect(h.session.snapshot().phase).toBe('counting');
  });

  it('handles app interruptions', () => {
    const h = harness();
    startCounting(h);
    h.segments([rep(1600)]);
    h.session.interrupt(h.t + 10);
    expect(h.session.snapshot().pauseReason).toBe('interrupted');
    // Frames during the interruption are ignored.
    h.segments([rep(1600)]);
    expect(h.reps()).toBe(1);
    h.session.resumeFromInterrupt(h.t + 10);
    h.segments([hold(1500), rep(1600), hold(400)]);
    expect(h.reps()).toBe(2);
  });

  it('ends at the target rep count', () => {
    const h = harness({ targetReps: 3 });
    startCounting(h);
    h.segments([...tenReps(), hold(400)]);
    expect(h.reps()).toBe(3);
    expect(h.session.snapshot().phase).toBe('ended');
    const ended = h.events.find((e) => e.type === 'ended');
    expect(ended && ended.type === 'ended' && ended.summary.endReason).toBe('target');
  });

  it('ends after a long idle plank or a long pause', () => {
    const idle = harness({ config: { session: { autoEndIdleMs: 8000 } } });
    startCounting(idle);
    idle.segments([rep(1600), hold(10000)]);
    expect(idle.session.snapshot().phase).toBe('ended');

    const paused = harness({ config: { session: { autoEndPausedMs: 5000 } } });
    startCounting(paused);
    paused.nobody(3000);
    paused.silence(6000);
    expect(paused.session.snapshot().phase).toBe('ended');
  });

  it('ignores frames from someone walking into view', () => {
    const h = harness();
    startCounting(h);
    const segs = timeline([rep(1600), rep(1600), hold(400)], { startT: h.t + 33 });
    // Every 10th frame comes from a different, smaller person elsewhere in the image.
    const mixed = segs.map((s, i) => (i % 10 === 5 ? renderPose(s.t, { elbowDeg: 90, torsoPx: 130, wristX: 900 }) : s));
    h.play(mixed);
    expect(h.reps()).toBe(2);
    expect(h.session.snapshot().phase).toBe('counting');
  });

  it('rate-limits repeated coaching cues', () => {
    const h = harness();
    h.play(timeline([hold(10000, { hide: { ankle: 0.1 } })], { startT: 1000 }));
    const framingCues = h.cues('framing').length;
    expect(framingCues).toBeGreaterThan(0);
    expect(framingCues).toBeLessThanOrEqual(4);
  });
});

describe('config', () => {
  it('merges partial overrides without losing defaults', () => {
    const c = mergeConfig({ rep: { downElbowDeg: 100 } });
    expect(c.rep.downElbowDeg).toBe(100);
    expect(c.rep.upElbowDeg).toBe(155);
    expect(new PushupSession({ config: c }).cfg.rep.downElbowDeg).toBe(100);
  });
});
