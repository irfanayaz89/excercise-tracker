/// <reference types="jest" />
import { difficultyConfig } from '../difficulty';
import { hold, rep, timeline } from '../testing/synth';
import { harness, startCounting } from './helpers';

const sag = (k: number) => ({ sag: 0.45 * Math.sin(Math.PI * k) });

describe('difficulty levels', () => {
  it('easy starts and counts with the feet out of view', () => {
    const h = harness({ config: difficultyConfig('easy'), base: { hide: { ankle: 0.1 } } });
    h.segments([hold(2000)]);
    expect(h.session.snapshot().phase).toBe('counting');
    expect(h.session.snapshot().framing.hint).toBe('show-feet'); // a tip, not a blocker
    h.segments([rep(1600), rep(1600), rep(1600)]);
    expect(h.reps()).toBe(3);
  });

  it('hard refuses to start with the feet out of view', () => {
    const h = harness({ base: { hide: { ankle: 0.1 } } });
    h.segments([hold(3000)]);
    expect(h.session.snapshot().phase).toBe('body-check');
    expect(h.session.snapshot().framing.issue).toBe('show-feet');
  });

  it('easy starts from knees and from a sagging plank', () => {
    const knees = harness({ config: difficultyConfig('easy'), base: { kneeDeg: 100 } });
    knees.segments([hold(2000)]);
    expect(knees.session.snapshot().phase).toBe('counting');
    const sagging = harness({ config: difficultyConfig('easy'), base: { sag: 0.4 } });
    sagging.segments([hold(2000)]);
    expect(sagging.session.snapshot().phase).toBe('counting');
  });

  it('easy accepts a crooked phone leaning on a wall; hard does not', () => {
    const easy = harness({ config: difficultyConfig('easy') });
    easy.play(timeline([hold(2500)], { startT: 1033 }), { roll: 10, pitch: 30 });
    expect(easy.session.snapshot().phase).toBe('counting');

    const hard = harness();
    hard.play(timeline([hold(2500)], { startT: 1033 }), { roll: 10, pitch: 30 });
    expect(hard.session.snapshot().phase).toBe('phone-setup');
    expect(hard.session.snapshot().phone.issue).toBe('tilted-sideways');
  });

  it('skipping the level check with a crooked phone does not bounce back to phone setup', () => {
    const h = harness({ config: difficultyConfig('medium') });
    h.play(timeline([hold(300)], { startT: 1033 }), { roll: 30, pitch: 10 });
    expect(h.session.snapshot().phase).toBe('phone-setup');
    h.session.confirmPhoneManually();
    h.play(timeline([hold(2500), rep(1600)], { startT: h.t + 33 }), { roll: 30, pitch: 10 });
    expect(h.session.snapshot().phase).toBe('counting');
    expect(h.reps()).toBe(1);
    // Knocking it over is still noticed.
    h.play(timeline([hold(300)], { startT: h.t + 33 }), { roll: 30, pitch: 80 });
    expect(h.session.snapshot().pauseReason).toBe('phone-moved');
  });

  it('easy counts a shallower rep that hard rejects', () => {
    const easy = harness({ config: difficultyConfig('easy') });
    startCounting(easy);
    easy.segments([rep(1600, 105), rep(1600, 105)]);
    expect(easy.reps()).toBe(2);

    const hard = harness();
    startCounting(hard);
    hard.segments([rep(1600, 105), rep(1600, 105)]);
    expect(hard.reps()).toBe(0);
    expect(hard.misses('not-deep-enough')).toBeGreaterThan(0);
  });

  it('easy never flags form; medium and hard flag sagging hips', () => {
    const easy = harness({ config: difficultyConfig('easy') });
    startCounting(easy);
    easy.segments([rep(1700, 80, 172, sag)]);
    expect(easy.reps()).toBe(1);
    expect(easy.session.snapshot().cleanReps).toBe(1);
    expect(easy.cues('fault')).toHaveLength(0);

    for (const level of ['medium', 'hard'] as const) {
      const h = harness({ config: difficultyConfig(level) });
      startCounting(h);
      h.segments([rep(1700, 80, 172, sag)]);
      expect(h.reps()).toBe(1);
      expect(h.session.snapshot().cleanReps).toBe(0);
    }
  });

  it('stores the difficulty in the summary', () => {
    const { PushupSession } = jest.requireActual('../session') as typeof import('../session');
    const s = new PushupSession({ config: difficultyConfig('medium'), difficulty: 'medium' });
    expect(s.end('user').difficulty).toBe('medium');
  });

  it('reports where the body is on screen for alignment hints', () => {
    const h = harness();
    h.segments([hold(500)]);
    const p = h.session.snapshot().placement!;
    expect(p).not.toBeNull();
    expect(p.box.x0).toBeLessThan(p.box.x1);
    expect(p.headSide).toBe('left'); // synthetic body faces left by default
  });
});
