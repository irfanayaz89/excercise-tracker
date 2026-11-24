/// <reference types="jest" />
/**
 * Earning time from finished sets (plan §4): rates per exercise, flagged reps
 * worth less, the daily cap, and the sets that must never earn.
 */
import type { SessionSummary } from '@/engine/session';
import { freshDay } from '../decide';
import { earnFromSet, minutesFor } from '../earn';
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
const reps = (exercise: SessionSummary['exercise'], total: number, clean: number): SessionSummary => ({
  ...base,
  exercise,
  totalReps: total,
  cleanReps: clean,
});
const hold = (exercise: SessionSummary['exercise'], goodMs: number): SessionSummary => ({
  ...base,
  exercise,
  hold: { variant: 'forearm', goodMs, totalMs: goodMs, longestMs: goodMs, breaks: 0, faultMs: {}, headDownMs: 0, formPct: 1 },
});
const r = rules();

describe('minutes per set', () => {
  it('push-ups: 1 min per clean rep, ½ per flagged rep (rounded down)', () => {
    expect(minutesFor(r, reps('pushup', 20, 20))).toBe(20);
    expect(minutesFor(r, reps('pushup', 20, 15))).toBe(17);
    expect(minutesFor(r, reps('pushup', 3, 0))).toBe(1);
  });

  it('crunches: ½ min per clean rep, ¼ per flagged', () => {
    expect(minutesFor(r, reps('crunch', 30, 30))).toBe(15);
    expect(minutesFor(r, reps('crunch', 10, 6))).toBe(4);
  });

  it('planks and side planks: 2 min per 10 s in good form', () => {
    expect(minutesFor(r, hold('plank', 60_000))).toBe(12);
    expect(minutesFor(r, hold('plank', 9_999))).toBe(1);
    expect(minutesFor(r, hold('sidePlank', 45_000))).toBe(9);
  });

  it('older summaries with no exercise are push-ups', () => {
    expect(minutesFor(r, { ...base, totalReps: 5, cleanReps: 5 })).toBe(5);
  });

  it('nothing done earns nothing', () => {
    expect(minutesFor(r, reps('pushup', 0, 0))).toBe(0);
    expect(minutesFor(r, hold('plank', 0))).toBe(0);
  });
});

describe('crediting a set', () => {
  const input = (summary: SessionSummary, sessionId = 's1', demo = false) => ({ summary, sessionId, demo });

  it('adds the minutes to today and records where they came from', () => {
    const res = earnFromSet(london, r, freshDay(london, NOW), input(reps('pushup', 20, 20)), NOW);
    expect(res).toMatchObject({ minutes: 20, reason: 'earned', capped: false });
    expect(res.log.earnedMin).toBe(20);
    expect(res.log.grants).toEqual([{ id: `s1:${NOW}`, at: NOW, minutes: 20, exercise: 'pushup', sessionId: 's1' }]);
  });

  it('demo sets never earn', () => {
    expect(earnFromSet(london, r, freshDay(london, NOW), input(reps('pushup', 50, 50), 'd', true), NOW)).toMatchObject({
      minutes: 0,
      reason: 'demo',
    });
  });

  it('a set earns once only', () => {
    const first = earnFromSet(london, r, freshDay(london, NOW), input(reps('pushup', 10, 10)), NOW);
    expect(earnFromSet(london, r, first.log, input(reps('pushup', 10, 10)), NOW + 1000)).toMatchObject({ minutes: 0, reason: 'duplicate' });
  });

  it('stops at the daily cap, and says so', () => {
    let log = freshDay(london, NOW);
    log = earnFromSet(london, r, log, input(reps('pushup', 100, 100), 'a'), NOW).log;
    const second = earnFromSet(london, r, log, input(reps('pushup', 50, 50), 'b'), NOW);
    expect(second).toMatchObject({ minutes: 20, capped: true, reason: 'earned' });
    expect(second.log.earnedMin).toBe(120);
    expect(earnFromSet(london, r, second.log, input(reps('pushup', 5, 5), 'c'), NOW)).toMatchObject({
      minutes: 0,
      reason: 'cap-reached',
      capped: true,
    });
  });

  it('the cap is per day: tomorrow starts again', () => {
    let log = freshDay(london, NOW);
    log = earnFromSet(london, r, log, input(reps('pushup', 200, 200), 'a'), NOW).log;
    const tomorrow = T(london, '2026-11-19 08:00');
    expect(earnFromSet(london, r, log, input(reps('pushup', 10, 10), 'b'), tomorrow)).toMatchObject({ minutes: 10, reason: 'earned' });
  });

  it('earning switched off: nothing is credited', () => {
    const off = rules({ earning: { ...r.earning, enabled: false } });
    expect(earnFromSet(london, off, freshDay(london, NOW), input(reps('pushup', 20, 20)), NOW)).toMatchObject({
      minutes: 0,
      reason: 'disabled',
    });
  });

  it('a set that ended on the real-person check earns only the reps it kept', () => {
    // The engine already took back the reps counted from the screen video.
    const kept = { ...reps('pushup', 4, 4), realityFlags: 1 };
    expect(earnFromSet(london, r, freshDay(london, NOW), input(kept), NOW).minutes).toBe(4);
  });

  it('a set with nothing in it earns nothing', () => {
    expect(earnFromSet(london, r, freshDay(london, NOW), input(reps('pushup', 0, 0)), NOW)).toMatchObject({
      minutes: 0,
      reason: 'nothing',
    });
  });
});
