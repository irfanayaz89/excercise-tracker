import { requireOptionalNativeModule } from 'expo';

/**
 * Trueline's Screen Time native module (iOS Screen Time API, Android usage
 * access). Null where unavailable (web, Expo Go, older OS): the app then hides
 * the feature. The TypeScript engine in src/screentime decides everything;
 * this only applies its plan. See docs/SCREEN_TIME_PLAN.md.
 */

export type AuthStatus = 'approved' | 'denied' | 'notDetermined';

/** What was picked: opaque tokens (iOS) or package names (Android), plus counts for display. */
export interface PickedSelection {
  apps: string[];
  categories: string[];
  domains: string[];
  appCount: number;
  categoryCount: number;
  domainCount: number;
}

/** An app the user can pick (Android only: iOS uses Apple's own picker). */
export interface InstalledApp {
  packageName: string;
  label: string;
  /** Android's category for the app ("social", "video", "game", "news", …) or "" */
  category: string;
}

interface ScreenTimeNative {
  isSupported(): boolean;
  authorizationStatus(): AuthStatus;
  requestAuthorization(): Promise<AuthStatus>;
  /** iOS: Apple's picker, starting from the current list. Null if cancelled. Applies nothing. */
  pickApps?(title: string, current: { apps: string[]; categories: string[]; domains: string[] }): Promise<PickedSelection | null>;
  /** Android: launchable apps, for Trueline's own picker. */
  installedApps?(): Promise<InstalledApp[]>;
  /** Store the plan (rules, app lists and today's counts), apply blocks now, (re)start schedules. Returns problems, if any. */
  sync(planJson: string): string[];
  /** What happened while Trueline was closed (usage, earned minutes spent, unlocks, "earn" taps). */
  takeState(): string;
  takeUnlock(kind: 'emergency' | 'one-more', minutes: number): void;
  stopAll(): void;
  requestNotifications(): Promise<boolean>;
  /** Android: battery optimisation is already off for Trueline. */
  batteryUnrestricted?(): boolean;
  /** Android: open the settings screen for a permission. */
  openSettings?(which: 'usage' | 'overlay' | 'battery' | 'notifications'): void;
  /** Android: Trueline may hide notifications (Notification access is on). */
  notificationAccess?(): boolean;
  /** Android: minutes of phone use per day (last 7 days, oldest first) and today's top apps. */
  usageSummary?(): Promise<UsageSummary>;
  /** iOS: refresh the home screen widget after the app changed what's blocked. */
  reloadWidget?(): void;
  /**
   * A clock the user can't change, for spotting a moved phone clock: milliseconds since boot
   * (keeps counting while the phone sleeps) and an id that changes on every reboot.
   * Android: SystemClock.elapsedRealtime + Settings.Global.BOOT_COUNT. iOS: CLOCK_MONOTONIC + kern.bootsessionuuid.
   */
  clock?(): NativeClock;
}

export interface NativeClock {
  uptimeMs: number;
  boot: string;
}

export interface UsageSummary {
  days: { day: string; minutes: number }[];
  top: { packageName: string; label: string; minutes: number }[];
}

export const ScreenTime = requireOptionalNativeModule<ScreenTimeNative>('ScreenTime');
