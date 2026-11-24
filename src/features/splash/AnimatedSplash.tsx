import { useEffect } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, Ellipse, RadialGradient, Stop } from 'react-native-svg';
import { color, font } from '@/ui/theme';

/**
 * The opening moment, picking up exactly where the phone's own splash leaves off (same mark, same
 * size, same place: keep MARK_WIDTH in step with `imageWidth` in app.json).
 *
 * The mark is a "T" whose crossbar is a spirit level. It tips as if the phone were just set down,
 * the bubble runs to the high side, then everything settles dead level: Trueline's idea, a phone
 * standing true on the floor so every rep counts. The true line then draws out to both edges and
 * the name appears, before the app fades in underneath.
 */
export const MARK_WIDTH = 140;

// Mark geometry, in the same unit box as the icon artwork (scratch render.swift): bounds x 0.06…0.94, y 0.205…0.94.
const B = { x: 0.06, y: 0.205, w: 0.88, h: 0.735 };

export function AnimatedSplash({ onDone }: { onDone: () => void }) {
  const { width: screenW } = useWindowDimensions();
  const reduced = useReducedMotion();
  const M = MARK_WIDTH / B.w;
  const px = (v: number) => v * M;

  const tilt = useSharedValue(0); // degrees
  const line = useSharedValue(0); // 0…1, the true line drawing out
  const word = useSharedValue(0); // 0…1, the name
  const out = useSharedValue(0); // 0…1, fading away

  useEffect(() => {
    if (reduced) {
      out.value = withDelay(250, withTiming(1, { duration: 250 }, (fin) => fin && runOnJS(onDone)()));
      return;
    }
    // Set down a little crooked, rock once, then settle level.
    tilt.value = withSequence(
      withTiming(-7, { duration: 260, easing: Easing.out(Easing.cubic) }),
      withSpring(0, { damping: 7, stiffness: 120, mass: 0.7 }),
    );
    line.value = withDelay(700, withTiming(1, { duration: 520, easing: Easing.out(Easing.cubic) }));
    word.value = withDelay(900, withTiming(1, { duration: 420, easing: Easing.out(Easing.cubic) }));
    out.value = withDelay(1650, withTiming(1, { duration: 380, easing: Easing.in(Easing.quad) }, (fin) => fin && runOnJS(onDone)()));
  }, [reduced, tilt, line, word, out, onDone]);

  const vialStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${tilt.value}deg` }] }));
  // The bubble runs uphill: opposite the tilt, a little behind it.
  // (A plain number: animated styles run on the UI thread and can't call back into JS helpers.)
  const run = px(0.2);
  const bubbleStyle = useAnimatedStyle(() => ({ transform: [{ translateX: interpolate(tilt.value, [-8, 0, 8], [run, 0, -run]) }] }));
  const lineStyle = useAnimatedStyle(() => ({ opacity: line.value === 0 ? 0 : 1, transform: [{ scaleX: line.value }] }));
  const wordStyle = useAnimatedStyle(() => ({ opacity: word.value, transform: [{ translateY: (1 - word.value) * 14 }] }));
  const rootStyle = useAnimatedStyle(() => ({ opacity: 1 - out.value }));
  const markStyle = useAnimatedStyle(() => ({ transform: [{ scale: 1 + out.value * 0.06 }] }));

  // Vial pieces, relative to the mark's bounds.
  const vial = { left: px(0.06 - B.x), top: px(0.205 - B.y), width: px(0.88), height: px(0.27) };
  const vialCentreY = px(0.34 - B.y);
  const bubble = { left: px(0.375 - B.x), top: px(0.2775 - B.y), width: px(0.25), height: px(0.125) };

  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.root, rootStyle]} accessibilityLabel="Trueline">
      <View style={{ width: MARK_WIDTH, height: px(B.h) }}>
        {/* The true line, behind the mark, through the vial's centre. */}
        <Animated.View
          style={[styles.trueLine, { top: vialCentreY - 1, left: MARK_WIDTH / 2 - screenW / 2, width: screenW }, lineStyle]}
        />
        <Animated.View style={[StyleSheet.absoluteFill, markStyle]}>
          {/* Stem */}
          <View style={[styles.stem, { left: px(0.435 - B.x), top: px(0.5 - B.y), width: px(0.13), height: px(0.44), borderRadius: px(0.065) }]} />
          {/* Crossbar: the vial, which tips and settles */}
          <Animated.View style={[{ position: 'absolute', left: 0, top: 0, width: MARK_WIDTH, height: px(0.27) + vial.top }, vialStyle]}>
            <View style={[styles.vial, vial, { borderRadius: vial.height / 2, borderWidth: px(0.04) }]}>
              <Animated.View style={[{ position: 'absolute', left: bubble.left - vial.left - px(0.2), top: -px(0.02), width: bubble.width + px(0.4), height: vial.height }, bubbleStyle]}>
                <Svg width="100%" height="100%">
                  <Defs>
                    <RadialGradient id="glow" cx="50%" cy="50%" rx="50%" ry="50%">
                      <Stop offset="0" stopColor={color.vial} stopOpacity={0.35} />
                      <Stop offset="1" stopColor={color.vial} stopOpacity={0} />
                    </RadialGradient>
                  </Defs>
                  <Ellipse cx="50%" cy="50%" rx="50%" ry="62%" fill="url(#glow)" />
                </Svg>
              </Animated.View>
            </View>
            {[-0.175, 0.175].map((dx) => (
              <View key={dx} style={[styles.tick, { left: px(0.5 + dx - 0.013 - B.x), top: px(0.275 - B.y), width: px(0.026), height: px(0.13), borderRadius: px(0.013) }]} />
            ))}
            <Animated.View style={[styles.bubble, bubble, { borderRadius: bubble.height / 2 }, bubbleStyle]}>
              <View style={[styles.glint, { left: px(0.035), top: px(0.022), width: px(0.1), height: px(0.034), borderRadius: px(0.017) }]} />
            </Animated.View>
          </Animated.View>
        </Animated.View>
      </View>
      <Animated.View style={[styles.words, wordStyle]}>
        <Animated.Text style={styles.name}>Trueline</Animated.Text>
        <Animated.Text style={styles.tag}>Every rep, counted true</Animated.Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: color.ground, alignItems: 'center', justifyContent: 'center', zIndex: 100 },
  trueLine: { position: 'absolute', height: 2, backgroundColor: color.vial, opacity: 0.85 },
  stem: { position: 'absolute', backgroundColor: color.chalk },
  vial: { position: 'absolute', backgroundColor: '#161E2A', borderColor: color.chalk, overflow: 'hidden' },
  tick: { position: 'absolute', backgroundColor: 'rgba(248,250,252,0.6)' },
  bubble: { position: 'absolute', backgroundColor: color.vial },
  glint: { position: 'absolute', backgroundColor: '#FFE2C7' },
  words: { position: 'absolute', bottom: '22%', alignItems: 'center', gap: 6 },
  name: { fontFamily: font.displayBlack, fontSize: 48, color: color.chalk },
  tag: { fontFamily: font.bodyMed, fontSize: 15, color: color.chalk2 },
});
