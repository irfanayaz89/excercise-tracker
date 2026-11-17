/**
 * Shared building blocks for the edge-case matrix: every exercise and view,
 * a set of real-life situations (body near or past the frame edge, dropped
 * frames, misread joints, a crooked phone, dim light, knees down), and a
 * runner that plays them through the real engine with the app's own settings.
 */
import { difficultyConfig, type Difficulty } from '../difficulty';
import { PushupSession, type SessionEvent, type SessionSummary } from '../session';
import { LM, type CameraView, type Exercise, type PoseSample } from '../types';
import { mergeConfig } from '../config';
import {
  atFrameEdge,
  buildBody,
  crunch,
  crunchRest,
  forearmPlank,
  hold,
  levelPhone,
  mulberry32,
  rep,
  sidePlank,
  timeline,
  type BodyParams,
  type Segment,
} from './synth';
import { timelineFront, type FrontParams } from './synth3d';

export interface Case {
  exercise: Exercise;
  view: CameraView;
  level: Difficulty;
  portrait: boolean;
  facing: 'left' | 'right';
  allowKneeling: boolean;
  realPersonCheck: boolean;
  plankTestMode: boolean;
}

export const PORTRAIT: Partial<BodyParams> = { width: 720, height: 1280, torsoPx: 130, floorY: 1280 * 0.7 };

/** The exercise's own start position and its work: reps (count) or a hold (ms). */
export function setFor(e: Exercise, n: number, extra: Partial<BodyParams> = {}): { segs: Segment[]; reps: number; holdMs: number } {
  switch (e) {
    case 'pushup':
      return {
        segs: [hold(3000, extra), ...Array.from({ length: n }, () => rep(1800, 80, 172, extra)), hold(700, extra)],
        reps: n,
        holdMs: 0,
      };
    case 'crunch':
      return { segs: [crunchRest(3000), ...Array.from({ length: n }, () => crunch(2200, 32)), crunchRest(700)], reps: n, holdMs: 0 };
    case 'plank':
      return { segs: [forearmPlank(3000 + n * 1600, extra)], reps: 0, holdMs: n * 1600 };
    case 'sidePlank':
      return { segs: [sidePlank(3000 + n * 1600, extra)], reps: 0, holdMs: n * 1600 };
  }
}

/** Shift a side-view body sideways so its left-most (or right-most) joint sits at `edge` (share of the width). */
export function placeAtEdge(base: Partial<BodyParams>, sample: BodyParams, side: 'left' | 'right', edge: number): Partial<BodyParams> {
  const b = buildBody({ ...sample, ...base });
  const xs = Object.values(b.pts).map((p) => p.x);
  const W = b.width;
  const wristX = base.wristX ?? (sample.crunch ? W / 2 - b.dir * 0.15 * b.torsoPx : b.dir === 1 ? W * 0.22 : W * 0.78);
  const shift = side === 'left' ? edge * W - Math.min(...xs) : (1 - edge) * W - Math.max(...xs);
  return { ...base, wristX: wristX + shift };
}

export interface RunResult {
  summary: SessionSummary;
  started: boolean;
  reps: number;
  goodMs: number;
  pauses: string[];
  framing: string[];
  plankIssues: string[];
  misses: string[];
  ended: boolean;
}

