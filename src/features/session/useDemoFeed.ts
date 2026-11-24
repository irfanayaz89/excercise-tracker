import { useEffect, useLayoutEffect, useRef } from 'react';
import type { DepthProbe } from '@/engine/reality';
import {
  crunch,
  crunchMove,
  crunchRest,
  emptySample,
  hold,
  plank,
  rep,
  sidePlank,
  timeline,
  type BodyParams,
  type Segment,
} from '@/engine/testing/synth';
import { pullupFrames, pullupRep, type PullupKey } from '@/engine/testing/pullupSynth';
import { timelineFront } from '@/engine/testing/synth3d';
import type { CameraView, Exercise, PhoneAttitude, PoseSample } from '@/engine/types';
import { EXERCISES, isTimed } from '@/engine/exercises';

/**
 * Demo scenarios (`?demo=<name>`): each plays one situation through the real
 * engine with a synthetic body, so every edge case can be seen on a simulator.
 *
 * - `1` / `basic`: a normal set with a few form problems along the way.
 * - `nofeet`: the legs never in view (a room too small for the whole body).
 * - `standup`: stands up mid-set, then comes back.
 * - `lost`: walks out of view, then comes back.
 * - `swap`: someone else takes the spot for a few seconds.
 * - `knocked`: the phone is knocked over, then put back.
 * - `shake`: a video of the set held up to the camera (picture shakes, phone still).
 * - `tv`: a video of the set on a TV (flat depth readings), then the real person again.
 * - `faults`: push-ups: half reps, no lockout, sagging, rushing. Plank: sag break,
 *   raised hips, soft knees, a switch to the forearms. Pull-ups: a half rep, a
 *   second pull without a dead hang, a kip, a swing, an uneven pull, a drop.
 */
export type DemoScenario = 'basic' | 'nofeet' | 'standup' | 'lost' | 'swap' | 'knocked' | 'shake' | 'tv' | 'faults';

export const DEMO_SCENARIOS: DemoScenario[] = ['basic', 'nofeet', 'standup', 'lost', 'swap', 'knocked', 'shake', 'tv', 'faults'];

export function demoScenario(param: string | undefined): DemoScenario | null {
  if (param === undefined) return null;
  if (param === '1') return 'basic';
  return (DEMO_SCENARIOS as string[]).includes(param) ? (param as DemoScenario) : null;
}

/** One stretch of a scenario, with what else happens during it. */
interface Part {
  segs: Segment[];
  /** Model finds nobody. */
  nobody?: boolean;
  /** Phone roll during this stretch (knocked over). */
  roll?: number;
  /** Depth readings: a real person in a room, or a flat screen. */
  depth?: 'real' | 'flat';
  /** The whole picture shakes (a screen held up to the camera). */
  shake?: boolean;
  /** Body changes for this stretch (e.g. someone else). */
  body?: Partial<BodyParams>;
}

const holdOf = (ex: Exercise) => (ex === 'sidePlank' ? sidePlank : plank);
const work = (ex: Exercise, n: number): Segment[] =>
  isTimed(ex) ? [holdOf(ex)(n * 1600)] : Array.from({ length: n }, () => (ex === 'crunch' ? crunch(2000, 32) : rep(1600)));
const start = (ex: Exercise, ms = 3000): Segment[] => (isTimed(ex) ? [holdOf(ex)(ms)] : ex === 'crunch' ? [crunchRest(ms)] : [hold(ms)]);

