import Storage from 'expo-sqlite/kv-store';
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { SessionSummary } from '@/engine/session';
import { ScreenTime } from '../../modules/screen-time/src';
import { decide, rollDay, takeUnlock as takeUnlockRule } from './decide';
import { earnFromSet, type EarnResult } from './earn';
import { mergeReport, parseReport, toNativePlan } from './plan';
import { applyPending, clearOldSkips, normalizeRules, DEFAULT_RULES } from './rules';
import { deviceZone } from './time';
import type { DayLog, Decision, ScreenTimeRules, Unlock } from './types';

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
}

const DEFAULT_META: Meta = { setUp: false, permissionLost: false, lastSync: null };

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
  /** When this state was worked out (screens show times relative to it). */
  now: number;
}

let state: ScreenTimeState | null = null;
const listeners = new Set<(s: ScreenTimeState) => void>();

function build(rules: ScreenTimeRules, days: DayLog[], meta: Meta, problems: string[], now = Date.now()): ScreenTimeState {
  const today = rollDay(deviceZone, days[0] ?? null, now);
  return {
    rules,
    today,
    days: withToday(days, today),
    meta,
    decision: decide(deviceZone, rules, today, now),
    availability: availability(),
    problems,
    now,
  };
}

export function getScreenTime(): ScreenTimeState {
  return (state ??= build(loadRules(), loadDays(), loadMeta(), []));
}

function publish(next: ScreenTimeState) {
  state = next;
  write(RULES_KEY, next.rules);
  write(DAYS_KEY, next.days);
  write(META_KEY, next.meta);
  listeners.forEach((l) => l(next));
}

export interface SyncResult {
  /** "Earn time" was tapped on the blocked screen: open the earn screen. */
  openEarn: boolean;
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
  let problems: string[] = [];
  const avail = availability();
  if (avail === 'needs-permission' && meta.setUp) meta.permissionLost = true;
  if (avail === 'ready' && ScreenTime) {
    meta.permissionLost = false;
    const report = parseReport(ScreenTime.takeState());
    today = mergeReport(deviceZone, rules, today, report, now);
    openEarn = report?.openEarn === true;
    if (meta.setUp) {
      problems = ScreenTime.sync(JSON.stringify(toNativePlan(deviceZone, rules, today, now)));
      meta.lastSync = now;
    }
  }
  rules = normalizeRules(rules);
  publish(build(rules, withToday(s.days, today), meta, problems, now));
  return { openEarn };
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
  publish({ ...s, meta: { ...s.meta, setUp: false, permissionLost: false } });
}

/** Credit a finished, verified set. Call once per saved set. */
export function creditSet(summary: SessionSummary, sessionId: string, demo: boolean, now = Date.now()): EarnResult | null {
  const s = getScreenTime();
  if (!s.meta.setUp) return null;
  const res = earnFromSet(deviceZone, s.rules, s.days[0] ?? rollDay(deviceZone, null, now), { summary, sessionId, demo }, now);
  if (res.reason === 'earned') {
    publish({ ...s, days: withToday(s.days, res.log) });
    syncScreenTime(now);
  }
  return res;
}

/** The strictness level's way out, taken in the app (the blocked screen uses the native side directly). */
export function unlockNow(kind: Unlock['kind'], now = Date.now()) {
  const s = getScreenTime();
  const res = takeUnlockRule(deviceZone, s.rules, s.today, kind, now);
  if (!res.ok) return res;
  if (s.availability === 'ready' && ScreenTime) {
    // The native side records it (and wakes up to block again when it ends); the sync reads it back.
    ScreenTime.takeUnlock(kind, Math.round((res.until - now) / 60_000));
  } else {
    publish({ ...s, days: withToday(s.days, res.log) });
  }
  syncScreenTime(now);
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
    publish(build(cur.rules, cur.days, cur.meta, cur.problems));
  }, []);
  useEffect(() => {
    const wait = Math.max(1000, Math.min(60_000, s.decision.nextChange - Date.now() + 500));
    const t = setTimeout(refresh, wait);
    return () => clearTimeout(t);
  }, [s.decision.nextChange, refresh]);
  return s;
}
