import { mergeConfig, type DeepPartial, type EngineConfig } from './config';
import type { CameraView, Exercise } from './types';
import { EXERCISES, isTimed } from './exercises';

/**
 * How strict the session is.
 * - easy: just counts push-ups. Upper body in view is enough; no form checks,
 *   relaxed phone placement, shallower depth, knees allowed.
 * - medium: main form checks with generous tolerances.
 * - hard: full form standard (the original thresholds).
 */
export type Difficulty = 'easy' | 'medium' | 'hard';

export const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];

const PRESETS: Record<Difficulty, DeepPartial<EngineConfig>> = {
  easy: {
    phone: { maxRollDeg: 12, maxPitchDeg: 35, maxMotionDegPerSec: 15, steadyMs: 500 },
    framing: {
      edgeMargin: 0,
      minBodySpan: 0.2,
      maxBodySpan: 1.01,
      maxShoulderWidthRatio: 2.2,
      requireFeet: false,
      requireHead: false,
    },
    // Start = body roughly flat (not standing or sitting) with arms mostly straight.
    plank: { maxTrunkTiltDeg: 55, minElbowDeg: 130, holdMs: 500, maxWobble: 0.3, checkHips: false, checkHands: false },
    rep: { downElbowDeg: 110, upElbowDeg: 145, midElbowDeg: 120, minDropRatio: 0.3, dropOnlyDepthRatio: 0.5, minRepMs: 300 },
    form: { enabled: false },
  },
  medium: {
    phone: { maxRollDeg: 8, maxPitchDeg: 25, maxMotionDegPerSec: 10, steadyMs: 800 },
    framing: { edgeMargin: 0.015, minBodySpan: 0.35, maxBodySpan: 0.98, maxShoulderWidthRatio: 1.7 },
    plank: { minBodyLineDeg: 150, maxTrunkTiltDeg: 35, minElbowDeg: 145, minKneeDeg: 145, holdMs: 900, maxWobble: 0.16, checkHands: false },
    rep: { downElbowDeg: 100, upElbowDeg: 150, midElbowDeg: 125, minDropRatio: 0.4, dropOnlyDepthRatio: 0.65, rushedRepMs: 600 },
    form: { minBodyLineDeg: 150, hipOffsetFault: 0.16 },
  },
  hard: {},
};

/**
 * Plank-only changes on top of the level above. A plank is judged on body line
 * the whole time, so even Easy checks the hips, just with wide limits; the
 * start check uses the same line limit so a hold never starts already broken.
 */
/**
 * Pull-ups, on top of the level above. Easy just counts chin-over-bar reps (a kip
 * counts too); Medium loosens the hang and the form limits; Hard is the strict
 * standard (the config defaults).
 */
const PULLUP_PRESETS: Record<Difficulty, DeepPartial<EngineConfig>> = {
  easy: { pullup: { hangElbowDeg: 140, kipKneeRise: 99, topElbowDeg: 120 } },
  medium: { pullup: { hangElbowDeg: 145, kipKneeRise: 0.6, swingFault: 0.75, tiltFault: 0.22, dropMs: 300 } },
  hard: {},
};

/** Side plank only, on top of the plank changes: how square the stack must be. */
const SIDE_PLANK_PRESETS: Record<Difficulty, DeepPartial<EngineConfig>> = {
  easy: { sidePlank: { startStack: 0.3, minStack: 0.18 } },
  medium: { sidePlank: { startStack: 0.35, minStack: 0.22 } },
  hard: {},
};

const PLANK_PRESETS: Record<Difficulty, DeepPartial<EngineConfig>> = {
  easy: {
    plank: { checkHips: true, minBodyLineDeg: 145, maxElbowStack: 0.6, forearmMaxRise: 0.25 },
    hold: {
      minBodyLineDeg: 145,
      sagFault: 0.2,
      pikeFault: 0.25,
      driftFault: 0.18,
      sagTrendPerSec: 0.03,
      graceMs: 2000,
      armBendDeg: 25,
      checkHands: false,
    },
  },
  medium: {
    plank: { minBodyLineDeg: 155, maxElbowStack: 0.45 },
    hold: {
      minBodyLineDeg: 155,
      sagFault: 0.14,
      pikeFault: 0.18,
      driftFault: 0.14,
      sagTrendPerSec: 0.02,
      graceMs: 1500,
      armBendDeg: 20,
      checkHands: false,
    },
  },
  hard: {
    plank: { minBodyLineDeg: 165 },
  },
};

