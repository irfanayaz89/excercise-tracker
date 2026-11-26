/// <reference types="jest" />
/**
 * The reward table the app promises (Earn screen, report): each case run
 * through the real earning code, one set after another on the same day, so
 * the first-set bonus, the half rate and the daily cap all apply as in use.
 */
import type { SessionSummary } from '@/engine/session';
import { freshDay } from '../decide';
import { earnFromSet, setWorth } from '../earn';
import type { DayLog } from '../types';
import { london, rules, T } from './helpers';

const NOW = T(london, '2026-11-18 12:00');
const base: SessionSummary = {
  startedAt: 0,
  endedAt: 60_000,
  activeMs: 60_000,
  endReason: 'user',
  reps: [],
  misses: [],
  totalReps: 0,
  cleanReps: 0,
  faultCounts: {},
  missCounts: {},
  avgRepMs: null,
  avgScore: null,
  bestCleanStreak: 0,
  pauses: 0,
};
const reps = (exercise: SessionSummary['exercise'], total: number, clean = total): SessionSummary => ({
  ...base,
  exercise,
  totalReps: total,
  cleanReps: clean,
});
const hold = (exercise: 'plank' | 'sidePlank', goodMs: number): SessionSummary => ({
  ...base,
  exercise,
  hold: { variant: 'forearm', goodMs, totalMs: goodMs, longestMs: goodMs, breaks: 0, faultMs: {}, headDownMs: 0, formPct: 1 },
});
const r = rules();
/** A set's worth on its own, not the first of the day (so no day bonus), nothing earned yet. */
const worth = (s: SessionSummary) => setWorth(r, s, { earnedToday: 0 }).minutes;

describe('one set on its own', () => {
  test.each([
    ['5 push-ups', reps('pushup', 5), 5],
    ['9 push-ups (just under the milestone)', reps('pushup', 9), 9],
    ['10 push-ups', reps('pushup', 10), 15],
    ['20 push-ups', reps('pushup', 20), 30],
    // 40 + 10 milestone minutes = 50, but past 30 in a day the rest is worth half: 30 + 20 / 2.
    ['40 push-ups (the per-set cap)', reps('pushup', 40), 40],
    ['60 push-ups (paid as 40)', reps('pushup', 60), 40],
    ['10 push-ups, 2 flagged', reps('pushup', 10, 8), 9],
    ['4 pull-ups (10 PE)', reps('pullup', 4), 15],
    ['8 pull-ups (20 PE)', reps('pullup', 8), 30],
    ['25 crunches (10 PE)', reps('crunch', 25), 15],
    ['50 crunches (20 PE)', reps('crunch', 50), 30],
    ['60 s plank (10 PE)', hold('plank', 60_000), 15],
    ['2 min plank (20 PE)', hold('plank', 120_000), 30],
    ['30 s side plank', hold('sidePlank', 30_000), 5],
  ])('%s: %i min', (_name, s, minutes) => {
    expect(worth(s)).toBe(minutes);
  });

  test('day bonuses: +3 for the first set of the day, +5 more coming back after a break', () => {
    expect(setWorth(r, reps('pushup', 10), { earnedToday: 0, firstOfDay: true }).minutes).toBe(18);
    expect(setWorth(r, reps('pushup', 10), { earnedToday: 0, firstOfDay: true, cameBack: true }).minutes).toBe(23);
    // A tiny set earns no day bonus.
    expect(setWorth(r, reps('pushup', 4), { earnedToday: 0, firstOfDay: true }).minutes).toBe(4);
  });
});

describe('a day of sets', () => {
  test('full rate to 30 min, half after, capped at 60', () => {
    let log: DayLog = freshDay(london, NOW);
    const earned: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = earnFromSet(london, r, log, { summary: reps('pushup', 20), sessionId: `s${i}`, demo: false }, NOW + i * 60_000);
      earned.push(res.minutes);
      log = res.log;
    }
    // 1st: 30 + 3 first-set bonus = 33, full rate up to 30 then half: 30 + floor(3/2) = 31.
    // 2nd: all past 30 → floor(30/2) = 15. 3rd: 15 → 61, capped to 60 → 14. Then nothing.
    expect(earned).toEqual([31, 15, 14, 0, 0, 0]);
    expect(log.earnedMin).toBe(60);
  });

  test('two sets of 10 pay the same as one of 20', () => {
    const one = setWorth(r, reps('pushup', 20), { earnedToday: 0 }).minutes;
    const a = setWorth(r, reps('pushup', 10), { earnedToday: 0 }).minutes;
    const b = setWorth(r, reps('pushup', 10), { earnedToday: a }).minutes;
    expect(a + b).toBe(one);
  });

  test('demo sets and the same set twice earn nothing', () => {
    const log = freshDay(london, NOW);
    expect(earnFromSet(london, r, log, { summary: reps('pushup', 20), sessionId: 'd', demo: true }, NOW).minutes).toBe(0);
    const first = earnFromSet(london, r, log, { summary: reps('pushup', 20), sessionId: 's', demo: false }, NOW);
    expect(earnFromSet(london, r, first.log, { summary: reps('pushup', 20), sessionId: 's', demo: false }, NOW).minutes).toBe(0);
  });

  test('a small warm-up set does not use up the first-set bonus', () => {
    let log: DayLog = freshDay(london, NOW);
    const warm = earnFromSet(london, r, log, { summary: reps('pushup', 4), sessionId: 'w', demo: false }, NOW);
    expect(warm.minutes).toBe(4);
    log = warm.log;
    // The first real set still gets +3.
    expect(earnFromSet(london, r, log, { summary: reps('pushup', 10), sessionId: 'r', demo: false }, NOW + 60_000).minutes).toBe(18);
  });
});
