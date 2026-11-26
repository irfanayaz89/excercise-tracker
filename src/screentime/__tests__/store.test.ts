/// <reference types="jest" />
/**
 * The app's side of screen time against a fake phone: what is sent on sync,
 * what is read back, earning from sets, unlocks, lost permission, and that it
 * all survives a restart. The fake keeps state the way the native modules do
 * (STShared.swift / STCore.kt): it records events and hands them over once.
 */
import type { SessionSummary } from '@/engine/session';
import type { NativePlan, NativeReport } from '../plan';
import { startStrict } from '../rules';
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
  /** What the phone does when asked for an unlock: record it, stamped with its own clock. */
  takeUnlock: (kind: string, minutes: number): void => {
    mockPhone.unlocks.push({ kind, minutes });
    const now = Date.now();
    mockPhone.report = {
      ...(mockPhone.report ?? emptyReport(now)),
      unlocks: [{ kind: kind as 'emergency', from: now, until: now + minutes * 60_000 }],
    };
  },
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
    takeUnlock: (kind: string, minutes: number) => mockPhone.takeUnlock(kind, minutes),
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

  it('usage the phone saw while the app was closed counts, and the limit blocks', () => {
    const st = setUp();
    const now = Date.now();
    mockPhone.report = { ...emptyReport(now), usedMin: 60, limitReached: true };
    st.syncScreenTime();
    const s = st.getScreenTime();
    expect(s.today.usedMin).toBe(60);
    expect(s.decision).toMatchObject({ blocked: true, reason: 'limit' });
    expect(mockPhone.plans.at(-1)!.limitReached).toBe(true);
  });

  it('a finished set earns minutes, once, and the phone is told at once', () => {
    const st = setUp();
    const res = st.creditSet(set('pushup', 20, 20), 'set-1', false);
    // 20 reps + 10 for the milestones + 3 for the first set of the day = 33: 30 at full rate, then half.
    expect(res).toMatchObject({ minutes: 31, reason: 'earned' });
    expect(mockPhone.plans.at(-1)!.earnedLeftMin).toBe(31);
    expect(st.creditSet(set('pushup', 20, 20), 'set-1', false)).toMatchObject({ minutes: 0, reason: 'duplicate' });
    expect(st.creditSet(set('pushup', 20, 20), 'demo', true)).toMatchObject({ minutes: 0, reason: 'demo' });
    expect(st.getScreenTime().today.earnedMin).toBe(31);
  });

  it('nothing is earned before screen time is set up', () => {
    const st = load();
    expect(st.creditSet(set('pushup', 20, 20), 'set-1', false)).toBeNull();
  });

  it('earned minutes spent on the phone come off what is left', () => {
    const st = setUp();
    // 17 + 5 (milestone) + 3 (first set) = 25 earned.
    st.creditSet(set('pushup', 17, 17), 'set-1', false);
    mockPhone.report = { ...emptyReport(Date.now()), earnedSpentMin: 10 };
    st.syncScreenTime();
    expect(st.getScreenTime().decision.earnedLeftMin).toBe(15);
    expect(mockPhone.plans.at(-1)!.earnedLeftMin).toBe(15);
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

  // The phone stamps an unlock with its own clock, after the app has read the time, and iOS stamps
  // it in fractions of a millisecond. Either way the app must see the unlock as already started.
  it.each([
    ['a millisecond later', true],
    ['later within the same millisecond', false],
  ])("an unlock the phone stamps %s than the app's clock still counts as started", (_name, ticking) => {
    const st = setUp();
    const start = Date.now();
    mockPhone.report = { ...emptyReport(start), usedMin: 60, limitReached: true };
    st.syncScreenTime(start);
    let tick = 0;
    const clock = jest.spyOn(Date, 'now').mockImplementation(() => (ticking ? start + ++tick : start));
    const takeUnlock = mockPhone.takeUnlock;
    mockPhone.takeUnlock = (kind, minutes) => {
      const from = Date.now() + 0.6;
      mockPhone.report = { ...emptyReport(start), unlocks: [{ kind: kind as 'emergency', from, until: from + minutes * 60_000 }] };
    };
    try {
      expect(st.unlockNow('emergency').ok).toBe(true);
      expect(st.getScreenTime().decision).toMatchObject({ blocked: false });
      expect(st.getScreenTime().today.unlocks).toHaveLength(1);
    } finally {
      clock.mockRestore();
      mockPhone.takeUnlock = takeUnlock;
    }
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
    expect(again.getScreenTime()).toMatchObject({
      meta: { setUp: true },
      rules: { blocked: BLOCKED, dailyLimitMin: 60 },
      today: { earnedMin: 11 },
    });
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

describe('workout focus and protection gaps', () => {
  it('a focus blocks at once, travels to the phone, and finishing the set ends it', () => {
    const st = setUp();
    const now = Date.now();
    expect(st.startFocusNow('set', now)).not.toBeNull();
    expect(st.getScreenTime().decision).toMatchObject({ blocked: true, reason: 'focus' });
    expect(mockPhone.plans.at(-1)!.focusUntil).toBe(now + 60 * 60_000);
    const res = st.endFocusNow('completed', now + 12 * 60_000);
    expect(res.ended).toBe(true);
    expect(st.getScreenTime().focus).toBeNull();
    expect(st.getScreenTime().today.focuses).toEqual([{ from: now, to: now + 12 * 60_000, outcome: 'completed' }]);
    expect(mockPhone.plans.at(-1)!.focusUntil).toBeNull();
  });

  it('no focus before screen time is set up', () => {
    const st = load();
    expect(st.startFocusNow(30)).toBeNull();
    expect(mockPhone.plans).toHaveLength(0);
  });

  it('Strict: leaving the set does not end the focus, and it survives a restart', () => {
    const st = setUp();
    const now = Date.now();
    const r = st.getScreenTime().rules;
    st.saveRules({ ...r, strictness: 'strict', strictUntil: now + 7 * 24 * 3_600_000 });
    st.startFocusNow('set', now);
    expect(st.endFocusNow('abandoned', now + 60_000)).toMatchObject({ ended: false, why: 'strict' });
    expect(load().getScreenTime().focus).toMatchObject({ kind: 'set', strict: true });
  });

  it('a focus whose time ran out is settled into history on the next sync', () => {
    const st = setUp();
    const now = Date.now();
    st.startFocusNow(15, now - 20 * 60_000);
    st.syncScreenTime(now);
    expect(st.getScreenTime().focus).toBeNull();
    expect(st.getScreenTime().today.focuses?.[0]).toMatchObject({ outcome: 'expired' });
  });

  it('access switched off and back on is kept as a gap in history', () => {
    const st = setUp();
    const t0 = Date.now();
    mockPhone.auth = 'denied';
    st.syncScreenTime(t0);
    st.syncScreenTime(t0 + 60_000);
    mockPhone.auth = 'approved';
    st.syncScreenTime(t0 + 30 * 60_000);
    expect(st.getScreenTime().today.gaps).toEqual([{ from: t0, to: t0 + 30 * 60_000, kind: 'permission' }]);
    expect(st.getScreenTime().meta.lostSince).toBeNull();
  });

  it('stop gaps and token expiry reported by the phone are taken in', () => {
    const st = setUp();
    const now = Date.now();
    const gap = { from: now - 3_600_000, to: now - 1_800_000, kind: 'stopped' as const };
    mockPhone.report = { ...emptyReport(now), gaps: [gap], tokensExpired: true };
    st.syncScreenTime(now);
    expect(st.getScreenTime().today.gaps).toEqual([gap]);
    expect(st.getScreenTime().meta.tokensExpired).toBe(true);
    // Picking again repairs the list at once, even in Strict, where a different list would otherwise be refused.
    st.saveRules(startStrict(st.getScreenTime().rules, now, 7));
    const fresh = { apps: ['tok-new'], categories: [], domains: [] };
    expect(st.repairBlocked(fresh)).toBe(true);
    expect(st.getScreenTime().rules.blocked).toEqual(fresh);
    expect(st.getScreenTime().meta.tokensExpired).toBe(false);
    // Only while the lists are expired: otherwise it's an ordinary change.
    expect(st.repairBlocked({ apps: [], categories: [], domains: [] })).toBe(false);
  });

  it('the focus choice on the exercise screen is remembered', () => {
    const st = setUp();
    st.setFocusChoice(30);
    expect(load().getScreenTime().meta.focusChoice).toBe(30);
  });

  it('key lock: needs a key, holds until the right key is scanned, and survives a restart', () => {
    const st = setUp();
    expect(st.startKeyLockNow(2, true)).toBeNull();
    expect(st.newKey()).toBe(true);
    const key = st.getScreenTime().meta.key!;
    const lockOn = st.startKeyLockNow(2, true);
    expect(lockOn).toMatchObject({ kind: 'key', strict: true, blockAll: true });
    expect(mockPhone.plans.at(-1)).toMatchObject({ focusKind: 'key', focusAll: true });
    // A new key can't be made while the key is the way out; End by hand doesn't work.
    expect(st.newKey()).toBe(false);
    expect(st.endFocusNow('manual').ended).toBe(false);
    const again = load();
    expect(again.getScreenTime().focus).toMatchObject({ kind: 'key' });
    expect(again.scanKey('trueline-key:not-mine')).toBe('wrong-key');
    expect(again.getScreenTime().focus).not.toBeNull();
    expect(again.scanKey(again.keyText(key.secret))).toBe('ended');
    expect(again.getScreenTime().focus).toBeNull();
    expect(again.scanKey(again.keyText(key.secret))).toBe('nothing-running');
  });

  it('a workout focus can block everything when chosen', () => {
    const st = setUp();
    st.setFocusBlockAll(true);
    st.startFocusNow(15);
    expect(mockPhone.plans.at(-1)).toMatchObject({ focusAll: true, focusKind: 'timed' });
  });
});
