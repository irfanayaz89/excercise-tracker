/// <reference types="jest" />
/**
 * Plank edge cases, every one at every level: what must never start the
 * clock, what must or must not stop it, every way a hold pauses and resumes,
 * and every way it ends.
 */
import { difficultyConfig, DIFFICULTIES, type Difficulty } from '../difficulty';
import type { SessionEvent, SessionSummary } from '../session';
import { forearmPlank, plank, timeline, type BodyParams } from '../testing/synth';
import { harness, type Harness } from './helpers';

const cfgFor = (level: Difficulty, allowKneeling = false) => difficultyConfig(level, { exercise: 'plank', allowKneeling });

function make(
  level: Difficulty,
  base: Partial<BodyParams> = {},
  extra: { targetHoldMs?: number; endOnBreak?: boolean; allowKneeling?: boolean } = {},
): Harness {
  const config = cfgFor(level, extra.allowKneeling);
  if (extra.endOnBreak) config.hold = { ...config.hold, endOnBreak: true };
  return harness({ config, base, exercise: 'plank', targetHoldMs: extra.targetHoldMs });
}

const snap = (h: Harness) => h.session.snapshot();
const good = (h: Harness) => snap(h).hold?.goodMs ?? 0;
const breaks = (h: Harness) => snap(h).hold?.breaks ?? 0;
const start = (h: Harness, extra: Partial<BodyParams> = {}) => h.segments([plank(3500, extra)]);
const holdCues = (h: Harness, state?: 'warning' | 'break') =>
  h.events.filter((e) => e.type === 'cue' && e.cue.kind === 'hold' && (state === undefined || e.cue.state === state));
const ended = (h: Harness): SessionSummary | null => {
  const e = h.events.find((x): x is Extract<SessionEvent, { type: 'ended' }> => x.type === 'ended');
  return e ? e.summary : null;
};

