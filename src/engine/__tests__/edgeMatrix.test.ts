/// <reference types="jest" />
/**
 * The edge-case matrix: every exercise, in every view it supports, at every
 * level, in both phone orientations, facing either way, with the settings
 * that change tracking switched on and off. Each combination plays a set of
 * real-life situations, with joints near or past the frame edge reported the
 * way a real pose model reports them (low confidence once off the picture).
 *
 * The rules:
 * - Wherever everything the exercise needs is in view, the count (or hold
 *   time) matches a clean set exactly, whatever the noise, misreads, dropped
 *   frames, low frame rate, crooked phone or dim light.
 * - A body close to the frame edge but inside it counts like any other.
 * - Where something needed is out of view, the set either never starts and
 *   says why, or pauses: it never makes up reps, and never loses the ones done.
 * - Settings do what they say: knees, the real-person check, plank test mode.
 */
import {
  allCases,
  frames,
  handheld,
  label,
  misreads,
  placeAtEdge,
  play,
  setFor,
  shift,
  type Case,
  type RunResult,
} from '../testing/edgeScenarios';
import { forearmPlank, hold, rep, sidePlank, type BodyParams } from '../testing/synth';

const N = 6;
const timed = (c: Case) => c.exercise === 'plank' || c.exercise === 'sidePlank';
const value = (c: Case, r: RunResult) => (timed(c) ? r.goodMs : r.reps);
/** Same result as the clean set: exact reps, or hold time within a frame or two of filter lag. */
const same = (c: Case, r: RunResult, clean: RunResult) => (timed(c) ? Math.abs(r.goodMs - clean.goodMs) <= 400 : r.reps === clean.reps);
const why = (r: RunResult) => [...r.framing, ...r.plankIssues];
const sampleBody = (c: Case): BodyParams =>
  c.exercise === 'crunch'
    ? { elbowDeg: 90, crunch: { liftDeg: 0 } }
    : c.exercise === 'sidePlank'
      ? { elbowDeg: 172, forearm: true, forearmScale: 0.1, stack: 0.7 }
      : c.exercise === 'plank'
        ? { elbowDeg: 172, forearm: true }
        : { elbowDeg: 172 };
const baseOf = (c: Case): Partial<BodyParams> => ({
  ...(c.portrait ? { width: 720, height: 1280, torsoPx: 130, floorY: 1280 * 0.7 } : {}),
  facing: c.facing,
});

