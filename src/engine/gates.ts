import type { EngineConfig } from './config';
import { sideScore, type TrackedPose } from './tracker';
import { LM, type BodyMetrics, type Exercise, type PhoneAttitude, type PlankVariant, type SideChain } from './types';
import { isTimed } from './exercises';

// ─── Gate 1: phone placement ────────────────────────────────────────────────

export type PhoneIssue =
  | 'stand-up' // lying flat on its back or face
  | 'wrong-orientation' // portrait when landscape was picked, or the other way round
  | 'tilted-sideways'
  | 'leaning'
  | 'moving'
  | 'no-sensor';

export interface PhoneCheck {
  ok: boolean;
  issue: PhoneIssue | null;
  /** 0..1 progress of the steady-hold timer. */
  steadyProgress: number;
  rollDeg: number | null;
  pitchDeg: number | null;
}

/**
 * Requires the phone to be level and still for `steadyMs`. If the sensor is
 * missing or stale (permission denied, no hardware), reports `no-sensor` so
 * the UI can offer a manual "Phone is set" confirmation instead of blocking.
 */
/** Mid-set, a phone that keeps moving this long pauses the set (it is being held, or was picked up). */
const MOVING_PAUSE_MS = 2000;

export class PhoneGate {
  private steadySince: number | null = null;
  private last: PhoneAttitude | null = null;
  /** When the phone started turning faster than a phone resting on the floor does (null while still). */
  private movingSince: number | null = null;
  /** Attitude the user accepted by skipping the level check; "moved" is measured from here. */
  private base = { roll: 0, pitch: 0 };

  constructor(private cfg: EngineConfig) {}

  reset(): void {
    this.steadySince = null;
  }

  get attitude(): PhoneAttitude | null {
    return this.last;
  }

  push(a: PhoneAttitude): void {
    if (!Number.isFinite(a.rollDeg) || !Number.isFinite(a.pitchDeg)) return;
    if (this.last && a.t < this.last.t) return;
    this.last = a;
    // A phone on the floor barely turns; one that keeps turning is held or moving, and then
    // the real-person check (which needs a still phone) can't see a video played to it.
    const moving = Number.isFinite(a.motionDegPerSec) && a.motionDegPerSec > this.cfg.reality.stillPhoneDegPerSec + 1;
    if (!moving) this.movingSince = null;
    else if (this.movingSince === null) this.movingSince = a.t;
  }

  /** Roll to use for horizon correction; 0 when the sensor is unavailable. */
  horizonRoll(now: number): number {
    const a = this.last;
    if (!a || now - a.t > this.cfg.phone.staleMs) return 0;
    return a.rollDeg;
  }

  check(now: number): PhoneCheck {
    const p = this.cfg.phone;
    const a = this.last;
    if (!a || now - a.t > p.staleMs) {
      this.steadySince = null;
      return { ok: false, issue: 'no-sensor', steadyProgress: 0, rollDeg: null, pitchDeg: null };
    }
    let issue: PhoneIssue | null = null;
    if (Math.abs(a.pitchDeg) > 55) issue = 'stand-up';
    else if (Math.abs(a.rollDeg) > 45) issue = 'wrong-orientation';
    else if (Math.abs(a.rollDeg) > p.maxRollDeg) issue = 'tilted-sideways';
    else if (Math.abs(a.pitchDeg) > p.maxPitchDeg) issue = 'leaning';
    else if (a.motionDegPerSec > p.maxMotionDegPerSec) issue = 'moving';

    if (issue) {
      this.steadySince = null;
      return { ok: false, issue, steadyProgress: 0, rollDeg: a.rollDeg, pitchDeg: a.pitchDeg };
    }
    if (this.steadySince === null) this.steadySince = a.t;
    const progress = Math.min(1, (now - this.steadySince) / p.steadyMs);
    return { ok: progress >= 1, issue: null, steadyProgress: progress, rollDeg: a.rollDeg, pitchDeg: a.pitchDeg };
  }

  /** Remember the phone's current angle as its resting angle (level check passed or skipped). */
  acceptCurrent(): void {
    if (this.last) this.base = { roll: this.last.rollDeg, pitch: this.last.pitchDeg };
  }

