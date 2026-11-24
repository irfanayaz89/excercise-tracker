import { useKeepAwake } from 'expo-keep-awake';
import { router, useFocusEffect, useLocalSearchParams, usePreventRemove } from 'expo-router';
import { creditSet, endFocusNow, getScreenTime, startFocusNow } from '@/screentime/store';
import { focusMinutes } from '@/screentime/focus';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform, StyleSheet, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Camera, useCameraDevice, useCameraDevices, useCameraPermission, type CameraDevice } from 'react-native-vision-camera';
import { usePoseStream, type PoseStats } from '@/camera/usePoseStream';
import type { SessionSnapshot, SessionSummary } from '@/engine/session';
import type { PhoneOrientation } from '@/engine/types';
import { Gate, openSettings } from '@/features/session/Gate';
import { demoScenario, useDemoFeed, type DemoScenario } from '@/features/session/useDemoFeed';
import { CountColumn, CueBanner, DepthColumn, LineColumn, PausedPanel, TimerColumn, TrackingDebug } from '@/features/session/LiveHud';
import { AlignmentGuide } from '@/features/session/AlignmentGuide';
import { BodyPanel, PhonePanel } from '@/features/session/SetupPanels';
import { usePhoneAttitude } from '@/sensors/usePhoneAttitude';
import { setLastSummary } from '@/session/lastSummary';
import { useSnapshot } from '@/session/snapshotStore';
import { useSessionController, type Controller } from '@/session/useSessionController';
import { saveSession } from '@/storage/history';
import { useSettings, type Settings } from '@/storage/settings';
import { PlankGhost } from '@/ui/Diagrams';
import { Button, Label } from '@/ui/primitives';
import { SkeletonOverlay } from '@/ui/SkeletonOverlay';
import { color, radius, space } from '@/ui/theme';
import { isExercise, isTimed, viewFor } from '@/engine/exercises';

/** Something worth saving: a counted rep, or a second of plank in good form. */
function hasWork(s: SessionSnapshot): boolean {
  return isTimed(s.exercise) ? (s.hold?.goodMs ?? 0) >= 1000 : s.reps > 0;
}

/** Back if there is somewhere to go back to (not after a cold-start deep link), else home. */
function goBack() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

export default function SessionScreen() {
  // One set uses the settings it started with; changes apply to the next set.
  const [liveSettings] = useSettings();
  const params = useLocalSearchParams<{ demo?: string; ex?: string; level?: string; view?: string }>();
  // demo=<scenario> plays a scripted synthetic set (see useDemoFeed); a demo can
  // also pick the exercise, level and camera view (`ex=plank`, `level=hard`,
  // `view=front`) without changing Settings.
  const scenario = demoScenario(params.demo);
  const demo = scenario !== null;
  const [settings] = useState<Settings>(() => {
    if (!demo) return liveSettings;
    const s: Settings = {
      ...liveSettings,
      ...(isExercise(params.ex) ? { exercise: params.ex } : {}),
      ...(params.level === 'easy' || params.level === 'medium' || params.level === 'hard' ? { difficulty: params.level } : {}),
    };
    // A demo's view override applies to the exercise it plays.
    // (front only applies where the exercise supports it; see viewFor)
    return params.view === 'front' || params.view === 'side' ? { ...s, views: { ...s.views, [s.exercise]: params.view } } : s;
  });
  const permission = useCameraPermission();
  const preferred = useCameraDevice(settings.camera);
  const other = useCameraDevice(settings.camera === 'front' ? 'back' : 'front');
  // Real-person check: on iPhone, prefer the same-side camera that can also see
  // depth (the front TrueDepth camera, or the back dual camera).
  const devices = useCameraDevices();
  const depthDevice =
    settings.realPersonCheck && Platform.OS === 'ios'
      ? devices.find((d) => d.position === settings.camera && d.mediaTypes.includes('depth'))
      : undefined;
  const device = depthDevice ?? preferred ?? other;
  useKeepAwake();

  // Lock the screen to the picked orientation only while this screen is in
  // front, so a screen opened on top (or left behind in the stack) is never
  // rotated; back to portrait when it loses focus. iOS may ignore the lock for
  // resizable apps, so the layout below adapts to the window's real shape.
  const orientation = settings.orientation;
  useFocusEffect(
    useCallback(() => {
      const lock = orientation === 'portrait' ? ScreenOrientation.OrientationLock.PORTRAIT_UP : ScreenOrientation.OrientationLock.LANDSCAPE;
      void ScreenOrientation.lockAsync(lock).catch(() => {});
      return () => {
        void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
      };
    }, [orientation]),
  );

  if (demo)
    return (
      <LiveSession
        settings={settings}
        device={device ?? null}
        usingFallbackCamera={false}
        withDepth={false}
        demo
        scenario={scenario ?? 'basic'}
      />
    );
  if (!permission.hasPermission) {
    return permission.canRequestPermission ? (
      <Gate
        eyebrow="Camera"
        title="Let Trueline see you"
        body="The camera watches your body position to count push-ups and check your form. Everything runs on this phone; no video is saved or sent anywhere."
        primary={{ label: 'Allow camera', onPress: () => void permission.requestPermission() }}
        secondary={{ label: 'Not now', onPress: goBack }}
      />
    ) : (
      <Gate
        eyebrow="Camera is off"
        title="Camera access needed"
        body="Camera access was turned off for Trueline. Turn it on in Settings to count push-ups."
        primary={{ label: 'Open Settings', onPress: openSettings }}
        secondary={{ label: 'Back', onPress: goBack }}
      />
    );
  }
  if (!device) {
    return (
      <Gate
        eyebrow="No camera"
        title="No camera found"
        body="This device does not report a usable camera."
        primary={{ label: 'Back', onPress: goBack }}
      />
    );
  }
  return (
    <LiveSession
      settings={settings}
      device={device}
      usingFallbackCamera={!preferred && !depthDevice}
      withDepth={depthDevice !== undefined && device === depthDevice}
    />
  );
}

