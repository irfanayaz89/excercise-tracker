import { LANDMARK_COUNT, LM, type Landmark, type PoseSample } from '../types';

/**
 * Synthetic pull-ups, seen head-on in a portrait picture: a body hanging from a
 * bar near the top of the frame, both arms modelled as two equal links, so the
 * elbow angle, the mouth over the bar and the hang come out of real geometry.
 */
export interface PullupPose {
  /** 0 = dead hang (straight arms), 1 = mouth just over the bar. */
  rise: number;
  /** Hips swinging sideways, in shoulder widths. */
  swing?: number;
  /** Knees driven up towards the hips: 0 = hanging straight, 1 = knees at hip height. */
  kneeLift?: number;
  /** Right shoulder higher than the left by this many shoulder widths. */
  tilt?: number;
  /** Hands off the bar (arms down at the sides). */
  offBar?: boolean;
  /** Visibility of every point. */
  vis?: number;
  /** Shoulder width in pixels (distance from the phone). */
  sw?: number;
  /** Legs out of the picture (low visibility from the knees down). */
  hideLegs?: boolean;
  /** Body moved sideways by this many pixels (someone else on the bar). */
  dx?: number;
}

const W = 720;
const H = 1280;

export function pullupSample(t: number, p: PullupPose): PoseSample {
  const sw = p.sw ?? 115;
  const cx = W / 2 + (p.dx ?? 0);
  const barY = 0.12 * H;
  const L = 0.8 * sw;
  const tilt = (p.tilt ?? 0) * sw;
  const swing = (p.swing ?? 0) * sw;
  // Shoulders: 1.6 shoulder widths under the bar at a dead hang, 0.35 at the top.
  const shY = barY + (1.6 - 1.25 * Math.min(1.1, Math.max(0, p.rise))) * sw;
  const ls = { x: cx - 0.5 * sw, y: shY + tilt / 2 };
  const rs = { x: cx + 0.5 * sw, y: shY - tilt / 2 };
  const pts: { x: number; y: number }[] = Array.from({ length: LANDMARK_COUNT }, () => ({ x: cx, y: shY }));

  const arm = (s: { x: number; y: number }, out: number) => {
    if (p.offBar) {
      const e = { x: s.x + out * 0.15 * sw, y: s.y + L };
      return { e, w: { x: e.x, y: e.y + L } };
    }
    const w = { x: cx + out * 0.75 * sw, y: barY };
    const dx = w.x - s.x;
    const dy = w.y - s.y;
    const d = Math.min(2 * L - 1e-6, Math.hypot(dx, dy));
    const m = { x: s.x + (dx * d) / Math.hypot(dx, dy) / 2, y: s.y + (dy * d) / Math.hypot(dx, dy) / 2 };
    // The elbow bends outwards, away from the body.
    const h = Math.sqrt(Math.max(0, L * L - (d / 2) * (d / 2)));
    const nx = -dy / Math.hypot(dx, dy);
    const ny = dx / Math.hypot(dx, dy);
    const sign = nx * out > 0 ? 1 : -1;
    return { e: { x: m.x + sign * nx * h, y: m.y + sign * ny * h }, w };
  };
  const la = arm(ls, -1);
  const ra = arm(rs, 1);
  const mouthY = shY - 0.45 * sw;
  const eyeY = mouthY - 0.18 * sw;
  const hip = { x: cx + swing, y: shY + 1.3 * sw };
  const kneeY = hip.y + 1.1 * sw * (1 - (p.kneeLift ?? 0));
  const set = (i: number, x: number, y: number) => (pts[i] = { x, y });
  set(LM.nose, cx, mouthY - 0.08 * sw);
  set(LM.leftEye, cx - 0.12 * sw, eyeY);
  set(LM.rightEye, cx + 0.12 * sw, eyeY);
  set(1, cx - 0.08 * sw, eyeY);
  set(3, cx - 0.16 * sw, eyeY);
  set(4, cx + 0.08 * sw, eyeY);
  set(6, cx + 0.16 * sw, eyeY);
  set(LM.leftEar, cx - 0.28 * sw, eyeY + 0.05 * sw);
  set(LM.rightEar, cx + 0.28 * sw, eyeY + 0.05 * sw);
  set(LM.mouthLeft, cx - 0.08 * sw, mouthY);
  set(LM.mouthRight, cx + 0.08 * sw, mouthY);
  set(LM.leftShoulder, ls.x, ls.y);
  set(LM.rightShoulder, rs.x, rs.y);
  set(LM.leftElbow, la.e.x, la.e.y);
  set(LM.rightElbow, ra.e.x, ra.e.y);
  set(LM.leftWrist, la.w.x, la.w.y);
  set(LM.rightWrist, ra.w.x, ra.w.y);
  for (const [i, dx] of [
    [17, -0.05],
    [19, -0.03],
    [21, -0.02],
    [18, 0.05],
    [20, 0.03],
    [22, 0.02],
  ] as const) {
    const w = dx < 0 ? la.w : ra.w;
    set(i, w.x + dx * sw, w.y - 0.08 * sw);
  }
  set(LM.leftHip, hip.x - 0.32 * sw, hip.y);
  set(LM.rightHip, hip.x + 0.32 * sw, hip.y);
  set(LM.leftKnee, hip.x - 0.3 * sw, kneeY);
  set(LM.rightKnee, hip.x + 0.3 * sw, kneeY);
  set(LM.leftAnkle, hip.x - 0.28 * sw, kneeY + 1.0 * sw);
  set(LM.rightAnkle, hip.x + 0.28 * sw, kneeY + 1.0 * sw);
  set(LM.leftHeel, hip.x - 0.3 * sw, kneeY + 1.08 * sw);
  set(LM.rightHeel, hip.x + 0.3 * sw, kneeY + 1.08 * sw);
  set(LM.leftFootIndex, hip.x - 0.26 * sw, kneeY + 1.12 * sw);
  set(LM.rightFootIndex, hip.x + 0.26 * sw, kneeY + 1.12 * sw);

  const v = p.vis ?? 0.95;
  const legs = new Set<number>([
    LM.leftKnee,
    LM.rightKnee,
    LM.leftAnkle,
    LM.rightAnkle,
    LM.leftHeel,
    LM.rightHeel,
    LM.leftFootIndex,
    LM.rightFootIndex,
  ]);
  const landmarks: Landmark[] = pts.map((q, i) => {
    const vi = p.hideLegs && legs.has(i) ? 0.1 : v;
    return { x: q.x / W, y: q.y / H, z: 0, visibility: vi, presence: vi };
  });
  return { t, width: W, height: H, landmarks };
}

