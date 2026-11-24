import type { Exercise } from '@/engine/types';
import type { SessionRow } from '@/storage/history';
import type { Profile } from '@/storage/profile';
import { netKcal } from './energy';

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
  if (p.aim === 'lose-fat' && p.targetKg !== null && p.startKg > p.targetKg) {
    const total = p.startKg - p.targetKg;
    const lost = Math.max(0, p.startKg - p.weightKg);
    const fraction = Math.min(1, lost / total);
    return { fraction, met: p.weightKg <= p.targetKg, value: fmt(lost), unit: 'kg lost', of: `of ${fmt(total)} kg` };
  }
  if (p.aim === 'get-stronger' && p.repGoal) {
    const g = p.repGoal;
    const best = rows.filter((r) => r.exercise === g.exercise && r.startedAt >= p.startedAt).reduce((m, r) => Math.max(m, r.totalReps), 0);
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

/** Net calories of saved sets (energy above resting), at the given body weight. */
export function setsKcal(rows: SessionRow[], weightKg: number): number {
  return rows.reduce((s, r) => s + netKcal(r.exercise, r.activeMs, weightKg, isRepCounted(r.exercise) ? r.totalReps : null), 0);
}

const isRepCounted = (e: Exercise) => e === 'pushup' || e === 'pullup' || e === 'crunch';

/**
 * A suggested daily workout: about 10 minutes of sets, half strength work
 * (push-ups or pull-ups) and half core (crunches, planks). Used to show
 * what the workouts add, honestly: a few hundred calories a week at most.
 */
export function workoutKcal(weightKg: number): number {
  return netKcal('pushup', 5 * 60_000, weightKg) + netKcal('plank', 5 * 60_000, weightKg);
}
