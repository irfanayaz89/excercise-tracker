import type { Difficulty } from '@/engine/difficulty';
import type { CameraView, Exercise, PhoneOrientation } from '@/engine/types';
import { EXERCISES } from '@/engine/exercises';
import { PLACEMENT } from '@/session/copy';

/** The three setup steps shown before a set, worded for each exercise. */
export function setupSteps(
  exercise: Exercise,
  difficulty: Difficulty,
  orientation: PhoneOrientation,
  cameraView: CameraView = 'side',
): { title: string; body: string }[] {
  const place = PLACEMENT[orientation];
  if (exercise === 'pullup') return pullupSteps();
  if (cameraView === 'front' && EXERCISES[exercise].frontView) return frontSteps(exercise);
  const phone = {
    title: `Phone on the floor, ${place.label.toLowerCase()}`,
    body:
      exercise === 'sidePlank'
        ? `Prop it upright ${place.distance} away, level with your hips. Lie on your side facing it.`
        : `Prop it upright ${place.distance} away, level with your hips, side-on to where you will be.`,
  };
  const view =
    difficulty === 'easy'
      ? { title: 'Upper body in view', body: 'Arms, shoulders and hips on screen. Feet help but are not required.' }
      : { title: 'Whole body in view', body: 'Head to feet inside the screen, in a well-lit spot.' };
  const start: Record<Exercise, { title: string; body: string }> = {
    pullup: pullupSteps()[2],
    pushup: { title: 'Hold a plank to begin', body: 'Counting starts by itself. Reps count when you lock out at the top.' },
    plank: {
      title: 'Hold a plank to begin',
      body: 'On straight arms or forearms. The clock starts by itself and runs while your body stays in one line.',
    },
    crunch: {
      title: 'Lie back to begin',
      body: 'On your back, knees bent, feet flat. Counting starts once you lie still for a second.',
    },
    sidePlank: {
      title: 'Lift your hips to begin',
      body: 'Elbow under your shoulder, feet stacked. Each side is timed on its own; a target is per side.',
    },
  };
  return [phone, view, start[exercise]];
}

/** Front view: the phone faces you instead of standing beside you. */
function frontSteps(exercise: Exercise): { title: string; body: string }[] {
  return [
    {
      title: 'Phone on the floor, in front of you',
      body: 'Stand it upright 1.2–2 m beyond where your hands will be, facing you. Portrait fits best.',
    },
    { title: 'Face and both hands in view', body: 'Head towards the phone; your face, shoulders and both hands inside the screen.' },
    exercise === 'pushup'
      ? { title: 'Hold a plank to begin', body: 'Counting starts by itself. Reps count when your arms straighten at the top.' }
      : { title: 'Hold a plank to begin', body: 'On straight arms or forearms. The clock starts by itself.' },
  ];
}

/**
 * Pull-ups: the phone faces the bar, straight on or at an angle, 2–2.5 m away.
 * On the floor it sees only up to about 1.6 m, so it stands higher or leans back
 * to see the hands on the bar.
 */
function pullupSteps(): { title: string; body: string }[] {
  return [
    {
      title: 'Phone 2–2.5 m from the bar, raised',
      body: 'Stand it upright on a chair or shelf about waist high, facing the bar, straight on or at an angle. On the floor, lean it back so the bar is in view.',
    },
    { title: 'Hands to hips in view', body: 'The bar, both hands, your face and your hips inside the screen, in a well-lit spot.' },
    { title: 'Hang to begin', body: 'Hang still with straight arms. A pull-up counts when your chin clears the bar.' },
  ];
}
