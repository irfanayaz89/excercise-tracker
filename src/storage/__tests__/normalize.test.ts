/// <reference types="jest" />
/** Stored settings and profiles from older builds, or damaged ones, load sensibly. */
import { normalizeProfile } from '../profile';
import { normalizeSettings, targetFor } from '../settings';

jest.mock('expo-sqlite/kv-store', () => ({ __esModule: true, default: { getItemSync: () => null, setItemSync: () => undefined } }));

describe('targets per exercise', () => {
  test('older settings (one shared target) still give every exercise that target', () => {
    const s = normalizeSettings({ targetReps: 20, targetHoldSec: 60 });
    expect(targetFor(s, 'pushup')).toBe(20);
    expect(targetFor(s, 'crunch')).toBe(20);
    expect(targetFor(s, 'plank')).toBe(60);
  });

  test('each exercise keeps its own target, and bad values are dropped', () => {
    const s = normalizeSettings({ targetReps: 20, targets: { crunch: 50, pullup: 7, plank: 90, sidePlank: 'x' } });
    expect(targetFor(s, 'crunch')).toBe(50);
    expect(targetFor(s, 'pullup')).toBe(20);
    expect(targetFor(s, 'plank')).toBe(90);
    expect(s.targets).toEqual({ crunch: 50, plank: 90 });
  });
});

describe('profile start date', () => {
  test('a damaged start date falls back to the first weigh-in, the same on every load', () => {
    const raw = { aim: 'lose-fat', weightKg: 90, startedAt: 'oops', log: [{ at: 1_700_000_000_000, kg: 92 }] };
    expect(normalizeProfile(raw)?.startedAt).toBe(1_700_000_000_000);
    expect(normalizeProfile(raw)?.startedAt).toBe(normalizeProfile(raw)?.startedAt);
  });
});
