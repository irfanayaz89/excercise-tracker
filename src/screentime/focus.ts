import { rollDay } from './decide';
import { effectiveStrictness } from './rules';
import type { Zone } from './time';
import type { DayLog, Focus, FocusRecord, ScreenTimeRules } from './types';

/**
 * Workout Focus Mode (research guide §10.4). Pure rules; the store saves the
 * focus and hands it to the phone, which blocks the main apps until `until`.
 *
 * - "set": lasts while the set runs, capped at SET_FOCUS_CAP_MIN. Ends when
 *   the set ends; backing out ends it too, except in Strict.
 * - "timed" (15 / 30 / 45 / 60 min): stays for the chosen time even after the
 *   set. It can be ended early by hand, except in Strict.
 * Every focus has a planned end, and none can be longer than FOCUS_MAX_MIN.
 */

export const FOCUS_MAX_MIN = 180;
/** A "for this set" focus still needs an end the phone knows about. */
export const SET_FOCUS_CAP_MIN = 60;
export const FOCUS_CHOICES = [15, 30, 45, 60] as const;
const MIN_MS = 60_000;

export type FocusChoice = 'set' | (typeof FOCUS_CHOICES)[number];

export function focusActive(f: Focus | null, now: number): boolean {
  return !!f && f.startedAt <= now && now < f.until;
}

/** Start a focus now. A focus already running is extended, never shortened. */
export function startFocus(rules: ScreenTimeRules, current: Focus | null, choice: FocusChoice, now: number): Focus {
  const minutes = choice === 'set' ? SET_FOCUS_CAP_MIN : Math.max(1, Math.min(FOCUS_MAX_MIN, Math.round(choice)));
  const next: Focus = {
    kind: choice === 'set' ? 'set' : 'timed',
    startedAt: now,
    until: now + minutes * MIN_MS,
    strict: effectiveStrictness(rules, now) === 'strict',
  };
  if (!current || !focusActive(current, now)) return next;
  // Running already: keep the later end, the stricter setting, and a timed focus stays timed.
  return {
    kind: current.kind === 'timed' || next.kind === 'timed' ? 'timed' : 'set',
    startedAt: current.startedAt,
    until: Math.max(current.until, next.until),
    strict: current.strict || next.strict,
  };
}

export type EndReason = 'completed' | 'abandoned' | 'manual';

export type EndResult =
  | { ended: true; focus: null; record: FocusRecord }
  | { ended: false; focus: Focus | null; why: 'strict' | 'timed' | 'none' };

/**
 * End a focus. Finishing the set ends a "set" focus. Backing out ends it
 * unless Strict. A timed focus runs to its end unless ended by hand outside
 * Strict.
 */
export function endFocus(f: Focus | null, reason: EndReason, now: number): EndResult {
  if (!f) return { ended: false, focus: null, why: 'none' };
  if (!focusActive(f, now)) return { ended: true, focus: null, record: { from: f.startedAt, to: Math.min(now, f.until), outcome: 'expired' } };
  const record = (outcome: FocusRecord['outcome']): EndResult => ({ ended: true, focus: null, record: { from: f.startedAt, to: now, outcome } });
  if (reason === 'completed') return f.kind === 'set' ? record('completed') : { ended: false, focus: f, why: 'timed' };
  if (f.strict) return { ended: false, focus: f, why: 'strict' };
  return record(reason === 'abandoned' ? 'abandoned' : 'ended');
}

/** A focus whose time is up becomes a history record. */
export function settleFocus(f: Focus | null, now: number): { focus: Focus | null; record: FocusRecord | null } {
  if (!f || now < f.until) return { focus: f, record: null };
  return { focus: null, record: { from: f.startedAt, to: f.until, outcome: 'expired' } };
}

/** Record a finished focus in the log of the day it ended. */
export function logFocus(zone: Zone, log: DayLog, rec: FocusRecord, now: number): DayLog {
  const day = rollDay(zone, log, now);
  const focuses = day.focuses ?? [];
  if (focuses.some((x) => x.from === rec.from)) return day;
  return { ...day, focuses: [...focuses, rec] };
}

/** Minutes a record held. */
export const focusMinutes = (r: FocusRecord) => Math.max(0, Math.round((r.to - r.from) / MIN_MS));
