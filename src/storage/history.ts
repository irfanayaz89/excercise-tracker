import { openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';
import type { SessionSummary } from '@/engine/session';
import { normalizeSummary } from './summaryShape';

export interface SessionRow {
  id: string;
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
  } catch (e) {
    console.warn('[history] database unavailable', e);
    failed = true;
    db = null;
  }
  return db;
}

/**
 * Saves a finished set. Wall-clock times are stored (engine times are
 * monotonic and meaningless across launches). Returns the id, or null if the
 * set was empty or saving failed.
 */
export function saveSession(summary: SessionSummary, wallStart: number): string | null {
  // A set with no counted reps is shown once (summary) but not kept in history.
  if (summary.totalReps === 0) return null;
  const d = getDb();
  if (!d) return null;
  const id = `${wallStart}-${Math.random().toString(36).slice(2, 8)}`;
  const wallEnd = wallStart + Math.max(0, summary.endedAt - summary.startedAt);
  try {
    d.runSync(
      'INSERT INTO sessions (id, started_at, ended_at, total_reps, clean_reps, active_ms, end_reason, summary) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      id,
      wallStart,
      wallEnd,
      summary.totalReps,
      summary.cleanReps,
      Math.round(summary.activeMs),
      summary.endReason,
      JSON.stringify(summary),
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

export function listSessions(limit = 60, since = 0): SessionRow[] {
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
      }>(
        'SELECT id, started_at, ended_at, total_reps, clean_reps, active_ms, end_reason FROM sessions WHERE started_at >= ? ORDER BY started_at DESC LIMIT ?',
        since,
        limit,
      )
      .map((r) => ({
        id: r.id,
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
    }>('SELECT * FROM sessions WHERE id = ?', id);
    if (!r) return null;
    const row: SessionRow = {
      id: r.id,
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

export function deleteSession(id: string): void {
  try {
    getDb()?.runSync('DELETE FROM sessions WHERE id = ?', id);
  } catch {
    // ignore
  }
}

/** Reps per local calendar day for the last `days` days, oldest first. */
export function dailyTotals(rows: SessionRow[], days = 7, now = Date.now()): { day: Date; reps: number }[] {
  const out: { day: Date; reps: number }[] = [];
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(today);
    day.setDate(today.getDate() - i);
    const next = new Date(day);
    next.setDate(day.getDate() + 1);
    const reps = rows.filter((r) => r.startedAt >= day.getTime() && r.startedAt < next.getTime()).reduce((s, r) => s + r.totalReps, 0);
    out.push({ day, reps });
  }
  return out;
}
