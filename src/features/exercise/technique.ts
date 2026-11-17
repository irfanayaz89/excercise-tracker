import type { Exercise } from '@/engine/types';

/**
 * How to do each exercise, step by step, shown before a set (the guide) and
 * on each exercise's screen. Plain, short sentences: read once, then done.
 *
 * Sources: ACE exercise library (crunch, push-up, plank, side plank), ACSM
 * resistance training guidance (sets and reps), McGill's curl-up and
 * side-bridge work, Harvard Health and Mayo Clinic safety notes.
 */
export interface Technique {
  /** Numbered how-to steps, in order. */
  steps: { title: string; body: string }[];
  /** Common mistakes, one short line each. */
  avoid: string[];
  breathe: string;
  /** A sensible amount to start with. */
  dose: string;
  /** Who should take care, and when to stop. */
  safety: string;
}

export const TECHNIQUE: Record<Exercise, Technique> = {
  pushup: {
    steps: [
      { title: 'Hands under your shoulders', body: 'Hands on the floor a little wider than your shoulders, fingers pointing forward.' },
      {
        title: 'Make one straight line',
        body: 'Step your feet back. Squeeze your glutes and brace your stomach so you are straight from head to heels.',
      },
      {
        title: 'Lower with control',
        body: 'Bend your elbows, about 45° from your sides, until they reach about 90° and your chest is near the floor.',
      },
      { title: 'Push all the way up', body: 'Press the floor away until your arms are straight again. That is one rep.' },
    ],
    avoid: [
      'Hips sagging towards the floor, or piking up high',
      'Half reps: go down to about 90°, then all the way up',
      'Elbows flared straight out to the sides',
      'Letting your head drop',
    ],
    breathe: 'Breathe in on the way down, out as you push up.',
    dose: 'Start with 2–3 sets of as many good reps as you can, with a minute of rest between sets.',
    safety: 'Stop if your wrists, shoulders or lower back hurt. Knee push-ups (Easy) are a good way to build up.',
  },
  crunch: {
    steps: [
      {
        title: 'Lie on your back',
        body: 'On a mat, side-on to the phone. Knees bent, feet flat and hip-width apart, heels about a foot from your hips.',
      },
      {
        title: 'Set your arms',
        body: 'Cross them on your chest, or rest your fingertips lightly by your ears. Do not lace your fingers behind your head.',
      },
      {
        title: 'Curl up',
        body: 'Breathe out, tighten your stomach and lift your head and shoulders until your shoulder blades leave the floor. Lower back and feet stay down.',
      },
      { title: 'Pause at the top', body: 'Hold for a moment. Keep a fist of space between your chin and your chest.' },
      {
        title: 'Lower slowly',
        body: 'Breathe in and uncurl until your shoulders touch the floor, or just above it. That is one rep.',
      },
    ],
    avoid: [
      'Pulling on your head or neck with your hands',
      'Sitting all the way up: a small lift is enough',
      'Feet or hips leaving the floor',
      'Bouncing or rushing: about 2–3 seconds a rep',
      'Holding your breath',
    ],
    breathe: 'Breathe out as you curl up, in as you lower.',
    dose: 'Start with 1–3 sets of 10–15 slow reps.',
    safety:
      'Check with a doctor or physio first if you have low back or neck pain, osteoporosis, recent stomach surgery, or are past the first three months of pregnancy. Stop if anything hurts.',
  },
  plank: {
    steps: [
      {
        title: 'Forearms or hands down',
        body: 'Elbows under your shoulders with forearms flat, or hands under your shoulders with straight arms.',
      },
      { title: 'Legs back', body: 'Step your feet back, hip-width apart, up on your toes, legs straight.' },
      {
        title: 'Make one straight line',
        body: 'Squeeze your glutes and brace your stomach so your hips sit level with your shoulders and heels.',
      },
      { title: 'Hold and breathe', body: 'Look at the floor just ahead of your hands and keep breathing slowly.' },
    ],
    avoid: ['Hips sagging towards the floor', 'Hips piked up high', 'Holding your breath', 'Dropping your head or looking up'],
    breathe: 'Breathe slowly and steadily the whole time.',
    dose: 'Start with 2–3 holds of 20–60 seconds. Add 5–10 seconds when it feels steady.',
    safety: 'Stop if your lower back hurts. A knee plank (Easy) is a good place to start.',
  },
  sidePlank: {
    steps: [
      {
        title: 'Lie on your side, facing the phone',
        body: 'Legs straight, feet stacked (or one in front of the other), elbow under your shoulder, forearm flat.',
      },
      {
        title: 'Lift your hips',
        body: 'Press your forearm into the floor and lift until you are one straight line from head to feet.',
      },
      {
        title: 'Stack and hold',
        body: 'Shoulders and hips stacked, chest facing the phone, top hand on your hip or pointing up.',
      },
      {
        title: 'Switch sides',
        body: 'Lower with control, turn around so the other side is down, still facing the phone, and hold again.',
      },
    ],
    avoid: [
      'Hips dropping towards the floor',
      'Rolling forward or back',
      'Elbow drifting away from under your shoulder',
      'Shrugging your shoulder up to your ear',
    ],
    breathe: 'Breathe slowly and steadily the whole time.',
    dose: 'Start with 2–3 holds of 15–45 seconds on each side, and aim for both sides to match.',
    safety: 'Stop if your shoulder or lower back hurts. A side plank on your knees (Easy) is a good place to start.',
  },
};
