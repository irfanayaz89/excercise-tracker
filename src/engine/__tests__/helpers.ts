/// <reference types="jest" />
import { mergeConfig, type DeepPartial, type EngineConfig } from '../config';
import { PushupSession, type SessionEvent } from '../session';
import { emptySample, hold, levelPhone, timeline, type BodyParams, type Segment, type TimelineOptions } from '../testing/synth';
import type { PoseSample } from '../types';

export interface Harness {
  session: PushupSession;
  events: SessionEvent[];
  t: number;
  /** Feed pose frames, plus a level phone reading and a tick for each frame. */
  play(samples: PoseSample[], phone?: { roll?: number; pitch?: number; motion?: number } | null): void;
  /** Advance time with no camera frames at all. */
  silence(ms: number, phone?: boolean): void;
  /** Frames where the model finds nobody. */
  nobody(ms: number): void;
  segments(segs: Segment[], opts?: TimelineOptions): void;
  reps(): number;
  misses(reason?: string): number;
  cues(kind: string): SessionEvent[];
}

export function harness(opts: { config?: DeepPartial<EngineConfig>; targetReps?: number; base?: Partial<BodyParams> } = {}): Harness {
  const session = new PushupSession({ config: mergeConfig(opts.config), targetReps: opts.targetReps });
  const events: SessionEvent[] = [];
  session.subscribe((e) => events.push(e));
  const h: Harness = {
    session,
    events,
    t: 1000,
    play(samples, phone = {}) {
      for (const s of samples) {
        if (phone) session.pushAttitude(levelPhone(s.t, phone.roll ?? 0, phone.pitch ?? 0, phone.motion ?? 0));
        session.pushPose(s);
        session.tick(s.t);
        h.t = s.t;
      }
    },
    silence(ms, phone = true) {
      const end = h.t + ms;
      while (h.t < end) {
        h.t += 100;
        if (phone) session.pushAttitude(levelPhone(h.t));
        session.tick(h.t);
      }
    },
    nobody(ms) {
      const end = h.t + ms;
      while (h.t < end) {
        h.t += 33;
        session.pushAttitude(levelPhone(h.t));
        session.pushPose(emptySample(h.t));
        session.tick(h.t);
      }
    },
    segments(segs, o = {}) {
      h.play(timeline(segs, { startT: h.t + 33, ...o, base: { ...opts.base, ...o.base } }));
    },
    reps: () => events.filter((e) => e.type === 'rep').length,
    misses: (reason) => events.filter((e) => e.type === 'miss' && (reason === undefined || e.miss.reason === reason)).length,
    cues: (kind) => events.filter((e) => e.type === 'cue' && e.cue.kind === kind),
  };
  return h;
}

/** Phone set → plank held → counting. */
export function startCounting(h: Harness, base: Partial<BodyParams> = {}): void {
  h.segments([hold(2600, base)]);
}
