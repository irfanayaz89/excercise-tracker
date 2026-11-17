import type { EngineConfig } from './config';
import { percentile } from './smoothing';
import type { BodyMetrics } from './types';

export type RepPhase = 'top' | 'descending' | 'bottom' | 'ascending' | 'resting';

/**
 * Push-ups: hips-sagging, hips-piking, rushed, head-dropping (hint).
 * Crunches: sat-up (curled all the way up), feet-lifting, rushed, neck-pulling (hint).
 */
export type RepFault =
  | 'hips-sagging'
  | 'hips-piking'
  | 'rushed'
  | 'head-dropping'
  | 'sat-up'
  | 'feet-lifting'
  | 'neck-pulling'
  /** Front view: elbows flared out wide at the bottom. */
  | 'elbows-flaring'
  /** Front view: one side lower than the other. */
  | 'uneven';

/** Small hints: they cost a few points but never make a rep unclean. */
export const HINT_FAULTS: RepFault[] = ['head-dropping', 'neck-pulling'];

/**
 * Why an attempt was not counted. Push-ups: not-deep-enough, no-lockout.
 * Crunches: not-high-enough, not-back-down. Both: too-slow.
 */
export type MissReason = 'not-deep-enough' | 'no-lockout' | 'too-slow' | 'not-high-enough' | 'not-back-down';

export interface RepRecord {
  index: number;
  startT: number;
  bottomT: number;
  endT: number;
  durationMs: number;
  minElbowDeg: number | null;
  maxElbowDeg: number | null;
  minBodyLineDeg: number | null;
  /** Largest sag (positive) and pike (negative) hip offsets seen, in torso lengths. */
  maxSag: number;
  maxPike: number;
  faults: RepFault[];
  /** 0..100 */
  score: number;
  /** True when the rep had no faults (hints like head position do not count). */
  clean: boolean;
  /** Crunch: highest shoulder lift above rest, in degrees. */
  peakLiftDeg?: number | null;
}

export interface MissRecord {
  t: number;
  reason: MissReason;
  minElbowDeg: number | null;
  /** Crunch: highest shoulder lift reached, in degrees. */
  peakLiftDeg?: number | null;
}

export type RepEvent = { type: 'rep'; rep: RepRecord } | { type: 'miss'; miss: MissRecord } | { type: 'noise'; t: number };

export interface RepCalibration {
  topShoulderHeight: number | null;
  /** Elbow angle held during the start plank; null when the elbow was hidden. */
  topElbowDeg?: number | null;
}

interface Attempt {
  startT: number;
  bottomT: number | null;
  minElbow: number | null;
  maxElbowAfterBottom: number | null;
  /** Every reading during the rep; form is judged on these, not on one frame. */
  bodyLines: number[];
  hipOffsets: number[];
  necks: number[];
  flares: number[];
  tilts: number[];
  lastDepthOk: boolean;
}

/**
 * Form is judged on how the rep mostly looked: the worst 15% of frames are
 * ignored, because on a real phone single frames misread a joint (a straight
 * body read as 118°). A fault held for a real part of the rep still shows.
 */
const FORM_PCT = 0.15;

/**
 * Push-up rep state machine.
 *
 *   top ──(leave lockout)──▶ descending ──(depth)──▶ bottom ──(rise)──▶ ascending ──(lockout)──▶ top  ⇒ rep
 *
 * The gap between the down and up thresholds is the hysteresis that stops
 * jitter around one threshold from double counting.
 *
 * Edge cases handled here:
 * - half rep that turns back before depth → miss "not-deep-enough"
 * - rep that dips again without locking out → miss "no-lockout", restarts from bottom
 * - bounce faster than `minRepMs` → ignored as noise
 * - fast but real rep → counted with fault "rushed"
 * - attempt longer than `maxRepMs` (lying on the floor) → miss "too-slow", waits for lockout
 * - elbow hidden → depth from shoulder drop alone, lockout from shoulder height
 * - shoulder drop unavailable (wrist hidden) → elbow angle alone
 */
export class RepCounter {
  phase: RepPhase = 'top';
  count = 0;
  private attempt: Attempt | null = null;
  private topShoulderHeight: number | null;
  /** Elbow angle that counts as locked out for this user (see `lockoutFor`). */
  private upDeg: number;

  constructor(
    private cfg: EngineConfig,
    calibration: RepCalibration,
  ) {
    this.topShoulderHeight = calibration.topShoulderHeight;
    this.upDeg = this.lockoutFor(calibration.topElbowDeg);
  }

