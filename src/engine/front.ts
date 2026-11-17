import type { EngineConfig } from './config';
import type { FramingCheck, PlankCheck, PlankIssue } from './gates';
import type { TrackedPose } from './tracker';
import { LM, type BodyMetrics, type Exercise, type Vec2 } from './types';

/**
 * Front view, for push-ups and the plank: the phone stands upright on the floor
 * about 1.2–2 m beyond the hands, facing the user, and sees the face,
 * shoulders and both arms.
 *
 * Head-on, the body's long axis points at the camera, so angles along it are
 * unreliable (pose models are least accurate in depth). Everything here is
 * measured across the picture and in shoulder widths, which stay steady at any
 * distance:
 * - push-ups: how high the shoulders sit above the hands (D), plus what only
 *   head-on shows: elbows flaring out and one side dropping (uneven);
 * - plank: holding position, forearms or straight arms, arms under the shoulders.
 * Hip sag and pike are not judged head-on: the hips sit behind the torso.
 * Crunches stay side-on: the curl can't be measured well head-on.
 */

const mid = (a: Vec2, b: Vec2): Vec2 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

interface FrontPose {
  /** Shoulder width in pixels. */
  sw: number;
  shoulder: Vec2;
  /** Mid-point of the visible hands; null when neither is seen. */
  wrist: Vec2 | null;
  bothWrists: boolean;
  hip: Vec2 | null;
  ankle: Vec2 | null;
  nose: boolean;
  handSpread: number | null;
  elbowFlare: number | null;
  /** Horizontal elbow distance from its shoulder, in shoulder widths (forearm plank: elbows under the shoulders). */
  elbowLateral: number | null;
  tilt: number;
}

function readFront(pose: TrackedPose, cfg: EngineConfig): FrontPose | null {
  const ok = (i: number) => pose.vis[i] >= cfg.minVisibility;
  const P = pose.points;
  if (!ok(LM.leftShoulder) || !ok(LM.rightShoulder)) return null;
  const ls = P[LM.leftShoulder];
  const rs = P[LM.rightShoulder];
  const sw = Math.hypot(ls.x - rs.x, ls.y - rs.y);
  if (!(sw > 6)) return null;
  const shoulder = mid(ls, rs);
  const both = (l: number, r: number): Vec2 | null => (ok(l) && ok(r) ? mid(P[l], P[r]) : ok(l) ? P[l] : ok(r) ? P[r] : null);
  const lw = ok(LM.leftWrist);
  const rw = ok(LM.rightWrist);
  let flare: number | null = null;
  let lateral: number | null = null;
  const sides: [number, number][] = [
    [LM.leftShoulder, LM.leftElbow],
    [LM.rightShoulder, LM.rightElbow],
  ];
  for (const [s, e] of sides) {
    if (!ok(e)) continue;
    const out = (Math.abs(P[e].x - shoulder.x) - Math.abs(P[s].x - shoulder.x)) / sw;
    flare = Math.max(flare ?? 0, out);
    const lat = Math.abs(P[e].x - P[s].x) / sw;
    lateral = lateral === null ? lat : (lateral + lat) / 2;
  }
  return {
    sw,
    shoulder,
    wrist: both(LM.leftWrist, LM.rightWrist),
    bothWrists: lw && rw,
    hip: both(LM.leftHip, LM.rightHip),
    ankle: both(LM.leftAnkle, LM.rightAnkle),
    nose: ok(LM.nose),
    handSpread: lw && rw ? Math.abs(P[LM.leftWrist].x - P[LM.rightWrist].x) / sw : null,
    elbowFlare: flare,
    elbowLateral: lateral,
    tilt: Math.abs(ls.y - rs.y) / sw,
  };
}

/** Down on the floor (not standing or kneeling up), judged head-on. */
function isDown(f: FrontPose): boolean {
  if (!f.wrist) return false;
  const D = (f.wrist.y - f.shoulder.y) / f.sw;
  if (D < 0.3 || D > 2.8) return false;
  // Standing with the arms down: the hands hang at the hips, the feet far below.
  if (f.ankle && f.ankle.y - f.wrist.y > 0.6 * f.sw) return false;
  if (f.hip && f.hip.y > f.wrist.y - 0.1 * f.sw) return false;
  return true;
}

/**
 * Body measurements seen head-on, in the fields the rep counter and the hold
 * timer read. Fields that cannot be judged head-on are null (never a pass or a
 * fail). Plank: elbowDeg and forearmRise only carry which plank it is.
 */
