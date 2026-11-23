import { decide, EMERGENCIES_PER_DAY, EMERGENCY_MIN, ONE_MORE_MIN, ONE_MORE_PER_DAY, rollDay } from './decide';
import { effectiveStrictness } from './rules';
import { parseHHMM, type Zone } from './time';
import type { DayLog, Focus, Gap, ScreenTimeRules, Selection, Unlock } from './types';

/**
 * The bridge between the rules engine and the phone's own blocking. The app
 * works out a plan (this file) and hands it to the native module; while the
 * app is closed the native side acts on it, then reports what happened (usage,
 * earned minutes spent, unlocks taken on the blocked screen), which is merged
 * back into today's log the next time the app opens. Keep NativePlan in step
 * with `STShared.Plan` (modules/screen-time/ios/STShared.swift) and the Android
 * module's plan.
 */

export interface NativeLock {
  id: string;
  name: string;
  days: number[];
  startMin: number;
  endMin: number;
  earnable: boolean;
  enabled: boolean;
  skipDate: string | null;
  /** Blocks its own app list instead of the main one. */
  ownApps: boolean;
  apps: Selection | null;
}

export interface NativePlan {
  /** Local day the counts below refer to. */
  day: string;
  dailyLimitMin: number | null;
  limitReached: boolean;
  /** Minutes already used today, as far as the app knows. iOS measures the rest of the limit from here. */
  usedMin: number;
  earningEnabled: boolean;
  earnedLeftMin: number;
  earnCapLeftMin: number;
  /** Strictness in force right now (Strict reads as Standard once its period is over). */
  mode: 'nudge' | 'standard' | 'strict';
  emergencyMin: number;
  oneMoreMin: number;
  emergenciesLeft: number;
  oneMoresLeft: number;
  /** The full daily allowance: what the phone falls back to on a new day the app hasn't seen yet. */
  emergenciesPerDay: number;
  oneMoresPerDay: number;
  /** An unlock already taken in the app (epoch ms). */
  unlockUntil: number | null;
  /** A workout focus blocks the main apps until then (epoch ms). */
  focusUntil: number | null;
  /** "set" ends when the set ends; "timed" runs to focusUntil (for the block-screen wording). */
  focusKind: 'set' | 'timed' | null;
  locks: NativeLock[];
  /** The app lists travel in the plan, so a change to them follows the same strictness rules as any other. */
  blocked: Selection;
  allowed: Selection;
}

export function toNativePlan(zone: Zone, rules: ScreenTimeRules, logIn: DayLog, now: number, focus: Focus | null = null): NativePlan {
  const log = rollDay(zone, logIn, now);
  const d = decide(zone, rules, log, now, focus);
  const used = (kind: Unlock['kind']) => log.unlocks.filter((u) => u.kind === kind).length;
  return {
    day: log.day,
    dailyLimitMin: rules.dailyLimitMin,
    limitReached: d.limitLeftMin !== null && d.limitLeftMin <= 0,
    usedMin: Math.round(log.usedMin),
    earningEnabled: rules.earning.enabled,
    earnedLeftMin: d.earnedLeftMin,
    earnCapLeftMin: Math.max(0, rules.earning.dailyCapMin - log.earnedMin),
    mode: effectiveStrictness(rules, now),
    emergencyMin: EMERGENCY_MIN,
    oneMoreMin: ONE_MORE_MIN,
    emergenciesLeft: Math.max(0, EMERGENCIES_PER_DAY - used('emergency')),
    oneMoresLeft: Math.max(0, ONE_MORE_PER_DAY - used('one-more')),
    emergenciesPerDay: EMERGENCIES_PER_DAY,
    oneMoresPerDay: ONE_MORE_PER_DAY,
    unlockUntil: d.unlockedUntil,
    focusUntil: d.focus ? d.focus.until : null,
    focusKind: d.focus ? d.focus.kind : null,
    locks: rules.lockTimes.map((l) => ({
      id: l.id,
      name: l.name,
      days: [...l.days].sort(),
      startMin: parseHHMM(l.start) ?? 0,
      endMin: parseHHMM(l.end) ?? 0,
      earnable: l.earnable,
      enabled: l.enabled,
      skipDate: l.skipDate,
      ownApps: l.apps !== 'main',
      apps: l.apps === 'main' ? null : l.apps,
    })),
    blocked: rules.blocked,
    allowed: rules.allowed,
  };
}