function LiveSession({
  settings,
  device,
  usingFallbackCamera,
  withDepth,
  demo = false,
  scenario = 'basic',
}: {
  settings: Settings;
  device: CameraDevice | null;
  usingFallbackCamera: boolean;
  /** The camera can deliver depth for the real-person check. */
  withDepth: boolean;
  demo?: boolean;
  scenario?: DemoScenario;
}) {
  const { width: winW, height: winH } = useWindowDimensions();
  const landscape = winW > winH;
  const [stage, setStage] = useState({ w: winW, h: winH });
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraKey, setCameraKey] = useState(0);
  const endedRef = useRef(false);
  /** The set reached its end (summary shown); otherwise leaving the screen abandons any workout focus. */
  const completedRef = useRef(false);
  const modelRef = useRef('full');
  const ctrlRef = useRef<Controller | null>(null);
  /** The HUD's finish logic (confirm, then save), reused for the Android back button. */
  const requestEndRef = useRef<(() => void) | null>(null);
  const allowLeaveRef = useRef<(() => void) | null>(null);

  // Android back (and any other navigation away) must never silently throw a
  // set away: with reps on the board it goes through the same confirm-and-save
  // flow as the Finish button. With no reps, it just leaves.
  const [guarded, setGuarded] = useState(true);
  const allowLeave = usePreventRemove(guarded, ({ repeat }) => {
    const snap = ctrlRef.current?.store.get();
    if (endedRef.current || !snap || !hasWork(snap)) {
      endedRef.current = true;
      allowLeaveRef.current?.();
      repeat();
      return;
    }
    // No HUD on screen (e.g. "Camera stopped"): there is nothing to confirm on,
    // so finish and save the set; onEnded moves on to the summary.
    if (!requestEndRef.current) {
      ctrlRef.current?.end();
      return;
    }
    requestEndRef.current();
  });
  useLayoutEffect(() => {
    // Lift the guard and keep the hook's prop in sync with it.
    allowLeaveRef.current = () => {
      setGuarded(false);
      allowLeave();
    };
  });

  const onEnded = useCallback(
    (summary: SessionSummary) => {
      const c = ctrlRef.current;
      if (endedRef.current || !c) return;
      endedRef.current = true;
      const wallStart = c.wallStart();
      // A demo set is synthetic: show its summary but keep it out of your history.
      const id = demo ? null : saveSession(summary, wallStart);
      // Only a saved, real set earns screen time (and only once: the id is its key).
      let earned: { minutes: number; capped: boolean } | null = null;
      try {
        const res = id ? creditSet(summary, id, demo) : null;
        if (res && (res.minutes > 0 || res.reason === 'cap-reached')) earned = { minutes: res.minutes, capped: res.capped };
      } catch {
        // Screen time must never get in the way of saving a set.
      }
      completedRef.current = true;
      let focus: { heldMin: number; continuesUntil: number | null } | null = null;
      try {
        if (!demo && getScreenTime().focus) {
          const res = endFocusNow('completed');
          focus = res.ended ? { heldMin: focusMinutes(res.record), continuesUntil: null } : res.focus ? { heldMin: 0, continuesUntil: res.focus.until } : null;
        }
      } catch {
        // Never let screen time get in the way of the summary.
      }
      setLastSummary({ summary, wallStart, savedId: id, demo, earned, focus });
      void c.saveTuningRecording(modelRef.current);
      allowLeaveRef.current?.();
      router.replace({ pathname: '/summary/[id]', params: { id: id ?? 'last' } });
    },
    [demo],
  );

  const ctrl = useSessionController(settings, onEnded);
  const pose = usePoseStream({ modelPreference: settings.model, onPose: ctrl.onPose, depth: withDepth, onDepth: ctrl.onDepth });
  const motion = usePhoneAttitude(!demo, settings.orientation, ctrl.onAttitude);
  useDemoFeed(
    demo,
    settings.orientation === 'portrait',
    ctrl.onPose,
    ctrl.onAttitude,
    scenario,
    settings.exercise,
    ctrl.onDepth,
    viewFor(settings.exercise, settings.views),
  );
  useLayoutEffect(() => {
    ctrlRef.current = ctrl;
    modelRef.current = pose.model;
  });

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setAppActive(s === 'active'));
    return () => sub.remove();
  }, []);

  // Workout focus: block the user's distracting apps while this set runs (if they turned it on).
  useEffect(() => {
    if (demo) return;
    try {
      const choice = getScreenTime().meta.focusChoice;
      if (choice !== null) startFocusNow(choice);
    } catch {
      // A set must start even if screen time can't.
    }
    return () => {
      // Left without finishing: a "for this set" focus ends (except in Strict); a timed one keeps going.
      if (!completedRef.current) {
        try {
          endFocusNow('abandoned');
        } catch {
          // Ignore: the phone still lifts the block at the focus end.
        }
      }
    };
  }, [demo]);

  const constraints = useMemo(() => [{ fps: 30 }], []);
  const onCameraError = useCallback(
    (e: Error) => {
      ctrl.interrupt();
      setCameraError(e.message || 'The camera reported an error.');
    },
    [ctrl],
  );
  const onInterruptStart = useCallback(() => ctrl.interrupt(), [ctrl]);
  const onInterruptEnd = useCallback(() => ctrl.resume(), [ctrl]);
  // Portrait frames are wider than a tall phone screen; "cover" would crop the
  // sides, which is exactly where the head and feet are. Show the whole frame.
  const fit = settings.orientation === 'portrait' ? 'contain' : 'cover';
  const onLayout = useCallback((e: LayoutChangeEvent) => setStage({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height }), []);
  const leave = useCallback(() => {
    endedRef.current = true;
    allowLeaveRef.current?.();
    goBack();
  }, []);

  if (pose.status === 'unsupported' && !demo) {
    return (
      <Gate
        eyebrow="Development build needed"
        title="Body tracking unavailable"
        body="This build does not include the pose tracking module. Install a development build (npx expo run:ios or run:android); Expo Go cannot run custom camera code."
        primary={{ label: 'Back', onPress: goBack }}
      />
    );
  }
  if (pose.status === 'error' && !demo) {
    return (
      <Gate
        eyebrow="Body tracker"
        title="Couldn’t start tracking"
        body={pose.error ?? 'The pose model failed to load.'}
        primary={{ label: 'Try again', onPress: () => void pose.retry() }}
        secondary={
          pose.model === 'full' ? { label: 'Use the light model', onPress: () => void pose.useLite() } : { label: 'Back', onPress: goBack }
        }
      />
    );
  }
  if (cameraError) {
    return (
      <Gate
        eyebrow="Camera"
        title="Camera stopped"
        body={cameraError}
        primary={{
          label: 'Restart camera',
          onPress: () => {
            setCameraError(null);
            setCameraKey((k) => k + 1);
            ctrl.resume();
          },
        }}
        secondary={{ label: 'Finish set', onPress: () => ctrl.end() }}
      />
    );
  }

  return (
    <View style={styles.root}>
      <View style={StyleSheet.absoluteFill} onLayout={onLayout}>
        {device && !demo ? (
          <Camera
            key={cameraKey}
            style={StyleSheet.absoluteFill}
            device={device}
            isActive={appActive}
            outputs={pose.outputs}
            onStarted={pose.onCameraStarted}
            constraints={constraints}
            resizeMode={fit}
            // Frames follow the locked screen, not the phone's physical angle,
            // so landmarks always match what is drawn.
            orientationSource="interface"
            // Explicit so frames and preview agree on both platforms (the default
            // 'auto' leaves Android frames unmirrored under a mirrored preview).
            mirrorMode={device.position === 'front' ? 'on' : 'off'}
            onError={onCameraError}
            onInterruptionStarted={onInterruptStart}
            onInterruptionEnded={onInterruptEnd}
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.demoFloor]} />
        )}
        <StageDecor ctrl={ctrl} width={stage.w} height={stage.h} fit={fit} landscape={landscape} />
        <SkeletonOverlay data={ctrl.overlay} width={stage.w} height={stage.h} fit={fit} />
      </View>
      <Hud
        ctrl={ctrl}
        landscape={landscape}
        guided={settings.experience !== 'quick'}
        allowSkip={settings.difficulty !== 'hard'}
        orientation={settings.orientation}
        demo={demo}
        loading={pose.status === 'loading' && !demo}
        usingFallbackCamera={usingFallbackCamera}
        motionUnavailable={motion === 'unavailable' || motion === 'denied'}
        showTracking={settings.showTracking}
        stats={pose.stats}
        onLeave={leave}
        requestEndRef={requestEndRef}
      />
    </View>
  );
}

