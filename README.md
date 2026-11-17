# Trueline — camera push-up, crunch, plank and side plank tracker

Working name. An Expo app that watches you through the phone camera and
checks your position for four exercises:

- **Push-ups**: counts and grades every rep.
- **Crunches**: counts every crunch and flags sitting all the way up, feet lifting and rushing.
- **Plank**: times the hold, and only counts time in good form.
- **Side plank**: times each side on its own, and compares left and right.

Exercises are defined in one registry (`src/engine/exercises.ts`), so adding
one starts there.

All tracking runs on the phone; no video is stored or sent anywhere.

New to the code? [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) walks through how
it runs, from a camera frame to a counted rep, file by file.

## How a set works

0. **First launch** runs a short setup (about a minute; "Use recommended
   setup" skips most of it). One question per screen, with a progress bar,
   Back and Skip:
   1. Which exercises you want (shown first on Home).
   2. How strict: Easy / Medium / Hard.
   3. How much help: **Guided** or **Quick**.
   4. A daily goal (Light, Regular, Serious or none). Home shows bars for reps
      (push-ups and crunches) and plank time.
   5. A quick safety check (back, neck, wrist, pregnancy, recent injury).
      Never blocking; it only adds "Take care" notes on each exercise, and it
      stays on the phone.
   6. Voice coach on or off, with a sample.
   7. How the phone stands: landscape or portrait, front or back camera, and
      **side-on or facing the phone** for push-ups and the plank.
   8. Camera access, explained before the system asks.
   9. On iPhone in landscape: turn off Rotation Lock.
   10. A summary with every answer, each tappable to change.

   Everything can be changed later in Settings, which also has **Redo setup**.
1. **Pick the exercise** on Home. Home shows today's totals, one card per
   exercise and recent sets (filterable by exercise). Each card opens the
   exercise's own screen: this week, personal best, setup, level, target
   (reps, or 0:30 to 2:00; per side for the side plank), Start and its history.
   Each screen also has **How to do it**: an animated figure doing the
   exercise as the camera sees it, a top-down map of where the phone goes
   (level with your hips, at a right angle to your body, at the right
   distance), and the numbered steps. **Step-by-step guide** opens the full
   guide to read at any time.
   - **The guide** comes before every set in Guided mode, and before anyone's
     first set of an exercise. One step per page: place the phone (with the
     animation), get in view, how to do it, mistakes to avoid (with breathing,
     how much to start with, and who should take care), then what counts.
2. **Place the phone.** Pick **Landscape** (1.5–2 m away) or **Portrait**
   (2.5–3 m away). Stand it on the floor that way, side-on. A spirit-level
   vial (gravity sensor) waits until it is level and still. No sensor or
   permission denied → a "Phone is set" button instead.
   - **Landscape needs Rotation Lock off** (Auto-rotate on, on Android). The
     set screen locks itself to landscape; with Rotation Lock on, iOS can keep
     it on the other landscape side from the way the phone stands, and the
     camera picture reaches the tracker upside down. So Start asks first
     ("Don't remind me" turns it off; it is also in Settings), and the guide
     says it on its first page.
   - **Upside-down picture check:** if the body shows upside down for a second
     (shoulders below the feet; for crunches, bent knees pointing down), the
     set will not start and says to check Rotation Lock. A flipped picture
     inverts hip sag, push-up depth and crunch lift, so it must never count.
     With the feet out of view (Easy) it falls back to the hands (push-ups,
     planks) or a lying body's knees (crunches). The one case it cannot tell
     is a side plank on Easy with the feet out of view; the reminder covers it.
3. **Body check.** The body must be in frame, side-on, in a valid starting
   position held for a moment (0.5–1.2 s by level), which also calibrates
   the set.
   - Push-ups start from a high plank (arms locked).
   - The plank accepts a **high plank** (arms straight) or a **forearm
     plank** (forearms on the floor, elbows under shoulders); the type is
     detected automatically. A hold that already breaks the hip limits does
     not start.
4. **Count or time.**
   - **Push-ups**: a rep counts when the elbow goes from lockout (>155°, or
     the arm you held the start plank with if that was less straight) to
     depth (<95°, confirmed by shoulder drop) and back. Each rep is graded for
     hip sag, hip pike, rushing and head position. Faulty reps still count but
     are flagged; partial reps are not counted and get a cue.
   - **Plank**: the clock runs only while the body stays in one line. Hips
     drifting or slowly sinking get a warning first; a fault has to last a
     short grace period before the clock stops ("Clock stopped. Hips up"), and
     good form has to hold for 0.5 s before it runs again. A dropped head is a
     tip, never a stop. The voice calls the time every 15 s and counts down the
     last 5 s to the target. **Test mode** (Settings → Plank) ends the hold at
     the first real form break instead, for max-hold tests.
5. **Summary.** Push-ups: total, clean reps, tally, faults, misses, tempo.
   Plank: time in good form, % good form, longest unbroken hold, breaks,
   plank type and time lost per fault. Both are saved to history.

Standing up, losing tracking, the phone being knocked or the app going to the
background pauses the set and keeps the count or time; get back into position
to carry on.

## Side-on or facing the phone

Push-ups and the plank can be tracked two ways, picked during setup or on the
exercise's screen. Crunches are side-on only (a head-on camera can't measure
the curl well), and the side plank is always done facing the phone.

