/// <reference types="jest" />
/** Plank recordings replay like the live set, and the live screen updates every second. */
import { createSnapshotStore } from '@/session/snapshotStore';
import { difficultyConfig, difficultyOverrides } from '../difficulty';
import { Recorder, replay } from '../recording';
import { plank, timeline } from '../testing/synth';
import { harness } from './helpers';

describe('plank recordings', () => {
  const frames = timeline([plank(9000), plank(3000, { sag: 0.3 }), plank(6000)], { startT: 1033, base: { noisePx: 2 } });

  it('replay gives the same hold as the live set', () => {
    const live = harness({ config: difficultyConfig('medium', { exercise: 'plank' }), exercise: 'plank' });
    live.play(frames);
    const liveSummary = live.session.end();

    const rec = new Recorder();
    for (const f of frames) {
      rec.phone({ t: f.t, rollDeg: 0, pitchDeg: 0, motionDegPerSec: 0 });
      rec.pose(f);
    }
    const out = replay(
      rec.finish({ platform: 'test', model: 'full', config: difficultyOverrides('medium', { exercise: 'plank' }), exercise: 'plank' }),
    );
    expect(out.exercise).toBe('plank');
    expect(out.hold?.breaks).toBe(liveSummary.hold?.breaks);
    expect(out.hold?.breaks).toBe(1);
    expect(Math.abs((out.hold?.goodMs ?? 0) - (liveSummary.hold?.goodMs ?? 0))).toBeLessThan(400);
  });

  it('a recording from before planks existed replays as push-ups', () => {
    const rec = new Recorder();
    for (const f of frames) rec.pose(f);
    const r = rec.finish({ platform: 'test', model: 'full' });
    delete r.exercise;
    const out = replay(r);
    expect(out.exercise).toBe('pushup');
    expect(out.hold).toBeUndefined();
  });
});

describe('live screen updates', () => {
  it('the clock re-renders once a second, and when the hold changes state', () => {
    const h = harness({ config: difficultyConfig('hard', { exercise: 'plank' }), exercise: 'plank' });
    h.segments([plank(3500)]);
    const store = createSnapshotStore(h.session);
    let renders = 0;
    store.subscribe(() => renders++);
    h.segments([plank(5000)]);
    store.refresh();
    const afterSteady = renders;
    expect(afterSteady).toBe(1);
    expect(store.get().hold?.goodMs).toBeGreaterThan(5000);
    // Refreshing again with nothing new must not re-render.
    store.refresh();
    expect(renders).toBe(afterSteady);
    // Hips sag: the state change alone is enough to re-render.
    h.segments([plank(600, { sag: 0.3 })]);
    store.refresh();
    expect(renders).toBe(afterSteady + 1);
    expect(store.get().hold?.state).not.toBe('good');
  });
});
