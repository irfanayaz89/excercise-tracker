/// <reference types="jest" />
/**
 * Every exercise has every piece the app shows: how-to steps, mistakes and
 * safety, the guide animation, setup steps, level wording, and words for
 * every message it can trigger. A new exercise added to the registry fails
 * here until it is complete.
 */
import { DIFFICULTIES, difficultyConfig } from '@/engine/difficulty';
import { EXERCISE_IDS, EXERCISES, isExercise, isTimed } from '@/engine/exercises';
import type { FramingIssue, PlankIssue } from '@/engine/gates';
import type { HoldFault } from '@/engine/holdTimer';
import type { MissReason, RepFault } from '@/engine/repCounter';
import type { Cue, PauseReason } from '@/engine/session';
import {
  FRAMING_COPY,
  HOLD_COPY,
  PAUSE_COPY,
  PLANK_COPY,
  cueBanner,
  cueSpeech,
  difficultyCopy,
  faultCopy,
  framingCopy,
  missCopy,
  pauseCopy,
  plankIssueCopy,
  rotationCopy,
} from '@/session/copy';
import { MOTION_MS, STILL_P, figureAt } from '@/ui/exerciseMotion';
import { setupSteps } from '../setupSteps';
import { TECHNIQUE } from '../technique';

const FAULTS: RepFault[] = ['hips-sagging', 'hips-piking', 'rushed', 'head-dropping', 'sat-up', 'feet-lifting', 'neck-pulling'];
const MISSES: MissReason[] = ['not-deep-enough', 'no-lockout', 'too-slow', 'not-high-enough', 'not-back-down'];
const filled = (c: { short: string; detail: string } | null | undefined) => !!c && c.short.trim().length > 1 && c.detail.trim().length > 5;

describe.each(EXERCISE_IDS)('%s is complete', (e) => {
  it('is in the registry with a name, unit and tagline', () => {
    expect(isExercise(e)).toBe(true);
    const info = EXERCISES[e];
    expect(info.id).toBe(e);
    expect(info.label.length).toBeGreaterThan(2);
    expect(info.unit.length).toBeGreaterThan(2);
    expect(info.tagline.length).toBeGreaterThan(2);
  });

  it('has how-to steps, mistakes, breathing, a starting amount and a safety note', () => {
    const t = TECHNIQUE[e];
    expect(t.steps.length).toBeGreaterThanOrEqual(4);
    for (const s of t.steps) {
      expect(s.title.length).toBeGreaterThan(3);
      expect(s.body.length).toBeGreaterThan(20);
    }
    expect(t.avoid.length).toBeGreaterThanOrEqual(3);
    expect(t.breathe.length).toBeGreaterThan(10);
    expect(t.dose.length).toBeGreaterThan(10);
    expect(t.safety.length).toBeGreaterThan(20);
  });

  it('has an animation and a still frame', () => {
    expect(MOTION_MS[e]).toBeGreaterThan(1000);
    expect(figureAt(e, STILL_P[e]).body).toMatch(/^M/);
  });

  it('has three setup steps for every level and phone orientation', () => {
    for (const d of DIFFICULTIES)
      for (const o of ['landscape', 'portrait'] as const) {
        const steps = setupSteps(e, d, o);
        expect(steps).toHaveLength(3);
        for (const s of steps) expect(s.title.length + s.body.length).toBeGreaterThan(10);
      }
  });

  it('has wording for every level, and a working config for every level', () => {
    for (const d of DIFFICULTIES) {
      const c = difficultyCopy(d, e);
      expect(c.label.length).toBeGreaterThan(2);
      expect(c.short.length).toBeGreaterThan(3);
      expect(c.detail.length).toBeGreaterThan(10);
      expect(() => difficultyConfig(d, { exercise: e })).not.toThrow();
    }
  });

  it('has words for every start-position issue, pause, fault and miss', () => {
    for (const i of Object.keys(PLANK_COPY) as PlankIssue[]) expect(filled(plankIssueCopy(i, e))).toBe(true);
    for (const r of Object.keys(PAUSE_COPY) as PauseReason[]) expect(filled(pauseCopy(r, e))).toBe(true);
    for (const f of FAULTS) expect(filled(faultCopy(f, e))).toBe(true);
    for (const m of MISSES) expect(filled(missCopy(m, e))).toBe(true);
  });

  it('every cue it can raise has speech or a banner, and never throws', () => {
    const cues: Cue[] = [
      { kind: 'start' },
      { kind: 'resume' },
      { kind: 'rep', count: 3, clean: true },
      { kind: 'target-reached' },
      ...(Object.keys(PLANK_COPY) as PlankIssue[]).map((issue) => ({ kind: 'plank' as const, issue })),
      ...(Object.keys(FRAMING_COPY) as FramingIssue[]).map((issue) => ({ kind: 'framing' as const, issue })),
      ...(Object.keys(PAUSE_COPY) as PauseReason[]).map((reason) => ({ kind: 'paused' as const, reason })),
      ...FAULTS.map((fault) => ({ kind: 'fault' as const, fault })),
      ...MISSES.map((reason) => ({ kind: 'miss' as const, reason })),
      ...(isTimed(e)
        ? [
            ...(Object.keys(HOLD_COPY) as HoldFault[]).flatMap((fault) => [
              { kind: 'hold' as const, state: 'warning' as const, fault },
              { kind: 'hold' as const, state: 'break' as const, fault },
            ]),
            { kind: 'hold-restored' as const },
            { kind: 'hold-time' as const, seconds: 75 },
            { kind: 'hold-countdown' as const, seconds: 3 },
          ]
        : []),
    ];
    for (const cue of cues) {
      for (const guided of [true, false])
        for (const orientation of ['landscape', 'portrait'] as const) {
          expect(() => cueSpeech(cue, { countAloud: true, guided, orientation, exercise: e })).not.toThrow();
        }
      expect(() => cueBanner(cue, e)).not.toThrow();
    }
    // The cues every set relies on always say something.
    expect(cueSpeech({ kind: 'start' }, { countAloud: true, guided: true, orientation: 'landscape', exercise: e })?.text).toBeTruthy();
    expect(cueBanner({ kind: 'start' }, e)?.short).toBeTruthy();
  });
});

describe('shared wording', () => {
  it('every framing issue has words in both orientations, including the upside-down picture', () => {
    for (const i of Object.keys(FRAMING_COPY) as FramingIssue[])
      for (const o of ['landscape', 'portrait'] as const) expect(filled(framingCopy(i, o))).toBe(true);
    expect(FRAMING_COPY['upside-down'].detail).toMatch(/Rotation Lock/);
  });

  it('the Rotation Lock reminder is worded for iPhone and Android', () => {
    expect(rotationCopy('ios').title).toBe('Turn off Rotation Lock');
    expect(rotationCopy('android').title).toBe('Turn on Auto-rotate');
    expect(rotationCopy('ios').body).toMatch(/Control Center/);
    expect(rotationCopy('android').body).toMatch(/Auto-rotate/);
  });
});
