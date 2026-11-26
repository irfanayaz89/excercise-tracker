import Storage from 'expo-sqlite/kv-store';
import { useCallback, useEffect, useState } from 'react';
import { PACES, type Activity, type Body, type Pace, type Sex } from '@/fitness/energy';

/** What the user wants out of the app; it shapes the goal and Home. */
export type Aim = 'lose-fat' | 'get-stronger' | 'stay-active' | 'less-screen';

/** Why it matters to the user, in their words (shown back on Home). */
export type Why = 'energy' | 'health' | 'confidence' | 'sport' | 'mood' | 'focus';
export const WHYS: Why[] = ['energy', 'health', 'confidence', 'sport', 'mood', 'focus'];

export type Units = 'metric' | 'imperial';

/** Strength goal: a number of strict reps in one set of push-ups or pull-ups. */
export interface RepGoal {
  exercise: 'pushup' | 'pullup';
  reps: number;
}

export interface WeighIn {
  at: number;
  kg: number;
}

export interface Profile {
  aim: Aim;
  sex: Sex;
  age: number;
  heightCm: number;
  weightKg: number;
  activity: Activity;
  units: Units;
  /** lose-fat: the weight to reach and how fast. */
  targetKg: number | null;
  pace: Pace;
  /** get-stronger: the set to work up to. */
  repGoal: RepGoal | null;
  /** Workout days a week (stay-active and as a plan for everyone). */
  daysPerWeek: number;
  startedAt: number;
  startKg: number;
  /** Weigh-ins, oldest first. The latest is `weightKg`. */
  log: WeighIn[];
  /** When the goal was first met (for the one-off celebration). */
  goalMetAt: number | null;
  /** What makes it worth it, picked in onboarding (optional). */
  why: Why[];
  /** Lifts weights regularly or carries a lot of muscle (switches the resting-energy equation). */
  muscular: boolean;
  /** Waist at the navel, relaxed, for a body-fat estimate (optional). */
  waistCm: number | null;
}

const KEY = 'profile.v1';
const AIMS: Aim[] = ['lose-fat', 'get-stronger', 'stay-active', 'less-screen'];

export const LIMITS = {
  age: [16, 90],
  heightCm: [120, 230],
  weightKg: [35, 250],
  days: [2, 7],
  reps: [1, 100],
  waistCm: [50, 200],
} as const;

const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, v));
const num = (v: unknown, fallback: number, lim: readonly [number, number]) =>
  typeof v === 'number' && Number.isFinite(v) ? clamp(v, lim) : fallback;

export function defaultProfile(now = Date.now()): Profile {
  return {
    aim: 'lose-fat',
    sex: 'unspecified',
    age: 30,
    heightCm: 170,
    weightKg: 75,
    activity: 'some',
    units: 'metric',
    targetKg: null,
    pace: 0.5,
    repGoal: null,
    daysPerWeek: 3,
    startedAt: now,
    startKg: 75,
    log: [],
    goalMetAt: null,
    why: [],
    muscular: false,
    waistCm: null,
  };
}

/** Anything stored by another build, or hand-edited, is checked and bounded; bad fields fall back. */
export function normalizeProfile(raw: unknown): Profile | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const rg = o.repGoal as Record<string, unknown> | null | undefined;
  const log = Array.isArray(o.log)
    ? o.log
        .filter((w): w is WeighIn => !!w && typeof w === 'object' && typeof w.at === 'number' && typeof w.kg === 'number')
        .map((w) => ({ at: w.at, kg: clamp(w.kg, LIMITS.weightKg) }))
        .sort((a, b) => a.at - b.at)
        .slice(-400)
    : [];
  // A damaged start date falls back to the first weigh-in, not "now": "now" would restart the goal on every load.
  const startedAt = typeof o.startedAt === 'number' && Number.isFinite(o.startedAt) ? o.startedAt : (log[0]?.at ?? Date.now());
  const d = defaultProfile(startedAt);
  const weightKg = num(o.weightKg, d.weightKg, LIMITS.weightKg);
  return {
    aim: AIMS.includes(o.aim as Aim) ? (o.aim as Aim) : d.aim,
    sex: o.sex === 'female' || o.sex === 'male' ? o.sex : 'unspecified',
    age: Math.round(num(o.age, d.age, LIMITS.age)),
    heightCm: num(o.heightCm, d.heightCm, LIMITS.heightCm),
    weightKg,
    activity: o.activity === 'low' || o.activity === 'high' ? o.activity : 'some',
    units: o.units === 'imperial' ? 'imperial' : 'metric',
    targetKg: typeof o.targetKg === 'number' && Number.isFinite(o.targetKg) ? clamp(o.targetKg, LIMITS.weightKg) : null,
    pace: PACES.includes(o.pace as Pace) ? (o.pace as Pace) : d.pace,
    repGoal:
      rg && (rg.exercise === 'pushup' || rg.exercise === 'pullup') && typeof rg.reps === 'number'
        ? { exercise: rg.exercise, reps: Math.round(clamp(rg.reps, LIMITS.reps)) }
        : null,
    daysPerWeek: Math.round(num(o.daysPerWeek, d.daysPerWeek, LIMITS.days)),
    startedAt: d.startedAt,
    startKg: num(o.startKg, weightKg, LIMITS.weightKg),
    log,
    goalMetAt: typeof o.goalMetAt === 'number' ? o.goalMetAt : null,
    why: Array.isArray(o.why) ? [...new Set(o.why.filter((w): w is Why => WHYS.includes(w as Why)))] : [],
    muscular: o.muscular === true,
    waistCm: typeof o.waistCm === 'number' && Number.isFinite(o.waistCm) ? clamp(o.waistCm, LIMITS.waistCm) : null,
  };
}

