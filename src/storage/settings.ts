import Storage from 'expo-sqlite/kv-store';
import { useCallback, useEffect, useState } from 'react';
import type { Difficulty } from '@/engine/difficulty';
import type { CameraView, Exercise, PhoneOrientation } from '@/engine/types';
import { EXERCISE_IDS, EXERCISES } from '@/engine/exercises';

/** guided = step-by-step help for newcomers; quick = minimal screens for experienced users. */
export type Experience = 'guided' | 'quick';

/** Daily goal picked during onboarding; 'none' = no goal shown. */
export type DailyGoal = 'none' | 'light' | 'regular' | 'serious';

/** Health notes from the onboarding safety check (stored on the phone only). */
export type SafetyFlag = 'heart' | 'back' | 'neck' | 'wrist' | 'pregnancy' | 'injury';

export const SAFETY_FLAGS: SafetyFlag[] = ['heart', 'back', 'neck', 'wrist', 'pregnancy', 'injury'];

/** What each daily goal asks for: counted reps (push-ups, crunches) and time in good form (planks). */
export const GOAL_TARGETS: Record<Exclude<DailyGoal, 'none'>, { reps: number; holdMs: number }> = {
  light: { reps: 10, holdMs: 30_000 },
  regular: { reps: 25, holdMs: 60_000 },
  serious: { reps: 50, holdMs: 120_000 },
};

/** Default camera view per exercise: side-on. Push-ups and the plank can be switched to front (see EXERCISES.frontView). */
export const DEFAULT_VIEWS: Record<Exercise, CameraView> = { pullup: 'front', pushup: 'side', crunch: 'side', plank: 'side', sidePlank: 'side' };

export interface Settings {
  /** Push-ups (counted) or plank (timed). */
  exercise: Exercise;
  /** 0 = open set with no target. */
  targetReps: number;
  /** Plank target in seconds of good form; 0 = open. */
  targetHoldSec: number;
  /**
   * Target per exercise (reps, or seconds for planks), so 50 crunches doesn't also set 50 pull-ups.
   * An exercise not in here uses targetReps / targetHoldSec (what older builds saved).
   */
  targets: Partial<Record<Exercise, number>>;
  /** Plank test: the hold ends at the first real form break instead of pausing the clock. */
  plankTestMode: boolean;
  /** Pause when the camera seems to be watching a video on a screen instead of a person. */
  realPersonCheck: boolean;
  camera: 'front' | 'back';
  voice: boolean;
  /** Speak the rep number on every rep. */
  countAloud: boolean;
  allowKneeling: boolean;
  model: 'auto' | 'full' | 'lite';
  showTracking: boolean;
  recordForTuning: boolean;
  /** How the phone stands during a set. */
  orientation: PhoneOrientation;
  /** null until the user answers the first-launch question. */
  experience: Experience | null;
  /** How strict counting and form checks are. */
  difficulty: Difficulty;
  /** Before a landscape set, remind the user to turn off Rotation Lock (Auto-rotate on, on Android). */
  rotationReminder: boolean;
  /** Camera view per exercise. */
  views: Record<Exercise, CameraView>;
  /** Exercises picked in onboarding, shown first on Home. Empty = all, in the usual order. */
  focus: Exercise[];
  dailyGoal: DailyGoal;
  safety: SafetyFlag[];
}

export const DEFAULT_SETTINGS: Settings = {
  exercise: 'pushup',
  targetReps: 0,
  targetHoldSec: 0,
  targets: {},
  plankTestMode: false,
  realPersonCheck: true,
  camera: 'front',
  voice: true,
  countAloud: true,
  allowKneeling: false,
  model: 'auto',
  showTracking: false,
  recordForTuning: false,
  orientation: 'landscape',
  experience: null,
  difficulty: 'easy',
  rotationReminder: true,
  views: DEFAULT_VIEWS,
  focus: [],
  dailyGoal: 'none',
  safety: [],
};

const KEY = 'settings.v1';

