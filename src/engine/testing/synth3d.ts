/**
 * Front-view synthetic bodies. The side-view builders give each pose in the
 * body's own plane (along the body and up); this lifts it into 3D with the
 * body's real widths (shoulders, hips, hands, flaring elbows) and photographs
 * it with a phone camera placed in front: on the floor at the head end for
 * push-ups and planks, at the feet for crunches, square to the chest for the
 * side plank. One body, any view, so front and side tests describe the same movement.
 */
import { LANDMARK_COUNT, LM, type Landmark, type PoseSample, type Vec2 } from '../types';
import { buildBody, mulberry32, type BodyParams, type Segment, type TimelineOptions } from './synth';

/** Metres. X along the body (head → feet), Y up, Z to the body's left. */
interface P3 {
  x: number;
  y: number;
  z: number;
}

export interface FrontParams {
  /** Extra elbow flare out to the side at the bottom of a push-up (metres, 0 = tucked at 45°). */
  flare?: number;
  /** Left shoulder lower than the right (metres): an uneven, twisted rep. */
  tiltM?: number;
  /** Camera distance from the head end (push-ups, planks) or the feet (crunches), metres. */
  distanceM?: number;
  /** Camera lens height above the floor, metres. */
  cameraHeightM?: number;
  /** Camera sideways off the body's midline, metres. */
  offCentreM?: number;
  /** Visibility for joints hidden behind the torso (hips, knees, ankles seen head-on). */
  hiddenVis?: number;
}

const SHOULDER = 0.19;
const HIP = 0.15;
const HAND = 0.26;
const KNEE = 0.12;
const ANKLE = 0.13;
const EAR = 0.075;

/**
 * Projects a 3D point through a pinhole camera at `cam` looking along +X (or −X),
 * tilted down by `pitch` radians.
 */
function project(p: P3, cam: P3, lookDir: 1 | -1, f: number, W: number, H: number, pitch = 0): Vec2 & { depth: number } {
  const rx = (p.x - cam.x) * lookDir;
  const ry = p.y - cam.y;
  // Forward (rx, ry) along (cos, −sin) of the pitch; up is perpendicular.
  const depth = rx * Math.cos(pitch) - ry * Math.sin(pitch);
  const up = rx * Math.sin(pitch) + ry * Math.cos(pitch);
  const d = Math.max(0.05, depth);
  // Image x grows to the camera's right; looking along +X, the body's left (+Z) is on the camera's left.
  const u = W / 2 - (lookDir * f * (p.z - cam.z)) / d;
  const v = H / 2 - (f * up) / d;
  return { x: u, y: v, depth };
}

/**
 * Push-up arm in the body's plane, in metres from the hands: the forearm stays
 * near upright and the upper arm swings down, so the shoulders drop to about
 * forearm height at 90° (side-view synth bodies keep the arm in a vertical
 * triangle, which leaves the shoulders too high for head-on depth tests).
 */
function pushupArm(elbowDeg: number): { shoulderH: number; forward: number } {
  const F = 0.27;
  const U = 0.3;
  const phi = ((Math.min(178, Math.max(60, elbowDeg)) - 90) * Math.PI) / 180;
  return { shoulderH: 0.03 + F + U * Math.sin(phi), forward: 0.06 * (1 - Math.sin(phi)) };
}

/**
 * Renders a front-view sample. `params` are the usual side-view body params
 * (elbowDeg, sag, kneeDeg, forearm, crunch, …); the pose is built side-on and lifted to 3D.
 */
