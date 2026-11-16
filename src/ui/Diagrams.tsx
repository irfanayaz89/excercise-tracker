import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import type { Exercise, PhoneOrientation, PlankVariant } from '@/engine/types';
import { color, font } from './theme';

/**
 * Setup sketch: phone on the floor, side-on to the user, at the distance for
 * the picked orientation. Push-ups show the straight-arm start; the plank
 * shows a forearm plank, so the two exercises never share a figure.
 */
export function SetupDiagram({
  width = 320,
  orientation = 'landscape',
  exercise = 'pushup',
}: {
  width?: number;
  orientation?: PhoneOrientation;
  exercise?: Exercise;
}) {
  const h = width * 0.3;
  const portrait = orientation === 'portrait';
  const distance = portrait ? '2.5–3 m' : '1.5–2 m';
  return (
    <Svg
      width={width}
      height={h}
      viewBox="0 40 320 96"
      accessibilityLabel={`Stand the phone on the floor in ${orientation}, ${distance} to the side of where you will ${
        exercise === 'plank' ? 'hold your plank' : exercise === 'sidePlank' ? 'hold your side plank, facing it' : 'do push-ups'
      }`}
    >
      <Line x1="6" y1="116" x2="314" y2="116" stroke={color.line} strokeWidth={2} />
      {portrait ? (
        <>
          <Rect x="18" y="78" width="22" height="36" rx="4" fill={color.raised} stroke={color.vial} strokeWidth={2} />
          <Circle cx="29" cy="86" r="3.5" fill={color.vial} />
          <Path d="M40 86 L304 50 L304 116 L40 110 Z" fill={color.vial} opacity={0.07} />
        </>
      ) : (
        <>
          <Rect x="14" y="88" width="34" height="26" rx="4" fill={color.raised} stroke={color.vial} strokeWidth={2} />
          <Circle cx="31" cy="101" r="4" fill={color.vial} />
          <Path d="M48 96 L304 54 L304 116 L48 108 Z" fill={color.vial} opacity={0.07} />
        </>
      )}
      {/* distance */}
      <Line x1={portrait ? 40 : 48} y1="122" x2="140" y2="122" stroke={color.muted} strokeWidth={1.5} strokeDasharray="4 4" />
      <SvgText x="94" y="135" fontSize={10} fill={color.muted} fontFamily={font.mono} textAnchor="middle">
        {distance}
      </SvgText>
      {exercise === 'sidePlank' ? (
        <>
          {/* side plank facing the phone: support forearm under the shoulder, top arm raised */}
          <G stroke={color.chalk} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" fill="none">
            <Path d="M176 94 L178 113 L168 113" />
            <Path d="M176 94 L232 103 L292 112" />
            <Path d="M176 94 L174 62" />
          </G>
          <Circle cx="163" cy="89" r="8" fill={color.chalk} />
          <Line x1="170" y1="92" x2="294" y2="112" stroke={color.vial} strokeWidth={1.5} strokeDasharray="5 4" />
        </>
      ) : exercise === 'plank' ? (
        <>
          {/* forearm plank, head left: forearm flat on the floor, elbow under the shoulder */}
          <G stroke={color.chalk} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" fill="none">
            <Path d="M176 94 L178 113 L156 113" />
            <Path d="M176 94 L232 103 L292 112" />
          </G>
          <Circle cx="163" cy="89" r="8" fill={color.chalk} />
          <Line x1="170" y1="92" x2="294" y2="112" stroke={color.vial} strokeWidth={1.5} strokeDasharray="5 4" />
        </>
      ) : (
        <>
          {/* push-up start, head left: arms straight */}
          <G stroke={color.chalk} strokeWidth={5} strokeLinecap="round" fill="none">
            <Path d="M172 82 L182 114" />
            <Path d="M172 82 L230 96 L290 112" />
          </G>
          <Circle cx="160" cy="76" r="8" fill={color.chalk} />
          <Line x1="168" y1="80" x2="292" y2="111" stroke={color.vial} strokeWidth={1.5} strokeDasharray="5 4" />
        </>
      )}
    </Svg>
  );
}

/** Top and bottom of a counted rep, side by side. */
export function RepDiagram({ width = 320 }: { width?: number }) {
  return (
    <Svg
      width={width}
      height={width * 0.225}
      viewBox="0 32 320 72"
      accessibilityLabel="A rep counts from arms locked at the top down to elbows at about 90 degrees and back up"
    >
      <Line x1="6" y1="78" x2="150" y2="78" stroke={color.line} strokeWidth={2} />
      <Line x1="170" y1="78" x2="314" y2="78" stroke={color.line} strokeWidth={2} />
      <G stroke={color.chalk} strokeWidth={4.5} strokeLinecap="round" strokeLinejoin="round" fill="none">
        {/* top: arms locked */}
        <Path d="M40 46 L40 76" />
        <Path d="M40 46 L92 58 L146 74" />
        {/* bottom: elbows bent to ~90° */}
        <Path d="M210 62 L226 62 L226 76" />
        <Path d="M210 62 L262 69 L312 76" />
      </G>
      <Circle cx="30" cy="42" r="7" fill={color.chalk} />
      <Circle cx="199" cy="58" r="7" fill={color.chalk} />
      <Circle cx="40" cy="61" r="3.5" fill={color.vial} />
      <Circle cx="226" cy="62" r="3.5" fill={color.vial} />
      <SvgText x="78" y="98" fontSize={10} fill={color.vial} fontFamily={font.mono} textAnchor="middle">
        TOP · ARMS LOCKED
      </SvgText>
      <SvgText x="242" y="98" fontSize={10} fill={color.vial} fontFamily={font.mono} textAnchor="middle">
        BOTTOM · ELBOWS ~90°
      </SvgText>
    </Svg>
  );
}

