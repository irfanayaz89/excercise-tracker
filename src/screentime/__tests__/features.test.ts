/// <reference types="jest" />
/**
 * The features added after the competitor research: per-app limits (time and opens), "block
 * everything except", the pause before opening, the key lock, and silencing notifications.
 */
import { decide, freshDay, takeUnlock } from '../decide';
import { endFocus, startFocus, startKeyLock } from '../focus';
import { mergeReport, parseReport, toNativePlan } from '../plan';
import { coreOf, loosens, MAX_APP_LIMITS, normalizeRules, requestChange } from '../rules';
import type { AppLimit, DayLog, RulesCore } from '../types';
import { HOUR, lock, london, MIN, rules, T } from './helpers';

const NOON = T(london, '2026-11-18 12:00');
const day = (over: Partial<DayLog> = {}): DayLog => ({ ...freshDay(london, NOON), ...over });
const insta: AppLimit = {
  id: 'lim-insta',
  name: 'Instagram',
  apps: { apps: ['insta'], categories: [], domains: [] },
  dailyMin: 20,
  opensPerDay: null,
  enabled: true,
};
const yt: AppLimit = {
  ...insta,
  id: 'lim-yt',
  name: 'YouTube',
  apps: { apps: ['yt'], categories: [], domains: [] },
  dailyMin: null,
  opensPerDay: 5,
};
const r = rules({ dailyLimitMin: 60, appLimits: [insta, yt] });

describe('per-app limits', () => {
  it('close their own apps once their minutes are used, and only those', () => {
    expect(decide(london, r, day({ appUsed: { 'lim-insta': 19 } }), NOON).limitBlocks).toEqual([]);
    const d = decide(london, r, day({ appUsed: { 'lim-insta': 20 } }), NOON);
    expect(d.limitBlocks).toEqual([{ id: 'lim-insta', name: 'Instagram', apps: insta.apps, why: 'time' }]);
    expect(d.blocked).toBe(false);
  });

  it('close after the number of opens (Android)', () => {
    expect(decide(london, r, day({ appOpens: { 'lim-yt': 5 } }), NOON).limitBlocks.map((b) => b.why)).toEqual(['opens']);
  });

  it("earned time doesn't open them, an unlock does, and the unlock is offered", () => {
    const used = day({ appUsed: { 'lim-insta': 25 }, earnedMin: 30 });
    const d = decide(london, r, used, NOON);
    expect(d.limitBlocks).toHaveLength(1);
    expect(d.emergency.available).toBe(true);
    const res = takeUnlock(london, r, used, 'emergency', NOON);
    expect(res.ok).toBe(true);
    if (res.ok) expect(decide(london, r, res.log, NOON + MIN).limitBlocks).toEqual([]);
  });

  it('are ignored when switched off, and a new day starts from zero', () => {
    const off = rules({ appLimits: [{ ...insta, enabled: false }] });
    expect(decide(london, off, day({ appUsed: { 'lim-insta': 99 } }), NOON).limitBlocks).toEqual([]);
    expect(decide(london, r, day({ appUsed: { 'lim-insta': 99 } }), NOON + 24 * HOUR).limitBlocks).toEqual([]);
  });

  it('loosening them waits; tightening applies at once', () => {
    const c = coreOf(r);
    const loose: RulesCore[] = [
      { ...c, appLimits: [yt] },
      { ...c, appLimits: [{ ...insta, dailyMin: 30 }, yt] },
      { ...c, appLimits: [{ ...insta, dailyMin: null, opensPerDay: 3 }, yt] },
      { ...c, appLimits: [{ ...insta, apps: { apps: [], categories: ['social'], domains: [] } }, yt] },
      { ...c, appLimits: [insta, { ...yt, opensPerDay: 9 }] },
      { ...c, appLimits: [{ ...insta, enabled: false }, yt] },
    ];
    for (const next of loose) expect(loosens(c, next)).toBe(true);
    expect(loosens(c, { ...c, appLimits: [{ ...insta, dailyMin: 10 }, yt] })).toBe(false);
    expect(loosens(c, { ...c, appLimits: [insta, yt, { ...insta, id: 'lim-x' }] })).toBe(false);
    expect(requestChange(london, r, { ...c, appLimits: [yt] }, NOON)).toMatchObject({ result: 'scheduled' });
  });

  it('a limit needs apps and a time or opens cap, and there are at most three', () => {
    const c = coreOf(r);
    const bad = { ...insta, id: 'x', dailyMin: null, opensPerDay: null };
    expect(requestChange(london, r, { ...c, appLimits: [insta, bad] }, NOON)).toMatchObject({ result: 'refused', reason: 'invalid' });
    const four = Array.from({ length: MAX_APP_LIMITS + 1 }, (_, i) => ({ ...insta, id: `l${i}` }));
    expect(requestChange(london, r, { ...c, appLimits: four }, NOON)).toMatchObject({ result: 'refused', reason: 'invalid' });
    expect(normalizeRules({ ...r, appLimits: [insta, bad, 'junk'] }).appLimits).toEqual([insta]);
  });
});