/** Tint, plank ghost and alignment hints; re-renders on engine ticks without touching the camera. */
function StageDecor({
  ctrl,
  width,
  height,
  fit,
  landscape,
}: {
  ctrl: Controller;
  width: number;
  height: number;
  fit: 'cover' | 'contain';
  landscape: boolean;
}) {
  const snap = useSnapshot(ctrl.store);
  const insets = useSafeAreaInsets();
  // The outline only while nobody is found; once a body is seen, the live guide takes over.
  const showGhost = snap.phase === 'body-check' && !snap.framing.ok && !snap.placement;
  return (
    <>
      {/* Tint keeps chalk type legible over any room. */}
      <View
        style={[StyleSheet.absoluteFill, { backgroundColor: snap.phase === 'counting' ? 'rgba(8,20,23,0.28)' : color.scrim }]}
        pointerEvents="none"
      />
      {showGhost && (
        <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]} pointerEvents="none">
          <PlankGhost
            width={width * 0.78}
            height={width * 0.78 * 0.56}
            facing={snap.side === 'right' ? 'right' : 'left'}
            variant={
              snap.view === 'front'
                ? 'front'
                : snap.exercise === 'crunch'
                  ? 'crunch'
                  : snap.exercise === 'sidePlank'
                    ? 'side'
                    : isTimed(snap.exercise)
                      ? 'forearm'
                      : 'high'
            }
          />
        </View>
      )}
      <AlignmentGuide
        snap={snap}
        width={width}
        height={height}
        fit={fit}
        insetTop={insets.top + space.md}
        // Keep labels clear of the landscape side column (260 wide + margins).
        insetRight={landscape ? 260 + space.lg * 2 + insets.right : 0}
      />
    </>
  );
}

