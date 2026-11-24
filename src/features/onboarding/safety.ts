import type { Exercise } from '@/engine/types';
import type { SafetyFlag } from '@/storage/settings';

/**
 * Plain notes for the health answers from onboarding. Never blocking and not
 * medical advice: they suggest an easier option and when to check with a
 * clinician. Sources: ACE and ACOG exercise guidance, McGill on spinal flexion.
 */
export const SAFETY_LABELS: Record<SafetyFlag, string> = {
  back: 'Lower-back pain',
  neck: 'Neck or shoulder pain',
  wrist: 'Wrist pain',
  pregnancy: 'Pregnant, or gave birth in the last 6 months',
  injury: 'A recent injury or operation',
};

const NOTES: Record<SafetyFlag, Partial<Record<Exercise, string>>> = {
  back: {
    crunch: 'With back pain, keep the lift small and slow, and stop if it hurts. Planks are often easier on the back.',
    pushup: 'Keep your body in one line and stop if your back hurts. Knee push-ups (Easy) take load off.',
    plank: 'Start with short holds and stop if your back hurts.',
    sidePlank: 'Start on your knees (Easy) and stop if your back hurts.',
    pullup: 'Pull without swinging or kicking, and stop if your back hurts.',
  },
  neck: {
    crunch: 'Cross your arms on your chest instead of hands by your head, and keep a fist of space under your chin.',
    pushup: 'Keep your head in line with your body. Stop if your shoulder hurts.',
    sidePlank: 'Side planks load the shoulder a lot; start on your knees (Easy).',
    pullup: 'Pull-ups load the shoulders a lot. Start with short dead hangs or slow lowering from the top, and stop if your shoulder hurts.',
  },
  wrist: {
    pushup: 'Knuckle push-ups or push-up handles keep the wrist straight. Stop if it hurts.',
    plank: 'A forearm plank keeps the weight off your wrists.',
    sidePlank: 'Use your forearm, not a straight arm.',
    pullup: 'A palms-facing grip (chin-ups, or a neutral grip) is often easier on the wrists. Stop if it hurts.',
  },
  pregnancy: {
    crunch:
      'Lying on your back is usually not advised after the first three months of pregnancy, and crunches may not suit after birth. Check with your midwife or doctor first.',
    plank: 'Check with your midwife or doctor before planks, and stop if you feel any doming of the tummy.',
    pushup: 'Check with your midwife or doctor first; incline or knee push-ups are often easier.',
    sidePlank: 'Check with your midwife or doctor first.',
    pullup: 'Check with your midwife or doctor first; hanging and hard pulling may not suit pregnancy or the months after birth.',
  },
  injury: {
    pushup: 'Check with your clinician that this exercise is fine for you now.',
    crunch: 'Check with your clinician that this exercise is fine for you now.',
    plank: 'Check with your clinician that this exercise is fine for you now.',
    sidePlank: 'Check with your clinician that this exercise is fine for you now.',
    pullup: 'Check with your clinician that this exercise is fine for you now.',
  },
};

/** The notes for one exercise, most important first. */
export function safetyNotes(flags: SafetyFlag[], exercise: Exercise): string[] {
  const order: SafetyFlag[] = ['pregnancy', 'injury', 'back', 'neck', 'wrist'];
  return order.filter((f) => flags.includes(f)).flatMap((f) => (NOTES[f][exercise] ? [NOTES[f][exercise]!] : []));
}
