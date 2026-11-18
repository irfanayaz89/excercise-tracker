/// <reference types="jest" />
/**
 * Rules: loading safely, validating lock times, telling tightening from
 * loosening, and how each strictness level treats a change (plan §2, §3).
 */
import {
  applyPending,
  cancelPending,
  clearOldSkips,
  coreOf,
  DEFAULT_RULES,
  describeLock,
  endStrictEarly,
  effectiveStrictness,
  lockProblem,
  loosens,
  MAX_APPS,
  MAX_LOCK_TIMES,
  normalizeRules,
  requestChange,
  skipNext,
  startStrict,
  STRICT_OFF_PUSHUPS,
  strictActive,
} from '../rules';
import type { RulesCore, ScreenTimeRules } from '../types';
import { HOUR, lock, london, MIN, rules, show, T } from './helpers';

const NOW = T(london, '2026-11-18 12:00'); // a Wednesday
const DAY = 24 * HOUR;
const change = (r: ScreenTimeRules, f: (c: RulesCore) => RulesCore) => f(coreOf(r));

describe('loading rules', () => {
  it('nothing saved, garbage or a different type: safe defaults (Standard, never off)', () => {
    for (const raw of [undefined, null, 'x', 42, [], { strictness: 'chaos' }]) {
      const r = normalizeRules(raw);
      expect(r.strictness).toBe('standard');
      expect(r.version).toBe(1);
      expect(r.pending).toBeNull();
    }
    expect(normalizeRules(undefined)).toEqual(DEFAULT_RULES);
  });

  it('keeps valid parts and drops broken ones', () => {
    const r = normalizeRules({
      blocked: { apps: ['a', 'a', '', 7, 'b'], categories: 'social', domains: ['x.com'] },
      dailyLimitMin: -5,
      lockTimes: [
        lock({ id: 'ok' }),
        { id: 'bad-time', days: [1], start: '25:00', end: '07:00' },
        { id: 'no-days', days: [], start: '22:00', end: '07:00' },
        { id: 'short', days: [1], start: '10:00', end: '10:10' },
        { days: [1], start: '10:00', end: '12:00' },
        { id: 'weird-days', days: [1, 1, 9, -1, 3], start: '10:00', end: '12:00', name: '  ' },
      ],
      earning: { dailyCapMin: 9999, rates: { pushup: { perCleanRep: -1 } } },
      strictness: 'strict',
      strictUntil: 'soon',
    });
    expect(r.blocked).toEqual({ apps: ['a', 'b'], categories: [], domains: ['x.com'] });
    expect(r.dailyLimitMin).toBe(DEFAULT_RULES.dailyLimitMin);
    expect(r.lockTimes.map((l) => l.id)).toEqual(['ok', 'weird-days']);
    expect(r.lockTimes[1].days).toEqual([1, 3]);
    expect(r.lockTimes[1].name).toBe('Lock time');
    expect(r.earning.dailyCapMin).toBe(DEFAULT_RULES.earning.dailyCapMin);
    expect(r.earning.rates.pushup.perCleanRep).toBe(1);
    expect(r.strictUntil).toBeNull();
  });

  it('caps lock times and apps at the platform limits', () => {
    const r = normalizeRules({
      blocked: { apps: Array.from({ length: 80 }, (_, i) => `app${i}`) },
      lockTimes: Array.from({ length: 12 }, (_, i) => lock({ id: `l${i}` })),
    });
    expect(r.blocked.apps).toHaveLength(MAX_APPS);
    expect(r.lockTimes).toHaveLength(MAX_LOCK_TIMES);
  });

  it('"no daily limit" survives a save and load; a missing one gets the default', () => {
    expect(normalizeRules({ dailyLimitMin: null }).dailyLimitMin).toBeNull();
    expect(normalizeRules({}).dailyLimitMin).toBe(60);
  });

  it('a waiting change survives a save and load', () => {
    const r = normalizeRules({ pending: { effectiveAt: NOW + HOUR, next: { dailyLimitMin: 90 } } });
    expect(r.pending?.effectiveAt).toBe(NOW + HOUR);
    expect(r.pending?.next.dailyLimitMin).toBe(90);
  });
});

