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
});
