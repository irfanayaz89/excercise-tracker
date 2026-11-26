/// <reference types="jest" />
/**
 * Ways round the rules that don't go through a screen: moving the phone's
 * clock, and a damaged rules file. Same fake disk and phone as store.test.ts,
 * plus a boot clock the test moves by hand.
 */
import { JUMP_MS, trustedTime } from '../clock';
import { coreOf, EMPTY_SELECTION, requestChange } from '../rules';
import { deviceZone } from '../time';
import type { NativePlan } from '../plan';

const mockDisk = new Map<string, string>();
const mockPhone = {
  plans: [] as NativePlan[],
  uptime: 1_000_000,
  boot: 'boot-1',
  failWrites: false,
};

jest.mock('expo-sqlite/kv-store', () => ({
  __esModule: true,
  default: {
    getItemSync: (k: string) => mockDisk.get(k) ?? null,
    setItemSync: (k: string, v: string) => {
      if (mockPhone.failWrites) throw new Error('disk full');
      mockDisk.set(k, v);
    },
  },
}));
jest.mock('../../../modules/screen-time/src', () => ({
  ScreenTime: {
    isSupported: () => true,
    authorizationStatus: () => 'approved',
    sync: (json: string) => {
      mockPhone.plans.push(JSON.parse(json));
      return [];
    },
    takeState: () => JSON.stringify({ day: '', usedMin: 0, limitReached: false, earnedSpentMin: 0, unlocks: [], openEarn: false }),
    takeUnlock: () => undefined,
    stopAll: () => undefined,
    clock: () => ({ uptimeMs: mockPhone.uptime, boot: mockPhone.boot }),
  },
}));

function load(): typeof import('../store') {
  let m!: typeof import('../store');
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- a fresh module instance is the point
    m = require('../store');
  });
  return m;
}

const BLOCKED = { apps: ['tok-insta'], categories: [], domains: [] };
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 10, 18, 12, 0);

beforeEach(() => {
  mockDisk.clear();
  Object.assign(mockPhone, { plans: [], uptime: 1_000_000, boot: 'boot-1', failWrites: false });
});

describe('trustedTime', () => {
  const a = { wall: T0, up: 1_000, boot: 'b' };
  test('agreeing clocks: the wall clock, and a new anchor', () => {
    expect(trustedTime(a, T0 + 60_000, { uptimeMs: 61_000, boot: 'b' })).toEqual({
      now: T0 + 60_000,
      jumped: false,
      anchor: { wall: T0 + 60_000, up: 61_000, boot: 'b' },
    });
  });
  test('small corrections (network time) are trusted', () => {
    expect(trustedTime(a, T0 + 60_000 + JUMP_MS - 1, { uptimeMs: 61_000, boot: 'b' }).jumped).toBe(false);
  });
  test('the clock moved a week ahead: carry on from the boot clock', () => {
    const t = trustedTime(a, T0 + 7 * DAY, { uptimeMs: 61_000, boot: 'b' });
    expect(t).toEqual({ now: T0 + 60_000, jumped: true, anchor: { wall: T0 + 60_000, up: 61_000, boot: 'b' } });
  });

  test("small moves inside the slack don't add up", () => {
    let anchor = a;
    let up = 1_000;
    // Thirty times: a minute passes and the clock is pushed 1 min 59 s ahead.
    for (let i = 1; i <= 30; i++) {
      up += 60_000;
      const t = trustedTime(anchor, T0 + (up - 1_000) + i * 119_000, { uptimeMs: up, boot: 'b' });
      anchor = t.anchor!;
    }
    expect(anchor.wall).toBe(T0 + 30 * 60_000);
  });

  test('a phone that booted with a reset clock is not anchored to it', () => {
    expect(trustedTime(null, Date.UTC(2000, 0, 1), { uptimeMs: 5_000, boot: 'c' }).anchor).toBeNull();
  });
  test('the clock moved back: same', () => {
    expect(trustedTime(a, T0 - DAY, { uptimeMs: 61_000, boot: 'b' })).toMatchObject({ now: T0 + 60_000, jumped: true });
  });
  test('after a reboot there is nothing to compare with', () => {
    expect(trustedTime(a, T0 + 7 * DAY, { uptimeMs: 5_000, boot: 'c' })).toMatchObject({ now: T0 + 7 * DAY, jumped: false });
  });
  test('no native clock: the wall clock', () => {
    expect(trustedTime(a, T0 + 7 * DAY, null)).toMatchObject({ now: T0 + 7 * DAY, jumped: false });
  });
});

