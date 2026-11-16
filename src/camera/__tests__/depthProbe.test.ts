/// <reference types="jest" />
/**
 * The depth sampler against fake depth maps: a real person standing out from
 * the room, a flat screen, every buffer rotation, a mirrored map, and the
 * 16-bit and disparity formats.
 */
import type { Depth } from 'react-native-vision-camera';
import { sampleDepthAtBody } from '../depthProbe';

// Hoisted by Jest: the sampler only needs types from these.
jest.mock('react-native-vision-camera', () => ({}));

const W = 96; // depth map, sensor orientation
const H = 54;

/** Upright landmarks (33 × [x, y, z, vis, presence]) for a side-on plank, head left. */
function landmarks(): number[] {
  const lm = new Array(33 * 5).fill(0);
  const set = (i: number, x: number, y: number, v = 0.95) => {
    lm[i * 5] = x;
    lm[i * 5 + 1] = y;
    lm[i * 5 + 3] = v;
    lm[i * 5 + 4] = 0.99;
  };
  // Left side visible: shoulder, elbow, wrist, hip, knee, ankle.
  set(11, 0.3, 0.5);
  set(13, 0.31, 0.6);
  set(15, 0.3, 0.7);
  set(23, 0.5, 0.56);
  set(25, 0.65, 0.6);
  set(27, 0.8, 0.64);
  for (const i of [12, 14, 16, 24, 26, 28]) set(i, 0.3, 0.5, 0.2); // far side, mostly hidden
  return lm;
}

