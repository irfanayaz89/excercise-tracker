import type { BodyMetrics } from './types';

/** Fields judged by the start check; single-frame spikes in these are common. */
const FIELDS = [
  'elbowDeg',
  'bodyLineDeg',
  'hipOffset',
  'kneeDeg',
  'neckDeg',
  'trunkTiltDeg',
  'wristOffset',
  'elbowStack',
  'forearmRise',
  'shoulderStack',
  'trunkLiftDeg',
  'footRise',
] as const;

/**
 * Median of the last few frames for each body measurement. On a real phone
 * one frame in ten or so has a joint jump (a knee read at 118° in a straight
 * plank). A median of five frames (~150 ms) removes those spikes without
 * adding noticeable lag. Used for the start check only; rep counting keeps
 * the raw signal so fast reps are not blunted.
 */
export class MetricMedian {
  private buf: BodyMetrics[] = [];

  constructor(
    private size = 5,
    private windowMs = 300,
  ) {}

  reset(): void {
    this.buf = [];
  }

  push(m: BodyMetrics): BodyMetrics {
    this.buf.push(m);
    this.buf = this.buf.filter((b) => m.t - b.t <= this.windowMs).slice(-this.size);
    const out: BodyMetrics = { ...m };
    for (const f of FIELDS) out[f] = medianOf(this.buf.map((b) => b[f]));
    return out;
  }
}

/** Median of the known values; null when most frames could not measure it. */
export function medianOf(values: (number | null)[]): number | null {
  const v = values.filter((x): x is number => x !== null && Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0 || v.length * 2 < values.length) return null;
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** The value below which `p` (0..1) of the values fall; null when empty. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const v = [...values].sort((a, b) => a - b);
  const i = Math.min(v.length - 1, Math.max(0, Math.round(p * (v.length - 1))));
  return v[i];
}
