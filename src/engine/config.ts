/**
 * Every tunable number in the engine lives here.
 *
 * Values are starting points from the research report (papers, open-source
 * counters and exercise standards). Tune them against recorded sessions with
 * the replay tests in `src/engine/__tests__/replay.test.ts`.
 */
export interface EngineConfig {
  /** Where the camera sees the user from (see `front` for the head-on settings). */
  view: 'side' | 'front';
  /** A landmark below this visibility is treated as unknown. */
  minVisibility: number;
  /** How long a lost landmark may be held at its last value before it counts as missing. */
  landmarkHoldMs: number;
  /** A frame gap longer than this resets the filters (app paused, frames dropped). */
  maxFrameGapMs: number;

  oneEuro: { minCutoff: number; beta: number; dCutoff: number };

  /** Side selection: the other side must lead in visibility for this long before we switch. */
  sideSwitchMs: number;
  /** Visibility lead needed to start a side switch. */
  sideSwitchMargin: number;

  phone: {
    maxRollDeg: number;
    maxPitchDeg: number;
    /** Above this, the phone is "moving". */
    maxMotionDegPerSec: number;
    steadyMs: number;
    /** Sensor readings older than this are ignored (sensor unavailable). */
    staleMs: number;
  };

  framing: {
    /** Normalized margin from each edge that joints must stay inside. */
    edgeMargin: number;
    /** Body length (shoulder→ankle horizontal span) as a share of frame width. */
    minBodySpan: number;
    maxBodySpan: number;
    /** Shoulder width / torso length above this means the user faces the camera head-on. */
    maxShoulderWidthRatio: number;
    /** Mean visibility below this suggests poor lighting. */
    lowLightVisibility: number;
    lowLightMs: number;
    /** Feet must be in view (needed for hip and leg checks). */
    requireFeet: boolean;
    /** Head and shoulders must be clear of the frame edge. */
    requireHead: boolean;
    /** Counting needs the arm (push-ups). Crunches only need shoulder, hip and knee: hands may hide behind the head. */
    requireArms: boolean;
    /**
     * Measure body size along the body (shoulder→hip→ankle) instead of its
     * horizontal span. Crunches: the span shrinks as you curl up or sit, but
     * you have not moved away from the phone.
     */
    spanAlongBody: boolean;
    /**
     * How to tell the camera picture is upside down (Rotation Lock on, phone in
     * landscape the other way round): shoulders below the feet, or for crunches
     * the bent knees pointing down. Angles survive a flip, but which way is up
     * does not (hip sag, push-up depth and crunch lift all invert).
     */
    uprightBy: 'shoulders' | 'knees';
    /** Upside down for this long before it is reported (single misreads pass). */
    upsideDownMs: number;
  };

  plank: {
    minBodyLineDeg: number;
    maxTrunkTiltDeg: number;
    minElbowDeg: number;
    maxWristOffset: number;
    minKneeDeg: number;
    holdMs: number;
    /** Max shoulder wobble (torso lengths) allowed during the hold. */
    maxWobble: number;
    /** Check the shoulder–hip–ankle line before starting. */
    checkHips: boolean;
    /** Check hands sit under the shoulders before starting. */
    checkHands: boolean;
    /** Forearm plank (plank exercise only): elbow angle range with the forearm flat on the floor. */
    forearmMinElbowDeg: number;
    forearmMaxElbowDeg: number;
    /** Wrist this close to elbow height (torso lengths) means the forearm rests on the floor. */
    forearmMaxRise: number;
    /** Elbow at most this far from under the shoulder (torso lengths). */
    maxElbowStack: number;
  };

