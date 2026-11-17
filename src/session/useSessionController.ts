import Constants from 'expo-constants';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AppState, NativeModules, Platform } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import type { EngineConfig } from '@/engine/config';
import { sessionConfig, sessionOverrides } from './sessionConfig';
import { Recorder } from '@/engine/recording';
import { PushupSession, type Cue, type SessionSummary } from '@/engine/session';
import type { DepthProbe } from '@/engine/reality';
import { EXERCISES } from '@/engine/exercises';
import { LM, type PhoneAttitude, type PoseSample } from '@/engine/types';
import type { Settings } from '@/storage/settings';
import { EMPTY_OVERLAY, type OverlayData } from '@/ui/SkeletonOverlay';
import { Coach, tapLight, tapSuccess } from './coach';
import { cueBanner, cueSpeech, type Copy } from './copy';
import { saveRecording } from './recordings';
import { createSnapshotStore, type SnapshotStore } from './snapshotStore';

const CHAIN = {
  left: [LM.leftShoulder, LM.leftElbow, LM.leftWrist, LM.leftHip, LM.leftKnee, LM.leftAnkle, LM.leftEar],
  right: [LM.rightShoulder, LM.rightElbow, LM.rightWrist, LM.rightHip, LM.rightKnee, LM.rightAnkle, LM.rightEar],
  /** Front view: the other arm and the far shoulder, after the left chain (indices 7–10). */
  front: [
    LM.leftShoulder,
    LM.leftElbow,
    LM.leftWrist,
    LM.leftHip,
    LM.leftKnee,
    LM.leftAnkle,
    LM.leftEar,
    LM.rightShoulder,
    LM.rightElbow,
    LM.rightWrist,
    LM.rightHip,
  ],
};

export type Banner = Copy & { tone: 'good' | 'cue' | 'fault'; id: number };

export interface Controller {
  /** Live engine state for display; subscribe with `useSnapshot`. */
  store: SnapshotStore;
  /** The thresholds this set runs with (depends on difficulty). */
  config: EngineConfig;
  /** One entry per counted rep: true = clean. */
  repMarks: boolean[];
  banner: Banner | null;
  overlay: ReturnType<typeof useSharedValue<OverlayData>>;
  onPose: (s: PoseSample) => void;
  onAttitude: (a: PhoneAttitude) => void;
  /** Depth readings at the body (iPhone), for the real-person check. */
  onDepth: (p: DepthProbe) => void;
  confirmPhone: () => void;
  end: () => SessionSummary;
  /** Wall-clock time when counting started, for saving history. */
  wallStart: () => number;
  saveTuningRecording: (model: string) => Promise<void>;
  /** Camera was interrupted (another app, system pressure). */
  interrupt: () => void;
  resume: () => void;
}

/**
 * Owns one push-up session for the lifetime of the session screen and wires
 * it to the outside world: camera frames, motion sensor, timers, app
 * background/foreground, voice coach, overlay and recorder.
 */