describe('moving the phone clock', () => {
  afterEach(() => jest.useRealTimers());

  test('Strict stays on and the phone is told the real time', () => {
    jest.useFakeTimers({ now: T0 });
    const st = load();
    const r = st.getScreenTime().rules;
    st.saveRules({ ...r, blocked: BLOCKED, strictness: 'strict', strictUntil: T0 + 7 * DAY });
    st.markSetUp();
    // Ten minutes pass on both clocks, then the wall clock is set 8 days ahead.
    mockPhone.uptime += 10 * 60_000;
    jest.setSystemTime(T0 + 8 * DAY + 10 * 60_000);
    const again = load();
    again.syncScreenTime();
    const s = again.getScreenTime();
    expect(s.now).toBe(T0 + 10 * 60_000);
    expect(s.rules.strictness).toBe('strict');
    expect(mockPhone.plans.at(-1)).toMatchObject({ mode: 'strict', madeAt: T0 + 10 * 60_000 });
    expect(s.problems.join(' ')).toMatch(/clock was changed/);
  });

  test('a real day later (boot clock agrees) a new day starts as normal', () => {
    jest.useFakeTimers({ now: T0 });
    const st = load();
    st.saveRules({ ...st.getScreenTime().rules, blocked: BLOCKED });
    st.markSetUp();
    mockPhone.uptime += DAY;
    jest.setSystemTime(T0 + DAY);
    const again = load();
    again.syncScreenTime();
    expect(again.getScreenTime().now).toBe(T0 + DAY);
    expect(again.getScreenTime().problems.join(' ')).not.toMatch(/clock/);
  });
});

describe('storage', () => {
  test('a damaged rules file falls back to the backup copy, not to "nothing blocked"', () => {
    const st = load();
    st.saveRules({ ...st.getScreenTime().rules, blocked: BLOCKED });
    st.markSetUp();
    mockDisk.set('screentime.rules.v1', '{not json');
    const again = load();
    expect(again.getScreenTime().rules.blocked.apps).toEqual(['tok-insta']);
  });

  test('both copies damaged: no empty plan is sent, nothing is saved over them, and the user is told', () => {
    const st = load();
    st.saveRules({ ...st.getScreenTime().rules, blocked: BLOCKED });
    st.markSetUp();
    mockDisk.set('screentime.rules.v1', '{not json');
    mockDisk.set('screentime.rules.backup.v1', '{not json');
    const sent = mockPhone.plans.length;
    const again = load();
    again.syncScreenTime();
    expect(mockPhone.plans.length).toBe(sent);
    expect(mockDisk.get('screentime.rules.v1')).toBe('{not json');
    expect(again.getScreenTime().problems.join(' ')).toMatch(/couldn't be read/);
    // Setting the rules again fixes it.
    again.saveRules({ ...again.getScreenTime().rules, blocked: BLOCKED });
    expect(mockPhone.plans.length).toBe(sent + 1);
    expect(again.getScreenTime().problems.join(' ')).not.toMatch(/couldn't be read/);
  });

  test('a failed save is shown, and clears once saving works again', () => {
    const st = load();
    st.saveRules({ ...st.getScreenTime().rules, blocked: BLOCKED });
    mockPhone.failWrites = true;
    st.markSetUp();
    expect(st.getScreenTime().problems.join(' ')).toMatch(/couldn't be saved/);
    mockPhone.failWrites = false;
    st.syncScreenTime();
    expect(st.getScreenTime().problems.join(' ')).not.toMatch(/couldn't be saved/);
  });
});

describe('turning off', () => {
  afterEach(() => jest.useRealTimers());

  test('a "Turn off" that waits for midnight switches Screen Time off fully when it applies', () => {
    jest.useFakeTimers({ now: T0 });
    const st = load();
    st.saveRules({ ...st.getScreenTime().rules, blocked: BLOCKED, strictness: 'standard' });
    st.markSetUp();
    const r = st.getScreenTime().rules;
    const res = requestChange(
      deviceZone,
      r,
      { ...coreOf(r), blocked: EMPTY_SELECTION, lockTimes: [], dailyLimitMin: null, appLimits: [] },
      T0,
    );
    expect(res.result).toBe('scheduled');
    st.saveRules(res.rules);
    st.markTurnOffPending();
    expect(st.getScreenTime().meta.setUp).toBe(true);
    mockPhone.uptime += DAY;
    jest.setSystemTime(T0 + DAY);
    st.syncScreenTime();
    expect(st.getScreenTime().meta).toMatchObject({ setUp: false, turnOffPending: false, permissionLost: false, lostSince: null });
    expect(st.getScreenTime().focus).toBeNull();
  });
});
