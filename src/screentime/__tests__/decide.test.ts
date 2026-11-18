/// <reference types="jest" />
/**
 * What's blocked right now (plan §5): lock times, the daily limit, earned
 * time, temporary unlocks and the day rolling over, in every combination.
 */
import { addUsage, decide, EMERGENCY_MIN, freshDay, rollDay, takeUnlock } from '../decide';
import { startStrict } from '../rules';
import type { DayLog } from '../types';
import { HOUR, lock, london, MIN, newYork, rules, show, T } from './helpers';

const at = (s: string) => T(london, s);
const day = (s: string, over: Partial<DayLog> = {}): DayLog => ({ ...freshDay(london, at(s)), ...over });
const sleep = lock({ id: 'sleep', name: 'Sleep', start: '22:00', end: '07:00' });
const work = lock({ id: 'work', name: 'Work', days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' });

describe('daily limit', () => {
  const r = rules({ dailyLimitMin: 60 });

  it('open while under the limit, blocked once used up', () => {
    expect(decide(london, r, day('2026-11-18 12:00', { usedMin: 59 }), at('2026-11-18 12:00'))).toMatchObject({
      blocked: false,
      limitLeftMin: 1,
    });
    expect(decide(london, r, day('2026-11-18 12:00', { usedMin: 60 }), at('2026-11-18 12:00'))).toMatchObject({
      blocked: true,
      reason: 'limit',
      limitLeftMin: 0,
      canEarn: true,
    });
  });

  it('no daily limit: only lock times block', () => {
    const d = decide(london, rules({ dailyLimitMin: null }), day('2026-11-18 12:00', { usedMin: 600 }), at('2026-11-18 12:00'));
    expect(d.blocked).toBe(false);
    expect(d.limitLeftMin).toBeNull();
  });

  it('the limit resets at midnight', () => {
    const log = day('2026-11-18 23:00', { usedMin: 60 });
    expect(decide(london, r, log, at('2026-11-18 23:59')).blocked).toBe(true);
    expect(decide(london, r, log, at('2026-11-19 00:00')).blocked).toBe(false);
  });

  it('usage reports add up; earned-time usage never exceeds what was earned', () => {
    let log = day('2026-11-18 12:00', { earnedMin: 10 });
    log = addUsage(log, 25, false);
    log = addUsage(log, 30, false);
    log = addUsage(log, 15, true);
    expect(log.usedMin).toBe(55);
    expect(log.earnedUsedMin).toBe(10);
    expect(addUsage(log, -5, false).usedMin).toBe(55);
  });
});

describe('earned time', () => {
  const r = rules({ dailyLimitMin: 60 });

  it('opens the apps after the limit, and blocks again once spent', () => {
    const log = day('2026-11-18 12:00', { usedMin: 60, earnedMin: 20, earnedUsedMin: 5 });
    expect(decide(london, r, log, at('2026-11-18 12:00'))).toMatchObject({ blocked: false, usingEarned: true, earnedLeftMin: 15 });
    expect(decide(london, r, { ...log, earnedUsedMin: 20 }, at('2026-11-18 12:00'))).toMatchObject({ blocked: true, reason: 'limit' });
  });

  it('is not spent while the daily limit still has time', () => {
    expect(decide(london, r, day('2026-11-18 12:00', { usedMin: 10, earnedMin: 20 }), at('2026-11-18 12:00')).usingEarned).toBe(false);
  });

  it('expires at midnight', () => {
    const log = day('2026-11-18 23:00', { usedMin: 60, earnedMin: 20 });
    expect(decide(london, r, log, at('2026-11-18 23:30')).earnedLeftMin).toBe(20);
    expect(decide(london, r, log, at('2026-11-19 00:01')).earnedLeftMin).toBe(0);
  });

  it('earning switched off: earned minutes do nothing and the blocked screen offers no exercise', () => {
    const off = rules({ dailyLimitMin: 60, earning: { ...rules().earning, enabled: false } });
    expect(decide(london, off, day('2026-11-18 12:00', { usedMin: 60, earnedMin: 20 }), at('2026-11-18 12:00'))).toMatchObject({
      blocked: true,
      canEarn: false,
      earnedLeftMin: 0,
    });
  });

  it('the cap reached: the blocked screen offers no more exercise', () => {
    const d = decide(london, r, day('2026-11-18 12:00', { usedMin: 60, earnedMin: 120, earnedUsedMin: 120 }), at('2026-11-18 12:00'));
    expect(d).toMatchObject({ blocked: true, canEarn: false });
  });
});

describe('lock times', () => {
  const r = rules({ dailyLimitMin: 60, lockTimes: [sleep, work] });

  it('blocks for the whole window, whatever is left of the limit', () => {
    const log = day('2026-11-18 12:00');
    expect(decide(london, r, log, at('2026-11-18 21:59')).blocked).toBe(false);
    expect(decide(london, r, log, at('2026-11-18 22:00'))).toMatchObject({
      blocked: true,
      reason: 'lock',
      lock: { id: 'sleep', name: 'Sleep' },
    });
    expect(show(london, decide(london, r, log, at('2026-11-18 22:00')).lock!.until)).toBe('2026-11-19 07:00');
    expect(decide(london, r, day('2026-11-19 06:00'), at('2026-11-19 06:59')).blocked).toBe(true);
    expect(decide(london, r, day('2026-11-19 07:00'), at('2026-11-19 07:00')).blocked).toBe(false);
  });

  it('weekday lock times only on their days', () => {
    expect(decide(london, r, day('2026-11-18 10:00'), at('2026-11-18 10:00')).lock?.id).toBe('work'); // Wednesday
    expect(decide(london, r, day('2026-11-21 10:00'), at('2026-11-21 10:00')).blocked).toBe(false); // Saturday
  });

  it('a truly locked window ignores earned time (and keeps it for later today)', () => {
    const log = day('2026-11-18 10:00', { earnedMin: 30 });
    const d = decide(london, r, log, at('2026-11-18 10:00'));
    expect(d).toMatchObject({ blocked: true, reason: 'lock', usingEarned: false, canEarn: false, earnedLeftMin: 30 });
    expect(decide(london, r, log, at('2026-11-18 17:00'))).toMatchObject({ blocked: false, earnedLeftMin: 30 });
  });

  it('an earnable window opens with earned time, and offers exercise when there is none', () => {
    const study = lock({ id: 'study', name: 'Study', start: '18:00', end: '20:00', earnable: true });
    const rs = rules({ lockTimes: [study] });
    expect(decide(london, rs, day('2026-11-18 18:30'), at('2026-11-18 18:30'))).toMatchObject({
      blocked: true,
      reason: 'lock',
      canEarn: true,
    });
    expect(decide(london, rs, day('2026-11-18 18:30', { earnedMin: 15 }), at('2026-11-18 18:30'))).toMatchObject({
      blocked: false,
      usingEarned: true,
    });
  });

  it('overlapping windows: blocked until the last one ends; a truly locked one wins over an earnable one', () => {
    const late = lock({ id: 'late', name: 'Late', start: '21:00', end: '23:30', earnable: true });
    const rs = rules({ lockTimes: [sleep, late] });
    const d = decide(london, rs, day('2026-11-18 22:30', { earnedMin: 30 }), at('2026-11-18 22:30'));
    expect(d).toMatchObject({ blocked: true, reason: 'lock', canEarn: false, lock: { id: 'sleep' } });
    expect(decide(london, rs, day('2026-11-18 21:30', { earnedMin: 30 }), at('2026-11-18 21:30'))).toMatchObject({
      blocked: false,
      usingEarned: true,
    });
  });

  it('back-to-back windows: no gap, and the next change is the hand-over', () => {
    const a = lock({ id: 'a', start: '09:00', end: '12:00' });
    const b = lock({ id: 'b', start: '12:00', end: '14:00' });
    const rs = rules({ lockTimes: [a, b] });
    expect(decide(london, rs, day('2026-11-18 11:59'), at('2026-11-18 11:59')).lock?.id).toBe('a');
    expect(decide(london, rs, day('2026-11-18 12:00'), at('2026-11-18 12:00')).lock?.id).toBe('b');
    expect(show(london, decide(london, rs, day('2026-11-18 11:00'), at('2026-11-18 11:00')).nextChange)).toBe('2026-11-18 12:00');
  });

  it('the daily limit running out during a lock time: still a lock (it ends later)', () => {
    expect(decide(london, r, day('2026-11-18 23:00', { usedMin: 90 }), at('2026-11-18 23:00')).reason).toBe('lock');
    expect(decide(london, r, day('2026-11-19 07:30', { usedMin: 0 }), at('2026-11-19 07:30')).reason).toBeNull();
  });

  it('skipped and switched-off lock times do not block', () => {
    expect(
      decide(london, rules({ lockTimes: [{ ...sleep, skipDate: '2026-11-18' }] }), day('2026-11-18 23:00'), at('2026-11-18 23:00')).blocked,
    ).toBe(false);
    expect(
      decide(london, rules({ lockTimes: [{ ...sleep, enabled: false }] }), day('2026-11-18 23:00'), at('2026-11-18 23:00')).blocked,
    ).toBe(false);
  });

  it('a lock time with its own apps blocks those, not the main list', () => {
    const yt = lock({
      id: 'yt',
      name: 'No YouTube',
      start: '20:00',
      end: '22:00',
      apps: { apps: ['youtube'], categories: [], domains: [] },
    });
    const d = decide(london, rules({ lockTimes: [yt] }), day('2026-11-18 21:00'), at('2026-11-18 21:00'));
    expect(d.blocked).toBe(false);
    expect(d.ownLocks).toEqual([
      { id: 'yt', name: 'No YouTube', until: at('2026-11-18 22:00'), apps: { apps: ['youtube'], categories: [], domains: [] } },
    ]);
  });

  it('follows local time after travelling: the same rules in New York', () => {
    const t = Date.UTC(2026, 10, 19, 3, 0); // 03:00 London, 22:00 New York
    expect(decide(london, r, freshDay(london, t), t).reason).toBe('lock');
    expect(decide(newYork, r, freshDay(newYork, t), t).reason).toBe('lock');
    const t2 = Date.UTC(2026, 10, 18, 23, 0); // 23:00 London, 18:00 New York
    expect(decide(newYork, r, freshDay(newYork, t2), t2).blocked).toBe(false);
  });

  it('a lock time across a daylight-saving change ends at the local time set', () => {
    const t = T(london, '2026-03-29 03:00');
    const d = decide(london, rules({ lockTimes: [sleep] }), freshDay(london, t), t);
    expect(show(london, d.lock!.until)).toBe('2026-03-29 07:00');
  });
});

describe('the next change', () => {
  it('is the earliest of lock start/end, unlock end, Strict end, a waiting change, and midnight', () => {
    const r = rules({ lockTimes: [sleep] });
    expect(show(london, decide(london, r, day('2026-11-18 12:00'), at('2026-11-18 12:00')).nextChange)).toBe('2026-11-18 22:00');
    expect(show(london, decide(london, rules(), day('2026-11-18 12:00'), at('2026-11-18 12:00')).nextChange)).toBe('2026-11-19 00:00');
    const strict = startStrict(rules(), at('2026-11-18 12:00') - 7 * 24 * HOUR + HOUR, 7);
    expect(show(london, decide(london, strict, day('2026-11-18 12:00'), at('2026-11-18 12:00')).nextChange)).toBe('2026-11-18 13:00');
  });
});

describe('ways out by strictness', () => {
  const limitHit = (s: string) => day(s, { usedMin: 60 });

  it('Standard: one 10-minute emergency unlock a day, then none until tomorrow', () => {
    const r = rules({ strictness: 'standard', lockTimes: [sleep] });
    const t = at('2026-11-18 23:00');
    const first = takeUnlock(london, r, day('2026-11-18 23:00'), 'emergency', t);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.until - t).toBe(EMERGENCY_MIN * MIN);
    expect(decide(london, r, first.log, t + 5 * MIN)).toMatchObject({ blocked: false, unlockedUntil: first.until });
    expect(decide(london, r, first.log, first.until).blocked).toBe(true);
    expect(takeUnlock(london, r, first.log, 'emergency', t + 20 * MIN)).toMatchObject({ ok: false, reason: 'used-up' });
    // Next day: available again.
    expect(takeUnlock(london, r, first.log, 'emergency', at('2026-11-19 23:00')).ok).toBe(true);
  });

  it('Standard has no "1 more minute"; Nudge has three a day and no emergency', () => {
    const std = rules({ strictness: 'standard', dailyLimitMin: 60 });
    expect(takeUnlock(london, std, limitHit('2026-11-18 12:00'), 'one-more', at('2026-11-18 12:00'))).toMatchObject({
      ok: false,
      reason: 'not-allowed',
    });
    const nudge = rules({ strictness: 'nudge', dailyLimitMin: 60 });
    let log = limitHit('2026-11-18 12:00');
    for (let i = 0; i < 3; i++) {
      const res = takeUnlock(london, nudge, log, 'one-more', at('2026-11-18 12:00') + i * 2 * MIN);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.until - (at('2026-11-18 12:00') + i * 2 * MIN)).toBe(MIN);
        log = res.log;
      }
    }
    expect(takeUnlock(london, nudge, log, 'one-more', at('2026-11-18 12:10'))).toMatchObject({ ok: false, reason: 'used-up' });
    expect(takeUnlock(london, nudge, log, 'emergency', at('2026-11-18 12:10'))).toMatchObject({ ok: false, reason: 'not-allowed' });
  });

  it('Strict: no way out; after the Strict period ends it behaves as Standard', () => {
    const t = at('2026-11-18 23:00');
    const strict = startStrict(rules({ lockTimes: [sleep] }), t - HOUR, 1);
    expect(decide(london, strict, day('2026-11-18 23:00'), t)).toMatchObject({
      emergency: { available: false },
      oneMore: { available: false },
    });
    expect(takeUnlock(london, strict, day('2026-11-18 23:00'), 'emergency', t)).toMatchObject({ ok: false, reason: 'not-allowed' });
    const after = strict.strictUntil! + MIN;
    expect(takeUnlock(london, strict, day('2026-11-19 22:00'), 'emergency', after).ok).toBe(true);
  });

  it('nothing to unlock when nothing is blocked', () => {
    expect(takeUnlock(london, rules(), day('2026-11-18 12:00'), 'emergency', at('2026-11-18 12:00'))).toMatchObject({
      ok: false,
      reason: 'not-blocked',
    });
  });

  it('an unlock also opens own-app lock times', () => {
    const yt = lock({ id: 'yt', start: '20:00', end: '22:00', apps: { apps: ['youtube'], categories: [], domains: [] } });
    const r = rules({ lockTimes: [yt] });
    const res = takeUnlock(london, r, day('2026-11-18 21:00'), 'emergency', at('2026-11-18 21:00'));
    expect(res.ok).toBe(true);
    if (res.ok) expect(decide(london, r, res.log, at('2026-11-18 21:05')).ownLocks).toEqual([]);
  });
});

describe('the day rolling over and the clock', () => {
  it('a new day starts fresh', () => {
    const log = day('2026-11-18 23:00', { usedMin: 50, earnedMin: 20, unlocks: [{ kind: 'emergency', from: 1, until: 2 }] });
    expect(rollDay(london, log, at('2026-11-19 00:00'))).toEqual(freshDay(london, at('2026-11-19 00:00')));
    expect(rollDay(london, log, at('2026-11-18 23:59'))).toBe(log);
  });

  it("moving the clock back a day keeps today's usage (no fresh allowance)", () => {
    const log = day('2026-11-18 12:00', { usedMin: 60 });
    expect(rollDay(london, log, at('2026-11-17 12:00'))).toBe(log);
    expect(decide(london, rules({ dailyLimitMin: 60 }), log, at('2026-11-17 12:00')).blocked).toBe(true);
  });

  it('no log yet: a fresh one', () => {
    expect(rollDay(london, null, at('2026-11-18 12:00')).day).toBe('2026-11-18');
  });
});