/** Both ways to hold a plank (or side plank), side by side, each with its straight body line. */
export function HoldDiagram({ width = 320, exercise = 'plank' }: { width?: number; exercise?: Exercise }) {
  if (exercise === 'sidePlank') return <SideHoldDiagram width={width} />;
  return (
    <Svg
      width={width}
      height={width * 0.225}
      viewBox="0 32 320 72"
      accessibilityLabel="Hold a plank on straight arms, or on your forearms with elbows under your shoulders, in one straight line from shoulders to heels"
    >
      <Line x1="6" y1="78" x2="150" y2="78" stroke={color.line} strokeWidth={2} />
      <Line x1="170" y1="78" x2="314" y2="78" stroke={color.line} strokeWidth={2} />
      <G stroke={color.chalk} strokeWidth={4.5} strokeLinecap="round" strokeLinejoin="round" fill="none">
        {/* high plank: arms straight, hands under shoulders */}
        <Path d="M40 46 L40 76" />
        <Path d="M40 46 L92 58 L146 74" />
        {/* forearm plank: forearm flat, elbow under shoulder */}
        <Path d="M206 60 L207 76 L188 76" />
        <Path d="M206 60 L258 68 L312 76" />
      </G>
      <Line x1="34" y1="44" x2="148" y2="75" stroke={color.vial} strokeWidth={1.5} strokeDasharray="4 4" />
      <Line x1="200" y1="58" x2="314" y2="76" stroke={color.vial} strokeWidth={1.5} strokeDasharray="4 4" />
      <Circle cx="30" cy="42" r="7" fill={color.chalk} />
      <Circle cx="194" cy="56" r="7" fill={color.chalk} />
      <SvgText x="78" y="98" fontSize={10} fill={color.vial} fontFamily={font.mono} textAnchor="middle">
        HIGH · ARMS STRAIGHT
      </SvgText>
      <SvgText x="242" y="98" fontSize={10} fill={color.vial} fontFamily={font.mono} textAnchor="middle">
        FOREARM · ELBOWS UNDER
      </SvgText>
    </Svg>
  );
}

/** Side plank: on the forearm, or on a straight arm, each with the top arm raised. */
function SideHoldDiagram({ width }: { width: number }) {
  return (
    <Svg
      width={width}
      height={width * 0.3}
      viewBox="0 8 320 96"
      accessibilityLabel="Side plank on the forearm with the elbow under the shoulder, or on a straight arm with the hand under the shoulder, in one straight line"
    >
      <Line x1="6" y1="78" x2="150" y2="78" stroke={color.line} strokeWidth={2} />
      <Line x1="170" y1="78" x2="314" y2="78" stroke={color.line} strokeWidth={2} />
      <G stroke={color.chalk} strokeWidth={4.5} strokeLinecap="round" strokeLinejoin="round" fill="none">
        {/* forearm */}
        <Path d="M36 60 L37 76 L28 76" />
        <Path d="M36 60 L88 68 L146 76" />
        <Path d="M36 60 L35 30" />
        {/* straight arm */}
        <Path d="M204 46 L205 76" />
        <Path d="M204 46 L258 61 L312 76" />
        <Path d="M204 46 L203 16" />
      </G>
      <Line x1="30" y1="58" x2="148" y2="76" stroke={color.vial} strokeWidth={1.5} strokeDasharray="4 4" />
      <Line x1="198" y1="44" x2="314" y2="76" stroke={color.vial} strokeWidth={1.5} strokeDasharray="4 4" />
      <Circle cx="24" cy="56" r="7" fill={color.chalk} />
      <Circle cx="192" cy="42" r="7" fill={color.chalk} />
      <SvgText x="78" y="98" fontSize={10} fill={color.vial} fontFamily={font.mono} textAnchor="middle">
        FOREARM · ELBOW UNDER
      </SvgText>
      <SvgText x="242" y="98" fontSize={10} fill={color.vial} fontFamily={font.mono} textAnchor="middle">
        STRAIGHT ARM · HAND UNDER
      </SvgText>
    </Svg>
  );
}

/**
 * Small exercise icon for pickers and lists: a push-up with an up-down arrow
 * (counted), or a forearm plank with a stopwatch (timed).
 */
