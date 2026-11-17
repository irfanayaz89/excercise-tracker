/// <reference types="jest" />
/**
 * Rotation Lock on with the phone in landscape: the screen can stay on the
 * other landscape side, and the camera picture reaches the tracker upside
 * down (rotated 180°). The set must not start from it, and must say why.
 * An upright body must never be taken for an upside-down one.
 */
import { difficultyConfig, DIFFICULTIES } from '../difficulty';
import { EXERCISE_IDS } from '../exercises';
import { crunch, crunchRest, hold, plank, rep, sidePlank, type BodyParams, type Segment } from '../testing/synth';
import type { Exercise, PoseSample } from '../types';
import { harness } from './helpers';

const PORTRAIT: Partial<BodyParams> = { width: 720, height: 1280, torsoPx: 130, floorY: 1280 * 0.7 };
const FRAMES = { landscape: {} as Partial<BodyParams>, portrait: PORTRAIT };

/** The start position, then a little work, for each exercise. */
const setOf = (e: Exercise): Segment[] =>
  e === 'crunch'
    ? [crunchRest(3000), crunch(2000, 32), crunch(2000, 32)]
    : e === 'pushup'
      ? [hold(3000), rep(1600), rep(1600)]
      : e === 'sidePlank'
        ? [sidePlank(5000)]
        : [plank(5000)];

/** The picture turned 180°, as an upside-down screen delivers it. */
const flip = (s: PoseSample): PoseSample => ({ ...s, landmarks: s.landmarks.map((l) => ({ ...l, x: 1 - l.x, y: 1 - l.y })) });

const framingCues = (h: ReturnType<typeof harness>, issue: string) =>
  h.events.filter((e) => e.type === 'cue' && e.cue.kind === 'framing' && e.cue.issue === issue).length;

describe.each(EXERCISE_IDS)('%s', (exercise) => {
  describe.each(DIFFICULTIES)('%s', (level) => {
    it.each(Object.entries(FRAMES))('an upside-down picture never starts the set, and says why (%s)', (_, frame) => {
      const h = harness({ config: difficultyConfig(level, { exercise }), exercise, base: frame });
      h.segments(setOf(exercise), { mapFrame: flip });
      const snap = h.session.snapshot();
      expect(snap.phase).toBe('body-check');
      expect(snap.framing.issue).toBe('upside-down');
      expect(framingCues(h, 'upside-down')).toBeGreaterThan(0);
      expect(h.reps()).toBe(0);
      // Turned the right way up: it starts.
      h.segments(setOf(exercise));
      expect(h.session.snapshot().phase).toBe('counting');
    });

    it('an upright body is never called upside down, facing either way', () => {
      for (const facing of ['left', 'right'] as const)
        for (const frame of Object.values(FRAMES)) {
          const h = harness({ config: difficultyConfig(level, { exercise }), exercise, base: { ...frame, facing } });
          h.segments(setOf(exercise));
          expect(framingCues(h, 'upside-down')).toBe(0);
          expect(h.session.snapshot().phase).toBe('counting');
        }
    });
  });

  it('one flipped frame now and then does not block the start', () => {
    const h = harness({ config: difficultyConfig('hard', { exercise }), exercise });
    h.segments(setOf(exercise), { mapFrame: (s, t) => (Math.round(t / 33.3) % 9 === 0 ? flip(s) : s) });
    expect(framingCues(h, 'upside-down')).toBe(0);
  });
});

it('crunches: lying with the legs stretched out flat is not upside down', () => {
  const h = harness({ config: difficultyConfig('hard', { exercise: 'crunch' }), exercise: 'crunch' });
  h.segments([crunchRest(3000, { kneeDeg: 178 })]);
  h.segments([crunchRest(3000, { kneeDeg: 178 })], { mapFrame: flip });
  expect(framingCues(h, 'upside-down')).toBe(0);
});

describe('upside down in other situations', () => {
  // Side plank on Easy with the feet hidden is the one case left to the Rotation
  // Lock reminder: facing the phone, the side on the floor is picked as the lower
  // shoulder, so a flipped picture just swaps sides and no point says which way is up.
  it.each(['pushup', 'crunch', 'plank'] as const)(
    '%s on Easy with the feet out of view: still caught, and upright still starts',
    (exercise) => {
      const cfg = difficultyConfig('easy', { exercise });
      const hidden = { hide: { ankle: 0.1 } };
      const flipped = harness({ config: cfg, exercise, base: hidden });
      flipped.segments(setOf(exercise), { mapFrame: flip });
      expect(flipped.session.snapshot().phase).toBe('body-check');
      expect(flipped.session.snapshot().framing.issue).toBe('upside-down');
      const upright = harness({ config: cfg, exercise, base: hidden });
      upright.segments(setOf(exercise));
      expect(framingCues(upright, 'upside-down')).toBe(0);
      expect(upright.session.snapshot().phase).toBe('counting');
    },
  );

  it.each(EXERCISE_IDS)('%s: phone knocked mid-set and put back the other way up never resumes', (exercise) => {
    const h = harness({ config: difficultyConfig('medium', { exercise }), exercise });
    h.segments(setOf(exercise));
    expect(h.session.snapshot().phase).toBe('counting');
    const before = h.reps() + (h.session.snapshot().hold?.goodMs ?? 0);
    h.segments(setOf(exercise).slice(0, 1), { mapFrame: (s) => s }); // carry on a moment
    h.play(
      [...Array(40)].map((_, i) => ({ t: h.t + 33 * (i + 1), width: 1280, height: 720, landmarks: [] })),
      { roll: 60 },
    );
    expect(h.session.snapshot().phase === 'paused' || h.session.snapshot().phase === 'phone-setup').toBe(true);
    h.segments([...setOf(exercise), ...setOf(exercise)], { mapFrame: flip });
    expect(h.session.snapshot().phase).not.toBe('counting');
    expect(framingCues(h, 'upside-down')).toBeGreaterThan(0);
    expect(h.reps() + (h.session.snapshot().hold?.goodMs ?? 0)).toBeGreaterThanOrEqual(before);
  });

  it('standing or kneeling with the arms up, feet out of view, is never upside down', () => {
    for (const exercise of EXERCISE_IDS) {
      const h = harness({ config: difficultyConfig('easy', { exercise }), exercise, base: { hide: { ankle: 0.1 } } });
      // A push-up body stood up (80°) with the arm reaching past the head.
      h.segments([hold(4000, { bodyTiltDeg: 80, elbowDeg: 60 })]);
      expect(framingCues(h, 'upside-down')).toBe(0);
    }
  });
});