describe('block everything except the always-allowed apps', () => {
  it('an "everything" lock time blocks like a main one and says so', () => {
    const all = rules({ lockTimes: [lock({ start: '11:00', end: '13:00', apps: 'all' })] });
    expect(decide(london, all, day(), NOON)).toMatchObject({ blocked: true, reason: 'lock', blockAll: true });
    expect(decide(london, rules({ lockTimes: [lock({ start: '11:00', end: '13:00' })] }), day(), NOON).blockAll).toBe(false);
  });

  it('a focus started with "everything" blocks everything; the plan carries it', () => {
    const f = startFocus(r, null, 30, NOON, true);
    expect(decide(london, r, day(), NOON + MIN, f)).toMatchObject({ reason: 'focus', blockAll: true });
    expect(toNativePlan(london, r, day(), NOON + MIN, f).focusAll).toBe(true);
    expect(toNativePlan(london, r, day(), NOON + MIN, startFocus(r, null, 30, NOON)).focusAll).toBe(false);
  });

  it('narrowing "everything" back to the blocked list is loosening; widening is tightening', () => {
    const main = lock({ id: 'w', start: '09:00', end: '17:00' });
    const a = { ...coreOf(r), lockTimes: [main] };
    const b = { ...coreOf(r), lockTimes: [{ ...main, apps: 'all' as const }] };
    expect(loosens(a, b)).toBe(false);
    expect(loosens(b, a)).toBe(true);
    expect(toNativePlan(london, rules({ lockTimes: b.lockTimes }), day(), NOON).locks[0]).toMatchObject({
      allApps: true,
      ownApps: false,
      apps: null,
    });
  });
});

describe('pause before opening', () => {
  it('switching it off or shortening it is loosening', () => {
    const on = { ...coreOf(r), pause: { enabled: true, seconds: 10 } };
    expect(loosens(on, { ...on, pause: { enabled: false, seconds: 10 } })).toBe(true);
    expect(loosens(on, { ...on, pause: { enabled: true, seconds: 5 } })).toBe(true);
    expect(loosens(on, { ...on, pause: { enabled: true, seconds: 20 } })).toBe(false);
  });

  it("the plan carries the pause and today's passes", () => {
    const on = rules({ pause: { enabled: true, seconds: 10 } });
    expect(toNativePlan(london, on, day({ pauses: 3 }), NOON).pause).toMatchObject({
      enabled: true,
      seconds: 10,
      step: 5,
      max: 60,
      passes: 3,
    });
  });
});

describe('key lock', () => {
  it('runs until the key is scanned: not ended by hand, finishing a set or backing out', () => {
    const k = startKeyLock(null, 2, NOON);
    expect(k).toMatchObject({ kind: 'key', strict: true, until: NOON + 2 * HOUR });
    for (const why of ['manual', 'abandoned', 'completed'] as const) expect(endFocus(k, why, NOON + MIN).ended).toBe(false);
    expect(endFocus(k, 'key', NOON + MIN)).toMatchObject({ ended: true, record: { outcome: 'ended' } });
  });

  it('a workout started during a key lock keeps the key lock', () => {
    const k = startKeyLock(null, 1, NOON);
    expect(startFocus(r, k, 15, NOON + MIN)).toMatchObject({ kind: 'key', until: NOON + HOUR, strict: true });
  });

  it('has a safety end of at most 8 hours, and blocks like a focus', () => {
    expect(startKeyLock(null, 99, NOON).until).toBe(NOON + 8 * HOUR);
    const k = startKeyLock(null, 1, NOON);
    expect(decide(london, r, day(), NOON + MIN, k)).toMatchObject({ blocked: true, reason: 'focus', focus: { kind: 'key' } });
    expect(toNativePlan(london, r, day(), NOON + MIN, k).focusKind).toBe('key');
  });
});