export function loadSettings(): Settings {
  try {
    const raw = Storage.getItemSync(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return normalizeSettings(JSON.parse(raw));
  } catch {
    // Corrupt or unreadable storage must never block a workout.
    return DEFAULT_SETTINGS;
  }
}

/** The target chips offered on Home. */
export const TARGETS = [0, 10, 20, 30, 50];

/** Plank target chips, in seconds. */
export const HOLD_TARGETS = [0, 30, 45, 60, 90, 120];

/**
 * Settings written by an older or newer build (or hand-edited) must not break
 * the app: every field is checked and falls back to its default.
 */
export function normalizeSettings(raw: unknown): Settings {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_SETTINGS;
  const oneOf = <T>(v: unknown, options: readonly T[], fallback: T): T => (options.includes(v as T) ? (v as T) : fallback);
  const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
  return {
    exercise: oneOf(o.exercise, EXERCISE_IDS, d.exercise),
    targetReps: oneOf(o.targetReps, TARGETS, d.targetReps),
    targetHoldSec: oneOf(o.targetHoldSec, HOLD_TARGETS, d.targetHoldSec),
    targets: normalizeTargets(o.targets),
    plankTestMode: bool(o.plankTestMode, d.plankTestMode),
    realPersonCheck: bool(o.realPersonCheck, d.realPersonCheck),
    camera: oneOf(o.camera, ['front', 'back'] as const, d.camera),
    voice: bool(o.voice, d.voice),
    countAloud: bool(o.countAloud, d.countAloud),
    allowKneeling: bool(o.allowKneeling, d.allowKneeling),
    model: oneOf(o.model, ['auto', 'full', 'lite'] as const, d.model),
    showTracking: bool(o.showTracking, d.showTracking),
    recordForTuning: bool(o.recordForTuning, d.recordForTuning),
    orientation: oneOf(o.orientation, ['landscape', 'portrait'] as const, d.orientation),
    experience: oneOf(o.experience, ['guided', 'quick', null] as const, null),
    difficulty: oneOf(o.difficulty, ['easy', 'medium', 'hard'] as const, d.difficulty),
    rotationReminder: bool(o.rotationReminder, d.rotationReminder),
    views: normalizeViews(o.views),
    focus: Array.isArray(o.focus) ? [...new Set(o.focus.filter((e): e is Exercise => EXERCISE_IDS.includes(e as Exercise)))] : [],
    dailyGoal: oneOf(o.dailyGoal, ['none', 'light', 'regular', 'serious'] as const, d.dailyGoal),
    safety: Array.isArray(o.safety) ? [...new Set(o.safety.filter((f): f is SafetyFlag => SAFETY_FLAGS.includes(f as SafetyFlag)))] : [],
  };
}

function normalizeTargets(v: unknown): Partial<Record<Exercise, number>> {
  const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  const out: Partial<Record<Exercise, number>> = {};
  for (const e of EXERCISE_IDS) {
    const options = EXERCISES[e].kind === 'hold' ? HOLD_TARGETS : TARGETS;
    if (options.includes(o[e] as number)) out[e] = o[e] as number;
  }
  return out;
}

/** This exercise's target: reps, or seconds of good form for planks. 0 = open. */
export function targetFor(s: Pick<Settings, 'targets' | 'targetReps' | 'targetHoldSec'>, e: Exercise): number {
  return s.targets[e] ?? (EXERCISES[e].kind === 'hold' ? s.targetHoldSec : s.targetReps);
}

function normalizeViews(v: unknown): Record<Exercise, CameraView> {
  const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  const out = { ...DEFAULT_VIEWS };
  // Front view only where the exercise supports it (push-ups, plank); a saved "front" for anything else reads as side-on.
  for (const e of EXERCISE_IDS) if (o[e] === 'side' || (o[e] === 'front' && EXERCISES[e].frontView)) out[e] = o[e] as CameraView;
  return out;
}

export function saveSettings(s: Settings): void {
  try {
    Storage.setItemSync(KEY, JSON.stringify(s));
  } catch {
    // Non-fatal: the setting just will not persist.
  }
}

const listeners = new Set<(s: Settings) => void>();
let current: Settings | null = null;

export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const [s, setS] = useState<Settings>(() => (current ??= loadSettings()));
  useEffect(() => {
    listeners.add(setS);
    return () => {
      listeners.delete(setS);
    };
  }, []);
  const update = useCallback((patch: Partial<Settings>) => {
    const next = { ...(current ?? loadSettings()), ...patch };
    current = next;
    saveSettings(next);
    listeners.forEach((l) => l(next));
  }, []);
  return [s, update];
}