  /** Plank hold timing and form (plank exercise only). */
  hold: {
    /** Shoulder–hip–ankle angle below this is a fault. */
    minBodyLineDeg: number;
    /** Hip below the shoulder–ankle line by more than this (torso lengths) is a sag fault. */
    sagFault: number;
    /** Hip above the line by more than this (torso lengths) is a pike fault. */
    pikeFault: number;
    /** Moving this far from your own start position also counts, once past `warnRatio` of a limit. */
    driftFault: number;
    /** Share of a limit at which an early warning is given. */
    warnRatio: number;
    /**
     * Same for raised hips. Coaches cue "hips up an inch" (about 0.05 torso
     * lengths), so a slight raise gets more room than a sag before any warning.
     */
    pikeWarnRatio: number;
    /** A problem must last this long before it is warned about (misread joints last a frame or two). */
    warnMs: number;
    /** Hips sinking faster than this (torso lengths per second) is warned about before it becomes a fault. */
    sagTrendPerSec: number;
    /** A fault shorter than this does not stop the clock. */
    graceMs: number;
    /** Good form must last this long before the clock runs again after a break. */
    restoreMs: number;
    /** High plank: elbow bent this far below `plank.minElbowDeg` is a fault. */
    armBendDeg: number;
    /** Knees bent this far below `plank.minKneeDeg` mid-hold is a fault (unless kneeling is allowed). */
    kneeBendDeg: number;
    /** High plank: warn (never stop the clock) when the hands drift from under the shoulders. */
    checkHands: boolean;
    /** Neck angle below this is a hint (head dropping). */
    minNeckDeg: number;
    /** Test mode: the hold ends at the first real form break. */
    endOnBreak: boolean;
    /** Spoken time call every this many seconds of good form. */
    milestoneSec: number;
  };

  rep: {
    /** Elbow angle that marks the bottom. */
    downElbowDeg: number;
    /** Elbow angle that marks lockout at the top. */
    upElbowDeg: number;
    /**
     * Expected shoulder height at the bottom as a share of the calibrated top
     * height. The drop signal is measured against this expected range.
     */
    expectedBottomRatio: number;
    /** Required shoulder drop (share of the expected range) to confirm depth. */
    minDropRatio: number;
    /** Drop share that counts as full depth on its own when the elbow is hidden. */
    dropOnlyDepthRatio: number;
    /** Faster than this is noise and is not counted. */
    minRepMs: number;
    /** Faster than this is counted but flagged as rushed. */
    rushedRepMs: number;
    /** Longer than this, the attempt is abandoned (resting). */
    maxRepMs: number;
    /** Halfway marker used to detect a partial rep that turns back early. */
    midElbowDeg: number;
  };

  form: {
    /** When false, reps are only counted, never flagged for form. */
    enabled: boolean;
    /** Body line below this during a rep is a fault. */
    minBodyLineDeg: number;
    /** Hip offset (torso lengths) beyond which the fault is sag or pike. */
    hipOffsetFault: number;
    /** Neck angle below this is a hint (head dropping). */
    minNeckDeg: number;
  };

  session: {
    /** Tracking lost for this long pauses the session. */
    pauseAfterMs: number;
    /** Paused this long, the session ends on its own. */
    autoEndPausedMs: number;
    /** In position but no rep for this long, the session ends on its own. */
    autoEndIdleMs: number;
    /** Stuck in setup (phone or body check) this long with nobody starting: end, so the camera and screen don't run until the battery dies. */
    setupTimeoutMs: number;
    /** Same cue is not repeated within this window. */
    cueCooldownMs: number;
    /** Hip centre jump (normalized units) that means a different person. */
    identityJump: number;
    /** Torso length change ratio that means a different person. */
    identityScale: number;
  };

  /** Accept knee push-ups as a valid plank. */
  allowKneeling: boolean;

  /**
   * Side plank: you face the phone, lying on one side. The top shoulder sits
   * above the bottom one by about a shoulder width (0.6–0.8 torso lengths).
   */
  sidePlank: {
    /** Shoulder stack needed to start (torso lengths). */
    startStack: number;
    /** Below this mid-hold, the body has rolled towards the floor or the ceiling. */
    minStack: number;
  };