  /**
   * Quick check used mid-session: was the phone clearly knocked over or moved,
   * compared with the angle it was resting at when the set began? Capped so a
   * relaxed level check (Easy) still notices a phone that fell flat.
   */
  isDisturbed(now: number): boolean {
    const a = this.last;
    if (!a || now - a.t > this.cfg.phone.staleMs) return false;
    const p = this.cfg.phone;
    const rollLimit = Math.min(p.maxRollDeg * 3, 30);
    const pitchLimit = Math.min(p.maxPitchDeg * 2.5, 50);
    if (this.movingSince !== null && a.t - this.movingSince >= MOVING_PAUSE_MS) return true;
    return Math.abs(a.rollDeg - this.base.roll) > rollLimit || Math.abs(a.pitchDeg - this.base.pitch) > pitchLimit;
  }
}

// ─── Gate 2: whole body in frame ────────────────────────────────────────────

export type FramingIssue =
  | 'no-person'
  | 'move-back'
  | 'move-closer'
  | 'show-feet'
  | 'show-head'
  | 'turn-sideways'
  | 'low-light'
  /** The camera picture is upside down (usually Rotation Lock on with the phone in landscape). */
  | 'upside-down'
  /** Front view: both hands must be in the picture. */
  | 'show-hands'
  /** Standing (legs upright in the picture): get down on the floor. */
  | 'get-down'
  /** Hands and feet on the bottom edge of the picture: the floor sits too low in it. */
  | 'floor-low';

export interface FramingCheck {
  ok: boolean;
  issue: FramingIssue | null;
  /** Soft warning that does not block, e.g. low light while all joints are found. */
  hint: FramingIssue | null;
  meanVisibility: number;
}

export class FramingGate {
  private lowVisSince: number | null = null;
  private flippedSince: number | null = null;
  /** Framed on the last check: a smaller edge margin keeps it framed. */
  private framed = false;

  constructor(private cfg: EngineConfig) {}

  reset(): void {
    this.lowVisSince = null;
    this.flippedSince = null;
    this.framed = false;
  }

  /**
   * Is the body shown upside down? Push-ups and planks: the shoulders sit
   * clearly below the feet. Crunches: the bent knees point down instead of up.
   * Unknown (joints hidden) is never upside down.
   */
  private upsideDown(chain: SideChain): boolean {
    const min = this.cfg.minVisibility;
    const v = chain.vis;
    const torso = Math.hypot(chain.shoulder.x - chain.hip.x, chain.shoulder.y - chain.hip.y);
    if (!(torso > 0) || v.shoulder < min || v.hip < min) return false;
    // Lying down (trunk roughly level), as in every exercise here: standing or
    // kneeling with the arms up must never read as upside down.
    const lying = Math.abs(chain.shoulder.y - chain.hip.y) < 0.6 * torso;
    if (this.cfg.framing.uprightBy === 'knees') {
      if (v.knee < min) return false;
      const kneeDown = chain.knee.y - chain.hip.y > 0.35 * torso;
      // The knee must be the lowest point (below hip and ankle): legs stretched
      // out flat say nothing about which way is up. Feet out of view (Easy):
      // the knee hanging below the hips of a lying body.
      if (v.ankle >= min) return kneeDown && chain.knee.y - chain.ankle.y > 0.2 * torso;
      return kneeDown && lying;
    }
    if (v.ankle >= min) return chain.shoulder.y - chain.ankle.y > 0.25 * torso;
    // Feet out of view (Easy): the shoulders below the hands of a lying body.
    return v.wrist >= min && lying && chain.shoulder.y - chain.wrist.y > 0.25 * torso;
  }

  check(pose: TrackedPose | null, chain: SideChain | null): FramingCheck {
    const r = this.evaluate(pose, chain);
    if (!r.ok) this.framed = false;
    return r;
  }

