/// <reference types="jest" />
// Regression tests for defects found in review. Each test fails on the old code.
import { attitudeFromGravity } from '../attitude';
import { Recorder, replay } from '../recording';
import { emptySample, hold, levelPhone, rep, timeline } from '../testing/synth';
import { harness, startCounting } from './helpers';

describe('regressions', () => {
  it('pauses for another person instead of counting their reps', () => {
    const h = harness();
    startCounting(h);
    h.segments([rep(1600)]);
    expect(h.reps()).toBe(1);
    // A different body (other place, other size) replaces the user and keeps doing reps.
    h.segments([rep(1600), rep(1600), rep(1600)], { base: { wristX: 1280 * 0.55, torsoPx: 340 } });
    expect(h.session.snapshot().phase).toBe('paused');
    expect(h.session.snapshot().pauseReason).toBe('other-person');
    expect(h.reps()).toBe(1);
  });

  it('catches a smaller swap to another person that smoothing would spread out', () => {
    const h = harness();
    startCounting(h);
    h.segments([rep(1600)]);
    // About 80% of the position limit and 85% of the size limit at once.
    h.segments([rep(1600), rep(1600)], { base: { wristX: 1280 * 0.42, torsoPx: 168 } });
    const paused = h.events.some((e) => e.type === 'cue' && e.cue.kind === 'paused' && e.cue.reason === 'other-person');
    expect(paused).toBe(true);
    expect(h.reps()).toBe(1);
  });

  it('a single misread hip never makes the user look like someone else', () => {
    const h = harness();
    startCounting(h);
    // One frame in seven the hip is read 30% of the way towards the shoulder
    // (a shorter torso), as seen in a randomised set; the user keeps doing reps.
    h.segments([rep(1600), rep(1600), rep(1600), rep(1600)], {
      mapFrame: (s, t) => {
        if (Math.round(t / 33.333) % 7 !== 0 || s.landmarks.length === 0) return s;
        const lms = s.landmarks.map((l) => ({ ...l }));
        for (const [hip, sh] of [
          [23, 11],
          [24, 12],
        ]) {
          lms[hip] = { ...lms[hip], x: lms[hip].x + (lms[sh].x - lms[hip].x) * 0.3, y: lms[hip].y + (lms[sh].y - lms[hip].y) * 0.3 };
        }
        return { ...s, landmarks: lms };
      },
    });
    expect(h.events.some((e) => e.type === 'cue' && e.cue.kind === 'paused')).toBe(false);
    expect(h.reps()).toBe(4);
  });

  it('does not start counting from a plank hold interrupted by the app going to background', () => {
    const h = harness();
    h.segments([hold(1000 + 1000 * 0.35)]); // phone settles (1 s) + part of the plank hold
    expect(h.session.snapshot().phase).toBe('body-check');
    h.session.interrupt(h.t);
    h.t += 20000;
    h.session.resumeFromInterrupt(h.t);
    h.segments([hold(100)]);
    expect(h.session.snapshot().phase).toBe('body-check');
  });

  it('does not count a camera stall as holding the plank', () => {
    const h = harness();
    h.segments([hold(1000 + 400)]);
    expect(h.session.snapshot().phase).toBe('body-check');
    h.silence(3000);
    h.segments([hold(66)]);
    expect(h.session.snapshot().phase).toBe('body-check');
    expect(h.session.snapshot().plankProgress).toBeLessThan(0.2);
  });

  it('keeps plank progress through a single dropped detection', () => {
    const h = harness();
    h.segments([hold(1000 + 700)]);
    const before = h.session.snapshot().plankProgress;
    expect(before).toBeGreaterThan(0.2);
    h.t += 33;
    h.session.pushAttitude(levelPhone(h.t));
    h.session.pushPose(emptySample(h.t));
    h.session.tick(h.t);
    h.segments([hold(66)]);
    expect(h.session.snapshot().plankProgress).toBeGreaterThan(before);
  });

  it('replay pauses on a camera stall like the live session does', () => {
    const h = harness();
    const rec = new Recorder();
    h.session.subscribe(() => {});
    const feed = (samples: ReturnType<typeof timeline>) => {
      for (const s of samples) {
        const a = levelPhone(s.t);
        h.session.pushAttitude(a);
        rec.phone(a);
        h.session.pushPose(s);
        rec.pose(s);
        h.session.tick(s.t);
        h.t = s.t;
      }
    };
    feed(timeline([hold(2600), rep(1600)], { startT: 1033 }));
    h.silence(3000); // live: ticks keep running, no frames
    feed(timeline([hold(2600), rep(1600)], { startT: h.t + 33 }));
    const live = h.session.end('user');
    const replayed = replay(rec.finish({ platform: 'test', model: 'full' }));
    expect(live.pauses).toBe(1);
    expect(replayed.pauses).toBe(live.pauses);
    expect(replayed.totalReps).toBe(live.totalReps);
  });

  it('replays frames whose landmarks have no presence value', () => {
    const rec = new Recorder();
    const samples = timeline([hold(2600), rep(1600), rep(1600)], { startT: 1033 });
    for (const s of samples) {
      rec.phone(levelPhone(s.t));
      rec.pose({ ...s, landmarks: s.landmarks.map((l) => ({ ...l, presence: undefined as unknown as number })) });
    }
    expect(replay(rec.finish({ platform: 'test', model: 'full' })).totalReps).toBe(2);
  });

  it('reads the same physical phone turn the same on both landscape sides and both platforms', () => {
    const G = 9.81;
    const th = (5 * Math.PI) / 180;
    // Turning the phone rotates gravity the same way in device axes on either side.
    const sideA = attitudeFromGravity(G * Math.cos(th), G * Math.sin(th), 0, 'landscape')!.rollDeg;
    const sideB = attitudeFromGravity(-G * Math.cos(th), -G * Math.sin(th), 0, 'landscape')!.rollDeg;
    expect(sideA).toBeCloseTo(5);
    expect(sideB).toBeCloseTo(5);
    // The other platform reports every axis with the opposite sign.
    expect(attitudeFromGravity(-G * Math.cos(th), -G * Math.sin(th), 0, 'landscape')!.rollDeg).toBeCloseTo(sideA);
    const up = attitudeFromGravity(G * Math.sin(th), -G * Math.cos(th), 0, 'portrait')!.rollDeg;
    const upFlipped = attitudeFromGravity(-G * Math.sin(th), G * Math.cos(th), 0, 'portrait')!.rollDeg;
    expect(Math.abs(up)).toBeCloseTo(5);
    expect(upFlipped).toBeCloseTo(up);
  });

  it('does not count time away from the app toward the paused auto-end', () => {
    const h = harness();
    startCounting(h);
    h.segments([rep(1600)]);
    h.nobody(2500); // lost → paused
    expect(h.session.snapshot().phase).toBe('paused');
    h.session.interrupt(h.t);
    h.t += 90000; // 90 s in another app
    h.session.resumeFromInterrupt(h.t);
    h.session.tick(h.t + 100);
    expect(h.session.snapshot().phase).toBe('paused');
  });

  it('stops the active clock when tracking was lost, not when the pause fires', () => {
    const h = harness();
    startCounting(h);
    h.segments([rep(1600)]);
    const activeBefore = h.session.snapshot().elapsedMs;
    h.nobody(2500);
    expect(h.session.snapshot().phase).toBe('paused');
    expect(h.session.snapshot().elapsedMs - activeBefore).toBeLessThan(200);
  });
});
