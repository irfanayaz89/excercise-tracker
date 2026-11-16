import type { EngineConfig } from './config';
import { median } from './geometry';
import type { Vec2 } from './types';

/**
 * Depth readings for one frame (iPhone only): distances in metres at points
 * on the body, and at points in the space just above the back (between the
 * body and whatever is behind it).
 */
export interface DepthProbe {
  t: number;
  body: number[];
  around: number[];
  /** Real shoulder-to-hip length in metres, when the camera's focal length is known. */
  torsoM: number | null;
}

/** Why the set is not counting a real person. */
export type RealityIssue = 'screen' | 'handheld';

type Vote = 'fake' | 'real';

/**
 * Is the camera watching a real person, or a video of one on a screen?
 *
 * - Depth (iPhone): a screen is flat. A person shown on it sits on the same
 *   surface as everything around them, and a person on a phone screen is a
 *   few centimetres tall. A real body stands out from the space above its
 *   back and has a human size.
 * - Handheld screen (every phone): the trainer phone stands still on the
 *   floor, so a real person's hands and feet stay planted. A video held up to
 *   the camera shakes them all together, back and forth, while the phone's
 *   own motion sensor says it is not moving.
 *
 * Only sustained, clear evidence gives a verdict; anything unclear gives none,
 * so a real person is never flagged on a few noisy readings.
 */
export class RealityCheck {
  private votes: { t: number; v: Vote }[] = [];
  private contacts: { t: number; p: Vec2; gap: Vec2 | null }[] = [];
  /** Recent frames, each judged shaking or not (judging per frame scatters, so the verdict uses a share). */
  private shakeLog: { t: number; shaking: boolean }[] = [];
  private lastSuspicionAt: number | null = null;
  private fakeSince: number | null = null;
  private last: { standOut: number | null; torsoM: number | null } = { standOut: null, torsoM: null };

  constructor(private cfg: EngineConfig) {}

  reset(): void {
    this.votes = [];
    this.contacts = [];
    this.shakeLog = [];
    this.fakeSince = null;
  }

  /**
   * A frame was rejected as unreliable (another person, a bad detection). The
   * landmark filter carries it into the next few frames, so hand and foot
   * movement from here on must not count as shaking; start that evidence over.
   */
  distrustContacts(): void {
    this.contacts = [];
    this.shakeLog = [];
  }

  /** The latest depth reading, for diagnostics. */
  get lastDepth(): { standOut: number | null; torsoM: number | null } {
    return this.last;
  }

  pushDepth(p: DepthProbe): void {
    if (!this.cfg.reality.enabled || !Number.isFinite(p.t)) return;
    const r = this.cfg.reality;
    const ok = (d: number) => Number.isFinite(d) && d > 0.1 && d < 8;
    const body = p.body.filter(ok);
    const around = p.around.filter(ok);
    const torsoM = p.torsoM !== null && Number.isFinite(p.torsoM) && p.torsoM > 0 ? p.torsoM : null;
    if (body.length < 3 || around.length < 3) {
      this.last = { standOut: null, torsoM };
      return;
    }
    const standOut = median(around) - median(body);
    this.last = { standOut, torsoM };
    let v: Vote | null = null;
    if (torsoM !== null && (torsoM < r.minTorsoM || torsoM > r.maxTorsoM)) v = 'fake';
    else if (standOut < r.minStandOutM) v = 'fake';
    else if (standOut >= r.realStandOutM) v = 'real';
    if (v === null) return;
    this.votes.push({ t: p.t, v });
    this.votes = this.votes.filter((x) => p.t - x.t <= r.windowMs);
    if (v === 'fake') this.lastSuspicionAt = p.t;
  }