  private evaluate(pose: TrackedPose | null, chain: SideChain | null): FramingCheck {
    const f = this.cfg.framing;
    if (!pose || !pose.detected || !chain) {
      this.lowVisSince = null;
      return { ok: false, issue: 'no-person', hint: null, meanVisibility: 0 };
    }
    const meanVis = sideScore(pose, chain.side);
    const t = pose.t;
    if (this.upsideDown(chain)) {
      if (this.flippedSince === null) this.flippedSince = t;
      if (t - this.flippedSince >= f.upsideDownMs) return { ok: false, issue: 'upside-down', hint: null, meanVisibility: meanVis };
      // Not confirmed yet, but not usable either: a start or resume hold must not
      // complete on a flipped picture before the flip is confirmed (resuming
      // needs a shorter hold than this). A single odd frame is ridden out.
      return { ok: false, issue: null, hint: null, meanVisibility: meanVis };
    } else this.flippedSince = null;

    // Standing up in front of a phone on the floor: the head and shoulders are
    // usually above the picture, but the legs show upright. Say what to do
    // ("get down") rather than "show your head" or "more light".
    const v0 = chain.vis;
    const min0 = this.cfg.minVisibility;
    if (v0.hip >= min0 && v0.knee >= min0 && v0.ankle >= min0) {
      const dy = chain.ankle.y - chain.hip.y;
      const dx = Math.abs(chain.ankle.x - chain.hip.x);
      const torso = Math.hypot(chain.shoulder.x - chain.hip.x, chain.shoulder.y - chain.hip.y);
      if (dy > 1.5 * dx && dy > 0.8 * (v0.shoulder >= min0 && torso > 0 ? torso : dy)) {
        this.lowVisSince = null;
        return { ok: false, issue: 'get-down', hint: null, meanVisibility: meanVis };
      }
    }
    if (meanVis < f.lowLightVisibility) {
      if (this.lowVisSince === null) this.lowVisSince = t;
    } else this.lowVisSince = null;
    const lowLight = this.lowVisSince !== null && t - this.lowVisSince >= f.lowLightMs;

    const min = this.cfg.minVisibility;
    const v = chain.vis;
    const W = pose.width;
    const H = pose.height;
    // Hysteresis: the full margin to get framed, a small one to stay framed, so
    // a joint resting near the edge doesn't flicker in and out (which would
    // keep restarting the start hold) on camera noise.
    const m = this.framed ? f.edgeMargin * 0.3 : f.edgeMargin;
    const nearEdge = (p: { x: number; y: number }) => p.x < m * W || p.x > (1 - m) * W || p.y < m * H || p.y > (1 - m) * H;

    const headOk = v.shoulder >= min && !nearEdge(chain.shoulder);
    const feetOk = v.ankle >= min && !nearEdge(chain.ankle);
    // Counting itself only needs the torso, plus the arm for push-ups and planks.
    const coreOk = v.shoulder >= min && v.hip >= min && (!f.requireArms || (v.elbow >= min && v.wrist >= min));

    if (f.requireHead && f.requireFeet && !headOk && !feetOk) {
      return { ok: false, issue: v.hip >= min ? 'move-back' : 'no-person', hint: null, meanVisibility: meanVis };
    }
    if (f.requireFeet && !feetOk) {
      // Feet seen, but on the bottom edge of the picture: the floor sits too low
      // in the frame. Moving back (or tilting the phone down) brings it in.
      const onFloorEdge = v.ankle >= min && chain.ankle.y > (1 - m) * H && chain.ankle.x >= m * W && chain.ankle.x <= (1 - m) * W;
      return { ok: false, issue: onFloorEdge ? 'floor-low' : 'show-feet', hint: null, meanVisibility: meanVis };
    }
    if (f.requireHead && !headOk) return { ok: false, issue: 'show-head', hint: null, meanVisibility: meanVis };
    if (!coreOk) {
      const issue: FramingIssue = lowLight ? 'low-light' : v.shoulder < min ? 'show-head' : 'move-back';
      return { ok: false, issue, hint: null, meanVisibility: meanVis };
    }
    // Not required, but worth a gentle tip: tracking is steadier with the whole body in view.
    const softHint: FramingIssue | null = !feetOk ? 'show-feet' : !headOk ? 'show-head' : null;

    // Facing the camera head-on: both shoulders visible and far apart relative to the torso.
    const ls = pose.points[LM.leftShoulder];
    const rs = pose.points[LM.rightShoulder];
    const torso = Math.hypot(chain.shoulder.x - chain.hip.x, chain.shoulder.y - chain.hip.y);
    if (pose.vis[LM.leftShoulder] >= min && pose.vis[LM.rightShoulder] >= min && torso > 0) {
      const shoulderWidth = Math.hypot(ls.x - rs.x, ls.y - rs.y);
      if (shoulderWidth / torso > f.maxShoulderWidthRatio) {
        return { ok: false, issue: 'turn-sideways', hint: null, meanVisibility: meanVis };
      }
    }

    // Distance needs the feet. Only judge it when the body is roughly
    // horizontal; a standing person has a tiny horizontal span and would
    // wrongly be told to come closer.
    if (feetOk) {
      const span = f.spanAlongBody
        ? (Math.hypot(chain.shoulder.x - chain.hip.x, chain.shoulder.y - chain.hip.y) +
            Math.hypot(chain.hip.x - chain.ankle.x, chain.hip.y - chain.ankle.y)) /
          W
        : Math.abs(chain.ankle.x - chain.shoulder.x) / W;
      const horizontal = f.spanAlongBody || Math.abs(chain.ankle.y - chain.shoulder.y) < Math.abs(chain.ankle.x - chain.shoulder.x);
      if (horizontal && span > f.maxBodySpan) return { ok: false, issue: 'move-back', hint: null, meanVisibility: meanVis };
      if (horizontal && span < f.minBodySpan) return { ok: false, issue: 'move-closer', hint: null, meanVisibility: meanVis };
    }

    this.framed = true;
    return { ok: true, issue: null, hint: lowLight ? 'low-light' : softHint, meanVisibility: meanVis };
  }
}

