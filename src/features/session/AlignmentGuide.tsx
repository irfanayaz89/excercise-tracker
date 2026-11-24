import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import type { SessionSnapshot } from '@/engine/session';
import { Label, Strong } from '@/ui/primitives';
import type { PreviewFit } from '@/ui/SkeletonOverlay';
import { color, radius, space } from '@/ui/theme';

type Edge = 'left' | 'right';

interface Props {
  snap: SessionSnapshot;
  /** Stage (camera view) size in points. */
  width: number;
  height: number;
  fit: PreviewFit;
  /** Space covered by the HUD on each side, so labels stay visible. */
  insetTop: number;
  insetRight: number;
}

/** Where the camera frame lands on screen for a given preview resize mode. */
function frameRect(frameW: number, frameH: number, vw: number, vh: number, fit: PreviewFit) {
  const scale = fit === 'contain' ? Math.min(vw / frameW, vh / frameH) : Math.max(vw / frameW, vh / frameH);
  const w = frameW * scale;
  const h = frameH * scale;
  return { left: (vw - w) / 2, top: (vh - h) / 2, width: w, height: h };
}

/**
 * Live "where should I be" hints over the camera while getting into position:
 * a dashed target zone, a box around the detected body (green when framing is
 * fine), and a glowing edge with a short instruction wherever the body is cut
 * off. Reading it takes a glance from the floor, no words needed.
 */
export function AlignmentGuide({ snap, width, height, fit, insetTop, insetRight }: Props) {
  const active = snap.phase === 'body-check' || (snap.phase === 'paused' && snap.pauseReason === 'lost-tracking');
  const p = snap.placement;
  const f = snap.framing;
  if (!active || width <= 0 || height <= 0) return null;

  // Before anyone is detected, assume the camera's usual 16:9 frame in the
  // screen's orientation, so the zone does not jump once a body appears.
  const fr = p
    ? frameRect(p.frameW, p.frameH, width, height, fit)
    : frameRect(width > height ? 16 : 9, width > height ? 9 : 16, width, height, fit);
  // The part of the frame actually on screen ("cover" crops it), minus the HUD column on the right.
  const vis = {
    left: Math.max(0, fr.left),
    top: Math.max(0, fr.top),
    right: Math.min(width - insetRight, fr.left + fr.width),
    bottom: Math.min(height, fr.top + fr.height),
  };
  const X = (x: number) => Math.min(vis.right, Math.max(vis.left, fr.left + x * fr.width));
  const Y = (y: number) => Math.min(vis.bottom, Math.max(vis.top, fr.top + y * fr.height));
  const zone = { x0: 0.04, x1: 0.96, y0: 0.3, y1: 0.96 };

  const issue = f.ok ? null : f.issue;
  const soft = f.ok ? f.hint : null;
  const nearLeft = p ? p.box.x0 < 0.05 : false;
  const nearRight = p ? p.box.x1 > 0.95 : false;
  const feetEdge: Edge | null =
    p?.headSide === 'left' ? 'right' : p?.headSide === 'right' ? 'left' : nearRight ? 'right' : nearLeft ? 'left' : null;
  const headEdge: Edge | null = feetEdge === 'left' ? 'right' : feetEdge === 'right' ? 'left' : null;

  // Which edges glow, and what to say there.
  let edges: { edge: Edge; label: string; action: string; strong: boolean }[] = [];
  const slide = (cut: Edge, part: string) => {
    // Room on the other side? Then sliding along is enough; otherwise step back.
    const roomOther = p ? (cut === 'right' ? p.box.x0 > 0.12 : p.box.x1 < 0.88) : false;
    return {
      edge: cut,
      label: `${part} off this edge`,
      action: roomOther ? (cut === 'right' ? '← Slide this way' : 'Slide this way →') : 'Move further back',
      strong: true,
    };
  };
  if (issue === 'show-feet' && feetEdge) edges = [slide(feetEdge, 'Feet')];
  else if (issue === 'show-head' && headEdge) edges = [slide(headEdge, 'Head')];
  else if (issue === 'move-back') {
    edges = [
      { edge: 'left', label: 'Too close', action: 'Move back', strong: true },
      { edge: 'right', label: 'Too close', action: 'Move back', strong: true },
    ];
  } else if (soft === 'show-feet' && feetEdge) {
    edges = [{ edge: feetEdge, label: 'Feet out of view', action: 'Fine in Easy mode', strong: false }];
  }

  const bodyOk = f.ok;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {!bodyOk && (
        <View style={[styles.zone, { left: X(zone.x0), top: Y(zone.y0), width: X(zone.x1) - X(zone.x0), height: Y(zone.y1) - Y(zone.y0) }]}>
          <Label tone="vial" style={styles.zoneLabel}>
            {issue === 'move-closer' ? 'Come closer and fill this area' : p ? 'Fit your body in here' : 'Get into this area, side-on'}
          </Label>
        </View>
      )}
      {p && (
        <View
          style={[
            styles.body,
            {
              left: X(p.box.x0) - 6,
              top: Y(p.box.y0) - 6,
              width: X(p.box.x1) - X(p.box.x0) + 12,
              height: Y(p.box.y1) - Y(p.box.y0) + 12,
              borderColor: bodyOk ? color.good : color.chalk,
            },
          ]}
        />
      )}
      {edges.map((e) => (
        <EdgeHint key={e.edge} {...e} visible={vis} insetTop={insetTop} insetRight={insetRight} />
      ))}
    </View>
  );
}

function EdgeHint({
  edge,
  label,
  action,
  strong,
  visible,
  insetTop,
  insetRight,
}: {
  edge: Edge;
  label: string;
  action: string;
  strong: boolean;
  /** The on-screen part of the camera frame. */
  visible: { left: number; top: number; right: number; bottom: number };
  insetTop: number;
  insetRight: number;
}) {
  const pulse = useSharedValue(0.35);
  useEffect(() => {
    pulse.value = withRepeat(withTiming(strong ? 0.85 : 0.45, { duration: 700 }), -1, true);
  }, [pulse, strong]);
  const glow = useAnimatedStyle(() => ({ opacity: pulse.value }));
  const tint = strong ? color.cue : color.muted;
  // The glow sits on the visible frame edge (left of the HUD column on the right).
  const glowLeft = edge === 'left' ? visible.left : visible.right - 16;
  const chipStyle = edge === 'left' ? { left: visible.left + 24 } : { right: insetRight + 24 };
  return (
    <>
      <Animated.View
        style={[styles.glow, { left: glowLeft, top: visible.top, height: visible.bottom - visible.top, backgroundColor: tint }, glow]}
      />
      <View style={[styles.chip, chipStyle, { top: insetTop, borderColor: tint }]}>
        <Label tone={strong ? 'cue' : 'muted'}>{label}</Label>
        <Strong size={17}>{action}</Strong>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  zone: {
    position: 'absolute',
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: color.vial,
    borderRadius: radius.lg,
    opacity: 0.85,
  },
  zoneLabel: { position: 'absolute', top: 8, left: 12 },
  body: { position: 'absolute', borderWidth: 2, borderRadius: radius.md, opacity: 0.9 },
  glow: { position: 'absolute', width: 16, borderRadius: 8 },
  chip: {
    position: 'absolute',
    gap: 2,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
    backgroundColor: color.scrimStrong,
    maxWidth: 240,
  },
});
