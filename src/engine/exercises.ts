import type { Exercise } from './types';

/**
 * Every exercise the app knows, in one place. Adding an exercise starts here:
 * the engine, storage and screens read what kind it is from this table
 * instead of checking names.
 */
export interface ExerciseInfo {
  id: Exercise;
  /** Name on buttons and headings. */
  label: string;
  /** Word after a number ("20 push-ups", "1:30 plank"). */
  unit: string;
  /** reps: counted. hold: timed, only time in good form counts. */
  kind: 'reps' | 'hold';
  /** Done once for each side of the body (left and right are timed separately). */
  perSide: boolean;
  /** One line under the name. */
  tagline: string;
}

export const EXERCISES: Record<Exercise, ExerciseInfo> = {
  pushup: { id: 'pushup', label: 'Push-ups', unit: 'push-ups', kind: 'reps', perSide: false, tagline: 'Counted reps' },
  crunch: { id: 'crunch', label: 'Crunches', unit: 'crunches', kind: 'reps', perSide: false, tagline: 'Counted reps' },
  plank: { id: 'plank', label: 'Plank', unit: 'plank', kind: 'hold', perSide: false, tagline: 'Timed hold' },
  sidePlank: { id: 'sidePlank', label: 'Side plank', unit: 'side plank', kind: 'hold', perSide: true, tagline: 'Timed, each side' },
};

/** Display order. */
export const EXERCISE_IDS: Exercise[] = ['pushup', 'crunch', 'plank', 'sidePlank'];

export function isExercise(v: unknown): v is Exercise {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(EXERCISES, v);
}

/** Timed holds (plank, side plank) rather than counted reps. */
export function isTimed(e: Exercise): boolean {
  return EXERCISES[e].kind === 'hold';
}
