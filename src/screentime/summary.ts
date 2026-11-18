import { addDays, occurrences, type Zone } from './time';
import type { DayLog, ScreenTimeRules } from './types';

/** "45 min", "1 h", "1 h 30 min". */
export function formatMin(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

/** "07:00", or "Tue 07:00" when it isn't today. */
export function formatClock(zone: Zone, at: number, now: number): string {
  const a = zone.local(at);
  const n = zone.local(now);
  const hhmm = `${String(Math.floor(a.min / 60)).padStart(2, '0')}:${String(a.min % 60).padStart(2, '0')}`;
  if (a.y === n.y && a.m === n.m && a.d === n.d) return hhmm;
  const t = addDays(n.y, n.m, n.d, 1);
  if (a.y === t.y && a.m === t.m && a.d === t.d) return `tomorrow ${hhmm}`;
  return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][a.dow]} ${hhmm}`;
}

export interface Window {
  id: string;
  name: string;
  start: number;
  end: number;
  earnable: boolean;
}

/** Lock windows that touch the local day containing `now`, clipped to it (for the day timeline). */
export function windowsToday(zone: Zone, rules: ScreenTimeRules, now: number): { dayStart: number; dayEnd: number; windows: Window[] } {
  const l = zone.local(now);
  const dayStart = zone.at(l.y, l.m, l.d, 0);
  const t = addDays(l.y, l.m, l.d, 1);
  const dayEnd = zone.at(t.y, t.m, t.d, 0);
  const windows: Window[] = [];
  for (const lock of rules.lockTimes) {
    for (const o of occurrences(zone, lock, dayStart, 1)) {
      if (o.end <= dayStart || o.start >= dayEnd) continue;
      windows.push({ id: lock.id, name: lock.name, start: Math.max(o.start, dayStart), end: Math.min(o.end, dayEnd), earnable: lock.earnable });
    }
  }
  return { dayStart, dayEnd, windows: windows.sort((a, b) => a.start - b.start) };
}

/** The next lock time to start (or the one running), for "Sleep at 22:00". */
export function nextLock(zone: Zone, rules: ScreenTimeRules, now: number): { name: string; start: number; end: number; running: boolean } | null {
  let best: { name: string; start: number; end: number; running: boolean } | null = null;
  for (const lock of rules.lockTimes) {
    for (const o of occurrences(zone, lock, now, 7)) {
      if (o.end <= now) continue;
      const cand = { name: lock.name, start: o.start, end: o.end, running: o.start <= now };
      if (!best || (cand.running && !best.running) || (cand.running === best.running && cand.start < best.start)) best = cand;
    }
  }
  return best;
}

/** One day for the history list. */
export interface DaySummary {
  day: string;
  usedMin: number;
  earnedMin: number;
  sets: number;
  unlocks: number;
  overLimit: boolean;
}

export function summarizeDays(rules: ScreenTimeRules, days: DayLog[]): DaySummary[] {
  return days.map((d) => ({
    day: d.day,
    usedMin: d.usedMin,
    earnedMin: d.earnedMin,
    sets: d.grants.length,
    unlocks: d.unlocks.length,
    overLimit: rules.dailyLimitMin !== null && d.usedMin >= rules.dailyLimitMin,
  }));
}
