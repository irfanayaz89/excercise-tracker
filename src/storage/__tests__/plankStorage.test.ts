/// <reference types="jest" />
import { cueBanner, cueSpeech } from '@/session/copy';
import { sessionConfig } from '@/session/sessionConfig';
import type { HoldFault } from '@/engine/holdTimer';
import type { Cue } from '@/engine/session';
import { dailyTotals, type SessionRow } from '../history';
import { DEFAULT_SETTINGS, normalizeSettings } from '../settings';
import { normalizeSummary } from '../summaryShape';

// Hoisted above the imports by Jest: these modules load native storage.
jest.mock('expo-sqlite/kv-store', () => ({ __esModule: true, default: { getItemSync: () => null, setItemSync: () => {} } }));
jest.mock('expo-sqlite', () => ({ openDatabaseSync: () => null }));

describe('plank settings', () => {
  it('keeps valid plank choices and drops unknown ones', () => {
    expect(normalizeSettings({ exercise: 'plank', targetHoldSec: 60, plankTestMode: true })).toMatchObject({
      exercise: 'plank',
      targetHoldSec: 60,
      plankTestMode: true,
    });
    expect(normalizeSettings({ exercise: 'squat', targetHoldSec: 37, plankTestMode: 'yes' })).toMatchObject({
      exercise: DEFAULT_SETTINGS.exercise,
      targetHoldSec: DEFAULT_SETTINGS.targetHoldSec,
      plankTestMode: false,
    });
  });

  it('the real-person check is on by default, can be turned off, and turning it off reaches the engine', () => {
    expect(DEFAULT_SETTINGS.realPersonCheck).toBe(true);
    expect(normalizeSettings({ realPersonCheck: false }).realPersonCheck).toBe(false);
    expect(normalizeSettings({ realPersonCheck: 'no' }).realPersonCheck).toBe(true);
    const base = { difficulty: 'medium', allowKneeling: false, plankTestMode: false, exercise: 'pushup' } as const;
    expect(sessionConfig({ ...base, realPersonCheck: false }).reality.enabled).toBe(false);
    expect(sessionConfig({ ...base, realPersonCheck: true }).reality.enabled).toBe(true);
    expect(sessionConfig(base).reality.enabled).toBe(true);
  });

  it('settings saved before planks existed load as push-ups', () => {
    expect(normalizeSettings({ targetReps: 20, difficulty: 'medium' }).exercise).toBe('pushup');
  });

  it('test mode only changes plank sets', () => {
    const base = { difficulty: 'medium', allowKneeling: false, plankTestMode: true } as const;
    expect(sessionConfig({ ...base, exercise: 'plank' }).hold.endOnBreak).toBe(true);
    expect(sessionConfig({ ...base, exercise: 'plank', plankTestMode: false }).hold.endOnBreak).toBe(false);
    expect(sessionConfig({ ...base, exercise: 'pushup' }).hold.endOnBreak).toBe(false);
    // The plank presets apply only to planks.
    expect(sessionConfig({ ...base, exercise: 'plank' }).plank.minBodyLineDeg).toBe(155);
    expect(sessionConfig({ ...base, exercise: 'pushup' }).plank.minBodyLineDeg).toBe(150);
  });
});

describe('stored plank summaries', () => {
  const row = { startedAt: 1000, endedAt: 61000, totalReps: 0, cleanReps: 0, activeMs: 60000, endReason: 'user' };

  it('reads a stored plank back', () => {
    const s = normalizeSummary(
      {
        exercise: 'plank',
        hold: {
          variant: 'forearm',
          goodMs: 45000,
          totalMs: 50000,
          longestMs: 30000,
          breaks: 1,
          faultMs: { 'hips-sagging': 4000, wobbly: 9 },
          headDownMs: 0,
        },
      },
      { ...row, exercise: 'plank', holdMs: 45000 },
    );
    expect(s.exercise).toBe('plank');
    expect(s.hold).toMatchObject({ variant: 'forearm', goodMs: 45000, totalMs: 50000, breaks: 1, faultMs: { 'hips-sagging': 4000 } });
    expect(s.hold?.formPct).toBeCloseTo(0.9);
  });

  it('rebuilds a plank from the row when the JSON is lost', () => {
    const s = normalizeSummary(null, { ...row, exercise: 'plank', holdMs: 42000 });
    expect(s.exercise).toBe('plank');
    expect(s.hold).toMatchObject({ goodMs: 42000, totalMs: 42000, breaks: 0, variant: 'high' });
  });

  it('never reports more good time than total, or a longest hold above the good time', () => {
    const s = normalizeSummary({ exercise: 'plank', hold: { goodMs: 30000, totalMs: 10000, longestMs: 99000 } }, row);
    expect(s.hold?.totalMs).toBe(30000);
    expect(s.hold?.longestMs).toBe(30000);
    expect(s.hold?.formPct).toBe(1);
  });

  it('old summaries without an exercise are push-ups with no plank details', () => {
    const s = normalizeSummary({ totalReps: 5, cleanReps: 5 }, { ...row, totalReps: 5, cleanReps: 5 });
    expect(s.exercise).toBe('pushup');
    expect(s.hold).toBeUndefined();
  });
});