describe.each(DIFFICULTIES)('plank edge cases, %s', (level) => {
  const cfg = cfgFor(level);
  const sag = cfg.hold.sagFault;
  const pike = cfg.hold.pikeFault;

  // ─── Never starts ────────────────────────────────────────────────────────

  describe('the clock never starts', () => {
    it('for someone standing', () => {
      const h = make(level);
      h.segments([plank(6000, { bodyTiltDeg: 80 })]);
      expect(snap(h).phase).not.toBe('counting');
      expect(snap(h).hold).toBeNull();
    });

    it('with arms half bent (neither plank)', () => {
      const h = make(level);
      h.segments([plank(6000, { elbowDeg: 115 })]);
      expect(snap(h).phase).toBe('body-check');
      expect(snap(h).plankIssues).toContain('straighten-arms');
    });

    it('while nobody is in view', () => {
      const h = make(level);
      h.nobody(5000);
      expect(snap(h).phase).not.toBe('counting');
      expect(snap(h).framing.issue).toBe('no-person');
    });

    it('from a plank already sagging past the limit', () => {
      const h = make(level);
      h.segments([plank(6000, { sag: sag * 1.6 })]);
      expect(snap(h).phase).toBe('body-check');
      expect(snap(h).plankIssues).toContain('hips-sagging');
    });

    it('from hips already piked past the limit', () => {
      const h = make(level);
      h.segments([plank(6000, { sag: -pike * 1.6 })]);
      expect(snap(h).phase).toBe('body-check');
      expect(snap(h).plankIssues).toContain('hips-high');
    });

    it(level === 'easy' ? 'but Easy starts from the knees' : 'from the knees', () => {
      const h = make(level);
      h.segments([plank(6000, { kneeDeg: 100 })]);
      if (level === 'easy') {
        expect(snap(h).phase).toBe('counting');
      } else {
        expect(snap(h).phase).toBe('body-check');
        expect(snap(h).plankIssues).toContain('straighten-legs');
      }
    });
  });

  // ─── During the hold ─────────────────────────────────────────────────────

  describe('during the hold', () => {
    it('hips slowly sinking (fatigue) are warned about well before the clock stops', () => {
      const h = make(level);
      start(h);
      h.segments([plank(4000), plank(15000, (k) => ({ sag: 2 * sag * k })), plank(2000, { sag: 2 * sag })]);
      const warn = holdCues(h, 'warning')[0];
      const brk = holdCues(h, 'break')[0];
      expect(warn).toBeDefined();
      expect(brk).toBeDefined();
      expect(brk.type === 'cue' && warn.type === 'cue' && brk.t - warn.t).toBeGreaterThanOrEqual(1500);
      expect(breaks(h)).toBe(1);
    });

    it('a near miss (hips at 85% of the sag limit) warns but never stops the clock', () => {
      const h = make(level);
      start(h);
      const before = good(h);
      h.segments([plank(10000, { sag: sag * 0.85 })]);
      expect(breaks(h)).toBe(0);
      expect(good(h) - before).toBeGreaterThan(9500);
      expect(holdCues(h, 'warning').length).toBeGreaterThan(0);
    });

    it('hips slightly raised (70% of the pike limit) draw no cue at all', () => {
      const h = make(level);
      start(h);
      h.segments([plank(10000, { sag: -pike * 0.7 })]);
      expect(breaks(h)).toBe(0);
      expect(holdCues(h)).toHaveLength(0);
    });

    it('switching from a high plank down to the forearms keeps the clock running', () => {
      const h = make(level);
      start(h);
      h.segments([plank(4000), plank(600, (k) => ({ elbowDeg: 172 - 60 * k })), forearmPlank(8000)]);
      expect(snap(h).phase).toBe('counting');
      expect(breaks(h)).toBe(0);
      expect(snap(h).hold?.variant).toBe('high'); // the plank it started in
    });

    it('keeps accurate time at 15 fps with dropped frames and noisy joints', () => {
      const h = make(level, { noisePx: 4 });
      h.segments([plank(30000)], { fps: 15, dropFrame: (i) => i % 7 === 3, seed: 11 });
      expect(breaks(h)).toBe(0);
      expect(good(h)).toBeGreaterThan(26000);
      expect(good(h)).toBeLessThanOrEqual(30000);
    });

    it('a five-minute hold: exact time calls, no breaks, no drift', () => {
      const h = make(level, { noisePx: 2 });
      h.segments([plank(300000)]);
      expect(breaks(h)).toBe(0);
      expect(good(h)).toBeGreaterThan(296000);
      const calls = h.events.flatMap((e) => (e.type === 'cue' && e.cue.kind === 'hold-time' ? [e.cue.seconds] : []));
      expect(calls).toEqual(Array.from({ length: Math.floor(good(h) / 15000) }, (_, i) => (i + 1) * 15));
      expect(snap(h).hold?.totalMs).toBe(good(h));
    });

    it(level === 'easy' ? 'feet leaving view: Easy keeps timing' : 'feet leaving view stops the clock until they are back', () => {
      const h = make(level);
      start(h);
      h.segments([plank(4000)]);
      const before = good(h);
      h.segments([plank(5000, { hide: { ankle: 0.05 } })]);
      if (level === 'easy') {
        expect(breaks(h)).toBe(0);
        expect(good(h) - before).toBeGreaterThan(4800);
      } else {
        expect(breaks(h)).toBe(1);
        expect(snap(h).hold?.fault).toBe('out-of-view');
        expect(good(h) - before).toBeLessThan(cfg.hold.graceMs + 500);
        h.segments([plank(4000)]);
        expect(snap(h).hold?.state).toBe('good');
      }
    });

    it('with knees allowed in Settings, knee planks never stop the clock', () => {
      const h = make(level, {}, { allowKneeling: true });
      start(h);
      h.segments([plank(8000, { kneeDeg: 100 })]);
      expect(snap(h).phase).toBe('counting');
      expect(breaks(h)).toBe(0);
    });

    it('a fault cut short by losing tracking is never counted as a break', () => {
      const h = make(level);
      start(h);
      h.segments([plank(4000), plank(300, { sag: sag * 2 })]);
      h.nobody(3000);
      expect(snap(h).phase).toBe('paused');
      h.segments([plank(5000)]);
      expect(snap(h).phase).toBe('counting');
      expect(breaks(h)).toBe(0);
    });
  });

  // ─── Pauses ──────────────────────────────────────────────────────────────

  describe('pauses keep the time and resume from a fresh plank', () => {
    it('lost from view', () => {
      const h = make(level);
      start(h);
      h.segments([plank(5000)]);
      h.nobody(4000);
      expect(snap(h).phase).toBe('paused');
      expect(snap(h).pauseReason).toBe('lost-tracking');
      const frozen = good(h);
      h.nobody(5000);
      expect(good(h)).toBe(frozen);
      h.segments([plank(6000)]);
      expect(snap(h).phase).toBe('counting');
      expect(good(h)).toBeGreaterThan(frozen + 3000);
    });

    it('camera stops sending frames', () => {
      const h = make(level);
      start(h);
      h.segments([plank(4000)]);
      h.silence(4000);
      expect(snap(h).phase).toBe('paused');
      expect(snap(h).pauseReason).toBe('lost-tracking');
    });

    it('app in the background: never ends on its own, resumes when back', () => {
      const h = make(level);
      start(h);
      h.segments([plank(5000)]);
      const frozen = good(h);
      h.session.interrupt(h.t);
      expect(snap(h).pauseReason).toBe('interrupted');
      h.silence(90000);
      expect(snap(h).phase).toBe('paused');
      h.session.resumeFromInterrupt(h.t);
      h.segments([plank(6000)]);
      expect(snap(h).phase).toBe('counting');
      expect(good(h)).toBeGreaterThan(frozen + 3000);
    });

    it('phone knocked over', () => {
      const h = make(level);
      start(h);
      h.segments([plank(4000)]);
      h.play(timeline([plank(3000)], { startT: h.t + 33 }), { roll: 50 });
      expect(snap(h).phase).toBe('paused');
      expect(snap(h).pauseReason).toBe('phone-moved');
      const frozen = good(h);
      h.segments([plank(6000)]);
      expect(snap(h).phase).toBe('counting');
      expect(good(h)).toBeGreaterThan(frozen + 2000);
    });

    it('someone else takes the spot: it pauses, and their frames add no time before it', () => {
      const h = make(level);
      start(h);
      h.segments([plank(4000)]);
      const before = good(h);
      h.segments([plank(2300, { torsoPx: 150, wristX: 700 })]);
      const paused = h.events.some((e) => e.type === 'cue' && e.cue.kind === 'paused' && e.cue.reason === 'other-person');
      expect(paused).toBe(true);
      expect(good(h) - before).toBeLessThan(100);
    });
  });

  // ─── Endings ─────────────────────────────────────────────────────────────

  describe('endings', () => {
    it('paused for over a minute ends the set and keeps the time', () => {
      const h = make(level);
      start(h);
      h.segments([plank(6000)]);
      const kept = good(h);
      h.nobody(3000);
      h.silence(62000);
      const s = ended(h);
      expect(s?.endReason).toBe('paused-too-long');
      expect(s?.hold?.goodMs).toBe(kept);
    });

    it('stuck out of form for 45 seconds ends the set', () => {
      const h = make(level);
      start(h);
      h.segments([plank(3000), plank(50000, { sag: sag * 2 })]);
      expect(ended(h)?.endReason).toBe('idle');
    });

    it('the target is reached while form is only slipping (a warning still counts)', () => {
      const h = make(level, {}, { targetHoldMs: 15000 });
      h.segments([plank(3500), plank(25000, { sag: sag * 0.8 })]);
      const s = ended(h);
      expect(s?.endReason).toBe('target');
      expect(s?.hold?.breaks).toBe(0);
      expect(s?.hold?.goodMs).toBeGreaterThanOrEqual(15000);
    });

    it('a break near the target never repeats the countdown', () => {
      const h = make(level, {}, { targetHoldMs: 20000 });
      h.segments([plank(18500), plank(4000, { sag: sag * 2 }), plank(10000)]);
      expect(ended(h)?.endReason).toBe('target');
      const counts = h.events.flatMap((e) => (e.type === 'cue' && e.cue.kind === 'hold-countdown' ? [e.cue.seconds] : []));
      expect(counts[counts.length - 1]).toBe(1);
      expect(new Set(counts).size).toBe(counts.length);
      expect([...counts].sort((a, b) => b - a)).toEqual(counts);
    });

    it('test mode: standing up ends the hold (it does not just pause)', () => {
      const h = make(level, {}, { endOnBreak: true });
      start(h);
      h.segments([plank(4000), plank(1500, (k) => ({ bodyTiltDeg: 80 * k })), plank(4000, { bodyTiltDeg: 80 })]);
      expect(ended(h)?.endReason).toBe('form-break');
    });

    it('test mode: a warning or a short wobble does not end it', () => {
      const h = make(level, {}, { endOnBreak: true });
      start(h);
      h.segments([plank(3000), plank(4000, { sag: sag * 0.8 }), plank(Math.min(400, cfg.hold.graceMs - 500), { sag: sag * 2 }), plank(3000)]);
      expect(snap(h).phase).toBe('counting');
    });

    it('finishing by hand gives a plank summary with no reps', () => {
      const h = make(level);
      start(h);
      h.segments([plank(6000)]);
      const s = h.session.end();
      expect(s.exercise).toBe('plank');
      expect(s.endReason).toBe('user');
      expect(s.totalReps).toBe(0);
      expect(s.hold?.goodMs).toBeGreaterThan(5500);
      expect(s.hold?.formPct).toBe(1);
    });

    it('finishing before the hold starts has no plank details', () => {
      const h = make(level);
      h.nobody(2000);
      const s = h.session.end();
      expect(s.exercise).toBe('plank');
      expect(s.hold).toBeUndefined();
    });

    it('nothing happens after the end', () => {
      const h = make(level);
      start(h);
      h.segments([plank(3000)]);
      const s = h.session.end();
      h.segments([plank(5000)]);
      expect(good(h)).toBe(s.hold?.goodMs);
      expect(h.events.filter((e) => e.type === 'ended')).toHaveLength(1);
    });
  });
});
