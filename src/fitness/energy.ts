import type { Exercise } from '@/engine/types';

/**
 * Calories, body weight and goals. Pure functions, so every number the app
 * shows can be checked by hand and in tests.
 *
 * Sources:
 * - Exercise cost: a per-rep model (lifting work plus time under tension),
 *   calibrated to lab data; see `repKcal`. Net (active) calories only.
 * - Resting energy: Mifflin–St Jeor, the most accurate of the common equations
 *   (within ±10% for about three in four adults).
 * - Weight change over time: Hall et al., Lancet 2011. A lasting change of about
 *   22 kcal a day moves body weight about 1 kg in the end, half of it in about a
 *   year. The old "7,700 kcal = 1 kg" rule ignores the body adapting and
 *   overstates long-term loss, so it is only used for energy equivalents.
 * - Safe pace: 0.5–1 kg a week (NHS, CDC).
 */

export type Sex = 'female' | 'male' | 'unspecified';
/** How active the user is outside these workouts. */
export type Activity = 'low' | 'some' | 'high';

export interface Body {
  sex: Sex;
  age: number;
  heightCm: number;
  weightKg: number;
  activity: Activity;
  /**
   * Lifts weights regularly or carries a lot of muscle. Mifflin–St Jeor
   * under-predicts these people (O'Neill 2023), so they get Ten Haaf's
   * equation instead. This is the useful version of a "body type" question:
   * ectomorph/mesomorph/endomorph doesn't predict energy use.
   */
  muscular?: boolean;
}

/** A calorie estimate with its honest range (net, above resting). */
export interface Kcal {
  kcal: number;
  low: number;
  high: number;
}

export const ZERO_KCAL: Kcal = { kcal: 0, low: 0, high: 0 };
export const addKcal = (a: Kcal, b: Kcal): Kcal => ({ kcal: a.kcal + b.kcal, low: a.low + b.low, high: a.high + b.high });
export const scaleKcal = (a: Kcal, k: number): Kcal => ({ kcal: a.kcal * k, low: a.low * k, high: a.high * k });

/** What the calorie maths needs to know about the person. Body fat is deliberately absent: fat is lifted like muscle. */
export interface ExerciseBody {
  weightKg: number;
  /** Height scales how far the body travels each rep. */
  heightCm: number;
  sex: Sex;
}

/**
 * Per-rep model (research report "Calorie formulas body type and projections"):
 *
 *   kcal per rep = kW × f × m × g × (rd × H) / 4184  +  MET_T / 3600 × m × t_rep
 *
 * The first term is lifting work (f: share of body weight moved, rd × H: how
 * far, kW = 1.2 for the lowering phase / 20% efficiency). The second is the
 * cost of holding tension for the rep's measured duration, which is most of a
 * push-up's cost. Calibrated so a slow push-up matches the one lab measurement
 * (0.77 kcal a rep, Nakagata 2022). Pull-up and crunch tension costs are
 * inferred, not measured. Holds (planks) are 3.0 net METs (Ratamess 2015,
 * Huang 2023), above the Compendium's 1.8 net. Rest between sets earns nothing
 * extra: the calibrations already include recovery.
 *
 * For one person a set can be off by about ±30%, and no method (not even a lab)
 * measures a 30-second set to 99%: always show the range.
 */
const G = 9.81;
const KW = { mid: 6.0, low: 4.8, high: 7.5 };
/** The high case adds the anaerobic share that oxygen measurements miss. */
const HIGH_GLYCOLYTIC = 1.2;
const REP: Record<
  'pushup' | 'pullup' | 'crunch',
  { f: number; fFemale?: number; rd: number; met: number; metLow: number; metHigh: number; repS: number }
> = {
  pushup: { f: 0.64, rd: 0.19, met: 5.2, metLow: 3.0, metHigh: 6.2, repS: 2.0 },
  pullup: { f: 0.95, rd: 0.23, met: 6.0, metLow: 4.2, metHigh: 7.8, repS: 2.5 },
  crunch: { f: 0.33, fFemale: 0.31, rd: 0.045, met: 1.4, metLow: 0.9, metHigh: 2.2, repS: 2.0 },
};
const HOLD = { met: 3.0, low: 1.8, high: 4.6 };
/** No study has measured a side plank: its range is widened a further 20%. */
const SIDE_PLANK_WIDEN = 0.2;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Net calories of one rep, with its range. `repS` is the rep's measured duration in seconds. */
export function repKcal(exercise: 'pushup' | 'pullup' | 'crunch', body: ExerciseBody, repS: number | null = null): Kcal {
  const c = REP[exercise];
  const m = body.weightKg;
  if (!(m > 0)) return ZERO_KCAL;
  const f = body.sex === 'female' && c.fFemale !== undefined ? c.fFemale : c.f;
  const t = clamp(repS ?? c.repS, 0.8, 6);
  const work = (f * m * G * c.rd * (body.heightCm / 100)) / 4184;
  const hold = (m * t) / 3600;
  return {
    kcal: KW.mid * work + c.met * hold,
    low: KW.low * work + c.metLow * hold,
    high: (KW.high * work + c.metHigh * hold) * HIGH_GLYCOLYTIC,
  };
}

