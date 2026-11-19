# Screen Time: build plan

Limit distracting apps, lock them at set times, and let people earn time back
by exercising in Trueline. This plan covers what we build, how it works on
iPhone and Android, how strict it can be, how we test it, and the order of work.

Status: Phase 1 done (the rules engine in `src/screentime/`, 108 tests). Nothing native built yet. Research done Nov 2026 (competitors, Apple
Screen Time API, Android options, store rules). Items marked **[verify]** need a
check on a real device before we promise them.

## Contents

1. [What we're building](#1-what-were-building)
2. [Lock times (custom schedules)](#2-lock-times-custom-schedules)
3. [Strictness levels](#3-strictness-levels)
4. [Earning time](#4-earning-time)
5. [Rules for combining limits, lock times and earned time](#5-rules-for-combining-limits-lock-times-and-earned-time)
6. [Screens and settings](#6-screens-and-settings)
7. [iPhone architecture](#7-iphone-architecture)
8. [Android architecture](#8-android-architecture)
9. [Data model](#9-data-model)
10. [Bypass: what we can and can't stop](#10-bypass-what-we-can-and-cant-stop)
11. [Edge cases and testing](#11-edge-cases-and-testing)
12. [Phases](#12-phases)
13. [Risks and open questions](#13-risks-and-open-questions)
14. [Apple permission request (draft)](#14-apple-permission-request-draft)

---

## 1. What we're building

| Feature              | What the user gets                                                                                                     |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Blocked apps**     | Pick apps or whole categories (e.g. Social) with the system picker.                                                    |
| **Always allowed**   | Apps that are never blocked (Phone, Messages, Maps, banking…), even inside a blocked category.                         |
| **Daily limit**      | e.g. 60 min a day across the blocked apps. When used up, they're blocked until midnight.                               |
| **Lock times** (new) | Set times when the blocked apps can't be opened at all, e.g. 22:00–07:00 every night, 09:00–17:00 on weekdays. See §2. |
| **Earn time**        | Verified exercise in Trueline adds minutes (e.g. 20 push-ups = +20 min).                                               |
| **Strictness**       | Nudge / Standard / Strict (§3), chosen in settings. Parent mode later.                                                 |
| **Honest history**   | Time used, time earned, lock times kept, and any time protection was switched off.                                     |

Out of scope for the first release: accountability partners (needs a server),
website blocking beyond Safari domains, Mac/iPad.

## 2. Lock times (custom schedules)

A **lock time** is a recurring window when the chosen apps are blocked outright.
It doesn't matter how much daily time is left or earned.

**Each lock time has:**

- **Name** (Sleep, Work, Family dinner…) and **icon**.
- **Days** (any of Mon–Sun) and **start / end** time. It may cross midnight (22:00–07:00).
- **Which apps:** the main blocked list (default) or its own pick.
- **Earning during it:** _off_ (default, truly locked) or _on_ (exercise can still unlock minutes).
- **Emergency unlock during it:** follows the strictness level (§3).
- **On / off** switch, plus "Skip today" (subject to strictness).

**Presets offered when adding one:** Sleep (22:00–07:00 daily), Work (09:00–17:00 Mon–Fri),
Morning (until 09:00), Study, Custom.

**Limits we design for:**

- **Maximum 8 lock times.** Apple caps how many schedules we can watch (about 20 in total); each lock time uses one, and daily limits and earned time need the rest.
- **At least 15 minutes long.** That's the shortest window Apple allows.
- **Overlapping lock times merge.** The app is locked if any of them is active.
- **Overnight windows:** a window that crosses midnight is either one window that wraps round, or two halves split at midnight **[verify which iOS accepts reliably]**.

**What the user sees during a lock time:** the blocked screen says **"Locked until 07:00 · Sleep"**.

- _Earning off:_ the only button is "Close". In Standard, a menu offers "Emergency 10 min" if one is left today.
- _Earning on:_ the buttons include "Earn time (20 push-ups)".

**Strict mode rules for lock times:**

- A lock time can't be edited, switched off, deleted or skipped while it's running.
- Changes that loosen it (shorter, fewer days, switched off) take effect the next day.
- Changes that tighten it take effect at once.

## 3. Strictness levels

|                                         | **Nudge**                                 | **Standard** (default)                                 | **Strict**                                                                                    | **Parent** (later)                 |
| --------------------------------------- | ----------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------- | ---------------------------------- |
| Limit reached                           | Blocked screen + "1 more minute" (3×/day) | Blocked; earn time back, or the daily emergency unlock | Blocked; earn time back                                                                       | Blocked; earn time back            |
| Lock time                               | Blocked + "1 more minute"                 | Blocked; 1 emergency unlock/day (10 min)               | Blocked; no emergency unlock                                                                  | Blocked; parent can grant          |
| Changing settings                       | Any time                                  | Loosening takes effect tomorrow                        | Locked for the period chosen (1–30 days); apps can only be added; loosening needs a 24 h wait | Parent only                        |
| Turning it off                          | Any time                                  | Any time (recorded)                                    | 100 verified push-ups or a 24 h wait                                                          | Parent only                        |
| Revoke access / delete the app (iPhone) | Possible                                  | Possible, detected next launch                         | Possible, detected; streak reset                                                              | **Blocked by iOS** (child account) |

We can't make Nudge, Standard or Strict impossible to bypass on the user's own
phone (§10). We make bypassing deliberate, visible and costly.

## 4. Earning time

**Default rates** (adjustable in settings, within caps):

| Exercise   | Earns                                           |
| ---------- | ----------------------------------------------- |
| Push-ups   | 1 min per clean rep, ½ min per flagged rep      |
| Crunches   | ½ min per clean rep, ¼ per flagged rep          |
| Plank      | 2 min per 10 s in good form                     |
| Side plank | 2 min per 10 s in good form, both sides counted |

**Caps and rules:**

- **Daily cap on earned time:** 2 h by default, adjustable up to 4 h.
- **Earned time expires at midnight** (no banking across days in the first release).
- **Only real sets earn:** sets must pass the real-person check, demo sets never earn, and time is credited when the set ends (not per rep).
- **Earned minutes count only while a blocked app is open.** That's the "use time" model, not a clock that runs out in the background; it's Pushscroll's top complaint and our answer to it.
- **Not paywalled.** The blocking itself is never behind a payment (App Store guideline 4.10).

## 5. Rules for combining limits, lock times and earned time

In order of precedence:

1. **Always-allowed apps** are never blocked.
2. **Active lock time with earning off:** blocked. Earned minutes are kept for later today, not spent.
3. **Active lock time with earning on:** blocked unless earned minutes are available; then they're spent while used.
4. **Daily limit not used up:** open, counting against the limit.
5. **Daily limit used up:** blocked unless earned minutes are available; then they're spent while used.
6. **Emergency unlock / "1 more minute":** temporary opening per strictness; recorded.

**Midnight:** the daily limit resets, earned minutes expire, and a lock time running across midnight stays active.

## 6. Screens and settings

**New Home card "Screen time"**, showing:

- time used today vs. limit,
- earned minutes left,
- the next lock time ("Sleep at 22:00"),
- a red banner if protection is off.

**Screen Time screen** (`src/app/screen-time/index.tsx`):

- Today: used, limit, earned, lock times today (timeline bar).
- **Blocked apps** (system picker) and **Always allowed** (system picker).
- **Daily limit** chips (30 min, 1 h, 1.5 h, 2 h, custom).
- **Lock times** list, with **Add lock time** and on/off toggles.
- **Earning** rates and daily cap.
- **Strictness** (Nudge / Standard / Strict), with a lock period for Strict.
- History (last 14 days).

**Lock time editor** (`src/app/screen-time/lock/[id].tsx`): name, days, start/end, apps, earning
during it, a summary line ("Locked every night 22:00–07:00"), and a delete button
(disabled per §2 in Strict).

**Setup flow** (first time only, ~1 min):

1. Why Screen Time access is needed (primer).
2. The system permission prompt.
3. Pick blocked apps.
4. Pick always-allowed apps.
5. Daily limit.
6. Lock times: suggest Sleep, user can add more or skip.
7. Strictness.
8. Summary.

**Earn screen** (`src/app/earn.tsx`), opened from the blocked screen:

- Shows the rate.
- Picks the user's exercise.
- Starts a set (normal session flow).
- On finish: "+18 min added".

**Settings** gains a "Screen time" section linking to the screen above.

## 7. iPhone architecture

Built on Apple's Screen Time API (FamilyControls, ManagedSettings, DeviceActivity).
Device target: iOS 26.4+ for the full blocked screen; iOS 26.5+ to open Trueline from
it. Older versions get a notification instead. The test iPhone 13 runs iOS 27.2.

| Part                                  | Where                       | What it does                                                                                                                                                                       |
| ------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Expo module `screen-time`** (Swift) | `modules/screen-time/`      | Authorization, the app picker (wrapping Apple's `FamilyActivityPicker` view), saving rules, starting/stopping monitoring, granting earned time, reading state, app/category labels |
| **Monitor extension**                 | `targets/st-monitor/` | Runs when schedules start or end and when usage limits are reached. Applies or removes blocks. Pure Swift, tiny (~6 MB memory limit)                                               |
| **Blocked-screen extension**          | `targets/st-shield-config/`    | Title/subtitle ("Locked until 07:00 · Sleep", "Daily limit reached"), button labels, up to 3 menu items                                                                            |
| **Blocked-screen button extension**   | `targets/st-shield-action/`    | Handles "Earn time" (opens Trueline on 26.5+, else posts a notification), "Emergency 10 min", "Close"                                                                              |
| **Usage report extension** (phase 3)  | `targets/activity-report/`  | The usage chart, drawn by iOS (we can't read its numbers)                                                                                                                          |
| **Config**                            | `app.config.js` (`SCREEN_TIME=1`) | Family Controls entitlement and an App Group on all targets; adds the extensions via `@bacons/apple-targets`. No hand edits to `ios/`                                              |

**How each rule maps to Apple's API:**

- **Blocked apps:** one named blocking store per reason (`limit`, `lock-<id>`, `strict`), so lifting one never lifts another. Categories are blocked with the always-allowed apps excepted.
- **Daily limit:** a daily schedule (00:00–23:59) with a usage event at N minutes. When it fires, the `limit` block goes on.
- **Lock times:** one repeating schedule each. Starting it applies `lock-<id>`; ending it removes `lock-<id>`.
- **Earned time:** lift the relevant block, then start a one-off schedule with a usage event at the earned minutes. When that fires, the block goes back on.
- **Guarding against early events:** usage events arriving within 60 s of being scheduled are ignored. That's a known iOS 26 bug, which Apple says is fixed in 26.5.
- **Reconcile on every app open:** recompute what should be blocked from the rules and the clock, and fix any blocks that are stuck or missing.
- **Shared state:** rules and the earned-time ledger live in the App Group as small JSON files, so the extensions can read them without React Native.

**Libraries:**

- We write our own module, using `react-native-device-activity` (kingstinct) as a reference; it isn't tested on Expo SDK 58.
- Extension targets come from `@bacons/apple-targets` v5. The report extension target type isn't listed there **[verify]**.
- Run `npx expo install` for any package, per AGENTS.md.

## 8. Android architecture

| Part                                                | What it does                                                                                                      |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Expo module `screen-time`** (Kotlin), same JS API | Usage access check/prompt, app list (`<queries>` for launcher apps, not `QUERY_ALL_PACKAGES`), rules, earned time |
| **Foreground service** (`specialUse`)               | Checks the foreground app about every second from usage events; applies daily limits, lock times and earned time  |
| **Block screen**                                    | Full-screen activity mirroring the iPhone blocked screen, with "Earn time" opening Trueline                       |
| **Schedules**                                       | Exact alarms for lock-time start and end, plus the service's own clock check                                      |
| **Config plugin**                                   | Manifest entries (service, permissions, `specialUse` subtype)                                                     |

**Notes:**

- No Accessibility service and no device admin (Play policy risk), so Android is less strict than iPhone: the user can force-stop the app or revoke usage access. We detect and record it.
- Phone makers' battery savers may stop the service, so the setup flow asks for an exemption from battery optimisation.
- Play needs a declaration for the `specialUse` service, with a demo video.

## 9. Data model

Shared JSON on the phone (App Group on iPhone, app storage on Android). Nothing leaves the device.

```ts
interface ScreenTimeRules {
  version: 1;
  blocked: SelectionRef; // opaque system tokens (iPhone) or package names (Android)
  allowed: SelectionRef;
  dailyLimitMin: number | null; // null = no daily limit, lock times only
  lockTimes: LockTime[]; // max 8
  earning: { rates: Record<Exercise, Rate>; dailyCapMin: number; enabled: boolean };
  strictness: 'nudge' | 'standard' | 'strict';
  strictUntil: number | null; // epoch ms, Strict lock period end
  pendingLoosening: Change[]; // applied at next midnight (Standard/Strict)
}

interface LockTime {
  id: string;
  name: string;
  days: number[]; // 0 = Sunday
  start: string;
  end: string; // "22:00", "07:00"; may cross midnight
  apps: 'main' | SelectionRef;
  earnable: boolean;
  enabled: boolean;
  skipDate: string | null; // "2026-11-18" when skipped (Nudge/Standard only)
}

interface Grant {
  // earned-time ledger, append-only
  id: string;
  at: number;
  minutes: number;
  source: { sessionId: string; exercise: Exercise; reps: number; holdMs: number };
}
```

The ledger also records `{ protectionOff: { from, to } }` gaps and emergency unlocks, for history.

## 10. Bypass: what we can and can't stop

| Bypass                                  | iPhone (own phone)                                                                                                            | iPhone (parent mode) | Android                      |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------- | ---------------------------- |
| Revoke Screen Time / usage access       | Can't stop; detected on next launch                                                                                           | Blocked              | Can't stop; detected         |
| Delete Trueline                         | Can't stop; blocks lifted                                                                                                     | Blocked              | Can't stop                   |
| Change the clock                        | Usage is measured by iOS, so it doesn't help; lock-time windows follow the clock **[verify "require automatic date & time"]** | Same                 | Detected via uptime vs clock |
| Edit rules in Trueline                  | Limited by strictness                                                                                                         | Parent only          | Limited by strictness        |
| Fake exercise                           | Real-person check; demo sets don't earn                                                                                       | Same                 | Same                         |
| A friend holds the Screen Time passcode | May stop revoking access **[verify]**                                                                                         | n/a                  | n/a                          |

When protection is found off:

- Home shows a red banner, "Protection was off for 6 h".
- The streak resets.
- The gap appears in history.

## 11. Edge cases and testing

**Pure TypeScript rules engine** (`src/screentime/rules.ts`). It decides, for any moment, what should be blocked and why, and it's unit-tested like the exercise engine. It must handle:

- lock times crossing midnight, overlapping, back to back, on/off, skipped today;
- daylight saving changes inside a lock time, time-zone travel, and the clock moved backwards or forwards;
- daily limit reached during a lock time, earned time running during a lock time (earnable vs not), and expiry at midnight;
- the daily cap, flagged-rep rates, demo and failed sets (no grant), and sets ended by the real-person check;
- strictness changes: loosening deferred to midnight, tightening immediate, Strict period ending, turning off early;
- loading old or corrupt rule files.

**Device tests (iPhone 13, iOS 27.2), each with a written expected result:**

- block applies at lock start and lifts at end, including with the screen off and the phone locked;
- block survives a reboot, an app kill, and a low-memory kill of the extension;
- daily limit fires at the right minute (and the early-fire guard works);
- earned time lifts the block, the block returns when it's used, and earned minutes aren't spent while sitting idle;
- "Earn time" on the blocked screen opens Trueline (26.5+) or posts a notification;
- revoke access, then reopen: banner and history gap shown;
- delete and reinstall: rules restored? **[verify]**;
- 50+ apps selected (category path).

**Android device tests:** the same list, plus the battery-optimisation kill, force-stop, and phone-maker battery savers.

## 12. Phases

**Phase 1, done.** `src/screentime/` (pure TypeScript, no native code):

| File        | What it decides                                                                                                                   |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `time.ts`   | Local time in any zone, lock-time occurrences (overnight, skipped days, daylight saving), next midnight                           |
| `rules.ts`  | Defaults, presets, safe loading, validation, tightening vs loosening, strictness rules for changes, Strict start/end, skips       |
| `decide.ts` | What's blocked now and why, earned time, emergency and "1 more minute" unlocks, the day rolling over, the next moment to re-check |
| `earn.ts`   | Minutes earned per finished set, the daily cap, demo and duplicate sets                                                           |

108 tests in `src/screentime/__tests__/` cover London, New York and Karachi time, both
daylight-saving changes, travel, and every rule in §2–§5. Switching any key rule off
makes them fail. Note: the Standard emergency unlock works whenever the apps are
blocked (limit or lock time), not only during lock times.

**Phases 2–5 and 7, built (November 2026).** What exists:

| Part | Where |
| --- | --- |
| Plan for the phone, reading its reports back | `src/screentime/plan.ts` (the app lists travel in the plan, so changing them follows the strictness rules like any other change) |
| Saved rules and 14 days of history; sync on open, resume, rule change and set | `src/screentime/store.ts`, `useScreenTimeSync.ts` |
| Rule changes from screens, pickers | `src/screentime/edit.ts` |
| Screens | `src/app/screen-time/` (hub, setup, `lock/[id]`, Android `apps` picker), `src/app/earn.tsx`, Home card, Settings link, "+N min" on the summary |
| iPhone module and extensions | `modules/screen-time/ios/` (`STShared.swift` is linked into each of `targets/st-monitor`, `st-shield-config`, `st-shield-action`), `app.config.js` |
| Android | `modules/screen-time/android/` (`STCore.kt`, `BlockService`, `BlockActivity`, `BootReceiver`) |

Checked so far:

- 141 screen time tests (33 new: plan, report merging, and the store against a fake phone).
  Planted bugs in the merge and sync rules make them fail.
- iPhone: the app and all three extensions compile (unsigned) for iOS 17.4+.
- Android, on an API 37 emulator: setup with both permission screens, the app picker,
  a lock time blocking Chrome, Close, the emergency unlock opening Chrome and being read
  back by Trueline, and switching off a running lock waiting until midnight.

Not done here:

- **The iPhone can't run it yet.** The team on this Mac (J26V956L84) is a free Personal team,
  and Apple doesn't let free teams sign Family Controls, even for debug builds. It needs a
  paid Apple Developer Program team. Then: `SCREEN_TIME=1 npx expo prebuild --clean`, run on
  the iPhone, and go through §11's device tests. Starting monitoring from inside the monitor
  extension (used for unlock re-block wake-ups) is the main thing to confirm there.
- Phase 0 (Apple's Distribution approval), Phase 6 (TestFlight soak) and Phase 8 (parent mode).
- The usage report extension (Apple's own usage chart) was left out: Trueline's history covers it.
- Android uses the service's own clock instead of exact alarms; Play's `specialUse` declaration
  and demo video are still to do before release.
- Earning from a real set was checked by tests, not on a device (sets need a person on camera).

**Follow-up after the research guide (docs/research), November 2026.** These items are now built:

- **F1:** daily-limit misfire guard on iOS. Usage is measured from when monitoring is armed
  (never including earlier activity), and events claiming more use than the time that has
  passed are re-armed (at most 3 times a day).
- **F2:** the Android battery step opens the general settings page.
- **F3:** iOS 26.5 token expiry asks the user to pick the apps again.
- **F4:** a list of more than 50 single apps is refused on iPhone.
- **F5:** Android force stop and Task Manager stop are recorded as gaps in history, from a
  heartbeat plus Android's exit reasons, counted only while the screen was on.
- **F6:** Workout Focus Mode, on the exercise screen and the session.
- **F7:** the Apple request text (§14).
- **F8:** lock times are capped at 7, so the iOS schedules fit in 20.

| Phase         | Work                                                                                                                              | Rough effort             | Done when                                           |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | --------------------------------------------------- |
| **0**         | Account holder requests Family Controls (Distribution) for the app + 3 extensions (+1 report). Draft in §14                       | Days to weeks of waiting | Status "Assigned" for all                           |
| **1**         | Rules engine in TypeScript + tests (all of §11's unit list)                                                                       | 1 week                   | Engine passes; no native code yet                   |
| **2**         | iPhone module + config plugin + monitor/blocked-screen extensions; permission, pickers, blocked and allowed apps, daily limit     | 2 weeks                  | Limit blocks and unblocks on the iPhone 13          |
| **3**         | **Lock times**: editor, schedules, blocked-screen text, Strict editing rules                                                      | 1–1.5 weeks              | All lock-time device tests pass                     |
| **4**         | Earning: grants from finished sets, earn screen, blocked-screen menu, open-app on 26.5+, notification fallback, reconcile on open | 1.5–2 weeks              | Earn → unlock → re-block works end to end           |
| **5**         | Strictness levels, bypass detection, history, Home card, usage report extension                                                   | 1–1.5 weeks              | §10 detection works; Strict can't be loosened early |
| **6**         | TestFlight soak test on iOS 26.4–27.x; fix event timing issues                                                                    | 1–2 weeks                | A week of daily use without stuck or missed blocks  |
| **7**         | Android module, service, block screen, Play declarations                                                                          | 3–4 weeks                | Android device tests pass                           |
| **8** (later) | Parent mode (Family Sharing child authorization)                                                                                  | 2 weeks                  | Child can't revoke or delete                        |

Phases 1 and 0 can start the same day. Phase 2 can be developed on a development
build before Apple approves; approval is only needed for TestFlight and the App Store.

## 13. Risks and open questions

**Risks:**

- **Apple approval time and rejection.** Mitigation: request early, describe it as self-management, and don't monetise the blocking.
- **Usage-event reliability on iOS 26.x.** Mitigation: early-fire guard, reconcile on open, schedule-based fallback.
- **Extension memory limit (about 6 MB).** Mitigation: no React Native or SQLite in extensions, only small JSON.
- **Android service killed by phone makers.** Mitigation: battery exemption prompt, plus detection.

**Decisions needed from you:**

1. Default strictness (plan: Standard) and the Strict "turn off early" cost (plan: 100 push-ups or 24 h).
2. Default earning rates and the daily cap (plan: §4, 2 h).
3. Lock times: earning _off_ by default inside them (plan: yes)?
4. Emergency unlock in Standard: 1 × 10 min per day (plan: yes)?
5. Android in the same release, or iPhone first (plan: iPhone first)?
6. Who is the Apple account holder to submit §14 (irfanayaz89's account)?

## 14. Apple permission request (draft)

Rewritten for the developer agreement's March 2026 rule (3.3.3(P)): an app using Family
Controls must have personal device-usage management (or parental supervision) as a primary
purpose. Trueline's must therefore read as exercise **and** personal device-usage management,
not as a fitness app with blocking added on.

> **App:** Trueline (com.exercisetracker.trueline) and its Screen Time extensions:
> com.exercisetracker.trueline.st-monitor (DeviceActivityMonitor),
> com.exercisetracker.trueline.st-shield-config (ShieldConfiguration) and
> com.exercisetracker.trueline.st-shield-action (ShieldAction).
>
> **Primary purpose:** Trueline helps people manage how they use their own iPhone and replace
> scrolling with exercise. Managing personal device usage is one of its two core functions,
> alongside the exercise counting itself, and is part of onboarding, the Home screen and every
> workout.
>
> **What users do:**
> - Choose the apps and websites they want to limit.
> - Set a daily limit and times when those apps don't open (for example while sleeping).
> - Block them during a workout (Workout Focus).
> - Earn extra minutes by completing exercise sets, which Trueline verifies on the device with
>   pose tracking.
> - Choose how strict the rules are, including an emergency unlock.
>
> **Authorization:** `.individual` only. Each person manages their own device; Trueline never
> monitors anyone else and has no account, server or remote view.
>
> **Data:** App and website selections stay as opaque tokens on the device. No usage data, app
> information or Screen Time data is collected, transmitted, shared or used for analytics or
> advertising. The blocking itself is never sold or placed behind a payment (guideline 4.10).
