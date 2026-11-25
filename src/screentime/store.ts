import Storage from 'expo-sqlite/kv-store';
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { SessionSummary } from '@/engine/session';
import { ScreenTime } from '../../modules/screen-time/src';
import { decide, rollDay, takeUnlock as takeUnlockRule } from './decide';
import { earnFromSet, type EarnResult } from './earn';
import { endFocus, KEY_LOCK_MAX_MIN, logFocus, settleFocus, startFocus, startKeyLock, type EndReason, type EndResult, type FocusChoice } from './focus';
import { mergeGaps, mergeReport, parseReport, toNativePlan } from './plan';
import { applyPending, clearOldSkips, normalizeRules, DEFAULT_RULES } from './rules';
import { deviceZone } from './time';
import type { DayLog, Decision, Focus, FocusRecord, ScreenTimeRules, Unlock } from './types';

/**
 * Screen time state on the phone: the rules, and a log per day (today plus
 * the last two weeks, for history). Everything stays on the device.
 *
 * `syncScreenTime()` is the one place the app talks to the native blocking:
 * it takes in what happened while the app was closed, applies any change that
 * has come due, saves, and hands the native side a fresh plan. Call it on app
 * open, on return to the foreground, after a rule change and after a set.
 */

const RULES_KEY = 'screentime.rules.v1';
const DAYS_KEY = 'screentime.days.v1';
const META_KEY = 'screentime.meta.v1';
const FOCUS_KEY = 'screentime.focus.v1';
export const HISTORY_DAYS = 14;

export type Availability =
  /** No native support in this build (Expo Go, web, an iPhone build without SCREEN_TIME=1, iOS < 17.4). */
  | 'unsupported'
  /** Supported but the user hasn't given access yet (or took it away). */
  | 'needs-permission'
  | 'ready';

export interface Meta {
  /** The user has finished setup at least once. */
  setUp: boolean;
  /** Screen Time access was approved once and is now gone: protection was switched off outside Trueline. */
  permissionLost: boolean;
  /** Last time the native side was given a plan (ms). */
  lastSync: number | null;
  /** When access was first found missing (the start of a protection gap). */
  lostSince: number | null;
  /** iOS: the system expired the stored app lists; they must be picked again. */
  tokensExpired: boolean;
  /** Workout focus on the exercise screen: off (null), for the set, or a number of minutes. */
  focusChoice: FocusChoice | null;
  /** A workout focus blocks every app except the always-allowed ones, not just the blocked list. */
  focusBlockAll: boolean;
  /** The QR key that ends a key lock (its secret is what the code holds). */
  key: { secret: string; createdAt: number } | null;
}

const DEFAULT_META: Meta = {
  setUp: false,
  permissionLost: false,
  lastSync: null,
  lostSince: null,
  tokensExpired: false,
  focusChoice: null,
  focusBlockAll: false,
  key: null,
};

function read<T>(key: string, parse: (raw: unknown) => T, fallback: T): T {
  try {
    const raw = Storage.getItemSync(key);
    return raw ? parse(JSON.parse(raw)) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    Storage.setItemSync(key, JSON.stringify(value));
  } catch {
    // Non-fatal: the next sync writes again.
  }
}

function isLog(x: unknown): x is DayLog {
  const o = x as DayLog;
  return !!o && typeof o.day === 'string' && Array.isArray(o.grants) && Array.isArray(o.unlocks) && typeof o.usedMin === 'number';
}

export function loadRules(): ScreenTimeRules {
  return read(RULES_KEY, normalizeRules, DEFAULT_RULES);
}

/** Saved days, newest first. */
export function loadDays(): DayLog[] {
  return read(DAYS_KEY, (raw) => (Array.isArray(raw) ? raw.filter(isLog) : []), []);
}

export function loadMeta(): Meta {
  return read(META_KEY, (raw) => ({ ...DEFAULT_META, ...(raw as Partial<Meta>) }), DEFAULT_META);
}

