import { useSyncExternalStore } from 'react';
import type { PushupSession, SessionSnapshot } from '@/engine/session';

export interface SnapshotStore {
  get(): SessionSnapshot;
  subscribe(fn: () => void): () => void;
  /** Re-read the engine; notifies only if something visible changed. */
  refresh(): void;
}

/** What the UI actually shows, rounded so tiny jitter does not re-render. */
function visibleKey(s: SessionSnapshot): string {
  const r = (v: number | null | undefined, step: number) => (v == null ? '-' : Math.round(v / step));
  return [
    s.phase,
    s.reps,
    s.cleanReps,
    s.repPhase,
    r(s.depth, 0.03),
    r(s.plankProgress, 0.05),
    s.framing.issue,
    s.framing.hint,
    s.framing.ok,
    s.phone.issue,
    r(s.phone.rollDeg, 0.5),
    r(s.phone.pitchDeg, 1),
    r(s.phone.steadyProgress, 0.1),
    s.pauseReason,
    s.plankIssues.join(','),
    Math.floor(s.elapsedMs / 1000),
    r(s.metrics?.elbowDeg, 1),
    s.side,
    s.lastRep?.index,
    s.placement ? [r(s.placement.box.x0, 0.02), r(s.placement.box.x1, 0.02), r(s.placement.box.y0, 0.02), r(s.placement.box.y1, 0.02), s.placement.headSide].join(',') : '-',
  ].join('|');
}

/**
 * Bridges the engine to React at a bounded rate. Components that show live
 * state subscribe here, so the camera and its parents never re-render on
 * engine ticks.
 */
export function createSnapshotStore(session: PushupSession): SnapshotStore {
  let snap = session.snapshot();
  let key = visibleKey(snap);
  const listeners = new Set<() => void>();
  return {
    get: () => snap,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    refresh() {
      const next = session.snapshot();
      const k = visibleKey(next);
      if (k === key) return;
      snap = next;
      key = k;
      listeners.forEach((l) => l());
    },
  };
}

export function useSnapshot(store: SnapshotStore): SessionSnapshot {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