  /**
   * Crunch, seen side-on: lying on your back, knees bent, feet flat. A rep is
   * the shoulders curling up off the floor and coming back down. Lift is the
   * angle of the hip→shoulder line, measured from the user's own resting angle.
   */
  crunch: {
    /** Start: lying down, shoulders at most this far above the hips (degrees). */
    maxRestLiftDeg: number;
    /** Start: knees bent within this range (hip–knee–ankle, degrees). */
    minKneeDeg: number;
    maxKneeDeg: number;
    /** Start: feet on the floor, ankles no higher than this above the hip (torso lengths). */
    maxFootRise: number;
    /** Lift above rest that counts as a crunch (shoulder blades off the floor). */
    upDeg: number;
    /** Lift above rest that starts an attempt. Must be above `downDeg`. */
    leaveDeg: number;
    /** Back down: within this of rest. */
    downDeg: number;
    /** Rose this far but turned back before `upDeg`: a half crunch (miss). */
    partialDeg: number;
    /** Above this lift the crunch has become a sit-up (hip flexors take over): a fault. */
    satUpDeg: number;
    /** Feet rising this far from where they rested (torso lengths): a fault. */
    feetLiftFault: number;
    /** Neck angle (ear–shoulder–hip) drop from rest beyond this is a hint: chin pulled to the chest. */
    neckPullDeg: number;
    /** Lift above this for a while means sitting or standing up: the set pauses. */
    outLiftDeg: number;
    minRepMs: number;
    /** Faster than this is counted but flagged as rushed (momentum). Measured off the floor, not the whole crunch. */
    rushedRepMs: number;
    maxRepMs: number;
  };

  /**
   * Pull-ups, seen from the front or a diagonal, the phone 2–2.5 m away at about
   * waist height (or on the floor leaning back). Heights are measured against the
   * bar, which is where the hands rest: they stay on it the whole set. Lengths are
   * in shoulder widths. Rules follow the strict standard (dead hang, chin over the
   * bar, back to straight arms, no kip) and published pull-up counters: mouth over
   * the bar for "up"; straight elbows with the eyes below the elbows for "down".
   */
  pullup: {
    /** The phone may lean back this far to see the bar (degrees). */
    maxPitchDeg: number;
    /** Dead hang: elbows at least this straight (degrees). */
    hangElbowDeg: number;
    /**
     * Hands this far above the shoulders (shoulder widths) means holding the bar. Measured against
     * the shoulders, not the head: at the top of a pull the head is level with the hands.
     */
    handsOverShoulders: number;
    /** Up: mouth this far above the bar or higher (shoulder widths; 0 = level with the bar). */
    topClearance: number;
    /** Up: elbows bent to at least this (degrees); only checked when the elbows are seen. */
    topElbowDeg: number;
    /** A pull has started once the mouth rises this far above its hanging height (shoulder widths). */
    leaveRise: number;
    /** Rose at least this far before turning back without reaching the bar: a half rep (miss). */
    partialRise: number;
    /** Left the top once the mouth drops this far below the bar (shoulder widths). */
    leaveTop: number;
    /** Kip: knees driven up towards the hips by this share of the hanging hip–knee gap. */
    kipKneeRise: number;
    /** Swing: hips travelling sideways more than this during a pull (shoulder widths). */
    swingFault: number;
    /** One shoulder higher than the other by more than this at the top (shoulder widths). */
    tiltFault: number;
    /** Top to dead hang faster than this is a drop, not a controlled lowering (ms). */
    dropMs: number;
    /** Hands down from the bar for this long pauses the set (ms). */
    offBarMs: number;
    minRepMs: number;
    maxRepMs: number;
  };

  /**
   * Front view (facing the phone: push-ups and the plank). Everything is measured in shoulder widths,
   * which stay steady head-on at any distance. Starting values from geometry
   * and the head-on research; tune them with recorded sets.
   */
  front: {
    /** Body size: shoulder width as a share of the frame width. */
    minShoulderShare: number;
    maxShoulderShare: number;
    /** Push-up start: shoulders this many shoulder widths above the hands means straight arms. */
    straightArmD: number;
    /** Plank: below this the weight is on the forearms. */
    forearmMaxD: number;
    /** Hands this far apart (shoulder widths) are fine. */
    minHandSpread: number;
    maxHandSpread: number;
    /** Push-ups: elbows flaring out past the shoulders by more than this (shoulder widths) at the bottom is a fault. */
    flareFault: number;
    /** One shoulder lower by more than this (shoulder widths) through the rep is a fault. */
    tiltFault: number;
  };

