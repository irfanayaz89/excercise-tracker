import type { SessionSummary } from '@/engine/session';

/** The set that just ended, kept in memory so the summary screen works even if saving failed. */
let last: {
  summary: SessionSummary;
  wallStart: number;
  savedId: string | null;
  /** Demo sets are never saved on purpose; only a real set without an id failed to save. */
  demo?: boolean;
  /** Screen time earned by this set (minutes), and whether today's cap cut it short. */
  earned?: { minutes: number; capped: boolean; bonus?: number; halfRate?: boolean } | null;
  /** Workout focus: minutes it held (ended with the set), or when a timed focus still ends. */
  focus?: { heldMin: number; continuesUntil: number | null } | null;
} | null = null;

export function setLastSummary(v: typeof last) {
  last = v;
}

export function getLastSummary() {
  return last;
}