/** Crunches: a normal set, sitting up to rest, and every fault. */
function crunchScript(s: DemoScenario): Part[] | null {
  if (s === 'basic')
    return [
      {
        segs: [
          crunchRest(3000),
          crunch(2200, 32),
          crunch(2200, 32),
          crunch(2200, 34, (k) => ({ feetUp: 0.4 * Math.sin(Math.PI * k) })), // feet lifting: flagged
          crunch(2000, 32),
          crunch(1800, 13), // half crunch: not counted
          crunch(2200, 32),
          crunch(2200, 32),
          crunchRest(1500),
        ],
      },
    ];
  if (s === 'standup')
    return [
      { segs: [...start('crunch'), ...work('crunch', 4)] },
      { segs: [crunchMove(1500, 0, 85), crunchMove(3500, 85, 85), crunchMove(1500, 85, 0)] }, // sits up to rest: paused
      { segs: [...start('crunch', 2500), ...work('crunch', 5)] },
    ];
  if (s === 'swap')
    // Someone else, smaller, lying further along the mat (a crunch body is placed by its hips).
    return [
      { segs: [...start('crunch'), ...work('crunch', 4)] },
      { segs: work('crunch', 3), body: { torsoPx: 150, wristX: 330 } },
      { segs: [...start('crunch', 2500), ...work('crunch', 4)] },
    ];
  if (s === 'faults')
    return [
      {
        segs: [
          crunchRest(3000),
          crunch(2200, 32),
          crunch(1800, 13), // half crunch: not counted
          crunch(2800, 75), // sat all the way up: flagged
          crunch(2200, 34, (k) => ({ feetUp: 0.4 * Math.sin(Math.PI * k) })), // feet lifting: flagged
          crunch(650, 32), // rushed: flagged
          crunch(650, 32),
          crunchRest(800),
          crunch(2400, 32, (k) => ({ neckFlexDeg: 55 * Math.sin(Math.PI * k) })), // pulling the neck: a tip
          crunchMove(900, 0, 32),
          crunchMove(700, 32, 8),
          crunchMove(700, 8, 32), // pulsing without lowering to the floor: not counted twice
          crunchMove(900, 32, 0),
          crunch(2200, 32),
          crunchRest(1500),
        ],
      },
    ];
  return null;
}

/** Side plank: left side with a hip drop, get up, turn around, right side; then the faults. */
function sidePlankScript(s: DemoScenario): Part[] | null {
  const up = (facing: 'left' | 'right'): Part => ({
    segs: [plank(1200, (k) => ({ bodyTiltDeg: 80 * k, stack: 0.7 })), plank(2500, { bodyTiltDeg: 80, stack: 0.7 })],
    body: { facing },
  });
  if (s === 'basic')
    return [
      { segs: [sidePlank(14000)], body: { facing: 'left' } },
      {
        segs: [
          sidePlank(3500, (k) => ({ sag: 0.3 * k })),
          sidePlank(2000, { sag: 0.3 }),
          sidePlank(1000, (k) => ({ sag: 0.3 * (1 - k) })),
          sidePlank(6000),
        ],
        body: { facing: 'left' },
      },
      up('left'),
      { segs: [sidePlank(800, (k) => ({ bodyTiltDeg: 80 * (1 - k) })), sidePlank(16000)], body: { facing: 'right' } },
    ];
  if (s === 'faults')
    return [
      { segs: [sidePlank(3000), sidePlank(5000)] },
      { segs: [sidePlank(3500, { sag: 0.3 }), sidePlank(3000)] }, // hips drop: a break
      { segs: [sidePlank(3500, { stack: 0.1 }), sidePlank(3000)] }, // rolled forward: a break
      { segs: [sidePlank(3500, { kneeDeg: 130 }), sidePlank(3000)] }, // soft knees: break on Medium/Hard
      { segs: [plank(8000, { stack: 0.7 })] }, // straight-arm side plank
    ];
  return null;
}

