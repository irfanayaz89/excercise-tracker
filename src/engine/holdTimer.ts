import type { EngineConfig } from './config';
import { isForearmPlank, isForearmSidePlank, type Calibration } from './gates';
import type { BodyMetrics, PlankVariant } from './types';

/**
 * Why the plank clock stopped (or is about to). `hands-under-shoulders` is
 * only ever a warning: hand position never stops the clock.
 */
export type HoldFault =
  | 'hips-sagging'
  | 'hips-piking'
  | 'knees-bent'
  | 'arms-bent'
  | 'elbows-under-shoulders'
  | 'hands-under-shoulders'
  | 'dropped'
  /** Side plank: rolled towards the floor or the ceiling (shoulders no longer stacked). */
  | 'rolled'
  /** Medium and Hard judge the hips from the feet: with the feet out of view the clock waits. */
  | 'out-of-view';

/**
 * good: clock running. warning: clock running, but form is slipping or a fault
 * is inside its grace period. broken: clock stopped until form is back.
 */
export type HoldState = 'good' | 'warning' | 'broken';

export type HoldEvent =
  /** Early sign (hips drifting, or a fault inside its grace period). The clock still runs. */
  | { type: 'warning'; fault: HoldFault; t: number }
  /** A fault lasted past the grace period: the clock stopped. */
  | { type: 'break'; fault: HoldFault; t: number }
  /** Good form is back and held for `restoreMs`: the clock runs again. */
  | { type: 'restored'; t: number; brokenMs: number };

export interface HoldSnapshot {
  state: HoldState;
  fault: HoldFault | null;
  /** Time in good form; this is the plank's score. */
  goodMs: number;
  /** All time watched while holding, good or not. */
  totalMs: number;
  longestMs: number;
  breaks: number;
  /** The plank the hold started in. */
  variant: PlankVariant;
  /** Hip position for a gauge: 0 = on the line, +1 = at the sag limit, −1 = at the pike limit. Null when unknown. */
  line: number | null;
}

export interface HoldSummary {
  variant: PlankVariant;
  goodMs: number;
  totalMs: number;
  /** Longest stretch of good form without a break. */
  longestMs: number;
  breaks: number;
  /** Time spent in each fault, including the grace period of faults that were confirmed. */
  faultMs: Partial<Record<HoldFault, number>>;
  /** Time with the head dropped (a hint, never a break). */
  headDownMs: number;
  /** goodMs / totalMs, 0..1. */
  formPct: number;
}

/** Hip trend window for the early "hips dropping" warning. */
const TREND_MS = 2000;
const TREND_MIN_SPAN_MS = 1500;

/**
 * Times a plank. The rep counter's counterpart: where push-ups move through
 * top → bottom → top, a plank holds one position and is judged on how long
 * form stays good.
 *
 * Rules (in line with the published plank test protocol: only time in correct
 * position counts):
 * - The clock runs only while form is good.
 * - A fault must last `graceMs` to stop the clock, so a misread frame or a
 *   quick wobble costs nothing. Once confirmed, its grace period is not
 *   counted as good time either.
 * - Hips are judged against fixed limits and against the user's own start
 *   position, which absorbs camera angle and body shape.
 * - Hips slowly sinking (fatigue) are warned about before they become a fault.
 * - After a break, good form must hold for `restoreMs` before the clock restarts.
 *
 * Feed it median-smoothed metrics in time order. It never throws.
 */