function parseFocus(raw: unknown): Focus | null {
  const o = raw as Focus | null;
  if (!o || (o.kind !== 'set' && o.kind !== 'timed' && o.kind !== 'key') || typeof o.startedAt !== 'number' || typeof o.until !== 'number') return null;
  // Never trust a stored focus longer than its hard cap (a key lock may run longer than a workout).
  const cap = o.kind === 'key' ? KEY_LOCK_MAX_MIN * 60_000 : 3 * 60 * 60_000;
  if (o.until - o.startedAt > cap || o.until <= o.startedAt) return null;
  return { kind: o.kind, startedAt: o.startedAt, until: o.until, strict: o.strict === true, blockAll: o.blockAll === true };
}

export function loadFocus(): Focus | null {
  return read(FOCUS_KEY, parseFocus, null);
}

/** Replace today's log in the history, keeping two weeks. */
export function withToday(days: DayLog[], today: DayLog): DayLog[] {
  return [today, ...days.filter((d) => d.day !== today.day)].sort((a, b) => (a.day < b.day ? 1 : -1)).slice(0, HISTORY_DAYS);
}

export function availability(): Availability {
  if (!ScreenTime || !ScreenTime.isSupported()) return 'unsupported';
  return ScreenTime.authorizationStatus() === 'approved' ? 'ready' : 'needs-permission';
}

export interface ScreenTimeState {
  rules: ScreenTimeRules;
  today: DayLog;
  days: DayLog[];
  meta: Meta;
  decision: Decision;
  availability: Availability;
  /** Problems the native side reported on the last sync. */
  problems: string[];
  /** The workout focus, if one was started and hasn't been settled yet. */
  focus: Focus | null;
  /** When this state was worked out (screens show times relative to it). */
  now: number;
}

let state: ScreenTimeState | null = null;
const listeners = new Set<(s: ScreenTimeState) => void>();

function build(
  rules: ScreenTimeRules,
  days: DayLog[],
  meta: Meta,
  problems: string[],
  focus: Focus | null,
  now = Date.now(),
): ScreenTimeState {
  const today = rollDay(deviceZone, days[0] ?? null, now);
  return {
    rules,
    today,
    days: withToday(days, today),
    meta,
    focus,
    decision: decide(deviceZone, rules, today, now, focus),
    availability: availability(),
    problems,
    now,
  };
}

export function getScreenTime(): ScreenTimeState {
  return (state ??= build(loadRules(), loadDays(), loadMeta(), [], loadFocus()));
}

function publish(next: ScreenTimeState, persist = true) {
  state = next;
  if (persist) {
    write(RULES_KEY, next.rules);
    write(DAYS_KEY, next.days);
    write(META_KEY, next.meta);
    write(FOCUS_KEY, next.focus);
  }
  listeners.forEach((l) => l(next));
}

export interface SyncResult {
  /** "Earn time" was tapped on the blocked screen: open the earn screen. */
  openEarn: boolean;
  /** "Scan my key" was tapped on the blocked screen: open the scanner. */
  openScan: boolean;
}

/**
 * Take in what the native side saw, bring the rules up to date, save, and send
 * a fresh plan. Safe to call any time; does nothing native where unsupported.
 */
