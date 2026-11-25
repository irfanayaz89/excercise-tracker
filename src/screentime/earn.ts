import { isTimed } from '@/engine/exercises';
import type { SessionSummary } from '@/engine/session';
import { rollDay } from './decide';
import { MILESTONES_PE, MIN_BONUS_PE } from './rules';
import type { Zone } from './time';
import type { DayLog, Grant, ScreenTimeRules } from './types';

export interface EarnInput {
  summary: SessionSummary;
  /** The saved set's id (a set can only earn once). */
  sessionId: string;
  /** Demo sets never earn. */
  demo: boolean;
  /** No set on the day before (the user came back after a break). */
  cameBack?: boolean;
}

/**
 * A set's work in push-up equivalents (PE): rates are minutes per unit, and a
 * push-up is 1 minute, so PE and base minutes are the same number.
 */
export function setPe(rules: ScreenTimeRules, summary: SessionSummary): number {
  const exercise = summary.exercise ?? 'pushup';
  const rate = rules.earning.rates[exercise];
  if (isTimed(exercise)) {
    // Time in good form only (both sides for the side plank). Head-on, the camera
    // can't see the hips sag, so a front-view hold earns half.
    const goodMs = summary.hold?.goodMs ?? 0;
    const view = summary.view === 'front' ? 0.5 : 1;
    return (goodMs / 10_000) * (rate.per10s ?? 0) * view;
  }
  // Counted reps only: reps taken back by the real-person check are already gone from the summary.
  const clean = summary.cleanReps;
  const flagged = Math.max(0, summary.totalReps - summary.cleanReps);
  return clean * (rate.perCleanRep ?? 0) + flagged * (rate.perFlaggedRep ?? 0);
}

/** Base minutes for a set, before milestones, bonuses and the daily cap. */
export function minutesFor(rules: ScreenTimeRules, summary: SessionSummary): number {
  return Math.floor(setPe(rules, summary) + 1e-9);
}

export interface SetWorth {
  minutes: number;
  /** Milestone and day bonuses included in `minutes` (before halving). */
  bonus: number;
  halfRate: boolean;
  pe: number;
}

/**
 * What a set is worth before the daily cap: 1 min per push-up equivalent (up
 * to `setCapPe` a set), plus `milestoneMin` for each milestone reached (10, 20
 * PE), plus the first-set-of-the-day and coming-back bonuses for a real set.
 * Past `fullRateMin` earned today, the rest is worth half.
 */
export function setWorth(
  rules: ScreenTimeRules,
  summary: SessionSummary,
  ctx: { earnedToday: number; firstOfDay?: boolean; cameBack?: boolean },
): SetWorth {
  const e = rules.earning;
  const pe = setPe(rules, summary);
  const base = Math.floor(Math.min(pe, e.setCapPe) + 1e-9);
  const milestones = MILESTONES_PE.filter((m) => pe + 1e-9 >= m).length * e.milestoneMin;
  const real = pe + 1e-9 >= MIN_BONUS_PE;
  const day = real ? (ctx.firstOfDay ? e.firstSetMin : 0) + (ctx.firstOfDay && ctx.cameBack ? e.comebackMin : 0) : 0;
  const bonus = milestones + day;
  const raw = base + bonus;
  const full = Math.max(0, e.fullRateMin - ctx.earnedToday);
  if (raw <= full) return { minutes: raw, bonus, halfRate: false, pe };
  return { minutes: full + Math.floor((raw - full) / 2), bonus, halfRate: true, pe };
}

export type EarnResult = {
  minutes: number;
  /** Set bonus included in `minutes` (before halving or the cap). */
  bonus: number;
  /** Some of this set was earned at half rate (past the day's full-rate minutes). */
  halfRate: boolean;
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
  const none = { bonus: 0, halfRate: false };
  if (!rules.earning.enabled) return { minutes: 0, ...none, log, capped: false, reason: 'disabled' };
  if (input.demo) return { minutes: 0, ...none, log, capped: false, reason: 'demo' };
  if (log.grants.some((g) => g.sessionId === input.sessionId)) return { minutes: 0, ...none, log, capped: false, reason: 'duplicate' };
  const firstOfDay = log.grants.length === 0;
  const { minutes: worth, bonus, halfRate } = setWorth(rules, input.summary, { earnedToday: log.earnedMin, firstOfDay, cameBack: input.cameBack });
  if (worth <= 0) return { minutes: 0, ...none, log, capped: false, reason: 'nothing' };
  const room = Math.max(0, rules.earning.dailyCapMin - log.earnedMin);
  if (room <= 0) return { minutes: 0, ...none, log, capped: true, reason: 'cap-reached' };
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
    bonus,
    halfRate,
    log: { ...log, earnedMin: log.earnedMin + minutes, grants: [...log.grants, grant] },
    capped: minutes < worth,
    reason: 'earned',
  };
}