  /**
   * Real-person check: a video of someone exercising, shown on a screen, must
   * not count. Two independent signals, each needing sustained evidence.
   */
  reality: {
    enabled: boolean;
    /** Depth (iPhone): a real body stands out from the space above its back by at least this much (m). */
    minStandOutM: number;
    /** Stand-out this large is clear evidence of a real body (m). */
    realStandOutM: number;
    /** A real torso (shoulder to hip) measures between these (m); a person on a phone screen measures a few cm. */
    minTorsoM: number;
    maxTorsoM: number;
    /** Evidence window, and how many depth readings it needs before any verdict. */
    windowMs: number;
    minVotes: number;
    /** Share of readings in the window that must look fake. */
    fakeShare: number;
    /**
     * Handheld screen: with the phone still, hands and feet moving together at
     * this typical speed (frame widths per second). Measured: camera noise on a
     * real person stays under 0.042; a screen shaken by about 5 mm reads 0.05+.
     */
    shakeSpeed: number;
    /**
     * ...and moving together: their midpoint moves at least this many times more
     * than the gap between them changes. Measured: camera noise on a real person
     * never above 0.9; a held-up screen mostly above 1.1.
     */
    shakeRigidity: number;
    /** Share of frames over `shakeMs` that must look like shaking. */
    shakeShare: number;
    /** ...for this long, mostly back and forth rather than one move. */
    shakeMs: number;
    /** The phone counts as still below this rotation speed (deg/s). */
    stillPhoneDegPerSec: number;
    /** After a flag, no suspicious sign for this long before the set can resume. */
    clearMs: number;
  };
}