export function syncScreenTime(now = Date.now()): SyncResult {
  const s = getScreenTime();
  let rules = clearOldSkips(deviceZone, applyPending(s.rules, now), now);
  let today = rollDay(deviceZone, s.days[0] ?? null, now);
  const meta = { ...s.meta };
  let openEarn = false;
  let openScan = false;
  let problems: string[] = [];
  // A focus whose time is up goes into history.
  const settled = settleFocus(s.focus, now);
  if (settled.record) today = logFocus(deviceZone, today, settled.record, now);
  const focus = settled.focus;
  const avail = availability();
  if (avail === 'needs-permission' && meta.setUp) {
    meta.permissionLost = true;
    meta.lostSince ??= now;
  }
  if (avail === 'ready' && ScreenTime) {
    meta.permissionLost = false;
    if (meta.lostSince !== null) {
      // Access is back: the time without it is a protection gap.
      today = { ...today, gaps: mergeGaps(today.gaps ?? [], [{ from: meta.lostSince, to: now, kind: 'permission' }]) };
      meta.lostSince = null;
    }
    const report = parseReport(ScreenTime.takeState());
    today = mergeReport(deviceZone, rules, today, report, now);
    openEarn = report?.openEarn === true;
    openScan = report?.openScan === true;
    if (report?.tokensExpired) meta.tokensExpired = true;
    if (meta.setUp) {
      // The phone's report was taken above: save it before sending the plan, so a failed send can't lose it.
      publish(build(normalizeRules(rules), withToday(s.days, today), meta, s.problems, focus, now));
      try {
        problems = ScreenTime.sync(JSON.stringify(toNativePlan(deviceZone, rules, today, now, focus)));
        meta.lastSync = now;
      } catch (e) {
        problems = [`Blocking couldn't be updated: ${e instanceof Error ? e.message : String(e)}`];
      }
    }
  }
  rules = normalizeRules(rules);
  publish(build(rules, withToday(s.days, today), meta, problems, focus, now));
  return { openEarn, openScan };
}

/**
 * Start a workout focus (if screen time is set up). Returns the focus, or
 * null when there's nothing to block with.
 */
export function startFocusNow(choice: FocusChoice, now = Date.now()): Focus | null {
  const s = getScreenTime();
  if (!s.meta.setUp) return null;
  const focus = startFocus(s.rules, s.focus, choice, now, s.meta.focusBlockAll);
  publish({ ...s, focus });
  syncScreenTime(now);
  return focus;
}

/** Lock the apps until the key is scanned (or `hours` at most). Needs a key. */
export function startKeyLockNow(hours: number, blockAll: boolean, now = Date.now()): Focus | null {
  const s = getScreenTime();
  if (!s.meta.setUp || !s.meta.key) return null;
  const focus = startKeyLock(s.focus, hours, now, blockAll);
  publish({ ...s, focus });
  syncScreenTime(now);
  return focus;
}

/** The text a key's QR code holds. */
export const keyText = (secret: string) => `trueline-key:${secret}`;

/** A scanned code: ends the running focus or key lock if it's this phone's key. */
export function scanKey(text: string, now = Date.now()): 'ended' | 'wrong-key' | 'nothing-running' {
  const s = getScreenTime();
  if (!s.meta.key || text.trim() !== keyText(s.meta.key.secret)) return 'wrong-key';
  if (!s.focus || s.focus.until <= now) return 'nothing-running';
  endFocusNow('key', now);
  return 'ended';
}

/** Make a new key (the old one stops working). Refused while a key lock runs: that key is the way out. */
export function newKey(now = Date.now()): boolean {
  const s = getScreenTime();
  if (s.focus?.kind === 'key' && s.focus.until > now) return false;
  const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  const secret = bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
  publish({ ...s, meta: { ...s.meta, key: { secret, createdAt: now } } });
  return true;
}

export function setFocusBlockAll(on: boolean) {
  const s = getScreenTime();
  publish({ ...s, meta: { ...s.meta, focusBlockAll: on } });
}

/**
 * End the focus: the set finished ("completed"), was left ("abandoned"), or the
 * user pressed End ("manual"). Strict and timed focuses may refuse (see focus.ts).
 */
export function endFocusNow(reason: EndReason, now = Date.now()): EndResult {
  const s = getScreenTime();
  const res = endFocus(s.focus, reason, now);
  if (res.ended) {
    publish({ ...s, focus: null, days: withToday(s.days, logFocus(deviceZone, s.today, res.record, now)) });
    syncScreenTime(now);
  }
  return res;
}

export function setFocusChoice(choice: FocusChoice | null) {
  const s = getScreenTime();
  publish({ ...s, meta: { ...s.meta, focusChoice: choice } });
}

