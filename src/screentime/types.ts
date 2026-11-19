import type { Exercise } from '@/engine/types';

/**
 * Screen time rules, decided entirely on the phone. These types are shared by
 * the rules engine (pure TypeScript, tested in Node) and, later, the native
 * iPhone/Android modules that apply its decisions. See docs/SCREEN_TIME_PLAN.md.
 */

/**
 * A set of apps, categories and websites picked by the user. On iPhone these
 * are opaque system tokens (we never learn which apps they are); on Android,
 * package names. The engine only compares them as strings.
 */
export interface Selection {
  apps: string[];
  categories: string[];
  domains: string[];
}

export type Strictness = 'nudge' | 'standard' | 'strict';

/** A recurring window when apps can't be opened at all (plan §2). */
export interface LockTime {
  id: string;
  name: string;
  /** Days the window starts on: 0 = Sunday … 6 = Saturday. */
  days: number[];
  /** Local wall-clock "HH:MM". End may be earlier than start: the window then crosses midnight. */
  start: string;
  end: string;
  /** The main blocked apps, or its own selection. */
  apps: 'main' | Selection;
  /** Earned time may open the apps during this window (off = truly locked). */
  earnable: boolean;
  enabled: boolean;
  /** Local date "YYYY-MM-DD" of a skipped occurrence (the one starting that day). */
  skipDate: string | null;
}

/** Minutes earned per unit of work, per exercise (plan §4). */
export interface Rate {
  /** Counted exercises: minutes per clean rep and per flagged rep. */
  perCleanRep?: number;
  perFlaggedRep?: number;
  /** Timed exercises: minutes per 10 s in good form. */
  per10s?: number;
}

export interface EarningRules {
  enabled: boolean;
  rates: Record<Exercise, Rate>;
  /** Most minutes that can be earned in one day. */
  dailyCapMin: number;
}

/** The part of the rules a change can affect (pending changes store a full copy of it). */
export interface RulesCore {
  blocked: Selection;
  allowed: Selection;
  /** null = no daily limit (lock times only). */
  dailyLimitMin: number | null;
  lockTimes: LockTime[];
  earning: EarningRules;
  strictness: Strictness;
}

export interface ScreenTimeRules extends RulesCore {
  version: 1;
  /** Strict: the lock period ends here (epoch ms). After it, Strict behaves as Standard. */
  strictUntil: number | null;
  /** A loosening change waiting to take effect (Standard: next midnight; Strict: 24 h). */
  pending: { effectiveAt: number; next: RulesCore } | null;
}

/** Minutes earned from one finished set. */
export interface Grant {
  id: string;
  at: number;
  minutes: number;
  exercise: Exercise;
  sessionId: string;
}

/** A temporary opening: an emergency unlock (Standard) or "1 more minute" (Nudge). */
export interface Unlock {
  kind: 'emergency' | 'one-more';
  from: number;
  until: number;
}

/**
 * Workout Focus Mode: the blocked apps stay closed during a set or a timed
 * challenge. Every focus has an end the phone knows about, so a crash or an
 * abandoned workout can never leave someone locked out.
 */
export interface Focus {
  /** "set": ends when the set ends. "timed": stays for the chosen minutes. */
  kind: 'set' | 'timed';
  startedAt: number;
  /** Planned end (epoch ms). For "set", a safety cap. */
  until: number;
  /** Started in Strict mode: can't be ended early by backing out or by hand. */
  strict: boolean;
}

/** A finished focus, for history and the summary. */
export interface FocusRecord {
  from: number;
  to: number;
  outcome: 'completed' | 'abandoned' | 'expired' | 'ended';
}

/** A stretch when protection wasn't running: access revoked, or the app was stopped. */
export interface Gap {
  from: number;
  to: number;
  kind: 'permission' | 'stopped' | 'killed';
}

/** Everything that happened today; a new day starts a fresh log (earned time expires). */
export interface DayLog {
  /** Local date "YYYY-MM-DD". */
  day: string;
  /** Minutes the blocked apps were used today (reported by the platform). */
  usedMin: number;
  /** Earned minutes so far today, and how many of them were spent. */
  earnedMin: number;
  earnedUsedMin: number;
  grants: Grant[];
  unlocks: Unlock[];
  /** Focus sessions that ended today (optional: older logs don't have it). */
  focuses?: FocusRecord[];
  /** Times protection was off today. */
  gaps?: Gap[];
}

/** Why the blocked apps are closed right now. */
export type BlockReason = 'focus' | 'lock' | 'limit';

/** What the platform should do right now (plan §5). */
export interface Decision {
  /** The main blocked apps are blocked. */
  blocked: boolean;
  reason: BlockReason | null;
  /** The lock time blocking them (the one ending last, when several overlap). */
  lock: { id: string; name: string; until: number } | null;
  /** Open because earned minutes are being spent (re-block when they run out). */
  usingEarned: boolean;
  earnedLeftMin: number;
  /** Daily-limit minutes left (null = no daily limit). */
  limitLeftMin: number | null;
  /** Open because of a temporary unlock, until this time. */
  unlockedUntil: number | null;
  /** Exercise can open the apps now (offered on the blocked screen). */
  canEarn: boolean;
  /** Options the blocked screen may offer. */
  emergency: { available: boolean; minutes: number };
  oneMore: { available: boolean; left: number };
  /** Lock times with their own app selection that are blocking right now. */
  ownLocks: { id: string; name: string; until: number; apps: Selection }[];
  /** A workout focus is running (it blocks the main apps, earned time doesn't open them). */
  focus: { kind: Focus['kind']; until: number; strict: boolean } | null;
  /** The next moment the decision may change on its own (lock start/end, unlock end, midnight). */
  nextChange: number;
}
