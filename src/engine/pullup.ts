import type { EngineConfig } from './config';
import type { FramingCheck, PlankCheck, PlankIssue } from './gates';
import { angleDeg } from './geometry';
import type { MissReason, RepEvent, RepFault, RepRecord } from './repCounter';
import type { TrackedPose } from './tracker';
import { LM, type BodyMetrics, type Vec2 } from './types';

/**
 * Pull-ups, seen from the front or a diagonal. The phone stands 2–2.5 m away at
 * about waist height (or on the floor, leaning back) so the picture holds the
 * hands on the bar down to the feet.
 *
 * The rules follow the strict standard, as in military fitness tests: start from
 * a dead hang, pull until the chin is over the bar, lower back to straight arms;
 * kicking the legs to get up (a kip) doesn't count. How they are measured follows
 * published camera pull-up counters:
 * - the bar is where the hands are: they stay on it the whole set, so its height
 *   is the steady height of the wrists;
 * - "up" is the mouth at or above the bar (a chin proxy the pose model finds
 *   reliably), with the elbows bent;
 * - "down" is straight elbows with the eyes below the elbows.
 * A rep counts at the top, and only after a dead hang. Heights are in shoulder
 * widths, which stay steady head-on at any distance.
 */

const mid = (a: Vec2, b: Vec2): Vec2 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** One frame's pull-up measurements, in pixels unless noted. */
export interface PullupReading {
  t: number;
  /** Shoulder width (px). */
  sw: number;
  shoulder: Vec2;
  /** One shoulder higher than the other, in shoulder widths. */
  shoulderTilt: number;
  /** Mid-point of the visible hands; null when neither is seen. */
  wrist: Vec2 | null;
  bothWrists: boolean;
  /** Shoulder–elbow–wrist angle, averaged over the arms that are seen. */
  elbowDeg: number | null;
  elbowY: number | null;
  eyeY: number | null;
  /** The mouth (its corners, or a little below the nose). */
  mouthY: number | null;
  hip: Vec2 | null;
  knee: Vec2 | null;
  /** Shoulder-to-hip length (px), when the hips are seen. */
  torsoPx: number | null;
  /** Hands up on the bar, above the shoulders. */
  overhead: boolean;
}

export function readPullup(pose: TrackedPose, cfg: EngineConfig): PullupReading | null {
  if (!pose.detected) return null;
  const ok = (i: number) => pose.vis[i] >= cfg.minVisibility;
  const P = pose.points;
  if (!ok(LM.leftShoulder) || !ok(LM.rightShoulder)) return null;
  const ls = P[LM.leftShoulder];
  const rs = P[LM.rightShoulder];
  const sw = Math.hypot(ls.x - rs.x, ls.y - rs.y);
  if (!(sw > 6)) return null;
  const shoulder = mid(ls, rs);
  const pair = (l: number, r: number): Vec2 | null => (ok(l) && ok(r) ? mid(P[l], P[r]) : ok(l) ? P[l] : ok(r) ? P[r] : null);

  const elbows: number[] = [];
  const elbowYs: number[] = [];
  for (const [s, e, w] of [
    [LM.leftShoulder, LM.leftElbow, LM.leftWrist],
    [LM.rightShoulder, LM.rightElbow, LM.rightWrist],
  ] as const) {
    if (!ok(e)) continue;
    elbowYs.push(P[e].y);
    if (!ok(w)) continue;
    const a = angleDeg(P[s], P[e], P[w]);
    if (a !== null) elbows.push(a);
  }
  const nose = ok(LM.nose) ? P[LM.nose] : null;
  const eyes = pair(LM.leftEye, LM.rightEye);
  const mouth = pair(LM.mouthLeft, LM.mouthRight);
  const eyeY = eyes ? eyes.y : nose ? nose.y - 0.06 * sw : null;
  const mouthY = mouth ? mouth.y : nose ? nose.y + 0.08 * sw : null;
  const wrist = pair(LM.leftWrist, LM.rightWrist);
  const hip = pair(LM.leftHip, LM.rightHip);
  const knee = pair(LM.leftKnee, LM.rightKnee);
  return {
    t: pose.t,
    sw,
    shoulder,
    shoulderTilt: Math.abs(ls.y - rs.y) / sw,
    wrist,
    bothWrists: ok(LM.leftWrist) && ok(LM.rightWrist),
    elbowDeg: elbows.length ? elbows.reduce((a, b) => a + b, 0) / elbows.length : null,
    elbowY: elbowYs.length ? elbowYs.reduce((a, b) => a + b, 0) / elbowYs.length : null,
    eyeY,
    mouthY,
    hip,
    knee,
    torsoPx: hip ? Math.hypot(hip.x - shoulder.x, hip.y - shoulder.y) : null,
    overhead: wrist !== null && wrist.y < shoulder.y - cfg.pullup.handsOverShoulders * sw,
  };
}

