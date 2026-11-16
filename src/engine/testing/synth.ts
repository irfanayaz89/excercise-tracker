/**
 * Synthetic side-view push-up skeletons for tests and the in-app demo mode.
 *
 * Builds a physically consistent 2D body from a few parameters (elbow angle,
 * hip sag, knee bend, facing) and renders it to MediaPipe-style normalized
 * landmarks, with the near side visible and the far side mostly hidden, as a
 * real side-view camera would see it.
 */
import { LANDMARK_COUNT, LM, type Landmark, type PhoneAttitude, type PoseSample, type Vec2 } from '../types';

export interface BodyParams {
  elbowDeg: number;
  /** Hip offset from the straight shoulder–ankle line in torso lengths. + = sag, − = pike. */
  sag?: number;
  /** 180 = straight legs. */
  kneeDeg?: number;
  /** 'left' = head on the left of the image. */
  facing?: 'left' | 'right';
  /** Extra rotation of the whole body (e.g. 80 = standing up). */
  bodyTiltDeg?: number;
  /** Image rotation from a crooked phone. */
  imageRollDeg?: number;
  /** Shoulder–hip length in pixels. */
  torsoPx?: number;
  /** Wrist position in pixels. */
  wristX?: number;
  floorY?: number;
  width?: number;
  height?: number;
  visNear?: number;
  visFar?: number;
  /** Per-joint visibility override for the near side. */
  hide?: Partial<Record<'shoulder' | 'elbow' | 'wrist' | 'hip' | 'knee' | 'ankle' | 'ear', number>>;
  /** Gaussian-ish pixel noise amplitude. */
  noisePx?: number;
  rand?: () => number;
  /** Shoulders spread apart, as when facing the camera (torso lengths). */
  shoulderWidth?: number;
  /** Forearm plank: forearm flat on the floor, upper arm up to the shoulder. `elbowDeg` is ignored. */
  forearm?: boolean;
  /** Forearm plank: shoulders ahead of the elbows (towards the head) by this many torso lengths; negative = behind. */
  elbowStack?: number;
  /**
   * Side plank, facing the camera: the top side of the body is in view, this many
   * torso lengths above the bottom (supporting) side, top arm resting on the hip.
   * The near side is the one on the floor.
   */
  stack?: number;
  /** Forearm plank: share of the forearm seen side-on (hands clasped in front point the forearm partly away). */
  forearmScale?: number;
  /**
   * Camera not quite side-on: horizontal distances shrink by this factor
   * (cos of the angle, e.g. 0.77 for 40° off side-on), as in a photo taken from
   * the front-side.
   */
  viewScale?: number;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rad = (d: number) => (d * Math.PI) / 180;

function rotate(p: Vec2, c: Vec2, deg: number): Vec2 {
  const a = rad(deg);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * Math.cos(a) - dy * Math.sin(a), y: c.y + dx * Math.sin(a) + dy * Math.cos(a) };
}

