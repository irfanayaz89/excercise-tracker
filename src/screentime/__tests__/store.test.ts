/// <reference types="jest" />
/**
 * The app's side of screen time against a fake phone: what is sent on sync,
 * what is read back, earning from sets, unlocks, lost permission, and that it
 * all survives a restart. The fake keeps state the way the native modules do
 * (STShared.swift / STCore.kt): it records events and hands them over once.
 */
import type { SessionSummary } from '@/engine/session';
import type { NativePlan, NativeReport } from '../plan';
import { deviceZone } from '../time';

type Auth = 'approved' | 'denied' | 'notDetermined';

const mockDisk = new Map<string, string>();
const mockPhone = {
  supported: true,
  auth: 'approved' as Auth,
  plans: [] as NativePlan[],
  report: null as NativeReport | null,
  unlocks: [] as { kind: string; minutes: number }[],
  stopped: 0,
};

jest.mock('expo-sqlite/kv-store', () => ({
  __esModule: true,
  default: { getItemSync: (k: string) => mockDisk.get(k) ?? null, setItemSync: (k: string, v: string) => void mockDisk.set(k, v) },
}));
jest.mock('../../../modules/screen-time/src', () => ({
  ScreenTime: {
    isSupported: () => mockPhone.supported,
    authorizationStatus: () => mockPhone.auth,
    sync: (json: string) => {
      mockPhone.plans.push(JSON.parse(json));
      return [];
    },
    takeState: () => {
      const r = mockPhone.report;
      mockPhone.report = null;
      return JSON.stringify(r ?? { day: '', usedMin: 0, limitReached: false, earnedSpentMin: 0, unlocks: [], openEarn: false });
    },
    takeUnlock: (kind: string, minutes: number) => {
      mockPhone.unlocks.push({ kind, minutes });
      const now = Date.now();
      mockPhone.report = { ...(mockPhone.report ?? emptyReport(now)), unlocks: [{ kind: kind as 'emergency', from: now, until: now + minutes * 60_000 }] };
    },
    stopAll: () => void mockPhone.stopped++,
  },
}));

function dayKeyOf(ms: number) {
  const l = deviceZone.local(ms);
  return `${l.y}-${String(l.m).padStart(2, '0')}-${String(l.d).padStart(2, '0')}`;
}
function emptyReport(now: number): NativeReport {
  return { day: dayKeyOf(now), usedMin: 0, limitReached: false, earnedSpentMin: 0, unlocks: [], openEarn: false };
}

/** A fresh copy of the store module (as after an app restart); the fake disk and phone persist. */
function load(): typeof import('../store') {
  let m!: typeof import('../store');
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- a fresh module instance is the point
    m = require('../store');
  });
  return m;
}

const set = (exercise: SessionSummary['exercise'], total: number, clean: number): SessionSummary => ({
  exercise,
  startedAt: 0,
  endedAt: 60_000,
  activeMs: 60_000,
  endReason: 'user',
  reps: [],
  misses: [],
  totalReps: total,
  cleanReps: clean,
  faultCounts: {},
  missCounts: {},
  avgRepMs: null,
  avgScore: null,
  bestCleanStreak: 0,
  pauses: 0,
});

const BLOCKED = { apps: ['tok-insta'], categories: ['tok-social'], domains: [] };

beforeEach(() => {
  mockDisk.clear();
  Object.assign(mockPhone, { supported: true, auth: 'approved', plans: [], report: null, unlocks: [], stopped: 0 });
});

/** Set up with a 60-minute limit (no lock times, so the test is the same at any time of day). */
function setUp() {
  const st = load();
  st.saveRules({ ...st.getScreenTime().rules, blocked: BLOCKED, dailyLimitMin: 60, lockTimes: [] });
  st.markSetUp();
  return st;
}