function script(ex: Exercise, s: DemoScenario): Part[] {
  if (ex === 'crunch') {
    const own = crunchScript(s);
    if (own) return own;
  }
  if (ex === 'sidePlank') {
    const own = sidePlankScript(s);
    if (own) return own;
  }
  switch (s) {
    case 'basic':
      return isTimed(ex)
        ? [
            { segs: [plank(1600, { hide: { ankle: 0.1 } }), plank(18000)] },
            {
              segs: [
                plank(4000, (k) => ({ sag: 0.3 * k })),
                plank(2500, { sag: 0.3 }),
                plank(1200, (k) => ({ sag: 0.3 * (1 - k) })),
                plank(10000),
              ],
            },
          ]
        : [
            {
              segs: [
                hold(1600, { hide: { ankle: 0.1 } }),
                hold(2600),
                rep(1700),
                rep(1700),
                rep(1600),
                rep(1700, 80, 172, (k) => ({ sag: 0.4 * Math.sin(Math.PI * k) })),
                rep(1500, 118),
                rep(1700),
                rep(1600),
                hold(1200),
                rep(1700),
                rep(1700),
                hold(2000),
              ],
            },
          ];
    case 'nofeet':
      return [{ segs: [...start(ex), ...work(ex, 8)], body: { hide: { ankle: 0.1, knee: 0.1 } } }];
    case 'standup': {
      const up = plank; // a straight-arm hold either way; plank() also takes a changing body
      return [
        { segs: [...start(ex), ...work(ex, 4)] },
        {
          segs: [
            up(1500, (k) => ({ bodyTiltDeg: 80 * k })),
            up(4000, { bodyTiltDeg: 80 }),
            up(1500, (k) => ({ bodyTiltDeg: 80 * (1 - k) })),
          ],
        },
        { segs: [...start(ex, 2500), ...work(ex, 5)] },
      ];
    }
    case 'lost':
      return [
        { segs: [...start(ex), ...work(ex, 4)] },
        { segs: [plank(4000)], nobody: true },
        { segs: [...start(ex, 2500), ...work(ex, 5)] },
      ];
    case 'swap':
      return [
        { segs: [...start(ex), ...work(ex, 4)] },
        { segs: work(ex, 3), body: { torsoPx: 150, wristX: 700 } },
        { segs: [...start(ex, 2500), ...work(ex, 4)] },
      ];
    case 'knocked':
      return [{ segs: [...start(ex), ...work(ex, 4)] }, { segs: work(ex, 2), roll: 50 }, { segs: [...start(ex, 3000), ...work(ex, 5)] }];
    case 'shake':
      return [{ segs: [...start(ex), ...work(ex, 4)] }, { segs: work(ex, 5), shake: true }, { segs: [...start(ex, 3000), ...work(ex, 5)] }];
    case 'tv':
      return [
        { segs: [...start(ex), ...work(ex, 4)], depth: 'real' },
        { segs: work(ex, 5), depth: 'flat' },
        { segs: [...start(ex, 3500), ...work(ex, 5)], depth: 'real' },
      ];
    case 'faults':
      return isTimed(ex)
        ? [
            { segs: [plank(3000), plank(6000)] },
            { segs: [plank(3500, { sag: 0.3 }), plank(3000)] }, // sag past the limit: a break
            { segs: [plank(4000, { sag: -0.08 }), plank(2000)] }, // hips slightly up: no cue
            { segs: [plank(3500, { kneeDeg: 130 }), plank(3000)] }, // soft knees: break on Medium/Hard
            { segs: [plank(600, (k) => ({ elbowDeg: 172 - 60 * k })), plank(8000, { forearm: true })] }, // down to forearms
          ]
        : [
            {
              segs: [
                hold(3000),
                rep(1600),
                rep(1500, 125), // half rep: not counted
                rep(1600),
                rep(1600, 80, 140), // no lockout: not counted on Medium/Hard
                hold(800),
                rep(1700, 80, 172, (k) => ({ sag: 0.4 * Math.sin(Math.PI * k) })), // sagging: flagged
                rep(650), // rushed: flagged
                rep(1600),
                hold(1500),
              ],
            },
          ];
  }
}

/** One stretch of a pull-up scenario (pull-ups have their own head-on body, hanging from a bar). */
interface PullPart {
  keys: PullupKey[];
  nobody?: boolean;
  roll?: number;
  depth?: 'real' | 'flat';
  shake?: boolean;
}

