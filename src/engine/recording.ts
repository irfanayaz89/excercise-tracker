/**
 * Compact recording format for real sessions, and a replayer.
 *
 * Phase 4 workflow: turn on "Record sets for tuning" in settings, do real
 * sets, hand-count the reps, share the file, drop it into
 * `fixtures/recordings/` with an `expected` block, and the replay test
 * (`src/engine/__tests__/replay.test.ts`) checks every threshold change
 * against those real sets.
 */
import { mergeConfig, type DeepPartial, type EngineConfig } from './config';
import { PushupSession, type SessionSummary } from './session';
import { LANDMARK_COUNT, LM, type Exercise, type Landmark, type PhoneAttitude, type PoseSample } from './types';

/** Only the landmarks the engine reads are stored, to keep files small. */
export const RECORDED_LANDMARKS: number[] = [
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
];

export interface Recording {
  version: 1;
  createdAt: string;
  platform: string;
  model: string;
  /** [t, width, height, ...for each RECORDED_LANDMARK: x, y, visibility, presence] — empty landmarks = no person. */
  frames: number[][];
  /** [t, roll, pitch, motion] */
  attitude: number[][];
  /** Manual confirmation time if the phone had no sensor. */
  manualPhoneAt?: number;
  /** [t, 0 = interrupted (app backgrounded, camera interrupted) | 1 = resumed] */
  events?: number[][];
  /** Missing in recordings made before planks existed (push-ups). */
  exercise?: Exercise;
  /** Filled in by hand after the set, for replay tests. */
  expected?: { reps: number; cleanReps?: number; tolerance?: number; notes?: string };
  /** Config overrides the session ran with (e.g. allowKneeling). */
  config?: DeepPartial<EngineConfig>;
}

const round = (v: number, d = 4) => Math.round(v * 10 ** d) / 10 ** d;

export class Recorder {
  private frames: number[][] = [];
  private attitude: number[][] = [];
  private manualPhoneAt: number | undefined;
  private events: number[][] = [];
  private lastAttitudeT = -Infinity;

  constructor(private maxFrames = 30 * 60 * 6) {}

  get size(): number {
    return this.frames.length;
  }

  pose(s: PoseSample): void {
    if (this.frames.length >= this.maxFrames) return;
    const row = [round(s.t, 1), s.width, s.height];
    if (s.landmarks.length >= LANDMARK_COUNT) {
      for (const i of RECORDED_LANDMARKS) {
        const l = s.landmarks[i];
        if (!l) row.push(0, 0, 0, 0);
        else row.push(round(l.x), round(l.y), round(l.visibility ?? 0, 3), round(l.presence ?? 1, 3));
      }
    }
    this.frames.push(row);
  }

  phone(a: PhoneAttitude): void {
    // 10 Hz is plenty for the phone gate.
    if (a.t - this.lastAttitudeT < 90) return;
    this.lastAttitudeT = a.t;
    this.attitude.push([round(a.t, 1), round(a.rollDeg, 2), round(a.pitchDeg, 2), round(a.motionDegPerSec, 1)]);
  }

  manualPhone(t: number): void {
    this.manualPhoneAt = t;
  }

  interrupt(t: number): void {
    this.events.push([round(t, 1), 0]);
  }

  resume(t: number): void {
    this.events.push([round(t, 1), 1]);
  }

  finish(meta: { platform: string; model: string; config?: DeepPartial<EngineConfig>; exercise?: Exercise }): Recording {
    return {
      version: 1,
      createdAt: new Date().toISOString(),
      platform: meta.platform,
      model: meta.model,
      frames: this.frames,
      attitude: this.attitude,
      manualPhoneAt: this.manualPhoneAt,
      events: this.events.length ? this.events : undefined,
      config: meta.config,
      exercise: meta.exercise,
    };
  }
}

export function decodeFrame(row: number[]): PoseSample {
  const [t, width, height] = row;
  if (row.length <= 3) return { t, width, height, landmarks: [] };
  const lms: Landmark[] = Array.from({ length: LANDMARK_COUNT }, () => ({ x: 0, y: 0, z: 0, visibility: 0, presence: 0 }));
  RECORDED_LANDMARKS.forEach((idx, k) => {
    const o = 3 + k * 4;
    lms[idx] = { x: row[o], y: row[o + 1], z: 0, visibility: row[o + 2], presence: row[o + 3] };
  });
  return { t, width, height, landmarks: lms };
}

/** Replays a recording through a fresh engine, interleaving inputs by time. */
export function replay(rec: Recording, overrides?: DeepPartial<EngineConfig>): SessionSummary {
  // Merge per section so a tuning override (e.g. one `rep` value) keeps the
  // rest of the section the set was recorded with (e.g. Easy's rep thresholds).
  const merged: Record<string, unknown> = { ...rec.config };
  for (const [k, v] of Object.entries(overrides ?? {})) {
    const prev = merged[k];
    merged[k] = v && typeof v === 'object' && prev && typeof prev === 'object' ? { ...prev, ...v } : v;
  }
  const session = new PushupSession({ config: mergeConfig(merged as DeepPartial<EngineConfig>), exercise: rec.exercise });
  const TICK = 250; // matches the live controller's timer
  const events = rec.events ?? [];
  let ai = 0;
  let ei = 0;
  let manualDone = rec.manualPhoneAt === undefined;
  let lastTick = rec.frames.length ? rec.frames[0][0] : 0;
  // Everything that happened up to time t, in time order, like the live app.
  const advance = (t: number) => {
    for (;;) {
      const nextTick = lastTick + TICK;
      const nextAtt = ai < rec.attitude.length ? rec.attitude[ai][0] : Infinity;
      const nextEv = ei < events.length ? events[ei][0] : Infinity;
      const next = Math.min(nextTick, nextAtt, nextEv);
      if (next > t) return;
      if (next === nextAtt) {
        const [at, roll, pitch, motion] = rec.attitude[ai++];
        session.pushAttitude({ t: at, rollDeg: roll, pitchDeg: pitch, motionDegPerSec: motion });
      } else if (next === nextEv) {
        const [et, kind] = events[ei++];
        if (kind === 0) session.interrupt(et);
        else session.resumeFromInterrupt(et);
      } else {
        // Ticks keep running when frames stop (camera stall), as they do live.
        session.tick(nextTick);
        lastTick = nextTick;
      }
    }
  };
  for (const row of rec.frames) {
    const t = row[0];
    advance(t);
    if (!manualDone && t >= rec.manualPhoneAt!) {
      session.confirmPhoneManually();
      manualDone = true;
    }
    session.pushPose(decodeFrame(row));
  }
  return session.end('user');
}
