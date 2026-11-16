import { DEFAULT_CONFIG, type EngineConfig } from './config';
import {
  checkPlank,
  FramingGate,
  PhoneGate,
  PlankHold,
  type Calibration,
  type FramingCheck,
  type FramingIssue,
  type PhoneCheck,
  type PhoneIssue,
  type PlankIssue,
} from './gates';
import { MetricMedian } from './smoothing';
import { RepCounter, type MissRecord, type RepFault, type RepPhase, type RepRecord } from './repCounter';
import { buildChain, computeMetrics, PoseTracker, SideSelector, type TrackedPose } from './tracker';
import { LM, type BodyMetrics, type PhoneAttitude, type PoseSample, type Side } from './types';

export type SessionPhase = 'phone-setup' | 'body-check' | 'counting' | 'paused' | 'ended';

export type PauseReason = 'lost-tracking' | 'left-position' | 'phone-moved' | 'interrupted' | 'other-person';

export type EndReason = 'user' | 'target' | 'idle' | 'paused-too-long';

/** Every message the app can show or speak. The UI maps these to copy. */
export type Cue =
  | { kind: 'phone'; issue: PhoneIssue }
  | { kind: 'framing'; issue: FramingIssue }
  | { kind: 'plank'; issue: PlankIssue }
  | { kind: 'start' }
  | { kind: 'resume' }
  | { kind: 'rep'; count: number; clean: boolean }
  | { kind: 'fault'; fault: RepFault }
  | { kind: 'miss'; reason: MissRecord['reason'] }
  | { kind: 'paused'; reason: PauseReason }
  | { kind: 'target-reached' };

export type SessionEvent =
  | { type: 'phase'; phase: SessionPhase; t: number }
  | { type: 'rep'; rep: RepRecord }
  | { type: 'miss'; miss: MissRecord }
  | { type: 'cue'; cue: Cue; t: number }
  | { type: 'ended'; summary: SessionSummary };

export interface SessionSnapshot {
  phase: SessionPhase;
  phone: PhoneCheck;
  phoneConfirmedManually: boolean;
  framing: FramingCheck;
  plankIssues: PlankIssue[];
  /** 0..1 while holding the start plank. */
  plankProgress: number;
  reps: number;
  cleanReps: number;
  repPhase: RepPhase | null;
  /** 0 at lockout, 1 at full depth. */
  depth: number | null;
  metrics: BodyMetrics | null;
  side: Side | null;
  pauseReason: PauseReason | null;
  lastRep: RepRecord | null;
  targetReps: number | null;
  startedAt: number | null;
  elapsedMs: number;
  /** Body position in the frame; null when nobody is detected. */
  placement: BodyPlacement | null;
}

/** Where the body sits in the camera frame, for on-screen alignment hints. */
const PLACEMENT_JOINTS = [
  LM.nose,
  LM.leftEar,
  LM.rightEar,
  LM.leftShoulder,
  LM.rightShoulder,
  LM.leftElbow,
  LM.rightElbow,
  LM.leftWrist,
  LM.rightWrist,
  LM.leftHip,
  LM.rightHip,
  LM.leftKnee,
  LM.rightKnee,
  LM.leftAnkle,
  LM.rightAnkle,
  LM.leftHeel,
  LM.rightHeel,
  LM.leftFootIndex,
  LM.rightFootIndex,
];

export interface BodyPlacement {
  /** Bounding box of the visible joints, normalized 0..1 in display coordinates. */
  box: { x0: number; y0: number; x1: number; y1: number };
  /** Which side of the screen the head is on (feet are on the other side). */
  headSide: 'left' | 'right' | null;
  frameW: number;
  frameH: number;
}

export interface SessionSummary {
  /** Difficulty the set ran at, when known. */
  difficulty?: string;
  startedAt: number;
  endedAt: number;
  activeMs: number;
  endReason: EndReason;
  reps: RepRecord[];
  misses: MissRecord[];
  totalReps: number;
  cleanReps: number;
  faultCounts: Partial<Record<RepFault, number>>;
  missCounts: Partial<Record<MissRecord['reason'], number>>;
  avgRepMs: number | null;
  avgScore: number | null;
  bestCleanStreak: number;
  pauses: number;
}

export interface SessionOptions {
  config?: EngineConfig;
  targetReps?: number | null;
  /** Label stored with the summary (e.g. 'easy'). */
  difficulty?: string;
}

