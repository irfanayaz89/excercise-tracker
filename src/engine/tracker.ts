import type { EngineConfig } from './config';
import { angleDeg, dist, signedOffsetBelowLine, signedTiltDeg } from './geometry';
import { OneEuroFilter } from './oneEuro';
import { LANDMARK_COUNT, LM, type BodyMetrics, type PoseSample, type Side, type SideChain, type Vec2 } from './types';

/** Smoothed landmarks for one frame, in pixel space. */
export interface TrackedPose {
  t: number;
  width: number;
  height: number;
  /** True when the model found a person in this frame. */
  detected: boolean;
  points: Vec2[];
  /** Effective visibility: 0 once a point has been missing longer than the hold window. */
  vis: number[];
  /** True when the point is a held value from an earlier frame. */
  held: boolean[];
}

/**
 * Smooths landmarks with a One Euro filter per coordinate and bridges short
 * dropouts by holding the last good position for `landmarkHoldMs`.
 *
 * Handles: duplicate or out-of-order timestamps (ignored), long frame gaps
 * (filters reset), empty detections (points held, then dropped).
 */
export class PoseTracker {
  private fx: OneEuroFilter[] = [];
  private fy: OneEuroFilter[] = [];
  private lastGood: ({ p: Vec2; v: number; t: number } | null)[] = [];
  private lastT: number | null = null;
  private lastSize = '';

  constructor(private cfg: EngineConfig) {
    const { minCutoff, beta, dCutoff } = cfg.oneEuro;
    for (let i = 0; i < LANDMARK_COUNT; i++) {
      // Filters run in normalized units (0..1), where the beta value is calibrated.
      this.fx.push(new OneEuroFilter(minCutoff, beta, dCutoff));
      this.fy.push(new OneEuroFilter(minCutoff, beta, dCutoff));
      this.lastGood.push(null);
    }
  }

  reset(): void {
    this.fx.forEach((f) => f.reset());
    this.fy.forEach((f) => f.reset());
    this.lastGood = this.lastGood.map(() => null);
    this.lastT = null;
  }

  update(sample: PoseSample): TrackedPose | null {
    if (!Number.isFinite(sample.t) || sample.width <= 0 || sample.height <= 0) return null;
    if (this.lastT !== null) {
      if (sample.t <= this.lastT) return null; // stale or duplicate frame
      if (sample.t - this.lastT > this.cfg.maxFrameGapMs) this.reset();
    }
    this.lastT = sample.t;
    const size = `${sample.width}x${sample.height}`;
    if (size !== this.lastSize) {
      // Rotation or resolution change: pixel positions from before are meaningless.
      if (this.lastSize) this.reset();
      this.lastSize = size;
      this.lastT = sample.t;
    }

    const detected = sample.landmarks.length >= LANDMARK_COUNT;
    const points: Vec2[] = [];
    const vis: number[] = [];
    const held: boolean[] = [];

    for (let i = 0; i < LANDMARK_COUNT; i++) {
      const lm = detected ? sample.landmarks[i] : undefined;
      const v = lm ? Math.min(lm.visibility, lm.presence ?? 1) : 0;
      const valid = lm !== undefined && v >= this.cfg.minVisibility && isFinitePoint(lm.x, lm.y);

      if (valid) {
        const px = this.fx[i].filter(lm.x, sample.t) * sample.width;
        const py = this.fy[i].filter(lm.y, sample.t) * sample.height;
        const p = { x: px, y: py };
        this.lastGood[i] = { p, v, t: sample.t };
        points.push(p);
        vis.push(v);
        held.push(false);
        continue;
      }

      const last = this.lastGood[i];
      if (last && sample.t - last.t <= this.cfg.landmarkHoldMs) {
        points.push(last.p);
        vis.push(last.v);
        held.push(true);
      } else {
        // Missing: keep the raw guess for drawing, but zero visibility.
        if (last) {
          this.fx[i].reset();
          this.fy[i].reset();
          this.lastGood[i] = null;
        }
        points.push(lm && isFinitePoint(lm.x, lm.y) ? { x: lm.x * sample.width, y: lm.y * sample.height } : { x: 0, y: 0 });
        vis.push(0);
        held.push(false);
      }
    }

    return { t: sample.t, width: sample.width, height: sample.height, detected, points, vis, held };
  }
}

function isFinitePoint(x: number, y: number): boolean {
  return Number.isFinite(x) && Number.isFinite(y);
}

const SIDE_IDX = {
  left: {
    shoulder: LM.leftShoulder,
    elbow: LM.leftElbow,
    wrist: LM.leftWrist,
    hip: LM.leftHip,
    knee: LM.leftKnee,
    ankle: LM.leftAnkle,
    ear: LM.leftEar,
  },
  right: {
    shoulder: LM.rightShoulder,
    elbow: LM.rightElbow,
    wrist: LM.rightWrist,
    hip: LM.rightHip,
    knee: LM.rightKnee,
    ankle: LM.rightAnkle,
    ear: LM.rightEar,
  },
} as const;

export function sideScore(pose: TrackedPose, side: Side): number {
  const idx = SIDE_IDX[side];
  return (
    (pose.vis[idx.shoulder] + pose.vis[idx.elbow] + pose.vis[idx.wrist] + pose.vis[idx.hip] + pose.vis[idx.knee] + pose.vis[idx.ankle]) / 6
  );
}

