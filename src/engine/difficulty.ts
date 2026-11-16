import { mergeConfig, type DeepPartial, type EngineConfig } from './config';

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

/** Engine config for a difficulty. Easy always accepts knee push-ups. */
export function difficultyConfig(d: Difficulty, opts: { allowKneeling?: boolean } = {}): EngineConfig {
  return mergeConfig({ ...PRESETS[d], allowKneeling: d === 'easy' ? true : (opts.allowKneeling ?? false) });
}

/** The overrides only, for saving with a recording. */
export function difficultyOverrides(d: Difficulty, opts: { allowKneeling?: boolean } = {}): DeepPartial<EngineConfig> {
  return { ...PRESETS[d], allowKneeling: d === 'easy' ? true : (opts.allowKneeling ?? false) };
}
