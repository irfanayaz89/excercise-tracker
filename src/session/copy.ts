import type { FramingIssue, PhoneIssue, PlankIssue } from '@/engine/gates';
import type { MissReason, RepFault } from '@/engine/repCounter';
import type { HoldFault } from '@/engine/holdTimer';
import type { RealityIssue } from '@/engine/reality';
import type { Cue, PauseReason } from '@/engine/session';
import type { Difficulty } from '@/engine/difficulty';
import type { Exercise, PhoneOrientation } from '@/engine/types';
import { EXERCISES, isTimed } from '@/engine/exercises';

/**
 * Every user-facing coaching message. `short` is shown in huge type on the
 * live screen (read from 2 m away), `detail` underneath, `say` is spoken.
 */
export interface Copy {
  short: string;
  detail: string;
  say?: string;
}

export const PHONE_COPY: Record<PhoneIssue, Copy> = {
  'stand-up': {
    short: 'Stand it up',
    detail: 'Stand the phone upright on its long edge, screen facing your workout spot.',
    say: 'Stand the phone up',
  },
  // Placeholder; the real text depends on the picked orientation (see phoneCopy).
  'wrong-orientation': { short: 'Turn the phone', detail: 'Turn the phone the way you picked.' },
  'tilted-sideways': { short: 'Level it', detail: 'The phone is tilted. Straighten it until the bubble sits between the lines.' },
  leaning: { short: 'Less lean', detail: 'Lean the phone back a little less. Prop it against something upright.' },
  moving: { short: 'Hold still', detail: 'Let go of the phone and let it settle.' },
  'no-sensor': {
    short: 'Place your phone',
    detail: 'Tilt sensor unavailable. Stand the phone on the floor in landscape, then tap "Phone is set".',
  },
};

/** Where the phone goes for each orientation. Portrait is narrower, so it needs more distance. */
export const PLACEMENT: Record<PhoneOrientation, { label: string; distance: string; spoken: string; how: string }> = {
  landscape: {
    label: 'Landscape',
    distance: '1.5–2 m',
    spoken: '1.5 to 2 metres',
    how: 'Stand the phone sideways on the floor, propped against a wall or something steady.',
  },
  portrait: {
    label: 'Portrait',
    distance: '2.5–3 m',
    spoken: '2.5 to 3 metres',
    how: 'Stand the phone upright on the floor, propped against a wall or something steady.',
  },
};

export function phoneCopy(issue: PhoneIssue, o: PhoneOrientation): Copy {
  if (issue === 'wrong-orientation') {
    return o === 'landscape'
      ? {
          short: 'Turn sideways',
          detail: 'You picked landscape. Turn the phone on its side, or switch to portrait on the home screen.',
          say: 'Turn the phone sideways',
        }
      : {
          short: 'Turn upright',
          detail: 'You picked portrait. Stand the phone upright, or switch to landscape on the home screen.',
          say: 'Stand the phone upright',
        };
  }
  if (issue === 'no-sensor') {
    return {
      short: 'Place your phone',
      detail: `${PLACEMENT[o].how} About ${PLACEMENT[o].distance} to the side of your workout spot, then tap "Phone is set".`,
    };
  }
  return PHONE_COPY[issue];
}

export function framingCopy(issue: FramingIssue, o: PhoneOrientation): Copy {
  if (issue === 'move-closer') {
    return { ...FRAMING_COPY[issue], detail: `You look small. Move to about ${PLACEMENT[o].spoken} from the phone.` };
  }
  if (issue === 'show-feet' && o === 'portrait') {
    return {
      ...FRAMING_COPY[issue],
      detail:
        'Your feet are out of frame. Move the phone further away, or turn it to landscape, which fits your whole body at 1.5 to 2 metres.',
    };
  }
  return FRAMING_COPY[issue];
}

export const DIFFICULTY_COPY: Record<Difficulty, { label: string; short: string; detail: string }> = {
  easy: {
    label: 'Easy',
    short: 'Just count my push-ups',
    detail: 'Upper body in view is enough. No form checks, knees allowed, relaxed phone setup.',
  },
  medium: {
    label: 'Medium',
    short: 'Count and check main form',
    detail: 'Whole body in view. Flags sagging or high hips and half reps, with some slack.',
  },
  hard: {
    label: 'Hard',
    short: 'Strict form',
    detail: 'Full depth, locked arms, a straight body line and hands under shoulders.',
  },
};