- **Side-on** (the default): the phone beside you sees your profile. Full form
  checks, including the hip line.
- **Facing the phone (front)**: easier to set up, as most rep-counting apps do.
  - Push-ups and planks: the phone stands upright on the floor 1.2–2 m beyond
    your hands (portrait fits best). Face, shoulders and both hands in view.

Head-on, the body points at the camera, and pose models are least accurate in
depth, so everything is measured across the picture in shoulder widths:

| | Front counts / times by | Front checks | Only side-on |
|---|---|---|---|
| Push-ups | Shoulders dropping towards the hands | Depth, lockout, half reps, rushing, **elbows flaring**, **one side lower (uneven)** | Hip sag and pike, body line, head |
| Plank | Holding position, forearms or straight arms | Elbows/hands under shoulders, leaving position | Hip sag and pike |

Front view also checks framing head-on ("Show both hands", move closer/back),
the upside-down picture, and the shaking-screen check (both hands). Research
note: the only controlled study (Oliosi 2026) found head-on
push-up counting worse than side or diagonal views at long distances, so the
thresholds are starting values to tune with real recordings.

Tests build bodies in 3D and photograph them with a phone camera placed in
front (`src/engine/testing/synth3d.ts`), so front and side tests describe the
same movements (`frontView.test.ts`).

## Crunches

You lie on your back, side-on to the phone, knees bent and feet flat; arms
across the chest, fingertips by the ears, or reaching to the knees all work
(only the shoulder, hip and knee are needed, so hands hidden behind the head
are fine).

- **Lift** is the angle of the hip→shoulder line, measured from your own
  resting angle (calibrated while you lie still before the set, so a crooked
  phone or a raised rest does not change what counts).
- **A crunch counts** when the shoulders lift past the counting line and come
  back down. Lines by level (degrees above rest): Hard 22, Medium 18, Easy 15.
  Curl-up tests define the top as about 30° of trunk flexion, and the abs do
  the first 20–30° (Liang 2010; Juker/McGill 1998).
- **Not counted:** half crunches (lifted past 11°, 9° on Easy, but not to the line), pulsing
  at the top without lowering, and holding at the top for over 10 s.
- **Counted but flagged** (Medium and Hard): sitting all the way up (past
  50–58°, the hip flexors take over), feet coming off the floor, and rushing.
  Pulling the chin to the chest is a tip that costs a few points.
- **Pauses:** sitting or standing up, stretching the legs out flat, or
  leaving the frame. The count is kept.
- Counting reads a 5-frame median of the lift: crunches are slow, so the
  ~70 ms of lag costs nothing, and a single misread shoulder frame cannot
  tip a crunch over a line.
- The real-person check watches the hips and feet for a shaking screen (the
  hands move with the body in a crunch).

## Side plank

You lie on one side **facing the phone** (same phone placement as the other
exercises), on your forearm or a straight arm, feet stacked.