describe('daily totals', () => {
  it('adds push-up reps and plank time separately', () => {
    const now = new Date(2026, 10, 16, 18, 0).getTime();
    const at = (h: number) => new Date(2026, 10, 16, h, 0).getTime();
    const r = (o: Partial<SessionRow>): SessionRow => ({
      id: 'x',
      exercise: 'pushup',
      holdMs: 0,
      startedAt: at(9),
      endedAt: at(9),
      totalReps: 0,
      cleanReps: 0,
      activeMs: 0,
      endReason: 'user',
      ...o,
    });
    const days = dailyTotals(
      [
        r({ totalReps: 12 }),
        r({ exercise: 'plank', holdMs: 45000, startedAt: at(10) }),
        r({ exercise: 'plank', holdMs: 30000, startedAt: at(11) }),
      ],
      7,
      now,
    );
    expect(days[6]).toMatchObject({ reps: 12, holdMs: 75000 });
    expect(days.slice(0, 6).every((d) => d.reps === 0 && d.holdMs === 0)).toBe(true);
  });
});

describe('plank words', () => {
  const opts = { countAloud: true, guided: true, orientation: 'landscape', exercise: 'plank' } as const;
  const cues: Cue[] = [
    { kind: 'hold', state: 'warning', fault: 'hips-sagging' },
    { kind: 'hold', state: 'break', fault: 'hips-piking' },
    { kind: 'hold-restored' },
    { kind: 'hold-time', seconds: 75 },
    { kind: 'hold-countdown', seconds: 3 },
    { kind: 'start' },
    { kind: 'target-reached' },
    { kind: 'plank', issue: 'straighten-arms' },
    { kind: 'paused', reason: 'left-position' },
    { kind: 'paused', reason: 'not-real' },
    { kind: 'not-real', issue: 'screen' },
    { kind: 'not-real', issue: 'handheld' },
  ];

  it('every plank cue has something to say', () => {
    for (const c of cues) expect(cueSpeech(c, opts)?.text).toBeTruthy();
  });

  it('time calls, countdown and breaks interrupt; warnings wait their turn', () => {
    expect(cueSpeech({ kind: 'hold-time', seconds: 75 }, opts)).toEqual({ text: '1 minute 15', priority: 'high' });
    expect(cueSpeech({ kind: 'hold-time', seconds: 30 }, opts)?.text).toBe('30 seconds');
    expect(cueSpeech({ kind: 'hold-countdown', seconds: 3 }, opts)).toEqual({ text: '3', priority: 'high' });
    expect(cueSpeech({ kind: 'hold', state: 'break', fault: 'hips-sagging' }, opts)).toEqual({
      text: 'Clock stopped. Hips up',
      priority: 'high',
    });
    expect(cueSpeech({ kind: 'hold', state: 'warning', fault: 'hips-sagging' }, opts)?.priority).toBe('normal');
  });

  it('setup words fit a plank, not a push-up', () => {
    expect(cueSpeech({ kind: 'plank', issue: 'straighten-arms' }, opts)?.text).toContain('forearms');
    expect(cueSpeech({ kind: 'plank', issue: 'straighten-arms' }, { ...opts, exercise: 'pushup' })?.text).toBe(
      'Start at the top, with your arms straight.',
    );
    expect(cueBanner({ kind: 'start' }, 'plank')?.detail).toContain('clock');
    expect(cueBanner({ kind: 'hold', state: 'break', fault: 'hips-sagging' }, 'plank')?.tone).toBe('fault');
  });
});

describe('every plank fault has words', () => {
  const faults: HoldFault[] = [
    'hips-sagging',
    'hips-piking',
    'knees-bent',
    'arms-bent',
    'elbows-under-shoulders',
    'hands-under-shoulders',
    'dropped',
    'out-of-view',
  ];
  it.each(faults)('%s: banner and voice, as a warning and as a break', (fault) => {
    for (const state of ['warning', 'break'] as const) {
      const b = cueBanner({ kind: 'hold', state, fault }, 'plank');
      expect(b?.short).toBeTruthy();
      expect(b?.detail).toBeTruthy();
      expect(
        cueSpeech({ kind: 'hold', state, fault }, { countAloud: true, guided: false, orientation: 'landscape', exercise: 'plank' })?.text,
      ).toBeTruthy();
    }
  });

  it('stored summaries keep every known fault and drop unknown ones', () => {
    const faultMs = Object.fromEntries(faults.map((f) => [f, 1000]));
    const s = normalizeSummary(
      { exercise: 'plank', hold: { goodMs: 5000, faultMs: { ...faultMs, wobble: 5 } } },
      {
        startedAt: 0,
        endedAt: 1,
        totalReps: 0,
        cleanReps: 0,
        activeMs: 1,
        endReason: 'user',
      },
    );
    expect(Object.keys(s.hold?.faultMs ?? {}).sort()).toEqual([...faults].sort());
  });
});