/** Plays samples through a session built the way the app builds one from Settings. */
export function play(
  c: Case,
  samples: PoseSample[],
  phone: (t: number) => { roll?: number; pitch?: number; motion?: number } = () => ({}),
): RunResult {
  let o = difficultyConfig(c.level, { exercise: c.exercise, view: c.view, allowKneeling: c.allowKneeling });
  if (!c.realPersonCheck) o = mergeConfig({ ...o, reality: { ...o.reality, enabled: false } });
  if (c.plankTestMode && (c.exercise === 'plank' || c.exercise === 'sidePlank'))
    o = mergeConfig({ ...o, hold: { ...o.hold, endOnBreak: true } });
  const session = new PushupSession({ config: o, exercise: c.exercise });
  const events: SessionEvent[] = [];
  session.subscribe((e) => events.push(e));
  for (const s of samples) {
    const p = phone(s.t);
    session.pushAttitude(levelPhone(s.t, p.roll ?? 0, p.pitch ?? 0, p.motion ?? 0));
    session.pushPose(s);
    session.tick(s.t);
  }
  const snap = session.snapshot();
  const ended = snap.phase === 'ended';
  const summary = session.end();
  const cue = (k: string) => [
    ...new Set(
      events.flatMap((e) => (e.type === 'cue' && e.cue.kind === k ? [JSON.stringify(e.cue).replace(/.*:"([^"]+)".*/, '$1')] : [])),
    ),
  ];
  return {
    summary,
    started: events.some((e) => e.type === 'phase' && e.phase === 'counting'),
    reps: summary.totalReps,
    goodMs: summary.hold?.goodMs ?? 0,
    pauses: cue('paused'),
    framing: cue('framing'),
    plankIssues: cue('plank'),
    misses: summary.misses.map((m) => m.reason),
    ended,
  };
}

/** Timeline in the case's view and frame. */
export function frames(
  c: Case,
  segs: Segment[],
  base: Partial<BodyParams> = {},
  opts: {
    front?: FrontParams;
    mapFrame?: (s: PoseSample, t: number) => PoseSample;
    dropFrame?: (i: number) => boolean;
    fps?: number;
    seed?: number;
  } = {},
): PoseSample[] {
  const frame = c.portrait ? PORTRAIT : {};
  const common = {
    base: { noisePx: 2, ...frame, facing: c.facing, ...base },
    mapFrame: opts.mapFrame,
    dropFrame: opts.dropFrame,
    fps: opts.fps,
    seed: opts.seed,
  };
  if (c.view === 'front' && c.exercise !== 'sidePlank') {
    return timelineFront(segs, { ...common, front: { offCentreM: c.facing === 'left' ? -0.1 : 0.1, ...opts.front } });
  }
  return timeline(segs, common);
}

/** One frame in `every`, one joint the counting relies on is misread. */
export function misreads(every: number, seed: number) {
  const r = mulberry32(seed);
  return (s: PoseSample, t: number): PoseSample => {
    if (Math.round(t / 33.333) % every !== 0 || s.landmarks.length === 0) return s;
    const lms = s.landmarks.map((l) => ({ ...l }));
    const near = lms[LM.leftHip].visibility >= lms[LM.rightHip].visibility ? 'left' : 'right';
    const joint = (['Shoulder', 'Elbow', 'Wrist', 'Hip', 'Knee', 'Ankle'] as const)[Math.floor(r() * 6)];
    const i = (LM as Record<string, number>)[`${near}${joint}`];
    lms[i].x += (r() - 0.5) * 0.05;
    lms[i].y += (r() - 0.5) * 0.07;
    return { ...s, landmarks: lms };
  };
}

/** Every combination the app can run: exercise × view × level × frame × facing. */
export function allCases(): Case[] {
  const out: Case[] = [];
  const views: [Exercise, CameraView][] = [
    ['pushup', 'side'],
    ['pushup', 'front'],
    ['plank', 'side'],
    ['plank', 'front'],
    ['crunch', 'side'],
    ['sidePlank', 'side'],
  ];
  for (const [exercise, view] of views)
    for (const level of ['easy', 'medium', 'hard'] as const)
      for (const portrait of [false, true])
        for (const facing of ['left', 'right'] as const)
          out.push({ exercise, view, level, portrait, facing, allowKneeling: false, realPersonCheck: true, plankTestMode: false });
  return out;
}

export const label = (c: Case) =>
  `${c.exercise}/${c.view} ${c.level} ${c.portrait ? 'portrait' : 'landscape'} ${c.facing}${c.allowKneeling ? ' +knees' : ''}${c.realPersonCheck ? '' : ' -realcheck'}${c.plankTestMode ? ' +testmode' : ''}`;

/**
 * The body (or the phone) shifts mid-set: from `from` ms after the first frame,
 * the picture moves by dx/dy (shares of the frame) over `overMs`. Joints that
 * leave the frame lose confidence as a real tracker's would.
 */
export function shift(dx: number, dy: number, from: number, overMs = 600) {
  let t0: number | null = null;
  return (s: PoseSample, t: number): PoseSample => {
    if (t0 === null) t0 = t;
    const k = Math.max(0, Math.min(1, (t - t0 - from) / overMs));
    if (k === 0 || s.landmarks.length === 0) return s;
    return { ...s, landmarks: s.landmarks.map((l) => atFrameEdge({ ...l, x: l.x + dx * k, y: l.y + dy * k })) };
  };
}

/** A video of the set held up to the camera: the whole picture shakes, from `from` ms. */
export function handheld(from: number) {
  let t0: number | null = null;
  return (s: PoseSample, t: number): PoseSample => {
    if (t0 === null) t0 = t;
    if (t - t0 < from) return s;
    return {
      ...s,
      landmarks: s.landmarks.map((l) => ({
        ...l,
        x: l.x + 0.012 * Math.sin((2 * Math.PI * 3 * t) / 1000),
        y: l.y + 0.008 * Math.cos((2 * Math.PI * 2.3 * t) / 1000),
      })),
    };
  };
}