// ─── Gate 3: valid starting plank ───────────────────────────────────────────

export type PlankIssue =
  | 'get-down'
  | 'straighten-arms'
  | 'straighten-legs'
  | 'hips-sagging'
  | 'hips-high'
  | 'hands-under-shoulders'
  | 'elbows-under-shoulders'
  /** Side plank: lying face down or on the back instead of on one side. */
  | 'roll-onto-side'
  /** Crunch: sitting or standing instead of lying on your back. */
  | 'lie-on-back'
  /** Crunch: legs too straight. */
  | 'bend-knees'
  /** Crunch: heels pulled in too close to the hips. */
  | 'feet-forward'
  /** Crunch: feet up in the air instead of flat on the floor. */
  | 'feet-on-floor'
  /** Pull-ups: hands not up on the bar above the head. */
  | 'grab-bar'
  | 'hold-still';

export interface PlankCheck {
  ok: boolean;
  /** Most important issue first. */
  issues: PlankIssue[];
  /** High plank, or forearm plank (only ever 'forearm' for the plank exercise). */
  variant: PlankVariant;
}

/**
 * Forearm plank: forearm flat on the floor (wrist level with the elbow) and the
 * elbow bent to roughly a right angle. A push-up's bottom position also has a
 * bent elbow, but its forearm stands upright, so it never reads as this.
 */
export function isForearmPlank(m: BodyMetrics, cfg: EngineConfig): boolean {
  const p = cfg.plank;
  return (
    m.elbowDeg !== null &&
    m.forearmRise !== null &&
    m.forearmRise <= p.forearmMaxRise &&
    m.elbowDeg >= p.forearmMinElbowDeg &&
    m.elbowDeg <= p.forearmMaxElbowDeg
  );
}

/**
 * Side plank on the forearm: the forearm lies on the floor pointing towards the
 * camera, so the wrist sits at elbow height and close to it. The elbow angle is
 * not used: seen end-on, a forearm pointing at the camera has no clear angle.
 */
export function isForearmSidePlank(m: BodyMetrics, cfg: EngineConfig): boolean {
  return m.forearmRise !== null && m.forearmRise <= cfg.plank.forearmMaxRise;
}

