import { useIsFocused } from 'expo-router';
import { useEffect, useState } from 'react';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedProps,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { EXERCISES } from '@/engine/exercises';
import type { CameraView, Exercise, PhoneOrientation } from '@/engine/types';
import { BAR_Y, FLOOR_Y, MOTION_MS, STILL_P, figureAt, figureFrontAt } from './exerciseMotion';
import { color, font } from './theme';

const APath = Animated.createAnimatedComponent(Path);
const ACircle = Animated.createAnimatedComponent(Circle);

/**
 * The guide's moving picture: on the left, what the camera sees, with a figure
 * doing the exercise on a loop; on the right, the room from above, showing the
 * phone level with your hips, at a right angle to your body, at the distance
 * for the picked orientation. Respects the system's reduce-motion setting.
 */
export function ExerciseAnimation({
  exercise,
  orientation = 'landscape',
  width = 320,
  view = 'side',
}: {
  exercise: Exercise;
  orientation?: PhoneOrientation;
  width?: number;
  /** Front: the phone faces you (the side plank is always shown facing the phone). */
  view?: CameraView;
}) {
  const front = view === 'front' && EXERCISES[exercise].frontView;
  // Pull-ups are always seen facing the phone, hanging from a bar.
  const pull = exercise === 'pullup';
  // Still when motion is reduced, and when this screen isn't the one showing (a live set runs on
  // top of the exercise screen: the loop would compete with the camera and the pose model).
  const focused = useIsFocused();
  const reduce = useReducedMotion() || !focused;
  const p = useSharedValue(STILL_P[exercise]);
  const period = MOTION_MS[exercise];

  useEffect(() => {
    if (reduce) {
      p.value = STILL_P[exercise];
      return;
    }
    p.value = 0;
    p.value = withRepeat(withTiming(1, { duration: period, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(p);
  }, [exercise, period, reduce, p]);

  const fig = useDerivedValue(() => (front ? figureFrontAt(exercise, p.value) : figureAt(exercise, p.value)));
  const body = useAnimatedProps(() => ({ d: fig.value.body }));
  const arm = useAnimatedProps(() => ({ d: fig.value.arm }));
  const extra = useAnimatedProps(() => ({ d: fig.value.extra || 'M0 0' }));
  const head = useAnimatedProps(() => ({ cx: fig.value.head.x, cy: fig.value.head.y }));

  const counter = useLoopCounter(exercise, period, reduce);
  const portrait = orientation === 'portrait';
  const distance = pull ? '2–2.5 m' : front ? '1.2–2 m' : portrait ? '2.5–3 m' : '1.5–2 m';
  const facing = exercise === 'sidePlank' || front || pull;

  return (
    <Svg
      width={width}
      height={(width * 116) / 320}
      viewBox="0 44 320 116"
      accessibilityLabel={
        pull
          ? `Animation of a pull-up, seen from the front: from a dead hang to the chin over the bar and back. The phone stands ${distance} from the bar, about waist high, facing you.`
          : front
          ? `Animation of ${label(exercise)}, seen head-on. The phone stands on the floor beyond your hands, ${distance} away, facing you.`
          : `Animation of ${label(exercise)}. The phone stands on the floor ${distance} away, level with your hips and at a right angle to your body, so it sees you ${exercise === 'sidePlank' ? 'from the front, lying on your side' : 'side-on'}.`
      }
    >
      {/* ── camera view ── */}
      <SvgText x="10" y="54" fontSize={8} fill={color.vial} fontFamily={font.mono}>
        {front || pull ? 'CAMERA VIEW · FACING YOU' : facing ? 'CAMERA VIEW · FACING IT' : 'CAMERA VIEW · SIDE-ON'}
      </SvgText>
      <G stroke={color.muted} strokeWidth={1.5} fill="none" strokeLinecap="round">
        <Path d="M8 70 L8 60 L18 60" />
        <Path d="M212 60 L222 60 L222 70" />
        <Path d="M8 142 L8 152 L18 152" />
        <Path d="M212 152 L222 152 L222 142" />
      </G>
      <Circle cx="215" cy="67" r="2.5" fill={color.fault} />
      <SvgText x="15" y="73" fontSize={9} fill={color.chalk} fontFamily={font.mono}>
        {counter}
      </SvgText>
      <Line x1="12" y1={FLOOR_Y + 1.5} x2="218" y2={FLOOR_Y + 1.5} stroke={color.line} strokeWidth={2} />
      {exercise === 'plank' && !front && (
        <Line x1="34" y1={FLOOR_Y - 28} x2="208" y2={FLOOR_Y - 3} stroke={color.vial} strokeWidth={1} strokeDasharray="4 4" opacity={0.6} />
      )}
      {pull && <Line x1="70" y1={BAR_Y} x2="160" y2={BAR_Y} stroke={color.muted} strokeWidth={3} strokeLinecap="round" />}
      <G stroke={color.chalk} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" fill="none">
        <APath animatedProps={body} />
        <APath animatedProps={arm} />
        {facing && <APath animatedProps={extra} />}
      </G>
      <ACircle animatedProps={head} r={6.5} fill={color.chalk} />

      {/* ── from above ── */}
      <Line x1="229" y1="60" x2="229" y2="152" stroke={color.lineSoft} strokeWidth={1} />
      <SvgText x="275" y="54" fontSize={8} fill={color.vial} fontFamily={font.mono} textAnchor="middle">
        FROM ABOVE
      </SvgText>
      {pull ? (
        <BarMap distance={distance} />
      ) : front ? (
        <FrontMap distance={distance} portrait={portrait} />
      ) : (
        <SideMap distance={distance} portrait={portrait} />
      )}
    </Svg>
  );
}

/** From above, side view: the phone level with your hips, at a right angle to your body. */
function SideMap({ distance, portrait }: { distance: string; portrait: boolean }) {
  return (
    <>
      <Rect x="238" y="72" width="72" height="20" rx="3" fill={color.raised} stroke={color.line} strokeWidth={1} />
      <Line x1="249" y1="82" x2="304" y2="82" stroke={color.chalk} strokeWidth={3} strokeLinecap="round" />
      <Circle cx="245" cy="82" r="4" fill={color.chalk} />
      <SvgText x="274" y="68" fontSize={7} fill={color.muted} fontFamily={font.mono} textAnchor="middle">
        YOU, ON THE MAT
      </SvgText>
      {/* sight line from the phone to the hips, at a right angle to the body */}
      <Line x1="270" y1="119" x2="270" y2="94" stroke={color.vial} strokeWidth={1.5} strokeDasharray="4 3" />
      <Path d="M270 89 L276 89 L276 83" stroke={color.vial} strokeWidth={1.2} fill="none" />
      <SvgText x="280" y="101" fontSize={8} fill={color.vial} fontFamily={font.mono}>
        90°
      </SvgText>
      <SvgText x="276" y="114" fontSize={8} fill={color.chalk} fontFamily={font.mono}>
        {distance}
      </SvgText>
      {portrait ? (
        <Rect x="265.5" y="120" width="9" height="16" rx="2" fill={color.raised} stroke={color.vial} strokeWidth={1.5} />
      ) : (
        <Rect x="262" y="122" width="16" height="9" rx="2" fill={color.raised} stroke={color.vial} strokeWidth={1.5} />
      )}
      <Circle cx="270" cy={portrait ? 123 : 124.5} r="1.6" fill={color.vial} />
      <SvgText x="270" y="148" fontSize={7} fill={color.muted} fontFamily={font.mono} textAnchor="middle">
        PHONE · HIP LEVEL
      </SvgText>
    </>
  );
}

/** From above, front view: the phone on the floor at your head end, in line with your body, facing you. */
function FrontMap({ distance, portrait }: { distance: string; portrait: boolean }) {
  const headY = 96;
  const feetY = 132;
  const phoneY = 70;
  return (
    <>
      <Rect x="262" y={headY - 8} width="16" height={feetY - headY + 16} rx="3" fill={color.raised} stroke={color.line} strokeWidth={1} />
      <Line x1="270" y1={headY + 5} x2="270" y2={feetY} stroke={color.chalk} strokeWidth={3} strokeLinecap="round" />
      <Circle cx="270" cy={headY} r="4" fill={color.chalk} />
      <Line x1="270" y1={phoneY + 5} x2="270" y2={headY - 6} stroke={color.vial} strokeWidth={1.5} strokeDasharray="4 3" />
      {portrait ? (
        <Rect x="265.5" y={phoneY - 8} width="9" height="16" rx="2" fill={color.raised} stroke={color.vial} strokeWidth={1.5} />
      ) : (
        <Rect x="262" y={phoneY - 4.5} width="16" height="9" rx="2" fill={color.raised} stroke={color.vial} strokeWidth={1.5} />
      )}
      <SvgText x="284" y={(phoneY + headY) / 2 + 3} fontSize={8} fill={color.chalk} fontFamily={font.mono}>
        {distance}
      </SvgText>
      <SvgText x="275" y="148" fontSize={7} fill={color.muted} fontFamily={font.mono} textAnchor="middle">
        PHONE · AT YOUR HEAD
      </SvgText>
    </>
  );
}

/** From above, pull-ups: the bar, you under it, and the phone in front at about waist height. */
function BarMap({ distance }: { distance: string }) {
  const barY = 82;
  const phoneY = 128;
  return (
    <>
      <Line x1="246" y1={barY} x2="294" y2={barY} stroke={color.muted} strokeWidth={3} strokeLinecap="round" />
      <Circle cx="270" cy={barY + 7} r="4" fill={color.chalk} />
      <SvgText x="275" y="68" fontSize={7} fill={color.muted} fontFamily={font.mono} textAnchor="middle">
        YOU, UNDER THE BAR
      </SvgText>
      <Line x1="270" y1={phoneY - 9} x2="270" y2={barY + 13} stroke={color.vial} strokeWidth={1.5} strokeDasharray="4 3" />
      <SvgText x="276" y={(phoneY + barY) / 2 + 6} fontSize={8} fill={color.chalk} fontFamily={font.mono}>
        {distance}
      </SvgText>
      <Rect x="265.5" y={phoneY - 8} width="9" height="16" rx="2" fill={color.raised} stroke={color.vial} strokeWidth={1.5} />
      <SvgText x="270" y="148" fontSize={7} fill={color.muted} fontFamily={font.mono} textAnchor="middle">
        PHONE · WAIST HIGH
      </SvgText>
    </>
  );
}

function label(e: Exercise): string {
  return e === 'pullup' ? 'a pull-up' : e === 'pushup' ? 'a push-up' : e === 'crunch' ? 'a crunch' : e === 'plank' ? 'a plank' : 'a side plank on each side';
}

/** The number in the corner: reps counted, seconds held, or the side being held. */
function useLoopCounter(exercise: Exercise, period: number, still: boolean): string {
  const [n, setN] = useState(0);
  const timed = exercise === 'plank' || exercise === 'sidePlank';
  // Each screen mounts its own animation, so the count starts at 0 without a reset here.
  useEffect(() => {
    if (still) return;
    // Reps tick once per loop, just after the lowering ends; holds tick every second.
    const step = timed ? 1000 : period;
    const first = timed ? 1000 : period * 0.9;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = setTimeout(() => {
      setN(1);
      timer = setInterval(() => setN((v) => v + 1), step);
    }, first);
    return () => {
      clearTimeout(start);
      if (timer) clearInterval(timer);
    };
  }, [exercise, period, still, timed]);

  // Side plank: the first half of the loop is the left side.
  if (exercise === 'sidePlank') return Math.floor(n / (period / 2000)) % 2 === 1 ? 'RIGHT SIDE' : 'LEFT SIDE';
  if (timed) return `HOLD · 0:${String(n % 60).padStart(2, '0')}`;
  return `REPS · ${n === 0 ? 0 : ((n - 1) % 10) + 1}`;
}
