import { router } from 'expo-router';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { syncScreenTime } from './store';

/**
 * Keep the phone's blocking in step with the rules: on launch and every time
 * Trueline comes back to the foreground. If "Earn time" was tapped on a
 * blocked app's screen, go straight to the earn screen.
 */
export function useScreenTimeSync() {
  useEffect(() => {
    const run = () => {
      try {
        if (syncScreenTime().openEarn) router.push('/earn');
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
