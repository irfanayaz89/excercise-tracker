import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { PlankIssue } from '@/engine/gates';
import type { SessionSnapshot } from '@/engine/session';
import type { PhoneOrientation } from '@/engine/types';
import type { EngineConfig } from '@/engine/config';
import { PLACEMENT, REALITY_COPY, SOFT_HINT_COPY, framingCopy, noRoomTip, phoneCopy, plankIssueCopy } from '@/session/copy';
import { SetupDiagram } from '@/ui/Diagrams';
import { LevelVial } from '@/ui/LevelVial';
import { Body, Button, Display, Label, Mono } from '@/ui/primitives';
import { color, radius, space, type } from '@/ui/theme';
import { isTimed } from '@/engine/exercises';

/** Step 1: get the phone standing level on the floor. */
export function PhonePanel({
  snap,
  onManual,
  motionUnavailable,
  orientation,
  guided,
  showDiagram,
  allowSkip = false,
  toleranceDeg = 5,
}: {
  snap: SessionSnapshot;
  onManual: () => void;
  motionUnavailable: boolean;
  orientation: PhoneOrientation;
  /** Guided shows the full explanation; quick shows only the headline and the vial. */
  guided: boolean;
  /** Placement sketch; only where there is room (portrait). */
  showDiagram: boolean;
  /** Offer "skip" so a phone that will not read level never blocks the set. */
  allowSkip?: boolean;
  /** Sideways tilt this difficulty accepts, drawn on the vial. */
  toleranceDeg?: number;
}) {
  const p = snap.phone;
  const noSensor = p.issue === 'no-sensor' || motionUnavailable;
  const copy = noSensor
    ? phoneCopy('no-sensor', orientation)
    : p.issue
      ? phoneCopy(p.issue, orientation)
      : { short: 'Hold still…', detail: 'Let the phone settle on the floor.' };
  return (
    <View style={styles.panel}>
      <StepTag n={1} of={3} label={`Place your phone · ${PLACEMENT[orientation].label.toLowerCase()}`} />
      <Display size={type.liveCue} tone={p.issue || noSensor ? 'chalk' : 'vial'}>
        {copy.short}
      </Display>
      {(guided || noSensor) && (
        <Body tone="muted" style={styles.detail}>
          {copy.detail}
        </Body>
      )}
      {showDiagram && <SetupDiagram width={260} orientation={orientation} exercise={snap.exercise} />}
      {!noSensor && <LevelVial rollDeg={p.rollDeg} pitchDeg={p.pitchDeg} toleranceDeg={toleranceDeg} steady={p.steadyProgress} />}
      {noSensor && <Button label="Phone is set" onPress={onManual} style={{ alignSelf: 'flex-start' }} />}
      {!noSensor && allowSkip && (
        <Button label="Looks fine, skip" variant="ghost" size="sm" onPress={onManual} style={{ alignSelf: 'flex-start' }} />
      )}
    </View>
  );
}

const CHECKS: { key: string; label: string; issues: PlankIssue[] }[] = [
  { key: 'down', label: 'In a plank', issues: ['get-down'] },
  { key: 'arms', label: 'Arms straight', issues: ['straighten-arms'] },
  { key: 'line', label: 'Body in one line', issues: ['hips-sagging', 'hips-high'] },
  { key: 'legs', label: 'Legs straight', issues: ['straighten-legs'] },
  { key: 'hands', label: 'Hands under shoulders', issues: ['hands-under-shoulders'] },
];

/** Side plank: on one side facing the phone, support arm under the shoulder. */
const SIDE_PLANK_CHECKS: { key: string; label: string; issues: PlankIssue[] }[] = [
  { key: 'down', label: 'Down on the floor', issues: ['get-down'] },
  { key: 'side', label: 'On your side, facing the phone', issues: ['roll-onto-side'] },
  { key: 'arms', label: 'Elbow or hand under your shoulder', issues: ['straighten-arms', 'elbows-under-shoulders'] },
  { key: 'line', label: 'Hips up, body in one line', issues: ['hips-sagging', 'hips-high'] },
  { key: 'legs', label: 'Legs straight', issues: ['straighten-legs'] },
];

/** Plank: arms straight or forearms down both work; hand position is not checked. */
const PLANK_CHECKS: { key: string; label: string; issues: PlankIssue[] }[] = [
  { key: 'down', label: 'In a plank', issues: ['get-down'] },
  { key: 'arms', label: 'Straight arms or forearms down', issues: ['straighten-arms', 'elbows-under-shoulders'] },
  { key: 'line', label: 'Body in one line', issues: ['hips-sagging', 'hips-high'] },
  { key: 'legs', label: 'Legs straight', issues: ['straighten-legs'] },
];