describe.each(allCases().map((c) => [label(c), c] as const))('%s', (_, c) => {
  const set = setFor(c.exercise, N);
  const clean = play(c, frames(c, set.segs));

  it('a clean set starts and counts (or times) everything, with no pauses or misses', () => {
    expect(clean.started).toBe(true);
    if (timed(c)) {
      // The clock runs from the moment the start hold is accepted to the end.
      expect(clean.goodMs).toBeGreaterThan(set.holdMs + 500);
      expect(clean.goodMs).toBeLessThan(set.holdMs + 3000);
    } else expect(clean.reps).toBe(N);
    expect(clean.pauses).toEqual([]);
    expect(clean.misses).toEqual([]);
    expect(clean.summary.realityFlags).toBe(0);
  });

  it.each([
    ['misread joints', { mapFrame: misreads(7, 3) }, {}, undefined],
    ['a quarter of frames dropped', { dropFrame: (i: number) => i % 4 === 1 }, {}, undefined],
    ['15 fps', { fps: 15 }, {}, undefined],
    ['dim light', {}, { visNear: 0.62 }, undefined],
    ['a crooked phone', {}, {}, 4],
  ] as const)('the same with %s', (_n, opts, body, roll) => {
    const r = play(c, frames(c, set.segs, body as Partial<BodyParams>, opts as never), () => ({ roll: roll ?? 0 }));
    expect(r.started).toBe(true);
    expect(same(c, r, clean)).toBe(true);
    expect(r.pauses).toEqual([]);
  });

  if (c.view === 'side') {
    it.each(['left', 'right'] as const)('a body 3%% from the %s edge counts like any other', (side) => {
      const r = play(c, frames(c, set.segs, placeAtEdge(baseOf(c), sampleBody(c), side, 0.03)));
      expect(r.started).toBe(true);
      expect(same(c, r, clean)).toBe(true);
    });

    it.each(['left', 'right'] as const)('a body cut off at the %s edge counts exactly or says what is missing', (side) => {
      const r = play(c, frames(c, set.segs, placeAtEdge(baseOf(c), sampleBody(c), side, -0.06)));
      if (r.started) expect(same(c, r, clean) || value(c, r) <= value(c, clean)).toBe(true);
      else expect(why(r).length).toBeGreaterThan(0);
      expect(r.reps).toBeLessThanOrEqual(N);
    });

    it.each([0.995, 1.005, 1.0])('the floor at %s of the frame height: exact, or not started with a reason', (k) => {
      const H = c.portrait ? 1280 : 720;
      const r = play(c, frames(c, set.segs, { floorY: H * k }));
      if (r.started) expect(same(c, r, clean)).toBe(true);
      else expect(why(r).some((w) => ['floor-low', 'move-back', 'show-feet'].includes(w))).toBe(true);
    });
  } else {
    it.each([
      ['1.0 m', 1.0],
      ['2.4 m', 2.4],
    ] as const)('phone %s away: exact, or not started with a reason', (_d, distanceM) => {
      const r = play(c, frames(c, set.segs, {}, { front: { distanceM } }));
      if (r.started) expect(same(c, r, clean)).toBe(true);
      else expect(why(r).length).toBeGreaterThan(0);
    });
  }

  it.each([
    ['towards the feet', 1, 0],
    ['towards the head', -1, 0],
    ['down', 0, 1],
    ['up', 0, -1],
  ] as const)('drifting %s out of the picture mid-set never adds reps or time, and keeps what was done', (_d, sx, sy) => {
    const dir = c.facing === 'left' ? 1 : -1;
    const r = play(c, frames(c, set.segs, {}, { mapFrame: shift(0.3 * sx * dir, 0.4 * sy, 7000) }));
    expect(r.started).toBe(true);
    // Some drifts leave everything needed in view (it then counts exactly); the rest pause.
    // Planks on Medium/Hard: with the feet gone the clock stops (it can't judge the hips) without pausing.
    const clockStopped = timed(c) && (r.summary.hold?.faultMs['out-of-view'] ?? 0) > 1000;
    if (r.pauses.length === 0 && !clockStopped) expect(same(c, r, clean)).toBe(true);
    else {
      if (!clockStopped) expect(r.pauses.some((p) => ['lost-tracking', 'left-position', 'other-person'].includes(p))).toBe(true);
      expect(value(c, r)).toBeLessThanOrEqual(value(c, clean) + (timed(c) ? 400 : 0));
      // At least what was done before the drift (about 2 reps, or 3 s held).
      expect(value(c, r)).toBeGreaterThanOrEqual(timed(c) ? 2500 : 2);
    }
  });

  if (!timed(c)) {
    it('a joint we count from leaving the picture at one end of every rep pauses and says so (never a silent stall)', () => {
      // Shift the picture so the shoulders leave the top at the top of each rep (and come back at the bottom).
      const r = play(
        c,
        frames(c, set.segs, {}, { mapFrame: shift(0, c.exercise === 'crunch' ? -0.62 : c.view === 'front' ? -0.4 : -0.5, 7000) }),
      );
      if (r.reps !== clean.reps) {
        expect(r.pauses).toContain('lost-tracking');
        expect(r.reps).toBeLessThanOrEqual(N);
      }
    });
  }

  it('real-person check on: a video held up to the camera is caught and not counted', () => {
    const r = play(c, frames(c, set.segs, {}, { mapFrame: handheld(7000) }));
    expect(r.summary.realityFlags).toBeGreaterThan(0);
    expect(r.pauses).toContain('not-real');
    expect(value(c, r)).toBeLessThan(value(c, clean));
  });

  it('real-person check off: the same video counts as the user chose', () => {
    const r = play({ ...c, realPersonCheck: false }, frames(c, set.segs, {}, { mapFrame: handheld(7000) }));
    expect(r.summary.realityFlags).toBe(0);
    expect(same(c, r, clean)).toBe(true);
  });

  if (c.exercise !== 'crunch') {
    const knees =
      c.exercise === 'pushup'
        ? [hold(3000, { kneeDeg: 100 }), ...Array.from({ length: 4 }, () => rep(1800, 80, 172, { kneeDeg: 100 }))]
        : c.exercise === 'plank'
          ? [forearmPlank(9000, { kneeDeg: 100 })]
          : [sidePlank(9000, { kneeDeg: 100 })];
    // Head-on the knees sit behind the body, so the knee setting can only be checked side-on.
    const kneesSeen = c.view === 'side';

    it('knees down: Easy always accepts; Medium/Hard only with the knee setting on (side-on)', () => {
      const off = play({ ...c, allowKneeling: false }, frames(c, knees));
      const on = play({ ...c, allowKneeling: true }, frames(c, knees));
      expect(on.started).toBe(true);
      if (c.level === 'easy' || !kneesSeen) expect(off.started).toBe(true);
      else {
        expect(off.started).toBe(false);
        expect(why(off)).toContain('straighten-legs');
      }
      if (!timed(c)) expect(on.reps).toBe(4);
    });
  }

  if (timed(c)) {
    const sag =
      c.exercise === 'plank'
        ? [forearmPlank(6000), forearmPlank(3000, { sag: 0.35 }), forearmPlank(4000)]
        : [sidePlank(6000), sidePlank(3000, { sag: 0.35 }), sidePlank(4000)];

    it('plank test mode: a clean hold runs to the end', () => {
      const r = play({ ...c, plankTestMode: true }, frames(c, set.segs));
      expect(r.ended).toBe(false);
      expect(same(c, r, clean)).toBe(true);
    });

    it(
      c.view === 'side'
        ? 'plank test mode: a sag ends the test'
        : 'plank test mode facing the phone: a sag cannot be seen head-on, so the test carries on',
      () => {
        const r = play({ ...c, plankTestMode: true }, frames(c, sag));
        if (c.view === 'side') {
          expect(r.ended).toBe(true);
          expect(r.summary.endReason).toBe('form-break');
        } else expect(r.ended).toBe(false);
      },
    );
  }
});
