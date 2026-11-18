/// <reference types="jest" />
/**
 * The bridge to the phone's own blocking (plan §7–§9): the plan handed to the
 * native side must say exactly what decide() says, and what the native side
 * reports back must never hand out more time than the rules allow.
 */
import { decide, freshDay } from '../decide';
import { mergeReport, parseReport, toNativePlan, type NativeReport } from '../plan';
import type { DayLog } from '../types';
import { HOUR, lock, london, MIN, rules, T } from './helpers';

const NOON = T(london, '2026-11-18 12:00');
const day = (over: Partial<DayLog> = {}): DayLog => ({ ...freshDay(london, NOON), ...over });
const report = (over: Partial<NativeReport> = {}): NativeReport => ({
  day: '2026-11-18',
  usedMin: 0,
  limitReached: false,
  earnedSpentMin: 0,
  unlocks: [],
  openEarn: false,
  ...over,
});

describe('the plan sent to the phone', () => {
  it('carries the lock times as minutes of the day, with their own app lists', () => {
    const own = { apps: ['yt'], categories: [], domains: [] };
    const r = rules({
      lockTimes: [lock({ id: 'sleep', days: [6, 0, 1], start: '22:30', end: '06:45' }), lock({ id: 'study', start: '16:00', end: '18:00', apps: own, earnable: true })],
      allowed: { apps: ['maps'], categories: [], domains: [] },
    });
    const p = toNativePlan(london, r, day(), NOON);
    expect(p.locks[0]).toMatchObject({ id: 'sleep', days: [0, 1, 6], startMin: 22 * 60 + 30, endMin: 6 * 60 + 45, ownApps: false, apps: null });
    expect(p.locks[1]).toMatchObject({ id: 'study', ownApps: true, apps: own, earnable: true });
    expect(p.blocked).toEqual(r.blocked);
    expect(p.allowed).toEqual(r.allowed);
  });

  it("says when today's limit is used up, and how much earned time is left", () => {
    const r = rules({ dailyLimitMin: 60 });
    expect(toNativePlan(london, r, day({ usedMin: 59 }), NOON).limitReached).toBe(false);
    const p = toNativePlan(london, r, day({ usedMin: 60, earnedMin: 30, earnedUsedMin: 12 }), NOON);
    expect(p).toMatchObject({ limitReached: true, earnedLeftMin: 18, earnCapLeftMin: 90, dailyLimitMin: 60 });
  });

  it('no daily limit is never "reached"', () => {
    expect(toNativePlan(london, rules({ dailyLimitMin: null }), day({ usedMin: 900 }), NOON)).toMatchObject({ limitReached: false, dailyLimitMin: null });
  });

  it('earned time switched off sends nothing to spend', () => {
    const r = rules({ earning: { ...rules().earning, enabled: false } });
    expect(toNativePlan(london, r, day({ earnedMin: 30 }), NOON)).toMatchObject({ earningEnabled: false, earnedLeftMin: 0 });
  });

  it('sends the strictness in force: Strict after its period is Standard', () => {
    expect(toNativePlan(london, rules({ strictness: 'strict', strictUntil: NOON + HOUR }), day(), NOON).mode).toBe('strict');
    expect(toNativePlan(london, rules({ strictness: 'strict', strictUntil: NOON - 1 }), day(), NOON).mode).toBe('standard');
    expect(toNativePlan(london, rules({ strictness: 'nudge' }), day(), NOON).mode).toBe('nudge');
  });

  it('counts down the unlocks left today', () => {
    const used = day({
      unlocks: [
        { kind: 'emergency', from: NOON - 2 * HOUR, until: NOON - 2 * HOUR + 10 * MIN },
        { kind: 'one-more', from: NOON - HOUR, until: NOON - HOUR + MIN },
      ],
    });
    expect(toNativePlan(london, rules(), used, NOON)).toMatchObject({ emergenciesLeft: 0, oneMoresLeft: 2, emergencyMin: 10, oneMoreMin: 1 });
  });

  it('passes on an unlock that is running', () => {
    const until = NOON + 5 * MIN;
    expect(toNativePlan(london, rules(), day({ unlocks: [{ kind: 'emergency', from: NOON - MIN, until }] }), NOON).unlockUntil).toBe(until);
    expect(toNativePlan(london, rules(), day(), NOON).unlockUntil).toBeNull();
  });

  it("a log from yesterday is sent as a fresh day (yesterday's earned time doesn't carry over)", () => {
    const yesterday = { ...freshDay(london, NOON - 24 * HOUR), usedMin: 200, earnedMin: 40 };
    expect(toNativePlan(london, rules(), yesterday, NOON)).toMatchObject({ day: '2026-11-18', limitReached: false, earnedLeftMin: 0 });
  });
});