/** What the native side recorded while Trueline was closed (`takeState()`). */
export interface NativeReport {
  day: string;
  /** Usage of the blocked apps today, in 15-minute steps (the exact limit is reported separately). */
  usedMin: number;
  limitReached: boolean;
  /** Earned minutes spent since the last sync. */
  earnedSpentMin: number;
  unlocks: Unlock[];
  /** "Earn time" was tapped on the blocked screen. */
  openEarn: boolean;
  /** Android: times the blocking service wasn't running (force stop, Task Manager, killed). */
  gaps?: Gap[];
  /** iOS 26.5+: the system said stored app tokens expired, so the lists must be picked again. */
  tokensExpired?: boolean;
}

export function parseReport(json: string): NativeReport | null {
  try {
    const o = JSON.parse(json) as Record<string, unknown>;
    if (!o || typeof o !== 'object' || typeof o.day !== 'string') return null;
    const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
    const unlocks = Array.isArray(o.unlocks)
      ? o.unlocks.filter(
          (u): u is Unlock =>
            !!u &&
            (u.kind === 'emergency' || u.kind === 'one-more') &&
            typeof u.from === 'number' &&
            typeof u.until === 'number' &&
            u.until > u.from,
        )
          // iOS reports fractional milliseconds; whole ones compare cleanly with the app's clock.
          .map((u) => ({ ...u, from: Math.floor(u.from) }))
      : [];
    const gaps = Array.isArray(o.gaps)
      ? o.gaps.filter(
          (g): g is Gap =>
            !!g &&
            (g.kind === 'stopped' || g.kind === 'killed' || g.kind === 'permission') &&
            typeof g.from === 'number' &&
            typeof g.to === 'number' &&
            g.to > g.from,
        )
      : [];
    return {
      day: o.day,
      gaps,
      usedMin: n(o.usedMin),
      limitReached: o.limitReached === true,
      earnedSpentMin: n(o.earnedSpentMin),
      unlocks,
      openEarn: o.openEarn === true,
      tokensExpired: o.tokensExpired === true,
    };
  } catch {
    return null;
  }
}

/**
 * Fold a native report into today's log. Only today's counts are taken (a
 * report from an earlier day is stale: that day's allowance is gone anyway).
 * Usage only ever goes up, earned time spent never exceeds what was earned,
 * and an unlock is recorded once however often it is reported.
 */
export function mergeReport(zone: Zone, rules: ScreenTimeRules, logIn: DayLog, report: NativeReport | null, now: number): DayLog {
  const log = rollDay(zone, logIn, now);
  if (!report) return log;
  const seen = new Set(log.unlocks.map((u) => `${u.kind}:${u.from}`));
  const unlocks = [...log.unlocks];
  for (const u of report.unlocks) {
    // Unlocks are kept even from yesterday's report if they're still running (taken just before midnight).
    if ((report.day === log.day || u.until > now) && !seen.has(`${u.kind}:${u.from}`)) {
      unlocks.push(u);
      seen.add(`${u.kind}:${u.from}`);
    }
  }
  const gaps = mergeGaps(log.gaps ?? [], report.gaps ?? []);
  if (report.day !== log.day) return { ...log, unlocks, ...(gaps.length ? { gaps } : {}) };
  let usedMin = Math.max(log.usedMin, report.usedMin);
  if (report.limitReached && rules.dailyLimitMin !== null) usedMin = Math.max(usedMin, rules.dailyLimitMin);
  const earnedUsedMin = Math.min(log.earnedMin, log.earnedUsedMin + report.earnedSpentMin);
  return { ...log, usedMin, earnedUsedMin, unlocks, ...(gaps.length ? { gaps } : {}) };
}

/** Add gaps, once each (a gap is identified by its start). */
export function mergeGaps(have: Gap[], add: Gap[]): Gap[] {
  const out = [...have];
  for (const g of add) if (!out.some((x) => x.from === g.from)) out.push(g);
  return out.sort((a, b) => a.from - b.from);
}
