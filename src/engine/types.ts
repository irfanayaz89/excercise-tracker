/**
 * Core types for the push-up engine.
 *
 * The engine is pure TypeScript with no React Native imports, so it can run
 * in Jest, on the JS thread, or (later) inside a worklet.
 */

/** BlazePose / MediaPipe Pose Landmarker indices (33 points). */
export const LM = {
  nose: 0,
  leftEar: 7,
  rightEar: 8,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
  leftHeel: 29,
  rightHeel: 30,
  leftFootIndex: 31,
  rightFootIndex: 32,
} as const;

export const LANDMARK_COUNT = 33;

/** One landmark in normalized image coordinates (0..1, origin top-left). */
export interface Landmark {
  x: number;
  y: number;
  z: number;
  /** 0..1 — how likely the point is visible (not occluded). */
  visibility: number;
  /** 0..1 — how likely the point is inside the image. */
  presence: number;
}

/** One pose detection result for one camera frame. */
export interface PoseSample {
  /** Frame timestamp in milliseconds (monotonic). */
  t: number;
  /** Upright frame size in pixels, after rotation. */
  width: number;
  height: number;
  /** Empty array when no person was detected. */
  landmarks: Landmark[];
}

/** Phone attitude from the gravity sensor. */
export interface PhoneAttitude {
  t: number;
  /** Rotation of the image horizon in degrees. 0 = level. */
  rollDeg: number;
  /** Lean of the phone away from upright in degrees. 0 = standing straight up. */
  pitchDeg: number;
  /** Recent movement magnitude (deg/s), used to tell if the phone is steady. */
  motionDegPerSec: number;
}

export type Side = 'left' | 'right';

/** 2D point in pixel space. */
export interface Vec2 {
  x: number;
  y: number;
}

/** The six joints of one body side, in pixel space, plus their visibility. */
export interface SideChain {
  side: Side;
  shoulder: Vec2;
  elbow: Vec2;
  wrist: Vec2;
  hip: Vec2;
  knee: Vec2;
  ankle: Vec2;
  ear: Vec2;
  vis: {
    shoulder: number;
    elbow: number;
    wrist: number;
    hip: number;
    knee: number;
    ankle: number;
    ear: number;
  };
}

/** Per-frame body measurements derived from a side chain. */
export interface BodyMetrics {
  t: number;
  side: Side;
  /** Shoulder–elbow–wrist angle in degrees (180 = straight arm). */
  elbowDeg: number | null;
  /** Shoulder–hip–ankle angle in degrees (180 = straight body). */
  bodyLineDeg: number | null;
  /**
   * Signed hip offset from the shoulder–ankle line, in torso lengths.
   * Positive = hip below the line (sag), negative = above (pike).
   */
  hipOffset: number | null;
  /** Hip–knee–ankle angle. */
  kneeDeg: number | null;
  /** Ear–shoulder–hip angle, a rough head/neck alignment hint. */
  neckDeg: number | null;
  /** Angle of the shoulder→ankle line from horizontal, corrected for phone roll. */
  trunkTiltDeg: number | null;
  /** Shoulder height above the wrist, in torso lengths (0 = shoulder at wrist level). */
  shoulderHeight: number | null;
  /** Horizontal wrist offset from the shoulder, in torso lengths. */
  wristOffset: number | null;
  /** Horizontal elbow offset from the shoulder, in torso lengths (forearm plank: elbows under shoulders). */
  elbowStack: number | null;
  /** Height difference between wrist and elbow, in torso lengths (≈ 0 when the forearm lies on the floor). */
  forearmRise: number | null;
  /**
   * How far the other shoulder sits above this side's shoulder, in torso lengths.
   * Side plank: the shoulders stack (about 0.6–0.8); rolling towards the floor or
   * the ceiling shrinks it. Null when the other shoulder is not clearly visible.
   */
  shoulderStack: number | null;
  /**
   * Crunch: how far the shoulders are lifted, as the angle of the hip→shoulder
   * line above horizontal (0 = lying flat, 90 = sitting up straight). Not roll
   * corrected; the crunch counter measures it from the user's own resting angle.
   */
  trunkLiftDeg: number | null;
  /** Ankle height above the hip, in torso lengths (crunch: feet lifting off the floor). */
  footRise: number | null;
  /** Shoulder-to-hip distance in pixels. */
  torsoPx: number;
  /** Hip centre in normalized coordinates, for identity tracking. */
  hipCenter: Vec2;
}

/** How the phone stands during a set; picked by the user. */
export type PhoneOrientation = 'landscape' | 'portrait';

/** What the set is: push-ups and crunches are counted, planks are timed. */
export type Exercise = 'pushup' | 'crunch' | 'plank' | 'sidePlank';

/** High plank on straight arms, or forearm plank with the forearms on the floor. */
export type PlankVariant = 'high' | 'forearm';
