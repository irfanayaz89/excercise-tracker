import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { getPoseLandmarker, type PoseModel, type PoseResult } from 'react-native-pose-landmarker';
import { CommonResolutions, useFrameOutput, type Frame } from 'react-native-vision-camera';
import { scheduleOnRN } from 'react-native-worklets';
import { LANDMARK_COUNT, type Landmark, type PoseSample } from '@/engine/types';

export type ModelStatus = 'unsupported' | 'loading' | 'ready' | 'error';

export interface PoseStats {
  fps: number;
  inferenceMs: number;
  delegate: string;
  model: PoseModel;
}

/** Above this average inference time on `full`, we switch to `lite` automatically. */
const SLOW_MS = 55;

/**
 * Runs MediaPipe on every camera frame (on the camera thread) and delivers
 * pose samples to JS in the engine's clock.
 *
 * Handles: native module missing (Expo Go), model load failure with a
 * readable error and retry, GPU→CPU fallback (native), automatic downgrade to
 * the lite model on slow phones, and front-camera mirroring.
 */
/**
 * The native landmarker is one shared object. Count the screens using it so one
 * screen unmounting (e.g. a second session pushed by a double tap) does not
 * close it under another.
 */
let users = 0;

export function usePoseStream(opts: { modelPreference: 'auto' | 'full' | 'lite'; onPose: (s: PoseSample) => void }) {
  const landmarker = useMemo(() => getPoseLandmarker(), []);
  const [status, setStatus] = useState<ModelStatus>(landmarker ? 'loading' : 'unsupported');
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<PoseModel>(opts.modelPreference === 'lite' ? 'lite' : 'full');
  const [stats, setStats] = useState<PoseStats | null>(null);
  const onPoseRef = useRef(opts.onPose);
  useLayoutEffect(() => {
    onPoseRef.current = opts.onPose;
  });

  // Native frame timestamps use a different clock than JS. Track the offset
  // with a running minimum so scheduling delays do not leak into timing.
  const clock = useRef<{ offset: number | null }>({ offset: null });
  const perf = useRef({ frames: 0, inf: 0, since: 0, slowStreak: 0 });

  // False once the screen is gone: a load that finishes late must not leave
  // the model resident with nobody using it.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    users += 1;
    return () => {
      alive.current = false;
      users -= 1;
    };
  }, []);

  /** @param downgrade an automatic switch mid-set: on failure keep the working model instead of showing an error. */
  const load = useCallback(
    async (m: PoseModel, downgrade = false) => {
      if (!landmarker) return;
      try {
        await landmarker.load({
          model: m,
          delegate: 'gpu',
          minPoseDetectionConfidence: 0.5,
          minPosePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
        if (!alive.current) {
          if (users > 0) return; // another screen is using it
          try {
            landmarker.close();
          } catch {
            // already closed
          }
          return;
        }
        setModel(m);
        setError(null);
        setStatus('ready');
      } catch (e) {
        if (!alive.current) return;
        if (downgrade) return; // the full model is still loaded and working
        setError(e instanceof Error ? e.message : String(e));
        setStatus('error');
      }
    },
    [landmarker],
  );

  useEffect(() => {
    // State is only set after the async native load resolves, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(opts.modelPreference === 'lite' ? 'lite' : 'full');
    return () => {
      // Effects clean up in order, so `users` already excludes this screen here.
      if (users > 0) return;
      try {
        landmarker?.close();
      } catch {
        // already closed
      }
    };
    // Reload only when the preference itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.modelPreference, landmarker]);

  const handleResult = useCallback(
    (r: PoseResult) => {
      const now = performance.now();
      const raw = now - r.timestampMs;
      const c = clock.current;
      // Follow a smaller offset immediately, a larger one slowly (clock drift / app resume).
      c.offset = c.offset === null ? raw : raw < c.offset ? raw : c.offset + (raw - c.offset) * 0.02;
      const t = r.timestampMs + c.offset;

      const lms: Landmark[] = [];
      if (r.landmarks.length >= LANDMARK_COUNT * 5) {
        for (let i = 0; i < LANDMARK_COUNT; i++) {
          const o = i * 5;
          const x = r.landmarks[o];
          lms.push({
            x: r.mirrored ? 1 - x : x,
            y: r.landmarks[o + 1],
            z: r.landmarks[o + 2],
            visibility: r.landmarks[o + 3],
            presence: r.landmarks[o + 4],
          });
        }
      }
      onPoseRef.current({ t, width: r.width, height: r.height, landmarks: lms });

      // Performance tracking and automatic downgrade.
      const p = perf.current;
      if (p.since === 0) p.since = now;
      p.frames += 1;
      p.inf += r.inferenceMs;
      if (now - p.since >= 1000) {
        const avgInf = p.inf / p.frames;
        setStats({ fps: (p.frames * 1000) / (now - p.since), inferenceMs: avgInf, delegate: landmarker?.activeDelegate ?? '', model });
        p.slowStreak = avgInf > SLOW_MS ? p.slowStreak + 1 : 0;
        if (opts.modelPreference === 'auto' && model === 'full' && p.slowStreak >= 3) {
          p.slowStreak = 0;
          void load('lite', true);
        }
        p.frames = 0;
        p.inf = 0;
        p.since = now;
      }
    },
    [landmarker, load, model, opts.modelPreference],
  );

  // Stable across renders: VisionCamera re-installs the frame callback on the
  // camera thread whenever this function's identity changes.
  const onFrame = useCallback(
    (frame: Frame) => {
      'worklet';
      try {
        if (landmarker != null) {
          const r = landmarker.detect(frame);
          if (r !== undefined) scheduleOnRN(handleResult, r);
        }
      } catch {
        // Never let an exception escape a frame callback (it can crash iOS release builds).
      } finally {
        frame.dispose();
      }
    },
    [landmarker, handleResult],
  );

  const frameOutput = useFrameOutput({
    // MediaPipe wants RGB(A)/BGRA; converting in the camera pipeline is cheapest.
    pixelFormat: 'rgb',
    targetResolution: CommonResolutions.HD_16_9,
    dropFramesWhileBusy: true,
    onFrame,
    onFrameDropped() {
      // Expected while the model is busy; counted implicitly through fps.
    },
  });

  const reload = useCallback(
    (m: PoseModel) => {
      setStatus('loading');
      setError(null);
      return load(m);
    },
    [load],
  );

  return { frameOutput, status, error, model, stats, retry: () => reload(model), useLite: () => reload('lite') };
}
