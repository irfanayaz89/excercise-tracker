import { useEffect, useLayoutEffect, useRef } from 'react';
import { hold, plank, rep, timeline, type Segment } from '@/engine/testing/synth';
import type { Exercise, PhoneAttitude, PoseSample } from '@/engine/types';

/**
 * Demo mode: plays a scripted synthetic set through the real engine with no
 * camera. Used to preview the live screen on simulators and in design review.
 *
 * Push-ups: phone settles → feet out of frame → plank → clean reps → a
 * sagging rep → a half rep → more reps, then loops.
 */
const PUSHUP_SCRIPT: Segment[] = [
  hold(1600, { hide: { ankle: 0.1 } }),
  hold(2600),
  rep(1700),
  rep(1700),
  rep(1600),
  rep(1700, 80, 172, (k) => ({ sag: 0.4 * Math.sin(Math.PI * k) })),
  rep(1500, 118),
  rep(1700),
  rep(1600),
  hold(1200),
  rep(1700),
  rep(1700),
  hold(2000),
];

/**
 * Plank: feet out of frame → a steady hold past the first time call → hips
 * slowly sinking (warning, then the clock stops) → fixed → steady again, then loops.
 */
const PLANK_SCRIPT: Segment[] = [
  plank(1600, { hide: { ankle: 0.1 } }),
  plank(18000),
  plank(4000, (k) => ({ sag: 0.3 * k })),
  plank(2500, { sag: 0.3 }),
  plank(1200, (k) => ({ sag: 0.3 * (1 - k) })),
  plank(10000),
];

export function useDemoFeed(
  enabled: boolean,
  portrait: boolean,
  onPose: (s: PoseSample) => void,
  onAttitude: (a: PhoneAttitude) => void,
  /** Keep the legs out of view the whole time (a room too small for the whole body). */
  noFeet = false,
  exercise: Exercise = 'pushup',
) {
  const pose = useRef(onPose);
  const att = useRef(onAttitude);
  useLayoutEffect(() => {
    pose.current = onPose;
    att.current = onAttitude;
  });

  useEffect(() => {
    if (!enabled) return;
    // Portrait frames are tall and narrow, like a real upright camera.
    const size = portrait ? { noisePx: 3, width: 720, height: 1280, torsoPx: 190 } : { noisePx: 3 };
    const base = noFeet ? { ...size, hide: { ankle: 0.1, knee: 0.1 } } : size;
    const frames = timeline(exercise === 'plank' ? PLANK_SCRIPT : PUSHUP_SCRIPT, { startT: 0, base });
    const length = frames[frames.length - 1].t + 33;
    const t0 = performance.now();
    let i = 0;
    let loop = 0;
    const id = setInterval(() => {
      const now = performance.now();
      att.current({ t: now, rollDeg: 0.6 * Math.sin(now / 900), pitchDeg: 3, motionDegPerSec: 0.5 });
      const local = now - t0 - loop * length;
      while (i < frames.length && frames[i].t <= local) {
        const f = frames[i++];
        pose.current({ ...f, t: t0 + loop * length + f.t });
      }
      if (i >= frames.length) {
        i = 0;
        loop += 1;
      }
    }, 33);
    return () => clearInterval(id);
  }, [enabled, portrait, noFeet, exercise]);
}
