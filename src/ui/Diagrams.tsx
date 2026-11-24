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
  if (exercise === 'pullup') return <PullupSetupDiagram width={width} />;
  const h = width * 0.3;
  const portrait = orientation === 'portrait';
  const distance = portrait ? '2.5–3 m' : '1.5–2 m';
  return (
    <Svg
      width={width}
      height={h}
      viewBox="0 40 320 96"
      accessibilityLabel={`Stand the phone on the floor in ${orientation}, ${distance} to the side of where you will ${
        exercise === 'plank'
          ? 'hold your plank'
          : exercise === 'sidePlank'
            ? 'hold your side plank, facing it'
            : exercise === 'crunch'
              ? 'lie on your back for crunches'
              : 'do push-ups'
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
      {exercise === 'crunch' ? (
        <>
          {/* crunch start, head left: on the back, knees bent, feet flat, arm reaching towards the knees */}
          <G stroke={color.chalk} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" fill="none">
            <Path d="M174 108 L232 110 L262 84 L290 112 L300 113" />
            <Path d="M174 108 L206 101" />
          </G>
          <Circle cx="161" cy="106" r="8" fill={color.chalk} />
        </>
      ) : exercise === 'sidePlank' ? (
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

/** Pull-up setup: the phone upright on a stand about waist high, 2–2.5 m from the bar, looking up at it. */
function PullupSetupDiagram({ width }: { width: number }) {
  return (
    <Svg
      width={width}
      height={width * 0.3}
      viewBox="0 40 320 96"
      accessibilityLabel="Stand the phone upright on a chair or shelf about waist high, 2 to 2.5 metres from the bar, facing it"
    >
      <Line x1="6" y1="130" x2="314" y2="130" stroke={color.line} strokeWidth={2} />
      {/* stand and phone */}
      <Path d="M24 130 L24 102 M44 130 L44 102 M20 102 L48 102" stroke={color.muted} strokeWidth={2} fill="none" />
      <Rect x="27" y="76" width="14" height="25" rx="3" fill={color.raised} stroke={color.vial} strokeWidth={2} />
      <Circle cx="34" cy="82" r="2.5" fill={color.vial} />
      <Path d="M41 82 L276 44 L276 130 L41 96 Z" fill={color.vial} opacity={0.07} />
      {/* bar and hanging figure */}
      <Line x1="236" y1="50" x2="300" y2="50" stroke={color.muted} strokeWidth={3} strokeLinecap="round" />
      <G stroke={color.chalk} strokeWidth={4.5} strokeLinecap="round" strokeLinejoin="round" fill="none">
        <Path d="M256 50 L260 72 L276 72 L280 50" />
        <Path d="M268 72 L268 92 L265 108 M268 92 L271 108" />
      </G>
      <Circle cx="268" cy="64" r="6.5" fill={color.chalk} />
      <Line x1="44" y1="122" x2="230" y2="122" stroke={color.muted} strokeWidth={1.5} strokeDasharray="4 4" />
      <SvgText x="137" y="117" fontSize={10} fill={color.muted} fontFamily={font.mono} textAnchor="middle">
        2–2.5 m · WAIST HIGH
      </SvgText>
    </Svg>
  );
}

/** Top and bottom of a counted rep, side by side. */
export function RepDiagram({ width = 320, exercise = 'pushup' }: { width?: number; exercise?: Exercise }) {
  if (exercise === 'crunch') return <CrunchDiagram width={width} />;
  if (exercise === 'pullup') return <PullupDiagram width={width} />;
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

/** A pull-up: from a dead hang (arms straight) to the chin over the bar. */
function PullupDiagram({ width }: { width: number }) {
  return (
    <Svg
      width={width}
      height={(width * 90) / 320}
      viewBox="0 20 320 90"
      accessibilityLabel="A pull-up counts from a dead hang with straight arms up to your chin over the bar, then back down to straight arms"
    >
      <Line x1="50" y1="34" x2="110" y2="34" stroke={color.muted} strokeWidth={3} strokeLinecap="round" />
      <Line x1="210" y1="34" x2="270" y2="34" stroke={color.muted} strokeWidth={3} strokeLinecap="round" />
      <G stroke={color.chalk} strokeWidth={4.5} strokeLinecap="round" strokeLinejoin="round" fill="none">
        {/* dead hang: arms straight */}
        <Path d="M68 34 L72 58 L88 58 L92 34" />
        <Path d="M80 58 L80 75 L77.5 89 M80 75 L82.5 89" />
        {/* top: elbows bent out and down, chin over the bar */}
        <Path d="M228 34 L220 52 L232 42 L248 42 L260 52 L252 34" />
        <Path d="M240 42 L240 62 L237 78 M240 62 L243 78" />
      </G>
      <Circle cx="80" cy="50" r="6.5" fill={color.chalk} />
      <Circle cx="240" cy="29" r="6.5" fill={color.chalk} />
      <Line x1="226" y1="34" x2="254" y2="34" stroke={color.vial} strokeWidth={1.5} strokeDasharray="3 2" />
      <SvgText x="80" y="106" fontSize={10} fill={color.vial} fontFamily={font.mono} textAnchor="middle">
        DEAD HANG · ARMS STRAIGHT
      </SvgText>
      <SvgText x="240" y="106" fontSize={10} fill={color.vial} fontFamily={font.mono} textAnchor="middle">
        TOP · CHIN OVER THE BAR
      </SvgText>
    </Svg>
  );
}

/** A crunch: shoulders on the floor, then curled up until the shoulder blades leave it (about 30°). */
function CrunchDiagram({ width }: { width: number }) {
  return (
    <Svg
      width={width}
      height={width * 0.225}
      viewBox="0 32 320 72"
      accessibilityLabel="A crunch counts from lying with your shoulders on the floor, curling up until your shoulder blades leave the floor, about 30 degrees, and lowering back down"
    >
      <Line x1="6" y1="78" x2="150" y2="78" stroke={color.line} strokeWidth={2} />
      <Line x1="170" y1="78" x2="314" y2="78" stroke={color.line} strokeWidth={2} />
      <G stroke={color.chalk} strokeWidth={4.5} strokeLinecap="round" strokeLinejoin="round" fill="none">
        {/* down: shoulders on the floor */}
        <Path d="M36 72 L92 74 L118 52 L142 76 L150 76" />
        <Path d="M36 72 L66 67" />
        {/* up: shoulder blades off, lower back down */}
        <Path d="M208 47 L256 74 L282 52 L306 76 L314 76" />
        <Path d="M208 47 L238 55" />
      </G>
      <Circle cx="24" cy="70" r="7" fill={color.chalk} />
      <Circle cx="198" cy="40" r="7" fill={color.chalk} />
      {/* lift angle at the hip */}
      <Path d="M232 74 A24 24 0 0 1 235 62" stroke={color.vial} strokeWidth={1.5} fill="none" />
      <SvgText x="229" y="74" fontSize={9} fill={color.vial} fontFamily={font.mono} textAnchor="end">
        ~30°
      </SvgText>
      <SvgText x="78" y="98" fontSize={10} fill={color.vial} fontFamily={font.mono} textAnchor="middle">
        DOWN · SHOULDERS ON FLOOR
      </SvgText>
      <SvgText x="242" y="98" fontSize={10} fill={color.vial} fontFamily={font.mono} textAnchor="middle">
        UP · SHOULDER BLADES OFF
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
      {exercise === 'pullup' ? (
        <>
          {/* pull-up: hanging from a bar, with an up-down arrow */}
          <Line x1="8" y1="3" x2="32" y2="3" stroke={accent} strokeWidth={1.8} strokeLinecap="round" />
          <G stroke={ink} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" fill="none">
            <Path d="M14 3 L16.5 11 L23.5 11 L26 3" />
            <Path d="M20 11 L20 19 L18 25.5 M20 19 L22 25.5" />
          </G>
          <Circle cx="20" cy="7.6" r="2.6" fill={ink} />
          <G stroke={accent} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" fill="none">
            <Path d="M37 8 L37 17" />
            <Path d="M34.5 10.5 L37 8 L39.5 10.5" />
            <Path d="M34.5 14.5 L37 17 L39.5 14.5" />
          </G>
        </>
      ) : exercise === 'crunch' ? (
        <>
          {/* crunch: on the back, knees up, shoulders curled off the floor, with an up-down arrow */}
          <G stroke={ink} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" fill="none">
            <Path d="M10 19 L21 25 L28 15 L35 26 L39 26" />
          </G>
          <Circle cx="6.5" cy="15.5" r="3" fill={ink} />
          <G stroke={accent} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" fill="none">
            <Path d="M15 2.5 L15 11.5" />
            <Path d="M12.5 5 L15 2.5 L17.5 5" />
            <Path d="M12.5 9 L15 11.5 L17.5 9" />
          </G>
        </>
      ) : exercise === 'sidePlank' ? (
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
  /** Push-ups start from a high plank; the plank shows a forearm plank; 'side' is a side plank; 'crunch' lies on the back. */
  variant?: PlankVariant | 'side' | 'crunch' | 'front';
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
  if (variant === 'front') {
    // Head-on (push-ups, plank): the face and shoulders with both arms down to the floor.
    const Q = (x: number, y: number) => `${(x / 100) * width} ${(y / 56) * height}`;
    const paths = [`M${Q(34, 22)} L${Q(66, 22)}`, `M${Q(34, 22)} L${Q(28, 36)} L${Q(30, 48)}`, `M${Q(66, 22)} L${Q(72, 36)} L${Q(70, 48)}`];
    const head = [50, 12];
    return (
      <Svg width={width} height={height} pointerEvents="none">
        <G
          stroke={color.chalk}
          strokeOpacity={0.55}
          strokeWidth={Math.max(3, width / 140)}
          strokeDasharray="10 9"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        >
          {paths.map((d) => (
            <Path key={d} d={d} />
          ))}
        </G>
        <Circle
          cx={(head[0] / 100) * width}
          cy={(head[1] / 56) * height}
          r={width / 30}
          stroke={color.chalk}
          strokeOpacity={0.55}
          strokeDasharray="6 6"
          strokeWidth={2}
          fill="none"
        />
        <Line
          x1={0.04 * width}
          y1={(48.5 / 56) * height}
          x2={0.96 * width}
          y2={(48.5 / 56) * height}
          stroke={color.chalk}
          strokeOpacity={0.25}
          strokeWidth={2}
        />
      </Svg>
    );
  }
  if (variant === 'crunch') {
    // On the back, knees bent, arm reaching towards the knees.
    const Q = (x: number, y: number) => `${X(x)} ${Y(y)}`;
    return (
      <Svg width={width} height={height} pointerEvents="none">
        <G
          stroke={color.chalk}
          strokeOpacity={0.55}
          strokeWidth={Math.max(3, width / 140)}
          strokeDasharray="10 9"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        >
          <Path d={`M${Q(20, 45.5)} L${Q(50, 46)} L${Q(66, 31)} L${Q(82, 47)}`} />
          <Path d={`M${Q(20, 45.5)} L${Q(35, 43)}`} />
        </G>
        <Circle
          cx={X(12)}
          cy={Y(44)}
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