/** Names and units come from the exercise registry. */
export const EXERCISE_COPY: Record<Exercise, { label: string; unit: string }> = EXERCISES;

/** Plank levels: the same three settings, described for a timed hold. */
export const PLANK_DIFFICULTY_COPY: Record<Difficulty, { label: string; short: string; detail: string }> = {
  easy: {
    label: 'Easy',
    short: 'Relaxed hold',
    detail: 'Upper body in view is enough. Knee planks are fine; only a big sag or piked hips stop the clock.',
  },
  medium: {
    label: 'Medium',
    short: 'Hold with form checks',
    detail: 'Whole body in view. The clock pauses if your hips sag or rise, with some slack.',
  },
  hard: {
    label: 'Hard',
    short: 'Strict hold',
    detail: 'One straight line from shoulders to heels. The clock stops at a small sag.',
  },
};

export function difficultyCopy(d: Difficulty, exercise: Exercise) {
  return isTimed(exercise) ? PLANK_DIFFICULTY_COPY[d] : DIFFICULTY_COPY[d];
}

/** Gentle, non-blocking tips shown while setting up. */
export const SOFT_HINT_COPY: Partial<Record<FramingIssue, string>> = {
  'show-feet': 'Tip: show your feet too for steadier tracking',
  'show-head': 'Tip: keep your head in view too',
  'low-light': 'Low light. Counting may be less reliable',
};

export const FRAMING_COPY: Record<FramingIssue, Copy> = {
  'no-person': { short: 'Get in view', detail: 'Step into the frame, side-on to the phone.', say: 'Step into view' },
  'move-back': { short: 'Move back', detail: 'You are too close. Move the phone or yourself further apart.', say: 'Move back a little' },
  'move-closer': {
    short: 'Come closer',
    detail: 'You look small. Move to about 1.5 to 2 metres from the phone.',
    say: 'Come a little closer',
  },
  'show-feet': {
    short: 'Show your feet',
    detail: 'Your feet are out of frame. Shift so your whole body fits.',
    say: 'I can’t see your feet',
  },
  'show-head': { short: 'Show your head', detail: 'Your head and shoulders are out of frame.', say: 'I can’t see your shoulders' },
  'turn-sideways': {
    short: 'Turn side-on',
    detail: 'Face along the floor, side-on to the phone, not towards it.',
    say: 'Turn side-on to the phone',
  },
  'low-light': {
    short: 'More light',
    detail: 'It is too dark to see you clearly. Turn on a light or face a window.',
    say: 'It’s a bit dark',
  },
};

export const PLANK_COPY: Record<PlankIssue, Copy> = {
  'get-down': {
    short: 'Get into push-up position',
    detail: 'Get down on the floor, side-on to the phone, hands on the floor and body roughly flat.',
    say: 'Get into push-up position',
  },
  'straighten-arms': { short: 'Push up to start', detail: 'Start at the top, with your arms straight.', say: 'Push up to start' },
  'straighten-legs': {
    short: 'Legs straight',
    detail: 'Come off your knees. Knee push-ups can be turned on in settings.',
    say: 'Straighten your legs',
  },
  'hips-sagging': {
    short: 'Lift your hips',
    detail: 'Squeeze your glutes and brace so your hips line up with your shoulders.',
    say: 'Lift your hips',
  },
  'hips-high': { short: 'Lower your hips', detail: 'Bring your hips down into one straight line.', say: 'Lower your hips' },
  'hands-under-shoulders': { short: 'Hands under shoulders', detail: 'Move your hands so they sit under your shoulders.' },
  'elbows-under-shoulders': {
    short: 'Elbows under shoulders',
    detail: 'Set your elbows directly under your shoulders, forearms flat on the floor.',
    say: 'Elbows under your shoulders',
  },
  'roll-onto-side': {
    short: 'Turn onto your side',
    detail: 'Lie on one side facing the phone, shoulders stacked one above the other.',
    say: 'Turn onto your side, facing the phone',
  },
  'hold-still': { short: 'Hold still', detail: 'Hold the plank steady for a second.' },
};

