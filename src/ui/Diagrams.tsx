import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import type { PhoneOrientation } from '@/engine/types';
import { color, font } from './theme';

/** Setup sketch: phone on the floor, side-on to a plank, at the distance for the picked orientation. */
export function SetupDiagram({ width = 320, orientation = 'landscape' }: { width?: number; orientation?: PhoneOrientation }) {
  const h = width * 0.3;
  const portrait = orientation === 'portrait';
  const distance = portrait ? '2.5–3 m' : '1.5–2 m';
  return (
    <Svg
      width={width}
      height={h}
      viewBox="0 40 320 96"
      accessibilityLabel={`Stand the phone on the floor in ${orientation}, ${distance} to the side of your push-up spot`}
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
      {/* person in plank, head left */}
      <G stroke={color.chalk} strokeWidth={5} strokeLinecap="round" fill="none">
        <Path d="M172 82 L182 114" />
        <Path d="M172 82 L230 96 L290 112" />
      </G>
      <Circle cx="160" cy="76" r="8" fill={color.chalk} />
      <Line x1="168" y1="80" x2="292" y2="111" stroke={color.vial} strokeWidth={1.5} strokeDasharray="5 4" />
    </Svg>
  );
}

/** Top and bottom of a counted rep, side by side. */
export function RepDiagram({ width = 320 }: { width?: number }) {
  return (
    <Svg width={width} height={width * 0.225} viewBox="0 32 320 72" accessibilityLabel="A rep counts from arms locked at the top down to elbows at about 90 degrees and back up">
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

/** Dashed target outline shown over the camera while waiting for a plank. */
export function PlankGhost({ width, height, facing }: { width: number; height: number; facing: 'left' | 'right' }) {
  // Normalized plank pose in a 100×56 box, head on the left.
  const flip = facing === 'right';
  const X = (x: number) => ((flip ? 100 - x : x) / 100) * width;
  const Y = (y: number) => (y / 56) * height;
  const pts = {
    head: [16, 22],
    shoulder: [22, 27],
    wrist: [23, 47],
    hip: [52, 35],
    ankle: [86, 46],
  };
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
        <Path d={`M${P('shoulder')} L${P('wrist')}`} />
        <Path d={`M${P('shoulder')} L${P('hip')} L${P('ankle')}`} />
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
