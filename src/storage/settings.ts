import Storage from 'expo-sqlite/kv-store';
import { useCallback, useEffect, useState } from 'react';
import type { Difficulty } from '@/engine/difficulty';
import type { PhoneOrientation } from '@/engine/types';

/** guided = step-by-step help for newcomers; quick = minimal screens for experienced users. */
export type Experience = 'guided' | 'quick';

export interface Settings {
  /** 0 = open set with no target. */
  targetReps: number;
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
}

export const DEFAULT_SETTINGS: Settings = {
  targetReps: 0,
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

/**
 * Settings written by an older or newer build (or hand-edited) must not break
 * the app: every field is checked and falls back to its default.
 */
export function normalizeSettings(raw: unknown): Settings {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_SETTINGS;
  const oneOf = <T,>(v: unknown, options: readonly T[], fallback: T): T => (options.includes(v as T) ? (v as T) : fallback);
  const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
  return {
    targetReps: oneOf(o.targetReps, TARGETS, d.targetReps),
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
  };
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
