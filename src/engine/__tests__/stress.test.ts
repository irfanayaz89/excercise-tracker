/// <reference types="jest" />
/**
 * Randomised sets at every difficulty. Each trial builds a new set with random
 * noise, misread frames, speeds, depths, body size, frame shape (iPhone
 * portrait 1080×1920 or landscape 1280×720), facing and a slightly crooked
 * phone, then checks the count is exactly right. Seeds are fixed, so a
 * failure always reproduces.
 */
import { difficultyConfig, type Difficulty } from '../difficulty';
import { hold, mulberry32, rep, timeline, type BodyParams, type Segment, type TimelineOptions } from '../testing/synth';
import { LM, type PoseSample } from '../types';
import { harness } from './helpers';

/** More with STRESS_TRIALS=400 npx jest stress. */
const TRIALS = Number(process.env.STRESS_TRIALS ?? 40);

interface Trial {
  base: Partial<BodyParams>;
  roll: number;
  spikeEvery: number;
  reps: Segment[];
  good: number;
  half: number;
  describe: string;
}

function makeTrial(level: Difficulty, seed: number): Trial {
  const r = mulberry32(seed);
  const pick = (a: number, b: number) => a + (b - a) * r();
  const portrait = r() < 0.5;
  const facing = r() < 0.5 ? 'left' : 'right';
  const cfg = difficultyConfig(level);
  // Body size that keeps head to feet inside the frame (the level requires the feet).
  const base: Partial<BodyParams> = portrait
    ? { width: 1080, height: 1920, floorY: 1920 * pick(0.6, 0.8), torsoPx: pick(190, 270) }
    : { width: 1280, height: 720, torsoPx: pick(200, 290) };
  base.facing = facing;
  // Easy does not need the feet: half its sets have the legs out of view, as in a small room.
  if (level === 'easy' && r() < 0.5) base.hide = { ankle: 0.05, knee: 0.05 };
  base.noisePx = pick(1, 5);
  const roll = pick(-4, 4);
  const top = pick(158, 175);
  const reps: Segment[] = [];
  let good = 0;
  let half = 0;
  const n = 6 + Math.floor(r() * 6);
  for (let i = 0; i < n; i++) {
    const dur = pick(1000, 2600);
    if (r() < 0.2) {
      // A half rep that turns back well above the halfway mark: never counted.
      reps.push(rep(dur, pick(cfg.rep.midElbowDeg + 8, cfg.rep.midElbowDeg + 14), top));
      half++;
    } else {
      reps.push(rep(dur, pick(60, cfg.rep.downElbowDeg - 12), top));
      good++;
    }
    if (r() < 0.4) reps.push(hold(pick(200, 1500), { elbowDeg: top }));
  }
  reps.push(hold(500, { elbowDeg: top }));
  return {
    base: { ...base, elbowDeg: top },
    roll,
    spikeEvery: 6 + Math.floor(r() * 7),
    reps,
    good,
    half,
    describe: `seed ${seed}: ${portrait ? 'portrait' : 'landscape'}, facing ${facing}, torso ${Math.round(base.torsoPx!)}px, top ${Math.round(top)}°, roll ${roll.toFixed(1)}°, ${good} good + ${half} half reps`,
  };
}

/** One frame in `every`, a near-side joint is misread. */
function spikes(every: number, seed: number): TimelineOptions['mapFrame'] {
  const r = mulberry32(seed * 7 + 1);
  return (s: PoseSample, t: number) => {
    if (Math.round(t / 33.333) % every !== 0 || s.landmarks.length === 0) return s;
    const lms = s.landmarks.map((l) => ({ ...l }));
    const near = lms[LM.leftHip].visibility > lms[LM.rightHip].visibility ? 'left' : 'right';
    const joint = (['Hip', 'Knee', 'Ankle', 'Elbow'] as const)[Math.floor(r() * 4)];
    const i = (LM as Record<string, number>)[`${near}${joint}`];
    lms[i].x += (r() - 0.5) * 0.08;
    lms[i].y += (r() - 0.5) * 0.12;
    return { ...s, landmarks: lms };
  };
}

describe.each(['easy', 'medium', 'hard'] as const)('%s, randomised sets', (level) => {
  const trials = Array.from({ length: TRIALS }, (_, i) => makeTrial(level, 1000 + i));

  it.each(trials.map((t) => [t.describe, t] as const))('%s', (_d, t) => {
    const h = harness({ config: difficultyConfig(level), base: t.base });
    const opts = { startT: 1033, base: t.base, mapFrame: spikes(t.spikeEvery, t.good * 31 + t.half) };
    // Phone settles (1 s at Hard), then the start hold.
    h.play(timeline([hold(4500, { elbowDeg: t.base.elbowDeg })], opts), { roll: t.roll });
    const snap = h.session.snapshot();
    expect(`${snap.phase} ${snap.framing.issue ?? ''} ${snap.plankIssues.join(',')}`.trim()).toBe('counting');
    h.play(timeline(t.reps, { ...opts, startT: h.t + 33 }), { roll: t.roll });
    expect(h.reps()).toBe(t.good);
    // Good form with camera noise: nothing about the hips should be flagged.
    const hipFlags = h.events.filter((e) => e.type === 'rep' && e.rep.faults.some((f) => f === 'hips-sagging' || f === 'hips-piking'));
    expect(hipFlags).toHaveLength(0);
  });
});
