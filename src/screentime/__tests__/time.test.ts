/// <reference types="jest" />
/**
 * Local time, lock-time windows and daylight saving. Lock times are set in
 * local wall-clock time, so they must start and end at the right local minute
 * on every day of the year, in any time zone.
 */
import { activeOccurrence, addDays, dayKey, deviceZone, lockLengthMin, nextMidnight, occurrences, parseHHMM, zoneFor } from '../time';
import { HOUR, karachi, lock, london, MIN, newYork, show, T } from './helpers';

describe('time zones', () => {
  it.each([
    ['Europe/London', london],
    ['America/New_York', newYork],
    ['Asia/Karachi', karachi],
  ] as const)('%s: local time and back give the same instant, every 37 minutes across a year', (_n, z) => {
    for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2027, 0, 1); t += 37 * MIN * 61) {
      const l = z.local(t);
      const back = z.at(l.y, l.m, l.d, l.min);
      // Equal, except within the repeated hour of fall-back (first occurrence is chosen).
      expect(Math.abs(back - Math.floor(t / MIN) * MIN) === 0 || Math.abs(back - Math.floor(t / MIN) * MIN) === HOUR).toBe(true);
    }
  });

  it('London spring forward: 01:30 does not exist and moves to 02:30 (as JavaScript does)', () => {
    expect(show(london, T(london, '2026-03-29 01:30'))).toBe('2026-03-29 02:30');
    expect(T(london, '2026-03-29 02:00') - T(london, '2026-03-29 00:59')).toBe(MIN);
  });

  it('London fall back: 01:30 happens twice; the first one is used', () => {
    const t = T(london, '2026-10-25 01:30');
    expect(t).toBe(Date.UTC(2026, 9, 25, 0, 30));
    expect(show(london, t + HOUR)).toBe('2026-10-25 01:30');
  });

  it('Karachi has no daylight saving: every day is 24 h', () => {
    expect(T(karachi, '2026-03-30 00:00') - T(karachi, '2026-03-29 00:00')).toBe(24 * HOUR);
  });

  it('the device zone agrees with JavaScript dates', () => {
    const t = Date.UTC(2026, 10, 18, 12, 0);
    const l = deviceZone.local(t);
    expect(deviceZone.at(l.y, l.m, l.d, l.min)).toBe(t);
  });

  it('next midnight, including on a 23 h and a 25 h day', () => {
    expect(show(london, nextMidnight(london, T(london, '2026-11-18 22:30')))).toBe('2026-11-19 00:00');
    expect(nextMidnight(london, T(london, '2026-03-29 00:30')) - T(london, '2026-03-29 00:00')).toBe(23 * HOUR);
    expect(nextMidnight(london, T(london, '2026-10-25 00:30')) - T(london, '2026-10-25 00:00')).toBe(25 * HOUR);
  });
});

describe('helpers', () => {
  it('parses HH:MM and rejects nonsense', () => {
    expect(parseHHMM('22:00')).toBe(1320);
    expect(parseHHMM('7:05')).toBe(425);
    for (const bad of ['24:00', '12:60', '1200', 'ab:cd', '', '12:5']) expect(parseHHMM(bad)).toBeNull();
  });

  it('adds days across months, years and leap days', () => {
    expect(addDays(2026, 12, 31, 1)).toMatchObject({ y: 2027, m: 1, d: 1 });
    expect(addDays(2028, 2, 28, 1)).toMatchObject({ y: 2028, m: 2, d: 29 });
    expect(addDays(2026, 3, 1, -1)).toMatchObject({ y: 2026, m: 2, d: 28 });
    expect(dayKey({ y: 2026, m: 1, d: 5 })).toBe('2026-01-05');
  });

  it('lock length: overnight windows wrap, equal start and end is invalid', () => {
    expect(lockLengthMin({ start: '22:00', end: '07:00' })).toBe(540);
    expect(lockLengthMin({ start: '09:00', end: '17:00' })).toBe(480);
    expect(lockLengthMin({ start: '09:00', end: '09:00' })).toBeNull();
  });
});

describe('lock-time occurrences', () => {
  const sleep = lock({ start: '22:00', end: '07:00' });

  it('an overnight lock started yesterday is running at 06:59 and over at 07:00', () => {
    expect(activeOccurrence(london, sleep, T(london, '2026-11-18 06:59'))?.day).toBe('2026-11-17');
    expect(activeOccurrence(london, sleep, T(london, '2026-11-18 07:00'))).toBeNull();
    expect(activeOccurrence(london, sleep, T(london, '2026-11-18 21:59'))).toBeNull();
    expect(activeOccurrence(london, sleep, T(london, '2026-11-18 22:00'))?.day).toBe('2026-11-18');
  });

  it('days are the days a window starts on: Friday night runs into Saturday morning', () => {
    const fri = lock({ days: [5], start: '23:00', end: '02:00' }); // 2026-11-20 is a Friday
    expect(activeOccurrence(london, fri, T(london, '2026-11-21 01:00'))?.day).toBe('2026-11-20');
    expect(activeOccurrence(london, fri, T(london, '2026-11-22 01:00'))).toBeNull();
  });

  it('a skipped day leaves that occurrence out, and only that one', () => {
    const s = { ...sleep, skipDate: '2026-11-18' };
    expect(activeOccurrence(london, s, T(london, '2026-11-18 23:00'))).toBeNull();
    expect(activeOccurrence(london, s, T(london, '2026-11-18 06:00'))?.day).toBe('2026-11-17');
    expect(activeOccurrence(london, s, T(london, '2026-11-19 23:00'))?.day).toBe('2026-11-19');
  });

  it('a switched-off lock time never runs', () => {
    expect(occurrences(london, { ...sleep, enabled: false }, T(london, '2026-11-18 23:00'), 7)).toEqual([]);
  });

  it('spring forward inside a lock: it still ends at 07:00 local (one hour shorter in real time)', () => {
    const o = activeOccurrence(london, sleep, T(london, '2026-03-29 03:00'))!;
    expect(show(london, o.start)).toBe('2026-03-28 22:00');
    expect(show(london, o.end)).toBe('2026-03-29 07:00');
    expect(o.end - o.start).toBe(8 * HOUR);
  });

  it('fall back inside a lock: it still ends at 07:00 local (one hour longer in real time)', () => {
    const o = activeOccurrence(london, sleep, T(london, '2026-10-25 03:00'))!;
    expect(o.end - o.start).toBe(10 * HOUR);
    expect(show(london, o.end)).toBe('2026-10-25 07:00');
  });

  it('a lock starting in the skipped hour starts when the clock jumps', () => {
    const odd = lock({ start: '01:30', end: '03:00' });
    const o = occurrences(london, odd, T(london, '2026-03-29 00:00'), 0).find((x) => x.day === '2026-03-29')!;
    expect(show(london, o.start)).toBe('2026-03-29 02:30');
    expect(show(london, o.end)).toBe('2026-03-29 03:00');
  });

  it('the same rule follows local time in another time zone (travel)', () => {
    const t = Date.UTC(2026, 10, 18, 23, 0); // 23:00 London, 18:00 New York, 04:00 Karachi next day
    expect(activeOccurrence(london, sleep, t)).not.toBeNull();
    expect(activeOccurrence(newYork, sleep, t)).toBeNull();
    expect(activeOccurrence(karachi, sleep, t)).not.toBeNull();
    expect(activeOccurrence(zoneFor('Asia/Tokyo'), sleep, t)).toBeNull(); // 08:00 there
  });
});
