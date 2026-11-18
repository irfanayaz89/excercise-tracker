import { decide, EMERGENCIES_PER_DAY, EMERGENCY_MIN, ONE_MORE_MIN, ONE_MORE_PER_DAY, rollDay } from './decide';
import { effectiveStrictness } from './rules';
import { parseHHMM, type Zone } from './time';
import type { DayLog, ScreenTimeRules, Selection, Unlock } from './types';

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
  earningEnabled: boolean;
  earnedLeftMin: number;
  earnCapLeftMin: number;
  /** Strictness in force right now (Strict reads as Standard once its period is over). */
  mode: 'nudge' | 'standard' | 'strict';
  emergencyMin: number;
  oneMoreMin: number;
  emergenciesLeft: number;
  oneMoresLeft: number;
  /** An unlock already taken in the app (epoch ms). */
  unlockUntil: number | null;
  locks: NativeLock[];
  /** The app lists travel in the plan, so a change to them follows the same strictness rules as any other. */
  blocked: Selection;
  allowed: Selection;
}

export function toNativePlan(zone: Zone, rules: ScreenTimeRules, logIn: DayLog, now: number): NativePlan {
  const log = rollDay(zone, logIn, now);
  const d = decide(zone, rules, log, now);
  const used = (kind: Unlock['kind']) => log.unlocks.filter((u) => u.kind === kind).length;
  return {
    day: log.day,
    dailyLimitMin: rules.dailyLimitMin,
    limitReached: d.limitLeftMin !== null && d.limitLeftMin <= 0,
    earningEnabled: rules.earning.enabled,
    earnedLeftMin: d.earnedLeftMin,
    earnCapLeftMin: Math.max(0, rules.earning.dailyCapMin - log.earnedMin),
    mode: effectiveStrictness(rules, now),
    emergencyMin: EMERGENCY_MIN,
    oneMoreMin: ONE_MORE_MIN,
    emergenciesLeft: Math.max(0, EMERGENCIES_PER_DAY - used('emergency')),
    oneMoresLeft: Math.max(0, ONE_MORE_PER_DAY - used('one-more')),
    unlockUntil: d.unlockedUntil,
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
      : [];
    return {
      day: o.day,
      usedMin: n(o.usedMin),
      limitReached: o.limitReached === true,
      earnedSpentMin: n(o.earnedSpentMin),
      unlocks,
      openEarn: o.openEarn === true,
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
  if (report.day !== log.day) return { ...log, unlocks };
  let usedMin = Math.max(log.usedMin, report.usedMin);
  if (report.limitReached && rules.dailyLimitMin !== null) usedMin = Math.max(usedMin, rules.dailyLimitMin);
  const earnedUsedMin = Math.min(log.earnedMin, log.earnedUsedMin + report.earnedSpentMin);
  return { ...log, usedMin, earnedUsedMin, unlocks };
}
