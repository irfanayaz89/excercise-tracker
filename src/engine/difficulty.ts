import { mergeConfig, type DeepPartial, type EngineConfig } from './config';
import type { Exercise } from './types';

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
}

/** Engine config for a difficulty. Easy always accepts knee push-ups (and knee planks). */
export function difficultyConfig(d: Difficulty, opts: DifficultyOptions = {}): EngineConfig {
  return mergeConfig(difficultyOverrides(d, opts));
}

/** The overrides only, for saving with a recording. */
export function difficultyOverrides(d: Difficulty, opts: DifficultyOptions = {}): DeepPartial<EngineConfig> {
  const base = opts.exercise === 'plank' ? combine(PRESETS[d], PLANK_PRESETS[d]) : PRESETS[d];
  return { ...base, allowKneeling: d === 'easy' ? true : (opts.allowKneeling ?? false) };
}