/**
 * Is this a valid starting position? Push-ups always start from a high plank.
 * The plank exercise also accepts a forearm plank, and checks the hips against
 * the hold limits so a timed hold never starts already broken.
 */
export function checkPlank(m: BodyMetrics, cfg: EngineConfig, exercise: Exercise = 'pushup'): PlankCheck {
  if (exercise === 'crunch') return checkCrunchStart(m, cfg);
  const p = cfg.plank;
  const issues: PlankIssue[] = [];
  const variant: PlankVariant =
    exercise === 'plank' && isForearmPlank(m, cfg)
      ? 'forearm'
      : exercise === 'sidePlank' && isForearmSidePlank(m, cfg)
        ? 'forearm'
        : 'high';
  if (m.trunkTiltDeg === null || m.trunkTiltDeg > p.maxTrunkTiltDeg) issues.push('get-down');
  // Side plank: on one side, facing the phone, shoulders stacked.
  if (exercise === 'sidePlank' && (m.shoulderStack === null || m.shoulderStack < cfg.sidePlank.startStack)) issues.push('roll-onto-side');
  if (m.kneeDeg !== null && m.kneeDeg < p.minKneeDeg && !cfg.allowKneeling) issues.push('straighten-legs');
  if (p.checkHips && m.bodyLineDeg !== null && m.bodyLineDeg < p.minBodyLineDeg && m.hipOffset !== null) {
    issues.push(m.hipOffset > 0 ? 'hips-sagging' : 'hips-high');
  } else if (isTimed(exercise) && m.hipOffset !== null) {
    if (m.hipOffset > cfg.hold.sagFault) issues.push('hips-sagging');
    else if (m.hipOffset < -cfg.hold.pikeFault) issues.push('hips-high');
  }
  if (variant === 'forearm') {
    if (m.elbowStack !== null && m.elbowStack > p.maxElbowStack) issues.push('elbows-under-shoulders');
  } else {
    if (m.elbowDeg === null || m.elbowDeg < p.minElbowDeg) issues.push('straighten-arms');
    if (p.checkHands && m.wristOffset !== null && m.wristOffset > p.maxWristOffset) issues.push('hands-under-shoulders');
  }
  return { ok: issues.length === 0, issues, variant };
}

/**
 * Crunch start: lying on your back, knees bent, feet flat on the floor. The
 * arms may be anywhere (across the chest, hands by the ears, reaching forward).
 */
export function checkCrunchStart(m: BodyMetrics, cfg: EngineConfig): PlankCheck {
  const c = cfg.crunch;
  const issues: PlankIssue[] = [];
  if (m.trunkLiftDeg === null || m.trunkLiftDeg > c.maxRestLiftDeg) issues.push('lie-on-back');
  if (m.kneeDeg !== null && m.kneeDeg > c.maxKneeDeg) issues.push('bend-knees');
  else if (m.kneeDeg !== null && m.kneeDeg < c.minKneeDeg) issues.push('feet-forward');
  if (m.footRise !== null && m.footRise > c.maxFootRise) issues.push('feet-on-floor');
  return { ok: issues.length === 0, issues, variant: 'high' };
}

/**
 * Times how long a valid plank has been held, and rejects wobbly holds so a
 * user swinging into position does not trigger the start.
 */
export class PlankHold {
  private since: number | null = null;
  private refShoulderY: number | null = null;
  private heights: number[] = [];
  private torsos: number[] = [];
  private elbows: number[] = [];
  private lines: number[] = [];
  private hips: number[] = [];
  private lifts: number[] = [];
  private feet: number[] = [];
  private necks: number[] = [];
  private lastT: number | null = null;
  /** Start of a run of failing frames inside an otherwise good hold. */
  private badSince: number | null = null;
  private lastProgress = 0;

  /** Failing readings shorter than this do not reset the hold. */
  static readonly GRACE_MS = 350;

  constructor(private cfg: EngineConfig) {}

