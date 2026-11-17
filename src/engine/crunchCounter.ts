import type { EngineConfig } from './config';
import type { MissRecord, RepEvent, RepFault } from './repCounter';
import { percentile } from './smoothing';
import type { BodyMetrics } from './types';

/** down: shoulders resting on (or just above) the floor; up: curled up far enough to count. */
export type CrunchPhase = 'down' | 'rising' | 'up' | 'lowering' | 'resting';

/** The resting position measured while the user held still before the set. */
export interface CrunchCalibration {
  trunkLiftDeg?: number | null;
  footRise?: number | null;
  neckDeg?: number | null;
}

interface Attempt {
  startT: number;
  topT: number | null;
  /** Highest lift so far, and the lowest since reaching the top. */
  peak: number;
  lowSinceTop: number;
  lifts: number[];
  feet: number[];
  necks: number[];
}

/** As for push-ups: form is judged on how the rep mostly looked, not on one misread frame. */
const FORM_PCT = 0.15;

/**
 * Crunch rep state machine, driven by the shoulder lift (the hip→shoulder line
 * above its resting angle):
 *
 *   down ──(leave the floor)──▶ rising ──(lift ≥ upDeg)──▶ up ──(start lowering)──▶ lowering ──(back down)──▶ down  ⇒ rep
 *
 * Lift is measured from the user's own resting angle, so a crooked phone or a
 * body that rests slightly raised does not change what counts.
 *
 * Edge cases handled here:
 * - half crunch that turns back before `upDeg` → miss "not-high-enough"
 * - pulsing at the top without coming back down → miss "not-back-down", restarts at the top
 * - flicker faster than `minRepMs` → noise
 * - fast but real crunch → counted with fault "rushed" (momentum)
 * - curling all the way up into a sit-up → counted with fault "sat-up"
 * - feet coming off the floor → counted with fault "feet-lifting"
 * - chin pulled to the chest → hint "neck-pulling" (small score cost)
 * - holding at the top longer than `maxRepMs` → miss "too-slow", waits for the floor
 */
export class CrunchCounter {
  phase: CrunchPhase = 'down';
  count = 0;
  private attempt: Attempt | null = null;
  private rest = 0;
  private restFoot: number | null = null;
  private restNeck: number | null = null;

  constructor(
    private cfg: EngineConfig,
    calibration: CrunchCalibration,
  ) {
    this.calibrate(calibration);
  }

  /** Called after a pause: the user re-enters from a fresh resting position. */
  restart(calibration: CrunchCalibration): void {
    this.phase = 'down';
    this.attempt = null;
    this.calibrate(calibration);
  }

  /** The resting angle in use, for tests and debugging. */
  get restDeg(): number {
    return this.rest;
  }

  private calibrate(cal: CrunchCalibration): void {
    const r = cal.trunkLiftDeg;
    // Never let a resting angle that was really a half crunch raise the bar.
    if (r !== null && r !== undefined && Number.isFinite(r)) this.rest = Math.min(r, this.cfg.crunch.maxRestLiftDeg);
    if (cal.footRise !== null && cal.footRise !== undefined && Number.isFinite(cal.footRise)) this.restFoot = cal.footRise;
    if (cal.neckDeg !== null && cal.neckDeg !== undefined && Number.isFinite(cal.neckDeg)) this.restNeck = cal.neckDeg;
  }

  private lift(m: BodyMetrics): number | null {
    return m.trunkLiftDeg === null ? null : m.trunkLiftDeg - this.rest;
  }

  /** 0 resting, 1 high enough to count. Null when unknown. */
  depthProgress(m: BodyMetrics): number | null {
    const l = this.lift(m);
    return l === null ? null : Math.min(1, Math.max(0, l / this.cfg.crunch.upDeg));
  }