  /** Called after a pause: the user re-enters from a fresh plank. */
  restart(calibration: RepCalibration): void {
    this.phase = 'top';
    this.attempt = null;
    if (calibration.topShoulderHeight !== null) this.topShoulderHeight = calibration.topShoulderHeight;
    this.upDeg = this.lockoutFor(calibration.topElbowDeg);
  }

  /** The lockout angle in use, for tests and debugging. */
  get lockoutDeg(): number {
    return this.upDeg;
  }

  /**
   * Arms rarely read a perfect 180° on camera, and some people never fully
   * straighten. Lockout means "back to the arm you started the set with",
   * capped at the configured angle, and never so low it overlaps the halfway mark.
   */
  private lockoutFor(topElbowDeg: number | null | undefined): number {
    const r = this.cfg.rep;
    if (topElbowDeg === null || topElbowDeg === undefined || !Number.isFinite(topElbowDeg)) return r.upElbowDeg;
    // 8° below the start plank: a real "straight" arm reads ±5° frame to frame.
    return Math.max(r.downElbowDeg + 15, Math.min(r.upElbowDeg, topElbowDeg - 8));
  }

  /** 0 at lockout, 1 at full expected depth. Null when unknown. */
  depthProgress(m: BodyMetrics): number | null {
    const r = this.cfg.rep;
    if (m.elbowDeg !== null) {
      const k = (this.upDeg + 10 - m.elbowDeg) / (this.upDeg + 10 - r.downElbowDeg);
      return clamp01(k);
    }
    const d = this.dropRatio(m);
    return d === null ? null : clamp01(d);
  }

  private dropRatio(m: BodyMetrics): number | null {
    if (m.shoulderHeight === null || this.topShoulderHeight === null || this.topShoulderHeight <= 0.05) return null;
    const range = this.topShoulderHeight * (1 - this.cfg.rep.expectedBottomRatio);
    if (range <= 0) return null;
    return (this.topShoulderHeight - m.shoulderHeight) / range;
  }

  private atDepth(m: BodyMetrics): boolean | null {
    const r = this.cfg.rep;
    const drop = this.dropRatio(m);
    if (m.elbowDeg !== null) {
      if (m.elbowDeg > r.downElbowDeg) return false;
      // Elbow says deep; confirm with shoulder drop when we can measure it.
      return drop === null ? true : drop >= r.minDropRatio;
    }
    if (drop === null) return null;
    return drop >= r.dropOnlyDepthRatio;
  }

  private atLockout(m: BodyMetrics): boolean | null {
    if (m.elbowDeg !== null) return m.elbowDeg >= this.upDeg;
    const drop = this.dropRatio(m);
    if (drop === null) return null;
    return drop <= 0.12;
  }

  private leftTop(m: BodyMetrics): boolean | null {
    if (m.elbowDeg !== null) return m.elbowDeg < this.upDeg - 8;
    const drop = this.dropRatio(m);
    if (drop === null) return null;
    return drop > 0.25;
  }

  update(m: BodyMetrics): RepEvent | null {
    const r = this.cfg.rep;

    if (this.attempt) this.track(this.attempt, m);

    switch (this.phase) {
      case 'top': {
        if (this.leftTop(m) === true) {
          this.phase = 'descending';
          this.attempt = this.newAttempt(m);
        } else if (this.atLockout(m) === true && m.shoulderHeight !== null && this.topShoulderHeight !== null) {
          // Slowly follow the user's real lockout height (fatigue changes it).
          this.topShoulderHeight = this.topShoulderHeight * 0.97 + m.shoulderHeight * 0.03;
        }
        return null;
      }
      case 'descending': {
        const a = this.attempt!;
        if (m.t - a.startT > r.maxRepMs) return this.abandon(m);
        if (this.atDepth(m) === true) {
          this.phase = 'bottom';
          a.bottomT = m.t;
          return null;
        }
        if (this.atLockout(m) === true) {
          // Came back up without reaching depth.
          this.phase = 'top';
          this.attempt = null;
          const dipped = a.minElbow !== null ? a.minElbow < r.midElbowDeg + 10 : true;
          return dipped ? { type: 'miss', miss: { t: m.t, reason: 'not-deep-enough', minElbowDeg: a.minElbow } } : null;
        }
        return null;
      }
      case 'bottom': {
        const a = this.attempt!;
        if (m.t - a.startT > r.maxRepMs) return this.abandon(m);
        if (this.atDepth(m) === false) {
          this.phase = 'ascending';
          a.maxElbowAfterBottom = m.elbowDeg;
        }
        return null;
      }
      case 'ascending': {
        const a = this.attempt!;
        if (m.t - a.startT > r.maxRepMs) return this.abandon(m);
        if (m.elbowDeg !== null) {
          a.maxElbowAfterBottom = a.maxElbowAfterBottom === null ? m.elbowDeg : Math.max(a.maxElbowAfterBottom, m.elbowDeg);
        }
        if (this.atLockout(m) === true) return this.complete(m);
        if (this.atDepth(m) === true) {
          const rose = a.maxElbowAfterBottom ?? 0;
          // Back to the bottom: if they had risen past halfway, that was a rep without lockout.
          if (rose >= r.midElbowDeg) {
            const miss: MissRecord = { t: m.t, reason: 'no-lockout', minElbowDeg: a.minElbow };
            this.attempt = this.newAttempt(m);
            this.attempt.bottomT = m.t;
            this.phase = 'bottom';
            return { type: 'miss', miss };
          }
          this.phase = 'bottom';
        }
        return null;
      }
      case 'resting': {
        if (this.atLockout(m) === true) {
          this.phase = 'top';
          this.attempt = null;
        }
        return null;
      }
    }
  }

