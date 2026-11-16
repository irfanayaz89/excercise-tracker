# Trueline — camera push-up tracker

Working name. An Expo app that watches you through the phone camera, checks
your position, and counts and grades every push-up. All tracking runs on the
phone; no video is stored or sent anywhere.

## How a set works

0. **First launch** asks how much help you want: **Guided** (setup guide
   before each set, full spoken instructions, checklists, tips after the set)
   or **Quick** (one tap to start, short cues, compact screens). Changeable in
   Settings.
1. **Place the phone.** Pick **Landscape** (1.5–2 m away) or **Portrait**
   (2.5–3 m away) on Home. Stand it on the floor that way, side-on. A
   spirit-level vial (gravity sensor) waits until it is level and still,
   measured against the picked orientation. No sensor or permission denied →
   a "Phone is set" button instead.
2. **Body check.** The whole body must be in frame, side-on, in a valid high
   plank (arms locked, body in one line, legs straight, hands under shoulders).
   Hold it for 1.2 s; that also calibrates your lockout height.
3. **Count and grade.** A rep counts when the elbow goes from lockout (>155°,
   or the arm you held the start plank with if that was less straight)
   to depth (<95°, confirmed by shoulder drop) and back. Each rep is graded for
   hip sag, hip pike, rushing and head position. Faulty reps still count but
   are flagged; partial reps are not counted and get a cue.

## Difficulty

Picked on Home or in Settings; presets live in `src/engine/difficulty.ts`.

| | Easy (default) | Medium | Hard |
| --- | --- | --- | --- |
| In view | Arms, shoulders, hips (feet optional) | Whole body | Whole body |
| Phone level | ±12° tilt, 35° lean, skippable | ±8°, 25°, skippable | ±5°, 20° |
| Start position | Body roughly flat (≤55°), arms mostly straight (≥130°), knees OK | + hips in line, legs straight | + hands under shoulders |
| Rep depth / lockout | elbow < 110° / > 145° | < 100° / > 150° | < 95° / > 155° |
| Lockout if you start with slightly bent arms | back to your start angle | back to your start angle | back to your start angle |
| Form flags | none (count only) | hips, rushed | hips, rushed, head |

While getting into position, an on-screen guide shows a target zone, a box around
the detected body, and a glowing edge with an instruction wherever the body is cut off.

## Stack

| Layer | Choice |
| --- | --- |
| App | Expo SDK 58 (React Native 0.88, New Architecture), dev builds, Expo Router |
| Camera | `react-native-vision-camera` v5 Frame Outputs, RGB, 720p, 30 fps |
| Pose model | MediaPipe Pose Landmarker (Full, Lite fallback), 33 landmarks |
| Native bridge | Our Nitro module `modules/pose-landmarker` (Swift + Kotlin) |
| Logic | Pure TypeScript engine in `src/engine` (no RN imports, Jest-tested) |
| Overlay | Skia canvas driven by a Reanimated shared value |
| Feedback | `expo-speech` voice coach, haptics during setup only |
| Storage | `expo-sqlite` history, `expo-sqlite/kv-store` settings |

## Layout

```
modules/pose-landmarker/   Nitro module: TS spec, Swift, Kotlin, models/ (downloaded)
scripts/fetch-models.mjs   downloads the .task models (runs on postinstall)
src/engine/                session state machine, gates, rep counter, filters, recording/replay
src/engine/__tests__/      edge-case tests + replay of real recordings
src/camera/                VisionCamera frame output → native model → PoseSample
src/sensors/               DeviceMotion → phone attitude
src/session/               controller hook, voice coach, copy, recordings
src/features/session/      live-screen panels and HUD
src/ui/                    design tokens and components (level vial, tally marks, gauge, overlay)
src/app/                   routes: home, session, summary/[id], settings
fixtures/recordings/       real recorded sets used as regression tests
```

## Running