/** The start-check messages, worded for the exercise being set up. */
export function plankIssueCopy(issue: PlankIssue, exercise: Exercise): Copy {
  if (!isTimed(exercise)) return PLANK_COPY[issue];
  if (exercise === 'sidePlank') {
    switch (issue) {
      case 'get-down':
        return {
          short: 'Get into a side plank',
          detail: 'Lie on one side facing the phone, elbow under your shoulder, then lift your hips off the floor.',
          say: 'Get into a side plank',
        };
      case 'straighten-arms':
        return {
          short: 'Elbow under your shoulder',
          detail: 'Rest on your forearm with the elbow under your shoulder, or push up onto a straight arm.',
          say: 'Elbow under your shoulder',
        };
      case 'hips-sagging':
        return {
          short: 'Lift your hips',
          detail: 'Push the floor away and lift your hips until your body is one straight line.',
          say: 'Lift your hips',
        };
      case 'straighten-legs':
        return {
          short: 'Legs straight',
          detail: 'Stack your feet with straight legs. Easy mode accepts side planks on your knees.',
          say: 'Straighten your legs',
        };
      default:
        break;
    }
  }
  switch (issue) {
    case 'get-down':
      return {
        short: 'Get into a plank',
        detail: 'Get down on the floor, side-on to the phone, on your hands or forearms with your body flat.',
        say: 'Get into a plank',
      };
    case 'straighten-arms':
      return {
        short: 'Arms straight or forearms down',
        detail: 'Hold a plank on straight arms, or rest on your forearms with your elbows under your shoulders.',
        say: 'Straight arms, or down on your forearms',
      };
    case 'straighten-legs':
      return { short: 'Legs straight', detail: 'Come off your knees. Easy mode accepts knee planks.', say: 'Straighten your legs' };
    default:
      return PLANK_COPY[issue];
  }
}

export const FAULT_COPY: Record<RepFault, Copy> = {
  'hips-sagging': { short: 'Hips sagging', detail: 'Brace your core and squeeze your glutes.', say: 'Hips up' },
  'hips-piking': { short: 'Hips too high', detail: 'Keep a straight line from shoulders to heels.', say: 'Hips down' },
  rushed: { short: 'Slow down', detail: 'Control the way down. Aim for about two seconds a rep.', say: 'Slow it down' },
  'head-dropping': { short: 'Head up', detail: 'Keep your neck in line, look at the floor just ahead of your hands.' },
};

export const MISS_COPY: Record<MissReason, Copy> = {
  'not-deep-enough': { short: 'Go lower', detail: 'Bend until your elbows reach about 90°.', say: 'Go lower' },
  'no-lockout': { short: 'Lock out', detail: 'Push all the way up until your arms are straight.', say: 'All the way up' },
  'too-slow': { short: 'Reset', detail: 'That one took too long to count. Push back up to start again.' },
};

export const PAUSE_COPY: Record<PauseReason, Copy> = {
  'lost-tracking': { short: 'Lost you', detail: 'Get back into view and into a plank to carry on.', say: 'Paused' },
  'left-position': { short: 'Resting', detail: 'Get back into a plank when you are ready. Your count is saved.', say: 'Paused' },
  'phone-moved': {
    short: 'Phone moved',
    detail: 'The phone was knocked. Level it again, then get back into a plank.',
    say: 'The phone moved',
  },
  interrupted: { short: 'Paused', detail: 'Welcome back. Get into a plank to continue.' },
  'other-person': { short: 'Someone else?', detail: 'Another person came into view. Make sure only you are in frame.' },
  'not-real': {
    short: 'Real person needed',
    detail:
      'This looks like a video on a screen. Trueline only counts a real person in front of the camera, so the last few seconds were not counted. Put the screen away and get into position to carry on.',
    say: 'Only a real person counts',
  },
  'switch-sides': {
    short: 'Switch sides',
    detail: 'That side is done. Turn around and hold a side plank on the other side to finish.',
    say: 'Switch sides',
  },
};

