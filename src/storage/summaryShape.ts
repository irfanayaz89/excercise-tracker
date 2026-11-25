import type { HoldFault, HoldSummary } from '@/engine/holdTimer';
import type { EndReason, SessionSummary } from '@/engine/session';
import { HINT_FAULTS, type MissReason, type RepFault, type RepRecord } from '@/engine/repCounter';
import { isExercise, isTimed } from '@/engine/exercises';
import type { Exercise } from '@/engine/types';

const FAULTS: RepFault[] = [
  'hips-sagging',
  'hips-piking',
  'rushed',
  'head-dropping',
  'sat-up',
  'feet-lifting',
  'neck-pulling',
  'elbows-flaring',
  'uneven',
  'knees-bent',
];
const MISSES: MissReason[] = ['not-deep-enough', 'no-lockout', 'too-slow', 'not-high-enough', 'not-back-down'];
const HOLD_FAULTS: HoldFault[] = [
  'hips-sagging',
  'hips-piking',
  'knees-bent',
  'arms-bent',
  'elbows-under-shoulders',
  'hands-under-shoulders',
  'dropped',
  'rolled',
  'out-of-view',
];
const ENDS: EndReason[] = ['user', 'target', 'idle', 'paused-too-long', 'form-break'];

const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const numOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function counts<K extends string>(v: unknown, keys: K[]): Partial<Record<K, number>> {
  const out: Partial<Record<K, number>> = {};
  if (!v || typeof v !== 'object') return out;
  for (const k of keys) {
    const n = (v as Record<string, unknown>)[k];
    if (typeof n === 'number' && Number.isFinite(n) && n > 0) out[k] = n;
  }
  return out;
}

/**
 * A stored summary comes from JSON written by any past (or future) build.
 * Fill in anything missing and drop unknown fault or miss kinds, so the
 * summary screen never renders from a broken shape. Row columns win as the
 * fallback for the headline numbers.
 */
export function normalizeSummary(
  raw: unknown,
  row: {
    startedAt: number;
    endedAt: number;
    totalReps: number;
    cleanReps: number;
    activeMs: number;
    endReason: string;
    exercise?: string;
    holdMs?: number;
  },
): SessionSummary {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const reps: RepRecord[] = Array.isArray(o.reps)
    ? (o.reps as unknown[])
        .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
        .map((r, i) => {
          const durationMs = num(r.durationMs, 0);
          const faults = Array.isArray(r.faults)
            ? (r.faults as unknown[]).filter((f): f is RepFault => FAULTS.includes(f as RepFault))
            : [];
          return {
            index: num(r.index, i + 1),
            startT: num(r.startT, 0),
            bottomT: num(r.bottomT, 0),
            endT: num(r.endT, 0),
            durationMs,
            minElbowDeg: numOrNull(r.minElbowDeg),
            maxElbowDeg: numOrNull(r.maxElbowDeg),
            minBodyLineDeg: numOrNull(r.minBodyLineDeg),
            maxSag: num(r.maxSag, 0),
            maxPike: num(r.maxPike, 0),
            faults,
            score: num(r.score, 100),
            clean: typeof r.clean === 'boolean' ? r.clean : faults.every((f) => HINT_FAULTS.includes(f)),
            peakLiftDeg: numOrNull(r.peakLiftDeg),
          };
        })
    : [];
  const endReason = ENDS.includes(o.endReason as EndReason)
    ? (o.endReason as EndReason)
    : ENDS.includes(row.endReason as EndReason)
      ? (row.endReason as EndReason)
      : 'user';
  const totalReps = num(o.totalReps, row.totalReps);
  const exercise: Exercise = isExercise(o.exercise)
    ? o.exercise
    : o.exercise === undefined && isExercise(row.exercise)
      ? row.exercise
      : 'pushup';
  return {
    exercise,
    hold: isTimed(exercise) ? normalizeHold(o.hold, row.holdMs ?? 0) : undefined,
    holdSides: exercise === 'sidePlank' ? normalizeSides(o.holdSides) : undefined,
    difficulty: typeof o.difficulty === 'string' ? o.difficulty : undefined,
    view: o.view === 'front' || o.view === 'side' ? o.view : undefined,
    counted:
      o.counted && typeof o.counted === 'object' && Number.isFinite((o.counted as { total?: unknown }).total) && Number.isFinite((o.counted as { clean?: unknown }).clean)
        ? { total: (o.counted as { total: number }).total, clean: (o.counted as { clean: number }).clean }
        : undefined,
    startedAt: num(o.startedAt, row.startedAt),
    endedAt: num(o.endedAt, row.endedAt),
    activeMs: num(o.activeMs, row.activeMs),
    endReason,
    reps,
    misses: Array.isArray(o.misses)
      ? (o.misses as unknown[]).filter(
          (m): m is SessionSummary['misses'][number] =>
            !!m && typeof m === 'object' && MISSES.includes((m as { reason: MissReason }).reason),
        )
      : [],
    totalReps,
    cleanReps: Math.min(totalReps, num(o.cleanReps, row.cleanReps)),
    faultCounts: counts(o.faultCounts, FAULTS),
    missCounts: counts(o.missCounts, MISSES),
    avgRepMs: numOrNull(o.avgRepMs),
    avgScore: numOrNull(o.avgScore),
    bestCleanStreak: num(o.bestCleanStreak, 0),
    pauses: num(o.pauses, 0),
  };
}

/** A plank's stored details; the row's hold time stands in when the JSON lost them. */
function normalizeHold(raw: unknown, rowHoldMs: number): HoldSummary {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const goodMs = Math.max(0, num(o.goodMs, rowHoldMs));
  const totalMs = Math.max(goodMs, num(o.totalMs, goodMs));
  return {
    variant: o.variant === 'forearm' ? 'forearm' : 'high',
    goodMs,
    totalMs,
    longestMs: Math.min(goodMs, Math.max(0, num(o.longestMs, goodMs))),
    breaks: Math.max(0, Math.round(num(o.breaks, 0))),
    faultMs: counts(o.faultMs, HOLD_FAULTS),
    headDownMs: Math.max(0, num(o.headDownMs, 0)),
    formPct: totalMs > 0 ? goodMs / totalMs : 0,
  };
}

/** Side plank: each side's hold, when stored; unknown sides are dropped. */
function normalizeSides(raw: unknown): SessionSummary['holdSides'] {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const out: NonNullable<SessionSummary['holdSides']> = {};
  for (const side of ['left', 'right'] as const) if (o[side] && typeof o[side] === 'object') out[side] = normalizeHold(o[side], 0);
  return Object.keys(out).length ? out : undefined;
}
