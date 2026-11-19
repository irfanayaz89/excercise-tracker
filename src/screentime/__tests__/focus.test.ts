/// <reference types="jest" />
/**
 * Workout Focus Mode (research guide §10.4) and the other gaps the research
 * found: protection gaps in history, the plan's focus and usage fields, and
 * the lock-time cap that keeps iOS inside its 20-schedule budget.
 */
import { decide, freshDay, takeUnlock } from '../decide';
import { endFocus, FOCUS_MAX_MIN, logFocus, SET_FOCUS_CAP_MIN, settleFocus, startFocus } from '../focus';
import { mergeReport, parseReport, toNativePlan } from '../plan';
import { coreOf, MAX_LOCK_TIMES, requestChange } from '../rules';
import { summarizeDays } from '../summary';
import type { DayLog, Focus } from '../types';
import { HOUR, lock, london, MIN, rules, T } from './helpers';

const NOON = T(london, '2026-11-18 12:00');
const day = (over: Partial<DayLog> = {}): DayLog => ({ ...freshDay(london, NOON), ...over });
const standard = rules({ dailyLimitMin: 60 });
const strict = rules({ dailyLimitMin: 60, strictness: 'strict', strictUntil: NOON + 7 * 24 * HOUR });

describe('starting a focus', () => {
  it('"for this set" gets a safety end the phone knows about', () => {
    const f = startFocus(standard, null, 'set', NOON);
    expect(f).toEqual({ kind: 'set', startedAt: NOON, until: NOON + SET_FOCUS_CAP_MIN * MIN, strict: false });
  });

  it('a timed focus lasts the chosen minutes, never more than the hard cap', () => {
    expect(startFocus(standard, null, 30, NOON).until).toBe(NOON + 30 * MIN);
    expect(startFocus(standard, null, 9999 as 60, NOON).until).toBe(NOON + FOCUS_MAX_MIN * MIN);
  });

  it('in Strict the focus is strict', () => {
    expect(startFocus(strict, null, 30, NOON).strict).toBe(true);
  });

  it('starting again while one runs only ever extends it', () => {
    const timed = startFocus(standard, null, 60, NOON);
    const again = startFocus(standard, timed, 15, NOON + 10 * MIN);
    expect(again).toMatchObject({ startedAt: NOON, until: NOON + 60 * MIN, kind: 'timed' });
    const longer = startFocus(standard, startFocus(standard, null, 15, NOON), 45, NOON + 5 * MIN);
    expect(longer.until).toBe(NOON + 50 * MIN);
  });
});

describe('what a focus blocks', () => {
  const f = startFocus(standard, null, 30, NOON);

  it('blocks the main apps even with no lock time and the limit not reached', () => {
    const d = decide(london, standard, day(), NOON + MIN, f);
    expect(d).toMatchObject({ blocked: true, reason: 'focus', canEarn: false, focus: { kind: 'timed', until: f.until } });
  });

  it("earned minutes don't open apps during a workout", () => {
    const d = decide(london, standard, day({ usedMin: 60, earnedMin: 30 }), NOON + MIN, f);
    expect(d).toMatchObject({ blocked: true, reason: 'focus', usingEarned: false });
  });

  it('the emergency unlock still works (the safety valve), and it is rationed as usual', () => {
    const res = takeUnlock(london, standard, day(), 'emergency', NOON + MIN, f);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(decide(london, standard, res.log, NOON + 2 * MIN, f).blocked).toBe(false);
    expect(takeUnlock(london, standard, res.log, 'emergency', NOON + 20 * MIN, f).ok).toBe(false);
  });

  it('wakes up at the focus end, and after it the apps are open again', () => {
    expect(decide(london, standard, day(), NOON + MIN, f).nextChange).toBe(f.until);
    expect(decide(london, standard, day(), f.until, f)).toMatchObject({ blocked: false, focus: null });
  });

  it('ignores a focus that has not started yet (a clock moved backwards)', () => {
    expect(decide(london, standard, day(), NOON - HOUR, f).blocked).toBe(false);
  });
});