/** Plank faults. First pass; the plank UI work refines these. */
export const HOLD_COPY: Record<HoldFault, Copy> = {
  'hips-sagging': { short: 'Lift your hips', detail: 'Brace your core and squeeze your glutes.', say: 'Hips up' },
  'hips-piking': { short: 'Lower your hips', detail: 'Bring your hips down into one straight line.', say: 'Hips down' },
  'knees-bent': {
    short: 'Straighten your legs',
    detail: 'Squeeze your thighs and glutes so your knees lock straight.',
    say: 'Legs straight',
  },
  'arms-bent': { short: 'Straighten your arms', detail: 'Push the floor away and lock your arms.', say: 'Arms straight' },
  'hands-under-shoulders': {
    short: 'Hands under shoulders',
    detail: 'Walk your hands back so they sit under your shoulders.',
    say: 'Hands under your shoulders',
  },
  'elbows-under-shoulders': {
    short: 'Elbows under shoulders',
    detail: 'Stack your shoulders over your elbows.',
    say: 'Elbows under shoulders',
  },
  'out-of-view': {
    short: 'Show your feet',
    detail: 'The clock waits until your whole body is back in view.',
    say: 'I can’t see your feet',
  },
  rolled: {
    short: 'Stack your shoulders',
    detail: 'You are rolling forward or back. Turn your chest to face the phone, shoulders and hips stacked.',
    say: 'Stack your shoulders',
  },
  dropped: { short: 'Back into your plank', detail: 'Get back into your plank to keep the clock running.', say: 'Back into your plank' },
};

/** Setup headline when the camera seems to be looking at a screen. */
export const REALITY_COPY: Record<RealityIssue, Copy> = {
  screen: {
    short: 'Real person needed',
    detail: 'This looks like a video on a screen. Trueline only counts a real person in front of the camera.',
    say: 'Only a real person counts',
  },
  handheld: {
    short: 'Real person needed',
    detail: 'This looks like a screen held up to the camera. Trueline only counts a real person in front of the camera.',
    say: 'Only a real person counts',
  },
};

/** Pause messages, worded for the exercise (a plank keeps its time, push-ups their count). */
export function pauseCopy(reason: PauseReason, exercise: Exercise): Copy {
  const c = PAUSE_COPY[reason];
  if (!isTimed(exercise)) return c;
  switch (reason) {
    case 'left-position':
      return { ...c, detail: 'Get back into your plank when you are ready. Your time is saved.' };
    case 'lost-tracking':
      return { ...c, detail: 'Get back into view and into your plank to carry on. Your time is saved.' };
    case 'not-real':
      return {
        ...c,
        detail:
          'This looks like a video on a screen. Trueline only times a real person in front of the camera, so the last few seconds were not counted. Put the screen away and get into your plank to carry on.',
      };
    default:
      return c;
  }
}

const NUMBERS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

export interface SpeechOptions {
  countAloud: boolean;
  exercise?: Exercise;
  /** Guided users hear the full instruction during setup; quick users hear a few words. */
  guided: boolean;
  orientation: PhoneOrientation;
}

/** Setup cues: full sentence when guided (the user is still learning), short phrase otherwise. */
/** high: cut off whatever is playing; queued: play after it; normal: skip if busy. */
export type SpeechPriority = 'high' | 'queued' | 'normal';

function setupLine(c: Copy, guided: boolean): { text: string; priority: 'normal' } | null {
  if (guided) return { text: c.detail, priority: 'normal' };
  return c.say ? { text: c.say, priority: 'normal' } : null;
}