/**
 * The whole push-up session as one deterministic state machine.
 *
 *   phone-setup → body-check → counting ⇄ paused → ended
 *
 * Feed it phone attitude (`pushAttitude`) and pose samples (`pushPose`) in
 * timestamp order; call `tick` from a timer so timeouts fire even when no
 * frames arrive. It never throws on bad input: unusable frames are dropped.
 */
export class PushupSession {
  readonly cfg: EngineConfig;
  private tracker: PoseTracker;
  private sides: SideSelector;
  private phoneGate: PhoneGate;
  private framingGate: FramingGate;
  private plankHold: PlankHold;
  /** Median-smoothed measurements for the start check (removes single-frame spikes). */
  private checkSmoother = new MetricMedian();
  /** Same, for the form readings during reps (body line, hips, neck). */
  private formSmoother = new MetricMedian();
  private counter: RepCounter | null = null;
  private listeners = new Set<(e: SessionEvent) => void>();
  private lastCueAt = new Map<string, number>();

  private phase: SessionPhase = 'phone-setup';
  private phoneManual = false;
  private phoneCheck: PhoneCheck = { ok: false, issue: 'no-sensor', steadyProgress: 0, rollDeg: null, pitchDeg: null };
  private framing: FramingCheck = { ok: false, issue: 'no-person', hint: null, meanVisibility: 0 };
  private plankIssues: PlankIssue[] = [];
  private plankProgress = 0;
  private metrics: BodyMetrics | null = null;
  private depth: number | null = null;
  private calibration: Calibration | null = null;
  private reps: RepRecord[] = [];
  private misses: MissRecord[] = [];
  private pauseReason: PauseReason | null = null;
  private pausedAt: number | null = null;
  private pauses = 0;
  private lostSince: number | null = null;
  private outOfPositionSince: number | null = null;
  /** Last moment of progress (counting began or a rep landed), for the idle timeout. */
  private idleSince: number | null = null;
  private lastIdentity: { t: number; hip: { x: number; y: number }; torso: number } | null = null;
  /** True while frames keep jumping away from the last accepted body. */
  private identityJumping = false;
  /** Last frame with a person detected, to ride out single dropped detections. */
  private lastDetectedT: number | null = null;
  /** Start of a run of failed framing checks during a plank hold. */
  private framingBadSince: number | null = null;
  private startedAt: number | null = null;
  private activeMs = 0;
  private lastActiveT: number | null = null;
  private now = 0;
  private targetReps: number | null;
  private summary: SessionSummary | null = null;
  private lastPose: TrackedPose | null = null;
  private difficulty: string | undefined;

  constructor(opts: SessionOptions = {}) {
    this.cfg = opts.config ?? DEFAULT_CONFIG;
    this.difficulty = opts.difficulty;
    this.targetReps = opts.targetReps && opts.targetReps > 0 ? Math.floor(opts.targetReps) : null;
    this.tracker = new PoseTracker(this.cfg);
    this.sides = new SideSelector(this.cfg);
    this.phoneGate = new PhoneGate(this.cfg);
    this.framingGate = new FramingGate(this.cfg);
    this.plankHold = new PlankHold(this.cfg);
  }

