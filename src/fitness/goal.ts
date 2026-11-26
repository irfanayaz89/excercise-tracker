import type { SessionRow } from '@/storage/history';
import type { Profile } from '@/storage/profile';
import { addKcal, setKcal, workoutKcal, ZERO_KCAL, type ExerciseBody, type Kcal } from './energy';

/** How far along the goal is: 0–1, and whether it is met. */
export interface GoalProgress {
  fraction: number;
  met: boolean;
  /** The big number on Home. */
  value: string;
  /** What the number is, in a few words. */
  unit: string;
  /** Where it is heading, e.g. "of 8 kg". */
  of: string;
}

/** Monday 00:00 of the week containing `now` (local time). */
export function weekStart(now = Date.now()): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

/** Days this week with at least one saved set. */
export function activeDaysThisWeek(rows: SessionRow[], now = Date.now()): number {
  const from = weekStart(now);
  return new Set(rows.filter((r) => r.startedAt >= from && r.startedAt <= now).map((r) => new Date(r.startedAt).toDateString())).size;
}

const fmt = (n: number, d = 1) => (Math.round(n * 10 ** d) / 10 ** d).toString();

/**
 * Progress toward the profile's goal.
 * - Lose fat: kilograms lost since the start, of the kilograms to lose.
 * - Get stronger: the best set of the goal exercise since the start, of the target reps.
 * - Stay active: workout days this week, of the days planned.
 */
export function goalProgress(p: Profile, rows: SessionRow[], now = Date.now()): GoalProgress {
  if (p.aim === 'lose-fat' && p.targetKg !== null) {
    // Never falls through to the weekly-days goal: a weight goal is met only at the target weight.
    const total = Math.max(p.startKg, p.weightKg) - p.targetKg;
    const lost = Math.max(0, p.startKg - p.weightKg);
    const met = p.weightKg <= p.targetKg;
    const fraction = met ? 1 : total > 0 ? Math.min(1, lost / total) : 0;
    return { fraction, met, value: fmt(lost), unit: 'kg lost', of: `of ${fmt(Math.max(0, total))} kg` };
  }
  if (p.aim === 'get-stronger' && p.repGoal) {
    const g = p.repGoal;
    // The goal is a set of strict reps: reps flagged for form don't count towards it.
    const best = rows.filter((r) => r.exercise === g.exercise && r.startedAt >= p.startedAt).reduce((m, r) => Math.max(m, r.cleanReps), 0);
    return {
      fraction: Math.min(1, best / g.reps),
      met: best >= g.reps,
      value: String(best),
      unit: g.exercise === 'pullup' ? 'pull-ups in one set' : 'push-ups in one set',
      of: `of ${g.reps}`,
    };
  }
  const days = activeDaysThisWeek(rows, now);
  return {
    fraction: Math.min(1, days / p.daysPerWeek),
    met: days >= p.daysPerWeek,
    value: String(days),
    unit: days === 1 ? 'workout day this week' : 'workout days this week',
    of: `of ${p.daysPerWeek}`,
  };
}

/** Net calories of saved sets (energy above resting), with their range. */
export function setsKcal(rows: SessionRow[], body: ExerciseBody): Kcal {
  return rows.reduce((s, r) => addKcal(s, setKcal(r, body)), ZERO_KCAL);
}

/**
 * Weekly streak: weeks in a row (Monday to Sunday) with at least `target`
 * workout days. Forgiving by design: the week in progress never breaks the
 * streak (it only adds once met), and missing a single day is fine as long as
 * the week reaches its target. A broken streak demotivates most when people
 * blame themselves, so Home also shows the best streak and totals kept.
 */
export function weekStreak(
  rows: Pick<SessionRow, 'startedAt'>[],
  target: number,
  now = Date.now(),
): { current: number; best: number; thisWeekMet: boolean } {
  const WEEK = 7 * 86_400_000;
  const start = weekStart(now);
  const days = new Map<number, Set<string>>();
  for (const r of rows) {
    if (r.startedAt > now) continue;
    const k = Math.floor((start - weekStart(r.startedAt)) / WEEK + 0.5);
    if (!days.has(k)) days.set(k, new Set());
    days.get(k)!.add(new Date(r.startedAt).toDateString());
  }
  const met = (k: number) => (days.get(k)?.size ?? 0) >= target;
  const thisWeekMet = met(0);
  let current = thisWeekMet ? 1 : 0;
  for (let k = 1; met(k); k++) current++;
  let best = 0;
  let run = 0;
  const oldest = Math.max(0, ...days.keys());
  for (let k = oldest; k >= 0; k--) {
    run = met(k) ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return { current, best: Math.max(best, current), thisWeekMet };
}

/** Calendar days since the last saved set (null with no sets): a set late yesterday evening is 1 day ago. */
export function daysSinceLastSet(rows: SessionRow[], now = Date.now()): number | null {
  if (rows.length === 0) return null;
  const day = (t: number) => {
    const d = new Date(t);
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  };
  const last = Math.max(...rows.map((r) => r.startedAt));
  return Math.round((day(now) - day(last)) / 86_400_000);
}

/** The plan's workouts averaged over a day (net kcal), for the target date. */
export function planWorkoutKcalPerDay(p: Pick<Profile, 'weightKg' | 'heightCm' | 'sex' | 'daysPerWeek'>): number {
  return (workoutKcal({ weightKg: p.weightKg, heightCm: p.heightCm, sex: p.sex }).kcal * p.daysPerWeek) / 7;
}