/** The shared per-frame measurements the session uses for identity, coverage and the start hold. */
export function pullupMetrics(r: PullupReading, pose: TrackedPose): BodyMetrics {
  const centre = r.hip ?? r.shoulder;
  return {
    t: r.t,
    side: 'left',
    elbowDeg: r.elbowDeg,
    bodyLineDeg: null,
    hipOffset: null,
    kneeDeg: null,
    neckDeg: null,
    trunkTiltDeg: null,
    shoulderHeight: null,
    wristOffset: null,
    elbowStack: null,
    forearmRise: null,
    shoulderStack: null,
    trunkLiftDeg: null,
    footRise: null,
    shoulderTilt: r.shoulderTilt,
    torsoPx: r.torsoPx ?? r.sw * 1.3,
    hipCenter: { x: centre.x / pose.width, y: centre.y / pose.height },
  };
}

/** Is the picture right for counting pull-ups? Head, both hands on the bar, and the hips in view. */
export class PullupFramingGate {
  private lowVisSince: number | null = null;
  private flippedSince: number | null = null;

  constructor(private cfg: EngineConfig) {}

  reset(): void {
    this.lowVisSince = null;
    this.flippedSince = null;
  }

  check(pose: TrackedPose | null): FramingCheck {
    const f = this.cfg.framing;
    if (!pose || !pose.detected) {
      this.lowVisSince = null;
      return { ok: false, issue: 'no-person', hint: null, meanVisibility: 0 };
    }
    const keys = [LM.leftShoulder, LM.rightShoulder, LM.leftElbow, LM.rightElbow, LM.leftWrist, LM.rightWrist];
    const meanVis = keys.reduce((s, i) => s + pose.vis[i], 0) / keys.length;
    if (meanVis < f.lowLightVisibility) {
      if (this.lowVisSince === null) this.lowVisSince = pose.t;
    } else this.lowVisSince = null;
    const lowLight = this.lowVisSince !== null && pose.t - this.lowVisSince >= f.lowLightMs;
    const r = readPullup(pose, this.cfg);
    const out = (issue: FramingCheck['issue']): FramingCheck => ({ ok: false, issue, hint: null, meanVisibility: meanVis });
    if (!r) return out(lowLight ? 'low-light' : 'show-head');
    if (r.mouthY === null) return out('show-head');
    // Upside down (Rotation Lock on in landscape): the head shows below the hips. Hanging or
    // standing, the head is always above them, so an upright picture never trips this.
    if (r.hip && r.mouthY > r.hip.y + 0.3 * r.sw) {
      if (this.flippedSince === null) this.flippedSince = pose.t;
      return out(pose.t - this.flippedSince >= f.upsideDownMs ? 'upside-down' : null);
    }
    this.flippedSince = null;
    // Hands at the very top edge are about to leave the picture (the bar is too high in it).
    if (!r.bothWrists) return out(lowLight ? 'low-light' : 'show-hands');
    if (r.wrist && r.wrist.y / pose.height < f.edgeMargin) return out('show-hands');
    if (!r.hip) return out('move-back');
    const share = r.sw / pose.width;
    if (share > 0.45) return out('move-back');
    if (share < 0.07) return out('move-closer');
    return { ok: true, issue: null, hint: lowLight ? 'low-light' : null, meanVisibility: meanVis };
  }
}

/** The start: a dead hang, hands on the bar above the head and arms straight. */
export function checkHangStart(r: PullupReading | null, cfg: EngineConfig): PlankCheck {
  const issues: PlankIssue[] = [];
  if (!r || !r.wrist || !r.overhead) issues.push('grab-bar');
  else if (r.elbowDeg !== null && r.elbowDeg < cfg.pullup.hangElbowDeg) issues.push('straighten-arms');
  else if (r.eyeY !== null && r.elbowY !== null && r.eyeY <= r.elbowY) issues.push('straighten-arms');
  return { ok: issues.length === 0, issues, variant: 'high' };
}

export type PullupPhase = 'hanging' | 'pulling' | 'top' | 'lowering' | 'resting';

interface Attempt {
  startT: number;
  peakRise: number;
  minElbow: number | null;
  maxElbow: number | null;
  hipXs: number[];
  /** Highest knee drive towards the hips, as a share of the hanging hip–knee gap. */
  kneeRise: number;
}

/** How many recent hand heights the bar is the median of. */
const BAR_WINDOW = 45;

