/// <reference types="jest" />
import { DEFAULT_RULES } from '../rules';
import { zoneFor, type Zone } from '../time';
import type { LockTime, ScreenTimeRules } from '../types';

export const london = zoneFor('Europe/London');
export const newYork = zoneFor('America/New_York');
export const karachi = zoneFor('Asia/Karachi');

/** "2026-11-18 22:30" in a zone → epoch ms. */
export function T(zone: Zone, s: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(s);
  if (!m) throw new Error(`bad time ${s}`);
  return zone.at(+m[1], +m[2], +m[3], +m[4] * 60 + +m[5]);
}

/** Local "YYYY-MM-DD HH:MM" of an instant (for readable assertions). */
export function show(zone: Zone, ms: number): string {
  const l = zone.local(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${l.y}-${p(l.m)}-${p(l.d)} ${p(Math.floor(l.min / 60))}:${p(l.min % 60)}`;
}

let n = 0;
export function lock(over: Partial<LockTime> = {}): LockTime {
  n += 1;
  return {
    id: `lock-${n}`,
    name: 'Sleep',
    days: [0, 1, 2, 3, 4, 5, 6],
    start: '22:00',
    end: '07:00',
    apps: 'main',
    earnable: false,
    enabled: true,
    skipDate: null,
    ...over,
  };
}

export function rules(over: Partial<ScreenTimeRules> = {}): ScreenTimeRules {
  return { ...DEFAULT_RULES, blocked: { apps: ['insta', 'tiktok'], categories: ['social'], domains: [] }, ...over };
}

export const MIN = 60_000;
export const HOUR = 60 * MIN;