export function useSessionController(settings: Settings, onEnded: (s: SessionSummary) => void): Controller {
  const session = useMemo(
    () =>
      new PushupSession({
        config: sessionConfig(settings),
        exercise: settings.exercise,
        targetReps: settings.targetReps > 0 ? settings.targetReps : null,
        targetHoldMs: settings.targetHoldSec > 0 ? settings.targetHoldSec * 1000 : null,
        difficulty: settings.difficulty,
      }),
    // A session is created once per screen; settings changes apply to the next set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const coach = useMemo(() => new Coach(settings.voice), [settings.voice]);
  const [initialRecorder] = useState(() => (settings.recordForTuning ? new Recorder() : null));
  const recorder = useRef<Recorder | null>(initialRecorder);
  // The app going to background and the camera being interrupted are separate
  // causes; resume only once both have cleared, or one would undo the other.
  const away = useRef({ app: false, camera: false });
  const store = useMemo(() => createSnapshotStore(session), [session]);
  const [repMarks, setRepMarks] = useState<boolean[]>([]);
  const [banner, setBanner] = useState<Banner | null>(null);
  const overlay = useSharedValue<OverlayData>(EMPTY_OVERLAY);
  const countingStartedWall = useRef<number | null>(null);
  const onEndedRef = useRef(onEnded);
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settingsRef = useRef(settings);
  useLayoutEffect(() => {
    onEndedRef.current = onEnded;
    settingsRef.current = settings;
  });

  const showBanner = useCallback((b: Copy & { tone: Banner['tone'] }) => {
    setBanner({ ...b, id: Date.now() });
    if (bannerTimer.current) clearTimeout(bannerTimer.current);
    bannerTimer.current = setTimeout(() => setBanner(null), 2200);
  }, []);

  // Engine events → voice, banners, rep marks, end.
  useEffect(() => {
    const off = session.subscribe((e) => {
      if (e.type === 'cue') {
        handleCue(e.cue);
      } else if (e.type === 'rep') {
        setRepMarks((m) => [...m, e.rep.clean]);
      } else if (e.type === 'revoke') {
        setRepMarks((m) => m.slice(0, Math.max(0, m.length - e.reps)));
      } else if (e.type === 'phase') {
        if (e.phase === 'body-check') tapSuccess();
        if (e.phase === 'counting' && countingStartedWall.current === null) countingStartedWall.current = Date.now();
        store.refresh();
      } else if (e.type === 'ended') {
        store.refresh();
        onEndedRef.current(e.summary);
      }
    });
    function handleCue(cue: Cue) {
      const st = settingsRef.current;
      const speech = cueSpeech(cue, {
        countAloud: st.countAloud,
        guided: st.experience !== 'quick',
        orientation: st.orientation,
        exercise: session.exercise,
        view: session.cfg.view,
      });
      if (speech) coach.say(speech.text, speech.priority);
      const b = cueBanner(cue, session.exercise);
      if (b) showBanner(b);
    }
    return () => {
      off();
    };
  }, [session, coach, showBanner, store]);

  // Timers: engine timeouts and a 10 Hz UI snapshot.
  useEffect(() => {
    const tick = setInterval(() => session.tick(performance.now()), 250);
    const ui = setInterval(() => store.refresh(), 100);
    // Development builds only: one line a second in the Metro terminal with what
    // the engine sees, for tuning on a real phone. Stripped from release builds.
    const diag = __DEV__ ? setInterval(() => sendDiagnostics(diagnosticLine(session)), 1000) : null;
    return () => {
      clearInterval(tick);
      clearInterval(ui);
      if (diag) clearInterval(diag);
    };
  }, [session, store]);

  // Background / foreground: pause and require a fresh plank.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      const t = performance.now();
      const a = away.current;
      if (s === 'active') {
        if (!a.app) return;
        a.app = false;
        if (a.camera) return;
        session.resumeFromInterrupt(t);
        recorder.current?.resume(t);
      } else {
        const wasAway = a.app || a.camera;
        a.app = true;
        if (wasAway) return;
        session.interrupt(t);
        recorder.current?.interrupt(t);
      }
    });
    return () => sub.remove();
  }, [session]);

  useEffect(
    () => () => {
      // After a normal end, let the closing line ("Target reached…") finish
      // over the summary screen; otherwise the set was abandoned, so go quiet.
      if (session.currentPhase !== 'ended') coach.stop();
      if (bannerTimer.current) clearTimeout(bannerTimer.current);
    },
    [coach, session],
  );

  const onPose = useCallback(
    (s: PoseSample) => {
      session.pushPose(s);
      recorder.current?.pose(s);
      const tracked = session.lastTracked;
      const side = session.currentSide;
      if (!tracked || !side || !tracked.detected) {
        const cur = overlay.get();
        if (cur.visible) overlay.set({ ...cur, visible: false });
        return;
      }
      const pts: number[] = [];
      const front = session.cfg.view === 'front' && EXERCISES[session.exercise].frontView;
      for (const i of CHAIN[front ? 'front' : side]) {
        if (tracked.vis[i] > 0) pts.push(tracked.points[i].x / tracked.width, tracked.points[i].y / tracked.height);
        else pts.push(NaN, NaN);
      }
      overlay.set({ frameW: tracked.width, frameH: tracked.height, pts, bodyState: session.bodyState, visible: true, front });
    },
    [session, overlay],
  );

  const onAttitude = useCallback(
    (a: PhoneAttitude) => {
      session.pushAttitude(a);
      recorder.current?.phone(a);
    },
    [session],
  );

  const onDepth = useCallback((p: DepthProbe) => session.pushDepth(p), [session]);

  const confirmPhone = useCallback(() => {
    tapLight();
    recorder.current?.manualPhone(performance.now());
    session.confirmPhoneManually();
    store.refresh();
  }, [session, store]);

  const end = useCallback(() => session.end('user'), [session]);

  const saveTuningRecording = useCallback(async (model: string) => {
    const r = recorder.current;
    if (!r) return;
    recorder.current = null;
    const st = settingsRef.current;
    await saveRecording(r.finish({ platform: Platform.OS, model, config: sessionOverrides(st), exercise: st.exercise }));
  }, []);

  return {
    store,
    config: session.cfg,
    repMarks,
    banner,
    overlay,
    onPose,
    onAttitude,
    onDepth,
    confirmPhone,
    end,
    wallStart: () => countingStartedWall.current ?? Date.now(),
    saveTuningRecording,
    interrupt: () => {
      const t = performance.now();
      const a = away.current;
      const wasAway = a.app || a.camera;
      a.camera = true;
      if (wasAway) return;
      session.interrupt(t);
      recorder.current?.interrupt(t);
    },
    resume: () => {
      const t = performance.now();
      const a = away.current;
      if (!a.camera) return;
      a.camera = false;
      if (a.app) return;
      session.resumeFromInterrupt(t);
      recorder.current?.resume(t);
    },
  };
}