function Hud({
  ctrl,
  landscape,
  guided,
  allowSkip,
  orientation,
  demo,
  loading,
  usingFallbackCamera,
  motionUnavailable,
  showTracking,
  stats,
  onLeave,
  requestEndRef,
}: {
  ctrl: Controller;
  landscape: boolean;
  guided: boolean;
  /** Easy and Medium let the user skip the phone level check. */
  allowSkip: boolean;
  orientation: PhoneOrientation;
  demo: boolean;
  loading: boolean;
  usingFallbackCamera: boolean;
  motionUnavailable: boolean;
  showTracking: boolean;
  stats: PoseStats | null;
  onLeave: () => void;
  requestEndRef: React.RefObject<(() => void) | null>;
}) {
  const insets = useSafeAreaInsets();
  const snap = useSnapshot(ctrl.store);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const counting = snap.phase === 'counting';
  const plank = isTimed(snap.exercise);
  const worked = hasWork(snap);

  useEffect(() => {
    if (!confirmEnd) return;
    const t = setTimeout(() => setConfirmEnd(false), 3000);
    return () => clearTimeout(t);
  }, [confirmEnd]);

  const requestEnd = () => {
    // Nothing to save yet: leave straight away (same as the back button). Otherwise ask for a second tap.
    if (!worked) {
      onLeave();
      return;
    }
    if (!confirmEnd) {
      setConfirmEnd(true);
      return;
    }
    ctrl.end();
  };
  useLayoutEffect(() => {
    requestEndRef.current = requestEnd;
  });
  // Unmounted (camera error screen): the back button must not call a dead HUD.
  useEffect(
    () => () => {
      requestEndRef.current = null;
    },
    [requestEndRef],
  );

  return (
    <>
      <View
        style={[
          styles.hud,
          landscape ? styles.hudLandscape : styles.hudPortrait,
          {
            paddingTop: insets.top + space.md,
            paddingBottom: insets.bottom + space.md,
            paddingLeft: insets.left + space.lg,
            paddingRight: insets.right + space.lg,
          },
        ]}
        pointerEvents="box-none"
      >
        <View style={[styles.main, landscape && { flexDirection: 'row' }]} pointerEvents="box-none">
          {counting && landscape && (plank ? <LineColumn snap={snap} warnAt={ctrl.config.hold.warnRatio} /> : <DepthColumn snap={snap} />)}
          <View style={styles.mainBody} pointerEvents="box-none">
            {demo && <Label tone="vial">Demo set · synthetic body, no camera</Label>}
            {loading && <Label tone="vial">Starting body tracker…</Label>}
            {usingFallbackCamera && <Label tone="cue">Preferred camera unavailable, using the other one</Label>}
            {snap.phase === 'phone-setup' && (
              <PhonePanel
                snap={snap}
                onManual={ctrl.confirmPhone}
                motionUnavailable={motionUnavailable}
                orientation={orientation}
                guided={guided}
                showDiagram={guided && !landscape}
                allowSkip={allowSkip}
                toleranceDeg={ctrl.config.phone.maxRollDeg}
              />
            )}
            {snap.phase === 'body-check' && <BodyPanel snap={snap} orientation={orientation} guided={guided} config={ctrl.config} />}
            {snap.phase === 'paused' && <PausedPanel snap={snap} onEnd={() => ctrl.end()} />}
            {counting && <CueBanner banner={ctrl.banner} detailed={guided} />}
          </View>
        </View>

        <View style={[styles.side, landscape ? styles.sideLandscape : styles.sidePortrait]} pointerEvents="box-none">
          {(counting || worked) &&
            (plank ? (
              <TimerColumn snap={snap} compact={!landscape} />
            ) : (
              <CountColumn snap={snap} repMarks={ctrl.repMarks} compact={!landscape} />
            ))}
          <View style={{ flex: 1 }} />
          <Button
            label={confirmEnd ? 'Tap again to finish' : worked ? (plank ? 'Finish' : 'Finish set') : 'Close'}
            variant={confirmEnd ? 'danger' : 'quiet'}
            size="sm"
            onPress={requestEnd}
            style={{ alignSelf: landscape ? 'stretch' : 'flex-end' }}
          />
        </View>
      </View>
      {showTracking && <TrackingDebug snap={snap} stats={stats} />}
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  demoFloor: { backgroundColor: color.surface },
  hud: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  hudLandscape: { flexDirection: 'row' },
  hudPortrait: { flexDirection: 'column' },
  main: { flex: 1, gap: space.lg, alignItems: 'flex-end' },
  mainBody: { flex: 1, justifyContent: 'flex-end', gap: space.md, alignSelf: 'stretch' },
  side: { gap: space.md },
  sideLandscape: {
    width: 260,
    marginLeft: space.lg,
    padding: space.lg,
    borderRadius: radius.lg,
    backgroundColor: color.scrim,
  },
  sidePortrait: { flexDirection: 'row', alignItems: 'flex-end', marginTop: space.md },
});