describe('screen time store', () => {
  it('without native support it does nothing native and says so', () => {
    mockPhone.supported = false;
    const st = load();
    st.syncScreenTime();
    expect(st.getScreenTime().availability).toBe('unsupported');
    expect(mockPhone.plans).toHaveLength(0);
  });

  it('sends no plan until setup is finished', () => {
    const st = load();
    st.syncScreenTime();
    expect(mockPhone.plans).toHaveLength(0);
  });

  it('after setup, every sync hands the phone the rules with the app lists', () => {
    setUp();
    const last = mockPhone.plans.at(-1)!;
    expect(last).toMatchObject({ blocked: BLOCKED, dailyLimitMin: 60, limitReached: false, mode: 'standard' });
  });

  it("usage the phone saw while the app was closed counts, and the limit blocks", () => {
    const st = setUp();
    const now = Date.now();
    mockPhone.report = { ...emptyReport(now), usedMin: 45, limitReached: true };
    st.syncScreenTime();
    const s = st.getScreenTime();
    expect(s.today.usedMin).toBe(60);
    expect(s.decision).toMatchObject({ blocked: true, reason: 'limit' });
    expect(mockPhone.plans.at(-1)!.limitReached).toBe(true);
  });

  it('a finished set earns minutes, once, and the phone is told at once', () => {
    const st = setUp();
    const res = st.creditSet(set('pushup', 20, 20), 'set-1', false);
    expect(res).toMatchObject({ minutes: 20, reason: 'earned' });
    expect(mockPhone.plans.at(-1)!.earnedLeftMin).toBe(20);
    expect(st.creditSet(set('pushup', 20, 20), 'set-1', false)).toMatchObject({ minutes: 0, reason: 'duplicate' });
    expect(st.creditSet(set('pushup', 20, 20), 'demo', true)).toMatchObject({ minutes: 0, reason: 'demo' });
    expect(st.getScreenTime().today.earnedMin).toBe(20);
  });

  it('nothing is earned before screen time is set up', () => {
    const st = load();
    expect(st.creditSet(set('pushup', 20, 20), 'set-1', false)).toBeNull();
  });

  it('earned minutes spent on the phone come off what is left', () => {
    const st = setUp();
    st.creditSet(set('pushup', 30, 30), 'set-1', false);
    mockPhone.report = { ...emptyReport(Date.now()), earnedSpentMin: 10 };
    st.syncScreenTime();
    expect(st.getScreenTime().decision.earnedLeftMin).toBe(20);
    expect(mockPhone.plans.at(-1)!.earnedLeftMin).toBe(20);
  });

  it('"Earn time" tapped on the blocked screen opens the earn screen once', () => {
    const st = setUp();
    mockPhone.report = { ...emptyReport(Date.now()), openEarn: true };
    expect(st.syncScreenTime().openEarn).toBe(true);
    expect(st.syncScreenTime().openEarn).toBe(false);
  });

  it('access taken away in Settings is noticed, and cleared when it is back', () => {
    const st = setUp();
    mockPhone.auth = 'denied';
    st.syncScreenTime();
    expect(st.getScreenTime()).toMatchObject({ availability: 'needs-permission', meta: { permissionLost: true } });
    mockPhone.auth = 'approved';
    st.syncScreenTime();
    expect(st.getScreenTime().meta.permissionLost).toBe(false);
  });

  it('an unlock taken in the app goes through the phone (so it can wake up to block again)', () => {
    const st = setUp();
    const now = Date.now();
    mockPhone.report = { ...emptyReport(now), usedMin: 60, limitReached: true };
    st.syncScreenTime();
    const res = st.unlockNow('emergency');
    expect(res.ok).toBe(true);
    expect(mockPhone.unlocks).toEqual([{ kind: 'emergency', minutes: 10 }]);
    // Read back on the same sync: unlocked now, and the day's emergency is used.
    const s = st.getScreenTime();
    expect(s.decision.blocked).toBe(false);
    expect(s.today.unlocks).toHaveLength(1);
    expect(st.unlockNow('emergency').ok).toBe(false);
  });

  it('a change that makes things easier waits, and is applied by the first sync after its time', () => {
    const st = setUp();
    const rules = st.getScreenTime().rules;
    st.saveRules({ ...rules, pending: { effectiveAt: Date.now() - 1, next: { ...rules, dailyLimitMin: 120 } } });
    expect(st.getScreenTime().rules).toMatchObject({ dailyLimitMin: 120, pending: null });
    expect(mockPhone.plans.at(-1)!.dailyLimitMin).toBe(120);
  });

  it('everything survives a restart', () => {
    const st = setUp();
    st.creditSet(set('crunch', 20, 20), 'set-1', false);
    const again = load();
    expect(again.getScreenTime()).toMatchObject({ meta: { setUp: true }, rules: { blocked: BLOCKED, dailyLimitMin: 60 }, today: { earnedMin: 10 } });
  });

  it('turning off stops the phone blocking', () => {
    const st = setUp();
    st.turnOff();
    expect(mockPhone.stopped).toBe(1);
    expect(st.getScreenTime().meta.setUp).toBe(false);
  });

  it('history keeps two weeks, newest first', () => {
    const { withToday, HISTORY_DAYS } = load();
    const days = Array.from({ length: 20 }, (_, i) => ({
      day: `2026-10-${String(i + 1).padStart(2, '0')}`,
      usedMin: i,
      earnedMin: 0,
      earnedUsedMin: 0,
      grants: [],
      unlocks: [],
    }));
    const out = withToday(days, { ...days[0], day: '2026-11-18' });
    expect(out).toHaveLength(HISTORY_DAYS);
    expect(out[0].day).toBe('2026-11-18');
    expect(out[1].day).toBe('2026-10-20');
  });

  it('a broken file on disk never crashes or switches protection off', () => {
    mockDisk.set('screentime.rules.v1', '{not json');
    mockDisk.set('screentime.days.v1', '[{"day": 5}]');
    const st = load();
    const s = st.getScreenTime();
    expect(s.rules.strictness).toBe('standard');
    expect(s.days).toHaveLength(1);
  });
});