export function renderFront(t: number, params: BodyParams, front: FrontParams = {}, rand: () => number = Math.random): PoseSample {
  const width = params.width ?? 1280;
  const height = params.height ?? 720;
  // A side-view body in its own plane, head on the left (x grows towards the feet).
  const side = buildBody({ ...params, facing: 'left', imageRollDeg: 0, viewScale: 1, width: 4000, height: 4000, floorY: 3000 });
  const s = 0.5 / side.torsoPx; // metres per pixel: a torso is about half a metre
  const floorY = 3000;
  const sag = (q: Vec2) => ({ x: q.x * s, y: (floorY - q.y) * s });
  const P = { ...side.pts };
  // Straight-arm push-up or high plank: real arm mechanics (see pushupArm).
  if (!params.crunch && !params.forearm && !(params.stack ?? 0)) {
    const arm = pushupArm(params.elbowDeg);
    const w = P.wrist;
    const sh = { x: w.x - arm.forward / s, y: floorY - arm.shoulderH / s };
    const dx = sh.x - P.shoulder.x;
    const dy = sh.y - P.shoulder.y;
    // Move the trunk with the shoulders, keep the feet planted.
    const span = P.ankle.x - P.shoulder.x;
    const follow = (q: Vec2): Vec2 => {
      const k = Math.max(0, Math.min(1, 1 - (q.x - P.shoulder.x) / span));
      return { x: q.x + dx * k, y: q.y + dy * k };
    };
    P.hip = follow(P.hip);
    P.knee = follow(P.knee);
    P.ear = { x: P.ear.x + dx, y: P.ear.y + dy };
    P.shoulder = sh;
    P.elbow = { x: (sh.x + w.x) / 2 + 0.05 / s, y: floorY - (0.03 + 0.27) / s };
    if (params.elbowDeg > 160) P.elbow = { x: (sh.x + w.x) / 2, y: (sh.y + w.y) / 2 };
  }
  const lifted = (q: Vec2, z: number, dy = 0): P3 => ({ ...sag(q), y: sag(q).y + dy, z });

  const crunch = !!params.crunch;
  const sidePlank = (params.stack ?? 0) > 0;
  const bend = Math.max(0, Math.min(1, (172 - params.elbowDeg) / 87));
  const elbowOut = 0.04 + (front.flare ?? 0) * bend;
  const tilt = front.tiltM ?? 0;

  // Both sides of the body: left is +Z.
  const sideOf = (sign: 1 | -1) => {
    const lo = sign === 1 ? -tilt / 2 : tilt / 2; // left side lower by tilt
    return {
      shoulder: lifted(P.shoulder, sign * SHOULDER, lo),
      elbow: lifted(P.elbow, sign * (SHOULDER + elbowOut), lo),
      wrist: lifted(P.wrist, sign * HAND, lo * 0.3),
      hip: lifted(P.hip, sign * HIP),
      knee: lifted(P.knee, sign * KNEE),
      ankle: lifted(P.ankle, sign * ANKLE),
      ear: lifted(P.ear, sign * EAR, lo),
    };
  };
  let L = sideOf(1);
  let R = sideOf(-1);
  let nose: P3 = { ...lifted(P.ear, 0), y: sag(P.ear).y - 0.02 };

  // Side plank facing the camera: the body lies along Z instead, chest to the
  // camera; turn the side-view plane (along, up) into (lateral, up) and stack the hips.
  let cam: P3;
  let look: 1 | -1;
  const dist = front.distanceM ?? (crunch ? 2.0 : 1.4);
  // Crunches: the phone is raised (a chair or box) and tilted down, so the knees do not hide the chest.
  const camH = front.cameraHeightM ?? (crunch ? 0.5 : 0.1);
  let pitch = 0;
  const off = front.offCentreM ?? 0;
  if (sidePlank) {
    const rot = (q: P3, depthBack: number): P3 => ({ x: depthBack, y: q.y, z: -(q.x - 1.2) });
    const down = sideOf(1);
    const stackM = (params.stack ?? 0.7) * 0.5;
    const up = (q: P3): P3 => ({ ...q, y: q.y + stackM });
    L = Object.fromEntries(Object.entries(down).map(([k, v]) => [k, rot(v, 0)])) as typeof L;
    R = Object.fromEntries(Object.entries(down).map(([k, v]) => [k, rot(up(v), -0.02)])) as typeof R;
    nose = rot({ ...down.ear, y: down.ear.y + stackM / 2 }, -0.1);
    cam = { x: -2.2, y: 0.35, z: off };
    look = 1;
  } else if (crunch) {
    // Camera at the feet, looking back along the body towards the head.
    const feetX = Math.max(L.ankle.x, R.ankle.x);
    cam = { x: feetX + dist, y: camH, z: off };
    look = -1;
    // Aim at the hips.
    pitch = Math.atan2(camH - L.hip.y, cam.x - L.hip.x);
  } else {
    // Camera on the floor beyond the hands, looking along the body at the face.
    const headX = Math.min(L.wrist.x, L.ear.x, R.wrist.x);
    cam = { x: headX - dist, y: camH, z: off };
    look = 1;
  }

  const f = 0.75 * Math.max(width, height);
  const hidden = front.hiddenVis ?? (sidePlank ? 0.95 : 0.45);
  const noise = params.noisePx ?? 0;
  const jitter = () => (noise ? (rand() + rand() + rand() - 1.5) * noise : 0);
  const lms: Landmark[] = Array.from({ length: LANDMARK_COUNT }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.9, presence: 0.99 }));
  const put = (i: number, p: P3, vis: number) => {
    const q = project(p, cam, look, f, width, height, pitch);
    // Off the picture: a real tracker loses the point (low visibility and presence).
    const inside = q.x >= 0 && q.x <= width && q.y >= 0 && q.y <= height;
    lms[i] = {
      x: (q.x + jitter()) / width,
      y: (q.y + jitter()) / height,
      z: (q.depth - dist) / 2,
      visibility: inside ? vis : 0.1,
      presence: inside ? 0.99 : 0.2,
    };
  };
  const near = 0.95;
  // Head-on, the hips and legs sit behind the torso (push-ups, planks); for crunches the head hides behind the knees less.
  const backVis = sidePlank ? near : crunch ? 0.8 : hidden;
  const hide = params.hide ?? {};
  for (const [side3, prefix] of [
    [L, 'left'],
    [R, 'right'],
  ] as const) {
    const idx = (n: string) => (LM as Record<string, number>)[`${prefix}${n}`];
    put(idx('Shoulder'), side3.shoulder, hide.shoulder ?? near);
    put(idx('Elbow'), side3.elbow, hide.elbow ?? near);
    put(idx('Wrist'), side3.wrist, hide.wrist ?? near);
    put(idx('Hip'), side3.hip, hide.hip ?? backVis);
    put(idx('Knee'), side3.knee, hide.knee ?? (crunch ? near : backVis));
    put(idx('Ankle'), side3.ankle, hide.ankle ?? (crunch ? near : backVis));
    put(idx('Ear'), side3.ear, hide.ear ?? near);
    put(idx('Heel'), side3.ankle, hide.ankle ?? backVis);
    put(idx('FootIndex'), side3.ankle, hide.ankle ?? backVis);
  }
  put(LM.nose, nose, near);
  return { t, width, height, landmarks: lms };
}

/** Like `timeline`, but photographed head-on (see renderFront). */
export function timelineFront(
  segments: Segment[],
  opts: TimelineOptions & { front?: FrontParams | ((k: number, i: number) => FrontParams) } = {},
): PoseSample[] {
  const fps = opts.fps ?? 30;
  const dt = 1000 / fps;
  const rand = mulberry32(opts.seed ?? 11);
  let t = opts.startT ?? 1000;
  const out: PoseSample[] = [];
  let i = 0;
  segments.forEach((seg, si) => {
    const n = Math.max(1, Math.round(seg.durationMs / dt));
    for (let f = 0; f < n; f++) {
      const k = n === 1 ? 1 : f / (n - 1);
      if (!opts.dropFrame?.(i, t)) {
        const front = typeof opts.front === 'function' ? opts.front(k, si) : opts.front;
        let s = renderFront(t, { ...opts.base, ...seg.at(k) }, front ?? {}, rand);
        if (opts.mapFrame) s = opts.mapFrame(s, t);
        out.push(s);
      }
      t += dt;
      i++;
    }
  });
  return out;
}
