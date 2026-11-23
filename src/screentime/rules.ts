import { EXERCISE_IDS } from '@/engine/exercises';
import type { Exercise } from '@/engine/types';
import { activeOccurrence, addDays, lockLengthMin, nextMidnight, occurrences, parseHHMM, type Zone } from './time';
import type { AppLimit, EarningRules, LockTime, PauseRules, Rate, RulesCore, ScreenTimeRules, Selection, Strictness } from './types';

/**
 * Apple monitors at most 20 schedules per app. Lock times use 2 each (start and end);
 * the day, daily limit, earned time, unlocks and workout focus use one each: 5 + 7 × 2 = 19.
 */
export const MAX_LOCK_TIMES = 7;
/** Apple's shortest schedule. */
export const MIN_LOCK_MIN = 15;
/** Apple shields at most 50 individual apps at once (categories cover more): the iPhone pickers refuse more. */
export const MAX_APPS = 50;
/** What a stored list keeps at most (Android has no 50-app limit, so this is only a sanity bound). */
const MAX_STORED_APPS = 1000;
export const MAX_DAILY_CAP_MIN = 240;
/** Strict: a loosening change waits this long. */
export const STRICT_WAIT_MS = 24 * 60 * 60 * 1000;
/** Strict: turning it off early costs this many verified push-ups (or the 24 h wait). */
export const STRICT_OFF_PUSHUPS = 100;
export const DEFAULT_STRICT_DAYS = 7;
/**
 * Per-app limits. On iPhone each one adds threshold events to the daily-limit schedule (not a
 * schedule of its own, so the 20-schedule budget above is unchanged); three keeps that small.
 */
export const MAX_APP_LIMITS = 3;
export const PAUSE_CHOICES = [5, 10, 20, 30] as const;
/** Each pass taken through the pause screen adds this much to the next wait, up to PAUSE_MAX_S. */
export const PAUSE_STEP_S = 5;
export const PAUSE_MAX_S = 60;
/** How long the app stays open after a pause. */
export const PAUSE_PASS_MIN = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

export const EMPTY_SELECTION: Selection = { apps: [], categories: [], domains: [] };

export const DEFAULT_RATES: Record<Exercise, Rate> = {
  pushup: { perCleanRep: 1, perFlaggedRep: 0.5 },
  crunch: { perCleanRep: 0.5, perFlaggedRep: 0.25 },
  plank: { per10s: 2 },
  sidePlank: { per10s: 2 },
};

export const DEFAULT_RULES: ScreenTimeRules = {
  version: 1,
  blocked: EMPTY_SELECTION,
  allowed: EMPTY_SELECTION,
  dailyLimitMin: 60,
  lockTimes: [],
  earning: { enabled: true, rates: DEFAULT_RATES, dailyCapMin: 120 },
  strictness: 'standard',
  appLimits: [],
  pause: { enabled: false, seconds: 10 },
  silenceNotifications: false,
  strictUntil: null,
  pending: null,
};

/** The wait before a paused app opens, after `passesToday` passes. */
export function pauseSeconds(p: PauseRules, passesToday: number): number {
  return Math.min(PAUSE_MAX_S, p.seconds + PAUSE_STEP_S * Math.max(0, passesToday));
}

