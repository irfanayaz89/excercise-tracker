import { useEffect } from 'react';
import { Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { color, font } from './theme';

/**
 * The app's signature: a huge condensed numeral that fills with effort orange
 * from the bottom as the goal gets closer, and turns green once it is met.
 * The unfilled part stays as a dark lane-grey numeral, so the number always
 * reads at full size whatever the fill.
 */
export function Scoreboard({
  value,
  fraction,
  met = false,
  size = 168,
  style,
  label,
}: {
  value: string;
  /** 0–1. */
  fraction: number;
  met?: boolean;
  size?: number;
  style?: StyleProp<ViewStyle>;
  /** Spoken by screen readers instead of the bare number. */
  label?: string;
}) {
  const reduce = useReducedMotion();
  const k = Math.min(1, Math.max(0, fraction));
  const fill = useSharedValue(reduce ? k : 0);
  useEffect(() => {
    fill.value = reduce ? k : withTiming(k, { duration: 900, easing: Easing.out(Easing.cubic) });
  }, [k, reduce, fill]);

  // Barlow Condensed figures sit between the baseline (~78% down the line box)
  // and the cap height (~70% of the size above it): map the fill onto that band,
  // so 0 shows nothing and 1 shows a full numeral.
  const lh = Math.round(size * 0.98);
  const base = size * 0.2;
  const cap = size * 0.72;
  const fillStyle = useAnimatedStyle(() => ({ height: fill.value <= 0 ? 0 : fill.value >= 1 ? lh : base + fill.value * cap }));

  const text = { fontFamily: font.displayBlack, fontSize: size, lineHeight: lh, includeFontPadding: false, letterSpacing: -size * 0.01 } as const;
  return (
    <View
      style={[{ alignSelf: 'flex-start', height: lh }, style]}
      accessible
      accessibilityRole="text"
      accessibilityLabel={label ?? value}
    >
      <Text allowFontScaling={false} style={[text, { color: color.line }]}>
        {value}
      </Text>
      <Animated.View style={[{ position: 'absolute', left: 0, right: -size * 0.1, bottom: 0, overflow: 'hidden' }, fillStyle]}>
        <Text allowFontScaling={false} style={[text, { color: met ? color.good : color.vial, position: 'absolute', left: 0, bottom: 0 }]}>
          {value}
        </Text>
      </Animated.View>
    </View>
  );
}