- The side on the floor is the one whose shoulder is lower in the picture.
- The start check wants the shoulders stacked (one above the other), the
  elbow or hand under the shoulder, hips up in one line, legs straight
  (Easy accepts a side plank on the knees).
- The clock stops for hips dropping or rising, **rolling** forward or back
  (shoulders no longer stacked), the elbow drifting from under the shoulder,
  a bending support arm, soft knees, or the feet leaving view (Medium/Hard).
- **Each side is timed on its own.** With a target, it is per side: at the
  target you hear "Time. Switch sides", the set waits for the other side and
  finishes when both are done. Turning onto the other side mid-hold starts that
  side's clock.
- The summary shows each side and whether they are balanced (within 5%, as in
  McGill's side-bridge test).


Picked on Home or in Settings; presets live in `src/engine/difficulty.ts`
(push-ups) with plank-only changes on top (`PLANK_PRESETS`). Hard is the
default config in `src/engine/config.ts`.

**Both exercises**

| | Easy (default) | Medium | Hard |
| --- | --- | --- | --- |
| In view | Arms, shoulders, hips (feet optional) | Whole body | Whole body |
| Phone level | ±12° tilt, 35° lean, skippable | ±8°, 25°, skippable | ±5°, 20° |
| Start hold | 0.5 s | 0.9 s | 1.2 s |

**Push-ups**

| | Easy | Medium | Hard |
| --- | --- | --- | --- |
| Start position | Body roughly flat (≤55°), arms mostly straight (≥130°), knees OK | + hips in line, legs straight | + hands under shoulders |
| Rep depth / lockout | elbow < 110° / > 145° | < 100° / > 150° | < 95° / > 155° |
| Lockout if you start with slightly bent arms | back to your start angle | back to your start angle | back to your start angle |
| Form flags | none (count only) | hips, rushed | hips, rushed, head |

**Plank**

| | Easy | Medium | Hard |
| --- | --- | --- | --- |
| Body line (shoulder–hip–ankle) | ≥ 145° | ≥ 155° | ≥ 165° |
| Hip sag / pike that stops the clock (torso lengths) | 0.20 / 0.25 | 0.14 / 0.18 | 0.10 / 0.12 |
| Grace before the clock stops | 2 s | 1.5 s | 1 s |
| Knees | knee planks fine | must stay straight (< 135° stops the clock) | must stay straight (< 145°) |
| Feet out of view | clock keeps running | clock waits ("Show your feet") | clock waits |
| Hands drifting from under the shoulders (high plank) | — | — | warning only |

A slight hip raise ("an inch up", about 0.05 torso lengths) never draws a cue;
raised hips get more room than sagging before any warning.

While getting into position, an on-screen guide shows a target zone, a box around
the detected body, and a glowing edge with an instruction wherever the body is cut off.

## Real-person check

A video of someone doing push-ups or a plank, shown on a screen in front of the
camera, must not count. **Settings → Camera → Real-person check** (on by
default) runs two independent checks:

- **Depth (iPhone):** the app picks the depth-capable camera on the chosen side
  (front TrueDepth or the back dual camera) and reads depth at the body and in
  the space above the back. A real body stands out from what is behind it and
  has a human size; a person on a TV is flat with their surroundings, and a
  person on a phone screen is a few centimetres tall.
- **Handheld screen (every phone, Android included):** with the phone itself
  still (gyro), a real person's hands and feet stay planted. A screen held up
  to the camera shakes them all together.

Only sustained, clear evidence (about 3 s) gives a verdict; unclear readings
give none. When it fires, the set pauses with a red "Real person needed" panel,
**reps or plank time from the suspicious seconds are taken back**, and the set
stays paused until there has been no sign of a screen for 2 s. A screen shown
before the set starts means it never starts. If depth cannot be paired with
the camera frames, the app falls back to normal tracking.

Limit: a large screen on a stand, on a phone without depth (most Android
phones), can still get past it.

## Stack

| Layer | Choice |
| --- | --- |
| App | Expo SDK 58 (React Native 0.88, New Architecture), dev builds, Expo Router |
| Camera | `react-native-vision-camera` v5 Frame Outputs, RGB, 720p, 30 fps; Depth Output + output synchronizer on iPhone |
| Pose model | MediaPipe Pose Landmarker (Full, Lite fallback), 33 landmarks |
| Native bridge | Our Nitro module `modules/pose-landmarker` (Swift + Kotlin) |
| Logic | Pure TypeScript engine in `src/engine` (no RN imports, Jest-tested) |
| Overlay | Skia canvas driven by a Reanimated shared value |
| Feedback | `expo-speech` voice coach, haptics during setup only |
| Storage | `expo-sqlite` history (push-up reps and plank time), `expo-sqlite/kv-store` settings |

## Layout

```
modules/pose-landmarker/   Nitro module: TS spec, Swift, Kotlin, models/ (downloaded)
scripts/fetch-models.mjs   downloads the .task models (runs on postinstall)
src/engine/                session state machine, gates, rep counter, plank hold timer,
                           real-person check, filters, recording/replay
src/engine/__tests__/      edge-case, stress and real-person tests + replay of real recordings
src/camera/                VisionCamera frame output → native model → PoseSample; depth sampling
src/sensors/               DeviceMotion → phone attitude
src/session/               controller hook, voice coach, copy, per-set config, recordings
src/features/session/      live-screen panels and HUD (rep count, plank clock), demo scenarios
src/features/exercise/     how-to steps, mistakes and safety for each exercise (technique.ts)
src/ui/                    design tokens and components (exercise picker, level vial, hips gauge,
                           tally marks, depth gauge, overlay, diagrams, the guide animation)
src/app/                   routes: home, guide, session, summary/[id], settings
fixtures/recordings/       real recorded sets used as regression tests
```

Key engine files: `exercises.ts` (the exercise registry), `session.ts` (all exercises), `repCounter.ts` (push-ups), `crunchCounter.ts` (crunches),
`holdTimer.ts` (plank and side plank), `gates.ts` (phone, framing, start position),
`reality.ts` (real-person check).

## Running

```bash
npm install            # also downloads the pose models (~15 MB)
npx expo run:ios       # or: npx expo run:android  (physical device needed for the camera)
npm test               # engine tests
npm run typecheck && npm run lint
```

Expo Go cannot run this app (custom native code). On a simulator, use
**Home → Preview a demo set** (dev builds only) to see the live screen driven
by a synthetic body through the real engine (from an exercise's screen). Every
edge case has a scenario: `trueline:///session?demo=<basic|nofeet|standup|lost|swap|knocked|shake|tv|faults>&ex=<pushup|crunch|plank|sidePlank>&level=<easy|medium|hard>&view=<side|front>`. Every scenario is also played through the engine in `demoScenarios.test.ts`.

After editing `modules/pose-landmarker/src/PoseLandmarker.nitro.ts`, run
`npm run codegen` and rebuild.

## Edge cases handled

**Both exercises**

- Phone: lying flat, turned the wrong way for the picked orientation, tilted, leaning, moving, no sensor, knocked mid-set (pauses, must re-level; measured from where the phone was resting, at every difficulty).
- Portrait: the camera preview shows the whole frame (no side cropping) so head and feet stay visible on screen.
- Framing: nobody, too close, too far, feet or head cut off, facing the camera, low light.
- Real-phone noise: single misread frames are removed by a 5-frame median before the start check and form grading; a failing reading under 350 ms does not reset the start hold (`src/engine/__tests__/realdevice.test.ts`).
- Signal: jitter (One Euro filter + hysteresis), dropped frames, low fps, short dropouts (held 200 ms), left/right side flicker, user turning around.
- Another person: a swap is judged against the median of the last few frames, so it cannot slip through in small steps and a single misread hip cannot trigger it.
- A video on a screen instead of a person (see Real-person check).
- App: background/foreground, camera interruption or error (restart), model load failure (retry / light model), slow phone (auto-switch to light model), GPU failure (CPU fallback), missing model file, storage failure.

**Push-ups**

- Position: kneeling (optional), sagging/piked start, bent arms, standing up mid-set (pauses).
- Reps: half reps, no lockout, bounced/noise reps, rushed reps, stalling at the bottom, occluded elbow (shoulder-drop fallback), a "straight" arm that never reads 180°.
- Form is judged on the rep's typical frames (15th/85th percentile), not its single worst one.
- No room for the whole body (Medium/Hard): after 6 s of "show your feet" the setup panel suggests landscape (fits at 1.5–2 m) or Easy.

**Plank**

- Never starts from standing, half-bent arms, hips already past the limit, or (Medium/Hard) the knees.
- Hips sinking slowly (fatigue) are warned about well before the clock stops; near misses and short wobbles never stop it.
- Switching from a high plank down to the forearms mid-hold keeps the clock running.
- Feet leaving view on Medium/Hard stops the clock until they are back, so sagging out of view never counts.
- Soft knees, bent arms and elbows out from under the shoulders stop the clock; the knee check follows "Allow knees down".
- Pauses (lost from view, camera stall, app in the background, phone knocked, someone else) keep the time; a fault cut short by a pause is never counted as a break.
- Endings: target reached (also while form is only slipping), no repeated countdown after a break near the target, paused over a minute, stuck out of form for 45 s, test mode.
- History stores plank time in its own columns, added automatically to databases from before planks existed.

**How it is tested**

- Every scenario runs at all three difficulties, in portrait and landscape frames, facing either way (`matrix.test.ts`, `plank.test.ts`, `plankEdge.test.ts`, `sidePlank.test.ts`, `crunch.test.ts`, `realPerson.test.ts`).
- Randomised sets: `stress.test.ts` (push-ups), `crunchStress.test.ts` (crunches: full, half and sit-up crunches with misread shoulder and hip frames) and `plankStress.test.ts` (plank and side plank, with real breaks, near misses, short blips and soft knees). 40 per level by default; `STRESS_TRIALS=400 npx jest stress plankStress` for more. Random noise, misread joints, speeds, body size, frame shape, facing and phone roll, with exact count / break checks.
- The depth sampler is tested against fake depth maps in every buffer rotation, mirrored, and in 16-bit and disparity formats (`src/camera/__tests__/depthProbe.test.ts`).

## Tuning with real sets (Phase 4)

Turn on **Settings → Record sets for tuning**, do sets, share the recording,
add the hand-counted `expected` block and drop it in `fixtures/recordings/`.
`npm test` replays every recording; plank recordings replay as planks. See
`fixtures/recordings/README.md`.

All thresholds live in `src/engine/config.ts` (with level changes in
`src/engine/difficulty.ts`).

## Live diagnostics on a phone (dev builds only)

Run `node scripts/diag-server.mjs` on the Mac serving Metro. During a set, a
development build posts one line a second (phase, framing issue, plank issues,
trunk tilt, elbow angle, phone roll/pitch, body box, reps or plank hold state,
and the real-person check's depth stand-out and torso size) to it over the
local network. Release builds never send anything.

## Known gaps / to verify on device

- Crunches, plank, side plank and the real-person check have only been tested with synthetic bodies and fake depth maps. Still to check on a real phone: plank limits with real body noise, forearm-plank detection, and whether the iPhone's depth reaches 1.5–3 m clearly enough (watch `real=…(standout …m torso …m)` in the diagnostics line). Adding the depth output may also change the video format the pose model gets.
- The app has not been run on an Android phone with the plank or real-person check yet; the logic is shared and tested, the native camera path is not.
- iOS: MediaPipe returns landmarks in the un-rotated sensor buffer's coordinates; the native module rotates them upright per `frame.orientation` (fixed after a portrait device test where push-ups read as standing). The rotation direction is confirmed when the diagnostics line shows `sh` (shoulder above wrist) positive in a plank.
- Frames follow the locked screen (`orientationSource="interface"`) and mirroring is explicit (`mirrorMode` on for the front camera); confirm the skeleton sits on the body on real hardware.
- Phone roll is consistent across both landscape sides and both platforms; whether the tilt correction should add or subtract it is still to confirm on a device (watch `tilt` in tracking details with the phone slightly crooked).
- Android converts each frame to a bitmap and rotates it (two ~3.7 MB allocations per frame). Correct, but GC-heavy; passing rotation to MediaPipe instead needs a device test first.
- MediaPipe's CocoaPods are deprecated in favour of SPM (still resolve today, v1.0.1).
- Thresholds are research starting values; tune them with recordings from real users.
