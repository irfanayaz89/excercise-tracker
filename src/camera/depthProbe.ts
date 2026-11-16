import type { Depth } from 'react-native-vision-camera';

/** Depth readings at and around the body for the real-person check (no timestamp yet). */
export interface RawDepthProbe {
  body: number[];
  around: number[];
  torsoM: number | null;
}

/** Near-side joints: shoulder, elbow, wrist, hip, knee, ankle (BlazePose indices). */
const LEFT = [11, 13, 15, 23, 25, 27];
const RIGHT = [12, 14, 16, 24, 26, 28];
const STRIDE = 5;
const MIN_VIS = 0.5;

/** IEEE half float → number. */
function half(h: number): number {
  'worklet';
  const sign = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const f = h & 0x3ff;
  if (e === 0) return sign * Math.pow(2, -14) * (f / 1024);
  if (e === 31) return f ? NaN : sign * Infinity;
  return sign * Math.pow(2, e - 15) * (1 + f / 1024);
}

/**
 * Upright-image point (0..1, as the pose model reports it) → depth-buffer point
 * (0..1). The depth map is not rotated upright; this is the inverse of the
 * rotation the native module applies to landmarks (HybridPoseLandmarker.upright).
 */
function toBuffer(u: number, v: number, orientation: string): [number, number] {
  'worklet';
  switch (orientation) {
    case 'right':
      return [v, 1 - u];
    case 'left':
      return [1 - v, u];
    case 'down':
      return [1 - u, 1 - v];
    default:
      return [u, v];
  }
}

/**
 * Reads depth (metres) at the near-side joints and at points in the space
 * just above the back, plus the real torso length when the camera's focal
 * length is known. Runs on the camera thread next to the pose model.
 *
 * Whether the depth map is mirrored relative to the landmarks is not
 * documented, so both readings are taken and the one where the body stands
 * out more is kept. On a real person only the right one stands out; on a
 * screen neither does. This leans towards "real" when unsure, so a real
 * person is never flagged because of a mapping mistake.
 *
 * Returns null when the depth map cannot be read.
 */
export function sampleDepthAtBody(depth: Depth, lm: number[], frameW: number, frameH: number): RawDepthProbe | null {
  'worklet';
  let converted: Depth | null = null;
  try {
    let d = depth;
    if (d.pixelFormat !== 'depth-32-bit' && d.availableDepthPixelFormats.includes('depth-32-bit')) {
      converted = d.convert('depth-32-bit');
      d = converted;
    }
    const fmt = d.pixelFormat;
    if (fmt === 'unknown' || fmt === 'depth-point-cloud-32-bit') return null;
    const w = d.width;
    const h = d.height;
    const bpr = d.bytesPerRow;
    if (!(w > 2) || !(h > 2) || !(bpr > 0)) return null;
    const is32 = fmt.endsWith('32-bit');
    const disparity = fmt.startsWith('disparity');
    const buf = d.getDepthData();
    const f32 = is32 ? new Float32Array(buf) : null;
    const u16 = is32 ? null : new Uint16Array(buf);
    const stride = is32 ? bpr / 4 : bpr / 2;
    const orientation = d.orientation as string;

    /** Median of a 3×3 patch around a buffer point, in metres; NaN if unreadable. */
    const read = (bx: number, by: number): number => {
      const cx = Math.round(bx * (w - 1));
      const cy = Math.round(by * (h - 1));
      const vals: number[] = [];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const x = cx + dx;
          const y = cy + dy;
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
          const i = y * stride + x;
          const raw = f32 ? f32[i] : half(u16![i]);
          const m = disparity ? (raw > 0 ? 1 / raw : NaN) : raw;
          if (m > 0 && Number.isFinite(m)) vals.push(m);
        }
      }
      if (vals.length < 3) return NaN;
      vals.sort((a, b) => a - b);
      return vals[vals.length >> 1];
    };

    // Near side: the side the model sees more clearly.
    const vis = (idx: number[]) => idx.reduce((s, i) => s + lm[i * STRIDE + 3], 0);
    const side = vis(LEFT) >= vis(RIGHT) ? LEFT : RIGHT;
    const sh = side[0];
    const hp = side[3];
    if (lm[sh * STRIDE + 3] < MIN_VIS || lm[hp * STRIDE + 3] < MIN_VIS) return null;
    const S = { x: lm[sh * STRIDE], y: lm[sh * STRIDE + 1] };
    const H = { x: lm[hp * STRIDE], y: lm[hp * STRIDE + 1] };

    const bodyPts: [number, number][] = [];
    for (const i of side) if (lm[i * STRIDE + 3] >= MIN_VIS) bodyPts.push([lm[i * STRIDE], lm[i * STRIDE + 1]]);
    for (const k of [0.33, 0.66]) bodyPts.push([S.x + (H.x - S.x) * k, S.y + (H.y - S.y) * k]);

    // Space above the back: off the shoulder-hip line, away from the floor, scaled to the body.
    const dx = (H.x - S.x) * frameW;
    const dy = (H.y - S.y) * frameH;
    const len = Math.hypot(dx, dy);
    if (!(len > 4)) return null;
    let nx = -dy / len;
    let ny = dx / len;
    if (ny > 0) {
      nx = -nx;
      ny = -ny;
    }
    const aroundPts: [number, number][] = [];
    for (const along of [0, 0.5, 1]) {
      for (const k of [0.6, 1.0]) {
        const px = S.x * frameW + dx * along + nx * k * len;
        const py = S.y * frameH + dy * along + ny * k * len;
        const u = px / frameW;
        const v = py / frameH;
        if (u > 0.02 && u < 0.98 && v > 0.02 && v < 0.98) aroundPts.push([u, v]);
      }
    }

    const sampleAll = (pts: [number, number][], mirror: boolean) =>
      pts.map(([u, v]) => {
        const [bx, by] = toBuffer(mirror ? 1 - u : u, v, orientation);
        return read(bx, by);
      });
    const med = (xs: number[]) => {
      const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
      return v.length ? v[v.length >> 1] : NaN;
    };

    let best: { body: number[]; around: number[]; mirror: boolean } | null = null;
    let bestStandOut = -Infinity;
    for (const mirror of [false, true]) {
      const body = sampleAll(bodyPts, mirror);
      const around = sampleAll(aroundPts, mirror);
      const standOut = med(around) - med(body);
      if (Number.isFinite(standOut) && standOut > bestStandOut) {
        bestStandOut = standOut;
        best = { body, around, mirror };
      }
    }
    if (!best) return null;

    // Real torso length from the focal length (in depth-map pixels) and the body's distance.
    let torsoM: number | null = null;
    const cal = d.cameraCalibrationData;
    const z = med(best.body);
    if (cal && Number.isFinite(z)) {
      const K = cal.cameraIntrinsicMatrix;
      const ref = cal.intrinsicMatrixReferenceDimensions;
      if (K.length >= 5 && ref.width > 0 && ref.height > 0) {
        const fx = K[0] * (w / ref.width);
        const fy = K[4] * (h / ref.height);
        const [sx, sy] = toBuffer(best.mirror ? 1 - S.x : S.x, S.y, orientation);
        const [hx, hy] = toBuffer(best.mirror ? 1 - H.x : H.x, H.y, orientation);
        if (fx > 0 && fy > 0) torsoM = Math.hypot(((sx - hx) * w) / fx, ((sy - hy) * h) / fy) * z;
      }
    }
    return { body: best.body, around: best.around, torsoM };
  } catch {
    return null;
  } finally {
    converted?.dispose();
  }
}