describe('lock-time validation and wording', () => {
  it('needs days, valid times and at least 15 minutes', () => {
    expect(lockProblem(lock())).toBeNull();
    expect(lockProblem(lock({ days: [] }))).toBe('no-days');
    expect(lockProblem(lock({ start: '9am' }))).toBe('bad-time');
    expect(lockProblem(lock({ start: '09:00', end: '09:00' }))).toBe('bad-time');
    expect(lockProblem(lock({ start: '09:00', end: '09:14' }))).toBe('too-short');
    expect(lockProblem(lock({ start: '23:50', end: '00:05' }))).toBeNull();
  });

  it('describes lock times plainly', () => {
    expect(describeLock(lock())).toBe('Every night 22:00–07:00');
    expect(describeLock(lock({ start: '06:00', end: '09:00' }))).toBe('Every day 06:00–09:00');
    expect(describeLock(lock({ days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' }))).toBe('Mon–Fri 09:00–17:00');
    expect(describeLock(lock({ days: [6, 0], start: '10:00', end: '12:00' }))).toBe('Weekends 10:00–12:00');
    expect(describeLock(lock({ days: [1, 3], start: '18:00', end: '20:00' }))).toBe('Mon, Wed 18:00–20:00');
  });
});

describe('tightening or loosening?', () => {
  const base = coreOf(rules({ lockTimes: [lock({ id: 's', start: '22:00', end: '07:00' })] }));
  const withLock = (f: (l: RulesCore['lockTimes'][number]) => RulesCore['lockTimes'][number]) => ({
    ...base,
    lockTimes: base.lockTimes.map(f),
  });

  it.each([
    ['adding a blocked app', { ...base, blocked: { ...base.blocked, apps: [...base.blocked.apps, 'x'] } }],
    ['a lower daily limit', { ...base, dailyLimitMin: 30 }],
    ['a longer lock time', withLock((l) => ({ ...l, start: '21:00' }))],
    ['a new lock time', { ...base, lockTimes: [...base.lockTimes, lock({ id: 'w', start: '09:00', end: '17:00', days: [1] })] }],
    ['turning earning off during a lock (earnable → not)', withLock((l) => ({ ...l, earnable: false }))],
    ['a stricter level', { ...base, strictness: 'strict' as const }],
    ['a lower earning cap', { ...base, earning: { ...base.earning, dailyCapMin: 60 } }],
    ['no change at all', base],
  ])('%s tightens', (_n, next) => expect(loosens(base, next as RulesCore)).toBe(false));

  it.each([
    ['removing a blocked app', { ...base, blocked: { ...base.blocked, apps: ['insta'] } }],
    ['allowing an app', { ...base, allowed: { apps: ['insta'], categories: [], domains: [] } }],
    ['a higher daily limit', { ...base, dailyLimitMin: 90 }],
    ['no daily limit', { ...base, dailyLimitMin: null }],
    ['a shorter lock time', withLock((l) => ({ ...l, end: '06:00' }))],
    ['moving a lock time', withLock((l) => ({ ...l, start: '23:00', end: '08:00' }))],
    ['fewer days', withLock((l) => ({ ...l, days: [1, 2, 3, 4, 5] }))],
    ['switching a lock off', withLock((l) => ({ ...l, enabled: false }))],
    ['deleting a lock time', { ...base, lockTimes: [] }],
    ['allowing earning during a lock', withLock((l) => ({ ...l, earnable: true }))],
    ['a weaker level', { ...base, strictness: 'nudge' as const }],
    [
      'a higher earning rate',
      { ...base, earning: { ...base.earning, rates: { ...base.earning.rates, pushup: { perCleanRep: 2, perFlaggedRep: 1 } } } },
    ],
    ['a higher earning cap', { ...base, earning: { ...base.earning, dailyCapMin: 180 } }],
    ['a mixed change (lower limit but shorter lock)', { ...withLock((l) => ({ ...l, end: '06:00' })), dailyLimitMin: 30 }],
  ])('%s loosens', (_n, next) => expect(loosens(base, next as RulesCore)).toBe(true));

  it('own-app lock times: removing one of its apps loosens, adding one tightens', () => {
    const own = coreOf(rules({ lockTimes: [lock({ id: 'o', apps: { apps: ['yt'], categories: [], domains: [] } })] }));
    const add = { ...own, lockTimes: own.lockTimes.map((l) => ({ ...l, apps: { apps: ['yt', 'netflix'], categories: [], domains: [] } })) };
    const drop = { ...own, lockTimes: own.lockTimes.map((l) => ({ ...l, apps: { apps: [], categories: [], domains: [] } })) };
    expect(loosens(own, add)).toBe(false);
    expect(loosens(own, drop)).toBe(true);
  });
});

describe('changes by strictness', () => {
  it('Nudge: everything applies at once', () => {
    const r = rules({ strictness: 'nudge' });
    const res = requestChange(
      london,
      r,
      change(r, (c) => ({ ...c, dailyLimitMin: 180 })),
      NOW,
    );
    expect(res.result).toBe('applied');
    expect(res.rules.dailyLimitMin).toBe(180);
  });

  it('Standard: tightening applies now, loosening waits for midnight', () => {
    const r = rules({ strictness: 'standard', dailyLimitMin: 60 });
    expect(
      requestChange(
        london,
        r,
        change(r, (c) => ({ ...c, dailyLimitMin: 30 })),
        NOW,
      ),
    ).toMatchObject({ result: 'applied' });
    const res = requestChange(
      london,
      r,
      change(r, (c) => ({ ...c, dailyLimitMin: 120 })),
      NOW,
    );
    expect(res.result).toBe('scheduled');
    if (res.result !== 'scheduled') return;
    expect(show(london, res.effectiveAt)).toBe('2026-11-19 00:00');
    expect(res.rules.dailyLimitMin).toBe(60);
    expect(applyPending(res.rules, res.effectiveAt - 1).dailyLimitMin).toBe(60);
    const later = applyPending(res.rules, res.effectiveAt);
    expect(later.dailyLimitMin).toBe(120);
    expect(later.pending).toBeNull();
  });

  it('a tightening change cancels a waiting loosening (it could otherwise undo it)', () => {
    const r = rules({ strictness: 'standard', dailyLimitMin: 60 });
    const waiting = requestChange(
      london,
      r,
      change(r, (c) => ({ ...c, dailyLimitMin: 120 })),
      NOW,
    ).rules;
    const res = requestChange(
      london,
      waiting,
      change(waiting, (c) => ({ ...c, lockTimes: [lock({ id: 'new' })] })),
      NOW,
    );
    expect(res).toMatchObject({ result: 'applied', cancelledPending: true });
    expect(res.rules.pending).toBeNull();
    expect(applyPending(res.rules, NOW + 2 * DAY).dailyLimitMin).toBe(60);
  });

  it('cancelling a waiting change is always allowed', () => {
    const r = rules({ pending: { effectiveAt: NOW + HOUR, next: coreOf(rules({ dailyLimitMin: 200 })) } });
    expect(cancelPending(r).pending).toBeNull();
  });

  describe('Strict', () => {
    const sleep = lock({ id: 'sleep', start: '22:00', end: '07:00' });
    const strict = startStrict(rules({ lockTimes: [sleep] }), NOW, 7);

    it('runs for the days chosen, then behaves as Standard', () => {
      expect(strictActive(strict, NOW)).toBe(true);
      expect(strict.strictUntil).toBe(NOW + 7 * DAY);
      expect(effectiveStrictness(strict, NOW + 7 * DAY)).toBe('standard');
      // The period is clamped to 1–30 days, and restarting never shortens it.
      expect(startStrict(rules(), NOW, 0).strictUntil).toBe(NOW + DAY);
      expect(startStrict(rules(), NOW, 99).strictUntil).toBe(NOW + 30 * DAY);
      expect(startStrict(strict, NOW, 1).strictUntil).toBe(NOW + 7 * DAY);
    });

    it('switching to Strict as an ordinary change gets a one-week period', () => {
      const r = rules();
      const res = requestChange(
        london,
        r,
        change(r, (c) => ({ ...c, strictness: 'strict' })),
        NOW,
      );
      expect(res.result).toBe('applied');
      expect(res.rules.strictUntil).toBe(NOW + 7 * DAY);
    });

    it('blocked apps can only be added', () => {
      expect(
        requestChange(
          london,
          strict,
          change(strict, (c) => ({ ...c, blocked: { ...c.blocked, apps: ['insta'] } })),
          NOW,
        ),
      ).toMatchObject({
        result: 'refused',
        reason: 'strict-remove-apps',
      });
      expect(
        requestChange(
          london,
          strict,
          change(strict, (c) => ({ ...c, blocked: { ...c.blocked, apps: [...c.blocked.apps, 'yt'] } })),
          NOW,
        ).result,
      ).toBe('applied');
    });

    it('a running lock time cannot be shortened, switched off, deleted, skipped or made earnable', () => {
      const night = T(london, '2026-11-18 23:00');
      const edits: [string, (c: RulesCore) => RulesCore][] = [
        ['shortened', (c) => ({ ...c, lockTimes: c.lockTimes.map((l) => ({ ...l, end: '05:00' })) })],
        ['switched off', (c) => ({ ...c, lockTimes: c.lockTimes.map((l) => ({ ...l, enabled: false })) })],
        ['deleted', (c) => ({ ...c, lockTimes: [] })],
        ['made earnable', (c) => ({ ...c, lockTimes: c.lockTimes.map((l) => ({ ...l, earnable: true })) })],
      ];
      for (const [, f] of edits)
        expect(requestChange(london, strict, change(strict, f), night)).toMatchObject({ result: 'refused', reason: 'strict-running-lock' });
      expect(skipNext(london, strict, 'sleep', night)).toMatchObject({ result: 'refused', reason: 'strict-running-lock' });
    });

    it('outside the lock time, loosening it waits 24 hours', () => {
      const res = requestChange(
        london,
        strict,
        change(strict, (c) => ({ ...c, lockTimes: c.lockTimes.map((l) => ({ ...l, end: '05:00' })) })),
        NOW,
      );
      expect(res.result).toBe('scheduled');
      if (res.result === 'scheduled') expect(res.effectiveAt).toBe(NOW + DAY);
    });

    it('turning Strict off early: refused as a change; costs 100 verified push-ups, or waits 24 h', () => {
      expect(
        requestChange(
          london,
          strict,
          change(strict, (c) => ({ ...c, strictness: 'standard' })),
          NOW,
        ),
      ).toMatchObject({
        result: 'refused',
        reason: 'strict-off-early',
      });
      const waiting = endStrictEarly(strict, NOW, STRICT_OFF_PUSHUPS - 1);
      expect(waiting.result).toBe('scheduled');
      expect(strictActive(waiting.rules, NOW + DAY - 1)).toBe(true);
      expect(applyPending(waiting.rules, NOW + DAY).strictness).toBe('standard');
      const earned = endStrictEarly(strict, NOW, STRICT_OFF_PUSHUPS);
      expect(earned.result).toBe('applied');
      expect(earned.rules.strictness).toBe('standard');
      expect(earned.rules.strictUntil).toBeNull();
    });

    it('after the period ends, changes follow Standard', () => {
      const after = NOW + 8 * DAY;
      const res = requestChange(
        london,
        strict,
        change(strict, (c) => ({ ...c, strictness: 'nudge' })),
        after,
      );
      expect(res.result).toBe('scheduled');
    });
  });

  it('invalid lock times are refused, not saved', () => {
    const r = rules();
    expect(
      requestChange(
        london,
        r,
        change(r, (c) => ({ ...c, lockTimes: [lock({ start: '10:00', end: '10:05' })] })),
        NOW,
      ),
    ).toMatchObject({
      result: 'refused',
      reason: 'invalid',
    });
    expect(
      requestChange(
        london,
        r,
        change(r, (c) => ({ ...c, lockTimes: Array.from({ length: 9 }, (_, i) => lock({ id: `x${i}` })) })),
        NOW,
      ).result,
    ).toBe('refused');
  });
});

describe('skipping a lock time', () => {
  const sleep = lock({ id: 'sleep' });

  it('Nudge skips at once; Standard skips from tomorrow (the skip itself is loosening)', () => {
    const nudge = rules({ strictness: 'nudge', lockTimes: [sleep] });
    const n = skipNext(london, nudge, 'sleep', NOW);
    expect(n.result).toBe('applied');
    expect(n.rules.lockTimes[0].skipDate).toBe('2026-11-18');
    const std = skipNext(london, rules({ lockTimes: [sleep] }), 'sleep', NOW);
    expect(std.result).toBe('scheduled');
  });

  it('skipping while running skips the running one (started yesterday)', () => {
    const n = skipNext(london, rules({ strictness: 'nudge', lockTimes: [sleep] }), 'sleep', T(london, '2026-11-18 05:00'));
    expect(n.rules.lockTimes[0].skipDate).toBe('2026-11-17');
  });

  it('old skips are cleared', () => {
    const r = rules({
      lockTimes: [
        { ...sleep, skipDate: '2026-11-10' },
        { ...sleep, id: 'b', skipDate: '2026-11-17' },
      ],
    });
    const c = clearOldSkips(london, r, NOW);
    expect(c.lockTimes[0].skipDate).toBeNull();
    expect(c.lockTimes[1].skipDate).toBe('2026-11-17');
    expect(clearOldSkips(london, c, NOW)).toBe(c);
  });

  it('an unknown lock id is refused', () => {
    expect(skipNext(london, rules(), 'nope', NOW).result).toBe('refused');
  });
});

it('one minute is one minute', () => expect(MIN).toBe(60_000));