  update(m: BodyMetrics): RepEvent | null {
    const c = this.cfg.crunch;
    const l = this.lift(m);
    if (l === null) return null;
    if (this.attempt) this.track(this.attempt, m, l);

    switch (this.phase) {
      case 'down': {
        if (l >= c.leaveDeg) {
          this.phase = 'rising';
          this.attempt = this.newAttempt(m, l);
        } else if (l < -2) {
          // Clearly lying flatter than when calibrated: follow it down.
          this.rest += l * 0.03;
        } else if (Math.abs(l) < 1.5) {
          // Very slowly follow small shifts on the mat, evenly both ways: a fast
          // follow would track camera noise (biasing rest low) or the start of
          // every lift (biasing it high), and change what the next crunch measures.
          this.rest = Math.min(this.cfg.crunch.maxRestLiftDeg, this.rest + l * 0.005);
        }
        return null;
      }
      case 'rising': {
        const a = this.attempt!;
        if (m.t - a.startT > c.maxRepMs) return this.abandon(m);
        if (l >= c.upDeg) {
          this.phase = 'up';
          a.topT = m.t;
          a.lowSinceTop = l;
          return null;
        }
        if (l <= c.downDeg) {
          // Back on the floor without curling up far enough.
          this.phase = 'down';
          this.attempt = null;
          return a.peak >= c.partialDeg ? this.miss(m, 'not-high-enough', a.peak) : null;
        }
        return null;
      }
      case 'up': {
        const a = this.attempt!;
        if (m.t - a.startT > c.maxRepMs) return this.abandon(m);
        // A few degrees of hysteresis so jitter at the top does not flip phases.
        if (l < c.upDeg - 3) this.phase = 'lowering';
        return null;
      }
      case 'lowering': {
        const a = this.attempt!;
        if (m.t - a.startT > c.maxRepMs) return this.abandon(m);
        if (l <= c.downDeg) return this.complete(m);
        if (l >= c.upDeg) {
          const mid = (c.upDeg + c.downDeg) / 2;
          if (a.lowSinceTop <= mid) {
            // Came at least halfway down, then curled up again without reaching the floor.
            const peak = a.peak;
            this.attempt = this.newAttempt(m, l);
            this.attempt.topT = m.t;
            this.phase = 'up';
            return this.miss(m, 'not-back-down', peak);
          }
          this.phase = 'up';
        }
        return null;
      }
      case 'resting': {
        if (l <= c.downDeg) {
          this.phase = 'down';
          this.attempt = null;
        }
        return null;
      }
    }
  }

  private miss(m: BodyMetrics, reason: MissRecord['reason'], peak: number): RepEvent {
    return { type: 'miss', miss: { t: m.t, reason, minElbowDeg: null, peakLiftDeg: peak } };
  }

  private abandon(m: BodyMetrics): RepEvent {
    const a = this.attempt!;
    this.phase = 'resting';
    this.attempt = null;
    return this.miss(m, 'too-slow', a.peak);
  }

  private complete(m: BodyMetrics): RepEvent {
    const a = this.attempt!;
    const c = this.cfg.crunch;
    this.phase = 'down';
    this.attempt = null;
    const durationMs = m.t - a.startT;
    if (durationMs < c.minRepMs) return { type: 'noise', t: m.t };

    const formOn = this.cfg.form.enabled;
    const faults: RepFault[] = [];
    const hints: RepFault[] = [];
    if (formOn) {
      const peak = percentile(a.lifts, 1 - FORM_PCT);
      if (peak !== null && peak > c.satUpDeg) faults.push('sat-up');
      const foot = percentile(a.feet, 1 - FORM_PCT);
      if (foot !== null && this.restFoot !== null && foot - this.restFoot > c.feetLiftFault) faults.push('feet-lifting');
      if (durationMs < c.rushedRepMs) faults.push('rushed');
      const neck = percentile(a.necks, FORM_PCT);
      if (neck !== null && this.restNeck !== null && this.restNeck - neck > c.neckPullDeg) hints.push('neck-pulling');
    }
    const score = Math.max(0, 100 - faults.length * 30 - hints.length * 5);

    this.count += 1;
    return {
      type: 'rep',
      rep: {
        index: this.count,
        startT: a.startT,
        bottomT: a.topT ?? m.t,
        endT: m.t,
        durationMs,
        minElbowDeg: null,
        maxElbowDeg: null,
        minBodyLineDeg: null,
        maxSag: 0,
        maxPike: 0,
        peakLiftDeg: a.peak,
        faults: [...faults, ...hints],
        score,
        clean: faults.length === 0,
      },
    };
  }

  private newAttempt(m: BodyMetrics, l: number): Attempt {
    const a: Attempt = { startT: m.t, topT: null, peak: l, lowSinceTop: l, lifts: [], feet: [], necks: [] };
    this.track(a, m, l);
    return a;
  }

  private track(a: Attempt, m: BodyMetrics, l: number): void {
    a.peak = Math.max(a.peak, l);
    if (a.topT !== null) a.lowSinceTop = Math.min(a.lowSinceTop, l);
    a.lifts.push(l);
    if (m.footRise !== null) a.feet.push(m.footRise);
    if (m.neckDeg !== null) a.necks.push(m.neckDeg);
  }
}
