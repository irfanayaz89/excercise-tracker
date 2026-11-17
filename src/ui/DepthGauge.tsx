import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Label } from './primitives';
import { color, radius } from './theme';

/**
 * Vertical depth meter: empty at lockout, full at the bottom of the rep. The
 * notch marks the depth a rep needs to count. `rising` fills from the bottom
 * instead (crunches: how high the shoulders lift).
 */
export function DepthGauge({
  depth,
  height = 220,
  label = 'Depth',
  rising = false,
}: {
  depth: number | null;
  height?: number;
  label?: string;
  rising?: boolean;
}) {
  const v = useSharedValue(0);
  useEffect(() => {
    v.value = withTiming(depth ?? 0, { duration: 90 });
  }, [depth, v]);
  const fill = useAnimatedStyle(() => ({
    height: `${Math.round(v.value * 100)}%`,
    backgroundColor: v.value >= 0.97 ? color.good : color.vial,
  }));
  return (
    <View style={{ alignItems: 'center', gap: 8 }}>
      <View style={[styles.track, { height, opacity: depth === null ? 0.35 : 1 }, rising && { justifyContent: 'flex-end' }]}>
        <Animated.View style={[styles.fill, fill]} />
        <View style={[styles.notch, { top: (rising ? 0.03 : 0.97) * height - 1.5 }]} />
      </View>
      <Label>{label}</Label>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    width: 18,
    borderRadius: radius.pill,
    backgroundColor: color.scrimStrong,
    borderWidth: 1,
    borderColor: color.line,
    overflow: 'hidden',
    justifyContent: 'flex-start',
  },
  // Fills from the top: going down in the rep fills the meter downward.
  fill: { width: '100%', borderRadius: radius.pill },
  notch: { position: 'absolute', left: -2, right: -2, height: 3, backgroundColor: color.chalk },
});
