import type { LockTime } from './types';

/**
 * Local wall-clock time. Lock times are set in local time ("22:00–07:00"), so
 * every rule is worked out in the phone's time zone, including the days when
 * daylight saving moves the clock.
 */
export interface LocalTime {
  y: number;
  /** 1–12 */
  m: number;
  d: number;
  /** 0 = Sunday … 6 = Saturday */
  dow: number;
  /** Minutes since local midnight. */
  min: number;
}

export interface Zone {
  local(ms: number): LocalTime;
  /**
   * The moment a local date and time happens. A time skipped by daylight
   * saving (spring forward) moves forward by the gap; a repeated one (fall
   * back) is the first occurrence. Same as JavaScript's own Date.
   */
  at(y: number, m: number, d: number, minuteOfDay: number): number;
}

/** The phone's own time zone (what the app uses). */
export const deviceZone: Zone = {
  local(ms) {
    const t = new Date(ms);
    return { y: t.getFullYear(), m: t.getMonth() + 1, d: t.getDate(), dow: t.getDay(), min: t.getHours() * 60 + t.getMinutes() };
  },
  at(y, m, d, minuteOfDay) {
    return new Date(y, m - 1, d, Math.floor(minuteOfDay / 60), minuteOfDay % 60).getTime();
  },
};

const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Any IANA time zone ("Europe/London"), for tests and time-zone travel checks. */
export function zoneFor(timeZone: string): Zone {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    weekday: 'short',
  });
  const local = (ms: number): LocalTime => {
    const p: Record<string, string> = {};
    for (const x of fmt.formatToParts(new Date(ms))) p[x.type] = x.value;
    return { y: +p.year, m: +p.month, d: +p.day, dow: DOW[p.weekday], min: +p.hour * 60 + +p.minute };
  };
  // Offset (ms) of local time from UTC at an instant.
  const offset = (ms: number) => {
    const l = local(ms);
    return Date.UTC(l.y, l.m - 1, l.d, 0, l.min) - Math.floor(ms / 60000) * 60000;
  };
  return {
    local,
    at(y, m, d, minuteOfDay) {
      const utc = Date.UTC(y, m - 1, d, 0, minuteOfDay);
      // Offsets either side of any change that day (changes are at most a few hours apart).
      const offs = [...new Set([-12, -6, 0, 6, 12].map((h) => offset(utc + h * 3_600_000)))];
      const want = (ms: number) => {
        const l = local(ms);
        return l.y === y && l.m === m && l.d === d && l.min === minuteOfDay;
      };
      const exact = offs.map((o) => utc - o).filter(want);
      if (exact.length) return Math.min(...exact);
      // Skipped by spring-forward: move forward by the gap.
      return utc - Math.min(...offs);
    },
  };
}

/** "HH:MM" → minutes since midnight; null if malformed. */
export function parseHHMM(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const h = +m[1];
  const mi = +m[2];
  return h < 24 && mi < 60 ? h * 60 + mi : null;
}

/** Calendar date plus n days (no time zone involved). */
export function addDays(y: number, m: number, d: number, n: number): { y: number; m: number; d: number; dow: number } {
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), dow: t.getUTCDay() };
}

export const dayKey = (l: { y: number; m: number; d: number }) => `${l.y}-${String(l.m).padStart(2, '0')}-${String(l.d).padStart(2, '0')}`;

/** The start of the next local day. */
export function nextMidnight(zone: Zone, now: number): number {
  const l = zone.local(now);
  const n = addDays(l.y, l.m, l.d, 1);
  return zone.at(n.y, n.m, n.d, 0);
}

/** Nominal length of a lock window in minutes (as set, ignoring daylight saving). */
export function lockLengthMin(lock: Pick<LockTime, 'start' | 'end'>): number | null {
  const s = parseHHMM(lock.start);
  const e = parseHHMM(lock.end);
  if (s === null || e === null || s === e) return null;
  return (e - s + 1440) % 1440;
}

/** One occurrence of a lock time: real start and end instants. */
export interface Occurrence {
  start: number;
  end: number;
  /** Local date the occurrence starts on (what "skip today" refers to). */
  day: string;
}

/** Occurrences starting on the given local days around `now` (yesterday through `daysAhead`). */
export function occurrences(zone: Zone, lock: LockTime, now: number, daysAhead = 2): Occurrence[] {
  const s = parseHHMM(lock.start);
  const e = parseHHMM(lock.end);
  if (s === null || e === null || s === e || !lock.enabled) return [];
  const today = zone.local(now);
  const out: Occurrence[] = [];
  for (let k = -1; k <= daysAhead; k++) {
    const day = addDays(today.y, today.m, today.d, k);
    if (!lock.days.includes(day.dow)) continue;
    const key = dayKey(day);
    if (lock.skipDate === key) continue;
    const start = zone.at(day.y, day.m, day.d, s);
    const endDay = e > s ? day : addDays(day.y, day.m, day.d, 1);
    const end = zone.at(endDay.y, endDay.m, endDay.d, e);
    if (end > start) out.push({ start, end, day: key });
  }
  return out;
}

/** The occurrence running at `now`, if any. */
export function activeOccurrence(zone: Zone, lock: LockTime, now: number): Occurrence | null {
  return occurrences(zone, lock, now, 0).find((o) => o.start <= now && now < o.end) ?? null;
}