/**
 * Picks the body side facing the camera. The far side is mostly hidden in a
 * side view, but the model still returns guesses for it, so we must not mix
 * sides. Switches only after the other side leads clearly for a while, which
 * prevents left/right flicker.
 */
export class SideSelector {
  private side: Side | null = null;
  private challengerSince: number | null = null;

  constructor(private cfg: EngineConfig) {}

  reset(): void {
    this.side = null;
    this.challengerSince = null;
  }

  get current(): Side | null {
    return this.side;
  }

  update(pose: TrackedPose): Side {
    const l = sideScore(pose, 'left');
    const r = sideScore(pose, 'right');
    if (this.side === null) {
      this.side = l >= r ? 'left' : 'right';
      return this.side;
    }
    const cur = this.side === 'left' ? l : r;
    const other = this.side === 'left' ? r : l;
    if (other > cur + this.cfg.sideSwitchMargin) {
      if (this.challengerSince === null) this.challengerSince = pose.t;
      if (pose.t - this.challengerSince >= this.cfg.sideSwitchMs) {
        this.side = this.side === 'left' ? 'right' : 'left';
        this.challengerSince = null;
      }
    } else {
      this.challengerSince = null;
    }
    return this.side;
  }
}

export function buildChain(pose: TrackedPose, side: Side): SideChain {
  const i = SIDE_IDX[side];
  return {
    side,
    shoulder: pose.points[i.shoulder],
    elbow: pose.points[i.elbow],
    wrist: pose.points[i.wrist],
    hip: pose.points[i.hip],
    knee: pose.points[i.knee],
    ankle: pose.points[i.ankle],
    ear: pose.points[i.ear],
    vis: {
      shoulder: pose.vis[i.shoulder],
      elbow: pose.vis[i.elbow],
      wrist: pose.vis[i.wrist],
      hip: pose.vis[i.hip],
      knee: pose.vis[i.knee],
      ankle: pose.vis[i.ankle],
      ear: pose.vis[i.ear],
    },
  };
}

/**
 * Derives the measurements the rules work with. Any measurement whose joints
 * are not visible is `null`; downstream code must treat null as "unknown",
 * never as a pass or a fail.
 *
 * @param horizonRollDeg how far the phone's horizon is rotated, so a level
 *   body still reads as level when the phone is slightly crooked.
 */
export function computeMetrics(chain: SideChain, pose: TrackedPose, horizonRollDeg: number, cfg: EngineConfig): BodyMetrics | null {
  const ok = (v: number) => v >= cfg.minVisibility;
  const v = chain.vis;
  if (!ok(v.shoulder) || !ok(v.hip)) return null;

  const torsoPx = dist(chain.shoulder, chain.hip);
  if (torsoPx < 8) return null; // degenerate: person too far or collapsed detection

  const elbowDeg = ok(v.elbow) && ok(v.wrist) ? angleDeg(chain.shoulder, chain.elbow, chain.wrist) : null;
  const hasAnkle = ok(v.ankle);
  const bodyLineDeg = hasAnkle ? angleDeg(chain.shoulder, chain.hip, chain.ankle) : null;
  const off = hasAnkle ? signedOffsetBelowLine(chain.shoulder, chain.ankle, chain.hip) : null;
  const hipOffset = off === null ? null : off / torsoPx;
  const kneeDeg = ok(v.knee) && hasAnkle ? angleDeg(chain.hip, chain.knee, chain.ankle) : null;
  const neckDeg = ok(v.ear) ? angleDeg(chain.ear, chain.shoulder, chain.hip) : null;

  // Trunk line: shoulder→ankle when the feet are visible, else shoulder→hip.
  const far = hasAnkle ? chain.ankle : chain.hip;
  const rawTilt = signedTiltDeg(chain.shoulder, far);
  // Which way a crooked phone rotates the image depends on the camera (the front
  // camera's image is mirrored), so correct both ways and keep the smaller tilt.
  // The correction is only for a few degrees of crookedness; it never adds tilt.
  const trunkTiltDeg = rawTilt === null ? null : Math.min(Math.abs(rawTilt - horizonRollDeg), Math.abs(rawTilt + horizonRollDeg));

  const shoulderHeight = ok(v.wrist) ? (chain.wrist.y - chain.shoulder.y) / torsoPx : null;
  const wristOffset = ok(v.wrist) ? Math.abs(chain.wrist.x - chain.shoulder.x) / torsoPx : null;
  const elbowStack = ok(v.elbow) ? Math.abs(chain.elbow.x - chain.shoulder.x) / torsoPx : null;
  const forearmRise = ok(v.elbow) && ok(v.wrist) ? Math.abs(chain.wrist.y - chain.elbow.y) / torsoPx : null;

  const hip = { x: chain.hip.x / pose.width, y: chain.hip.y / pose.height };

  return {
    t: pose.t,
    side: chain.side,
    elbowDeg,
    bodyLineDeg,
    hipOffset,
    kneeDeg,
    neckDeg,
    trunkTiltDeg,
    shoulderHeight,
    wristOffset,
    elbowStack,
    forearmRise,
    torsoPx,
    hipCenter: hip,
  };
}
