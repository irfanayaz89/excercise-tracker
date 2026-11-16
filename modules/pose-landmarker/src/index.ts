import { NitroModules } from 'react-native-nitro-modules';
import type { PoseLandmarker } from './PoseLandmarker.nitro';

export type { PoseDelegate, PoseLandmarker, PoseLandmarkerOptions, PoseModel, PoseResult } from './PoseLandmarker.nitro';

let instance: PoseLandmarker | null = null;

/** Returns the shared native landmarker, or null if the native module is not linked (Expo Go, web, tests). */
export function getPoseLandmarker(): PoseLandmarker | null {
  if (instance) return instance;
  try {
    instance = NitroModules.createHybridObject<PoseLandmarker>('PoseLandmarker');
  } catch {
    instance = null;
  }
  return instance;
}

export const LANDMARK_STRIDE = 5;
