/// <reference types="jest" />
/**
 * "Fix my count", deleting sets and personal bests, against a real SQLite
 * database (Node's built-in one stands in for expo-sqlite).
 */
import type { SessionSummary } from '@/engine/session';
import { activeDays, bestBefore, correctReps, countSessions, deleteAllSessions, firstSessionAt, getSession, saveSession } from '../history';

// Hoisted above the imports by Jest.
jest.mock(
  'expo-sqlite',
  () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require('node:sqlite');
    return {
      openDatabaseSync: () => {
        const d = new DatabaseSync(':memory:');
        return {
          execSync: (s: string) => d.exec(s.replace(/PRAGMA journal_mode = WAL;/, '')),
          getAllSync: (s: string, ...p: unknown[]) => d.prepare(s).all(...p),
          getFirstSync: (s: string, ...p: unknown[]) => d.prepare(s).get(...p) ?? null,
          runSync: (s: string, ...p: unknown[]) => d.prepare(s).run(...p),
        };
      },
    };
  },
  { virtual: true },
);

const set = (reps: number, clean = reps): SessionSummary =>
  ({
    exercise: 'pushup',
    startedAt: 0,
    endedAt: 60_000,
    activeMs: 50_000,
    endReason: 'user',
    reps: Array.from({ length: reps }, (_, i) => ({ index: i + 1, clean: i < clean, durationMs: 1500, faults: [], score: 1 })),
    misses: [],
    totalReps: reps,
    cleanReps: clean,
    faultCounts: {},
    missCounts: {},
    avgRepMs: 1500,
    avgScore: 1,
    bestCleanStreak: clean,
    pauses: 0,
  }) as unknown as SessionSummary;

describe('fixing a count', () => {
  test('keeps what the camera counted, and never adds clean reps', () => {
    const id = saveSession(set(10, 8), 1000)!;
    expect(correctReps(id, 12)).toBe('saved');
    let g = getSession(id)!;
    expect(g.row).toMatchObject({ totalReps: 12, cleanReps: 8 });
    expect(g.summary.counted).toEqual({ total: 10, clean: 8 });
    // Down and back up: clean reps come back to what the camera counted, not the lowest fix.
    correctReps(id, 5);
    correctReps(id, 10);
    g = getSession(id)!;
    expect(g.row).toMatchObject({ totalReps: 10, cleanReps: 8 });
    expect(g.summary.counted).toEqual({ total: 10, clean: 8 });
  });

  test('fixing to 0 deletes the set (an empty set is never kept)', () => {
    const id = saveSession(set(6), 2000)!;
    expect(correctReps(id, 0)).toBe('deleted');
    expect(getSession(id)).toBeNull();
  });
});

describe('personal bests and deleting', () => {
  test('a set is compared only with the sets before it', () => {
    deleteAllSessions();
    const a = saveSession(set(10), 10_000)!;
    const b = saveSession(set(15), 20_000)!;
    expect(bestBefore('pushup', a)).toBeNull();
    expect(bestBefore('pushup', b)).toBe(10);
  });

  test('delete all clears every set', () => {
    saveSession(set(3), 30_000);
    expect(countSessions()).toBeGreaterThan(0);
    expect(deleteAllSessions()).toBe(true);
    expect(countSessions()).toBe(0);
  });
});

describe('streak days and first sets', () => {
  test('one entry per active day, oldest first, and the first set of an exercise', () => {
    deleteAllSessions();
    const day = (d: number, h: number) => new Date(2026, 9, d, h).getTime();
    saveSession(set(5), day(3, 9));
    saveSession(set(6), day(3, 18));
    saveSession(set(7), day(5, 7));
    expect(activeDays()).toEqual([day(3, 9), day(5, 7)]);
    expect(firstSessionAt('pushup')).toBe(day(3, 9));
    expect(firstSessionAt('pullup')).toBeNull();
  });
});
