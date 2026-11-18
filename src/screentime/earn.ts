import { isTimed } from '@/engine/exercises';
import type { SessionSummary } from '@/engine/session';
import { rollDay } from './decide';
import type { Zone } from './time';
import type { DayLog, Grant, ScreenTimeRules } from './types';

export interface EarnInput {
  summary: SessionSummary;
  /** The saved set's id (a set can only earn once). */
  sessionId: string;
  /** Demo sets never earn. */
  demo: boolean;
}

/** Minutes a finished set is worth, before the daily cap (plan §4). */
export function minutesFor(rules: ScreenTimeRules, summary: SessionSummary): number {
  const exercise = summary.exercise ?? 'pushup';
  const rate = rules.earning.rates[exercise];
  if (isTimed(exercise)) {
    // Time in good form only (both sides for the side plank).
    const goodMs = summary.hold?.goodMs ?? 0;
    return Math.floor((goodMs / 10_000) * (rate.per10s ?? 0) + 1e-9);
  }
  // Counted reps only: reps taken back by the real-person check are already gone from the summary.
  const clean = summary.cleanReps;
  const flagged = Math.max(0, summary.totalReps - summary.cleanReps);
  return Math.floor(clean * (rate.perCleanRep ?? 0) + flagged * (rate.perFlaggedRep ?? 0) + 1e-9);
}

export type EarnResult = {
  minutes: number;
  log: DayLog;
  capped: boolean;
  reason: 'earned' | 'disabled' | 'demo' | 'duplicate' | 'nothing' | 'cap-reached';
};

/**
 * Credit a finished set. Earned minutes only ever come from here, at the end of
 * a set the engine verified: demo sets, sets already credited, and anything
 * over today's cap earn nothing.
 */
export function earnFromSet(zone: Zone, rules: ScreenTimeRules, logIn: DayLog, input: EarnInput, now: number): EarnResult {
  const log = rollDay(zone, logIn, now);
  if (!rules.earning.enabled) return { minutes: 0, log, capped: false, reason: 'disabled' };
  if (input.demo) return { minutes: 0, log, capped: false, reason: 'demo' };
  if (log.grants.some((g) => g.sessionId === input.sessionId)) return { minutes: 0, log, capped: false, reason: 'duplicate' };
  const worth = minutesFor(rules, input.summary);
  if (worth <= 0) return { minutes: 0, log, capped: false, reason: 'nothing' };
  const room = Math.max(0, rules.earning.dailyCapMin - log.earnedMin);
  if (room <= 0) return { minutes: 0, log, capped: true, reason: 'cap-reached' };
  const minutes = Math.min(worth, room);
  const grant: Grant = {
    id: `${input.sessionId}:${now}`,
    at: now,
    minutes,
    exercise: input.summary.exercise ?? 'pushup',
    sessionId: input.sessionId,
  };
  return {
    minutes,
    log: { ...log, earnedMin: log.earnedMin + minutes, grants: [...log.grants, grant] },
    capped: minutes < worth,
    reason: 'earned',
  };
}