  /**
   * Hands and feet (normalized frame positions) for one frame.
   * @param phoneStill true when the motion sensor says the phone is not moving; null without a sensor.
   */
  pushContacts(t: number, points: Vec2[], phoneStill: boolean | null): void {
    if (!this.cfg.reality.enabled || !Number.isFinite(t)) return;
    // The phone itself moving shakes the picture too; that is the phone check's job.
    if (phoneStill !== true || points.length === 0) {
      this.contacts = [];
      this.shakeLog = [];
      return;
    }
    const p = { x: points.reduce((s, q) => s + q.x, 0) / points.length, y: points.reduce((s, q) => s + q.y, 0) / points.length };
    // With hand and foot both in view, also follow the gap between them: a held-up
    // screen moves both together (the gap stays), camera noise moves each on its own.
    const gap = points.length >= 2 ? { x: points[1].x - points[0].x, y: points[1].y - points[0].y } : null;
    const r = this.cfg.reality;
    this.contacts.push({ t, p, gap });
    this.contacts = this.contacts.filter((c) => t - c.t <= 1000);
    if (this.contacts.length < 10) return;
    const speeds: number[] = [];
    const gapSpeeds: number[] = [];
    let path = 0;
    for (let i = 1; i < this.contacts.length; i++) {
      const a = this.contacts[i - 1];
      const b = this.contacts[i];
      const dt = (b.t - a.t) / 1000;
      if (!(dt > 0)) continue;
      const step = Math.hypot(b.p.x - a.p.x, b.p.y - a.p.y);
      path += step;
      // Typical speeds, not averages: a held-up screen moves on nearly every
      // frame, while a tracking glitch moves the points on a few. Per second, so
      // the camera's frame rate does not matter.
      speeds.push(step / dt);
      if (a.gap && b.gap) gapSpeeds.push(Math.hypot(b.gap.x - a.gap.x, b.gap.y - a.gap.y) / dt);
    }
    if (speeds.length < 9) return;
    const first = this.contacts[0].p;
    const net = Math.hypot(p.x - first.x, p.y - first.y);
    const speed = median(speeds);
    const together =
      gapSpeeds.length >= speeds.length * 0.8
        ? speed >= r.shakeSpeed && speed >= median(gapSpeeds) * r.shakeRigidity
        : speed >= r.shakeSpeed * 1.6; // one point only: ask for clearer shaking
    // Shaking: moving together, mostly back and forth rather than one move.
    const shaking = together && net < path * 0.3;
    this.shakeLog.push({ t, shaking });
    this.shakeLog = this.shakeLog.filter((x) => t - x.t <= r.shakeMs);
    if (shaking) this.lastSuspicionAt = t;
  }

  /** A sustained sign that this is not a real person, or null. */
  issue(t: number): RealityIssue | null {
    if (!this.cfg.reality.enabled) return null;
    const r = this.cfg.reality;
    if (this.isShaking(t)) return 'handheld';
    const recent = this.votes.filter((x) => t - x.t <= r.windowMs);
    if (recent.length >= r.minVotes) {
      const fakes = recent.filter((x) => x.v === 'fake');
      if (fakes.length / recent.length >= r.fakeShare) {
        if (this.fakeSince === null) this.fakeSince = fakes[0].t;
        return 'screen';
      }
    }
    this.fakeSince = null;
    return null;
  }

  /** Shaking for most of the last `shakeMs`, over a window that really covers that long. */
  private isShaking(t: number): boolean {
    const r = this.cfg.reality;
    const log = this.shakeLog.filter((x) => t - x.t <= r.shakeMs);
    if (log.length < 20 || log[log.length - 1].t - log[0].t < r.shakeMs * 0.9) return false;
    return log.filter((x) => x.shaking).length / log.length >= r.shakeShare;
  }

  /** When the suspicious stretch began; reps and time after this are not trusted. */
  suspectSince(t: number): number | null {
    const kind = this.issue(t);
    if (kind === 'handheld') return this.shakeLog.find((x) => x.shaking)?.t ?? null;
    if (kind === 'screen') return this.fakeSince;
    return null;
  }

  /** Time since the last suspicious sign (Infinity if none). */
  clearFor(t: number): number {
    return this.lastSuspicionAt === null ? Infinity : t - this.lastSuspicionAt;
  }
}