/** Net calories of a hold (plank, side plank) from its seconds in good form. */
export function holdKcal(exercise: 'plank' | 'sidePlank', body: ExerciseBody, goodMs: number): Kcal {
  const k = (Math.max(0, goodMs) / 1000) * (body.weightKg / 3600);
  if (!(k > 0)) return ZERO_KCAL;
  const widen = exercise === 'sidePlank' ? SIDE_PLANK_WIDEN : 0;
  return { kcal: HOLD.met * k, low: HOLD.low * k * (1 - widen), high: HOLD.high * k * HIGH_GLYCOLYTIC * (1 + widen) };
}

/**
 * A set's calories. Rep time comes from the set's average rep when known,
 * otherwise its active time spread over its reps (kept within 0.8–6 s, so a
 * long pause between reps isn't counted as work).
 */
export function setKcal(
  set: { exercise: Exercise; activeMs: number; holdMs: number; totalReps: number; avgRepMs?: number | null },
  body: ExerciseBody,
): Kcal {
  if (set.exercise === 'plank' || set.exercise === 'sidePlank') return holdKcal(set.exercise, body, set.holdMs);
  if (set.totalReps <= 0) return ZERO_KCAL;
  const repS = set.avgRepMs ? set.avgRepMs / 1000 : set.activeMs > 0 ? set.activeMs / 1000 / set.totalReps : null;
  return scaleKcal(repKcal(set.exercise, body, repS), set.totalReps);
}

/** A typical set of each exercise, to show what one is worth before any are done. */
export const TYPICAL_SET: Record<Exercise, { reps: number; holdMs: number; label: string }> = {
  pushup: { reps: 10, holdMs: 0, label: '10 push-ups' },
  pullup: { reps: 5, holdMs: 0, label: '5 pull-ups' },
  crunch: { reps: 20, holdMs: 0, label: '20 crunches' },
  plank: { reps: 0, holdMs: 60_000, label: 'a 60 s plank' },
  sidePlank: { reps: 0, holdMs: 60_000, label: '30 s on each side' },
};

export function typicalSetKcal(exercise: Exercise, body: ExerciseBody): Kcal {
  const t = TYPICAL_SET[exercise];
  return setKcal({ exercise, activeMs: 0, holdMs: t.holdMs, totalReps: t.reps }, body);
}

/**
 * The plan's "10-minute workout": 3 × 10 push-ups, 2 × 20 crunches and a 60 s
 * plank (about 19 kcal at 70 kg). Rest earns nothing, so this is honest about
 * how little a short workout burns.
 */
export function workoutKcal(body: ExerciseBody): Kcal {
  const push = scaleKcal(repKcal('pushup', body), 30);
  const crunch = scaleKcal(repKcal('crunch', body), 40);
  return addKcal(addKcal(push, crunch), holdKcal('plank', body, 60_000));
}

/**
 * Resting energy a day. Mifflin–St Jeor by default (within ±10% for most
 * adults); Ten Haaf 2014 for muscular people (80% within ±10% in athletes,
 * against 52% for Mifflin). "Unspecified" sex takes the midpoint.
 */
export function bmr(b: Pick<Body, 'sex' | 'age' | 'heightCm' | 'weightKg' | 'muscular'>): number {
  if (b.muscular) {
    const sex = b.sex === 'male' ? 191.027 : b.sex === 'female' ? 0 : 95.5;
    return 11.936 * b.weightKg + 587.728 * (b.heightCm / 100) - 8.129 * b.age + sex + 29.279;
  }
  const base = 10 * b.weightKg + 6.25 * b.heightCm - 5 * b.age;
  return base + (b.sex === 'male' ? 5 : b.sex === 'female' ? -161 : -78);
}

/**
 * Body fat % from height and waist: Relative Fat Mass (Woolcott & Bergman
 * 2018), the best equipment-free estimate (about ±4–5 points against DXA,
 * ages 20–69). Body fat changes resting energy, not what a rep costs, so it is
 * shown as a progress number and never applied to exercise calories.
 */
