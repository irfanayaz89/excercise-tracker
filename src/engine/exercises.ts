import type { CameraView, Exercise } from './types';

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
  /**
   * Can also be tracked facing the phone (front view): push-ups and the plank.
   * Crunches need the side view to see the curl; the side plank is always done
   * facing the phone in its own way.
   */
  frontView: boolean;
}

export const EXERCISES: Record<Exercise, ExerciseInfo> = {
  pushup: { id: 'pushup', label: 'Push-ups', unit: 'push-ups', kind: 'reps', perSide: false, tagline: 'Counted reps', frontView: true },
  pullup: {
    id: 'pullup',
    label: 'Pull-ups',
    unit: 'pull-ups',
    kind: 'reps',
    perSide: false,
    tagline: 'Counted reps, at a bar',
    // Always seen from the front or a diagonal (see engine/pullup.ts); there is no side-on choice.
    frontView: false,
  },
  crunch: { id: 'crunch', label: 'Crunches', unit: 'crunches', kind: 'reps', perSide: false, tagline: 'Counted reps', frontView: false },
  plank: { id: 'plank', label: 'Plank', unit: 'plank', kind: 'hold', perSide: false, tagline: 'Timed hold', frontView: true },
  sidePlank: {
    id: 'sidePlank',
    label: 'Side plank',
    unit: 'side plank',
    kind: 'hold',
    perSide: true,
    tagline: 'Timed, each side',
    frontView: false,
  },
};

/** Display order. */
export const EXERCISE_IDS: Exercise[] = ['pushup', 'pullup', 'crunch', 'plank', 'sidePlank'];

export function isExercise(v: unknown): v is Exercise {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(EXERCISES, v);
}

/** The camera view a set of this exercise uses: front only where the exercise supports it. */
export function viewFor(e: Exercise, views: Partial<Record<Exercise, CameraView>> | undefined): CameraView {
  return EXERCISES[e].frontView && views?.[e] === 'front' ? 'front' : 'side';
}

/** Timed holds (plank, side plank) rather than counted reps. */
export function isTimed(e: Exercise): boolean {
  return EXERCISES[e].kind === 'hold';
}
