import type { EndReason, SessionSummary } from '@/engine/session';
import type { MissReason, RepFault, RepRecord } from '@/engine/repCounter';

const FAULTS: RepFault[] = ['hips-sagging', 'hips-piking', 'rushed', 'head-dropping'];
const MISSES: MissReason[] = ['not-deep-enough', 'no-lockout', 'too-slow'];
const ENDS: EndReason[] = ['user', 'target', 'idle', 'paused-too-long'];

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
  row: { startedAt: number; endedAt: number; totalReps: number; cleanReps: number; activeMs: number; endReason: string },
): SessionSummary {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const reps: RepRecord[] = Array.isArray(o.reps)
    ? (o.reps as unknown[])
        .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
        .map((r, i) => {
          const durationMs = num(r.durationMs, 0);
          const faults = Array.isArray(r.faults) ? (r.faults as unknown[]).filter((f): f is RepFault => FAULTS.includes(f as RepFault)) : [];
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
            clean: typeof r.clean === 'boolean' ? r.clean : faults.every((f) => f === 'head-dropping'),
          };
        })
    : [];
  const endReason = ENDS.includes(o.endReason as EndReason)
    ? (o.endReason as EndReason)
    : ENDS.includes(row.endReason as EndReason)
      ? (row.endReason as EndReason)
      : 'user';
  const totalReps = num(o.totalReps, row.totalReps);
  return {
    difficulty: typeof o.difficulty === 'string' ? o.difficulty : undefined,
    startedAt: num(o.startedAt, row.startedAt),
    endedAt: num(o.endedAt, row.endedAt),
    activeMs: num(o.activeMs, row.activeMs),
    endReason,
    reps,
    misses: Array.isArray(o.misses)
      ? (o.misses as unknown[]).filter(
          (m): m is SessionSummary['misses'][number] => !!m && typeof m === 'object' && MISSES.includes((m as { reason: MissReason }).reason),
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
