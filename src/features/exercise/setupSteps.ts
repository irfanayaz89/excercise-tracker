import type { Difficulty } from '@/engine/difficulty';
import type { Exercise, PhoneOrientation } from '@/engine/types';
import { PLACEMENT } from '@/session/copy';

/** The three setup steps shown before a set, worded for each exercise. */
export function setupSteps(exercise: Exercise, difficulty: Difficulty, orientation: PhoneOrientation): { title: string; body: string }[] {
  const place = PLACEMENT[orientation];
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
    sidePlank: {
      title: 'Lift your hips to begin',
      body: 'Elbow under your shoulder, feet stacked. Each side is timed on its own; a target is per side.',
    },
  };
  return [phone, view, start[exercise]];
}
