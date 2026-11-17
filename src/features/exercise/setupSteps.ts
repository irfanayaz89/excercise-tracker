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