/** Pull-ups: each scenario as key poses for the hanging body. */
function pullupScript(s: DemoScenario): PullPart[] {
  const hang = (ms = 3000): PullupKey[] => [{ rise: 0, ms }];
  const reps = (n: number): PullupKey[] => Array.from({ length: n }, () => pullupRep()).flat();
  const swing: PullupKey[] = [
    { rise: 0.5, swing: 0.5, ms: 450 },
    { rise: 1, swing: -0.4, ms: 450 },
    { rise: 1, ms: 200 },
    { rise: 0, ms: 1100 },
    { rise: 0, ms: 500 },
  ];
  const noHang: PullupKey[] = [
    { rise: 1, ms: 900 },
    { rise: 1, ms: 200 },
    { rise: 0.5, ms: 600 },
    { rise: 1, ms: 700 },
    { rise: 1, ms: 200 },
    { rise: 0, ms: 1100 },
    { rise: 0, ms: 500 },
  ];
  const set = (n: number, first = 3000): PullupKey[] => [...hang(first), ...reps(n)];
  switch (s) {
    case 'basic':
      return [{ keys: [...hang(), ...reps(3), ...swing, ...pullupRep({ peak: 0.6 }), ...reps(2), ...hang(1500)] }];
    case 'nofeet':
      // A low ceiling or a close phone: no legs in the picture. Pull-ups don't need them.
      return [{ keys: set(6).map((k) => ({ ...k, hideLegs: true })) }];
    case 'standup':
      return [{ keys: set(3) }, { keys: [{ rise: 0, offBar: true, ms: 4000 }] }, { keys: set(3, 2500) }];
    case 'lost':
      return [{ keys: set(3) }, { keys: hang(4000), nobody: true }, { keys: set(3, 2500) }];
    case 'swap':
      // Someone else, smaller and off to one side, takes the bar for a few reps.
      return [{ keys: set(3) }, { keys: reps(2).map((k) => ({ ...k, sw: 85, dx: 140 })) }, { keys: set(3, 2500) }];
    case 'knocked':
      return [{ keys: set(3) }, { keys: reps(2), roll: 50 }, { keys: set(3) }];
    case 'shake':
      return [{ keys: set(3) }, { keys: reps(4), shake: true }, { keys: set(3) }];
    case 'tv':
      return [
        { keys: set(3), depth: 'real' },
        { keys: reps(4), depth: 'flat' },
        { keys: set(3, 3500), depth: 'real' },
      ];
    case 'faults':
      return [
        {
          keys: [
            ...hang(),
            ...reps(1),
            ...pullupRep({ peak: 0.6 }), // half rep: not counted
            ...noHang, // the second pull starts without a dead hang: not counted
            ...pullupRep({ kneeLift: 0.8 }), // kip: not counted on Medium/Hard
            ...swing, // swinging: flagged
            ...pullupRep({ tilt: 0.3 }), // one shoulder high: flagged
            ...pullupRep({ downMs: 200 }), // dropped from the bar: flagged
            ...reps(1),
            ...hang(1500),
          ],
        },
      ];
  }
}

function pullupDemoFrames(scenario: DemoScenario): { frames: DemoFrame[]; length: number } {
  const frames: DemoFrame[] = [];
  let t = 0;
  for (const part of pullupScript(scenario)) {
    const samples = pullupFrames(t - 33, part.keys).map((s) => ({
      ...s,
      landmarks: s.landmarks.map((l, i) => {
        // A little camera jitter, plus the whole picture shaking for a handheld video.
        const j = 0.0015 * Math.sin(s.t / 37 + i * 1.7);
        const sx = part.shake ? 0.012 * Math.sin((2 * Math.PI * 3 * s.t) / 1000) : 0;
        const sy = part.shake ? 0.008 * Math.cos((2 * Math.PI * 2.3 * s.t) / 1000) : 0;
        return { ...l, x: l.x + j + sx, y: l.y + j + sy };
      }),
    }));
    for (const s of samples) {
      frames.push({ sample: part.nobody ? emptySample(s.t, s.width, s.height) : s, roll: part.roll ?? 0, depth: part.depth });
    }
    t = samples[samples.length - 1].t + 33;
  }
  return { frames, length: t };
}

