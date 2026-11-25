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
  /** Minutes in completed or expired workout focus. */
  focusMin: number;
  /** Minutes protection was off (access revoked, or the app stopped). */
  offMin: number;
}

export function summarizeDays(rules: ScreenTimeRules, days: DayLog[]): DaySummary[] {
  return days.map((d) => ({
    day: d.day,
    usedMin: d.usedMin,
    earnedMin: d.earnedMin,
    sets: d.grants.length,
    unlocks: d.unlocks.length,
    overLimit: rules.dailyLimitMin !== null && d.usedMin >= rules.dailyLimitMin,
    focusMin: Math.round((d.focuses ?? []).reduce((n, f) => n + Math.max(0, f.to - f.from), 0) / 60_000),
    offMin: Math.round((d.gaps ?? []).reduce((n, g) => n + Math.max(0, g.to - g.from), 0) / 60_000),
  }));
}

/** A rate in words: "2.5 min per clean rep" or "10 min per minute in good form". */
export function rateText(r: { perCleanRep?: number; per10s?: number }): string {
  const n = (v: number) => String(Math.round(v * 100) / 100);
  return r.per10s !== undefined ? `${n(r.per10s * 6)} min per minute in good form` : `${n(r.perCleanRep ?? 0)} min per clean rep`;
}

/**
 * The milestone tiers in words, for one exercise: "10 push-ups 15 min · 20 push-ups 30 min",
 * "60 s 15 min · 120 s 30 min". Each milestone is a number of push-up equivalents.
 */
export function tierText(r: { perCleanRep?: number; per10s?: number }, milestoneMin: number, unit: string, milestones: readonly number[] = [10, 20]): string {
  const parts = milestones.map((pe, i) => {
    const minutes = pe + milestoneMin * (i + 1);
    if (r.per10s !== undefined) {
      const s = r.per10s > 0 ? Math.ceil((pe / r.per10s) * 10) : 0;
      return `${s} s: ${minutes} min`;
    }
    const n = r.perCleanRep ? Math.ceil(pe / r.perCleanRep) : 0;
    return `${n} ${unit}: ${minutes} min`;
  });
  return parts.join(' · ');
}