/** Returns pixel positions of the near-side chain. */
export function buildBody(params: BodyParams) {
  const T = params.torsoPx ?? 240;
  const width = params.width ?? 1280;
  const height = params.height ?? 720;
  const dir = (params.facing ?? 'left') === 'left' ? 1 : -1; // feet direction along x
  const floorY = params.floorY ?? height * 0.82;
  const wristX = params.wristX ?? (dir === 1 ? width * 0.22 : width * 0.78);
  const U = 0.6 * T;
  const F = 0.54 * T;
  const theta = rad(Math.max(10, Math.min(180, params.elbowDeg)));

  let wrist: Vec2;
  let shoulder: Vec2;
  let elbow: Vec2;
  if (params.forearm) {
    // Elbow on the floor, forearm pointing towards the head, upper arm up to the shoulder.
    const stack = (params.elbowStack ?? 0) * T;
    elbow = { x: wristX, y: floorY };
    wrist = { x: wristX - dir * F * (params.forearmScale ?? 1), y: floorY };
    shoulder = { x: wristX - dir * stack, y: floorY - Math.sqrt(Math.max(1, U * U - stack * stack)) };
  } else {
    wrist = { x: wristX, y: floorY };
    const d = Math.sqrt(U * U + F * F - 2 * U * F * Math.cos(theta));
    shoulder = { x: wristX, y: floorY - d };

    // Elbow: intersection of circle(shoulder, U) and circle(wrist, F), on the feet side.
    const a = (U * U - F * F + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, U * U - a * a));
    const mid = { x: shoulder.x + (a * (wrist.x - shoulder.x)) / d, y: shoulder.y + (a * (wrist.y - shoulder.y)) / d };
    elbow = { x: mid.x + dir * h, y: mid.y };
  }

  const lineLen = 2.8 * T;
  const ankleY = floorY - 0.06 * T;
  const dyA = ankleY - shoulder.y;
  const ankle = { x: shoulder.x + dir * Math.sqrt(Math.max(1, lineLen * lineLen - dyA * dyA)), y: ankleY };

  // Hip on the shoulder–ankle line, pushed along the "down" normal by sag.
  const sx = ankle.x - shoulder.x;
  const sy = ankle.y - shoulder.y;
  const len = Math.hypot(sx, sy);
  let nx = -sy / len;
  let ny = sx / len;
  if (ny < 0) {
    nx = -nx;
    ny = -ny;
  }
  const sag = (params.sag ?? 0) * T;
  const along = 0.36;
  const hip = { x: shoulder.x + sx * along + nx * sag, y: shoulder.y + sy * along + ny * sag };

  // Knee: equal thigh/shin segments meeting at kneeDeg, bent toward the floor.
  const phi = rad(Math.max(30, Math.min(180, params.kneeDeg ?? 180)));
  const hx = ankle.x - hip.x;
  const hy = ankle.y - hip.y;
  const hl = Math.hypot(hx, hy);
  const seg = hl / (2 * Math.sin(phi / 2));
  const off = Math.sqrt(Math.max(0, seg * seg - (hl / 2) * (hl / 2)));
  let kx = -hy / hl;
  let ky = hx / hl;
  if (ky < 0) {
    kx = -kx;
    ky = -ky;
  }
  const knee = { x: (hip.x + ankle.x) / 2 + kx * off, y: (hip.y + ankle.y) / 2 + ky * off };

  const ear = { x: shoulder.x - dir * 0.38 * T, y: shoulder.y - 0.02 * T };

  let pts = { shoulder, elbow, wrist, hip, knee, ankle, ear };
  const tilt = params.bodyTiltDeg ?? 0;
  if (tilt) {
    const pivot = ankle;
    pts = mapPts(pts, (p) => rotate(p, pivot, dir * tilt));
  }
  const view = params.viewScale ?? 1;
  if (view !== 1) {
    const cx = width / 2;
    pts = mapPts(pts, (p) => ({ x: cx + (p.x - cx) * view, y: p.y }));
  }
  const roll = params.imageRollDeg ?? 0;
  if (roll) {
    const c = { x: width / 2, y: height / 2 };
    pts = mapPts(pts, (p) => rotate(p, c, roll));
  }
  return { pts, width, height, dir, torsoPx: T };
}

function mapPts<T extends Record<string, Vec2>>(o: T, f: (p: Vec2) => Vec2): T {
  const out: Record<string, Vec2> = {};
  for (const k of Object.keys(o)) out[k] = f(o[k]);
  return out as T;
}

/** Renders a body to a PoseSample at time `t`. */
export function renderPose(t: number, params: BodyParams): PoseSample {
  const { pts, width, height, dir, torsoPx } = buildBody(params);
  const rand = params.rand ?? Math.random;
  const noise = params.noisePx ?? 0;
  const near = params.visNear ?? 0.95;
  const far = params.visFar ?? 0.25;
  const hide = params.hide ?? {};
  const jitter = () => (noise ? (rand() + rand() + rand() - 1.5) * noise : 0);

  // Head on the left with feet to the right shows the body's left side to the camera
  // when lying face down; the exact convention does not matter for the engine.
  const nearSide = dir === 1 ? 'left' : 'right';
  const idx = (name: string, side: 'left' | 'right') => (LM as Record<string, number>)[`${side}${name[0].toUpperCase()}${name.slice(1)}`];

  const lms: Landmark[] = Array.from({ length: LANDMARK_COUNT }, () => ({
    x: pts.ear.x / width,
    y: pts.ear.y / height,
    z: 0,
    visibility: near,
    presence: 0.99,
  }));
  const sw = (params.shoulderWidth ?? 0.12) * torsoPx;
  const stack = (params.stack ?? 0) * torsoPx;
  // Side plank: the top side sits above the bottom one; the top arm rests on the top hip.
  const top = (q: Vec2): Vec2 => ({ x: q.x, y: q.y - stack });
  const topArm = {
    wrist: top(pts.hip),
    elbow: { x: (pts.shoulder.x + pts.hip.x) / 2, y: (pts.shoulder.y + pts.hip.y) / 2 - stack - 0.25 * torsoPx },
  };
  for (const name of ['shoulder', 'elbow', 'wrist', 'hip', 'knee', 'ankle', 'ear'] as const) {
    const p = pts[name];
    const nv = hide[name] ?? near;
    const ni = idx(name, nearSide);
    const fi = idx(name, nearSide === 'left' ? 'right' : 'left');
    lms[ni] = { x: (p.x + jitter()) / width, y: (p.y + jitter()) / height, z: 0, visibility: nv, presence: 0.99 };
    if (stack > 0) {
      const q = name === 'elbow' || name === 'wrist' ? topArm[name] : top(p);
      lms[fi] = { x: (q.x + jitter()) / width, y: (q.y + jitter()) / height, z: -0.1, visibility: hide[name] ?? near, presence: 0.99 };
      continue;
    }
    const spread = name === 'shoulder' ? sw : 6;
    lms[fi] = { x: (p.x + spread + jitter()) / width, y: (p.y - 4 + jitter()) / height, z: 0.1, visibility: far, presence: 0.9 };
  }
  // Feet details follow the ankles.
  lms[LM.leftHeel] = { ...lms[LM.leftAnkle] };
  lms[LM.rightHeel] = { ...lms[LM.rightAnkle] };
  lms[LM.leftFootIndex] = { ...lms[LM.leftAnkle] };
  lms[LM.rightFootIndex] = { ...lms[LM.rightAnkle] };
  return { t, width, height, landmarks: lms };
}