  reset(): void {
    this.since = null;
    this.lastT = null;
    this.badSince = null;
    this.lastProgress = 0;
    this.refShoulderY = null;
    this.heights = [];
    this.torsos = [];
    this.elbows = [];
    this.lines = [];
    this.hips = [];
    this.lifts = [];
    this.feet = [];
    this.necks = [];
  }

  /** @returns progress 0..1, and calibration once complete. */
  update(
    m: BodyMetrics,
    shoulderY: number,
    valid: boolean,
    holdMs = this.cfg.plank.holdMs,
  ): { progress: number; wobbly: boolean; calibration: Calibration | null; riding: boolean } {
    if (!valid) {
      // Ride out a brief failing reading (a noisy frame or two) without losing
      // the hold; a real change of position lasts longer than this.
      if (this.since !== null) {
        if (this.badSince === null) this.badSince = m.t;
        if (m.t - this.badSince <= PlankHold.GRACE_MS) {
          this.lastT = m.t;
          return { progress: this.lastProgress, wobbly: false, calibration: null, riding: true };
        }
      }
      this.reset();
      return { progress: 0, wobbly: false, calibration: null, riding: false };
    }
    this.badSince = null;
    // A hold only counts while we are actually watching: a camera stall or
    // dropped frames must not be filled in as "held still".
    if (this.lastT !== null && m.t - this.lastT > this.cfg.maxFrameGapMs) this.reset();
    this.lastT = m.t;
    if (this.since === null || this.refShoulderY === null) {
      this.since = m.t;
      this.refShoulderY = shoulderY;
    }
    if (Math.abs(shoulderY - this.refShoulderY) / m.torsoPx > this.cfg.plank.maxWobble) {
      this.since = m.t;
      this.refShoulderY = shoulderY;
      this.heights = [];
      this.torsos = [];
      this.elbows = [];
      this.lines = [];
      this.hips = [];
      this.lifts = [];
      this.feet = [];
      this.necks = [];
      this.lastProgress = 0;
      return { progress: 0, wobbly: true, calibration: null, riding: false };
    }
    if (m.shoulderHeight !== null) this.heights.push(m.shoulderHeight);
    this.torsos.push(m.torsoPx);
    if (m.elbowDeg !== null) this.elbows.push(m.elbowDeg);
    if (m.bodyLineDeg !== null) this.lines.push(m.bodyLineDeg);
    if (m.hipOffset !== null) this.hips.push(m.hipOffset);
    if (m.trunkLiftDeg !== null) this.lifts.push(m.trunkLiftDeg);
    if (m.footRise !== null) this.feet.push(m.footRise);
    if (m.neckDeg !== null) this.necks.push(m.neckDeg);
    const progress = Math.min(1, (m.t - this.since) / holdMs);
    this.lastProgress = progress;
    if (progress < 1) return { progress, wobbly: false, calibration: null, riding: false };
    const cal: Calibration = {
      topShoulderHeight: this.heights.length ? avg(this.heights) : null,
      torsoPx: avg(this.torsos),
      topElbowDeg: this.elbows.length ? avg(this.elbows) : null,
      bodyLineDeg: this.lines.length ? avg(this.lines) : null,
      hipOffset: this.hips.length ? avg(this.hips) : null,
      trunkLiftDeg: this.lifts.length ? avg(this.lifts) : null,
      footRise: this.feet.length ? avg(this.feet) : null,
      neckDeg: this.necks.length ? avg(this.necks) : null,
      side: m.side,
    };
    return { progress: 1, wobbly: false, calibration: cal, riding: false };
  }
}

export interface Calibration {
  /** Shoulder height above the wrist at lockout, in torso lengths. */
  topShoulderHeight: number | null;
  torsoPx: number;
  /** The user's own "straight arm" elbow angle while holding the start plank. */
  topElbowDeg: number | null;
  /** Body line and hip offset held during the start plank: the plank's own baseline. */
  bodyLineDeg?: number | null;
  hipOffset?: number | null;
  /** Crunch: the resting position the lift, feet and neck are measured from. */
  trunkLiftDeg?: number | null;
  footRise?: number | null;
  neckDeg?: number | null;
  side: BodyMetrics['side'];
}

function avg(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
