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
import { median } from './geometry';
import { HoldTimer, type HoldEvent, type HoldFault, type HoldSnapshot, type HoldSummary } from './holdTimer';
import { RealityCheck, type DepthProbe, type RealityIssue } from './reality';
import { MetricMedian } from './smoothing';
import { HINT_FAULTS, RepCounter, type MissRecord, type RepFault, type RepPhase, type RepRecord } from './repCounter';
import { CrunchCounter, type CrunchPhase } from './crunchCounter';
import { checkHangStart, PullupCounter, PullupFramingGate, pullupMetrics, readPullup, type PullupPhase, type PullupReading } from './pullup';
import { checkFrontStart, frontContacts, frontMetrics, FrontFramingGate } from './front';
import { buildChain, computeMetrics, PoseTracker, SideSelector, SupportSideSelector, type TrackedPose } from './tracker';
import { LM, type BodyMetrics, type Exercise, type PhoneAttitude, type PlankVariant, type PoseSample, type Side } from './types';
import { EXERCISES, isTimed } from './exercises';

export type SessionPhase = 'phone-setup' | 'body-check' | 'counting' | 'paused' | 'ended';

/** not-real: the real-person check found a video on a screen, not a person. */
/** switch-sides: side plank, one side reached its target; hold the other side next. */
export type PauseReason = 'lost-tracking' | 'left-position' | 'phone-moved' | 'interrupted' | 'other-person' | 'not-real' | 'switch-sides';

/** form-break: plank test mode, the hold ended at the first real form break. */
export type EndReason = 'user' | 'target' | 'idle' | 'paused-too-long' | 'form-break';

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
  | { kind: 'target-reached' }
  /** Side plank: this side is done (or was already done); hold the other side. */
  | { kind: 'switch-sides'; done: Side }
  /** Setup: what the camera sees looks like a video on a screen, so the set will not start. */
  | { kind: 'not-real'; issue: RealityIssue }
  /** Plank: form slipping (clock still running) or broken (clock stopped). */
  | { kind: 'hold'; state: 'warning' | 'break'; fault: HoldFault }
  /** Plank: form is back, the clock runs again. */
  | { kind: 'hold-restored' }
  /** Plank: time call, in seconds of good form. */
  | { kind: 'hold-time'; seconds: number }
  /** Plank: seconds left to the target, from 5 down to 1. */
  | { kind: 'hold-countdown'; seconds: number };

export type SessionEvent =
  | { type: 'phase'; phase: SessionPhase; t: number }
  | { type: 'rep'; rep: RepRecord }
  | { type: 'miss'; miss: MissRecord }
  | { type: 'cue'; cue: Cue; t: number }
  | { type: 'ended'; summary: SessionSummary }
  /** Reps taken back because they came from a screen, not a person. */
  | { type: 'revoke'; reps: number };

export interface SessionSnapshot {
  exercise: Exercise;
  /** Where the camera sees the user from. */
  view: 'side' | 'front';
  phase: SessionPhase;
  phone: PhoneCheck;
  phoneConfirmedManually: boolean;
  framing: FramingCheck;
  plankIssues: PlankIssue[];
  /** 0..1 while holding the start plank. */
  plankProgress: number;
  reps: number;
  cleanReps: number;
  repPhase: RepPhase | CrunchPhase | PullupPhase | null;
  /** Push-ups: 0 at lockout, 1 at full depth. Crunches: 0 resting, 1 curled up high enough. */
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
  /** Plank only: the hold timer; null before the hold starts. */
  hold: HoldSnapshot | null;
  /** Plank only: target time in good form. */
  targetHoldMs: number | null;
  /** A sustained sign the camera sees a screen, not a person. */
  reality: RealityIssue | null;
  /** Side plank: time in good form on each side so far, the side being timed, and sides at their target. */
  holdSides: Partial<Record<Side, number>> | null;
  activeSide: Side | null;
  doneSides: Side[];
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
  /** Missing in sets saved before planks existed, which were all push-ups. */
  exercise?: Exercise;
  /** Difficulty the set ran at, when known. */
  difficulty?: string;
  /** Where the camera saw the body from. Head-on can't see the hip line, so it earns less. */
  view?: 'front' | 'side';
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
  /** Plank and side plank (both sides together for a side plank). */
  hold?: HoldSummary;
  /** Side plank: each side on its own. */
  holdSides?: Partial<Record<Side, HoldSummary>>;
  /** Times the set paused because it looked like a video on a screen. */
  realityFlags?: number;
  /** Set when the user fixed the count afterwards: what the camera counted (total and clean). */
  counted?: { total: number; clean: number };
}