export class HoldTimer {
  private state: HoldState = 'good';
  private fault: HoldFault | null = null;
  private goodMs = 0;
  private totalMs = 0;
  private runMs = 0;
  private longestMs = 0;
  private breaks = 0;
  private headDownMs = 0;
  private faultMs: Partial<Record<HoldFault, number>> = {};
  private lastT: number | null = null;
  /** A fault seen but not yet confirmed: when it started and the time since. */
  private pendingSince: number | null = null;
  private pendingMs = 0;
  /**
   * Leaky fault budget: fills during fault frames and drains at a third of
   * the speed in good form. The hold breaks when it reaches the grace period, so dipping
   * in and out of form (sag for most of each second, straighten briefly)
   * can't dodge a break the way one-off grace periods could.
   */
  private faultBudget = 0;
  /** A problem not yet warned about: which, and since when. */
  private candidate: HoldFault | null = null;
  private candidateSince: number | null = null;
  /** In a break: when good form came back. */
  private restoreSince: number | null = null;
  private brokenSince: number | null = null;
  private baseHip: number | null;
  private hipHistory: { t: number; v: number }[] = [];
  private line: number | null = null;
  /** Good time over the last few seconds, so time from a faked stretch can be taken back. */
  private history: { t: number; good: number; longest: number }[] = [];

  constructor(
    private cfg: EngineConfig,
    calibration: Pick<Calibration, 'hipOffset'>,
    readonly variant: PlankVariant = 'high',
    /** Side plank rules: stacked shoulders, the support arm judged from the front. */
    private sidePlank = false,
  ) {
    this.baseHip = calibration.hipOffset ?? null;
  }

  /** Back in position after a pause: a fresh baseline; totals are kept. */
  restart(calibration: Pick<Calibration, 'hipOffset'>): void {
    this.baseHip = calibration.hipOffset ?? null;
    this.state = 'good';
    this.fault = null;
    this.clearPending();
    this.restoreSince = null;
    this.brokenSince = null;
    this.candidate = null;
    this.candidateSince = null;
    this.lastT = null;
    this.runMs = 0;
    this.hipHistory = [];
    this.faultBudget = 0;
  }

  /** The session paused (left position, lost tracking): stop the clock. An unconfirmed fault is dropped. */
  pause(): void {
    this.clearPending();
    this.lastT = null;
    this.runMs = 0;
    this.faultBudget = 0;
  }

  get currentState(): HoldState {
    return this.state;
  }

  /**
   * Take back good time counted after `t` (the real-person check found the
   * last seconds came from a screen). The current unbroken stretch ends.
   */
  rewind(t: number): void {
    let at: { t: number; good: number; longest: number } | undefined;
    for (const h of this.history) if (h.t <= t) at = h;
    if (at) {
      this.goodMs = at.good;
      this.longestMs = at.longest;
    } else if (this.history.length && this.history[0].t > t) {
      // Everything we still remember is suspect; keep what came before it.
      this.goodMs = Math.min(this.goodMs, this.history[0].good);
      this.longestMs = Math.min(this.longestMs, this.history[0].longest);
    }
    this.history = this.history.filter((h) => h.t <= t);
    this.runMs = 0;
    this.clearPending();
  }

  /** Confirmed good time (a fault inside its grace period is not counted until it clears). */
  get good(): number {
    return this.goodMs;
  }

