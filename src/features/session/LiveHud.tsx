import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import type { SessionSnapshot } from '@/engine/session';
import { formatDuration, pauseCopy } from '@/session/copy';
import type { Banner } from '@/session/useSessionController';
import { DepthGauge } from '@/ui/DepthGauge';
import { LineGauge } from '@/ui/LineGauge';
import { Body, Button, Display, Label, Mono } from '@/ui/primitives';
import { Tally } from '@/ui/Tally';
import { color, radius, space, type } from '@/ui/theme';

/** The giant rep counter column, readable from across a room. */
export function CountColumn({ snap, repMarks, compact }: { snap: SessionSnapshot; repMarks: boolean[]; compact: boolean }) {
  const pop = useSharedValue(1);
  useEffect(() => {
    if (snap.reps > 0) pop.value = withSequence(withTiming(1.12, { duration: 90 }), withTiming(1, { duration: 220 }));
  }, [snap.reps, pop]);
  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));
  const lastClean = snap.lastRep?.clean ?? true;
  const size = compact ? 120 : type.liveCount;

  return (
    <View style={styles.count}>
      <Label>{snap.targetReps ? `Reps · target ${snap.targetReps}` : 'Reps'}</Label>
      <Animated.View style={popStyle}>
        <Display
          size={size}
          tone={snap.reps > 0 && !lastClean ? 'cue' : 'chalk'}
          style={{ fontFamily: 'BigShouldersDisplay_900Black' }}
          accessibilityLabel={`${snap.reps} reps`}
        >
          {snap.reps}
        </Display>
      </Animated.View>
      <View style={styles.subRow}>
        <Mono tone="good">{`${snap.cleanReps} clean`}</Mono>
        <Mono tone="muted">{formatDuration(snap.elapsedMs)}</Mono>
      </View>
      <Tally reps={repMarks} height={compact ? 22 : 28} maxGroups={compact ? 6 : 8} />
    </View>
  );
}

/**
 * Plank: the giant clock. It shows time in good form, and changes colour with
 * the hold: chalk running, amber slipping, red stopped.
 */
export function TimerColumn({ snap, compact }: { snap: SessionSnapshot; compact: boolean }) {
  const h = snap.hold;
  const goodMs = h?.goodMs ?? 0;
  const target = snap.targetHoldMs;
  const tone = h?.state === 'broken' ? 'fault' : h?.state === 'warning' ? 'cue' : 'chalk';
  const size = compact ? 104 : type.liveCount * 0.82;
  const breaks = h?.breaks ?? 0;
  return (
    <View style={styles.count}>
      <Label>{target ? `Plank · target ${formatDuration(target)}` : 'Plank'}</Label>
      <Display
        size={size}
        tone={tone}
        style={{ fontFamily: 'BigShouldersDisplay_900Black', fontVariant: ['tabular-nums'] }}
        accessibilityLabel={`${Math.floor(goodMs / 1000)} seconds in good form`}
      >
        {formatDuration(goodMs)}
      </Display>
      {target ? (
        <View style={styles.progress}>
          <View style={[styles.progressFill, { width: `${Math.min(100, (goodMs / target) * 100)}%` }]} />
        </View>
      ) : null}
      <View style={styles.subRow}>
        <Mono tone={h?.state === 'broken' ? 'fault' : h?.state === 'warning' ? 'cue' : 'good'}>
          {h?.state === 'broken' ? 'clock stopped' : h?.state === 'warning' ? 'form slipping' : 'good form'}
        </Mono>
        <Mono tone="muted">{`${h?.variant === 'forearm' ? 'forearm' : 'high'} · ${breaks} ${breaks === 1 ? 'break' : 'breaks'}`}</Mono>
      </View>
    </View>
  );
}

/** Plank: the hips meter beside the clock. */
export function LineColumn({ snap, warnAt }: { snap: SessionSnapshot; warnAt: number }) {
  return (
    <View style={styles.depthCol}>
      <LineGauge line={snap.phase === 'counting' ? (snap.hold?.line ?? null) : null} height={200} warnAt={warnAt} />
      {snap.metrics?.bodyLineDeg != null && <Mono tone="muted">{`${Math.round(snap.metrics.bodyLineDeg)}°`}</Mono>}
    </View>
  );
}

/** Big coaching banner after a rep, a miss, or a fault. */
export function CueBanner({ banner, detailed = true }: { banner: Banner | null; detailed?: boolean }) {
  const y = useSharedValue(0);
  useEffect(() => {
    if (banner) y.value = withSequence(withTiming(-6, { duration: 80 }), withTiming(0, { duration: 160 }));
  }, [banner, y]);
  const s = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  if (!banner) return null;
  const tone = banner.tone === 'good' ? color.good : banner.tone === 'fault' ? color.fault : color.cue;
  return (
    <Animated.View style={[styles.banner, { borderLeftColor: tone }, s]} accessibilityLiveRegion="polite">
      <Display size={type.liveCue} style={{ color: tone }}>
        {banner.short}
      </Display>
      {detailed && (
        <Body tone="chalk" size={15}>
          {banner.detail}
        </Body>
      )}
    </Animated.View>
  );
}

