import type { HybridObject } from 'react-native-nitro-modules';
import type { Frame } from 'react-native-vision-camera';

/** Bundled model variants. `full` is the default; `lite` is the low-end fallback. */
export type PoseModel = 'lite' | 'full';

export type PoseDelegate = 'gpu' | 'cpu';

export interface PoseLandmarkerOptions {
  model: PoseModel;
  /** Preferred delegate. Falls back to CPU automatically if the GPU fails. */
  delegate: PoseDelegate;
  minPoseDetectionConfidence: number;
  minPosePresenceConfidence: number;
  minTrackingConfidence: number;
}

export interface PoseResult {
  /**
   * 33 landmarks × 5 values: x, y, z, visibility, presence.
   * x/y are normalized to the upright (rotated) frame, NOT mirrored.
   * Empty when no person was found.
   */
  landmarks: number[];
  /** Upright frame size in pixels. */
  width: number;
  height: number;
  /** True when the preview is mirrored (front camera); flip x to match it. */
  mirrored: boolean;
  /** Monotonic timestamp in milliseconds. */
  timestampMs: number;
  /** Model run time for this frame in milliseconds. */
  inferenceMs: number;
}

export interface PoseLandmarker extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  /** Loads (or reloads) the model. Rejects with a readable message if it cannot. */
  load(options: PoseLandmarkerOptions): Promise<void>;
  readonly isLoaded: boolean;
  /** 'gpu' or 'cpu' after load, '' before. */
  readonly activeDelegate: string;
  /** Last load or detection error, '' if none. */
  readonly lastError: string;
  /**
   * Runs the model on a camera frame, synchronously, on the calling (camera)
   * thread. Returns undefined when the model is not loaded or the frame is
   * unusable. Never throws for a bad frame.
   */
  detect(frame: Frame): PoseResult | undefined;
  /** Releases the model. Safe to call more than once. */
  close(): void;
}
