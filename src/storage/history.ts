import { openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';
import type { SessionSummary } from '@/engine/session';
import type { Exercise } from '@/engine/types';
import { normalizeSummary } from './summaryShape';
import { EXERCISE_IDS, isExercise, isTimed } from '@/engine/exercises';

export interface SessionRow {
  id: string;
  exercise: Exercise;
  /** Plank: time in good form. 0 for push-ups. */
  holdMs: number;
  startedAt: number;
  endedAt: number;
  totalReps: number;
  cleanReps: number;
  activeMs: number;
  endReason: string;
}

let db: SQLiteDatabase | null = null;
let failed = false;

function getDb(): SQLiteDatabase | null {
  if (db || failed) return db;
  try {
    db = openDatabaseSync('trueline.db');
    db.execSync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER NOT NULL,
        total_reps INTEGER NOT NULL,
        clean_reps INTEGER NOT NULL,
        active_ms INTEGER NOT NULL,
        end_reason TEXT NOT NULL,
        summary TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_started ON sessions(started_at DESC);
    `);
    migrate(db);
  } catch (e) {
    console.warn('[history] database unavailable', e);
    failed = true;
    db = null;
  }
  return db;
}

/**
 * Columns added after the first release. Each is added only if missing, so
 * this is safe to run on every launch, on old and new databases alike.
 */
function migrate(d: SQLiteDatabase): void {
  const have = new Set(d.getAllSync<{ name: string }>('PRAGMA table_info(sessions)').map((c) => c.name));
  if (!have.has('exercise')) d.execSync("ALTER TABLE sessions ADD COLUMN exercise TEXT NOT NULL DEFAULT 'pushup'");
  if (!have.has('hold_ms')) d.execSync('ALTER TABLE sessions ADD COLUMN hold_ms INTEGER NOT NULL DEFAULT 0');
}

const asExercise = (v: unknown): Exercise => (isExercise(v) ? v : 'pushup');

/** A plank shorter than this in good form is not worth keeping. */
const MIN_PLANK_MS = 1000;

/**
 * Saves a finished set. Wall-clock times are stored (engine times are
 * monotonic and meaningless across launches). Returns the id, or null if the
 * set was empty or saving failed.
 */
export function saveSession(summary: SessionSummary, wallStart: number): string | null {
  // An empty set is shown once (summary) but not kept in history.
  const exercise = asExercise(summary.exercise);
  const holdMs = isTimed(exercise) ? Math.round(summary.hold?.goodMs ?? 0) : 0;
  if (isTimed(exercise) ? holdMs < MIN_PLANK_MS : summary.totalReps === 0) return null;
  const d = getDb();
  if (!d) return null;
  const id = `${wallStart}-${Math.random().toString(36).slice(2, 8)}`;
  const wallEnd = wallStart + Math.max(0, summary.endedAt - summary.startedAt);
  try {
    d.runSync(
      'INSERT INTO sessions (id, started_at, ended_at, total_reps, clean_reps, active_ms, end_reason, summary, exercise, hold_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id,
      wallStart,
      wallEnd,
      summary.totalReps,
      summary.cleanReps,
      Math.round(summary.activeMs),
      summary.endReason,
      JSON.stringify(summary),
      exercise,
      holdMs,
    );
    return id;
  } catch (e) {
    console.warn('[history] save failed', e);
    return null;
  }
}

/** Every set since `since` (ms), uncapped, for totals and charts. */
export function listSessionsSince(since: number): SessionRow[] {
  return listSessions(Number.MAX_SAFE_INTEGER, since);
}

export function listSessions(limit = 60, since = 0, exercise?: Exercise): SessionRow[] {
  const d = getDb();
  if (!d) return [];
  try {
    return d
      .getAllSync<{
        id: string;
        started_at: number;
        ended_at: number;
        total_reps: number;
        clean_reps: number;
        active_ms: number;
        end_reason: string;
        exercise: string;
        hold_ms: number;
      }>(
        `SELECT id, started_at, ended_at, total_reps, clean_reps, active_ms, end_reason, exercise, hold_ms FROM sessions WHERE started_at >= ?${
          exercise ? ' AND exercise = ?' : ''
        } ORDER BY started_at DESC LIMIT ?`,
        ...(exercise ? [since, exercise, limit] : [since, limit]),
      )
      .map((r) => ({
        id: r.id,
        exercise: asExercise(r.exercise),
        holdMs: r.hold_ms ?? 0,
        startedAt: r.started_at,
        endedAt: r.ended_at,
        totalReps: r.total_reps,
        cleanReps: r.clean_reps,
        activeMs: r.active_ms,
        endReason: r.end_reason,
      }));
  } catch {
    return [];
  }
}

/** How many sets are saved in all. */
export function countSessions(): number {
  const d = getDb();
  if (!d) return 0;
  try {
    return d.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM sessions')?.n ?? 0;
  } catch {
    return 0;
  }
}

/** Recent sets of one exercise, newest first. */
export function listSessionsFor(exercise: Exercise, limit = 30): SessionRow[] {
  return listSessions(limit, 0, exercise);
}

/** Personal best: most reps in a set, or the most time in good form. Null before the first set. */
export function bestFor(exercise: Exercise): number | null {
  const d = getDb();
  if (!d) return null;
  try {
    const col = isTimed(exercise) ? 'hold_ms' : 'total_reps';
    const r = d.getFirstSync<{ best: number | null }>(`SELECT MAX(${col}) AS best FROM sessions WHERE exercise = ?`, exercise);
    return r?.best ?? null;
  } catch {
    return null;
  }
}

export function getSession(id: string): { row: SessionRow; summary: SessionSummary } | null {
  const d = getDb();
  if (!d) return null;
  try {
    const r = d.getFirstSync<{
      id: string;
      started_at: number;
      ended_at: number;
      total_reps: number;
      clean_reps: number;
      active_ms: number;
      end_reason: string;
      summary: string;
      exercise: string;
      hold_ms: number;
    }>('SELECT * FROM sessions WHERE id = ?', id);
    if (!r) return null;
    const row: SessionRow = {
      id: r.id,
      exercise: asExercise(r.exercise),
      holdMs: r.hold_ms ?? 0,
      startedAt: r.started_at,
      endedAt: r.ended_at,
      totalReps: r.total_reps,
      cleanReps: r.clean_reps,
      activeMs: r.active_ms,
      endReason: r.end_reason,
    };
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(r.summary);
    } catch {
      // Corrupt JSON: fall back to the row's own columns.
    }
    return { row, summary: normalizeSummary(parsed, row) };
  } catch {
    return null;
  }
}

/**
 * "Fix my count": the user corrects a set's rep total after the camera missed
 * or added some. History and calories follow the fix; screen time already
 * earned does not (so a fix can never be a way to earn more). Returns false if
 * nothing was saved.
 */
export function correctReps(id: string, totalReps: number): boolean {
  const d = getDb();
  if (!d) return false;
  const total = Math.max(0, Math.min(500, Math.round(totalReps)));
  try {
    const r = d.getFirstSync<{ summary: string; clean_reps: number; total_reps: number }>(
      'SELECT summary, clean_reps, total_reps FROM sessions WHERE id = ?',
      id,
    );
    if (!r) return false;
    let summary: Record<string, unknown> = {};
    try {
      summary = JSON.parse(r.summary) as Record<string, unknown>;
    } catch {
      // Keep going with the columns alone.
    }
    const clean = Math.min(r.clean_reps, total);
    const countedReps = typeof summary.countedReps === 'number' ? summary.countedReps : r.total_reps;
    const next = { ...summary, totalReps: total, cleanReps: clean, countedReps };
    d.runSync('UPDATE sessions SET total_reps = ?, clean_reps = ?, summary = ? WHERE id = ?', total, clean, JSON.stringify(next), id);
    return true;
  } catch {
    return false;
  }
}

/** The best set of an exercise before this one (null if this is the first). */
export function bestBefore(exercise: Exercise, id: string): number | null {
  const d = getDb();
  if (!d) return null;
  try {
    const col = isTimed(exercise) ? 'hold_ms' : 'total_reps';
    const r = d.getFirstSync<{ best: number | null }>(`SELECT MAX(${col}) AS best FROM sessions WHERE exercise = ? AND id != ?`, exercise, id);
    return r?.best ?? null;
  } catch {
    return null;
  }
}

export function deleteSession(id: string): void {
  try {
    getDb()?.runSync('DELETE FROM sessions WHERE id = ?', id);
  } catch {
    // ignore
  }
}

export interface DayTotal {
  day: Date;
  /** Push-up reps. */
  reps: number;
  /** Time in good form across all timed exercises. */
  holdMs: number;
  /** Per exercise: reps for counted ones, milliseconds for timed ones. */
  byExercise: Record<Exercise, number>;
}

/** Totals per local calendar day for the last `days` days, oldest first. */
export function dailyTotals(rows: SessionRow[], days = 7, now = Date.now()): DayTotal[] {
  const out: DayTotal[] = [];
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(today);
    day.setDate(today.getDate() - i);
    const next = new Date(day);
    next.setDate(day.getDate() + 1);
    const inDay = rows.filter((r) => r.startedAt >= day.getTime() && r.startedAt < next.getTime());
    const byExercise = Object.fromEntries(EXERCISE_IDS.map((e) => [e, 0])) as Record<Exercise, number>;
    for (const r of inDay) byExercise[r.exercise] += isTimed(r.exercise) ? r.holdMs : r.totalReps;
    const reps = byExercise.pushup;
    const holdMs = inDay.reduce((s, r) => s + (isTimed(r.exercise) ? r.holdMs : 0), 0);
    out.push({ day, reps, holdMs, byExercise });
  }
  return out;
}