/** A real person 2 m away with a wall behind, or a flat screen. */
function probe(t: number, kind: 'real' | 'flat'): DepthProbe {
  const j = (a: number) => (Math.random() - 0.5) * 2 * a;
  return kind === 'real'
    ? { t, body: [2, 2, 2, 2, 2, 2].map((d) => d + j(0.05)), around: [3.5, 3.5, 3.5, 3.5].map((d) => d + j(0.1)), torsoM: 0.5 + j(0.03) }
    : { t, body: [2, 2, 2, 2, 2, 2].map((d) => d + j(0.02)), around: [2, 2, 2, 2].map((d) => d + j(0.02)), torsoM: 0.5 + j(0.03) };
}

export interface DemoFrame {
  sample: PoseSample;
  roll: number;
  depth?: 'real' | 'flat';
}

/** Every frame of a scenario, with its phone roll and depth kind. Also used by tests. */
export function demoFrames(
  exercise: Exercise,
  scenario: DemoScenario,
  portrait: boolean,
  view: CameraView = 'side',
): { frames: DemoFrame[]; length: number } {
  if (exercise === 'pullup') return pullupDemoFrames(scenario);
  // Head-on demos (push-ups, plank) are photographed from the front.
  const front = view === 'front' && EXERCISES[exercise].frontView;
  // Portrait frames are tall and narrow, like a real upright camera.
  const size: Partial<BodyParams> = portrait ? { noisePx: 3, width: 720, height: 1280, torsoPx: 190 } : { noisePx: 3 };
  const frames: DemoFrame[] = [];
  let t = 0;
  for (const part of script(exercise, scenario)) {
    const base = { ...size, ...part.body };
    const samples = (front ? timelineFront : timeline)(part.segs, {
      startT: t,
      base,
      mapFrame: part.shake
        ? (s, ft) => ({
            ...s,
            landmarks: s.landmarks.map((l) => ({
              ...l,
              x: l.x + 0.012 * Math.sin((2 * Math.PI * 3 * ft) / 1000),
              y: l.y + 0.008 * Math.cos((2 * Math.PI * 2.3 * ft) / 1000),
            })),
          })
        : undefined,
    });
    for (const s of samples) {
      frames.push({ sample: part.nobody ? emptySample(s.t, s.width, s.height) : s, roll: part.roll ?? 0, depth: part.depth });
    }
    t = samples[samples.length - 1].t + 33;
  }
  return { frames, length: t };
}

/** Depth readings for a demo frame, as the camera would give them. */
export const demoProbe = probe;

export function useDemoFeed(
  enabled: boolean,
  portrait: boolean,
  onPose: (s: PoseSample) => void,
  onAttitude: (a: PhoneAttitude) => void,
  scenario: DemoScenario = 'basic',
  exercise: Exercise = 'pushup',
  onDepth?: (p: DepthProbe) => void,
  view: CameraView = 'side',
) {
  const pose = useRef(onPose);
  const att = useRef(onAttitude);
  const dep = useRef(onDepth);
  useLayoutEffect(() => {
    pose.current = onPose;
    att.current = onAttitude;
    dep.current = onDepth;
  });

  useEffect(() => {
    if (!enabled) return;
    const { frames, length } = demoFrames(exercise, scenario, portrait, view);
    const t0 = performance.now();
    let i = 0;
    let loop = 0;
    let n = 0;
    const id = setInterval(() => {
      const now = performance.now();
      const local = now - t0 - loop * length;
      const roll = frames[Math.min(i, frames.length - 1)].roll;
      att.current({ t: now, rollDeg: roll + 0.6 * Math.sin(now / 900), pitchDeg: 3, motionDegPerSec: 0.5 });
      while (i < frames.length && frames[i].sample.t <= local) {
        const f = frames[i++];
        const ft = t0 + loop * length + f.sample.t;
        pose.current({ ...f.sample, t: ft });
        if (f.depth && n++ % 3 === 0) dep.current?.(probe(ft, f.depth));
      }
      if (i >= frames.length) {
        i = 0;
        loop += 1;
      }
    }, 33);
    return () => clearInterval(id);
  }, [enabled, portrait, scenario, exercise, view]);
}