/**
 * Pull-up rep state machine:
 *
 *   hanging ──(mouth rises)──▶ pulling ──(mouth over the bar)──▶ top  ⇒ rep (after a dead hang)
 *      ▲                                                          │
 *      └────────(straight arms, eyes below elbows)── lowering ◀───┘
 *
 * Edge cases handled here:
 * - turning back before the bar → miss "not-high-enough" (a small wobble is just noise)
 * - pulling up again without reaching a dead hang → miss "not-back-down"
 * - knees driven up to swing over the bar → miss "kipped" (strict pull-ups only)
 * - hips swinging during the pull → counted with fault "swinging"
 * - one shoulder higher at the top → counted with fault "uneven"
 * - dropping from the bar to the hang → fault "dropping", added once the hang is reached
 * - stuck halfway for longer than `maxRepMs` → miss "too-slow", waits for a hang
 */
export class PullupCounter {
  phase: PullupPhase = 'hanging';
  count = 0;
  private bars: number[] = [];
  /** Mouth below the bar while hanging, in shoulder widths (the start of the range). */
  private hangDrop: number | null = null;
  /** Hip-to-knee gap while hanging, in shoulder widths. */
  private hangKneeGap: number | null = null;
  private hangElbow: number | null = null;
  /** A dead hang since the last top: the next pull may count. */
  private hung = true;
  private attempt: Attempt | null = null;
  private topLeftT: number | null = null;
  private topT: number | null = null;
  private lastRep: RepRecord | null = null;

  constructor(
    private cfg: EngineConfig,
    calibration: { topElbowDeg?: number | null } = {},
  ) {
    this.hangElbow = calibration.topElbowDeg ?? null;
  }

  /** After a pause the user hangs again before the set resumes. */
  restart(calibration: { topElbowDeg?: number | null } = {}): void {
    this.phase = 'hanging';
    this.hung = true;
    this.attempt = null;
    this.topLeftT = null;
    this.topT = null;
    this.lastRep = null;
    if (calibration.topElbowDeg != null) this.hangElbow = calibration.topElbowDeg;
  }

  /** The bar height (px): the median recent height of the hands on it. */
  get barY(): number | null {
    if (this.bars.length < 3) return null;
    const v = [...this.bars].sort((a, b) => a - b);
    return v[Math.floor(v.length / 2)];
  }

  /** 0 at the dead hang, 1 with the mouth at the bar. */
  depthProgress(r: PullupReading): number | null {
    const bar = this.barY;
    if (bar === null || r.mouthY === null || this.hangDrop === null || this.hangDrop <= 0) return null;
    const drop = (r.mouthY - bar) / r.sw;
    return Math.min(1, Math.max(0, (this.hangDrop - drop) / this.hangDrop));
  }

  update(r: PullupReading): RepEvent | null {
    const c = this.cfg.pullup;
    // Learn the bar only from a straight-armed hang, never mid-rep: otherwise
    // hands brought down to the mouth while standing would drag the "bar" with
    // them and count as pull-ups (found in an audit).
    const straight = r.elbowDeg !== null ? r.elbowDeg >= c.hangElbowDeg : this.phase === 'hanging' || this.phase === 'resting';
    if (r.wrist && r.overhead && r.bothWrists && straight && (this.phase === 'hanging' || this.phase === 'resting')) {
      this.bars.push(r.wrist.y);
      if (this.bars.length > BAR_WINDOW) this.bars.shift();
    }
    const bar = this.barY;
    if (bar === null || r.mouthY === null) return null;
    const t = r.t;
    const drop = (r.mouthY - bar) / r.sw;
    const up = drop <= -c.topClearance && (r.elbowDeg === null || r.elbowDeg <= c.topElbowDeg);
    const hang =
      r.elbowDeg !== null
        ? r.elbowDeg >= c.hangElbowDeg && (r.eyeY === null || r.elbowY === null || r.eyeY > r.elbowY)
        : this.hangDrop !== null && drop >= this.hangDrop * 0.85;
    const kneeGap = r.hip && r.knee ? (r.knee.y - r.hip.y) / r.sw : null;

    switch (this.phase) {
      case 'resting':
        if (hang) {
          this.phase = 'hanging';
          this.hung = true;
        }
        return null;

      case 'hanging': {
        if (hang) {
          this.hung = true;
          // The lowest hanging height (and its legs) is where every rep starts from.
          this.hangDrop = this.hangDrop === null ? drop : this.hangDrop * 0.8 + drop * 0.2;
          if (kneeGap !== null) this.hangKneeGap = this.hangKneeGap === null ? kneeGap : this.hangKneeGap * 0.8 + kneeGap * 0.2;
          if (r.elbowDeg !== null)
            this.hangElbow = this.hangElbow === null ? r.elbowDeg : Math.max(this.hangElbow * 0.9 + r.elbowDeg * 0.1, 0);
        }
        const rise = this.hangDrop === null ? 0 : this.hangDrop - drop;
        if (rise >= c.leaveRise || (!hang && r.elbowDeg !== null && r.elbowDeg < c.hangElbowDeg - 15)) {
          this.phase = 'pulling';
          this.attempt = { startT: t, peakRise: rise, minElbow: r.elbowDeg, maxElbow: this.hangElbow, hipXs: [], kneeRise: 0 };
          return this.pull(r, drop, up, hang, kneeGap);
        }
        return null;
      }

      case 'pulling':
        return this.pull(r, drop, up, hang, kneeGap);

      case 'top':
        if (drop >= c.leaveTop || hang) {
          this.phase = 'lowering';
          this.topLeftT = t;
          if (hang) return this.lower(t);
        }
        return null;

      case 'lowering':
        if (hang) return this.lower(t);
        // Back over the bar without straightening the arms first: not a full rep.
        if (up) {
          this.phase = 'top';
          this.topT = t;
          return this.miss('not-back-down', t, r.elbowDeg);
        }
        return null;
    }
  }

