/// <reference types="jest" />
/**
 * Onboarding answers: stored safely (bad or old values fall back), the safety
 * notes say the right thing per exercise, and every message has front-view words.
 */
import { EXERCISE_IDS } from '@/engine/exercises';
import type { PlankIssue } from '@/engine/gates';
import { PLANK_COPY, plankIssueCopy } from '@/session/copy';
import { DEFAULT_SETTINGS, DEFAULT_VIEWS, GOAL_TARGETS, normalizeSettings, SAFETY_FLAGS } from '@/storage/settings';
import { SAFETY_LABELS, safetyNotes } from '../safety';

jest.mock('expo-sqlite/kv-store', () => ({ __esModule: true, default: { getItemSync: () => null, setItemSync: () => {} } }));
jest.mock('expo-sqlite', () => ({ openDatabaseSync: () => null }));

describe('onboarding settings', () => {
  it('new installs start side-on, with no focus, no goal and no safety notes', () => {
    expect(DEFAULT_SETTINGS.views).toEqual(DEFAULT_VIEWS);
    expect(DEFAULT_SETTINGS.focus).toEqual([]);
    expect(DEFAULT_SETTINGS.dailyGoal).toBe('none');
    expect(DEFAULT_SETTINGS.safety).toEqual([]);
  });

  it('keeps valid answers and drops anything else', () => {
    const s = normalizeSettings({
      views: { pushup: 'front', crunch: 'front', plank: 'front', sidePlank: 'front', burpee: 'front' },
      focus: ['crunch', 'pushup', 'crunch', 'yoga'],
      dailyGoal: 'serious',
      safety: ['back', 'knees', 'back', 'pregnancy'],
    });
    // Crunches and the side plank can't be tracked head-on: a saved "front" reads as side-on.
    expect(s.views).toEqual({ ...DEFAULT_VIEWS, pushup: 'front', plank: 'front' });
    expect(s.focus).toEqual(['crunch', 'pushup']);
    expect(s.dailyGoal).toBe('serious');
    expect(s.safety).toEqual(['back', 'pregnancy']);
    expect(normalizeSettings({ dailyGoal: 'huge', views: 'front', focus: 'pushup', safety: 3 })).toMatchObject({
      dailyGoal: 'none',
      views: DEFAULT_VIEWS,
      focus: [],
      safety: [],
    });
  });

  it('settings saved before onboarding existed still load (no new fields)', () => {
    const old = normalizeSettings({ exercise: 'plank', experience: 'quick', difficulty: 'hard' });
    expect(old.views).toEqual(DEFAULT_VIEWS);
    expect(old.experience).toBe('quick');
  });

  it('daily goals grow from light to serious', () => {
    expect(GOAL_TARGETS.light.reps).toBeLessThan(GOAL_TARGETS.regular.reps);
    expect(GOAL_TARGETS.regular.reps).toBeLessThan(GOAL_TARGETS.serious.reps);
    expect(GOAL_TARGETS.light.holdMs).toBeLessThan(GOAL_TARGETS.serious.holdMs);
  });
});

describe('safety notes', () => {
  it('every flag has a label', () => {
    for (const f of SAFETY_FLAGS) expect(SAFETY_LABELS[f].length).toBeGreaterThan(5);
  });

  it('no answers, no notes', () => {
    for (const e of EXERCISE_IDS) expect(safetyNotes([], e)).toEqual([]);
  });

  it('pregnancy warns about lying on your back for crunches, first', () => {
    const n = safetyNotes(['back', 'pregnancy'], 'crunch');
    expect(n[0]).toMatch(/Lying on your back/);
    expect(n).toHaveLength(2);
  });

  it('wrist pain suggests the forearm plank; neck pain changes crunch arm position', () => {
    expect(safetyNotes(['wrist'], 'plank')[0]).toMatch(/forearm/i);
    expect(safetyNotes(['neck'], 'crunch')[0]).toMatch(/chest/);
  });

  it('a recent injury always says to check with a clinician', () => {
    for (const e of EXERCISE_IDS) expect(safetyNotes(['injury'], e)[0]).toMatch(/clinician/);
  });
});

describe('front-view words', () => {
  it('every start issue has words for every exercise seen head-on', () => {
    for (const e of ['pushup', 'plank'] as const)
      for (const i of Object.keys(PLANK_COPY) as PlankIssue[]) {
        const c = plankIssueCopy(i, e, 'front');
        expect(c.short.length).toBeGreaterThan(2);
        expect(c.detail.length).toBeGreaterThan(5);
      }
    expect(plankIssueCopy('get-down', 'pushup', 'front').short).toMatch(/facing the phone/);
    expect(plankIssueCopy('get-down', 'plank', 'front').short).toMatch(/facing the phone/);
    // Crunches never use front words.
    expect(plankIssueCopy('lie-on-back', 'crunch', 'front').short).toBe('Lie on your back');
    // Side view words are unchanged; the side plank never uses front words.
    expect(plankIssueCopy('get-down', 'pushup').short).toBe('Get into push-up position');
    expect(plankIssueCopy('get-down', 'sidePlank', 'front').short).toBe('Get into a side plank');
  });
});