  private abandon(m: BodyMetrics): RepEvent {
    const a = this.attempt!;
    this.phase = 'resting';
    this.attempt = null;
    return { type: 'miss', miss: { t: m.t, reason: 'too-slow', minElbowDeg: a.minElbow } };
  }

  private complete(m: BodyMetrics): RepEvent {
    const a = this.attempt!;
    const r = this.cfg.rep;
    this.phase = 'top';
    this.attempt = null;
    const durationMs = m.t - a.startT;
    if (durationMs < r.minRepMs) return { type: 'noise', t: m.t };

    const f = this.cfg.form;
    const faults: RepFault[] = [];
    const minBodyLine = percentile(a.bodyLines, FORM_PCT);
    const maxSag = Math.max(0, percentile(a.hipOffsets, 1 - FORM_PCT) ?? 0);
    const maxPike = Math.min(0, percentile(a.hipOffsets, FORM_PCT) ?? 0);
    const minNeck = percentile(a.necks, FORM_PCT);
    if (!f.enabled) {
      // Count-only mode: every full rep is a clean rep.
    } else if (maxSag > f.hipOffsetFault || (minBodyLine !== null && minBodyLine < f.minBodyLineDeg && maxSag >= -maxPike)) {
      faults.push('hips-sagging');
    } else if (-maxPike > f.hipOffsetFault || (minBodyLine !== null && minBodyLine < f.minBodyLineDeg)) {
      faults.push('hips-piking');
    }
    if (f.enabled && durationMs < r.rushedRepMs) faults.push('rushed');
    // Front view: what head-on shows that side-on can't.
    if (f.enabled && this.cfg.view === 'front') {
      const flare = percentile(a.flares, 1 - FORM_PCT);
      if (flare !== null && flare > this.cfg.front.flareFault) faults.push('elbows-flaring');
      const tilt = percentile(a.tilts, 1 - FORM_PCT);
      if (tilt !== null && tilt > this.cfg.front.tiltFault) faults.push('uneven');
    }
    const hints: RepFault[] = f.enabled && minNeck !== null && minNeck < f.minNeckDeg ? ['head-dropping'] : [];
    const score = Math.max(0, 100 - faults.length * 30 - hints.length * 5);

    this.count += 1;
    return {
      type: 'rep',
      rep: {
        index: this.count,
        startT: a.startT,
        bottomT: a.bottomT ?? m.t,
        endT: m.t,
        durationMs,
        minElbowDeg: a.minElbow,
        maxElbowDeg: m.elbowDeg,
        minBodyLineDeg: minBodyLine,
        maxSag,
        maxPike,
        faults: [...faults, ...hints],
        score,
        clean: faults.length === 0,
      },
    };
  }

  private newAttempt(m: BodyMetrics): Attempt {
    const a: Attempt = {
      startT: m.t,
      bottomT: null,
      minElbow: null,
      maxElbowAfterBottom: null,
      bodyLines: [],
      hipOffsets: [],
      necks: [],
      flares: [],
      tilts: [],
      lastDepthOk: false,
    };
    this.track(a, m);
    return a;
  }

  private track(a: Attempt, m: BodyMetrics): void {
    if (m.elbowDeg !== null) a.minElbow = a.minElbow === null ? m.elbowDeg : Math.min(a.minElbow, m.elbowDeg);
    if (m.bodyLineDeg !== null) a.bodyLines.push(m.bodyLineDeg);
    if (m.hipOffset !== null) a.hipOffsets.push(m.hipOffset);
    if (m.neckDeg !== null) a.necks.push(m.neckDeg);
    if (m.elbowFlare !== null && m.elbowFlare !== undefined) a.flares.push(m.elbowFlare);
    if (m.shoulderTilt !== null && m.shoulderTilt !== undefined) a.tilts.push(m.shoulderTilt);
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
