/// <reference types="jest" />
import { DEFAULT_SETTINGS, normalizeSettings } from '../settings';
import { normalizeSummary } from '../summaryShape';

// Hoisted above the imports by Jest: settings.ts loads the native key-value store.
jest.mock('expo-sqlite/kv-store', () => ({ __esModule: true, default: { getItemSync: () => null, setItemSync: () => {} } }));

describe('stored settings', () => {
  it('falls back to defaults for missing, corrupt or foreign values', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings('nope')).toEqual(DEFAULT_SETTINGS);
    const s = normalizeSettings({
      voice: 'false',
      targetReps: 13,
      camera: 'side',
      model: 'huge',
      orientation: 'upside-down',
      experience: 'expert',
      difficulty: 'insane',
      countAloud: 0,
    });
    expect(s).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps valid values', () => {
    const s = normalizeSettings({ voice: false, targetReps: 30, camera: 'back', difficulty: 'hard', experience: 'quick', orientation: 'portrait' });
    expect(s).toMatchObject({ voice: false, targetReps: 30, camera: 'back', difficulty: 'hard', experience: 'quick', orientation: 'portrait' });
  });
});

describe('stored summaries', () => {
  const row = { startedAt: 1000, endedAt: 61000, totalReps: 12, cleanReps: 9, activeMs: 50000, endReason: 'user' };

  it('rebuilds a summary from the row when the JSON is missing or broken', () => {
    for (const raw of [null, 42, 'x', [], {}]) {
      const s = normalizeSummary(raw, row);
      expect(s.totalReps).toBe(12);
      expect(s.cleanReps).toBe(9);
      expect(s.reps).toEqual([]);
      expect(s.faultCounts).toEqual({});
      expect(s.missCounts).toEqual({});
      expect(s.endReason).toBe('user');
    }
  });

  it('drops fault and miss kinds this build does not know', () => {
    const s = normalizeSummary(
      {
        totalReps: 2,
        cleanReps: 1,
        faultCounts: { 'hips-sagging': 1, 'elbows-flared': 3 },
        missCounts: { 'no-lockout': 2, 'wrong-exercise': 1 },
        reps: [{ durationMs: 900, faults: ['hips-sagging', 'elbows-flared'] }, null, { durationMs: 'slow' }],
        misses: [{ t: 1, reason: 'no-lockout', minElbowDeg: 90 }, { t: 2, reason: 'wrong-exercise' }],
        endReason: 'aliens',
      },
      row,
    );
    expect(s.faultCounts).toEqual({ 'hips-sagging': 1 });
    expect(s.missCounts).toEqual({ 'no-lockout': 2 });
    expect(s.reps).toHaveLength(2);
    expect(s.reps[0].faults).toEqual(['hips-sagging']);
    expect(s.reps[0].clean).toBe(false);
    expect(s.reps[1].durationMs).toBe(0);
    expect(s.misses).toHaveLength(1);
    expect(s.endReason).toBe('user');
  });

  it('never reports more clean reps than reps', () => {
    expect(normalizeSummary({ totalReps: 3, cleanReps: 7 }, row).cleanReps).toBe(3);
  });
});
