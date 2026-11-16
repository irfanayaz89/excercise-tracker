/// <reference types="jest" />
/**
 * Saving planks to history against a stand-in database: the migration that
 * adds the plank columns to an old database, and what is (and is not) kept.
 */
import type { SessionSummary } from '@/engine/session';
import { saveSession } from '../history';

// A database created by the first release: no plank columns yet.
const mockDb = {
  cols: ['id', 'started_at', 'ended_at', 'total_reps', 'clean_reps', 'active_ms', 'end_reason', 'summary'],
  exec: [] as string[],
  rows: [] as unknown[][],
  execSync(sql: string) {
    this.exec.push(sql);
    const m = /ADD COLUMN (\w+)/.exec(sql);
    if (m) this.cols.push(m[1]);
  },
  getAllSync(sql: string) {
    return sql.startsWith('PRAGMA table_info') ? this.cols.map((name) => ({ name })) : [];
  },
  runSync(_sql: string, ...args: unknown[]) {
    this.rows.push(args);
  },
  getFirstSync() {
    return null;
  },
};
jest.mock('expo-sqlite', () => ({ openDatabaseSync: () => mockDb }));

const base: SessionSummary = {
  startedAt: 0,
  endedAt: 60000,
  activeMs: 60000,
  endReason: 'user',
  reps: [],
  misses: [],
  totalReps: 0,
  cleanReps: 0,
  faultCounts: {},
  missCounts: {},
  avgRepMs: null,
  avgScore: null,
  bestCleanStreak: 0,
  pauses: 0,
};
const hold = (goodMs: number) => ({
  variant: 'high' as const,
  goodMs,
  totalMs: goodMs,
  longestMs: goodMs,
  breaks: 0,
  faultMs: {},
  headDownMs: 0,
  formPct: 1,
});

describe('plank history', () => {
  it('adds the plank columns to an old database exactly once', () => {
    saveSession({ ...base, exercise: 'plank', hold: hold(5000) }, 1000);
    const alters = mockDb.exec.filter((s) => s.startsWith('ALTER TABLE'));
    expect(alters).toHaveLength(2);
    expect(alters.join(' ')).toContain('exercise');
    expect(alters.join(' ')).toContain('hold_ms');
    saveSession({ ...base, exercise: 'plank', hold: hold(5000) }, 2000);
    expect(mockDb.exec.filter((s) => s.startsWith('ALTER TABLE'))).toHaveLength(2);
  });

  it('keeps a plank of a second or more, with its time in its own column', () => {
    mockDb.rows = [];
    expect(saveSession({ ...base, exercise: 'plank', hold: hold(999) }, 1000)).toBeNull();
    expect(saveSession({ ...base, exercise: 'plank' }, 1000)).toBeNull(); // never started
    expect(mockDb.rows).toHaveLength(0);
    expect(saveSession({ ...base, exercise: 'plank', hold: hold(1000) }, 1000)).not.toBeNull();
    const row = mockDb.rows[0];
    expect(row.slice(-2)).toEqual(['plank', 1000]);
    expect(JSON.parse(row[7] as string).hold.goodMs).toBe(1000);
  });

  it('push-ups keep their old rule (at least one rep) and record no plank time', () => {
    mockDb.rows = [];
    expect(saveSession({ ...base, totalReps: 0 }, 1000)).toBeNull();
    expect(saveSession({ ...base, totalReps: 5, cleanReps: 5 }, 1000)).not.toBeNull();
    expect(mockDb.rows[0].slice(-2)).toEqual(['pushup', 0]);
    // A summary from before planks existed (no exercise) is a push-up set.
    expect(saveSession({ ...base, totalReps: 3, cleanReps: 3 }, 1000)).not.toBeNull();
    expect(mockDb.rows[1].slice(-2)).toEqual(['pushup', 0]);
  });
});

describe('side plank history', () => {
  it('saves a side plank with its total time', () => {
    mockDb.rows = [];
    expect(saveSession({ ...base, exercise: 'sidePlank', hold: hold(45000) }, 1000)).not.toBeNull();
    expect(mockDb.rows[0].slice(-2)).toEqual(['sidePlank', 45000]);
  });
});
