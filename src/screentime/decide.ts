import { effectiveStrictness, strictActive } from './rules';
import { dayKey, nextMidnight, occurrences, type Zone } from './time';
import type { Decision, DayLog, Focus, LockTime, ScreenTimeRules, Selection, Unlock } from './types';

/** Standard: one emergency unlock a day, this long. */
export const EMERGENCY_MIN = 10;
export const EMERGENCIES_PER_DAY = 1;
/** Nudge: "1 more minute", this many times a day. */
export const ONE_MORE_PER_DAY = 3;
export const ONE_MORE_MIN = 1;

const MIN_MS = 60_000;

export function freshDay(zone: Zone, now: number): DayLog {
  return { day: dayKey(zone.local(now)), usedMin: 0, earnedMin: 0, earnedUsedMin: 0, grants: [], unlocks: [] };
}

/**
 * Today's log. A new day starts fresh (the daily limit resets, earned time
 * expires). If the clock goes backwards to an earlier date, the log is kept:
 * moving the clock never hands out a fresh allowance by going back and forth.
 */
export function rollDay(zone: Zone, log: DayLog | null, now: number): DayLog {
  const today = dayKey(zone.local(now));
  if (!log || today > log.day) return freshDay(zone, now);
  return log;
}

/** The platform reports minutes the blocked apps were open (counts against the limit, or earned time). */
export function addUsage(log: DayLog, minutes: number, fromEarned: boolean): DayLog {
  const m = Math.max(0, minutes);
  if (!fromEarned) return { ...log, usedMin: log.usedMin + m };
  return { ...log, earnedUsedMin: Math.min(log.earnedMin, log.earnedUsedMin + m) };
}

const earnedLeft = (log: DayLog) => Math.max(0, log.earnedMin - log.earnedUsedMin);

interface ActiveLock {
  lock: LockTime;
  end: number;
}

function activeLocks(zone: Zone, rules: ScreenTimeRules, now: number): ActiveLock[] {
  const out: ActiveLock[] = [];
  for (const lock of rules.lockTimes) {
    for (const o of occurrences(zone, lock, now, 0)) if (o.start <= now && now < o.end) out.push({ lock, end: o.end });
  }
  return out;
}

/**
 * What should happen right now (plan §5). Pure: the platform applies it and calls again at `nextChange`.
 * A running workout focus blocks the main apps whatever else applies; earned time doesn't open them
 * during it, but the strictness level's unlock still does (the safety valve).
 */
