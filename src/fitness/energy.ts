import type { Exercise } from '@/engine/types';

/**
 * Calories, body weight and goals. Pure functions, so every number the app
 * shows can be checked by hand and in tests.
 *
 * Sources:
 * - Exercise cost: 2024 Adult Compendium of Physical Activities (Herrmann et al.).
 *   02020 calisthenics (push-ups, pull-ups, sit-ups), vigorous: 7.5 METs;
 *   02022 the same, moderate: 3.8 METs; 02024 curl-ups, crunches, plank, light: 2.8 METs.
 * - Calories from METs: kcal/min = MET × 3.5 × kg ÷ 200. The app counts *net*
 *   calories, (MET − 1), so the energy you would burn anyway at rest is not counted twice.
 * - Resting energy: Mifflin–St Jeor, the most accurate of the common equations
 *   (within ±10% for about three in four adults).
 * - Weight change over time: Hall et al., Lancet 2011. A lasting change of about
 *   24 kcal a day moves body weight about 1 kg in the end, half of it in about a
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
}

/** METs for an exercise. Push-ups and pull-ups at a steady working pace count as vigorous. */
export function metFor(exercise: Exercise, repsPerMin: number | null = null): number {
  switch (exercise) {
    case 'pushup':
    case 'pullup':
      // A set with long pauses between reps is moderate effort.
      return repsPerMin !== null && repsPerMin < 8 ? 3.8 : 7.5;
    case 'crunch':
    case 'plank':
    case 'sidePlank':
      return 2.8;
  }
}

/** Net calories for some minutes of an exercise (energy above resting). */
export function netKcal(exercise: Exercise, activeMs: number, weightKg: number, reps: number | null = null): number {
  const min = Math.max(0, activeMs) / 60_000;
  if (min <= 0 || !(weightKg > 0)) return 0;
  const met = metFor(exercise, reps !== null && min > 0 ? reps / min : null);
  return ((met - 1) * 3.5 * weightKg * min) / 200;
}

/** Resting energy a day (Mifflin–St Jeor). "Unspecified" takes the midpoint of the two. */
export function bmr(b: Pick<Body, 'sex' | 'age' | 'heightCm' | 'weightKg'>): number {
  const base = 10 * b.weightKg + 6.25 * b.heightCm - 5 * b.age;
  return base + (b.sex === 'male' ? 5 : b.sex === 'female' ? -161 : -78);
}

const ACTIVITY_FACTOR: Record<Activity, number> = { low: 1.2, some: 1.375, high: 1.55 };

/** Calories a day to keep the current weight, before these workouts. */
export function maintenance(b: Body): number {
  return bmr(b) * ACTIVITY_FACTOR[b.activity];
}

/** Body mass index and its WHO band. */
export function bmi(heightCm: number, weightKg: number): { value: number; band: 'under' | 'healthy' | 'over' | 'obese' } {
  const m = heightCm / 100;
  const value = weightKg / (m * m);
  return { value, band: value < 18.5 ? 'under' : value < 25 ? 'healthy' : value < 30 ? 'over' : 'obese' };
}

/** The lowest weight with a BMI of 18.5 at this height: a target is never set below it. */
export function lowestHealthyKg(heightCm: number): number {
  const m = heightCm / 100;
  return 18.5 * m * m;
}

/** Fat holds about 7.7 kcal per gram: the energy-equivalent of some calories, as grams of fat. */
export function fatGrams(kcal: number): number {
  return Math.max(0, kcal) / 7.7;
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
  /** Daily calorie deficit the pace needs (short-term estimate, 7,700 kcal per kg). */
  dailyDeficit: number;
  /** Eating target: maintenance minus the deficit, never below a safe floor. */
  eatKcal: number;
  /** The floor kicked in: the pace is too fast for this body without eating too little. */
  floored: boolean;
}

/**
 * A plan to reach a target weight at a safe pace. The short-term maths uses
 * 7,700 kcal per kg (fine over weeks); long-term the body adapts (see `eventualChangeKg`).
 * Eating never goes below resting energy or 1,200 kcal a day; when that
 * limits the gap, the plan takes longer instead.
 */
export function weightPlan(b: Body, targetKg: number, pace: Pace, now = Date.now()): WeightPlan {
  const changeKg = b.weightKg - targetKg;
  const maint = maintenance(b);
  const floor = Math.max(1200, bmr(b));
  const want = maint - (changeKg > 0 ? (pace * 7700) / 7 : 0);
  const eat = Math.max(floor, want);
  // With the floor in place the real gap is smaller, so the plan takes longer.
  const dailyDeficit = Math.max(0, maint - eat);
  const weeks =
    changeKg <= 0 ? 0 : dailyDeficit < 100 ? Infinity : Math.max(1, Math.ceil((changeKg * 7700) / (dailyDeficit * 7)));
  return {
    changeKg,
    weeks,
    by: Number.isFinite(weeks) ? now + weeks * 7 * 86_400_000 : Infinity,
    dailyDeficit,
    eatKcal: Math.round(eat),
    floored: want < floor,
  };
}

/**
 * What a lasting daily calorie difference does to body weight in the end, and
 * after about a year (Hall's rule of thumb: ~24 kcal a day ≈ 1 kg, half within a year).
 */
export function eventualChangeKg(dailyKcal: number): { eventual: number; inAYear: number } {
  const eventual = dailyKcal / 24;
  return { eventual, inAYear: eventual / 2 };
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
  const inches = cm / 2.54;
  const ft = Math.floor(inches / 12);
  return { ft, inch: Math.round(inches - ft * 12) };
};
export const ftInToCm = (ft: number, inch: number) => (ft * 12 + inch) * 2.54;