export function loadProfile(): Profile | null {
  try {
    const raw = Storage.getItemSync(KEY);
    return raw ? normalizeProfile(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function saveProfile(p: Profile | null): void {
  try {
    if (p) Storage.setItemSync(KEY, JSON.stringify(p));
    else Storage.removeItemSync(KEY);
  } catch {
    // Non-fatal: it just will not persist.
  }
}

export const bodyOf = (p: Profile): Body => ({
  sex: p.sex,
  age: p.age,
  heightCm: p.heightCm,
  weightKg: p.weightKg,
  activity: p.activity,
  muscular: p.muscular,
});

/** Adds a weigh-in (one per day: a second one the same day replaces the first). */
export function withWeighIn(p: Profile, kg: number, at = Date.now()): Profile {
  const day = new Date(at).toDateString();
  const log = [...p.log.filter((w) => new Date(w.at).toDateString() !== day), { at, kg: clamp(kg, LIMITS.weightKg) }].sort(
    (a, b) => a.at - b.at,
  );
  return { ...p, weightKg: log[log.length - 1].kg, log };
}

/**
 * The profile to save at the end. Changing the goal within the same aim keeps
 * its start (so progress carries on); a new aim, or a goal after one was
 * reached, starts from today. A weight
 * changed on the way through counts as today's weigh-in.
 */
export function startProfile(p: Profile, saved: Profile | null, now = Date.now()): Profile {
  if (!saved) return { ...p, startedAt: now, startKg: p.weightKg, log: [{ at: now, kg: p.weightKg }], goalMetAt: null };
  // A reached goal is finished: whatever comes next starts from today.
  // A weight goal can't start at or below its target (the user re-set it after gaining): start again from today's weight.
  const same =
    saved.aim === p.aim && saved.goalMetAt === null && !(p.aim === 'lose-fat' && p.targetKg !== null && saved.startKg <= p.targetKg);
  const base: Profile = {
    ...p,
    startedAt: same ? saved.startedAt : now,
    startKg: same ? saved.startKg : p.weightKg,
    log: saved.log,
    goalMetAt: null,
  };
  return Math.abs(p.weightKg - saved.weightKg) >= 0.05 || saved.log.length === 0 ? withWeighIn(base, p.weightKg, now) : base;
}

const listeners = new Set<(p: Profile | null) => void>();
let current: Profile | null | undefined;

export function useProfile(): [Profile | null, (next: Profile | null | ((p: Profile | null) => Profile | null)) => void] {
  const [p, setP] = useState<Profile | null>(() => (current === undefined ? (current = loadProfile()) : current));
  useEffect(() => {
    listeners.add(setP);
    return () => {
      listeners.delete(setP);
    };
  }, []);
  const set = useCallback((next: Profile | null | ((p: Profile | null) => Profile | null)) => {
    const prev = current === undefined ? loadProfile() : current;
    const value = typeof next === 'function' ? next(prev) : next;
    current = value;
    saveProfile(value);
    listeners.forEach((l) => l(value));
  }, []);
  return [p, set];
}
