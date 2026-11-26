/// <reference types="jest" />
/**
 * App lifecycle around a set (audit): leaving the app while a set is already
 * paused must not end it.
 */
import { harness, startCounting } from './helpers';
import { hold, rep } from '../testing/synth';

describe('a set and the app going away', () => {
  test('already paused, then the app is left: time away never ends the set', () => {
    const h = harness();
    startCounting(h);
    h.segments([rep(1600), hold(400)]);
    h.nobody(3000);
    expect(h.session.snapshot().phase).toBe('paused');
    h.session.interrupt(h.t + 10);
    expect(h.session.snapshot().pauseReason).toBe('interrupted');
    // iOS: JS is suspended and the first tick on return can fire before the app says it's active.
    h.session.tick(h.t + 120_000);
    expect(h.session.snapshot().phase).toBe('paused');
    expect(h.session.snapshot().reps).toBe(1);
  });

  test('ending twice ends once', () => {
    const h = harness();
    startCounting(h);
    h.segments([rep(1600), hold(400)]);
    h.session.end('user');
    h.session.end('user');
    expect(h.events.filter((e) => e.type === 'ended')).toHaveLength(1);
  });

  test('walking away during setup ends the set after 10 minutes, so the camera stops', () => {
    const h = harness();
    expect(h.session.snapshot().phase).toBe('phone-setup');
    h.session.tick(h.t + 1000);
    h.session.tick(h.t + 1000 + 9 * 60_000);
    expect(h.session.snapshot().phase).toBe('phone-setup');
    h.session.tick(h.t + 1000 + 10 * 60_000 + 1);
    expect(h.session.snapshot().phase).toBe('ended');
    expect(h.events.find((e) => e.type === 'ended')).toMatchObject({ summary: { endReason: 'idle', totalReps: 0 } });
  });

  test('a long setup followed by a real set is not cut off by the setup timeout', () => {
    const h = harness();
    h.session.tick(h.t + 1000);
    h.t += 9 * 60_000;
    h.session.tick(h.t);
    startCounting(h);
    // Two more minutes of push-ups: past 10 minutes since setup began.
    h.segments(Array.from({ length: 75 }, () => rep(1600)));
    expect(h.session.snapshot().phase).toBe('counting');
    expect(h.session.snapshot().reps).toBeGreaterThan(60);
  });

  test('a long call during setup does not end the set', () => {
    const h = harness();
    h.session.tick(h.t + 1000);
    h.session.interrupt(h.t + 2000);
    h.session.tick(h.t + 12 * 60_000);
    expect(h.session.snapshot().phase).not.toBe('ended');
    h.session.resumeFromInterrupt(h.t + 12 * 60_000 + 10);
    h.session.tick(h.t + 12 * 60_000 + 260);
    expect(h.session.snapshot().phase).not.toBe('ended');
  });
});
