import { router } from 'expo-router';
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { ScreenTime } from '../../modules/screen-time/src';
import { setEverythingEarnable } from './decide';
import { getScreenTime, syncScreenTime } from './store';

// iPhone can't count time across all apps: an "Everything" lock never opens with earned time there.
if (Platform.OS === 'ios') setEverythingEarnable(false);

/**
 * Keep the phone's blocking in step with the rules: on launch and every time
 * Trueline comes back to the foreground. If "Earn time" or "Scan my key" was
 * tapped on a blocked app's screen, go straight to that screen.
 *
 * iPhone: after a cold start the Screen Time status can read "not determined"
 * until the app asks again. Asking when access is still granted returns at once
 * with no prompt, so it's done then. A user who declined or switched access off
 * ("denied") is not asked again on every launch: the Screen time screen offers
 * to reconnect instead (App Review: respect the user's choice).
 */
export function useScreenTimeSync() {
  useEffect(() => {
    let checked = false;
    const run = async () => {
      try {
        if (Platform.OS === 'ios' && !checked && getScreenTime().meta.setUp && ScreenTime?.isSupported()) {
          checked = true;
          if (ScreenTime.authorizationStatus() === 'notDetermined') await ScreenTime.requestAuthorization();
        }
        const r = syncScreenTime();
        if (r.openScan) router.push('/screen-time/scan');
        else if (r.openEarn) router.push('/earn');
      } catch {
        // Never let screen time break the workout app.
      }
    };
    run();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') run();
    });
    return () => sub.remove();
  }, []);
}