/**
 * Crunch changes on top of the level above. A crunch body is shorter than a
 * plank (knees bent), so it may fill less of the frame; the arm is not needed.
 */
const CRUNCH_PRESETS: Record<Difficulty, DeepPartial<EngineConfig>> = {
  easy: {
    framing: { requireArms: false, spanAlongBody: true, uprightBy: 'knees' },
    crunch: { upDeg: 15, leaveDeg: 7, downDeg: 5, partialDeg: 9, maxKneeDeg: 155, maxFootRise: 0.35 },
  },
  medium: {
    framing: { requireArms: false, spanAlongBody: true, uprightBy: 'knees', minBodySpan: 0.26 },
    crunch: { upDeg: 18, satUpDeg: 58, feetLiftFault: 0.28, neckPullDeg: 45, maxKneeDeg: 145, rushedRepMs: 650 },
  },
  hard: {
    framing: { requireArms: false, spanAlongBody: true, uprightBy: 'knees', minBodySpan: 0.28 },
  },
};

/**
 * Front view (facing the phone: push-ups and the plank). The feet are not
 * needed (they sit behind the body head-on); the face and both hands are.
 * Push-ups: depth is read from the shoulders dropping towards the hands, whose
 * bottom is about 45% of the top height head-on.
 */
function frontPreset(d: Difficulty, exercise: Exercise): DeepPartial<EngineConfig> {
  const base: DeepPartial<EngineConfig> = { view: 'front', framing: { requireFeet: false, requireArms: true } };
  if (exercise !== 'pushup') return base;
  return {
    ...base,
    // Head-on a rep is read over a shorter stretch (the shoulder drop alone), so only real bounces are faster than 300 ms.
    rep: { expectedBottomRatio: 0.45, minRepMs: 300 },
    front: d === 'medium' ? { flareFault: 0.4, tiltFault: 0.22 } : {},
  };
}

/** Section-by-section merge of two partial configs (the second wins). */
function combine(a: DeepPartial<EngineConfig>, b: DeepPartial<EngineConfig>): DeepPartial<EngineConfig> {
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const prev = (a as Record<string, unknown>)[k];
    out[k] = v && typeof v === 'object' && prev && typeof prev === 'object' ? { ...prev, ...v } : v;
  }
  return out as DeepPartial<EngineConfig>;
}

export interface DifficultyOptions {
  allowKneeling?: boolean;
  /** Defaults to push-ups. */
  exercise?: Exercise;
  /** Defaults to side-on. Only exercises with `frontView` (push-ups, plank) can use front; others ignore it. */
  view?: CameraView;
}

/** Engine config for a difficulty. Easy always accepts knee push-ups (and knee planks). */
export function difficultyConfig(d: Difficulty, opts: DifficultyOptions = {}): EngineConfig {
  return mergeConfig(difficultyOverrides(d, opts));
}

/** The overrides only, for saving with a recording. */
export function difficultyOverrides(d: Difficulty, opts: DifficultyOptions = {}): DeepPartial<EngineConfig> {
  let base = opts.exercise && isTimed(opts.exercise) ? combine(PRESETS[d], PLANK_PRESETS[d]) : PRESETS[d];
  if (opts.exercise === 'sidePlank') base = combine(base, SIDE_PLANK_PRESETS[d]);
  if (opts.exercise === 'crunch') base = combine(base, CRUNCH_PRESETS[d]);
  if (opts.exercise === 'pullup') base = combine(base, PULLUP_PRESETS[d]);
  if (opts.view === 'front' && opts.exercise && EXERCISES[opts.exercise].frontView) base = combine(base, frontPreset(d, opts.exercise));
  return { ...base, allowKneeling: d === 'easy' ? true : (opts.allowKneeling ?? false) };
}