export function levelPhone(t: number, rollDeg = 0, pitchDeg = 0, motion = 0): PhoneAttitude {
  return { t, rollDeg, pitchDeg, motionDegPerSec: motion };
}

export interface Segment {
  durationMs: number;
  /** Body parameters as a function of progress 0..1 within this segment. */
  at: (k: number) => BodyParams;
}

/** Plank hold at lockout. */
export const hold = (durationMs: number, extra: Partial<BodyParams> = {}): Segment => ({
  durationMs,
  at: () => ({ elbowDeg: 172, ...extra }),
});

/**
 * A timed plank. `extra` can change over the segment (k = 0..1), e.g. hips
 * slowly sagging: plank(20000, (k) => ({ sag: 0.2 * k })).
 */
export const plank = (
  durationMs: number,
  extra: Partial<BodyParams> | ((k: number) => Partial<BodyParams>) = {},
): Segment => ({
  durationMs,
  at: (k) => ({ elbowDeg: 172, ...(typeof extra === 'function' ? extra(k) : extra) }),
});

/**
 * Side plank on the forearm, facing the camera: forearm pointing at the camera
 * (so the wrist shows next to the elbow), top side stacked above.
 */
export const sidePlank = (
  durationMs: number,
  extra: Partial<BodyParams> | ((k: number) => Partial<BodyParams>) = {},
): Segment =>
  plank(durationMs, (k) => ({ forearm: true, forearmScale: 0.1, stack: 0.7, ...(typeof extra === 'function' ? extra(k) : extra) }));

/** Forearm plank shorthand. */
export const forearmPlank = (
  durationMs: number,
  extra: Partial<BodyParams> | ((k: number) => Partial<BodyParams>) = {},
): Segment => plank(durationMs, (k) => ({ forearm: true, ...(typeof extra === 'function' ? extra(k) : extra) }));

/** One rep from `topDeg` down to `bottomDeg` and back, with a cosine profile. */
export const rep = (
  durationMs: number,
  bottomDeg = 80,
  topDeg = 172,
  extra: Partial<BodyParams> | ((k: number) => Partial<BodyParams>) = {},
): Segment => ({
  durationMs,
  at: (k) => {
    const e = typeof extra === 'function' ? extra(k) : extra;
    const w = (1 - Math.cos(2 * Math.PI * k)) / 2; // 0 → 1 → 0
    return { elbowDeg: topDeg - (topDeg - bottomDeg) * w, ...e };
  },
});

/** A rep that starts and ends at different heights (for no-lockout sequences). */
export const move = (durationMs: number, fromDeg: number, toDeg: number, extra: Partial<BodyParams> = {}): Segment => ({
  durationMs,
  at: (k) => ({ elbowDeg: fromDeg + ((toDeg - fromDeg) * (1 - Math.cos(Math.PI * k))) / 2, ...extra }),
});

export interface TimelineOptions {
  fps?: number;
  startT?: number;
  base?: Partial<BodyParams>;
  /** Drop frames whose index matches. */
  dropFrame?: (i: number, t: number) => boolean;
  /** Replace a frame's sample (e.g. empty detection). */
  mapFrame?: (s: PoseSample, t: number) => PoseSample;
  seed?: number;
}

/** Expands segments into timestamped pose samples. */
export function timeline(segments: Segment[], opts: TimelineOptions = {}): PoseSample[] {
  const fps = opts.fps ?? 30;
  const dt = 1000 / fps;
  const rand = mulberry32(opts.seed ?? 7);
  let t = opts.startT ?? 1000;
  const out: PoseSample[] = [];
  let i = 0;
  for (const seg of segments) {
    const n = Math.max(1, Math.round(seg.durationMs / dt));
    for (let f = 0; f < n; f++) {
      const k = n === 1 ? 1 : f / (n - 1);
      if (!opts.dropFrame?.(i, t)) {
        let s = renderPose(t, { rand, ...opts.base, ...seg.at(k) });
        if (opts.mapFrame) s = opts.mapFrame(s, t);
        out.push(s);
      }
      t += dt;
      i++;
    }
  }
  return out;
}

export function emptySample(t: number, width = 1280, height = 720): PoseSample {
  return { t, width, height, landmarks: [] };
}
