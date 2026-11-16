/// <reference types="jest" />
/**
 * Behaviour seen on a real iPhone 13 (portrait, Easy): in a good plank about
 * one frame in eight misreads the hip or knee (body line 118° between 156°
 * and 178°), and straight arms read 150–160°, not 170°+. These tests replay
 * that kind of signal at Medium and Hard.
 */
import { difficultyConfig } from '../difficulty';
import { hold, rep, type TimelineOptions } from '../testing/synth';
import { LM, type PoseSample } from '../types';
import { harness } from './helpers';

/** Every 8th frame, the near hip and knee jump (a misread joint). */
const spikes: TimelineOptions['mapFrame'] = (s: PoseSample, t: number) => {
  if (Math.round(t / 33.333) % 8 !== 0 || s.landmarks.length === 0) return s;
  const lms = s.landmarks.map((l) => ({ ...l }));
  lms[LM.leftHip].y += 0.16;
  lms[LM.leftKnee].y -= 0.12;
  return { ...s, landmarks: lms };
};

describe.each(['medium', 'hard'] as const)('%s with a real camera', (level) => {
  it('starts from a good plank even when single frames misread the hips', () => {
    const h = harness({ config: difficultyConfig(level) });
    h.segments([hold(3500)], { mapFrame: spikes });
    expect(h.session.snapshot().phase).toBe('counting');
  });

  it('does not flag good reps because of single misread frames', () => {
    const h = harness({ config: difficultyConfig(level) });
    h.segments([hold(2600)]);
    h.segments([rep(1600), rep(1600), rep(1600), rep(1600), hold(400)], { mapFrame: spikes });
    expect(h.reps()).toBe(4);
    expect(h.session.snapshot().cleanReps).toBe(4);
    expect(h.cues('fault')).toHaveLength(0);
  });

  it('still flags hips that really sag through the rep, with the same noise', () => {
    const h = harness({ config: difficultyConfig(level) });
    h.segments([hold(2600)]);
    h.segments([rep(1700, 80, 172, (k) => ({ sag: 0.45 * Math.sin(Math.PI * k) })), hold(400)], { mapFrame: spikes });
    expect(h.reps()).toBe(1);
    expect(h.session.snapshot().cleanReps).toBe(0);
  });

  it('still refuses to start from a plank that really sags', () => {
    const h = harness({ config: difficultyConfig(level) });
    h.segments([hold(4000, { sag: 0.4 })], { mapFrame: spikes });
    expect(h.session.snapshot().phase).toBe('body-check');
  });

  it('counts reps when "straight" arms read about 158°, as on the phone', () => {
    const h = harness({ config: difficultyConfig(level) });
    h.segments([hold(2600, { elbowDeg: 158 })]);
    expect(h.session.snapshot().phase).toBe('counting');
    h.segments([rep(1600, 80, 156), rep(1600, 80, 155), rep(1600, 80, 157), hold(400, { elbowDeg: 156 })]);
    expect(h.reps()).toBe(3);
  });
});