/** Step 2: whole body visible, then a valid plank held for a moment. */
export function BodyPanel({
  snap,
  orientation,
  guided,
  config,
}: {
  snap: SessionSnapshot;
  orientation: PhoneOrientation;
  guided: boolean;
  /** Only the checks this difficulty actually applies are listed. */
  config: EngineConfig;
}) {
  const plank = isTimed(snap.exercise);
  const checks = (snap.exercise === 'sidePlank' ? SIDE_PLANK_CHECKS : plank ? PLANK_CHECKS : CHECKS).filter(
    (c) =>
      (c.key !== 'line' || config.plank.checkHips) &&
      (c.key !== 'hands' || config.plank.checkHands) &&
      (c.key !== 'legs' || !config.allowKneeling),
  );
  const wholeBody = config.framing.requireFeet && config.framing.requireHead;
  const f = snap.framing;
  // Asked to fit the whole body for a while: offer the ways out (landscape, Easy).
  const noRoom = useStuck(config.framing.requireFeet && (f.issue === 'show-feet' || f.issue === 'move-back'), 6000);
  const framed = f.ok;
  const first = snap.plankIssues[0];
  const headline = snap.reality
    ? REALITY_COPY[snap.reality]
    : !framed && f.issue
      ? framingCopy(f.issue, orientation)
      : first
        ? plankIssueCopy(first, snap.exercise)
        : { short: 'Hold it…', detail: 'Starting as soon as you are steady.' };
  return (
    <View style={styles.panel}>
      <StepTag n={2} of={3} label={framed ? 'Get into position' : 'Get in frame'} />
      <Display size={type.liveCue} tone={snap.reality ? 'fault' : framed && !first ? 'vial' : 'chalk'}>
        {headline.short}
      </Display>
      {snap.reality && !guided && (
        <Body tone="muted" style={styles.detail}>
          {headline.detail}
        </Body>
      )}
      {guided && (
        <>
          <Body tone="muted" style={styles.detail}>
            {headline.detail}
          </Body>
          <View style={styles.checks}>
            <Check label={wholeBody ? 'Whole body in view' : 'Upper body in view'} state={framed ? 'ok' : 'pending'} />
            {checks.map((c) => (
              <Check
                key={c.key}
                label={c.label}
                state={!framed ? 'idle' : c.issues.some((i) => snap.plankIssues.includes(i)) ? 'pending' : 'ok'}
              />
            ))}
          </View>
        </>
      )}
      <HoldBar progress={snap.plankProgress} />
      {f.hint && SOFT_HINT_COPY[f.hint] && <Mono tone="cue">{SOFT_HINT_COPY[f.hint]}</Mono>}
      {noRoom && <Mono tone="cue">{noRoomTip(orientation)}</Mono>}
    </View>
  );
}

/** True once `active` has stayed true for `ms` without a break. */
function useStuck(active: boolean, ms: number): boolean {
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => setStuck(true), ms);
    return () => {
      clearTimeout(t);
      setStuck(false);
    };
  }, [active, ms]);
  return active && stuck;
}

function Check({ label, state }: { label: string; state: 'ok' | 'pending' | 'idle' }) {
  return (
    <View style={styles.check}>
      <View
        style={[
          styles.dot,
          state === 'ok' && { backgroundColor: color.good, borderColor: color.good },
          state === 'pending' && { borderColor: color.cue },
        ]}
      />
      <Body size={15} tone={state === 'idle' ? 'faint' : 'chalk'}>
        {label}
      </Body>
    </View>
  );
}

function HoldBar({ progress }: { progress: number }) {
  return (
    <View style={{ gap: 6 }}>
      <View style={styles.hold}>
        <View style={[styles.holdFill, { width: `${Math.round(progress * 100)}%` }]} />
      </View>
      <Label>{progress > 0 ? 'Hold steady' : 'Hold a plank to start'}</Label>
    </View>
  );
}

export function StepTag({ n, of, label }: { n: number; of: number; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Mono tone="vial">{`${n}/${of}`}</Mono>
      <Label>{label}</Label>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    gap: space.md,
    padding: space.xl,
    borderRadius: radius.lg,
    backgroundColor: color.scrimStrong,
    borderWidth: 1,
    borderColor: color.lineSoft,
    maxWidth: 520,
  },
  detail: { maxWidth: 440 },
  checks: { gap: 6, marginTop: 4 },
  check: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: color.faint },
  hold: { height: 8, borderRadius: 4, backgroundColor: color.raised, overflow: 'hidden' },
  holdFill: { height: '100%', backgroundColor: color.vial },
});