export interface SessionOptions {
  config?: EngineConfig;
  targetReps?: number | null;
  /** Label stored with the summary (e.g. 'easy'). */
  difficulty?: string;
  /** Defaults to push-ups. */
  exercise?: Exercise;
  /** Plank: end the set once this much good-form time is reached. */
  targetHoldMs?: number | null;
}

/** Window for judging how steadily the counting points are seen during a set. */
const COVERAGE_MS = 4000;

/** Missing more than this share of frames in that window pauses the set. */
const COVERAGE_MAX_MISSING = 0.3;

/** Accepted frames the identity reference is the median of. */
const IDENTITY_FRAMES = 5;

/** Sum of both identity changes (each as a share of its limit) that also means another person. */
const IDENTITY_COMBINED = 1.4;

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
  private frontGate: FrontFramingGate;
  private plankHold: PlankHold;
  /** Median-smoothed measurements for the start check (removes single-frame spikes). */
  private checkSmoother = new MetricMedian();
  /** Same, for the form readings during reps (body line, hips, neck). */
  private formSmoother = new MetricMedian();
  private counter: RepCounter | CrunchCounter | PullupCounter | null = null;
  private pullupGate: PullupFramingGate;
  /** Pull-ups: this frame's reading (both arms, the head and the bar). */
  private pull: PullupReading | null = null;
  private offBarSince: number | null = null;
  /** The hold clock being timed now (side plank: the active side's). */
  private holdTimer: HoldTimer | null = null;
  /** Side plank: a clock per side, plus its time calls and countdown so far. */
  private sideTimers: Partial<Record<Side, HoldTimer>> = {};
  private sideMarks: Partial<Record<Side, { milestone: number; countdown: number | null }>> = {};
  private activeSide: Side | null = null;
  private doneSides = new Set<Side>();
  private supportSides: SupportSideSelector;
  readonly exercise: Exercise;
  private targetHoldMs: number | null;
  /** Plank type seen in the latest start check. */
  private startVariant: PlankVariant = 'high';
  private lastMilestone = 0;
  private reality: RealityCheck;
  private realityFlags = 0;
  private lastCountdown: number | null = null;
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
  /** Why the set was paused before the app was left: a screen or a moved phone still has to clear. */
  private pausedBefore: PauseReason | null = null;
  /** When the current stretch of setup began (phone or body check), for the setup timeout. */
  private setupSince: number | null = null;
  /** The app is away (background, call, camera interrupted): no timeout runs meanwhile. */
  private away = false;
  private pausedAt: number | null = null;
  private pauses = 0;
  private lostSince: number | null = null;
  /** Recent frames during the set, each usable for counting or not. */
  private coverage: { t: number; ok: boolean }[] = [];
  private lostReason: PauseReason = 'lost-tracking';
  private outOfPositionSince: number | null = null;
  /** Last moment of progress (counting began or a rep landed), for the idle timeout. */
  private idleSince: number | null = null;
  /** The last few accepted frames' hip position and torso length (unsmoothed), newest last. */
  private identity: { t: number; hip: { x: number; y: number }; torso: number }[] = [];
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
    const base = opts.config ?? DEFAULT_CONFIG;
    this.exercise = opts.exercise ?? 'pushup';
    // Pull-ups: the phone leans back (or stands higher) to see the bar.
    this.cfg = this.exercise === 'pullup' ? { ...base, phone: { ...base.phone, maxPitchDeg: base.pullup.maxPitchDeg } } : base;
    this.difficulty = opts.difficulty;
    this.targetReps = !isTimed(this.exercise) && opts.targetReps && opts.targetReps > 0 ? Math.floor(opts.targetReps) : null;
    this.targetHoldMs = isTimed(this.exercise) && opts.targetHoldMs && opts.targetHoldMs > 0 ? opts.targetHoldMs : null;
    this.tracker = new PoseTracker(this.cfg);
    this.sides = new SideSelector(this.cfg);
    this.phoneGate = new PhoneGate(this.cfg);
    this.framingGate = new FramingGate(this.cfg);
    this.frontGate = new FrontFramingGate(this.cfg);
    this.pullupGate = new PullupFramingGate(this.cfg);
    this.plankHold = new PlankHold(this.cfg);
    this.reality = new RealityCheck(this.cfg);
    this.supportSides = new SupportSideSelector(this.cfg);
  }

  /** Seen head-on: push-ups and the plank (see EXERCISES.frontView). */
  private get front(): boolean {
    // Pull-ups are always seen from the front (or a diagonal).
    if (this.exercise === 'pullup') return true;
    return this.cfg.view === 'front' && EXERCISES[this.exercise].frontView;
  }

  /** Framing and measurements for this frame, side-on or head-on. */
  private read(
    pose: TrackedPose,
    side: Side | null,
  ): { framing: FramingCheck; metrics: BodyMetrics | null; chain: ReturnType<typeof buildChain> | null } {
    const chain = side && pose.detected ? buildChain(pose, side) : null;
    if (this.exercise === 'pullup') {
      this.pull = readPullup(pose, this.cfg);
      return { framing: this.pullupGate.check(pose), metrics: this.pull ? pullupMetrics(this.pull, pose) : null, chain };
    }
    if (this.front) {
      const framing = this.frontGate.check(pose);
      return { framing, metrics: pose.detected ? frontMetrics(pose, this.cfg, this.exercise) : null, chain };
    }
    return {
      framing: this.framingGate.check(pose, chain),
      metrics: chain ? computeMetrics(chain, pose, this.phoneGate.horizonRoll(pose.t), this.cfg) : null,
      chain,
    };
  }

  /**
   * The body side the rules read. Push-ups and plank: the side facing the
   * camera. Side plank: the side on the floor (you face the phone, both sides in view).
   */
  private pickSide(pose: TrackedPose): Side | null {
    if (this.exercise === 'sidePlank') return pose.detected ? this.supportSides.update(pose) : this.supportSides.current;
    return pose.detected ? this.sides.update(pose) : this.sides.current;
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

  /** Depth readings at the body (iPhone): part of the real-person check. */
  pushDepth(p: DepthProbe): void {
    if (this.phase === 'ended') return;
    this.reality.pushDepth(p);
    this.advanceClock(p.t);
    if (this.phase === 'counting' && this.reality.issue(this.now)) this.flagNotReal(this.now);
  }

  /** Latest depth reading, for diagnostics. */
  get realityDebug(): { standOut: number | null; torsoM: number | null } {
    return this.reality.lastDepth;
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
      if (this.pauseReason === 'not-real') {
        // Stay paused until there has been no sign of a screen for a while.
        const side = this.pickSide(pose);
        const chain = side && pose.detected ? buildChain(pose, side) : null;
        this.feedContacts(chain, pose);
        if (this.reality.issue(this.now) || this.reality.clearFor(this.now) < this.cfg.reality.clearMs) {
          this.cue({ kind: 'paused', reason: 'not-real' });
          return;
        }
      }
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
    if ((this.phase === 'phone-setup' || this.phase === 'body-check') && !this.away) {
      this.setupSince ??= t;
      if (t - this.setupSince > this.cfg.session.setupTimeoutMs) {
        this.end('idle');
        return;
      }
    }
    if (this.phase === 'phone-setup') this.evaluatePhone();
    if (this.phase === 'counting') {
      // No frames at all (camera stalled) also counts as lost tracking.
      if (this.lostSince === null && this.metrics && t - this.metrics.t > this.cfg.session.pauseAfterMs) {
        this.pauseLost('lost-tracking', this.metrics.t);
      } else if (this.lostSince !== null && t - this.lostSince >= this.cfg.session.pauseAfterMs) {
        this.pauseLost(this.lostReason, this.lostSince);
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
    this.away = true;
    if (this.phase === 'counting') {
      this.pause('interrupted');
      this.pausedBefore = null;
    } else if (this.phase === 'paused') {
      // Already paused (e.g. stood up) and then away from the app: time away must not end the set.
      if (this.pauseReason !== 'interrupted') this.pausedBefore = this.pauseReason;
      this.pauseReason = 'interrupted';
    }
    // Any plank hold in progress is void: we were not watching.
    this.plankHold.reset();
    this.plankProgress = 0;
    this.tracker.reset();
    this.reality.reset();
  }

  /** App is back; the user has to get back into a plank to continue. */
  resumeFromInterrupt(t: number): void {
    this.advanceClock(t);
    this.away = false;
    // An interruption never ends a set: setup's ten minutes start again from now.
    this.setupSince = null;
    this.tracker.reset();
    this.sides.reset();
    this.supportSides.reset();
    this.reality.reset();
    this.plankHold.reset();
    this.plankProgress = 0;
    this.lastDetectedT = null;
    if (this.phase === 'paused') {
      // A screen or a moved phone still has to clear: leaving the app doesn't skip those checks.
      if (this.pauseReason === 'interrupted')
        this.pauseReason = this.pausedBefore === 'not-real' || this.pausedBefore === 'phone-moved' ? this.pausedBefore : 'lost-tracking';
      this.pausedBefore = null;
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

  /** Pull-ups: the bar's height as a share of the picture height (where the hands rest), once known. */
  get pullupBar(): number | null {
    if (!(this.counter instanceof PullupCounter) || !this.lastPose || !(this.lastPose.height > 0)) return null;
    const y = this.counter.barY;
    return y === null ? null : y / this.lastPose.height;
  }

  get currentSide(): Side | null {
    return this.exercise === 'sidePlank' ? this.supportSides.current : this.sides.current;
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
    if (isTimed(this.exercise)) {
      if (this.phase === 'body-check') return this.plankIssues.length > 0 ? 1 : 0;
      const st = this.holdTimer?.currentState;
      return st === 'broken' ? 2 : st === 'warning' ? 1 : 0;
    }
    if (this.exercise === 'pullup') return this.phase === 'body-check' && this.plankIssues.length > 0 ? 1 : 0;
    // Count-only mode (Easy) never colours the body as a fault.
    if (this.exercise === 'crunch') {
      if (this.phase === 'body-check') return this.plankIssues.length > 0 ? 1 : 0;
      const lift = this.counter instanceof CrunchCounter && m.trunkLiftDeg !== null ? m.trunkLiftDeg - this.counter.restDeg : null;
      return this.cfg.form.enabled && lift !== null && lift > this.cfg.crunch.satUpDeg ? 1 : 0;
    }
    if (!this.cfg.form.enabled) return this.phase === 'body-check' && this.plankIssues.length > 0 ? 1 : 0;
    if (m.hipOffset !== null && Math.abs(m.hipOffset) > this.cfg.form.hipOffsetFault) return 2;
    if (m.bodyLineDeg !== null && m.bodyLineDeg < this.cfg.form.minBodyLineDeg) return 1;
    if (this.phase === 'body-check' && this.plankIssues.length > 0) return 1;
    return 0;
  }

  snapshot(): SessionSnapshot {
    const last = this.reps[this.reps.length - 1] ?? null;
    return {
      exercise: this.exercise,
      view: this.front ? 'front' : 'side',
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
      side: this.currentSide,
      pauseReason: this.pauseReason,
      lastRep: last,
      targetReps: this.targetReps,
      startedAt: this.startedAt,
      elapsedMs: this.activeMs + (this.lastActiveT !== null ? this.now - this.lastActiveT : 0),
      placement: this.placement(),
      hold: this.holdTimer?.snapshot() ?? null,
      targetHoldMs: this.targetHoldMs,
      reality: this.reality.issue(this.now),
      holdSides: this.exercise === 'sidePlank' ? Object.fromEntries(Object.entries(this.sideTimers).map(([k, v]) => [k, v!.good])) : null,
      activeSide: this.activeSide,
      doneSides: [...this.doneSides],
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
    const side = this.pickSide(pose);
    const { framing, metrics, chain } = this.read(pose, side);
    this.framing = framing;
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
    const smoothed = this.checkSmoother.push(metrics);
    const plank =
      this.exercise === 'pullup'
        ? checkHangStart(this.pull, this.cfg)
        : this.front
          ? checkFrontStart(pose, smoothed, this.cfg, this.exercise)
          : checkPlank(smoothed, this.cfg, this.exercise);
    this.plankIssues = plank.issues;
    if (plank.ok) this.startVariant = plank.variant;
    if (!act) return;

    const shoulderY = this.front ? (pose.points[LM.leftShoulder].y + pose.points[LM.rightShoulder].y) / 2 : chain.shoulder.y;
    const hold = this.plankHold.update(metrics, shoulderY, plank.ok, holdMs);
    this.plankProgress = hold.progress;
    if (!plank.ok) {
      // A short blip inside a good hold is ignored, not announced.
      if (!hold.riding) this.cue({ kind: 'plank', issue: plank.issues[0] });
      return;
    }
    if (hold.wobbly) this.cue({ kind: 'plank', issue: 'hold-still' });
    if (hold.calibration) {
      // A video of someone in a plank must not start the set.
      // Side plank: a side that already reached its target is done; ask for the other one.
      if (this.exercise === 'sidePlank' && this.doneSides.has(hold.calibration.side)) {
        this.plankHold.reset();
        this.plankProgress = 0;
        this.cue({ kind: 'switch-sides', done: hold.calibration.side });
        return;
      }
      const issue = this.reality.issue(pose.t);
      if (issue) {
        this.plankHold.reset();
        this.plankProgress = 0;
        this.cue({ kind: 'not-real', issue });
        return;
      }
      this.beginCounting(hold.calibration, pose.t);
    }
  }

  private beginCounting(cal: Calibration, t: number): void {
    this.calibration = cal;
    const resuming = this.phase === 'paused';
    if (this.exercise === 'sidePlank') {
      // One clock per side; time calls and the countdown carry on per side too.
      if (this.activeSide !== null) this.sideMarks[this.activeSide] = { milestone: this.lastMilestone, countdown: this.lastCountdown };
      const side = cal.side;
      const existing = this.sideTimers[side];
      if (existing) existing.restart(cal);
      else this.sideTimers[side] = new HoldTimer(this.cfg, cal, this.startVariant, true);
      this.holdTimer = this.sideTimers[side]!;
      this.activeSide = side;
      const marks = this.sideMarks[side];
      this.lastMilestone = marks?.milestone ?? 0;
      this.lastCountdown = marks?.countdown ?? null;
    } else if (isTimed(this.exercise)) {
      if (this.holdTimer) this.holdTimer.restart(cal);
      else this.holdTimer = new HoldTimer(this.cfg, cal, this.startVariant);
    } else if (this.counter) this.counter.restart(cal);
    else
      this.counter =
        this.exercise === 'crunch'
          ? new CrunchCounter(this.cfg, cal)
          : this.exercise === 'pullup'
            ? new PullupCounter(this.cfg, cal)
            : new RepCounter(this.cfg, cal);
    if (this.startedAt === null) this.startedAt = t;
    this.lostSince = null;
    this.outOfPositionSince = null;
    this.pauseReason = null;
    this.pausedAt = null;
    this.identity = [];
    this.identityJumping = false;
    this.coverage = [];
    this.plankHold.reset();
    this.plankProgress = 0;
    this.formSmoother.reset();
    this.offBarSince = null;
    // Idle timer restarts on resume so a long rest is not counted as idle.
    this.idleSince = t;
    this.lastActiveT = t;
    this.setPhase('counting');
    this.cue({ kind: resuming ? 'resume' : 'start' }, true);
  }

  private evaluateCounting(pose: TrackedPose): void {
    const t = pose.t;
    const side = this.pickSide(pose);
    const { framing, metrics, chain } = this.read(pose, side);

    // Identity: a sudden jump in body position or size means another person
    // (or a bad detection). Ignore the frame instead of counting from it.
    const id = metrics ? { hip: metrics.hipCenter, torso: metrics.torsoPx } : null;
    if (metrics && id && this.isIdentityJump(id, t)) {
      this.identityJumping = true;
      this.reality.distrustContacts();
      this.markLost(t, 'other-person');
      return;
    }

    // Keep framing hints (low light, drifting out of frame) live during the set.
    this.framing = framing;

    const usable =
      metrics !== null &&
      (this.exercise === 'crunch'
        ? metrics.trunkLiftDeg !== null
        : this.exercise === 'pullup'
          ? this.pull !== null && this.pull.mouthY !== null && this.pull.wrist !== null
          : metrics.elbowDeg !== null || metrics.shoulderHeight !== null);
    this.noteCoverage(t, usable);
    // Say what is out of view, mid-set too (rate-limited like every cue).
    if (!framing.ok && framing.issue && this.counter) this.cue({ kind: 'framing', issue: framing.issue });
    if (!usable) {
      this.markLost(t, 'lost-tracking');
      return;
    }
    // Tracking keeps dropping out (a joint we count from leaves the picture at
    // one end of every rep): the count would silently stall, so pause and say so.
    if (this.coverageLow(t)) {
      this.pause('lost-tracking');
      return;
    }
    this.lostSince = null;
    this.metrics = metrics;
    this.identityJumping = false;
    this.acceptIdentity({ t, hip: metrics.hipCenter, torso: metrics.torsoPx });

    this.feedContacts(chain, pose);
    if (this.reality.issue(t)) {
      this.flagNotReal(t);
      return;
    }

    if (isTimed(this.exercise)) {
      // Side plank: turning onto the other side mid-hold is a new hold on that side.
      if (this.exercise === 'sidePlank' && side !== null && this.activeSide !== null && side !== this.activeSide) {
        this.pause('left-position');
        return;
      }
      this.evaluateHold(metrics, t);
      return;
    }
    if (this.exercise === 'crunch') {
      this.evaluateCrunch(metrics, t);
      return;
    }
    if (this.exercise === 'pullup') {
      this.evaluatePullup(this.pull!, t);
      return;
    }

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

    const counter = this.counter as RepCounter;
    this.depth = counter.depthProgress(metrics);
    // Counting uses the raw elbow and shoulder signals (no lag on fast reps);
    // form is judged on median-smoothed body line, hips and neck.
    const smooth = this.formSmoother.push(metrics);
    this.handleRepEvent(
      counter.update({ ...metrics, bodyLineDeg: smooth.bodyLineDeg, hipOffset: smooth.hipOffset, neckDeg: smooth.neckDeg }),
      t,
    );
  }

  /**
   * Crunch: everything is read from median-smoothed readings. A crunch is slow
   * (over a second), so ~70 ms of lag costs nothing, while a single misread
   * shoulder frame would otherwise jump the lift past a threshold.
   */
  private evaluateCrunch(metrics: BodyMetrics, t: number): void {
    const c = this.cfg.crunch;
    const smooth = this.formSmoother.push(metrics);
    // Sat or stood up, or stretched the legs out flat, for a while → pause (a rest).
    const sat = smooth.trunkLiftDeg !== null && smooth.trunkLiftDeg > c.outLiftDeg;
    const legsOut = smooth.kneeDeg !== null && smooth.kneeDeg > Math.min(172, c.maxKneeDeg + 25);
    if (sat || legsOut) {
      if (this.outOfPositionSince === null) this.outOfPositionSince = t;
      if (t - this.outOfPositionSince >= this.cfg.session.pauseAfterMs) {
        this.pause('left-position');
        return;
      }
    } else {
      this.outOfPositionSince = null;
    }
    const counter = this.counter as CrunchCounter;
    this.depth = counter.depthProgress(smooth);
    this.handleRepEvent(counter.update(smooth), t);
  }

  /** Pull-ups: off the bar for a while is a rest (the set pauses); otherwise count. */
  private evaluatePullup(r: PullupReading, t: number): void {
    if (!r.overhead) {
      if (this.offBarSince === null) this.offBarSince = t;
      if (t - this.offBarSince >= this.cfg.pullup.offBarMs) {
        this.pause('left-position');
        return;
      }
    } else this.offBarSince = null;
    const counter = this.counter as PullupCounter;
    this.depth = counter.depthProgress(r);
    this.handleRepEvent(counter.update(r), t);
  }

  private handleRepEvent(ev: ReturnType<RepCounter['update']>, t: number): void {
    if (!ev) return;
    if (ev.type === 'rep') {
      this.reps.push(ev.rep);
      this.idleSince = t;
      this.emit({ type: 'rep', rep: ev.rep });
      this.cue({ kind: 'rep', count: this.reps.length, clean: ev.rep.clean }, true);
      const fault = ev.rep.faults.find((f) => !HINT_FAULTS.includes(f)) ?? ev.rep.faults[0];
      if (fault) this.cue({ kind: 'fault', fault });
      if (this.targetReps !== null && this.reps.length >= this.targetReps) {
        this.cue({ kind: 'target-reached' }, true);
        this.end('target');
      }
    } else if (ev.type === 'late-fault') {
      // Seen after the count (pull-ups: dropping on the way down); the rep record already carries it.
      this.cue({ kind: 'fault', fault: ev.fault });
    } else if (ev.type === 'miss') {
      this.misses.push(ev.miss);
      this.emit({ type: 'miss', miss: ev.miss });
      this.cue({ kind: 'miss', reason: ev.miss.reason });
    }
  }

  /** Plank: time the hold, judged on median-smoothed readings (a plank is still, so smoothing costs nothing). */
  private evaluateHold(metrics: BodyMetrics, t: number): void {
    const timer = this.holdTimer!;
    const smooth = this.formSmoother.push(metrics);
    const ev = timer.update(smooth);
    if (timer.currentState !== 'broken') this.idleSince = t;

    // A form break first: in test mode it ends the hold, which must win over the
    // pause below when both land on the same frame.
    if (ev && this.handleHoldEvent(ev)) return;

    // Out of a plank altogether (stood up, knees down) for a while → pause, as for push-ups.
    const upright = smooth.trunkTiltDeg !== null && smooth.trunkTiltDeg > this.cfg.plank.maxTrunkTiltDeg + 20;
    const kneeling = !this.cfg.allowKneeling && smooth.kneeDeg !== null && smooth.kneeDeg < 110;
    if (upright || kneeling) {
      if (this.outOfPositionSince === null) this.outOfPositionSince = t;
      if (t - this.outOfPositionSince >= this.cfg.session.pauseAfterMs) {
        this.pause('left-position');
        return;
      }
    } else {
      this.outOfPositionSince = null;
    }

    const good = timer.good;
    if (this.targetHoldMs !== null) {
      const left = this.targetHoldMs - good;
      if (left <= 0) {
        if (this.exercise === 'sidePlank' && this.activeSide !== null) {
          // The target is per side: this side is done; finish once both are.
          this.doneSides.add(this.activeSide);
          if (this.doneSides.size < 2) {
            this.cue({ kind: 'switch-sides', done: this.activeSide }, true);
            this.pause('switch-sides');
            return;
          }
        }
        this.cue({ kind: 'target-reached' }, true);
        this.end('target');
        return;
      }
      const secs = Math.ceil(left / 1000);
      if (secs <= 5 && secs !== this.lastCountdown) {
        this.lastCountdown = secs;
        this.cue({ kind: 'hold-countdown', seconds: secs }, true);
        return;
      }
    }
    const step = this.cfg.hold.milestoneSec * 1000;
    const milestone = step > 0 ? Math.floor(good / step) : 0;
    if (milestone > this.lastMilestone) {
      this.lastMilestone = milestone;
      // Close to the target the countdown takes over.
      if (this.targetHoldMs === null || this.targetHoldMs - good > 6000) {
        this.cue({ kind: 'hold-time', seconds: milestone * this.cfg.hold.milestoneSec }, true);
      }
    }
  }

  /** The plank's summary; a side plank adds each side and combines them. */
  private holdSummaries(): Pick<SessionSummary, 'hold' | 'holdSides'> {
    if (this.exercise !== 'sidePlank') return { hold: this.holdTimer?.summary() };
    const sides = Object.fromEntries(Object.entries(this.sideTimers).map(([k, v]) => [k, v!.summary()])) as Partial<
      Record<Side, HoldSummary>
    >;
    const all = Object.values(sides);
    if (all.length === 0) return {};
    const faultMs: HoldSummary['faultMs'] = {};
    for (const s of all)
      for (const [f, ms] of Object.entries(s.faultMs)) faultMs[f as HoldFault] = (faultMs[f as HoldFault] ?? 0) + (ms ?? 0);
    const goodMs = all.reduce((n, s) => n + s.goodMs, 0);
    const totalMs = all.reduce((n, s) => n + s.totalMs, 0);
    return {
      holdSides: sides,
      hold: {
        variant: all[0].variant,
        goodMs,
        totalMs,
        longestMs: Math.max(...all.map((s) => s.longestMs)),
        breaks: all.reduce((n, s) => n + s.breaks, 0),
        faultMs,
        headDownMs: all.reduce((n, s) => n + s.headDownMs, 0),
        formPct: totalMs > 0 ? Math.min(1, goodMs / totalMs) : 0,
      },
    };
  }

  /** @returns true when the set ended. */
  private handleHoldEvent(ev: HoldEvent): boolean {
    if (ev.type === 'warning') {
      this.cue({ kind: 'hold', state: 'warning', fault: ev.fault });
    } else if (ev.type === 'break') {
      this.cue({ kind: 'hold', state: 'break', fault: ev.fault }, true);
      if (this.cfg.hold.endOnBreak) {
        this.end('form-break');
        return true;
      }
    } else {
      this.cue({ kind: 'hold-restored' });
    }
    return false;
  }

  /**
   * The points planted on the floor, for the handheld-screen check, with whether
   * the phone itself is still: hands and feet, or for crunches hips and feet
   * (the hands move with the body).
   */
  private feedContacts(chain: ReturnType<typeof buildChain> | null, pose: TrackedPose): void {
    const min = this.cfg.minVisibility;
    const pts: { x: number; y: number }[] = [];
    if (this.front) {
      if (pose.detected) pts.push(...frontContacts(pose, this.cfg));
    } else if (chain) {
      const hand = this.exercise === 'crunch' ? { p: chain.hip, v: chain.vis.hip } : { p: chain.wrist, v: chain.vis.wrist };
      if (hand.v >= min) pts.push({ x: hand.p.x / pose.width, y: hand.p.y / pose.height });
      if (chain.vis.ankle >= min) pts.push({ x: chain.ankle.x / pose.width, y: chain.ankle.y / pose.height });
    } else return;
    const a = this.phoneGate.attitude;
    const fresh = a !== null && pose.t - a.t <= this.cfg.phone.staleMs;
    this.reality.pushContacts(pose.t, pts, fresh ? a.motionDegPerSec < this.cfg.reality.stillPhoneDegPerSec : null);
  }

  /**
   * The camera has been watching a screen: take back what was counted while
   * the evidence built up, and pause until a real person is back.
   */
  private flagNotReal(t: number): void {
    const since = this.reality.suspectSince(t) ?? t;
    const kept = this.reps.filter((r) => r.endT < since);
    const removed = this.reps.length - kept.length;
    if (removed > 0) {
      this.reps = kept;
      if (this.counter) this.counter.count = kept.length;
      this.emit({ type: 'revoke', reps: removed });
    }
    this.holdTimer?.rewind(since);
    this.realityFlags += 1;
    this.pause('not-real');
  }

  /** Remember an accepted frame; after a real gap, start over. */
  private acceptIdentity(f: PushupSession['identity'][number]): void {
    const last = this.identity[this.identity.length - 1];
    if (last && f.t - last.t > 400) this.identity = [];
    this.identity.push(f);
    if (this.identity.length > IDENTITY_FRAMES) this.identity.shift();
  }

  private isIdentityJump(id: { hip: { x: number; y: number }; torso: number }, t: number): boolean {
    const hist = this.identity;
    const last = hist[hist.length - 1];
    if (!last) return false;
    // After a real gap (no body at all) the user may come back anywhere. But
    // while frames keep showing a different body, keep comparing against the
    // last accepted ones so the jump persists until the pause fires.
    if (!this.identityJumping && t - last.t > 400) return false;
    // The median of the last few frames: one misread joint must not become the
    // reference, and a swap the landmark filter spreads over a few frames still
    // shows in full against it.
    const prev = {
      hip: { x: median(hist.map((f) => f.hip.x)), y: median(hist.map((f) => f.hip.y)) },
      torso: median(hist.map((f) => f.torso)),
    };
    const jump = Math.hypot(id.hip.x - prev.hip.x, id.hip.y - prev.hip.y);
    const scale = Math.abs(id.torso - prev.torso) / prev.torso;
    const j = jump / this.cfg.session.identityJump;
    const sc = scale / this.cfg.session.identityScale;
    // Either change alone past its limit, or both clearly at once: a real
    // person never moves across the frame and changes size together.
    return j > 1 || sc > 1 || j + sc > IDENTITY_COMBINED;
  }

  private noteCoverage(t: number, ok: boolean): void {
    this.coverage.push({ t, ok });
    while (this.coverage.length && t - this.coverage[0].t > COVERAGE_MS) this.coverage.shift();
  }

  /**
   * Counting points missing for a good share of the last few seconds, on and
   * off. One long gap is already handled by `markLost`; this catches the
   * flicker that keeps resetting it.
   */
  private coverageLow(t: number): boolean {
    const c = this.coverage;
    if (c.length < 20 || t - c[0].t < COVERAGE_MS * 0.9) return false;
    const missing = c.filter((f) => !f.ok).length / c.length;
    return missing > COVERAGE_MAX_MISSING;
  }

  private markLost(t: number, reason: PauseReason): void {
    if (this.lostSince === null) this.lostSince = t;
    this.lostReason = reason;
    if (t - this.lostSince >= this.cfg.session.pauseAfterMs) this.pauseLost(reason, this.lostSince);
  }

  /**
   * Was the user getting up when we lost them? A phone on the floor can't see
   * the head of someone standing, so standing up usually ends in lost tracking
   * before "stood up" can be measured. If the last frames showed them rising,
   * it is a rest (left position), not a camera problem.
   */
  private wasGettingUp(): boolean {
    if (this.outOfPositionSince !== null) return true;
    const m = this.metrics;
    if (!m) return false;
    if (this.exercise === 'crunch') return m.trunkLiftDeg !== null && m.trunkLiftDeg > this.cfg.crunch.outLiftDeg * 0.75;
    return m.trunkTiltDeg !== null && m.trunkTiltDeg > this.cfg.plank.maxTrunkTiltDeg;
  }

  /** Pause after losing the user; standing up instead reads as a rest, and ends a plank test. */
  private pauseLost(reason: PauseReason, at: number): void {
    if (reason === 'lost-tracking' && this.wasGettingUp()) {
      // Plank test mode: getting up is the end of the test, as it would be if we could still see it.
      if (this.cfg.hold.endOnBreak && isTimed(this.exercise) && (this.holdTimer?.good ?? 0) > 0) {
        this.stopActiveClock(at);
        this.end('form-break');
        return;
      }
      reason = 'left-position';
    }
    this.pause(reason, at);
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
    this.holdTimer?.pause();
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
    if (phase === 'counting') this.setupSince = null;
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
      exercise: this.exercise,
      difficulty: this.difficulty,
      view: this.front ? 'front' : 'side',
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
      ...this.holdSummaries(),
      realityFlags: this.realityFlags,
    };
  }
}
