/// <reference types="jest" />
/**
 * Screen-time holes found in the audit: each test is a way round a rule that
 * used to work.
 */
import { decide, freshDay } from '../decide';
import { endFocus } from '../focus';
import { coreOf, requestChange } from '../rules';
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
