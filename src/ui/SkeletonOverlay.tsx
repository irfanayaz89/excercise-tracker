import { Canvas, Circle, Group, Path, Skia } from '@shopify/react-native-skia';
import { StyleSheet } from 'react-native';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';
import { color } from './theme';

/**
 * Data the overlay draws. Written from the JS thread on every pose frame;
 * Skia reads it on the UI thread without a React re-render.
 */
export interface OverlayData {
  /** Upright frame size the points are normalized to. */
  frameW: number;
  frameH: number;
  /** Near-side chain, normalized 0..1, already mirrored to match the preview: shoulder, elbow, wrist, hip, knee, ankle, ear. NaN = unknown. */
  pts: number[];
  /** 0 = good, 1 = cue (amber), 2 = fault (red), 3 = idle (chalk). */
  bodyState: number;
  visible: boolean;
  /** Head-on: points 7–10 are the other shoulder, elbow, wrist and hip. */
  front?: boolean;
}

export const EMPTY_OVERLAY: OverlayData = { frameW: 1280, frameH: 720, pts: [], bodyState: 3, visible: false };

const STATE_COLORS = [color.good, color.cue, color.fault, color.chalk];

export type PreviewFit = 'cover' | 'contain';

/** Maps normalized frame coords to view coords, matching the camera preview's resize mode. */
function project(d: OverlayData, vw: number, vh: number, i: number, fit: PreviewFit): { x: number; y: number } | null {
  'worklet';
  const nx = d.pts[i * 2];
  const ny = d.pts[i * 2 + 1];
  if (!(nx === nx) || !(ny === ny)) return null; // NaN check that works in worklets
  const scale = fit === 'contain' ? Math.min(vw / d.frameW, vh / d.frameH) : Math.max(vw / d.frameW, vh / d.frameH);
  const ox = (vw - d.frameW * scale) / 2;
  const oy = (vh - d.frameH * scale) / 2;
  return { x: nx * d.frameW * scale + ox, y: ny * d.frameH * scale + oy };
}

/** One path through the given joints; several runs of joints become separate strokes. */
function chain(d: OverlayData, vw: number, vh: number, runs: number[] | number[][], fit: PreviewFit) {
  'worklet';
  const p = Skia.PathBuilder.Make();
  const list = (typeof runs[0] === 'number' ? [runs] : runs) as number[][];
  for (const idx of list) {
    let started = false;
    for (const i of idx) {
      const q = project(d, vw, vh, i, fit);
      if (!q) {
        started = false;
        continue;
      }
      if (!started) p.moveTo(q.x, q.y);
      else p.lineTo(q.x, q.y);
      started = true;
    }
  }
  return p.build();
}

export function SkeletonOverlay({
  data,
  width,
  height,
  fit = 'cover',
}: {
  data: SharedValue<OverlayData>;
  width: number;
  height: number;
  fit?: PreviewFit;
}) {
  // Side-on. Arm: shoulder → elbow → wrist. Body line: ear → shoulder → hip → knee → ankle.
  // Head-on: both arms, and the shoulder line with the trunk down to the hips.
  const arm = useDerivedValue(() => {
    if (!data.value.visible) return Skia.Path.Make();
    if (!data.value.front) return chain(data.value, width, height, [0, 1, 2], fit);
    return chain(
      data.value,
      width,
      height,
      [
        [2, 1, 0],
        [7, 8, 9],
      ],
      fit,
    );
  });
  const body = useDerivedValue(() => {
    if (!data.value.visible) return Skia.Path.Make();
    if (!data.value.front) return chain(data.value, width, height, [6, 0, 3, 4, 5], fit);
    return chain(
      data.value,
      width,
      height,
      [
        [0, 7],
        [3, 10],
      ],
      fit,
    );
  });
  const bodyColor = useDerivedValue(() => STATE_COLORS[data.value.bodyState] ?? color.chalk);
  const joints = useDerivedValue(() => {
    const p = Skia.PathBuilder.Make();
    if (data.value.visible) {
      for (const i of data.value.front ? [0, 1, 2, 7, 8, 9] : [0, 1, 2, 3, 4, 5]) {
        const q = project(data.value, width, height, i, fit);
        if (q) p.addCircle(q.x, q.y, 7);
      }
    }
    return p.build();
  });
  const elbow = useDerivedValue(() => (data.value.visible ? project(data.value, width, height, 1, fit) : null));
  const ex = useDerivedValue(() => elbow.value?.x ?? -100);
  const ey = useDerivedValue(() => elbow.value?.y ?? -100);

  return (
    <Canvas style={[StyleSheet.absoluteFill, { width, height }]} pointerEvents="none">
      <Group>
        <Path path={body} color={bodyColor} style="stroke" strokeWidth={9} strokeCap="round" strokeJoin="round" opacity={0.95} />
        <Path path={arm} color={color.chalk} style="stroke" strokeWidth={7} strokeCap="round" strokeJoin="round" />
        <Path path={joints} color={color.ground} />
        <Circle cx={ex} cy={ey} r={12} color={color.vial} style="stroke" strokeWidth={4} />
      </Group>
    </Canvas>
  );
}
