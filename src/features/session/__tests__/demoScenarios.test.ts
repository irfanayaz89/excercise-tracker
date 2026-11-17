/// <reference types="jest" />
/**
 * The in-app demo scenarios, played through the real engine as the app plays
 * them, so each one shows what it says it shows.
 */
import { difficultyConfig, DIFFICULTIES, type Difficulty } from '@/engine/difficulty';
import { EXERCISE_IDS } from '@/engine/exercises';
import { PushupSession, type SessionEvent, type SessionSummary } from '@/engine/session';
import type { Exercise } from '@/engine/types';
import { DEMO_SCENARIOS, demoFrames, demoProbe, type DemoScenario } from '../useDemoFeed';

function play(exercise: Exercise, scenario: DemoScenario, level: Difficulty, portrait = false) {
  const session = new PushupSession({ config: difficultyConfig(level, { exercise }), exercise });
  const events: SessionEvent[] = [];
  const pauses: string[] = [];
  const framing: string[] = [];
  session.subscribe((e) => {
    events.push(e);
    if (e.type === 'cue' && e.cue.kind === 'paused' && !pauses.includes(e.cue.reason)) pauses.push(e.cue.reason);
    if (e.type === 'cue' && e.cue.kind === 'framing') framing.push(e.cue.issue);
  });
  const { frames } = demoFrames(exercise, scenario, portrait);
  let n = 0;
  for (const f of frames) {
    const t = f.sample.t + 1000;
    session.pushAttitude({ t, rollDeg: f.roll + 0.6 * Math.sin(t / 900), pitchDeg: 3, motionDegPerSec: 0.5 });
    session.pushPose({ ...f.sample, t });
    if (f.depth && n++ % 3 === 0) session.pushDepth(demoProbe(t, f.depth));
    session.tick(t);
  }
  const summary: SessionSummary = session.end();
  const reps = events.filter((e): e is Extract<SessionEvent, { type: 'rep' }> => e.type === 'rep').map((e) => e.rep);
  const misses = events.filter((e): e is Extract<SessionEvent, { type: 'miss' }> => e.type === 'miss').map((e) => e.miss.reason);
  return { summary, reps, misses, pauses, framing };
}

/** What each scenario must show, for every exercise. */
const PAUSE_FOR: Partial<Record<DemoScenario, string>> = {
  standup: 'left-position',
  lost: 'lost-tracking',
  swap: 'other-person',
  knocked: 'phone-moved',
  shake: 'not-real',
  tv: 'not-real',
};

describe.each(EXERCISE_IDS)('%s: every demo scenario at every level', (exercise) => {
  it.each(DIFFICULTIES.flatMap((l) => DEMO_SCENARIOS.map((s) => [s, l] as const)))('%s at %s', (scenario, level) => {
    const { summary, reps, pauses, framing } = play(exercise, scenario, level);
    const work = summary.hold ? summary.hold.goodMs : reps.length;
    expect(summary.exercise).toBe(exercise);
    // An upright demo body is never taken for an upside-down picture.
    expect(framing).not.toContain('upside-down');
    if (scenario === 'nofeet' && level !== 'easy') {
      // Medium and Hard need the feet: the set never starts, and says why.
      expect(summary.activeMs).toBe(0);
      expect(framing).toContain('show-feet');
      return;
    }
    expect(work).toBeGreaterThan(0);
    const pause = PAUSE_FOR[scenario];
    if (pause) expect(pauses).toContain(pause);
    else if (!(exercise === 'sidePlank' && scenario === 'basic')) expect(pauses).toEqual([]);
    if (scenario === 'shake' || scenario === 'tv') expect(summary.realityFlags).toBeGreaterThan(0);
    else expect(summary.realityFlags).toBe(0);
  });
});

describe.each(DIFFICULTIES)('crunch demos at %s', (level) => {
  const formOn = level !== 'easy';

  it.each([false, true])('basic (portrait %s): six crunches, one half crunch, feet lifting flagged', (portrait) => {
    const { reps, misses } = play('crunch', 'basic', level, portrait);
    expect(reps).toHaveLength(6);
    expect(misses).toEqual(['not-high-enough']);
    expect(reps.filter((r) => r.faults.includes('feet-lifting'))).toHaveLength(formOn ? 1 : 0);
  });

  it('faults: each fault shows as described', () => {
    const { reps, misses } = play('crunch', 'faults', level);
    expect(reps).toHaveLength(8);
    const has = (f: string) => reps.filter((r) => r.faults.includes(f as never)).length;
    expect(has('sat-up')).toBe(formOn ? 1 : 0);
    expect(has('feet-lifting')).toBe(formOn ? 1 : 0);
    expect(has('rushed')).toBe(formOn ? 2 : 0);
    expect(has('neck-pulling')).toBe(formOn ? 1 : 0);
    expect(misses).toEqual(['not-high-enough', 'not-back-down']);
  });

  it('standup: sitting up pauses the set, lying back carries on with the count kept', () => {
    const { reps, pauses } = play('crunch', 'standup', level);
    expect(pauses).toContain('left-position');
    expect(reps).toHaveLength(9);
  });

  it('lost: walking out of view pauses, coming back carries on', () => {
    const { reps, pauses } = play('crunch', 'lost', level);
    expect(pauses).toContain('lost-tracking');
    expect(reps).toHaveLength(9);
  });

  it('a video of crunches on a screen is caught (handheld and TV)', () => {
    expect(play('crunch', 'shake', level).summary.realityFlags).toBeGreaterThan(0);
    expect(play('crunch', 'tv', level).summary.realityFlags).toBeGreaterThan(0);
  });

  it('knocked: the phone falling over pauses the set', () => {
    expect(play('crunch', 'knocked', level).pauses).toContain('phone-moved');
  });
});