  private pull(r: PullupReading, drop: number, up: boolean, hang: boolean, kneeGap: number | null): RepEvent | null {
    const c = this.cfg.pullup;
    const a = this.attempt!;
    const t = r.t;
    const rise = this.hangDrop === null ? 0 : this.hangDrop - drop;
    a.peakRise = Math.max(a.peakRise, rise);
    if (r.elbowDeg !== null) a.minElbow = a.minElbow === null ? r.elbowDeg : Math.min(a.minElbow, r.elbowDeg);
    if (r.hip) a.hipXs.push(r.hip.x / r.sw);
    if (kneeGap !== null && this.hangKneeGap !== null && this.hangKneeGap > 0.2) {
      a.kneeRise = Math.max(a.kneeRise, (this.hangKneeGap - kneeGap) / this.hangKneeGap);
    }

    if (up) {
      this.attempt = null;
      this.phase = 'top';
      this.topT = t;
      const dur = t - a.startT;
      if (dur < c.minRepMs) return { type: 'noise', t };
      if (!this.hung) return this.miss('not-back-down', t, a.minElbow);
      this.hung = false;
      if (a.kneeRise >= c.kipKneeRise) return this.miss('kipped', t, a.minElbow);
      const faults: RepFault[] = [];
      if (this.cfg.form.enabled) {
        const swing = a.hipXs.length ? Math.max(...a.hipXs) - Math.min(...a.hipXs) : 0;
        if (swing > c.swingFault) faults.push('swinging');
        if (r.shoulderTilt > c.tiltFault) faults.push('uneven');
      }
      this.count += 1;
      const rep: RepRecord = {
        index: this.count,
        startT: a.startT,
        bottomT: t,
        endT: t,
        durationMs: dur,
        minElbowDeg: a.minElbow,
        maxElbowDeg: a.maxElbow,
        minBodyLineDeg: null,
        maxSag: 0,
        maxPike: 0,
        faults,
        score: Math.max(0, 100 - faults.length * 30),
        clean: faults.length === 0,
        topClearance: -drop,
      };
      this.lastRep = rep;
      return { type: 'rep', rep };
    }
    if (hang) {
      // Back to the hang without reaching the bar.
      this.attempt = null;
      this.phase = 'hanging';
      this.hung = true;
      return a.peakRise >= c.partialRise ? this.miss('not-high-enough', t, a.minElbow) : { type: 'noise', t };
    }
    if (t - a.startT > c.maxRepMs) {
      this.attempt = null;
      this.phase = 'resting';
      return this.miss('too-slow', t, a.minElbow);
    }
    return null;
  }

  /** Reached the dead hang after a top: judge how the way down went. */
  private lower(t: number): RepEvent | null {
    const from = this.topLeftT ?? this.topT ?? t;
    this.phase = 'hanging';
    this.hung = true;
    this.topLeftT = null;
    this.topT = null;
    const rep = this.lastRep;
    this.lastRep = null;
    if (rep && this.cfg.form.enabled && t - from < this.cfg.pullup.dropMs && !rep.faults.includes('dropping')) {
      rep.faults.push('dropping');
      rep.clean = false;
      rep.score = Math.max(0, 100 - rep.faults.length * 30);
      return { type: 'late-fault', rep, fault: 'dropping' };
    }
    return null;
  }

  private miss(reason: MissReason, t: number, minElbowDeg: number | null): RepEvent {
    return { type: 'miss', miss: { t, reason, minElbowDeg } };
  }
}