/** Is this upright point on the body (a thick band along shoulder → ankle, plus the arm)? */
function onBody(u: number, v: number): boolean {
  const near = (ax: number, ay: number, bx: number, by: number, r: number) => {
    const dx = bx - ax;
    const dy = by - ay;
    const k = Math.max(0, Math.min(1, ((u - ax) * dx + (v - ay) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(u - (ax + dx * k), v - (ay + dy * k)) < r;
  };
  return near(0.3, 0.5, 0.8, 0.64, 0.04) || near(0.3, 0.5, 0.3, 0.7, 0.03);
}

type Fmt = 'depth-32-bit' | 'depth-16-bit' | 'disparity-32-bit';

/** Builds a fake depth frame; `scene(u, v)` gives metres at an upright point. */
function fakeDepth(
  scene: (u: number, v: number) => number,
  opts: { orientation?: 'up' | 'right' | 'left' | 'down'; mirrored?: boolean; format?: Fmt; calibrated?: boolean } = {},
): Depth {
  const o = opts.orientation ?? 'up';
  const fmt = opts.format ?? 'depth-32-bit';
  const rotated = o === 'right' || o === 'left';
  const bw = rotated ? H : W; // buffer in sensor orientation
  const bh = rotated ? W : H;
  const bytes = fmt === 'depth-16-bit' ? 2 : 4;
  const buf = new ArrayBuffer(bw * bh * bytes);
  const f32 = new Float32Array(buf);
  const u16 = new Uint16Array(buf);
  const toHalf = (x: number) => {
    // Enough for 0.1–10 m: normal numbers only.
    const e = Math.floor(Math.log2(x));
    const m = Math.round((x / Math.pow(2, e) - 1) * 1024);
    return ((e + 15) << 10) | m;
  };
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      let bx = x / (bw - 1);
      const by = y / (bh - 1);
      if (opts.mirrored) bx = 1 - bx;
      // buffer → upright (the native module's rotation)
      const [u, v] = o === 'right' ? [1 - by, bx] : o === 'left' ? [by, 1 - bx] : o === 'down' ? [1 - bx, 1 - by] : [bx, by];
      const m = scene(u, v);
      const val = fmt === 'disparity-32-bit' ? 1 / m : m;
      if (bytes === 2) u16[y * bw + x] = toHalf(val);
      else f32[y * bw + x] = val;
    }
  }
  return {
    pixelFormat: fmt,
    availableDepthPixelFormats: [],
    width: bw,
    height: bh,
    bytesPerRow: bw * bytes,
    orientation: o,
    getDepthData: () => buf,
    // A 60° horizontal field of view on the upright 16:9 frame.
    cameraCalibrationData: opts.calibrated
      ? {
          cameraIntrinsicMatrix: [
            bw / (2 * Math.tan(rotated ? Math.PI / 12 : Math.PI / 6)),
            0,
            0,
            0,
            bh / (2 * Math.tan(rotated ? Math.PI / 6 : Math.PI / 12)),
            0,
            bw / 2,
            bh / 2,
            1,
          ],
          intrinsicMatrixReferenceDimensions: { width: bw, height: bh },
        }
      : undefined,
  } as unknown as Depth;
}

const room = (u: number, v: number) => (onBody(u, v) ? 2 : 3.6); // person 2 m away, wall 3.6 m
const tv = () => 2; // everything on one flat surface
const median = (xs: number[]) => {
  const v = xs.filter(Number.isFinite).sort((a, b) => a - b);
  return v[v.length >> 1];
};

describe('depth sampler', () => {
  it.each(['up', 'right', 'left', 'down'] as const)('finds the body standing out from the room (%s buffer)', (orientation) => {
    const p = sampleDepthAtBody(fakeDepth(room, { orientation }), landmarks(), 1280, 720);
    expect(p).not.toBeNull();
    expect(median(p!.body)).toBeCloseTo(2, 1);
    expect(median(p!.around)).toBeCloseTo(3.6, 1);
    expect(p!.around.length).toBeGreaterThanOrEqual(3);
  });

  it('a flat screen reads as flat', () => {
    const p = sampleDepthAtBody(fakeDepth(tv), landmarks(), 1280, 720);
    expect(Math.abs(median(p!.around) - median(p!.body))).toBeLessThan(0.05);
  });

  it('a mirrored depth map still finds the body', () => {
    const p = sampleDepthAtBody(fakeDepth(room, { mirrored: true }), landmarks(), 1280, 720);
    expect(median(p!.around) - median(p!.body)).toBeGreaterThan(1);
  });

  it.each(['depth-16-bit', 'disparity-32-bit'] as const)('reads the %s format in metres', (format) => {
    const p = sampleDepthAtBody(fakeDepth(room, { format }), landmarks(), 1280, 720);
    expect(median(p!.body)).toBeCloseTo(2, 1);
    expect(median(p!.around)).toBeCloseTo(3.6, 1);
  });

  it.each(['up', 'right'] as const)('works out the real torso length from the focal length (%s buffer)', (orientation) => {
    const p = sampleDepthAtBody(fakeDepth(room, { orientation, calibrated: true }), landmarks(), 1280, 720);
    // Shoulder (0.3, 0.5) → hip (0.5, 0.56) on a 60° × ~34° view at 2 m.
    const widthM = 2 * 2 * Math.tan(Math.PI / 6);
    const heightM = 2 * 2 * Math.tan(Math.PI / 12);
    const expected = Math.hypot(0.2 * widthM, 0.06 * heightM);
    expect(p!.torsoM).not.toBeNull();
    expect(p!.torsoM!).toBeCloseTo(expected, 1);
  });

  it('no torso length without calibration', () => {
    expect(sampleDepthAtBody(fakeDepth(room), landmarks(), 1280, 720)!.torsoM).toBeNull();
  });

  it('gives up cleanly on an unreadable map or a hidden body', () => {
    const broken = {
      ...fakeDepth(room),
      getDepthData: () => {
        throw new Error('gone');
      },
    } as unknown as Depth;
    expect(sampleDepthAtBody(broken, landmarks(), 1280, 720)).toBeNull();
    const lm = landmarks();
    lm[11 * 5 + 3] = 0.1; // shoulder hidden
    lm[12 * 5 + 3] = 0.1;
    expect(sampleDepthAtBody(fakeDepth(room), lm, 1280, 720)).toBeNull();
  });
});
