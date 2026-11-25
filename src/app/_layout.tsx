import { Archivo_400Regular, Archivo_600SemiBold } from '@expo-google-fonts/archivo';
import {
  BigShouldersDisplay_600SemiBold,
  BigShouldersDisplay_800ExtraBold,
  BigShouldersDisplay_900Black,
} from '@expo-google-fonts/big-shoulders-display';
import { JetBrainsMono_400Regular, JetBrainsMono_500Medium } from '@expo-google-fonts/jetbrains-mono';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AnimatedSplash } from '@/features/splash/AnimatedSplash';
import { useScreenTimeSync } from '@/screentime/useScreenTimeSync';
import { color } from '@/ui/theme';

void SplashScreen.preventAutoHideAsync().catch(() => {});

/** Last line of defence: a render error shows a way out instead of closing the app. */
export { ErrorScreen as ErrorBoundary } from '@/ui/ErrorScreen';

export default function RootLayout() {
  const [loaded, error] = useFonts({
    BigShouldersDisplay_600SemiBold,
    BigShouldersDisplay_800ExtraBold,
    BigShouldersDisplay_900Black,
    Archivo_400Regular,
    Archivo_600SemiBold,
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
  });

  useScreenTimeSync();
  // The opening animation plays once per launch, over the first screen, after the phone's own splash.
  const [intro, setIntro] = useState(true);
  const endIntro = useCallback(() => setIntro(false), []);

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(color.ground).catch(() => {});
    // Every screen except the live set is portrait; the set screen locks its own orientation while focused.
    void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
  }, []);

  useEffect(() => {
    // Fonts failing to load must not block the app: fall back to system fonts.
    if (loaded || error) void SplashScreen.hideAsync().catch(() => {});
  }, [loaded, error]);

  if (!loaded && !error) return <View style={{ flex: 1, backgroundColor: color.ground }} />;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: color.ground }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: color.ground },
            animation: 'fade',
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="welcome" options={{ gestureEnabled: false }} />
          <Stack.Screen name="exercise/[id]" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="guide" options={{ animation: 'slide_from_bottom' }} />
          <Stack.Screen name="session" options={{ gestureEnabled: false, animation: 'fade_from_bottom' }} />
          <Stack.Screen name="summary/[id]" options={{ animation: 'slide_from_bottom' }} />
          <Stack.Screen name="settings" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="screen-time/index" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="screen-time/setup" options={{ animation: 'slide_from_right', gestureEnabled: false }} />
          <Stack.Screen name="screen-time/lock/[id]" options={{ animation: 'slide_from_bottom' }} />
          <Stack.Screen name="screen-time/apps" options={{ animation: 'slide_from_bottom' }} />
          <Stack.Screen name="earn" options={{ animation: 'slide_from_bottom' }} />
          <Stack.Screen name="calories" options={{ animation: 'slide_from_bottom' }} />
        </Stack>
        {intro && <AnimatedSplash onDone={endIntro} />}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
