import { router } from 'expo-router';
import { Platform } from 'react-native';
import { ScreenTime } from '../../modules/screen-time/src';
import { MAX_APPS, requestChange, type ChangeResult, type RefusalReason } from './rules';
import { getScreenTime, saveRules } from './store';
import { deviceZone } from './time';
import type { RulesCore, Selection } from './types';

/**
 * Ask for a rule change from a screen: tightening applies now, loosening waits
 * (Standard: midnight; Strict: 24 h) or is refused (plan §2–3). Saved and sent
 * to the phone's blocking when it applies or is scheduled.
 */
export function changeRules(next: RulesCore, now = Date.now()): ChangeResult {
  const res = requestChange(deviceZone, getScreenTime().rules, next, now);
  if (res.result !== 'refused') saveRules(res.rules);
  return res;
}

/** One line telling the user what happened to their change. */
export function describeChange(res: ChangeResult, now = Date.now()): string | null {
  if (res.result === 'applied') return null;
  if (res.result === 'refused') return REFUSALS[res.reason];
  const hours = Math.round((res.effectiveAt - now) / 3_600_000);
  const when = new Date(res.effectiveAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return hours >= 20
    ? `That makes things easier on you, so it starts in 24 hours (${new Date(res.effectiveAt).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}).`
    : `That makes things easier on you, so it starts at midnight (${when}).`;
}

const REFUSALS: Record<RefusalReason, string> = {
  'strict-running-lock': "Strict mode: a lock time that's running can't be shortened, skipped or switched off.",
  'strict-remove-apps': "Strict mode: apps can't be taken off the blocked list until the lock period ends.",
  'strict-off-early': 'Strict mode is on. End it early from the Strictness section.',
  invalid: "That lock time can't be saved: check its days and times (at least 15 minutes).",
};

let pending: ((s: Selection | null) => void) | null = null;

/**
 * Let the user pick apps, starting from `current`. iPhone: Apple's picker
 * (Trueline only ever sees opaque tokens). Android: Trueline's own list of
 * installed apps. Resolves with the new list, or null if cancelled.
 */
export async function pickApps(title: string, current: Selection): Promise<Selection | null> {
  if (Platform.OS === 'ios') {
    const picked = await ScreenTime?.pickApps?.(title, current);
    return picked ? { apps: picked.apps, categories: picked.categories, domains: picked.domains } : null;
  }
  pending?.(null);
  return new Promise((resolve) => {
    pending = resolve;
    router.push({ pathname: '/screen-time/apps', params: { title, current: JSON.stringify(current) } });
  });
}

/** Called by the Android picker screen when it closes. */
export function finishPick(s: Selection | null) {
  const p = pending;
  pending = null;
  p?.(s);
}

/**
 * iPhone shields at most 50 single apps per list; beyond that it reportedly
 * shields nothing at all (research guide, Appendix A F4). Categories have no limit.
 */
export function selectionProblem(s: Selection, os: string = Platform.OS): string | null {
  if (os === 'ios' && s.apps.length > MAX_APPS)
    return `iPhone can block at most ${MAX_APPS} single apps in one list (you picked ${s.apps.length}). Pick whole categories, like Social or Games, for the rest.`;
  return null;
}

/** "12 apps, 2 categories" for a list. */
export function countLabel(s: Selection): string {
  const parts: string[] = [];
  const n = (k: number, one: string, many: string) => k > 0 && parts.push(`${k} ${k === 1 ? one : many}`);
  n(s.apps.length, 'app', 'apps');
  n(s.categories.length, 'category', 'categories');
  n(s.domains.length, 'site', 'sites');
  return parts.length ? parts.join(', ') : 'None picked';
}
