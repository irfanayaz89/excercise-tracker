/// <reference types="jest" />
/**
 * Randomised planks at every difficulty. Each trial picks a frame shape,
 * facing, body size, camera noise, misread frames, a slightly crooked phone,
 * high or forearm plank, and a few real form breaks (hips sagging or piking
 * for a known time). The number of breaks must be exact and the good-form
 * time must match what was held. Seeds are fixed, so a failure always
 * reproduces. More with STRESS_TRIALS=400 npx jest plankStress.
 */
import { difficultyConfig, type Difficulty } from '../difficulty';
import { mulberry32, plank, timeline, type BodyParams, type Segment, type TimelineOptions } from '../testing/synth';
import { LM, type PoseSample } from '../types';
import { harness } from './helpers';

const TRIALS = Number(process.env.STRESS_TRIALS ?? 40);

interface Trial {
  base: Partial<BodyParams>;
  roll: number;
  spikeEvery: number;
  segments: Segment[];
  breaks: number;
  /** Time held in good form after the start (ms), and the time spent in breaks. */
  heldMs: number;
  brokenMs: number;
  describe: string;
}

function makeTrial(level: Difficulty, seed: number): Trial {
  const r = mulberry32(seed);
  const pick = (a: number, b: number) => a + (b - a) * r();
  const cfg = difficultyConfig(level, { exercise: 'plank' });
  const portrait = r() < 0.5;
  const forearm = r() < 0.5;
  const facing = r() < 0.5 ? 'left' : 'right';
  const base: Partial<BodyParams> = portrait
    ? { width: 1080, height: 1920, floorY: 1920 * pick(0.6, 0.8), torsoPx: pick(190, 270) }
    : { width: 1280, height: 720, torsoPx: pick(200, 290) };
  base.facing = facing;
  base.noisePx = pick(1, 4);
  base.forearm = forearm;
  if (forearm) base.elbowStack = pick(-0.1, 0.15);
  else base.elbowDeg = pick(160, 175);
  // A slight natural sag or pike that stays well inside the limits.
  const rest = pick(-0.3, 0.3) * cfg.hold.sagFault * cfg.hold.warnRatio;
  base.sag = rest;

  const segments: Segment[] = [];
  let breaks = 0;
  let heldMs = 0;
  let brokenMs = 0;
  const first = pick(6000, 10000);
  segments.push(plank(first));
  heldMs += first;
  const n = Math.floor(r() * 4);
  for (let i = 0; i < n; i++) {
    const dur = pick(cfg.hold.graceMs + 1500, cfg.hold.graceMs + 4000);
    const piking = r() < 0.35;
    const amount = piking ? -cfg.hold.pikeFault * pick(1.6, 2.2) : cfg.hold.sagFault * pick(1.6, 2.2);
    segments.push(plank(dur, { sag: amount }));
    brokenMs += dur;
    breaks++;
    const after = pick(4000, 8000);
    segments.push(plank(after));
    heldMs += after;
  }
  // Things that must never stop the clock, scattered through the hold.
  const extras = 1 + Math.floor(r() * 3);
  for (let i = 0; i < extras; i++) {
    const kind = r();
    if (kind < 0.35) {
      // Near miss: hips drift well inside the limits (a warning at most).
      const dur = pick(2000, 4000);
      segments.push(plank(dur, { sag: r() < 0.5 ? cfg.hold.sagFault * pick(0.3, 0.7) : -cfg.hold.pikeFault * pick(0.3, 0.7) }));
      heldMs += dur;
    } else if (kind < 0.7) {
      // A blip past the limit that ends inside the grace period.
      const dur = pick(150, cfg.hold.graceMs - 600);
      segments.push(plank(dur, { sag: cfg.hold.sagFault * 2 }));
      heldMs += dur;
    } else if (!cfg.allowKneeling) {
      // Knees a little soft, but above the limit.
      const dur = pick(2000, 4000);
      segments.push(plank(dur, { kneeDeg: cfg.plank.minKneeDeg - cfg.hold.kneeBendDeg + pick(4, 10) }));
      heldMs += dur;
    } else {
      const dur = pick(2000, 4000);
      segments.push(plank(dur, { kneeDeg: pick(95, 140) })); // knee planks are fine here
      heldMs += dur;
    }
    const settle = pick(1500, 3000);
    segments.push(plank(settle));
    heldMs += settle;
  }
  return {
    base,
    roll: pick(-3, 3),
    spikeEvery: 7 + Math.floor(r() * 6),
    segments,
    breaks,
    heldMs,
    brokenMs,
    describe: `seed ${seed}: ${portrait ? 'portrait' : 'landscape'} ${forearm ? 'forearm' : 'high'}, facing ${facing}, torso ${Math.round(
      base.torsoPx!,
    )}px, rest ${rest.toFixed(3)}, ${breaks} breaks`,
  };
}

/** One frame in `every`, one near-side joint is misread. */
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

describe.each(['easy', 'medium', 'hard'] as const)('%s, randomised planks', (level) => {
  const cfg = difficultyConfig(level, { exercise: 'plank' });
  const trials = Array.from({ length: TRIALS }, (_, i) => makeTrial(level, 5000 + i));

  it.each(trials.map((t) => [t.describe, t] as const))('%s', (_d, t) => {
    const h = harness({ config: cfg, base: t.base, exercise: 'plank' });
    const opts = { startT: 1033, base: t.base, mapFrame: spikes(t.spikeEvery, t.breaks * 31 + 7) };
    // Phone settles, then the start hold.
    h.play(timeline([plank(3500)], opts), { roll: t.roll });
    const start = h.session.snapshot();
    expect(`${start.phase} ${start.pauseReason ?? ''} ${start.framing.issue ?? ''} ${start.plankIssues.join(',')}`.trim()).toBe('counting');
    const before = start.hold?.goodMs ?? 0;
    h.play(timeline(t.segments, { ...opts, startT: h.t + 33 }), { roll: t.roll });

    const s = h.session.snapshot();
    expect(s.phase).toBe('counting');
    expect(s.hold?.variant).toBe(t.base.forearm ? 'forearm' : 'high');
    expect(s.hold?.breaks).toBe(t.breaks);
    // Each break costs the time out of form plus the restore delay, minus up
    // to the grace period at its start (counted until the break is confirmed,
    // then taken back) and a little filter lag at each edge.
    const goodMs = (s.hold?.goodMs ?? 0) - before;
    const slack = 400 * t.breaks + 300;
    expect(goodMs).toBeLessThanOrEqual(t.heldMs + slack);
    expect(goodMs).toBeGreaterThanOrEqual(t.heldMs - t.breaks * (cfg.hold.restoreMs + 400) - 300);
  });
});
