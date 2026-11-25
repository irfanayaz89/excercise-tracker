/// <reference types="jest" />
/**
 * Earning time from finished sets (plan §4): rates per exercise, flagged reps
 * worth less, the daily cap, and the sets that must never earn.
 */
import type { SessionSummary } from '@/engine/session';
import { freshDay } from '../decide';
import { earnFromSet, minutesFor, setWorth } from '../earn';
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

  it('pull-ups are worth 2.5 push-ups; crunches 0.4 (a lighter effort class)', () => {
    expect(minutesFor(r, reps('pullup', 4, 4))).toBe(10);
    expect(minutesFor(r, reps('pullup', 5, 4))).toBe(11);
    expect(minutesFor(r, reps('crunch', 30, 30))).toBe(12);
    expect(minutesFor(r, reps('crunch', 10, 6))).toBe(3);
  });

  it('planks and side planks: 1 min per 6 s in good form (a 60 s plank ≈ 10 push-ups)', () => {
    expect(minutesFor(r, hold('plank', 60_000))).toBe(10);
    expect(minutesFor(r, hold('plank', 5_999))).toBe(0);
    expect(minutesFor(r, hold('plank', 6_000))).toBe(1);
    expect(minutesFor(r, hold('sidePlank', 45_000))).toBe(7);
  });

  it('a plank seen head-on earns half: the camera cannot see the hips sag', () => {
    expect(minutesFor(r, { ...hold('plank', 60_000), view: 'front' })).toBe(5);
    expect(minutesFor(r, { ...hold('plank', 60_000), view: 'side' })).toBe(10);
  });

  it('older summaries with no exercise are push-ups', () => {
    expect(minutesFor(r, { ...base, totalReps: 5, cleanReps: 5 })).toBe(5);
  });

  it('nothing done earns nothing', () => {
    expect(minutesFor(r, reps('pushup', 0, 0))).toBe(0);
    expect(minutesFor(r, hold('plank', 0))).toBe(0);
  });
});

describe('set tiers: 1 min per push-up equivalent plus milestones', () => {
  const w = (summary: SessionSummary, earnedToday = 0, extra: { firstOfDay?: boolean; cameBack?: boolean } = {}) =>
    setWorth(r, summary, { earnedToday, ...extra });

  it('10 push-ups earn 15 min and 20 earn 30', () => {
    expect(w(reps('pushup', 10, 10))).toMatchObject({ minutes: 15, bonus: 5, halfRate: false });
    expect(w(reps('pushup', 20, 20)).minutes).toBe(30);
    expect(w(reps('pushup', 9, 9)).minutes).toBe(9);
  });

  it('other exercises reach the same milestones in push-up equivalents', () => {
    expect(w(reps('pullup', 4, 4)).minutes).toBe(15); // 10 PE
    expect(w(reps('pullup', 8, 8)).minutes).toBe(30); // 20 PE
    expect(w(reps('crunch', 25, 25)).minutes).toBe(15);
    expect(w(hold('plank', 60_000)).minutes).toBe(15);
    expect(w(hold('plank', 120_000)).minutes).toBe(30);
  });

  it('a set is paid for at most 40 push-up equivalents (milestones still count)', () => {
    const roomy = rules({ earning: { ...r.earning, fullRateMin: 120, dailyCapMin: 120 } });
    expect(setWorth(roomy, reps('pushup', 50, 50), { earnedToday: 0 }).minutes).toBe(50);
    expect(setWorth(roomy, reps('pushup', 80, 80), { earnedToday: 0 }).minutes).toBe(50);
  });

  it('splitting a set gains nothing: 2 × 10 pays the same as 1 × 20, and 4 × 5 less', () => {
    const two = w(reps('pushup', 10, 10)).minutes + w(reps('pushup', 10, 10), 15).minutes;
    expect(two).toBe(w(reps('pushup', 20, 20)).minutes);
    const four = [0, 5, 10, 15].reduce((n, earned) => n + w(reps('pushup', 5, 5), earned).minutes, 0);
    expect(four).toBeLessThan(two);
  });

  it('the first real set of the day earns +3, and coming back after a break +5 more', () => {
    expect(w(reps('pushup', 10, 10), 0, { firstOfDay: true }).minutes).toBe(18);
    expect(w(reps('pushup', 10, 10), 0, { firstOfDay: true, cameBack: true }).minutes).toBe(23);
    // A token set of 3 earns no day bonus.
    expect(w(reps('pushup', 3, 3), 0, { firstOfDay: true, cameBack: true }).minutes).toBe(3);
  });

  it('past the full-rate minutes, the rest of a set earns half', () => {
    // 25 earned, full rate to 30: 5 at full rate, then (30 − 5) / 2 = 12.
    expect(w(reps('pushup', 20, 20), 25)).toMatchObject({ minutes: 17, halfRate: true });
  });
});

describe('crediting a set', () => {
  const input = (summary: SessionSummary, sessionId = 's1', demo = false) => ({ summary, sessionId, demo });

  it('adds the minutes to today and records where they came from', () => {
    const res = earnFromSet(london, r, freshDay(london, NOW), input(reps('pushup', 10, 10)), NOW);
    // 10 + milestone 5 + first set of the day 3.
    expect(res).toMatchObject({ minutes: 18, bonus: 8, halfRate: false, reason: 'earned', capped: false });
    expect(res.log.earnedMin).toBe(18);
    expect(res.log.grants).toEqual([{ id: `s1:${NOW}`, at: NOW, minutes: 18, exercise: 'pushup', sessionId: 's1' }]);
    // The second set of the day has no first-set bonus.
    expect(earnFromSet(london, r, res.log, input(reps('pushup', 5, 5), 's2'), NOW).minutes).toBe(5);
  });

  it('coming back after a break earns the welcome-back bonus once', () => {
    const res = earnFromSet(london, r, freshDay(london, NOW), { ...input(reps('pushup', 10, 10)), cameBack: true }, NOW);
    expect(res.minutes).toBe(23);
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

  it('stops at the daily most (60 by default), and says so', () => {
    let log = freshDay(london, NOW);
    // 40 PE cap + 10 milestones + 3 first set = 53: 30 at full rate, 23 / 2 = 11.
    const first = earnFromSet(london, r, log, input(reps('pushup', 100, 100), 'a'), NOW);
    expect(first).toMatchObject({ minutes: 41, halfRate: true, capped: false });
    log = first.log;
    const second = earnFromSet(london, r, log, input(reps('pushup', 50, 50), 'b'), NOW);
    expect(second).toMatchObject({ minutes: 19, capped: true, reason: 'earned' });
    expect(second.log.earnedMin).toBe(60);
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
    expect(earnFromSet(london, r, log, input(reps('pushup', 10, 10), 'b'), tomorrow)).toMatchObject({ minutes: 18, reason: 'earned' });
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
