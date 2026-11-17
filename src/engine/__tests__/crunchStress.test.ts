/// <reference types="jest" />
/**
 * Randomised crunch sets at every difficulty. Each trial picks a frame shape,
 * facing, body size, arm position, camera noise, misread frames (including
 * the shoulder and hip the count is read from) and a slightly crooked phone,
 * then a mix of full crunches, half crunches, sit-ups and rests. The rep and
 * miss counts must be exact. Seeds are fixed, so a failure always reproduces.
 * More with STRESS_TRIALS=400 npx jest crunchStress.
 */
import { difficultyConfig, type Difficulty } from '../difficulty';
import { crunch, crunchRest, mulberry32, type BodyParams, type CrunchParams, type Segment, type TimelineOptions } from '../testing/synth';
import { LM, type PoseSample } from '../types';
import { harness } from './helpers';

const TRIALS = Number(process.env.STRESS_TRIALS ?? 40);

interface Trial {
  base: Partial<BodyParams>;
  arms: CrunchParams['arms'];
  roll: number;
  spikeEvery: number;
  segments: Segment[];
  reps: number;
  halves: number;
  describe: string;
}

function makeTrial(level: Difficulty, seed: number): Trial {
  const r = mulberry32(seed);
  const pick = (a: number, b: number) => a + (b - a) * r();
  const c = difficultyConfig(level, { exercise: 'crunch' }).crunch;
  const portrait = r() < 0.5;
  const facing = r() < 0.5 ? 'left' : 'right';
  const arms = (['chest', 'head', 'reach'] as const)[Math.floor(r() * 3)];
  const base: Partial<BodyParams> = portrait
    ? { width: 1080, height: 1920, floorY: 1920 * pick(0.6, 0.8), torsoPx: pick(160, 230) }
    : { width: 1280, height: 720, torsoPx: pick(170, 240) };
  base.facing = facing;
  base.noisePx = pick(1, 4);
  const knee = pick(60, Math.min(130, c.maxKneeDeg - 5));
  const segments: Segment[] = [];
  let reps = 0;
  let halves = 0;
  const n = 5 + Math.floor(r() * 10);
  for (let i = 0; i < n; i++) {
    const kind = r();
    if (kind < 0.65) {
      segments.push(crunch(pick(1300, 3200), pick(c.upDeg + 7, 48), { arms, kneeDeg: knee }));
      reps++;
    } else if (kind < 0.85) {
      // Clearly a half crunch: 2° past the "tried" mark, 3° short of the counting
      // mark. Closer than that, one misread frame can tip it either way, as on a real camera.
      segments.push(crunch(pick(1200, 2500), pick(c.partialDeg + 2, c.upDeg - 3), { arms, kneeDeg: knee }));
      halves++;
    } else {
      segments.push(crunch(pick(2200, 3200), pick(65, 80), { arms, kneeDeg: knee }));
      reps++;
    }
    if (r() < 0.4) segments.push(crunchRest(pick(300, 2000), { arms, kneeDeg: knee }));
  }
  segments.push(crunchRest(600, { arms, kneeDeg: knee }));
  return {
    base,
    arms,
    roll: pick(-3, 3),
    spikeEvery: 7 + Math.floor(r() * 6),
    segments,
    reps,
    halves,
    describe: `seed ${seed}: ${portrait ? 'portrait' : 'landscape'}, facing ${facing}, arms ${arms}, knees ${Math.round(knee)}°, ${reps} reps, ${halves} halves`,
  };
}

/** One frame in `every`, one near-side joint is misread. */
function spikes(every: number, seed: number): TimelineOptions['mapFrame'] {
  const r = mulberry32(seed * 7 + 1);
  return (s: PoseSample, t: number) => {
    if (Math.round(t / 33.333) % every !== 0 || s.landmarks.length === 0) return s;
    const lms = s.landmarks.map((l) => ({ ...l }));
    const near = lms[LM.leftHip].visibility > lms[LM.rightHip].visibility ? 'left' : 'right';
    const joint = (['Shoulder', 'Hip', 'Knee', 'Ankle', 'Ear', 'Wrist'] as const)[Math.floor(r() * 6)];
    const i = (LM as Record<string, number>)[`${near}${joint}`];
    lms[i].x += (r() - 0.5) * 0.04;
    lms[i].y += (r() - 0.5) * 0.06;
    return { ...s, landmarks: lms };
  };
}

describe.each(['easy', 'medium', 'hard'] as const)('%s, randomised crunches', (level) => {
  const trials = Array.from({ length: TRIALS }, (_, i) => makeTrial(level, 9000 + i));

  it.each(trials.map((t) => [t.describe, t] as const))('%s', (_d, t) => {
    const h = harness({
      config: difficultyConfig(level, { exercise: 'crunch' }),
      exercise: 'crunch',
      base: { ...t.base, imageRollDeg: t.roll },
    });
    h.segments([crunchRest(2600, { arms: t.arms })]);
    expect(h.session.snapshot().phase).toBe('counting');
    h.segments(t.segments, { mapFrame: spikes(t.spikeEvery, t.spikeEvery * 31) });
    expect(h.session.snapshot().phase).toBe('counting');
    expect(h.reps()).toBe(t.reps);
    expect(h.misses('not-high-enough')).toBe(t.halves);
    expect(h.misses()).toBe(t.halves);
  });
});