  update(m: BodyMetrics): HoldEvent | null {
    const t = m.t;
    if (!Number.isFinite(t) || (this.lastT !== null && t <= this.lastT)) return null;
    // Only count time we actually watched: a long gap adds nothing.
    const dt = this.lastT === null || t - this.lastT > this.cfg.maxFrameGapMs ? 0 : t - this.lastT;
    this.lastT = t;
    this.totalMs += dt;

    const h = this.cfg.hold;
    if (m.neckDeg !== null && m.neckDeg < h.minNeckDeg) this.headDownMs += dt;
    this.line = this.linePosition(m);
    this.trackHips(m);
    this.history.push({ t, good: this.goodMs, longest: this.longestMs });
    while (this.history.length && t - this.history[0].t > 8000) this.history.shift();

    const fault = this.faultOf(m);

    if (this.state === 'broken') {
      if (fault) {
        this.fault = fault;
        this.restoreSince = null;
        this.addFault(fault, dt);
        return null;
      }
      this.addFault(this.fault ?? 'dropped', dt);
      if (this.restoreSince === null) this.restoreSince = t;
      if (t - this.restoreSince < h.restoreMs) return null;
      const brokenMs = this.brokenSince === null ? 0 : t - this.brokenSince;
      this.state = 'good';
      this.fault = null;
      this.restoreSince = null;
      this.brokenSince = null;
      this.runMs = 0;
      return { type: 'restored', t, brokenMs };
    }

    if (fault) {
      // Inside the grace period: hold the time aside until we know.
      if (this.pendingSince === null) this.pendingSince = t;
      this.pendingMs += dt;
        this.faultBudget += dt;
      if (this.faultBudget >= h.graceMs) {
        this.addFault(fault, this.pendingMs);
        this.clearPending();
        this.faultBudget = 0;
        this.breaks += 1;
        this.candidate = null;
        this.candidateSince = null;
        this.state = 'broken';
        this.fault = fault;
        this.brokenSince = t;
        this.restoreSince = null;
        this.runMs = 0;
        return { type: 'break', fault, t };
      }
      return this.warn(fault, t);
    }

    // Good frame: a single fault that cleared inside the grace period was a
    // wobble, so its time was good after all. The fault budget drains slowly,
    // so repeated dips still add up to a break.
    this.goodMs += this.pendingMs + dt;
    this.runMs += this.pendingMs + dt;
    this.longestMs = Math.max(this.longestMs, this.runMs);
    this.faultBudget = Math.max(0, this.faultBudget - dt / 3);
    this.clearPending();

    const warn = this.warningOf(m);
    if (warn) return this.warn(warn, t);
    this.candidate = null;
    this.candidateSince = null;
    this.state = 'good';
    this.fault = null;
    return null;
  }

  /** Show a warning once the problem has lasted `warnMs`; announce each new kind once. */
  private warn(f: HoldFault, t: number): HoldEvent | null {
    if (this.candidate !== f || this.candidateSince === null) {
      this.candidate = f;
      this.candidateSince = t;
    }
    if (t - this.candidateSince < this.cfg.hold.warnMs) return null;
    if (this.state === 'warning' && this.fault === f) return null;
    this.state = 'warning';
    this.fault = f;
    return { type: 'warning', fault: f, t };
  }

  snapshot(): HoldSnapshot {
    return {
      state: this.state,
      fault: this.fault,
      goodMs: this.goodMs,
      totalMs: this.totalMs,
      longestMs: this.longestMs,
      breaks: this.breaks,
      variant: this.variant,
      line: this.line,
    };
  }

  summary(): HoldSummary {
    return {
      variant: this.variant,
      goodMs: this.goodMs,
      totalMs: this.totalMs,
      longestMs: this.longestMs,
      breaks: this.breaks,
      faultMs: { ...this.faultMs },
      headDownMs: this.headDownMs,
      formPct: this.totalMs > 0 ? Math.min(1, this.goodMs / this.totalMs) : 0,
    };
  }

  // ─── Rules ───────────────────────────────────────────────────────────────