  subscribe(fn: (e: SessionEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // ─── Inputs ──────────────────────────────────────────────────────────────

  pushAttitude(a: PhoneAttitude): void {
    if (this.phase === 'ended') return;
    this.phoneGate.push(a);
    this.advanceClock(a.t);
    if (this.phase === 'phone-setup') this.evaluatePhone();
    else if ((this.phase === 'counting' || this.phase === 'body-check') && this.phoneGate.isDisturbed(a.t)) {
      if (this.phase === 'counting') this.pause('phone-moved');
      else this.setPhase('phone-setup');
    }
  }

  /** The user confirms the phone is placed when there is no motion sensor. */
  confirmPhoneManually(): void {
    if (this.phase !== 'phone-setup') return;
    this.phoneManual = true;
    this.phoneGate.acceptCurrent();
    this.setPhase('body-check');
  }

  pushPose(sample: PoseSample): void {
    if (this.phase === 'ended') return;
    const pose = this.tracker.update(sample);
    if (!pose) return;
    this.lastPose = pose;
    this.advanceClock(pose.t);

    if (this.phase === 'phone-setup') {
      this.evaluatePhone();
      // Still compute framing so the setup screen can preview it.
      this.evaluateBody(pose, false);
      return;
    }
    if (this.phase === 'body-check') {
      this.evaluateBody(pose, true);
      return;
    }
    if (this.phase === 'paused') {
      if (this.pauseReason === 'interrupted') return;
      if (this.pauseReason === 'phone-moved') {
        // The phone was knocked: it must be level again before we trust angles.
        this.phoneCheck = this.phoneGate.check(this.now);
        // A user who skipped the level check only needs the phone to settle back, not to be level.
        const settled = this.phoneManual ? !this.phoneGate.isDisturbed(this.now) : this.phoneCheck.ok;
        if (!settled && this.phoneCheck.issue !== 'no-sensor') {
          if (this.phoneCheck.issue) this.cue({ kind: 'phone', issue: this.phoneCheck.issue });
          return;
        }
        // Put back level: this is its new resting angle.
        if (!this.phoneManual && this.phoneCheck.ok) this.phoneGate.acceptCurrent();
      }
      this.evaluateBody(pose, true, this.cfg.plank.holdMs * 0.6);
      return;
    }
    this.evaluateCounting(pose);
  }

  /** Call ~4×/s with the current time so timeouts fire without frames. */
  tick(t: number): void {
    if (this.phase === 'ended') return;
    this.advanceClock(t);
    if (this.phase === 'phone-setup') this.evaluatePhone();
    if (this.phase === 'counting') {
      // No frames at all (camera stalled) also counts as lost tracking.
      if (this.lostSince === null && this.metrics && t - this.metrics.t > this.cfg.session.pauseAfterMs) {
        this.pause('lost-tracking', this.metrics.t);
      } else if (this.lostSince !== null && t - this.lostSince >= this.cfg.session.pauseAfterMs) {
        this.pause('lost-tracking', this.lostSince);
      } else if (this.idleSince !== null && t - this.idleSince > this.cfg.session.autoEndIdleMs) {
        this.end('idle');
      }
    }
    // An interruption (app in background, camera error screen) never ends the
    // set on its own; the clock starts once the user is back (resumeFromInterrupt).
    if (
      this.phase === 'paused' &&
      this.pauseReason !== 'interrupted' &&
      this.pausedAt !== null &&
      t - this.pausedAt > this.cfg.session.autoEndPausedMs
    ) {
      this.end('paused-too-long');
    }
  }

  /** App went to background, a call came in, or the camera was interrupted. */
  interrupt(t: number): void {
    this.advanceClock(t);
    if (this.phase === 'counting') this.pause('interrupted');
    // Any plank hold in progress is void: we were not watching.
    this.plankHold.reset();
    this.plankProgress = 0;
    this.tracker.reset();
  }

  /** App is back; the user has to get back into a plank to continue. */
  resumeFromInterrupt(t: number): void {
    this.advanceClock(t);
    this.tracker.reset();
    this.sides.reset();
    this.plankHold.reset();
    this.plankProgress = 0;
    this.lastDetectedT = null;
    if (this.phase === 'paused') {
      if (this.pauseReason === 'interrupted') this.pauseReason = 'lost-tracking';
      // Time spent away from the app does not count toward the auto-end timeout.
      this.pausedAt = t;
    }
  }

  end(reason: EndReason = 'user'): SessionSummary {
    if (this.summary) return this.summary;
    this.stopActiveClock();
    const summary = this.buildSummary(reason);
    this.summary = summary;
    this.setPhase('ended');
    this.emit({ type: 'ended', summary });
    return summary;
  }

  // ─── Output ──────────────────────────────────────────────────────────────

  get currentPhase(): SessionPhase {
    return this.phase;
  }

  get currentSide(): Side | null {
    return this.sides.current;
  }

  /** Smoothed pixel landmarks from the last usable frame, for drawing. */
  get lastTracked(): TrackedPose | null {
    return this.lastPose;
  }

  /**
   * Colour state of the body line for the overlay:
   * 0 good, 1 needs attention, 2 fault, 3 neutral (not measuring yet).
   */
  get bodyState(): 0 | 1 | 2 | 3 {
    const m = this.metrics;
    if (!m || (this.phase !== 'counting' && this.phase !== 'body-check')) return 3;
    // Count-only mode (Easy) never colours the body as a fault.
    if (!this.cfg.form.enabled) return this.phase === 'body-check' && this.plankIssues.length > 0 ? 1 : 0;
    if (m.hipOffset !== null && Math.abs(m.hipOffset) > this.cfg.form.hipOffsetFault) return 2;
    if (m.bodyLineDeg !== null && m.bodyLineDeg < this.cfg.form.minBodyLineDeg) return 1;
    if (this.phase === 'body-check' && this.plankIssues.length > 0) return 1;
    return 0;
  }

  snapshot(): SessionSnapshot {
    const last = this.reps[this.reps.length - 1] ?? null;
    return {
      phase: this.phase,
      phone: this.phoneCheck,
      phoneConfirmedManually: this.phoneManual,
      framing: this.framing,
      plankIssues: this.plankIssues,
      plankProgress: this.plankProgress,
      reps: this.reps.length,
      cleanReps: this.reps.filter((r) => r.clean).length,
      repPhase: this.counter?.phase ?? null,
      depth: this.depth,
      metrics: this.metrics,
      side: this.sides.current,
      pauseReason: this.pauseReason,
      lastRep: last,
      targetReps: this.targetReps,
      startedAt: this.startedAt,
      elapsedMs: this.activeMs + (this.lastActiveT !== null ? this.now - this.lastActiveT : 0),
      placement: this.placement(),
    };
  }

  // ─── Internals ───────────────────────────────────────────────────────────

  private placement(): BodyPlacement | null {
    const p = this.lastPose;
    if (!p || !p.detected || !(p.width > 0) || !(p.height > 0)) return null;
    const min = this.cfg.minVisibility;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const i of PLACEMENT_JOINTS) {
      if (!(p.vis[i] >= min)) continue;
      const x = p.points[i].x / p.width;
      const y = p.points[i].y / p.height;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
    if (!Number.isFinite(x0)) return null;
    const head = [LM.nose, LM.leftEar, LM.rightEar].find((i) => p.vis[i] >= min);
    const hips = [LM.leftHip, LM.rightHip].filter((i) => p.vis[i] >= min);
    let headSide: BodyPlacement['headSide'] = null;
    if (head !== undefined && hips.length) {
      const hipX = hips.reduce((s, i) => s + p.points[i].x, 0) / hips.length;
      headSide = p.points[head].x < hipX ? 'left' : 'right';
    }
    const c = (v: number) => Math.min(1, Math.max(0, v));
    return { box: { x0: c(x0), y0: c(y0), x1: c(x1), y1: c(y1) }, headSide, frameW: p.width, frameH: p.height };
  }

  private evaluatePhone(): void {
    this.phoneCheck = this.phoneGate.check(this.now);
    if (this.phoneCheck.ok) {
      this.phoneGate.acceptCurrent();
      this.setPhase('body-check');
    } else if (this.phoneCheck.issue && this.phoneCheck.issue !== 'no-sensor') {
      this.cue({ kind: 'phone', issue: this.phoneCheck.issue });
    }
  }

  /** Shared by body-check and paused (resume needs a shorter plank hold). */
  private evaluateBody(pose: TrackedPose, act: boolean, holdMs?: number): void {
    // MediaPipe drops single detections now and then. Ride out a short gap
    // instead of resetting the plank hold the user is in the middle of.
    if (pose.detected) this.lastDetectedT = pose.t;
    else if (this.lastDetectedT !== null && pose.t - this.lastDetectedT <= this.cfg.landmarkHoldMs) return;
    const side = pose.detected ? this.sides.update(pose) : this.sides.current;
    const chain = side && pose.detected ? buildChain(pose, side) : null;
    this.framing = this.framingGate.check(pose, chain);
    const metrics = chain ? computeMetrics(chain, pose, this.phoneGate.horizonRoll(pose.t), this.cfg) : null;
    this.metrics = metrics;

    if (!this.framing.ok || !metrics || !chain) {
      // A single misread frame (an ankle jumping makes the body look too
      // small) must not throw away a plank hold in progress.
      if (this.plankProgress > 0 && pose.detected) {
        if (this.framingBadSince === null) this.framingBadSince = pose.t;
        if (pose.t - this.framingBadSince <= PlankHold.GRACE_MS) return;
      }
      this.framingBadSince = null;
      this.plankIssues = [];
      this.plankProgress = 0;
      this.plankHold.reset();
      this.checkSmoother.reset();
      if (act && this.framing.issue) this.cue({ kind: 'framing', issue: this.framing.issue });
      return;
    }

    this.framingBadSince = null;
    const plank = checkPlank(this.checkSmoother.push(metrics), this.cfg);
    this.plankIssues = plank.issues;
    if (!act) return;

    const hold = this.plankHold.update(metrics, chain.shoulder.y, plank.ok, holdMs);
    this.plankProgress = hold.progress;
    if (!plank.ok) {
      // A short blip inside a good hold is ignored, not announced.
      if (!hold.riding) this.cue({ kind: 'plank', issue: plank.issues[0] });
      return;
    }
    if (hold.wobbly) this.cue({ kind: 'plank', issue: 'hold-still' });
    if (hold.calibration) this.beginCounting(hold.calibration, pose.t);
  }

  private beginCounting(cal: Calibration, t: number): void {
    this.calibration = cal;
    const resuming = this.phase === 'paused';
    if (this.counter) this.counter.restart(cal);
    else this.counter = new RepCounter(this.cfg, cal);
    if (this.startedAt === null) this.startedAt = t;
    this.lostSince = null;
    this.outOfPositionSince = null;
    this.pauseReason = null;
    this.pausedAt = null;
    this.lastIdentity = null;
    this.identityJumping = false;
    this.plankHold.reset();
    this.plankProgress = 0;
    this.formSmoother.reset();
    // Idle timer restarts on resume so a long rest is not counted as idle.
    this.idleSince = t;
    this.lastActiveT = t;
    this.setPhase('counting');
    this.cue({ kind: resuming ? 'resume' : 'start' }, true);
  }

  private evaluateCounting(pose: TrackedPose): void {
    const t = pose.t;
    const side = pose.detected ? this.sides.update(pose) : this.sides.current;
    const chain = side && pose.detected ? buildChain(pose, side) : null;
    const metrics = chain ? computeMetrics(chain, pose, this.phoneGate.horizonRoll(t), this.cfg) : null;

    // Identity: a sudden jump in body position or size means another person
    // (or a bad detection). Ignore the frame instead of counting from it.
    if (metrics && this.isIdentityJump(metrics)) {
      this.identityJumping = true;
      this.markLost(t, 'other-person');
      return;
    }

    // Keep framing hints (low light, drifting out of frame) live during the set.
    this.framing = this.framingGate.check(pose, chain);

    const usable = metrics !== null && (metrics.elbowDeg !== null || metrics.shoulderHeight !== null);
    if (!usable) {
      this.markLost(t, 'lost-tracking');
      return;
    }
    this.lostSince = null;
    this.metrics = metrics;
    this.identityJumping = false;
    this.lastIdentity = { t, hip: metrics.hipCenter, torso: metrics.torsoPx };

    // Out of push-up position (stood up, sat back on knees) for a while → pause.
    const upright = metrics.trunkTiltDeg !== null && metrics.trunkTiltDeg > this.cfg.plank.maxTrunkTiltDeg + 20;
    const kneeling = !this.cfg.allowKneeling && metrics.kneeDeg !== null && metrics.kneeDeg < 110;
    if (upright || kneeling) {
      if (this.outOfPositionSince === null) this.outOfPositionSince = t;
      if (t - this.outOfPositionSince >= this.cfg.session.pauseAfterMs) {
        this.pause('left-position');
        return;
      }
      // Do not feed the counter while out of position.
      return;
    }
    this.outOfPositionSince = null;

    const counter = this.counter!;
    this.depth = counter.depthProgress(metrics);
    // Counting uses the raw elbow and shoulder signals (no lag on fast reps);
    // form is judged on median-smoothed body line, hips and neck.
    const smooth = this.formSmoother.push(metrics);
    const ev = counter.update({ ...metrics, bodyLineDeg: smooth.bodyLineDeg, hipOffset: smooth.hipOffset, neckDeg: smooth.neckDeg });
    if (!ev) return;
    if (ev.type === 'rep') {
      this.reps.push(ev.rep);
      this.idleSince = t;
      this.emit({ type: 'rep', rep: ev.rep });
      this.cue({ kind: 'rep', count: this.reps.length, clean: ev.rep.clean }, true);
      const fault = ev.rep.faults.find((f) => f !== 'head-dropping') ?? ev.rep.faults[0];
      if (fault) this.cue({ kind: 'fault', fault });
      if (this.targetReps !== null && this.reps.length >= this.targetReps) {
        this.cue({ kind: 'target-reached' }, true);
        this.end('target');
      }
    } else if (ev.type === 'miss') {
      this.misses.push(ev.miss);
      this.emit({ type: 'miss', miss: ev.miss });
      this.cue({ kind: 'miss', reason: ev.miss.reason });
    }
  }

  private isIdentityJump(m: BodyMetrics): boolean {
    const prev = this.lastIdentity;
    if (!prev) return false;
    // After a real gap (no body at all) the user may come back anywhere. But
    // while frames keep showing a different body, keep comparing against the
    // last accepted one so the jump persists until the pause fires.
    if (!this.identityJumping && m.t - prev.t > 400) return false;
    const jump = Math.hypot(m.hipCenter.x - prev.hip.x, m.hipCenter.y - prev.hip.y);
    const scale = Math.abs(m.torsoPx - prev.torso) / prev.torso;
    return jump > this.cfg.session.identityJump || scale > this.cfg.session.identityScale;
  }

  private markLost(t: number, reason: PauseReason): void {
    if (this.lostSince === null) this.lostSince = t;
    if (t - this.lostSince >= this.cfg.session.pauseAfterMs) this.pause(reason, this.lostSince);
  }

  /** @param at when the set actually stopped (e.g. when tracking was lost), defaults to now. */
  private pause(reason: PauseReason, at: number = this.now): void {
    if (this.phase !== 'counting') return;
    this.stopActiveClock(at);
    this.pauseReason = reason;
    this.pausedAt = at;
    this.identityJumping = false;
    this.pauses += 1;
    this.lostSince = null;
    this.outOfPositionSince = null;
    this.depth = null;
    this.plankHold.reset();
    this.plankProgress = 0;
    this.setPhase('paused');
    this.cue({ kind: 'paused', reason }, true);
  }

  private stopActiveClock(at: number = this.now): void {
    if (this.lastActiveT !== null) {
      this.activeMs += Math.max(0, Math.min(at, this.now) - this.lastActiveT);
      this.lastActiveT = null;
    }
  }

  private advanceClock(t: number): void {
    if (Number.isFinite(t) && t > this.now) this.now = t;
  }

  private setPhase(phase: SessionPhase): void {
    if (this.phase === phase) return;
    this.phase = phase;
    if (phase === 'body-check' || phase === 'phone-setup') {
      this.plankHold.reset();
      this.plankProgress = 0;
      this.checkSmoother.reset();
    }
    if (phase === 'phone-setup') this.phoneGate.reset();
    this.emit({ type: 'phase', phase, t: this.now });
  }

  private cue(cue: Cue, force = false): void {
    const key = JSON.stringify(cue);
    const last = this.lastCueAt.get(key);
    if (!force && last !== undefined && this.now - last < this.cfg.session.cueCooldownMs) return;
    // Rate-limit across different cues of the same kind too, so the coach does not chatter.
    const kindKey = `kind:${cue.kind}`;
    const lastKind = this.lastCueAt.get(kindKey);
    if (!force && lastKind !== undefined && this.now - lastKind < this.cfg.session.cueCooldownMs / 2) return;
    this.lastCueAt.set(key, this.now);
    this.lastCueAt.set(kindKey, this.now);
    this.emit({ type: 'cue', cue, t: this.now });
  }

  private emit(e: SessionEvent): void {
    for (const fn of this.listeners) {
      try {
        fn(e);
      } catch {
        // A broken listener must never break counting.
      }
    }
  }

  private buildSummary(endReason: EndReason): SessionSummary {
    const reps = this.reps;
    const faultCounts: Partial<Record<RepFault, number>> = {};
    for (const r of reps) for (const f of r.faults) faultCounts[f] = (faultCounts[f] ?? 0) + 1;
    const missCounts: Partial<Record<MissRecord['reason'], number>> = {};
    for (const m of this.misses) missCounts[m.reason] = (missCounts[m.reason] ?? 0) + 1;
    let best = 0;
    let run = 0;
    for (const r of reps) {
      run = r.clean ? run + 1 : 0;
      best = Math.max(best, run);
    }
    const n = reps.length;
    return {
      difficulty: this.difficulty,
      startedAt: this.startedAt ?? this.now,
      endedAt: this.now,
      activeMs: this.activeMs,
      endReason,
      reps,
      misses: this.misses,
      totalReps: n,
      cleanReps: reps.filter((r) => r.clean).length,
      faultCounts,
      missCounts,
      avgRepMs: n ? reps.reduce((s, r) => s + r.durationMs, 0) / n : null,
      avgScore: n ? reps.reduce((s, r) => s + r.score, 0) / n : null,
      bestCleanStreak: best,
      pauses: this.pauses,
    };
  }
}