export function DepthColumn({ snap }: { snap: SessionSnapshot }) {
  return (
    <View style={styles.depthCol}>
      <DepthGauge depth={snap.phase === 'counting' ? snap.depth : null} height={200} />
      {snap.metrics?.elbowDeg != null && <Mono tone="muted">{`${Math.round(snap.metrics.elbowDeg)}°`}</Mono>}
    </View>
  );
}

export function PausedPanel({ snap, onEnd }: { snap: SessionSnapshot; onEnd: () => void }) {
  const c = pauseCopy(snap.pauseReason ?? 'lost-tracking', snap.exercise);
  const saved = snap.exercise === 'plank' ? `${formatDuration(snap.hold?.goodMs ?? 0)} saved` : `${snap.reps} reps saved`;
  // A screen instead of a person is an alert, not a rest: red, and stays up until a real person is back.
  const notReal = snap.pauseReason === 'not-real';
  return (
    <View style={[styles.paused, notReal && styles.alert]} accessibilityRole={notReal ? 'alert' : undefined}>
      <Label tone={notReal ? 'fault' : 'cue'}>{notReal ? `Not counted · ${saved}` : `Paused · ${saved}`}</Label>
      <Display size={type.liveCue} tone={notReal ? 'fault' : 'chalk'}>
        {c.short}
      </Display>
      <Body tone="muted" style={{ maxWidth: 420 }}>
        {c.detail}
      </Body>
      <View style={styles.hold}>
        <View style={[styles.holdFill, { width: `${Math.round(snap.plankProgress * 100)}%` }]} />
      </View>
      <Button label="Finish set" variant="ghost" onPress={onEnd} style={{ alignSelf: 'flex-start' }} />
    </View>
  );
}

/** Live tracking numbers, shown when "Show tracking details" is on. */
export function TrackingDebug({
  snap,
  stats,
}: {
  snap: SessionSnapshot;
  stats: { fps: number; inferenceMs: number; delegate: string; model: string } | null;
}) {
  const m = snap.metrics;
  const f = (v: number | null | undefined, d = 0) => (v == null ? '—' : v.toFixed(d));
  return (
    <View style={styles.debug} pointerEvents="none">
      <Mono size={11} tone="muted">
        {`${stats ? `${stats.fps.toFixed(0)}fps ${stats.inferenceMs.toFixed(0)}ms ${stats.model}/${stats.delegate}` : 'no stats'} · ${snap.phase}/${snap.repPhase ?? '-'} · side ${snap.side ?? '-'}`}
      </Mono>
      <Mono size={11} tone="muted">
        {`elbow ${f(m?.elbowDeg)} line ${f(m?.bodyLineDeg)} hip ${f(m?.hipOffset, 2)} knee ${f(m?.kneeDeg)} tilt ${f(m?.trunkTiltDeg)} sh ${f(m?.shoulderHeight, 2)} vis ${snap.framing.meanVisibility.toFixed(2)}`}
      </Mono>
      {snap.hold && (
        <Mono size={11} tone="muted">
          {`hold ${(snap.hold.goodMs / 1000).toFixed(1)}/${(snap.hold.totalMs / 1000).toFixed(1)}s ${snap.hold.state}${snap.hold.fault ? ` (${snap.hold.fault})` : ''} ${snap.hold.variant} stack ${f(m?.elbowStack, 2)} rise ${f(m?.forearmRise, 2)}`}
        </Mono>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  count: { gap: 6, alignItems: 'flex-start' },
  subRow: { flexDirection: 'row', gap: space.lg, marginBottom: 6 },
  banner: {
    backgroundColor: color.scrimStrong,
    borderLeftWidth: 6,
    borderRadius: radius.md,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    gap: 2,
    maxWidth: 520,
  },
  depthCol: { alignItems: 'center', gap: space.sm },
  progress: { alignSelf: 'stretch', height: 6, borderRadius: 3, backgroundColor: color.raised, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: color.vial },
  paused: {
    gap: space.md,
    padding: space.xl,
    borderRadius: radius.lg,
    backgroundColor: color.scrimStrong,
    borderWidth: 1,
    borderColor: color.cue,
    maxWidth: 520,
  },
  alert: { borderColor: color.fault, borderWidth: 2, backgroundColor: color.scrimStrong },
  hold: { height: 8, borderRadius: 4, backgroundColor: color.raised, overflow: 'hidden' },
  holdFill: { height: '100%', backgroundColor: color.vial },
  debug: { position: 'absolute', left: 12, bottom: 8, right: 12, gap: 2 },
});
