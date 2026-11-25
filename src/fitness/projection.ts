import { scaleKcal, type Kcal } from './energy';

/**
 * What 30 or 60 days of the plan can honestly be expected to do (research
 * report "Calorie formulas body type and projections"):
 *
 * - Workout calories add up, but people eat back part of them: about 20% on
 *   average over weeks (Riou 2015), so fat-energy is counted after that.
 * - Over 30–60 days the 7,700 kcal-per-kg rule and Hall's dynamic model barely
 *   differ, but weight lost in the first month of dieting holds less energy
 *   (about 4,858 kcal/kg: water and glycogen, Thomas 2014), which sets the
 *   fast end of the range. The slow end is half the central figure
 *   (adherence and compensation).
 * - Strength training trials move fat by about 0.5 kg in 8+ weeks while the
 *   scale barely moves (Wewege 2022): say so.
 * - Reps climb fast at first and then slow: a curve that tops out near 2× a
 *   beginner's best (design judgement bounded by 4–8 week trials).
 */

/** Share of workout calories people eat back over weeks (Riou 2015 meta-analysis, mean). */
export const COMPENSATION = 0.2;
/** kcal per gram of body fat, for the "energy equivalent" only. */
const FAT_KCAL_PER_G = 7.7;
const KCAL_PER_KG = 7700;
const EARLY_KCAL_PER_KG = 4858;
const EARLY_DAYS = 30;

export interface WorkoutProjection {
  days: number;
  sessions: number;
  /** Workout calories in total, with the range. */
  total: Kcal;
  /** Grams of body fat that energy equals, after compensation. */
  fatG: Kcal;
}

/** Workouts at `perSession` calories, `perWeek` times a week, for `days`. */
export function projectWorkouts(perSession: Kcal, perWeek: number, days: number): WorkoutProjection {
  const sessions = Math.round((Math.max(0, perWeek) * days) / 7);
  const total = scaleKcal(perSession, sessions);
  return { days, sessions, total, fatG: scaleKcal(total, (1 - COMPENSATION) / FAT_KCAL_PER_G) };
}

/**
 * Weight change from a daily eating gap plus workouts over `days`, as a band:
 * central at 7,700 kcal/kg; slow end half of that; fast end with the first
 * month at 4,858 kcal/kg. 500 kcal a day: about 2.0 kg (1.0–3.1) in 30
 * days, 3.9 kg (2.0–5.0) in 60.
 */
export function projectWeightChange(dailyDeficit: number, days: number, workoutKcal: number): { kg: number; low: number; high: number } {
  const energy = Math.max(0, dailyDeficit) * days + (1 - COMPENSATION) * Math.max(0, workoutKcal);
  if (energy <= 0 || days <= 0) return { kg: 0, low: 0, high: 0 };
  const kg = energy / KCAL_PER_KG;
  const early = Math.min(days, EARLY_DAYS) / days;
  return { kg, low: kg / 2, high: (energy * early) / EARLY_KCAL_PER_KG + (energy * (1 - early)) / KCAL_PER_KG };
}

/**
 * Best-set forecast after `days` more training, from today's best `b0`: a
 * slowing curve that tops out at about 2× for beginners (under 10), 1.5× for
 * 10–25 and 1.2× above. Returned as a likely range, not a promise.
 */
export function forecastBest(b0: number, days: number): { best: number; low: number; high: number } {
  if (!(b0 > 0)) return { best: 0, low: 0, high: 0 };
  const cap = b0 * (b0 < 10 ? 2 : b0 <= 25 ? 1.5 : 1.2);
  const gain = (cap - b0) * (1 - Math.exp(-days / 30));
  return { best: Math.round(b0 + gain), low: Math.round(b0 + gain * 0.5), high: Math.round(b0 + gain * 1.4) };
}