describe('ending a focus', () => {
  const set: Focus = startFocus(standard, null, 'set', NOON);
  const timed: Focus = startFocus(standard, null, 30, NOON);
  const strictSet: Focus = startFocus(strict, null, 'set', NOON);
  const at = NOON + 10 * MIN;

  it('finishing the set ends a "for this set" focus', () => {
    expect(endFocus(set, 'completed', at)).toMatchObject({ ended: true, record: { from: NOON, to: at, outcome: 'completed' } });
  });

  it('a timed focus keeps going after the set', () => {
    expect(endFocus(timed, 'completed', at)).toMatchObject({ ended: false, why: 'timed' });
  });

  it('backing out or pressing End stops it outside Strict', () => {
    expect(endFocus(set, 'abandoned', at)).toMatchObject({ ended: true, record: { outcome: 'abandoned' } });
    expect(endFocus(timed, 'manual', at)).toMatchObject({ ended: true, record: { outcome: 'ended' } });
  });

  it("Strict: backing out and pressing End don't work, only finishing or the time running out", () => {
    expect(endFocus(strictSet, 'abandoned', at)).toMatchObject({ ended: false, why: 'strict' });
    expect(endFocus(strictSet, 'manual', at)).toMatchObject({ ended: false, why: 'strict' });
    expect(endFocus(strictSet, 'completed', at)).toMatchObject({ ended: true });
  });

  it('a focus whose time is up is settled into history as expired', () => {
    expect(settleFocus(timed, NOON + 5 * MIN)).toEqual({ focus: timed, record: null });
    expect(settleFocus(timed, timed.until + 1)).toEqual({ focus: null, record: { from: NOON, to: timed.until, outcome: 'expired' } });
  });

  it('records go into the day once, and history adds them up', () => {
    const rec = { from: NOON, to: NOON + 30 * MIN, outcome: 'completed' as const };
    let log = logFocus(london, day(), rec, NOON + 30 * MIN);
    log = logFocus(london, log, rec, NOON + 30 * MIN);
    expect(log.focuses).toHaveLength(1);
    const gaps = [{ from: NOON, to: NOON + 90 * MIN, kind: 'stopped' as const }];
    expect(summarizeDays(standard, [{ ...log, gaps }])[0]).toMatchObject({ focusMin: 30, offMin: 90 });
  });
});

describe('the plan and report carry focus, usage and gaps', () => {
  it('the plan tells the phone when the focus ends and how much was used', () => {
    const f = startFocus(standard, null, 30, NOON);
    expect(toNativePlan(london, standard, day({ usedMin: 37 }), NOON + MIN, f)).toMatchObject({ focusUntil: f.until, focusKind: 'timed', usedMin: 37 });
    expect(toNativePlan(london, standard, day(), f.until + 1, f).focusUntil).toBeNull();
  });

  it('stop gaps reported by Android are kept once, and bad ones are dropped', () => {
    const gap = { from: NOON - HOUR, to: NOON - 30 * MIN, kind: 'stopped' };
    const report = parseReport(
      JSON.stringify({ day: '2026-11-18', unlocks: [], gaps: [gap, { kind: 'magic', from: 1, to: 2 }, { kind: 'killed', from: 5, to: 3 }], tokensExpired: true }),
    );
    expect(report).toMatchObject({ gaps: [gap], tokensExpired: true });
    let log = mergeReport(london, standard, day(), report, NOON);
    log = mergeReport(london, standard, log, report, NOON);
    expect(log.gaps).toEqual([gap]);
  });
});

describe('lock-time cap', () => {
  it('stays within the iPhone schedule budget (5 + 2 per lock time ≤ 20)', () => {
    expect(5 + 2 * MAX_LOCK_TIMES).toBeLessThanOrEqual(20);
    const many = Array.from({ length: MAX_LOCK_TIMES + 1 }, (_, i) => lock({ id: `l${i}`, start: `0${i}:00`, end: `0${i}:30` }));
    expect(requestChange(london, standard, { ...coreOf(standard), lockTimes: many }, NOON)).toMatchObject({ result: 'refused', reason: 'invalid' });
  });
});
