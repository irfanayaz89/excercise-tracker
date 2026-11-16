/**
 * One Euro filter (Casiez et al., CHI 2012): a low-pass filter whose cutoff
 * rises with speed. Slow movement gets heavy smoothing (no jitter), fast
 * movement gets light smoothing (low lag). Time-based, so it behaves the same
 * at any frame rate.
 */
export class OneEuroFilter {
  private x: number | null = null;
  private dx = 0;
  private lastT: number | null = null;

  constructor(
    private minCutoff: number,
    private beta: number,
    private dCutoff: number,
  ) {}

  reset(): void {
    this.x = null;
    this.dx = 0;
    this.lastT = null;
  }

  /** @param t timestamp in milliseconds */
  filter(value: number, t: number): number {
    if (this.x === null || this.lastT === null) {
      this.x = value;
      this.lastT = t;
      return value;
    }
    const dt = (t - this.lastT) / 1000;
    // Non-monotonic or duplicate timestamp: keep the previous estimate.
    if (!(dt > 0)) return this.x;
    this.lastT = t;

    const rawDx = (value - this.x) / dt;
    this.dx = lerp(this.dx, rawDx, alpha(dt, this.dCutoff));
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x = lerp(this.x, value, alpha(dt, cutoff));
    return this.x;
  }
}

function alpha(dt: number, cutoff: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

function lerp(a: number, b: number, k: number): number {
  return a + (b - a) * k;
}