export function ExerciseGlyph({ exercise, active = true, size = 44 }: { exercise: Exercise; active?: boolean; size?: number }) {
  const ink = active ? color.chalk : color.muted;
  const accent = active ? color.vial : color.muted;
  return (
    <Svg width={size} height={(size * 30) / 44} viewBox="0 0 44 30" accessibilityElementsHidden importantForAccessibility="no">
      <Line x1="1" y1="27.5" x2="43" y2="27.5" stroke={color.line} strokeWidth={1.5} />
      {exercise === 'sidePlank' ? (
        <>
          {/* side plank: forearm down, top arm raised, a left-right arrow for "each side" */}
          <G stroke={ink} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" fill="none">
            <Path d="M12 18 L13 26 L9 26" />
            <Path d="M12 18 L26 22 L40 26" />
            <Path d="M12 18 L11 6" />
          </G>
          <Circle cx="8" cy="15.5" r="3" fill={ink} />
          <G stroke={accent} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" fill="none">
            {/* left-right arrow: each side */}
            <Path d="M25 8 L37 8" />
            <Path d="M27.5 5.5 L25 8 L27.5 10.5" />
            <Path d="M34.5 5.5 L37 8 L34.5 10.5" />
          </G>
        </>
      ) : exercise === 'plank' ? (
        <>
          <G stroke={ink} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" fill="none">
            <Path d="M12 19 L13 26 L5 26" />
            <Path d="M12 19 L26 22 L40 26" />
          </G>
          <Circle cx="8" cy="16.5" r="3" fill={ink} />
          {/* stopwatch: a timed hold */}
          <Circle cx="31" cy="9" r="5" stroke={accent} strokeWidth={1.6} fill="none" />
          <Line x1="31" y1="9" x2="31" y2="6" stroke={accent} strokeWidth={1.6} strokeLinecap="round" />
          <Line x1="29.5" y1="2.5" x2="32.5" y2="2.5" stroke={accent} strokeWidth={1.6} strokeLinecap="round" />
        </>
      ) : (
        <>
          <G stroke={ink} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" fill="none">
            <Path d="M12 12 L13 26" />
            <Path d="M12 12 L26 17 L40 25" />
          </G>
          <Circle cx="8" cy="9.5" r="3" fill={ink} />
          {/* up-down arrow: counted reps */}
          <G stroke={accent} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" fill="none">
            <Path d="M31 2.5 L31 11.5" />
            <Path d="M28.5 5 L31 2.5 L33.5 5" />
            <Path d="M28.5 9 L31 11.5 L33.5 9" />
          </G>
        </>
      )}
    </Svg>
  );
}

/** Dashed target outline shown over the camera while waiting for a plank. */
export function PlankGhost({
  width,
  height,
  facing,
  variant = 'high',
}: {
  width: number;
  height: number;
  facing: 'left' | 'right';
  /** Push-ups start from a high plank; the plank shows a forearm plank; 'side' is a side plank. */
  variant?: PlankVariant | 'side';
}) {
  // Normalized plank pose in a 100×56 box, head on the left.
  const flip = facing === 'right';
  const X = (x: number) => ((flip ? 100 - x : x) / 100) * width;
  const Y = (y: number) => (y / 56) * height;
  const forearm = variant === 'forearm' || variant === 'side';
  const pts = forearm
    ? {
        head: [16, 32],
        shoulder: [23, 36],
        elbow: [24, 47],
        wrist: variant === 'side' ? [18, 47] : [11, 47],
        hip: [53, 41],
        ankle: [87, 46],
      }
    : { head: [16, 22], shoulder: [22, 27], elbow: [22.5, 37], wrist: [23, 47], hip: [52, 35], ankle: [86, 46] };
  const P = (k: keyof typeof pts) => `${X(pts[k][0])} ${Y(pts[k][1])}`;
  return (
    <Svg width={width} height={height} pointerEvents="none">
      <G
        stroke={color.chalk}
        strokeOpacity={0.55}
        strokeWidth={Math.max(3, width / 140)}
        strokeDasharray="10 9"
        strokeLinecap="round"
        fill="none"
      >
        <Path d={`M${P('shoulder')} L${P('elbow')} L${P('wrist')}`} />
        <Path d={`M${P('shoulder')} L${P('hip')} L${P('ankle')}`} />
        {variant === 'side' && <Path d={`M${P('shoulder')} L${X(22)} ${Y(14)}`} />}
      </G>
      <Circle
        cx={X(pts.head[0])}
        cy={Y(pts.head[1])}
        r={width / 45}
        stroke={color.chalk}
        strokeOpacity={0.55}
        strokeDasharray="6 6"
        strokeWidth={2}
        fill="none"
      />
      <Line x1={X(4)} y1={Y(48.5)} x2={X(96)} y2={Y(48.5)} stroke={color.chalk} strokeOpacity={0.25} strokeWidth={2} />
    </Svg>
  );
}