export function decide(zone: Zone, rules: ScreenTimeRules, logIn: DayLog, now: number, focusIn: Focus | null = null): Decision {
  const focus = focusIn && focusIn.startedAt <= now && now < focusIn.until ? focusIn : null;
  const log = rollDay(zone, logIn, now);
  const mode = effectiveStrictness(rules, now);
  const left = rules.earning.enabled ? earnedLeft(log) : 0;
  const unlock = log.unlocks.find((u) => u.from <= now && now < u.until) ?? null;

  const locks = activeLocks(zone, rules, now);
  // "Everything" lock times block the main apps too (and more): they decide like main ones.
  const main = locks.filter((a) => a.lock.apps === 'main' || a.lock.apps === 'all');
  const own = locks.filter((a) => a.lock.apps !== 'main' && a.lock.apps !== 'all');
  // Locked out entirely by a lock time that doesn't allow earning; earnable ones give way to earned time.
  const hardLock = main.filter((a) => !a.lock.earnable);
  const softLock = main.filter((a) => a.lock.earnable);
  const limitLeft = rules.dailyLimitMin === null ? null : Math.max(0, rules.dailyLimitMin - log.usedMin);

  let reason: Decision['reason'] = null;
  let usingEarned = false;
  if (hardLock.length) reason = 'lock';
  else if (softLock.length) {
    if (left > 0) usingEarned = true;
    else reason = 'lock';
  } else if (limitLeft !== null && limitLeft <= 0) {
    if (left > 0) usingEarned = true;
    else reason = 'limit';
  }
  if (focus) {
    reason = 'focus';
    usingEarned = false;
  }
  if (unlock) {
    reason = null;
    usingEarned = false;
  }
  const blocking = reason === 'lock' ? (hardLock.length ? hardLock : softLock) : [];
  const last = blocking.reduce<ActiveLock | null>((a, b) => (!a || b.end > a.end ? b : a), null);

  const emergenciesUsed = log.unlocks.filter((u) => u.kind === 'emergency').length;
  const oneMoresUsed = log.unlocks.filter((u) => u.kind === 'one-more').length;
  const capLeft = Math.max(0, rules.earning.dailyCapMin - log.earnedMin);
  const canEarn = reason !== null && reason !== 'focus' && rules.earning.enabled && capLeft > 0 && (reason === 'limit' || blocking.every((a) => a.lock.earnable));

  const ownLocks = own
    .filter((a) => !unlock && !(a.lock.earnable && left > 0))
    .map((a) => ({ id: a.lock.id, name: a.lock.name, until: a.end, apps: a.lock.apps as Selection }));

  // Per-app limits: their own apps close once their time or opens are used up. Earned time doesn't
  // open them; an unlock does.
  const limitBlocks: Decision['limitBlocks'] = [];
  if (!unlock) {
    for (const l of rules.appLimits) {
      if (!l.enabled) continue;
      if (l.dailyMin !== null && (log.appUsed?.[l.id] ?? 0) >= l.dailyMin) limitBlocks.push({ id: l.id, name: l.name, apps: l.apps, why: 'time' });
      else if (l.opensPerDay !== null && (log.appOpens?.[l.id] ?? 0) >= l.opensPerDay)
        limitBlocks.push({ id: l.id, name: l.name, apps: l.apps, why: 'opens' });
    }
  }
  const blockAll = reason === 'focus' ? focus?.blockAll === true : reason === 'lock' && blocking.some((a) => a.lock.apps === 'all');

  // Next moment the answer may change on its own.
  const candidates = [nextMidnight(zone, now)];
  if (unlock) candidates.push(unlock.until);
  if (focus) candidates.push(focus.until);
  for (const lock of rules.lockTimes)
    for (const o of occurrences(zone, lock, now, 1)) for (const t of [o.start, o.end]) if (t > now) candidates.push(t);
  if (strictActive(rules, now)) candidates.push(rules.strictUntil!);
  if (rules.pending && rules.pending.effectiveAt > now) candidates.push(rules.pending.effectiveAt);

  const blockedAny = reason !== null || ownLocks.length > 0 || limitBlocks.length > 0;
  return {
    blocked: reason !== null,
    reason,
    lock: last ? { id: last.lock.id, name: last.lock.name, until: last.end } : null,
    usingEarned,
    earnedLeftMin: left,
    limitLeftMin: limitLeft,
    unlockedUntil: unlock ? unlock.until : null,
    canEarn,
    emergency: {
      available: blockedAny && mode === 'standard' && emergenciesUsed < EMERGENCIES_PER_DAY,
      minutes: EMERGENCY_MIN,
    },
    oneMore: {
      available: blockedAny && mode === 'nudge' && oneMoresUsed < ONE_MORE_PER_DAY,
      left: Math.max(0, ONE_MORE_PER_DAY - oneMoresUsed),
    },
    ownLocks,
    focus: focus ? { kind: focus.kind, until: focus.until, strict: focus.strict } : null,
    blockAll,
    limitBlocks,
    nextChange: Math.min(...candidates),
  };
}

export type UnlockResult =
  { ok: true; log: DayLog; until: number } | { ok: false; log: DayLog; reason: 'not-blocked' | 'not-allowed' | 'used-up' };

/** Use the strictness level's way out: "1 more minute" (Nudge) or the daily emergency unlock (Standard). */
export function takeUnlock(
  zone: Zone,
  rules: ScreenTimeRules,
  logIn: DayLog,
  kind: Unlock['kind'],
  now: number,
  focus: Focus | null = null,
): UnlockResult {
  const log = rollDay(zone, logIn, now);
  const d = decide(zone, rules, log, now, focus);
  if (!d.blocked && d.ownLocks.length === 0 && d.limitBlocks.length === 0) return { ok: false, log, reason: 'not-blocked' };
  const option = kind === 'emergency' ? d.emergency : d.oneMore;
  const mode = effectiveStrictness(rules, now);
  if ((kind === 'emergency' && mode !== 'standard') || (kind === 'one-more' && mode !== 'nudge'))
    return { ok: false, log, reason: 'not-allowed' };
  if (!option.available) return { ok: false, log, reason: 'used-up' };
  const until = now + (kind === 'emergency' ? EMERGENCY_MIN : ONE_MORE_MIN) * MIN_MS;
  return { ok: true, log: { ...log, unlocks: [...log.unlocks, { kind, from: now, until }] }, until };
}