export const DEFAULT_CONFIG: EngineConfig = {
  view: 'side',
  minVisibility: 0.5,
  landmarkHoldMs: 200,
  maxFrameGapMs: 500,
  // Normalized-unit One Euro values. MediaPipe's own pose smoothing uses a much
  // higher beta than the often-quoted 0.007; 1.5 / 4 keeps lag under ~60 ms at rep speed.
  oneEuro: { minCutoff: 1.5, beta: 4, dCutoff: 1.0 },
  sideSwitchMs: 1000,
  sideSwitchMargin: 0.15,
  phone: {
    maxRollDeg: 5,
    // A phone propped against a wall typically leans back 10–20°.
    maxPitchDeg: 20,
    maxMotionDegPerSec: 8,
    steadyMs: 1000,
    staleMs: 1500,
  },
  framing: {
    edgeMargin: 0.03,
    // Body at least ~38% of the frame width: smaller still tracks, but less precisely.
    minBodySpan: 0.38,
    maxBodySpan: 0.94,
    maxShoulderWidthRatio: 1.4,
    lowLightVisibility: 0.55,
    lowLightMs: 2500,
    requireFeet: true,
    requireHead: true,
    requireArms: true,
    spanAlongBody: false,
    uprightBy: 'shoulders',
    upsideDownMs: 1000,
  },
  plank: {
    minBodyLineDeg: 160,
    maxTrunkTiltDeg: 30,
    minElbowDeg: 150,
    maxWristOffset: 0.45,
    minKneeDeg: 155,
    holdMs: 1200,
    maxWobble: 0.12,
    checkHips: true,
    checkHands: true,
    forearmMinElbowDeg: 50,
    forearmMaxElbowDeg: 135,
    forearmMaxRise: 0.2,
    maxElbowStack: 0.35,
  },
  // Plank limits: a straight line is 180°; the one published camera threshold
  // (PoseDetector, side view, MediaPipe) accepts 165–195°.
  hold: {
    minBodyLineDeg: 165,
    sagFault: 0.1,
    pikeFault: 0.12,
    driftFault: 0.1,
    warnRatio: 0.6,
    pikeWarnRatio: 0.75,
    warnMs: 400,
    sagTrendPerSec: 0.015,
    graceMs: 1000,
    restoreMs: 500,
    armBendDeg: 15,
    kneeBendDeg: 10,
    checkHands: true,
    minNeckDeg: 140,
    endOnBreak: false,
    milestoneSec: 15,
  },
  rep: {
    downElbowDeg: 95,
    upElbowDeg: 155,
    expectedBottomRatio: 0.6,
    minDropRatio: 0.5,
    // Elbow hidden: about the same depth as downElbowDeg (0.8 ≈ 85°), slightly
    // deeper because the shoulder drop alone is noisier.
    dropOnlyDepthRatio: 0.8,
    minRepMs: 400,
    rushedRepMs: 800,
    maxRepMs: 10000,
    midElbowDeg: 125,
  },
  form: {
    enabled: true,
    minBodyLineDeg: 160,
    hipOffsetFault: 0.12,
    minNeckDeg: 140,
  },
  session: {
    pauseAfterMs: 2000,
    autoEndPausedMs: 60000,
    autoEndIdleMs: 45000,
    setupTimeoutMs: 600000,
    cueCooldownMs: 3500,
    identityJump: 0.25,
    identityScale: 0.35,
  },
  allowKneeling: false,
  sidePlank: { startStack: 0.4, minStack: 0.28 },
  // Crunch numbers: curl-up tests define the top as ~30° of trunk flexion and the
  // abs do the first 20–30° (hip flexors beyond ~45°, Liang 2010, Juker/McGill
  // 1998). Knee angles in published protocols run from 90° to 140°.
  crunch: {
    maxRestLiftDeg: 20,
    minKneeDeg: 40,
    maxKneeDeg: 140,
    maxFootRise: 0.15,
    // leave > down: the gap is the hysteresis that stops noise at a few degrees
    // from starting and ending attempts over and over.
    upDeg: 22,
    leaveDeg: 9,
    downDeg: 6,
    partialDeg: 11,
    satUpDeg: 50,
    feetLiftFault: 0.2,
    neckPullDeg: 35,
    outLiftDeg: 70,
    // Rep time runs from leaving the floor to being back down, about 70% of a
    // whole crunch: 800 ms here is a crunch of roughly 1.1 s (test pace is 3 s).
    minRepMs: 350,
    rushedRepMs: 800,
    maxRepMs: 10000,
  },
  pullup: {
    // A phone on the floor 2 m away sees up to about 1.6 m; leaning back or
    // standing on a chair brings the bar (about 2.2–2.4 m) into the picture.
    maxPitchDeg: 35,
    hangElbowDeg: 150,
    handsOverShoulders: 0.2,
    topClearance: 0,
    topElbowDeg: 110,
    leaveRise: 0.35,
    partialRise: 0.6,
    leaveTop: 0.25,
    kipKneeRise: 0.55,
    swingFault: 0.6,
    tiltFault: 0.18,
    dropMs: 350,
    offBarMs: 1500,
    // Measured from leaving the hang to the bar: a quick strict pull is ~0.4 s, so this only drops glitches.
    minRepMs: 250,
    maxRepMs: 10000,
  },
  front: {
    minShoulderShare: 0.1,
    maxShoulderShare: 0.65,
    straightArmD: 1.15,
    forearmMaxD: 1.1,
    minHandSpread: 0.7,
    maxHandSpread: 2.3,
    flareFault: 0.3,
    tiltFault: 0.15,
  },
  reality: {
    enabled: true,
    minStandOutM: 0.12,
    realStandOutM: 0.25,
    minTorsoM: 0.2,
    maxTorsoM: 1.5,
    windowMs: 3000,
    minVotes: 6,
    fakeShare: 0.75,
    shakeSpeed: 0.045,
    shakeRigidity: 1.1,
    shakeShare: 0.7,
    shakeMs: 3000,
    stillPhoneDegPerSec: 3,
    clearMs: 2000,
  },
};

export function mergeConfig(overrides?: DeepPartial<EngineConfig>): EngineConfig {
  if (!overrides) return DEFAULT_CONFIG;
  const out: Record<string, unknown> = { ...DEFAULT_CONFIG };
  for (const [k, v] of Object.entries(overrides)) {
    const base = (DEFAULT_CONFIG as unknown as Record<string, unknown>)[k];
    out[k] = v && typeof v === 'object' && base && typeof base === 'object' ? { ...base, ...v } : v;
  }
  return out as unknown as EngineConfig;
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? Partial<T[K]> : T[K] };