export function cueSpeech(cue: Cue, o: SpeechOptions): { text: string; priority: SpeechPriority } | null {
  const { countAloud, guided, orientation } = o;
  const exercise = o.exercise ?? 'pushup';
  switch (cue.kind) {
    case 'phone':
      return setupLine(phoneCopy(cue.issue, orientation), guided);
    case 'framing':
      return setupLine(framingCopy(cue.issue, orientation), guided);
    case 'plank':
      return setupLine(plankIssueCopy(cue.issue, exercise), guided);
    case 'start':
      // Mid-set cues stay short for everyone: nobody can listen to a sentence mid-rep.
      if (isTimed(exercise)) return { text: guided ? 'Go. The clock runs while your body stays in one line.' : 'Go', priority: 'high' };
      return { text: guided ? 'Go. Reps count when your arms lock out at the top.' : 'Go', priority: 'high' };
    case 'resume':
      return { text: 'Carry on', priority: 'high' };
    case 'rep':
      return countAloud ? { text: cue.count <= 10 ? NUMBERS[cue.count] : String(cue.count), priority: 'high' } : null;
    case 'fault':
      return FAULT_COPY[cue.fault].say ? { text: FAULT_COPY[cue.fault].say!, priority: 'normal' } : null;
    case 'miss':
      return MISS_COPY[cue.reason].say ? { text: MISS_COPY[cue.reason].say!, priority: 'normal' } : null;
    case 'paused': {
      const c = pauseCopy(cue.reason, exercise);
      return c.say ? { text: c.say, priority: 'normal' } : null;
    }
    case 'target-reached':
      // Queued after the final count, so the last number is not cut off.
      return { text: isTimed(exercise) ? 'Time. Nice hold.' : 'Target reached. Nice set.', priority: 'queued' };
    case 'hold': {
      const say = HOLD_COPY[cue.fault].say;
      if (!say) return null;
      // A break interrupts whatever is playing: the clock has just stopped.
      return cue.state === 'break' ? { text: `Clock stopped. ${say}`, priority: 'high' } : { text: say, priority: 'normal' };
    }
    case 'hold-restored':
      return { text: 'Good. Clock running', priority: 'normal' };
    case 'hold-time':
      return { text: spokenSeconds(cue.seconds), priority: 'high' };
    case 'hold-countdown':
      return { text: String(cue.seconds), priority: 'high' };
    case 'not-real':
      return { text: REALITY_COPY[cue.issue].say!, priority: 'high' };
    case 'switch-sides':
      return { text: 'Time. Switch sides', priority: 'queued' };
  }
}

/** Short banner shown after a rep or miss, or null. */
export function cueBanner(cue: Cue, exercise: Exercise = 'pushup'): (Copy & { tone: 'good' | 'cue' | 'fault' }) | null {
  switch (cue.kind) {
    case 'hold':
      return cue.state === 'break'
        ? { short: HOLD_COPY[cue.fault].short, detail: `Clock paused. ${HOLD_COPY[cue.fault].detail}`, tone: 'fault' }
        : { ...HOLD_COPY[cue.fault], tone: 'cue' };
    case 'hold-restored':
      return { short: 'Good', detail: 'Clock running again.', tone: 'good' };
    case 'not-real':
      return { ...REALITY_COPY[cue.issue], tone: 'fault' };
    case 'switch-sides':
      return {
        short: 'Switch sides',
        detail: `${cue.done === 'left' ? 'Left' : 'Right'} side done. Hold the other side to finish.`,
        tone: 'good',
      };
    case 'fault':
      return { ...FAULT_COPY[cue.fault], tone: cue.fault === 'head-dropping' ? 'cue' : 'fault' };
    case 'miss':
      return { ...MISS_COPY[cue.reason], tone: 'cue' };
    case 'start':
      return isTimed(exercise)
        ? { short: 'Go', detail: 'Timing. The clock runs while your body stays in one line.', tone: 'good' }
        : { short: 'Go', detail: 'Counting. Push-ups count when you lock out at the top.', tone: 'good' };
    case 'resume':
      return { short: 'Carry on', detail: isTimed(exercise) ? 'Timing again.' : 'Counting again.', tone: 'good' };
    default:
      return null;
  }
}

/** 15 → "15 seconds", 60 → "1 minute", 75 → "1 minute 15". */
function spokenSeconds(s: number): string {
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m === 0) return `${r} seconds`;
  const mins = m === 1 ? '1 minute' : `${m} minutes`;
  return r === 0 ? mins : `${mins} ${r}`;
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/** Shown when the user has been stuck for a while because the whole body does not fit. */
export function noRoomTip(o: PhoneOrientation): string {
  return o === 'portrait'
    ? 'Short on room? Turn the phone to landscape (fits at 1.5–2 m), or pick Easy, which does not need your feet.'
    : 'Short on room? Easy mode does not need your feet in view.';
}