```bash
npm install            # also downloads the pose models (~15 MB)
npx expo run:ios       # or: npx expo run:android  (physical device needed for the camera)
npm test               # engine tests
npm run typecheck && npm run lint
```

Expo Go cannot run this app (custom native code). On a simulator, use
**Home → Preview a demo set** (dev builds only) to see the live screen driven
by a synthetic body through the real engine.

After editing `modules/pose-landmarker/src/PoseLandmarker.nitro.ts`, run
`npm run codegen` and rebuild.

## Edge cases handled

- Phone: lying flat, turned the wrong way for the picked orientation, tilted, leaning, moving, no sensor, knocked mid-set (pauses, must re-level; measured from where the phone was resting, at every difficulty).
- Portrait: the camera preview shows the whole frame (no side cropping) so head and feet stay visible on screen.
- Framing: nobody, too close, too far, feet or head cut off, facing the camera, low light.
- Position: kneeling (optional), sagging/piked start, bent arms, standing up mid-set (pauses).
- Real-phone noise: single misread frames are removed by a 5-frame median before the start check and form grading (counting stays raw); a failing reading under 350 ms does not reset the start hold; form is judged on the rep's typical frames (15th/85th percentile), not its single worst one (`src/engine/__tests__/realdevice.test.ts`).
- Signal: jitter (One Euro filter + hysteresis), dropped frames, low fps, short dropouts (held 200 ms),
  occluded elbow (shoulder-drop fallback), left/right side flicker, user turning around, another person in view.
- Reps: half reps, no lockout, bounced/noise reps, rushed reps, stalling at the bottom, a "straight" arm that never reads 180°.
- Every scenario above runs at all three difficulties, in portrait and landscape frames, facing either way (`src/engine/__tests__/matrix.test.ts`).
- Randomised sets (`src/engine/__tests__/stress.test.ts`): 40 per level by default, `STRESS_TRIALS=300 npx jest stress` for more; random noise, misread joints, speeds, depths, body size, frame shape, facing and phone roll, with exact count checks.
- No room for the whole body (Medium/Hard): after 6 s of "show your feet" the setup panel suggests landscape (fits at 1.5–2 m) or Easy.
- App: background/foreground, camera interruption or error (restart), model load failure (retry / light model),
  slow phone (auto-switch to light model), GPU failure (CPU fallback), missing model file, storage failure.

## Tuning with real sets (Phase 4)

Turn on **Settings → Record sets for tuning**, do sets, share the recording,
add the hand-counted `expected` block and drop it in `fixtures/recordings/`.
`npm test` replays every recording. See `fixtures/recordings/README.md`.

All thresholds live in `src/engine/config.ts`.

## Live diagnostics on a phone (dev builds only)

Run `node scripts/diag-server.mjs` on the Mac serving Metro. During a set, a
development build posts one line a second (phase, framing issue, plank issues,
trunk tilt, elbow angle, phone roll/pitch, body box) to it over the local
network. Release builds never send anything.

## Known gaps / to verify on device

- iOS: MediaPipe returns landmarks in the un-rotated sensor buffer's coordinates; the native module rotates them upright per `frame.orientation` (fixed after a portrait device test where push-ups read as standing). The rotation direction is confirmed when the diagnostics line shows `sh` (shoulder above wrist) positive in a plank.
- Frames follow the locked screen (`orientationSource="interface"`) and mirroring is explicit (`mirrorMode` on for the front camera); confirm the skeleton sits on the body on real hardware.
- Phone roll is now consistent across both landscape sides and both platforms; whether the tilt correction should add or subtract it is still to confirm on a device (watch `tilt` in tracking details with the phone slightly crooked).
- Android converts each frame to a bitmap and rotates it (two ~3.7 MB allocations per frame). Correct, but GC-heavy; passing rotation to MediaPipe instead needs a device test first.
- MediaPipe's CocoaPods are deprecated in favour of SPM (still resolve today, v1.0.1).
- Thresholds are research starting values; tune them with recordings from real users.