export function frontMetrics(pose: TrackedPose, cfg: EngineConfig, exercise: Exercise): BodyMetrics | null {
  const f = readFront(pose, cfg);
  if (!f) return null;
  const D = f.wrist ? (f.wrist.y - f.shoulder.y) / f.sw : null;
  const plank = exercise === 'plank';
  const forearm = plank && D !== null && D < cfg.front.forearmMaxD;
  return {
    t: pose.t,
    side: 'left',
    elbowDeg: plank ? (forearm ? 90 : 170) : null,
    bodyLineDeg: null,
    hipOffset: null,
    kneeDeg: null,
    neckDeg: null,
    trunkTiltDeg: isDown(f) ? 0 : 90,
    shoulderHeight: D,
    wristOffset: null,
    elbowStack: forearm ? f.elbowLateral : null,
    forearmRise: plank ? (forearm ? 0 : 1) : null,
    shoulderStack: null,
    trunkLiftDeg: null,
    footRise: null,
    elbowFlare: plank ? null : f.elbowFlare,
    shoulderTilt: plank ? null : f.tilt,
    torsoPx: f.sw,
    hipCenter: { x: f.shoulder.x / pose.width, y: f.shoulder.y / pose.height },
  };
}

/** Is this a valid start (push-up: straight arms; plank: forearms or straight arms), seen head-on? */
export function checkFrontStart(pose: TrackedPose, m: BodyMetrics, cfg: EngineConfig, exercise: Exercise): PlankCheck {
  const f = readFront(pose, cfg);
  const issues: PlankIssue[] = [];
  const c = cfg.front;
  if (!f) return { ok: false, issues: ['get-down'], variant: 'high' };
  const D = m.shoulderHeight;
  const forearm = m.forearmRise === 0;
  if (m.trunkTiltDeg !== 0 || D === null) issues.push('get-down');
  else if (exercise === 'pushup' && D < c.straightArmD) issues.push('straighten-arms');
  if (forearm) {
    if (m.elbowStack !== null && m.elbowStack > cfg.plank.maxElbowStack) issues.push('elbows-under-shoulders');
  } else if (cfg.plank.checkHands && f.handSpread !== null && (f.handSpread < c.minHandSpread || f.handSpread > c.maxHandSpread)) {
    issues.push('hands-under-shoulders');
  }
  return { ok: issues.length === 0, issues, variant: forearm ? 'forearm' : 'high' };
}

/**
 * Framing, head-on: the face, shoulders and both hands in view, at a size the
 * tracker can read, and the right way up.
 */
export class FrontFramingGate {
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
    const t = pose.t;
    if (meanVis < f.lowLightVisibility) {
      if (this.lowVisSince === null) this.lowVisSince = t;
    } else this.lowVisSince = null;
    const lowLight = this.lowVisSince !== null && t - this.lowVisSince >= f.lowLightMs;
    const fp = readFront(pose, this.cfg);
    if (!fp) return { ok: false, issue: lowLight ? 'low-light' : 'show-head', hint: null, meanVisibility: meanVis };

    // Upside down (Rotation Lock on in landscape): the shoulders show below the hands.
    if (fp.wrist && fp.shoulder.y - fp.wrist.y > 0.25 * fp.sw) {
      if (this.flippedSince === null) this.flippedSince = t;
      if (t - this.flippedSince >= f.upsideDownMs) return { ok: false, issue: 'upside-down', hint: null, meanVisibility: meanVis };
      return { ok: false, issue: null, hint: null, meanVisibility: meanVis };
    }
    this.flippedSince = null;

    if (f.requireHead && !fp.nose) return { ok: false, issue: 'show-head', hint: null, meanVisibility: meanVis };
    if (f.requireArms && !fp.bothWrists)
      return { ok: false, issue: lowLight ? 'low-light' : 'show-hands', hint: null, meanVisibility: meanVis };
    const share = fp.sw / pose.width;
    if (share > this.cfg.front.maxShoulderShare) return { ok: false, issue: 'move-back', hint: null, meanVisibility: meanVis };
    if (share < this.cfg.front.minShoulderShare) return { ok: false, issue: 'move-closer', hint: null, meanVisibility: meanVis };
    return { ok: true, issue: null, hint: lowLight ? 'low-light' : null, meanVisibility: meanVis };
  }
}

/** Points planted on the floor, for the handheld-screen check: both hands. */
export function frontContacts(pose: TrackedPose, cfg: EngineConfig): Vec2[] {
  return [LM.leftWrist, LM.rightWrist]
    .filter((i) => pose.vis[i] >= cfg.minVisibility)
    .map((i) => ({ x: pose.points[i].x / pose.width, y: pose.points[i].y / pose.height }));
}