/** The user picked the app lists again after iOS expired them. */
export function clearTokensExpired() {
  const s = getScreenTime();
  if (s.meta.tokensExpired) publish({ ...s, meta: { ...s.meta, tokensExpired: false } });
}

/** The last focus that ended today (for the set summary). */
export function lastFocusRecord(): FocusRecord | null {
  const f = getScreenTime().today.focuses ?? [];
  return f.length ? f[f.length - 1] : null;
}

/** Save new rules (already checked with requestChange) and apply them. */
export function saveRules(rules: ScreenTimeRules) {
  const s = getScreenTime();
  publish({ ...s, rules });
  syncScreenTime();
}

export function markSetUp() {
  const s = getScreenTime();
  publish({ ...s, meta: { ...s.meta, setUp: true, permissionLost: false } });
  syncScreenTime();
}

/** Turn Screen Time off completely (only offered when the rules allow it). */
export function turnOff() {
  ScreenTime?.stopAll();
  const s = getScreenTime();
  publish({ ...s, focus: null, meta: { ...s.meta, setUp: false, permissionLost: false, lostSince: null } });
}

/** Credit a finished, verified set. Call once per saved set. */
export function creditSet(summary: SessionSummary, sessionId: string, demo: boolean, now = Date.now()): EarnResult | null {
  const s = getScreenTime();
  if (!s.meta.setUp) return null;
  // Came back after a break: the last day with a set was two or more days ago.
  const today = rollDay(deviceZone, s.days[0] ?? null, now);
  const lastActive = s.days.find((d) => d.day !== today.day && d.grants.length > 0);
  // Calendar days between the two day keys (UTC dates, so clock changes can't shave an hour off).
  const utcDay = (k: string) => Date.UTC(Number(k.slice(0, 4)), Number(k.slice(5, 7)) - 1, Number(k.slice(8, 10)));
  const cameBack = !!lastActive && Math.round((utcDay(today.day) - utcDay(lastActive.day)) / 86_400_000) >= 2;
  const res = earnFromSet(deviceZone, s.rules, s.days[0] ?? today, { summary, sessionId, demo, cameBack }, now);
  if (res.reason === 'earned') {
    publish({ ...s, days: withToday(s.days, res.log) });
    syncScreenTime(now);
  }
  return res;
}

/** The strictness level's way out, taken in the app (the blocked screen uses the native side directly). */
export function unlockNow(kind: Unlock['kind'], now = Date.now()) {
  const s = getScreenTime();
  const res = takeUnlockRule(deviceZone, s.rules, s.today, kind, now, s.focus);
  if (!res.ok) return res;
  if (s.availability === 'ready' && ScreenTime) {
    // The native side records it (and wakes up to block again when it ends); the sync reads it back.
    ScreenTime.takeUnlock(kind, Math.round((res.until - now) / 60_000));
  } else {
    publish({ ...s, days: withToday(s.days, res.log) });
  }
  // The phone stamps the unlock with its own clock, a moment after `now`. Read it back with a clock
  // that isn't earlier, or the unlock looks like it hasn't started and the app still shows "blocked".
  syncScreenTime(Math.max(now, Date.now()));
  return res;
}

function subscribe(onChange: () => void) {
  const l = () => onChange();
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useScreenTime(): ScreenTimeState {
  return useSyncExternalStore(subscribe, getScreenTime);
}

/** Refresh the decision on a timer while a screen shows it (lock times start and end on their own). */
export function useScreenTimeTick(): ScreenTimeState {
  const s = useScreenTime();
  const refresh = useCallback(() => {
    const cur = getScreenTime();
    // Only the decision changes on a tick: nothing new to save to disk.
    publish(build(cur.rules, cur.days, cur.meta, cur.problems, cur.focus), false);
  }, []);
  useEffect(() => {
    const wait = Math.max(1000, Math.min(60_000, s.decision.nextChange - Date.now() + 500));
    const t = setTimeout(refresh, wait);
    return () => clearTimeout(t);
  }, [s.decision.nextChange, refresh]);
  return s;
}
