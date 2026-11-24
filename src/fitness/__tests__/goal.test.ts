/// <reference types="jest" />
import type { SessionRow } from '@/storage/history';
import { defaultProfile, normalizeProfile, startProfile, withWeighIn, type Profile } from '@/storage/profile';
import { activeDaysThisWeek, goalProgress, setsKcal, weekStart, workoutKcal } from '../goal';

jest.mock('expo-sqlite/kv-store', () => ({ __esModule: true, default: { getItemSync: () => null, setItemSync: () => {} } }));

const DAY = 86_400_000;
// Wednesday 12 Nov 2025, noon local time.
const NOW = new Date(2025, 10, 12, 12).getTime();

const row = (over: Partial<SessionRow>): SessionRow => ({
  id: Math.random().toString(36),
  exercise: 'pushup',
  holdMs: 0,
  startedAt: NOW,
  endedAt: NOW + 60_000,
  totalReps: 10,
  cleanReps: 10,
  activeMs: 60_000,
  endReason: 'user',
  ...over,
});

const base = (over: Partial<Profile>): Profile => ({ ...defaultProfile(NOW - 30 * DAY), ...over });

describe('goal progress', () => {
  test('weeks start on Monday', () => {
    expect(new Date(weekStart(NOW)).getDay()).toBe(1);
    expect(NOW - weekStart(NOW)).toBe(2 * DAY + 12 * 3_600_000);
  });

  test('lose fat: kilograms lost of kilograms to lose, met at the target', () => {
    const p = base({ aim: 'lose-fat', startKg: 90, weightKg: 86, targetKg: 82 });
    expect(goalProgress(p, [], NOW)).toMatchObject({ fraction: 0.5, met: false, value: '4', of: 'of 8 kg' });
    expect(goalProgress({ ...p, weightKg: 81.5 }, [], NOW)).toMatchObject({ fraction: 1, met: true });
    // Gaining weight back never shows negative progress.
    expect(goalProgress({ ...p, weightKg: 92 }, [], NOW).fraction).toBe(0);
  });

  test('get stronger: the best set since the start, of the target', () => {
    const p = base({ aim: 'get-stronger', repGoal: { exercise: 'pullup', reps: 8 } });
    const rows = [
      row({ exercise: 'pullup', totalReps: 5 }),
      row({ exercise: 'pullup', totalReps: 12, startedAt: p.startedAt - DAY }), // before the goal was set
      row({ exercise: 'pushup', totalReps: 30 }),
    ];
    expect(goalProgress(p, rows, NOW)).toMatchObject({ value: '5', of: 'of 8', met: false });
    expect(goalProgress(p, [...rows, row({ exercise: 'pullup', totalReps: 8 })], NOW).met).toBe(true);
  });

  test('stay active: distinct workout days this week', () => {
    const p = base({ aim: 'stay-active', daysPerWeek: 3 });
    const rows = [row({}), row({ startedAt: NOW - 3_600_000 }), row({ startedAt: NOW - DAY }), row({ startedAt: NOW - 5 * DAY })];
    expect(activeDaysThisWeek(rows, NOW)).toBe(2);
    expect(goalProgress(p, rows, NOW)).toMatchObject({ value: '2', of: 'of 3', met: false });
  });

  test('calories of saved sets and of the suggested workout', () => {
    // 1 minute of push-ups at 10 reps a minute, 80 kg: 6.5 × 3.5 × 80 / 200 = 9.1
    expect(setsKcal([row({})], 80)).toBeCloseTo(9.1, 5);
    // 5 min push-ups + 5 min plank at 75 kg ≈ 42.7 + 11.8
    expect(workoutKcal(75)).toBeCloseTo(54.47, 1);
  });
});

describe('profile storage', () => {
  test('bad or missing fields fall back and stay in range', () => {
    expect(normalizeProfile(null)).toBeNull();
    const p = normalizeProfile({ aim: 'fly', age: 4, heightCm: 999, weightKg: 'x', pace: 3, repGoal: { exercise: 'plank', reps: 5 } })!;
    expect(p.aim).toBe('lose-fat');
    expect(p.age).toBe(16);
    expect(p.heightCm).toBe(230);
    expect(p.weightKg).toBe(75);
    expect(p.pace).toBe(0.5);
    expect(p.repGoal).toBeNull();
  });

  test('one weigh-in per day; the latest becomes the current weight', () => {
    let p = base({ weightKg: 80, startKg: 80 });
    p = withWeighIn(p, 79.6, NOW);
    p = withWeighIn(p, 79.2, NOW + 3_600_000);
    p = withWeighIn(p, 78.9, NOW + DAY);
    expect(p.log.map((w) => w.kg)).toEqual([79.2, 78.9]);
    expect(p.weightKg).toBe(78.9);
    expect(p.startKg).toBe(80);
  });

  test('saving the setup: new goals start today, a changed goal keeps its start', () => {
    const fresh = startProfile(base({ weightKg: 82 }), null, NOW);
    expect(fresh).toMatchObject({ startedAt: NOW, startKg: 82, log: [{ at: NOW, kg: 82 }], goalMetAt: null });

    const saved = { ...fresh, aim: 'lose-fat' as const, targetKg: 76 };
    // Same aim, new target and a new weight a week later: start kept, weight logged.
    const later = startProfile({ ...saved, targetKg: 74, weightKg: 80 }, saved, NOW + 7 * DAY);
    expect(later).toMatchObject({ startedAt: NOW, startKg: 82, targetKg: 74, weightKg: 80, goalMetAt: null });
    expect(later.log.map((w) => w.kg)).toEqual([82, 80]);
    // A different aim starts from that day.
    const other = startProfile({ ...saved, aim: 'get-stronger' }, saved, NOW + 7 * DAY);
    expect(other).toMatchObject({ startedAt: NOW + 7 * DAY, startKg: 82 });
    expect(other.log).toHaveLength(1);
    // After reaching a goal, the next one starts fresh too.
    const next = startProfile({ ...saved, targetKg: 72, weightKg: 75.5 }, { ...saved, weightKg: 75.5, goalMetAt: NOW }, NOW + 9 * DAY);
    expect(next).toMatchObject({ startedAt: NOW + 9 * DAY, startKg: 75.5, goalMetAt: null });
  });
});
