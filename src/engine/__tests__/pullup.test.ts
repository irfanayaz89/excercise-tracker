/// <reference types="jest" />
import { mergeConfig } from '../config';
import { PullupCounter, readPullup, checkHangStart } from '../pullup';
import { PoseTracker } from '../tracker';
import { pullupFrames, pullupRep, pullupSample, type PullupKey } from '../testing/pullupSynth';
import { difficultyConfig, DIFFICULTIES } from '../difficulty';
import type { PoseSample } from '../types';
import { harness, type Harness } from './helpers';

const cfg = mergeConfig({});

/** Phone set, then a still dead hang until counting starts. */
function hangAndStart(h: Harness, pitch = 0): void {
  h.play(pullupFrames(h.t, [{ rise: 0, ms: 3000 }]), { pitch });
}

function play(h: Harness, keys: PullupKey[], pitch = 0): void {
  h.play(pullupFrames(h.t, keys), { pitch });
}

function reps(n: number, opts: Parameters<typeof pullupRep>[0] = {}): PullupKey[] {
  return Array.from({ length: n }, () => pullupRep(opts)).flat();
}

describe('pull-up reading', () => {
  test('a dead hang reads straight arms, hands over the head and a good start', () => {
    const tracker = new PoseTracker(cfg);
    const pose = tracker.update(pullupSample(1000, { rise: 0 }))!;
    const r = readPullup(pose, cfg)!;
    expect(r.overhead).toBe(true);
    expect(r.elbowDeg!).toBeGreaterThan(165);
    expect(r.eyeY!).toBeGreaterThan(r.elbowY!);
    expect(checkHangStart(r, cfg).ok).toBe(true);
  });

  test('at the top the elbows are bent and the mouth is over the bar', () => {
    const tracker = new PoseTracker(cfg);
    const pose = tracker.update(pullupSample(1000, { rise: 1 }))!;
    const r = readPullup(pose, cfg)!;
    expect(r.elbowDeg!).toBeLessThan(cfg.pullup.topElbowDeg);
    expect(r.mouthY!).toBeLessThan(r.wrist!.y);
  });

  test('bent arms or hands off the bar are not a start', () => {
    const tracker = new PoseTracker(cfg);
    const bent = readPullup(tracker.update(pullupSample(1000, { rise: 0.5 }))!, cfg);
    expect(checkHangStart(bent, cfg).issues).toEqual(['straighten-arms']);
    const t2 = new PoseTracker(cfg);
    const off = readPullup(t2.update(pullupSample(1000, { rise: 0, offBar: true }))!, cfg);
    expect(checkHangStart(off, cfg).issues).toEqual(['grab-bar']);
  });
});

describe('pull-up counter (state machine)', () => {
  function feed(keys: PullupKey[]) {
    const tracker = new PoseTracker(cfg);
    const counter = new PullupCounter(cfg);
    const events = [];
    for (const s of pullupFrames(1000, [{ rise: 0, ms: 800 }, ...keys])) {
      const pose = tracker.update(s);
      const r = pose && readPullup(pose, cfg);
      if (!r) continue;
      const ev = counter.update(r);
      if (ev && ev.type !== 'noise') events.push(ev);
    }
    return { counter, events };
  }

  test('five strict pull-ups count five, all clean', () => {
    const { counter, events } = feed(reps(5));
    expect(counter.count).toBe(5);
    expect(events.filter((e) => e.type === 'rep').every((e) => e.type === 'rep' && e.rep.clean)).toBe(true);
  });

  test('the bar is learned from the hands', () => {
    const { counter } = feed(reps(1));
    expect(counter.barY).toBeCloseTo(0.12 * 1280, 0);
  });
});

