import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Label } from './primitives';
import { color, radius } from './theme';

/** The gauge spans ±1.5 limits; the notches mark the limits themselves. */
const RANGE = 1.5;
const MARK = 14;

/**
 * Plank hips meter, a level vial stood on end: the bubble sits on the centre
 * line when shoulders, hips and heels are in one line, rises when the hips
 * pike up and sinks when they sag. The notches mark where the clock stops.
 *
 * @param line 0 on the line, +1 at the sag limit, −1 at the pike limit; null when unknown.
 * @param warnAt share of a limit where the bubble turns amber.
 */
export function LineGauge({ line, height = 200, warnAt = 0.6 }: { line: number | null; height?: number; warnAt?: number }) {
  const v = useSharedValue(0);
  useEffect(() => {
    v.value = withTiming(line ?? 0, { duration: 120 });
  }, [line, v]);
  const y = (l: number) => ((l + RANGE) / (2 * RANGE)) * height;
  const bubble = useAnimatedStyle(() => {
    const l = Math.max(-RANGE, Math.min(RANGE, v.value));
    const a = Math.abs(l);
    return {
      top: ((l + RANGE) / (2 * RANGE)) * height - MARK / 2,
      backgroundColor: a >= 1 ? color.fault : a >= warnAt ? color.cue : color.good,
    };
  });
  return (
    <View style={{ alignItems: 'center', gap: 8 }}>
      <View
        style={[styles.track, { height, opacity: line === null ? 0.35 : 1 }]}
        accessible
        accessibilityLabel={
          line === null ? 'Hips: not visible' : line > warnAt ? 'Hips sagging' : line < -warnAt ? 'Hips high' : 'Hips in line'
        }
      >
        <View style={[styles.limit, { top: y(-1) - 1.5 }]} />
        <View style={[styles.centre, { top: y(0) - 1 }]} />
        <View style={[styles.limit, { top: y(1) - 1.5 }]} />
        <Animated.View style={[styles.bubble, bubble]} />
      </View>
      <Label>Hips</Label>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    width: 22,
    borderRadius: radius.pill,
    backgroundColor: color.scrimStrong,
    borderWidth: 1,
    borderColor: color.line,
  },
  centre: { position: 'absolute', left: 3, right: 3, height: 2, backgroundColor: color.chalk2, opacity: 0.6 },
  limit: { position: 'absolute', left: -3, right: -3, height: 3, backgroundColor: color.chalk },
  bubble: { position: 'absolute', left: (22 - 2 - MARK) / 2, width: MARK, height: MARK, borderRadius: MARK / 2 },
});