/** Compact one-line view of the engine state, for the Metro log on a real device. */
function diagnosticLine(session: PushupSession): string {
  const s = session.snapshot();
  const m = s.metrics;
  const r = (v: number | null | undefined) => (v === null || v === undefined ? '-' : Math.round(v));
  const pl = s.placement;
  return [
    '[trueline]',
    s.phase === 'paused' ? `paused(${s.pauseReason})` : s.phase,
    `framing=${s.framing.ok ? 'ok' : s.framing.issue}${s.framing.hint ? `(${s.framing.hint})` : ''}`,
    `vis=${s.framing.meanVisibility.toFixed(2)}`,
    `plank=${s.plankIssues.join(',') || 'ok'}`,
    `hold=${Math.round(s.plankProgress * 100)}%`,
    `tilt=${r(m?.trunkTiltDeg)}`,
    `elbow=${r(m?.elbowDeg)}`,
    `line=${r(m?.bodyLineDeg)}`,
    `knee=${r(m?.kneeDeg)}`,
    // Shoulder height above the wrist in torso lengths: positive when the image is upright.
    `sh=${m?.shoulderHeight == null ? '-' : m.shoulderHeight.toFixed(2)}`,
    `side=${s.side ?? '-'}`,
    `phone=${r(s.phone.rollDeg)}/${r(s.phone.pitchDeg)}${s.phoneConfirmedManually ? '(skipped)' : ''}`,
    pl
      ? `frame=${pl.frameW}x${pl.frameH} box=${pl.box.x0.toFixed(2)},${pl.box.y0.toFixed(2)}-${pl.box.x1.toFixed(2)},${pl.box.y1.toFixed(2)} head=${pl.headSide}`
      : 'nobody',
    s.hold
      ? `hold=${(s.hold.goodMs / 1000).toFixed(1)}s/${s.hold.state}${s.hold.fault ? `(${s.hold.fault})` : ''} ${s.hold.variant} hip=${m?.hipOffset == null ? '-' : m.hipOffset.toFixed(2)} breaks=${s.hold.breaks}`
      : `reps=${s.reps}`,
    realityLine(session),
  ].join(' ');
}

/** Real-person check state for the diagnostics line: depth stand-out and torso size when measured. */
function realityLine(session: PushupSession): string {
  const d = session.realityDebug;
  const issue = session.snapshot().reality;
  const so = d.standOut === null ? '-' : d.standOut.toFixed(2);
  const tm = d.torsoM === null ? '-' : d.torsoM.toFixed(2);
  return `real=${issue ?? 'ok'}(standout ${so}m torso ${tm}m)`;
}

/**
 * Dev builds only: post the line to scripts/diag-server.mjs on the Mac that
 * serves the bundle (React Native no longer streams console.log to Metro).
 * Fire and forget; nothing happens if the receiver is not running.
 */
function sendDiagnostics(line: string): void {
  const host = devHost();
  if (!host) return;
  fetch(`http://${host}:8099/`, { method: 'POST', body: line }).catch(() => {});
}

/** The Mac serving the JS bundle (dev builds load it over Wi-Fi). */
function devHost(): string | null {
  const fromConfig = Constants.expoConfig?.hostUri?.split(':')[0];
  if (fromConfig) return fromConfig;
  const scriptURL: unknown = NativeModules.SourceCode?.getConstants?.().scriptURL ?? NativeModules.SourceCode?.scriptURL;
  const m = typeof scriptURL === 'string' ? /^https?:\/\/([^/:]+)/.exec(scriptURL) : null;
  return m ? m[1] : null;
}