export function relativeFatMass(sex: Sex, heightCm: number, waistCm: number): number | null {
  if (!(heightCm > 0) || !(waistCm > 0)) return null;
  const base = sex === 'male' ? 64 : sex === 'female' ? 76 : 70;
  return Math.max(3, Math.min(60, base - 20 * (heightCm / waistCm)));
}

const ACTIVITY_FACTOR: Record<Activity, number> = { low: 1.2, some: 1.375, high: 1.55 };

/** Calories a day to keep the current weight, before these workouts. */
export function maintenance(b: Body): number {
  return bmr(b) * ACTIVITY_FACTOR[b.activity];
}

/** The lowest weight with a BMI of 18.5 at this height: a target is never set below it. */
export function lowestHealthyKg(heightCm: number): number {
  const m = heightCm / 100;
  return 18.5 * m * m;
}

/** Safe weekly paces offered for a weight goal, in kg a week. */
export const PACES = [0.25, 0.5, 0.75] as const;
export type Pace = (typeof PACES)[number];

export interface WeightPlan {
  /** Kilograms to lose (positive) or gain (negative). */
  changeKg: number;
  /** Weeks to the target; Infinity when eating less is not safe for this body (see `floored`). */
  weeks: number;
  /** Target date (epoch ms), or Infinity. */
  by: number;
  /** Daily calorie deficit from eating (short-term estimate, 7,700 kcal per kg). */
  dailyDeficit: number;
  /** The whole daily gap the date is worked out from: eating, plus workouts after people eat back a fifth. */
  dailyGap: number;
  /** Eating target: maintenance minus the deficit, never below a safe floor. */
  eatKcal: number;
  /** The floor kicked in: the pace is too fast for this body without eating too little. */
  floored: boolean;
}

/**
 * A plan to reach a target weight at a safe pace. The short-term maths uses
 * 7,700 kcal per kg (fine over weeks); long-term the body adapts (Hall 2011: ~22 kcal a day per kg in the end).
 * Eating never goes below resting energy or 1,200 kcal a day; when that
 * limits the gap, the plan takes longer instead. `workoutKcalPerDay` (the
 * plan's workouts averaged over the week) shortens the date the same way the
 * 30/60-day outlook counts them: 80% of it, since people eat back about a fifth.
 */
export function weightPlan(b: Body, targetKg: number, pace: Pace, now = Date.now(), workoutKcalPerDay = 0): WeightPlan {
  const changeKg = b.weightKg - targetKg;
  const maint = maintenance(b);
  const floor = Math.max(1200, bmr(b));
  const want = maint - (changeKg > 0 ? (pace * 7700) / 7 : 0);
  // Never above maintenance: a weight-loss plan must not ask anyone to eat more than they use.
  const eat = Math.min(maint, Math.max(floor, want));
  // With the floor in place the real gap is smaller, so the plan takes longer.
  const dailyDeficit = Math.max(0, maint - eat);
  const dailyGap = dailyDeficit + 0.8 * Math.max(0, workoutKcalPerDay);
  const weeks = changeKg <= 0 ? 0 : dailyGap < 100 ? Infinity : Math.max(1, Math.ceil((changeKg * 7700) / (dailyGap * 7)));
  return {
    changeKg,
    weeks,
    by: Number.isFinite(weeks) ? now + weeks * 7 * 86_400_000 : Infinity,
    dailyDeficit,
    dailyGap,
    eatKcal: Math.round(eat),
    floored: want < floor,
  };
}

/**
 * Building muscle: a small surplus and enough protein. Protein 1.6 g per kg a day
 * is the point past which more stopped helping in Morton et al. 2018 (meta-analysis).
 */
export function strengthFuel(b: Body): { eatKcal: number; proteinG: number } {
  return { eatKcal: Math.round(maintenance(b) + 250), proteinG: Math.round(1.6 * b.weightKg) };
}

/** Pounds and feet/inches, for imperial units. */
export const kgToLb = (kg: number) => kg * 2.2046226;
export const lbToKg = (lb: number) => lb / 2.2046226;
export const cmToFtIn = (cm: number) => {
  // Round the total first, so 182 cm reads 6 ft 0 in, never 5 ft 12 in.
  const total = Math.round(cm / 2.54);
  return { ft: Math.floor(total / 12), inch: total % 12 };
};
export const ftInToCm = (ft: number, inch: number) => (ft * 12 + inch) * 2.54;