describe('reading what the phone reports', () => {
  it('rejects anything that is not a report', () => {
    expect(parseReport('not json')).toBeNull();
    expect(parseReport('{}')).toBeNull();
    expect(parseReport('null')).toBeNull();
  });

  it('cleans up bad values instead of trusting them', () => {
    const r = parseReport(
      JSON.stringify({
        day: '2026-11-18',
        usedMin: -5,
        earnedSpentMin: 'lots',
        limitReached: 'yes',
        unlocks: [
          { kind: 'emergency', from: 1, until: 2 },
          { kind: 'forever', from: 1, until: 9e15 },
          { kind: 'one-more', from: 5, until: 3 },
          null,
        ],
        openEarn: true,
      }),
    );
    expect(r).toEqual({ day: '2026-11-18', usedMin: 0, earnedSpentMin: 0, limitReached: false, unlocks: [{ kind: 'emergency', from: 1, until: 2 }], openEarn: true });
  });

  it('keeps extra fields out (the iPhone also reports its own bookkeeping)', () => {
    const r = parseReport(JSON.stringify({ day: '2026-11-18', usedMin: 30, earnedArmed: true, earnedBase: 5, unlocks: [] }));
    expect(r).not.toHaveProperty('earnedArmed');
    expect(r?.usedMin).toBe(30);
  });
});

describe('folding a report into today', () => {
  const r = rules({ dailyLimitMin: 60 });

  it('usage only ever goes up', () => {
    expect(mergeReport(london, r, day({ usedMin: 40 }), report({ usedMin: 30 }), NOON).usedMin).toBe(40);
    expect(mergeReport(london, r, day({ usedMin: 40 }), report({ usedMin: 45 }), NOON).usedMin).toBe(45);
  });

  it('the exact "limit reached" event counts as the whole limit used, even between 15-minute steps', () => {
    const merged = mergeReport(london, r, day({ usedMin: 45 }), report({ usedMin: 45, limitReached: true }), NOON);
    expect(merged.usedMin).toBe(60);
    expect(decide(london, r, merged, NOON)).toMatchObject({ blocked: true, reason: 'limit' });
  });

  it('earned time spent adds up, but never beyond what was earned', () => {
    let log = day({ earnedMin: 20, earnedUsedMin: 5 });
    log = mergeReport(london, r, log, report({ earnedSpentMin: 10 }), NOON);
    expect(log.earnedUsedMin).toBe(15);
    log = mergeReport(london, r, log, report({ earnedSpentMin: 30 }), NOON);
    expect(log.earnedUsedMin).toBe(20);
  });

  it('an unlock taken on the blocked screen is recorded once, however often it is reported', () => {
    const u = { kind: 'emergency' as const, from: NOON - MIN, until: NOON + 9 * MIN };
    let log = mergeReport(london, r, day(), report({ unlocks: [u] }), NOON);
    log = mergeReport(london, r, log, report({ unlocks: [u] }), NOON);
    expect(log.unlocks).toEqual([u]);
    // …and it uses up the day's emergency unlock.
    expect(toNativePlan(london, r, log, NOON).emergenciesLeft).toBe(0);
  });

  it("yesterday's report doesn't touch today's counts, but an unlock still running is kept", () => {
    const running = { kind: 'emergency' as const, from: NOON - 5 * MIN, until: NOON + 5 * MIN };
    const over = { kind: 'one-more' as const, from: NOON - 30 * HOUR, until: NOON - 30 * HOUR + MIN };
    const log = mergeReport(london, r, day({ usedMin: 10 }), report({ day: '2026-11-17', usedMin: 300, limitReached: true, earnedSpentMin: 50, unlocks: [running, over] }), NOON);
    expect(log).toMatchObject({ usedMin: 10, earnedUsedMin: 0 });
    expect(log.unlocks).toEqual([running]);
  });

  it('a report on a new day rolls the log over first', () => {
    const yesterday = { ...freshDay(london, NOON - 24 * HOUR), usedMin: 200, earnedMin: 40, earnedUsedMin: 10 };
    const log = mergeReport(london, r, yesterday, report({ usedMin: 15 }), NOON);
    expect(log).toMatchObject({ day: '2026-11-18', usedMin: 15, earnedMin: 0, earnedUsedMin: 0 });
  });

  it('no report (the phone had nothing to say) leaves the log as it was', () => {
    const log = day({ usedMin: 12 });
    expect(mergeReport(london, r, log, null, NOON)).toEqual(log);
  });
});