/** Ready-made lock times offered when adding one. */
export const LOCK_PRESETS: Omit<LockTime, 'id'>[] = [
  {
    name: 'Sleep',
    days: [0, 1, 2, 3, 4, 5, 6],
    start: '22:00',
    end: '07:00',
    apps: 'main',
    earnable: false,
    enabled: true,
    skipDate: null,
  },
  { name: 'Work', days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00', apps: 'main', earnable: false, enabled: true, skipDate: null },
  {
    name: 'Morning',
    days: [0, 1, 2, 3, 4, 5, 6],
    start: '06:00',
    end: '09:00',
    apps: 'main',
    earnable: false,
    enabled: true,
    skipDate: null,
  },
  { name: 'Study', days: [1, 2, 3, 4, 5], start: '18:00', end: '20:00', apps: 'main', earnable: true, enabled: true, skipDate: null },
];

// ─── Loading ────────────────────────────────────────────────────────────────

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && x.length > 0))] : [];
const num = (v: unknown, lo: number, hi: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null;

function selection(v: unknown): Selection {
  const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  return { apps: strings(o.apps).slice(0, MAX_STORED_APPS), categories: strings(o.categories), domains: strings(o.domains) };
}

function lockTime(v: unknown): LockTime | null {
  const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  if (!o || typeof o.id !== 'string' || !o.id) return null;
  const days = Array.isArray(o.days) ? [...new Set(o.days.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : [];
  const lock: LockTime = {
    id: o.id,
    name: typeof o.name === 'string' && o.name.trim() ? o.name.trim().slice(0, 40) : 'Lock time',
    days,
    start: typeof o.start === 'string' ? o.start : '',
    end: typeof o.end === 'string' ? o.end : '',
    apps: o.apps === 'main' || o.apps === undefined ? 'main' : o.apps === 'all' ? 'all' : selection(o.apps),
    earnable: o.earnable === true,
    enabled: o.enabled !== false,
    skipDate: typeof o.skipDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.skipDate) ? o.skipDate : null,
  };
  return lockProblem(lock) ? null : lock;
}

function appLimit(v: unknown): AppLimit | null {
  const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  if (!o || typeof o.id !== 'string' || !o.id) return null;
  const l: AppLimit = {
    id: o.id,
    name: typeof o.name === 'string' && o.name.trim() ? o.name.trim().slice(0, 40) : 'App limit',
    apps: selection(o.apps),
    dailyMin: num(o.dailyMin, 1, 24 * 60),
    opensPerDay: num(o.opensPerDay, 1, 500),
    enabled: o.enabled !== false,
  };
  return appLimitProblem(l) ? null : l;
}

function pause(v: unknown): PauseRules {
  const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  return { enabled: o.enabled === true, seconds: num(o.seconds, 1, PAUSE_MAX_S) ?? DEFAULT_RULES.pause.seconds };
}

function earning(v: unknown): EarningRules {
  const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  const r = o.rates && typeof o.rates === 'object' ? (o.rates as Record<string, unknown>) : {};
  const rates = {} as Record<Exercise, Rate>;
  for (const e of EXERCISE_IDS) {
    const x = r[e] && typeof r[e] === 'object' ? (r[e] as Record<string, unknown>) : {};
    const d = DEFAULT_RATES[e];
    rates[e] =
      d.per10s !== undefined
        ? { per10s: num(x.per10s, 0, 10) ?? d.per10s }
        : { perCleanRep: num(x.perCleanRep, 0, 10) ?? d.perCleanRep, perFlaggedRep: num(x.perFlaggedRep, 0, 10) ?? d.perFlaggedRep };
  }
  return {
    enabled: o.enabled !== false,
    rates,
    dailyCapMin: num(o.dailyCapMin, 0, MAX_DAILY_CAP_MIN) ?? DEFAULT_RULES.earning.dailyCapMin,
  };
}

function core(o: Record<string, unknown>): RulesCore {
  const limit = o.dailyLimitMin === null ? null : num(o.dailyLimitMin, 0, 24 * 60);
  return {
    blocked: selection(o.blocked),
    allowed: selection(o.allowed),
    dailyLimitMin: o.dailyLimitMin === null ? null : (limit ?? DEFAULT_RULES.dailyLimitMin),
    lockTimes: (Array.isArray(o.lockTimes) ? o.lockTimes.map(lockTime).filter((l): l is LockTime => l !== null) : []).slice(
      0,
      MAX_LOCK_TIMES,
    ),
    earning: earning(o.earning),
    strictness: o.strictness === 'nudge' || o.strictness === 'strict' ? o.strictness : 'standard',
    appLimits: (Array.isArray(o.appLimits) ? o.appLimits.map(appLimit).filter((l): l is AppLimit => l !== null) : []).slice(0, MAX_APP_LIMITS),
    pause: pause(o.pause),
    silenceNotifications: o.silenceNotifications === true,
  };
}

/**
 * Rules from storage. Anything missing, unknown or broken falls back to a safe
 * default, so a bad file can never crash the app or switch protection off by
 * accident. Unknown strictness reads as Standard, never Nudge.
 */
export function normalizeRules(raw: unknown): ScreenTimeRules {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const c = core(o);
  const p = o.pending && typeof o.pending === 'object' ? (o.pending as Record<string, unknown>) : null;
  const pending =
    p && typeof p.effectiveAt === 'number' && Number.isFinite(p.effectiveAt) && p.next && typeof p.next === 'object'
      ? { effectiveAt: p.effectiveAt, next: core(p.next as Record<string, unknown>) }
      : null;
  return {
    version: 1,
    ...c,
    strictUntil: c.strictness === 'strict' ? (num(o.strictUntil, 0, Number.MAX_SAFE_INTEGER) ?? null) : null,
    pending,
  };
}

// ─── Validation ─────────────────────────────────────────────────────────────

export type AppLimitProblem = 'no-apps' | 'no-limit';

/** Why a per-app limit can't be saved, or null if it can. */
export function appLimitProblem(l: Pick<AppLimit, 'apps' | 'dailyMin' | 'opensPerDay'>): AppLimitProblem | null {
  if (!l.apps.apps.length && !l.apps.categories.length && !l.apps.domains.length) return 'no-apps';
  if (l.dailyMin === null && l.opensPerDay === null) return 'no-limit';
  return null;
}

export type LockProblem = 'no-days' | 'bad-time' | 'too-short';

/** Why a lock time can't be saved, or null if it can. */
export function lockProblem(l: Pick<LockTime, 'days' | 'start' | 'end'>): LockProblem | null {
  if (parseHHMM(l.start) === null || parseHHMM(l.end) === null || l.start === l.end) return 'bad-time';
  if (l.days.length === 0) return 'no-days';
  const len = lockLengthMin(l);
  return len === null ? 'bad-time' : len < MIN_LOCK_MIN ? 'too-short' : null;
}

/** "Every night 22:00–07:00", "Mon–Fri 09:00–17:00", for lists and summaries. */
export function describeLock(l: LockTime): string {
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const days = [...l.days].sort();
  const set = days.join();
  const when =
    set === '0,1,2,3,4,5,6'
      ? (parseHHMM(l.end) ?? 0) < (parseHHMM(l.start) ?? 0)
        ? 'Every night'
        : 'Every day'
      : set === '1,2,3,4,5'
        ? 'Mon–Fri'
        : set === '0,6'
          ? 'Weekends'
          : days.map((d) => names[d]).join(', ');
  return `${when} ${l.start}–${l.end}`;
}

// ─── Strictness ─────────────────────────────────────────────────────────────

/** Strict and still inside its lock period (afterwards it behaves as Standard). */
export function strictActive(r: ScreenTimeRules, now: number): boolean {
  return r.strictness === 'strict' && r.strictUntil !== null && now < r.strictUntil;
}

/** The strictness rules that apply now. */
export function effectiveStrictness(r: ScreenTimeRules, now: number): Strictness {
  if (r.strictness === 'strict') return strictActive(r, now) ? 'strict' : 'standard';
  return r.strictness;
}

/** Start Strict for a number of days (only ever tightens). */
export function startStrict(r: ScreenTimeRules, now: number, days: number): ScreenTimeRules {
  const until = now + Math.max(1, Math.min(30, Math.round(days))) * DAY_MS;
  return { ...r, strictness: 'strict', strictUntil: Math.max(until, strictActive(r, now) ? r.strictUntil! : 0), pending: null };
}

// ─── Changes ────────────────────────────────────────────────────────────────

/** Minutes of the week (0 … 10079, Sunday 00:00 = 0) a lock time covers, for comparing two versions. */
/** Minutes of the week one lock time covers, whatever apps it blocks. */
function ownCoverage(l: LockTime): Set<number> {
  const out = new Set<number>();
  const s = parseHHMM(l.start);
  const len = lockLengthMin(l);
  if (!l.enabled || s === null || len === null) return out;
  for (const d of l.days) for (let k = 0; k < len; k++) out.add((d * 1440 + s + k) % 10080);
  return out;
}

function weekCoverage(locks: LockTime[], earnableToo: boolean, scope: 'main' | 'all' = 'main'): Set<number> {
  const out = new Set<number>();
  for (const l of locks) {
    if (!l.enabled || (l.earnable && !earnableToo)) continue;
    // "main": lock times that block the main list ("Everything" blocks it too); "all": only "Everything".
    if (scope === 'main' ? l.apps !== 'main' && l.apps !== 'all' : l.apps !== 'all') continue;
    const s = parseHHMM(l.start);
    const len = lockLengthMin(l);
    if (s === null || len === null) continue;
    for (const d of l.days) for (let k = 0; k < len; k++) out.add((d * 1440 + s + k) % 10080);
  }
  return out;
}

const subset = <T>(a: Iterable<T>, b: Set<T>) => [...a].every((x) => b.has(x));
const asSet = (s: Selection) =>
  new Set([...s.apps.map((x) => `a:${x}`), ...s.categories.map((x) => `c:${x}`), ...s.domains.map((x) => `d:${x}`)]);

/**
 * Does the change make any rule less strict? Mixed changes count as loosening.
 * Lock times are compared by the minutes they lock (truly locked, and locked
 * at all), so editing a window to cover more is tightening and anything that
 * gives back a minute is loosening.
 */
export function loosens(prev: RulesCore, next: RulesCore): boolean {
  if (!subset(asSet(prev.blocked), asSet(next.blocked))) return true;
  if (!subset(asSet(next.allowed), asSet(prev.allowed))) return true;
  if (prev.dailyLimitMin !== null && (next.dailyLimitMin === null || next.dailyLimitMin > prev.dailyLimitMin)) return true;
  // Minutes the main apps are locked, and minutes everything is locked, compared separately: moving a
  // lock time onto another list (or off "Everything") gives those minutes back even if the total stays.
  for (const scope of ['main', 'all'] as const) {
    if (!subset(weekCoverage(prev.lockTimes, false, scope), weekCoverage(next.lockTimes, false, scope))) return true;
    if (!subset(weekCoverage(prev.lockTimes, true, scope), weekCoverage(next.lockTimes, true, scope))) return true;
  }
  // A newly skipped occurrence gives back one night (or day) even though the weekly pattern is the same.
  for (const n of next.lockTimes) {
    if (n.skipDate === null) continue;
    const p = prev.lockTimes.find((x) => x.id === n.id);
    if (!p || p.skipDate !== n.skipDate) return true;
  }
  // Own-app lock times: compared one by one (their selections can't be merged with the main list).
  for (const p of prev.lockTimes) {
    if (p.apps === 'main' || !p.enabled) continue;
    const n = next.lockTimes.find((x) => x.id === p.id);
    if (p.apps === 'all') {
      // "Everything" narrowed back to the blocked list (or removed) gives apps back.
      if (!n || n.apps !== 'all') return true;
    } else if (!n || n.apps === 'main' || n.apps === 'all' || !subset(asSet(p.apps), asSet(n.apps))) {
      return true;
    }
    // Same minutes or more, and not newly opened by earned time.
    if (!subset(ownCoverage(p), ownCoverage(n))) return true;
    if (n.earnable && !p.earnable) return true;
  }
  // Per-app limits: each one must still be there, cover at least the same apps, and be no longer.
  for (const p of prev.appLimits) {
    if (!p.enabled) continue;
    const n = next.appLimits.find((x) => x.id === p.id);
    if (!n || !n.enabled || !subset(asSet(p.apps), asSet(n.apps))) return true;
    if (p.dailyMin !== null && (n.dailyMin === null || n.dailyMin > p.dailyMin)) return true;
    if (p.opensPerDay !== null && (n.opensPerDay === null || n.opensPerDay > p.opensPerDay)) return true;
  }
  if (prev.pause.enabled && (!next.pause.enabled || next.pause.seconds < prev.pause.seconds)) return true;
  if (prev.silenceNotifications && !next.silenceNotifications) return true;
  const order: Strictness[] = ['nudge', 'standard', 'strict'];
  if (order.indexOf(next.strictness) < order.indexOf(prev.strictness)) return true;
  if (next.earning.enabled && !prev.earning.enabled) return true;
  if (next.earning.dailyCapMin > prev.earning.dailyCapMin) return true;
  for (const e of EXERCISE_IDS) {
    const a = prev.earning.rates[e];
    const b = next.earning.rates[e];
    if ((b.perCleanRep ?? 0) > (a.perCleanRep ?? 0) || (b.perFlaggedRep ?? 0) > (a.perFlaggedRep ?? 0) || (b.per10s ?? 0) > (a.per10s ?? 0))
      return true;
  }
  return false;
}

export type ChangeResult =
  | { result: 'applied'; rules: ScreenTimeRules; cancelledPending: boolean }
  | { result: 'scheduled'; rules: ScreenTimeRules; effectiveAt: number }
  | { result: 'refused'; rules: ScreenTimeRules; reason: RefusalReason };

export type RefusalReason = 'strict-running-lock' | 'strict-remove-apps' | 'strict-off-early' | 'invalid';

/** The core fields of full rules. */
export function coreOf(r: ScreenTimeRules): RulesCore {
  return {
    blocked: r.blocked,
    allowed: r.allowed,
    dailyLimitMin: r.dailyLimitMin,
    lockTimes: r.lockTimes,
    earning: r.earning,
    strictness: r.strictness,
    appLimits: r.appLimits,
    pause: r.pause,
    silenceNotifications: r.silenceNotifications,
  };
}

/** Lock times running now whose locked minutes the change would reduce. */
function touchesRunningLock(zone: Zone, prev: RulesCore, next: RulesCore, now: number): boolean {
  for (const p of prev.lockTimes) {
    const occ = activeOccurrence(zone, p, now);
    if (!occ) continue;
    const n = next.lockTimes.find((x) => x.id === p.id);
    if (!n) return true;
    const still = activeOccurrence(zone, n, now);
    if (!still || still.end < occ.end || (n.earnable && !p.earnable)) return true;
    if (p.apps === 'all' && n.apps !== 'all') return true;
    if (p.apps === 'main' && n.apps !== 'main' && n.apps !== 'all') return true;
    if (p.apps !== 'main' && p.apps !== 'all' && (n.apps === 'main' || n.apps === 'all' || !subset(asSet(p.apps), asSet(n.apps)))) return true;
  }
  return false;
}

/**
 * Ask for a change (plan §2, §3):
 * - Tightening always applies at once (and cancels a waiting loosening, which
 *   could otherwise undo it).
 * - Nudge: everything applies at once.
 * - Standard (and Strict after its period): loosening waits until midnight.
 * - Strict, inside its period: blocked apps can't be removed, a running lock
 *   time can't be shortened, skipped or switched off, Strict can't be turned
 *   off early (see `endStrictEarly`), and other loosening waits 24 hours.
 */
export function requestChange(zone: Zone, r: ScreenTimeRules, nextIn: RulesCore, now: number): ChangeResult {
  const next: RulesCore = core(nextIn as unknown as Record<string, unknown>);
  if (
    nextIn.lockTimes.some((l) => lockProblem(l) !== null) ||
    nextIn.lockTimes.length > MAX_LOCK_TIMES ||
    (nextIn.appLimits ?? []).some((l) => appLimitProblem(l) !== null) ||
    (nextIn.appLimits ?? []).length > MAX_APP_LIMITS
  ) {
    return { result: 'refused', rules: r, reason: 'invalid' };
  }
  const prev = coreOf(r);
  if (!loosens(prev, next)) {
    // Switching to Strict without a period (see startStrict) gets the default week. A Strict period
    // that has run out stays over: carrying "strict" along with some other change doesn't restart it.
    const expired = next.strictness === 'strict' && r.strictness === 'strict' && !strictActive(r, now);
    const applied = expired ? { ...next, strictness: 'standard' as const } : next;
    const strictUntil = applied.strictness !== 'strict' ? null : strictActive(r, now) ? r.strictUntil : now + DEFAULT_STRICT_DAYS * DAY_MS;
    return { result: 'applied', rules: { ...r, ...applied, strictUntil, pending: null }, cancelledPending: r.pending !== null };
  }
  const mode = effectiveStrictness(r, now);
  if (mode === 'nudge') return { result: 'applied', rules: { ...r, ...next, strictUntil: null, pending: null }, cancelledPending: false };
  if (mode === 'strict') {
    if (next.strictness !== 'strict') return { result: 'refused', rules: r, reason: 'strict-off-early' };
    if (!subset(asSet(prev.blocked), asSet(next.blocked))) return { result: 'refused', rules: r, reason: 'strict-remove-apps' };
    if (touchesRunningLock(zone, prev, next, now)) return { result: 'refused', rules: r, reason: 'strict-running-lock' };
    const effectiveAt = now + STRICT_WAIT_MS;
    return { result: 'scheduled', rules: { ...r, pending: { effectiveAt, next } }, effectiveAt };
  }
  const effectiveAt = nextMidnight(zone, now);
  return { result: 'scheduled', rules: { ...r, pending: { effectiveAt, next } }, effectiveAt };
}

/** Apply a waiting change once its time has come (call on every app open and at midnight). */
export function applyPending(r: ScreenTimeRules, now: number): ScreenTimeRules {
  if (!r.pending || now < r.pending.effectiveAt) return r;
  const next = r.pending.next;
  return { ...r, ...next, strictUntil: next.strictness === 'strict' ? r.strictUntil : null, pending: null };
}

/** Cancel a waiting change (always allowed: it only keeps things stricter). */
export function cancelPending(r: ScreenTimeRules): ScreenTimeRules {
  return { ...r, pending: null };
}

/**
 * Turn Strict off before its period ends: allowed after `STRICT_OFF_PUSHUPS`
 * verified push-ups done since asking, or schedules it 24 hours out.
 */
export function endStrictEarly(r: ScreenTimeRules, now: number, verifiedPushupsSinceAsking: number): ChangeResult {
  if (!strictActive(r, now))
    return { result: 'applied', rules: { ...r, strictness: 'standard', strictUntil: null }, cancelledPending: false };
  if (verifiedPushupsSinceAsking >= STRICT_OFF_PUSHUPS) {
    return {
      result: 'applied',
      rules: { ...r, strictness: 'standard', strictUntil: null, pending: null },
      cancelledPending: r.pending !== null,
    };
  }
  const effectiveAt = now + STRICT_WAIT_MS;
  return { result: 'scheduled', rules: { ...r, pending: { effectiveAt, next: { ...coreOf(r), strictness: 'standard' } } }, effectiveAt };
}

/** Skip the next (or running) occurrence of a lock time: loosening, so it follows `requestChange`. */
export function skipNext(zone: Zone, r: ScreenTimeRules, lockId: string, now: number): ChangeResult {
  const lock = r.lockTimes.find((l) => l.id === lockId);
  if (!lock) return { result: 'refused', rules: r, reason: 'invalid' };
  const occ = activeOccurrence(zone, lock, now) ?? occurrences(zone, lock, now, 7).find((o) => o.start > now);
  if (!occ) return { result: 'refused', rules: r, reason: 'invalid' };
  const next = { ...coreOf(r), lockTimes: r.lockTimes.map((l) => (l.id === lockId ? { ...l, skipDate: occ.day } : l)) };
  return requestChange(zone, r, next, now);
}

/** Today's date key, for clearing skips that are in the past. */
export function clearOldSkips(zone: Zone, r: ScreenTimeRules, now: number): ScreenTimeRules {
  const l = zone.local(now);
  const yesterday = addDays(l.y, l.m, l.d, -1);
  const oldest = `${yesterday.y}-${String(yesterday.m).padStart(2, '0')}-${String(yesterday.d).padStart(2, '0')}`;
  const lockTimes = r.lockTimes.map((x) => (x.skipDate !== null && x.skipDate < oldest ? { ...x, skipDate: null } : x));
  return lockTimes.some((x, i) => x !== r.lockTimes[i]) ? { ...r, lockTimes } : r;
}