describe('pull-up sessions', () => {
  test('a dead hang starts the set, then strict reps count', () => {
    const h = harness({ exercise: 'pullup' });
    hangAndStart(h);
    expect(h.session.currentPhase).toBe('counting');
    play(h, reps(6));
    expect(h.reps()).toBe(6);
    expect(h.session.snapshot().cleanReps).toBe(6);
  });

  test('the phone may lean back to see the bar', () => {
    const h = harness({ exercise: 'pullup' });
    hangAndStart(h, 28);
    expect(h.session.currentPhase).toBe('counting');
    play(h, reps(3), 28);
    expect(h.reps()).toBe(3);
  });

  test('a pull that stops short of the bar is a miss, not a rep', () => {
    const h = harness({ exercise: 'pullup' });
    hangAndStart(h);
    play(h, pullupRep({ peak: 0.65 }));
    expect(h.reps()).toBe(0);
    expect(h.misses('not-high-enough')).toBe(1);
  });

  test('pulling again without reaching a dead hang does not count', () => {
    const h = harness({ exercise: 'pullup' });
    hangAndStart(h);
    play(h, [
      { rise: 1, ms: 900 },
      { rise: 1, ms: 200 },
      { rise: 0.5, ms: 600 },
      { rise: 1, ms: 700 },
      { rise: 1, ms: 200 },
      { rise: 0, ms: 1100 },
      { rise: 0, ms: 500 },
    ]);
    expect(h.reps()).toBe(1);
    expect(h.misses('not-back-down')).toBe(1);
  });

  test('a kip (knees driven up) is not a strict pull-up', () => {
    const h = harness({ exercise: 'pullup' });
    hangAndStart(h);
    play(h, pullupRep({ kneeLift: 0.8 }));
    expect(h.reps()).toBe(0);
    expect(h.misses('kipped')).toBe(1);
  });

  test('swinging and uneven pulls count, but are flagged', () => {
    const h = harness({ exercise: 'pullup' });
    hangAndStart(h);
    play(h, [
      { rise: 0.5, swing: 0.5, ms: 450 },
      { rise: 1, swing: -0.4, ms: 450 },
      { rise: 1, ms: 200 },
      { rise: 0, ms: 1100 },
      { rise: 0, ms: 500 },
    ]);
    play(h, pullupRep({ tilt: 0.3 }));
    const got = h.events.flatMap((e) => (e.type === 'rep' ? [e.rep.faults] : []));
    expect(got).toEqual([['swinging'], ['uneven']]);
    expect(h.session.snapshot().cleanReps).toBe(0);
  });

  test('dropping from the bar is flagged once the hang is reached', () => {
    const h = harness({ exercise: 'pullup' });
    hangAndStart(h);
    play(h, pullupRep({ downMs: 200 }));
    expect(h.reps()).toBe(1);
    const rep = h.session.snapshot().lastRep!;
    expect(rep.faults).toContain('dropping');
    expect(rep.clean).toBe(false);
    expect(h.cues('fault').some((e) => e.type === 'cue' && e.cue.kind === 'fault' && e.cue.fault === 'dropping')).toBe(true);
  });

  test('a fast but full rep still counts', () => {
    const h = harness({ exercise: 'pullup' });
    hangAndStart(h);
    play(h, reps(3, { upMs: 450, downMs: 700 }));
    expect(h.reps()).toBe(3);
  });

  test('letting go of the bar pauses the set; hanging again resumes it', () => {
    const h = harness({ exercise: 'pullup' });
    hangAndStart(h);
    play(h, reps(2));
    play(h, [{ rise: 0, offBar: true, ms: 2500 }]);
    expect(h.session.currentPhase).toBe('paused');
    play(h, [{ rise: 0, ms: 2500 }]);
    expect(h.session.currentPhase).toBe('counting');
    play(h, reps(2));
    expect(h.reps()).toBe(4);
  });

  test('a target number of pull-ups ends the set', () => {
    const h = harness({ exercise: 'pullup', targetReps: 3 });
    hangAndStart(h);
    play(h, reps(4));
    expect(h.reps()).toBe(3);
    expect(h.session.currentPhase).toBe('ended');
  });

  test('holding the top for two seconds does not pause the set', () => {
    const h = harness({ exercise: 'pullup' });
    hangAndStart(h);
    play(h, [
      { rise: 1, ms: 900 },
      { rise: 1, ms: 2200 },
      { rise: 0, ms: 1200 },
      { rise: 0, ms: 500 },
    ]);
    expect(h.session.currentPhase).toBe('counting');
    expect(h.reps()).toBe(1);
  });

  test('camera jitter on every point does not add or lose reps', () => {
    const h = harness({ exercise: 'pullup' });
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
    const jitter = (keys: PullupKey[]) =>
      pullupFrames(h.t, keys).map((s) => ({ ...s, landmarks: s.landmarks.map((l) => ({ ...l, x: l.x + rand() * 0.004, y: l.y + rand() * 0.004 })) }));
    h.play(jitter([{ rise: 0, ms: 3000 }]));
    h.play(jitter(reps(8)));
    expect(h.reps()).toBe(8);
    expect(h.events.filter((e) => e.type === 'miss')).toHaveLength(0);
  });

  test('a still body that never hangs from a bar never starts', () => {
    const h = harness({ exercise: 'pullup' });
    play(h, [{ rise: 0, offBar: true, ms: 4000 }]);
    expect(h.session.currentPhase).not.toBe('counting');
    expect(h.session.snapshot().plankIssues).toContain('grab-bar');
  });
});

describe('pull-ups and an upside-down picture', () => {
  const flip = (s: PoseSample): PoseSample => ({ ...s, landmarks: s.landmarks.map((l) => ({ ...l, x: 1 - l.x, y: 1 - l.y })) });
  const framing = (h: Harness, issue: string) => h.events.filter((e) => e.type === 'cue' && e.cue.kind === 'framing' && e.cue.issue === issue).length;

  test.each(DIFFICULTIES)('at %s: never starts upside down and says why; upright it starts', (level) => {
    const h = harness({ exercise: 'pullup', config: difficultyConfig(level, { exercise: 'pullup' }) });
    h.play(pullupFrames(h.t, [{ rise: 0, ms: 3000 }, ...reps(2)]).map(flip));
    expect(h.session.currentPhase).not.toBe('counting');
    expect(h.session.snapshot().framing.issue).toBe('upside-down');
    expect(framing(h, 'upside-down')).toBeGreaterThan(0);
    expect(h.reps()).toBe(0);
    hangAndStart(h);
    expect(h.session.currentPhase).toBe('counting');
  });

  test('an upright hang, a pull and standing off the bar are never called upside down', () => {
    const h = harness({ exercise: 'pullup' });
    hangAndStart(h);
    play(h, [...reps(2), { rise: 0, offBar: true, ms: 2500 }]);
    expect(framing(h, 'upside-down')).toBe(0);
  });
});
