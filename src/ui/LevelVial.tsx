import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { Label, Mono } from './primitives';
import { color, radius } from './theme';

const W = 280;
const H = 44;
const BUBBLE = 34;
/** Degrees of roll that push the bubble to the end of the vial (at least). */
const MIN_RANGE_DEG = 15;

interface Props {
  rollDeg: number | null;
  pitchDeg: number | null;
  /** Allowed roll either side, drawn as the two vial lines. */
  toleranceDeg: number;
  /** 0..1 progress of the "hold steady" timer. */
  steady: number;
}

/**
 * A spirit-level vial driven by the phone's gravity sensor. The bubble sits
 * between the two lines when the phone is level, and the vial fills as the
 * phone holds still.
 */
export function LevelVial({ rollDeg, pitchDeg, toleranceDeg, steady }: Props) {
  const x = useSharedValue(0);
  const known = rollDeg !== null;
  const level = known && Math.abs(rollDeg) <= toleranceDeg;
  // A wider tolerance (Easy) gets a longer scale so the lines stay inside the vial.
  const range = Math.max(MIN_RANGE_DEG, toleranceDeg * 2);

  useEffect(() => {
    const r = rollDeg ?? 0;
    const k = Math.max(-1, Math.min(1, r / range));
    // A real bubble floats to the high side, opposite the lean.
    x.value = withSpring(-k * ((W - BUBBLE) / 2 - 4), { damping: 14, stiffness: 120 });
  }, [rollDeg, range, x]);

  const bubble = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  const lineGap = (toleranceDeg / range) * ((W - BUBBLE) / 2) + BUBBLE / 2 + 2;

  return (
    <View style={styles.wrap} accessibilityLabel={known ? `Phone tilt ${Math.round(rollDeg)} degrees` : 'Tilt sensor unavailable'}>
      <View style={[styles.vial, { borderColor: level ? color.vial : color.line }]}>
        <View style={[styles.fill, { width: `${Math.round(steady * 100)}%` }]} />
        <View style={[styles.mark, { left: W / 2 - lineGap }]} />
        <View style={[styles.mark, { left: W / 2 + lineGap - 2 }]} />
        {known && <Animated.View style={[styles.bubble, bubble, { backgroundColor: level ? color.vial : color.chalk2 }]} />}
      </View>
      <View style={styles.readout}>
        <Label>Tilt</Label>
        <Mono tone={level ? 'vial' : 'chalk'}>{known ? `${fmt(rollDeg)}°` : '—'}</Mono>
        <Label style={{ marginLeft: 16 }}>Lean</Label>
        <Mono>{pitchDeg !== null ? `${fmt(pitchDeg)}°` : '—'}</Mono>
      </View>
    </View>
  );
}

function fmt(v: number) {
  const r = Math.round(v);
  return r > 0 ? `+${r}` : `${r}`;
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 10 },
  vial: {
    width: W,
    height: H,
    borderRadius: radius.pill,
    borderWidth: 2,
    backgroundColor: color.ground,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: color.vialSoft },
  mark: { position: 'absolute', width: 2, top: 6, bottom: 6, backgroundColor: color.chalk2, opacity: 0.7 },
  bubble: { width: BUBBLE, height: BUBBLE - 10, borderRadius: radius.pill },
  readout: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});
