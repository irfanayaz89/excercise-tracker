/// <reference types="jest" />
/**
 * Screen-time holes found in the audit: each test is a way round a rule that
 * used to work.
 */
import { decide, freshDay } from '../decide';
import { endFocus } from '../focus';
import { applyPending, coreOf, endStrictEarly, requestChange, skipNext } from '../rules';
import { toNativePlan } from '../plan';
import type { Focus } from '../types';
import { HOUR, MIN, T, london, rules } from './helpers';

const NOW = T(london, '2026-11-18 12:00');
const keyLock = (over: Partial<Focus> = {}): Focus => ({ kind: 'key', startedAt: NOW - MIN, until: NOW + 8 * HOUR, strict: false, ...over });
const blocked = { apps: ['a'], categories: [], domains: [] };

describe('a key lock can only be lifted with the key', () => {
  test('in Nudge mode, emptying the blocked list is refused while the lock runs', () => {
    const r = rules({ strictness: 'nudge', blocked });
    const res = requestChange(london, r, { ...coreOf(r), blocked: { apps: [], categories: [], domains: [] } }, NOW, keyLock());
    expect(res).toMatchObject({ result: 'refused', reason: 'focus-locked' });
    // Without the lock it applies at once, as Nudge always has.
    expect(requestChange(london, r, { ...coreOf(r), blocked: { apps: [], categories: [], domains: [] } }, NOW, null).result).toBe('applied');
  });

  test('tightening still works during the lock', () => {
    const r = rules({ strictness: 'nudge', blocked });
    const res = requestChange(london, r, { ...coreOf(r), blocked: { apps: ['a', 'b'], categories: [], domains: [] } }, NOW, keyLock());
    expect(res.result).toBe('applied');
  });

  test('no unlock opens it, and none is offered', () => {
    const r = rules({ strictness: 'standard', blocked });
    const log = { ...freshDay(london, NOW), unlocks: [{ kind: 'emergency' as const, from: NOW - MIN, until: NOW + 9 * MIN }] };
    const d = decide(london, r, log, NOW, keyLock());
    expect(d.blocked).toBe(true);
    expect(d.reason).toBe('focus');
    expect(d.emergency.available).toBe(false);
    expect(d.oneMore.available).toBe(false);
  });
});

describe('focus', () => {
  test('backing out of a set ends only a "for this set" focus', () => {
    const timed: Focus = { kind: 'timed', startedAt: NOW - MIN, until: NOW + 30 * MIN, strict: false };
    expect(endFocus(timed, 'abandoned', NOW)).toMatchObject({ ended: false, focus: timed });
    expect(endFocus({ ...timed, kind: 'set' }, 'abandoned', NOW).ended).toBe(true);
  });
});

describe('unlocks around midnight', () => {
  test("an unlock taken at 23:55 that runs past midnight doesn't use up the next day's", () => {
    const r = rules({ strictness: 'standard', dailyLimitMin: 0, blocked });
    const after = T(london, '2026-11-19 00:02');
    const log = { ...freshDay(london, after), unlocks: [{ kind: 'emergency' as const, from: T(london, '2026-11-18 23:55'), until: T(london, '2026-11-19 00:05') }] };
    const d = decide(london, r, log, T(london, '2026-11-19 00:06'));
    expect(d.emergency.available).toBe(true);
  });
});

describe('editing while an easier change waits', () => {
  test('a tightening still applies at once in Strict while "end Strict" waits', () => {
    const r0 = rules({ strictness: 'strict', strictUntil: NOW + 5 * 24 * HOUR, blocked });
    const ended = endStrictEarly(r0, NOW, 0);
    expect(ended.result).toBe('scheduled');
    const r = ended.rules;
    const res = requestChange(london, r, { ...coreOf(r), blocked: { apps: ['a', 'b'], categories: [], domains: [] } }, NOW + MIN);
    expect(res.result).toBe('applied');
  });

  test('a second easier change says it replaces the first', () => {
    const r0 = rules({ strictness: 'standard', dailyLimitMin: 60, blocked });
    const first = requestChange(london, r0, { ...coreOf(r0), dailyLimitMin: 90 }, NOW);
    expect(first).toMatchObject({ result: 'scheduled', replacedPending: false });
    const second = requestChange(london, first.rules, { ...coreOf(first.rules), dailyLimitMin: 120 }, NOW + MIN);
    expect(second).toMatchObject({ result: 'scheduled', replacedPending: true });
  });
});

describe('a key lock holds back easier changes', () => {
  test('a waiting easier change waits until the lock ends', () => {
    const r0 = rules({ strictness: 'standard', dailyLimitMin: 60, blocked });
    const res = requestChange(london, r0, { ...coreOf(r0), dailyLimitMin: 90 }, NOW - 2 * HOUR);
    const r = res.rules;
    const due = r.pending!.effectiveAt;
    const lock = keyLock({ startedAt: due - MIN, until: due + HOUR });
    expect(applyPending(r, due + MIN, lock).dailyLimitMin).toBe(60);
    expect(applyPending(r, due + 2 * HOUR, lock).dailyLimitMin).toBe(90);
  });

  test('skipping a lock time is refused during the lock', () => {
    const r = rules({
      strictness: 'nudge',
      blocked,
      lockTimes: [{ id: 'l', name: 'Evening', days: [0, 1, 2, 3, 4, 5, 6], start: '18:00', end: '22:00', apps: 'main', earnable: false, enabled: true, skipDate: null }],
    });
    expect(skipNext(london, r, 'l', NOW, keyLock())).toMatchObject({ result: 'refused', reason: 'focus-locked' });
  });

  test('the phone is told the focus is locked, so its own unlocks do not open it', () => {
    const r = rules({ strictness: 'standard', blocked });
    expect(toNativePlan(london, r, freshDay(london, NOW), NOW, keyLock()).focusLocked).toBe(true);
    expect(toNativePlan(london, r, freshDay(london, NOW), NOW, keyLock({ kind: 'timed' })).focusLocked).toBe(false);
  });

  test("an unlock carried over from last night doesn't use up today's on the phone", () => {
    const r = rules({ strictness: 'standard', dailyLimitMin: 0, blocked });
    const at = T(london, '2026-11-19 00:06');
    const log = { ...freshDay(london, at), unlocks: [{ kind: 'emergency' as const, from: T(london, '2026-11-18 23:55'), until: T(london, '2026-11-19 00:05') }] };
    expect(toNativePlan(london, r, log, at).emergenciesLeft).toBe(1);
  });
});