/** A key pose and how long the move into it takes (ms). */
export interface PullupKey extends PullupPose {
  ms: number;
}

/** Frames at 30 fps moving linearly from key to key. */
export function pullupFrames(startT: number, keys: PullupKey[], from: PullupPose = { rise: 0 }): PoseSample[] {
  const out: PoseSample[] = [];
  let t = startT;
  let prev: PullupPose = from;
  for (const k of keys) {
    const n = Math.max(1, Math.round(k.ms / 33));
    for (let i = 1; i <= n; i++) {
      const a = i / n;
      const lerp = (x: number | undefined, y: number | undefined) => (x ?? 0) + ((y ?? 0) - (x ?? 0)) * a;
      t += 33;
      out.push(
        pullupSample(t, {
          rise: lerp(prev.rise, k.rise),
          swing: lerp(prev.swing, k.swing),
          kneeLift: lerp(prev.kneeLift, k.kneeLift),
          tilt: lerp(prev.tilt, k.tilt),
          offBar: k.offBar,
          vis: k.vis,
          sw: k.sw,
          hideLegs: k.hideLegs,
          dx: k.dx,
        }),
      );
    }
    prev = k;
  }
  return out;
}

/** One strict pull-up from a dead hang: up in `upMs`, a beat at the top, down in `downMs`. */
export function pullupRep(opts: Partial<PullupPose> & { upMs?: number; downMs?: number; peak?: number } = {}): PullupKey[] {
  const { upMs = 900, downMs = 1100, peak = 1, ...rest } = opts;
  return [
    { ...rest, rise: peak, ms: upMs },
    { ...rest, rise: peak, ms: 200 },
    { rise: 0, ms: downMs },
    { rise: 0, ms: 500 },
  ];
}