describe('the phone reports per-app use, opens and passes', () => {
  it('kept as the highest count seen today, and sent back in the plan', () => {
    const rep = parseReport(
      JSON.stringify({ day: '2026-11-18', unlocks: [], appUsed: { 'lim-insta': 12, bad: -1 }, appOpens: { 'lim-yt': 2 }, pauses: 4 }),
    );
    expect(rep).toMatchObject({ appUsed: { 'lim-insta': 12 }, appOpens: { 'lim-yt': 2 }, pauses: 4 });
    let log = mergeReport(london, day({ appUsed: { 'lim-insta': 15 } }), rep, NOON);
    log = mergeReport(london, log, rep, NOON);
    expect(log).toMatchObject({ appUsed: { 'lim-insta': 15 }, appOpens: { 'lim-yt': 2 }, pauses: 4 });
    expect(toNativePlan(london, r, log, NOON).appLimits).toEqual([
      expect.objectContaining({ id: 'lim-insta', usedMin: 15, opens: 0, dailyMin: 20 }),
      expect.objectContaining({ id: 'lim-yt', usedMin: 0, opens: 2, opensPerDay: 5 }),
    ]);
  });
});

describe('silencing notifications', () => {
  it('is off by default, travels in the plan, and switching it off is loosening', () => {
    expect(normalizeRules({}).silenceNotifications).toBe(false);
    const on = rules({ silenceNotifications: true });
    expect(toNativePlan(london, on, day(), NOON).silence).toBe(true);
    expect(loosens(coreOf(on), { ...coreOf(on), silenceNotifications: false })).toBe(true);
  });
});

describe('holes found in review', () => {
  const sleep = lock({ id: 'sleep', start: '22:00', end: '07:00' });
  const base = rules({ lockTimes: [sleep] });

  it('moving a lock time onto another list, or off "Everything", is loosening', () => {
    const c = coreOf(base);
    const own = { ...sleep, apps: { apps: ['calculator'], categories: [], domains: [] } };
    expect(loosens(c, { ...c, lockTimes: [own] })).toBe(true);
    // A twin with its own list, then the main one removed.
    const twin = { ...own, id: 'twin' };
    const withTwin = { ...c, lockTimes: [sleep, twin] };
    expect(loosens(c, withTwin)).toBe(false);
    expect(loosens(withTwin, { ...c, lockTimes: [twin] })).toBe(true);
    // An own-list lock made earnable gives its apps back.
    expect(loosens(withTwin, { ...c, lockTimes: [sleep, { ...twin, earnable: true }] })).toBe(true);
    // In Strict, during the lock, it's refused.
    const strict = rules({ lockTimes: [sleep], strictness: 'strict', strictUntil: NOON + 7 * 24 * HOUR });
    const night = T(london, '2026-11-18 23:00');
    expect(requestChange(london, strict, { ...coreOf(strict), lockTimes: [own] }, night)).toMatchObject({ result: 'refused' });
  });

  it("an expired Strict isn't restarted by an unrelated tightening", () => {
    const over = rules({ strictness: 'strict', strictUntil: NOON - HOUR });
    const res = requestChange(london, over, { ...coreOf(over), blocked: { ...over.blocked, apps: [...over.blocked.apps, 'yt'] } }, NOON);
    expect(res).toMatchObject({ result: 'applied', rules: { strictness: 'standard', strictUntil: null } });
  });

  it('a merged focus never outlasts the cap it is stored with', () => {
    const k = startKeyLock(null, 8, NOON);
    expect(startFocus(r, k, 60, NOON + 7.5 * HOUR).until).toBe(NOON + 8 * HOUR);
    const t = startFocus(r, null, 60, NOON);
    expect(startFocus(r, t, 60, NOON + 50 * MIN).until - NOON).toBeLessThanOrEqual(3 * HOUR);
    expect(startKeyLock(t, 8, NOON + 50 * MIN).until).toBe(NOON + 8 * HOUR);
  });

  it('raising the daily limit after reaching it gives the extra time', () => {
    const rep = parseReport(JSON.stringify({ day: '2026-11-18', unlocks: [], usedMin: 30, limitReached: true }));
    const raised = rules({ dailyLimitMin: 60 });
    const log = mergeReport(london, day(), rep, NOON);
    expect(log.usedMin).toBe(30);
    expect(decide(london, raised, log, NOON).blocked).toBe(false);
  });
});
