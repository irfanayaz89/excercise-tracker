/// <reference types="jest" />
/// <reference types="node" />
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Recorder, replay, type Recording } from '../recording';
import { PushupSession } from '../session';
import { hold, levelPhone, rep, timeline } from '../testing/synth';

describe('recording round trip', () => {
  it('replaying a recording gives the same result as the live session', () => {
    const live = new PushupSession();
    const rec = new Recorder();
    const frames = timeline([hold(2600), ...Array.from({ length: 8 }, () => rep(1500, 80, 172, { noisePx: 4 })), hold(500)]);
    for (const f of frames) {
      const a = levelPhone(f.t, 1, 2, 0);
      live.pushAttitude(a);
      rec.phone(a);
      live.pushPose(f);
      rec.pose(f);
      live.tick(f.t);
    }
    const liveSummary = live.end('user');
    const recording = JSON.parse(JSON.stringify(rec.finish({ platform: 'test', model: 'synthetic' }))) as Recording;
    const replayed = replay(recording);
    expect(liveSummary.totalReps).toBe(8);
    expect(replayed.totalReps).toBe(liveSummary.totalReps);
    expect(replayed.cleanReps).toBe(liveSummary.cleanReps);
  });

  it('replays sessions confirmed by hand without a motion sensor', () => {
    const rec = new Recorder();
    const frames = timeline([hold(2600), rep(1500), rep(1500), hold(400)]);
    rec.manualPhone(frames[3].t);
    frames.forEach((f) => rec.pose(f));
    expect(replay(rec.finish({ platform: 'test', model: 'synthetic' })).totalReps).toBe(2);
  });
});

/**
 * Real recorded sets. Each JSON file in fixtures/recordings with an `expected`
 * block becomes a regression test for every threshold change.
 */
const dir = join(__dirname, '..', '..', '..', 'fixtures', 'recordings');
const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')) : [];

describe('real recordings', () => {
  if (files.length === 0) {
    it.skip('no recordings in fixtures/recordings yet', () => {});
    return;
  }
  it.each(files)('%s', (file) => {
    const recording = JSON.parse(readFileSync(join(dir, file), 'utf8')) as Recording;
    if (!recording.expected) return;
    const summary = replay(recording);
    const tol = recording.expected.tolerance ?? 0;
    expect(Math.abs(summary.totalReps - recording.expected.reps)).toBeLessThanOrEqual(tol);
    if (recording.expected.cleanReps !== undefined) {
      expect(Math.abs(summary.cleanReps - recording.expected.cleanReps)).toBeLessThanOrEqual(tol);
    }
  });
});