  /** A fault that stops the clock once it outlasts the grace period. */
  private faultOf(m: BodyMetrics): HoldFault | null {
    const h = this.cfg.hold;
    const p = this.cfg.plank;
    // Out of a plank altogether: stood up, or down on the knees.
    if (m.trunkTiltDeg !== null && m.trunkTiltDeg > p.maxTrunkTiltDeg + 20) return 'dropped';
    if (!this.cfg.allowKneeling && m.kneeDeg !== null && m.kneeDeg < 110) return 'dropped';
    // Levels that need the feet judge the hips from them; without the feet the hold
    // cannot be judged, so the clock must not run (otherwise sagging out of view would count).
    if (this.cfg.framing.requireFeet && m.hipOffset === null && m.bodyLineDeg === null) return 'out-of-view';
    // Legs actively straight: soft knees take the load off the core.
    if (!this.cfg.allowKneeling && m.kneeDeg !== null && m.kneeDeg < p.minKneeDeg - h.kneeBendDeg) return 'knees-bent';

    const hip = m.hipOffset;
    if (hip !== null) {
      if (hip > h.sagFault) return 'hips-sagging';
      if (hip < -h.pikeFault) return 'hips-piking';
      if (this.baseHip !== null) {
        // Clearly worse than where this user started, and already well towards the limit.
        if (hip - this.baseHip > h.driftFault && hip > h.sagFault * h.warnRatio) return 'hips-sagging';
        if (this.baseHip - hip > h.driftFault && hip < -h.pikeFault * h.pikeWarnRatio) return 'hips-piking';
      }
    }
    if (m.bodyLineDeg !== null && m.bodyLineDeg < h.minBodyLineDeg) {
      return hip !== null && hip < 0 ? 'hips-piking' : 'hips-sagging';
    }

    if (this.sidePlank) {
      if (m.shoulderStack !== null && m.shoulderStack < this.cfg.sidePlank.minStack) return 'rolled';
      if (isForearmSidePlank(m, this.cfg)) {
        if (m.elbowStack !== null && m.elbowStack > p.maxElbowStack) return 'elbows-under-shoulders';
      } else if (m.elbowDeg !== null && m.elbowDeg < p.minElbowDeg - h.armBendDeg) {
        return 'arms-bent';
      }
      return null;
    }
    if (isForearmPlank(m, this.cfg)) {
      if (m.elbowStack !== null && m.elbowStack > p.maxElbowStack) return 'elbows-under-shoulders';
    } else if (m.elbowDeg !== null && m.elbowDeg < p.minElbowDeg - h.armBendDeg) {
      return 'arms-bent';
    }
    return null;
  }

  /** Form slipping but still inside the limits: say so while there is time to fix it. */
  private warningOf(m: BodyMetrics): HoldFault | null {
    const h = this.cfg.hold;
    const hip = m.hipOffset;
    if (hip !== null) {
      if (hip > h.sagFault * h.warnRatio) return 'hips-sagging';
      if (hip < -h.pikeFault * h.pikeWarnRatio) return 'hips-piking';
      const slope = this.hipSlope();
      if (slope !== null && slope >= h.sagTrendPerSec && hip > h.sagFault * 0.3) return 'hips-sagging';
    }
    const forearm = this.sidePlank ? isForearmSidePlank(m, this.cfg) : isForearmPlank(m, this.cfg);
    if (h.checkHands && !forearm && m.wristOffset !== null && m.wristOffset > this.cfg.plank.maxWristOffset) {
      return 'hands-under-shoulders';
    }
    return null;
  }

  private trackHips(m: BodyMetrics): void {
    if (m.hipOffset === null) return;
    this.hipHistory.push({ t: m.t, v: m.hipOffset });
    while (this.hipHistory.length && m.t - this.hipHistory[0].t > TREND_MS) this.hipHistory.shift();
  }

  /** Hip offset change per second over the trend window; null until the window is long enough. */
  private hipSlope(): number | null {
    const hs = this.hipHistory;
    if (hs.length < 2) return null;
    const a = hs[0];
    const b = hs[hs.length - 1];
    const span = b.t - a.t;
    if (span < TREND_MIN_SPAN_MS) return null;
    return ((b.v - a.v) * 1000) / span;
  }

  private linePosition(m: BodyMetrics): number | null {
    const hip = m.hipOffset;
    if (hip === null) return null;
    const h = this.cfg.hold;
    const v = hip >= 0 ? hip / h.sagFault : hip / h.pikeFault;
    return Math.max(-1.5, Math.min(1.5, v));
  }

  private addFault(f: HoldFault, ms: number): void {
    if (ms > 0) this.faultMs[f] = (this.faultMs[f] ?? 0) + ms;
  }

  private clearPending(): void {
    this.pendingSince = null;
    this.pendingMs = 0;

  }
}
