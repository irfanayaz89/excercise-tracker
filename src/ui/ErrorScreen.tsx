import { router, type ErrorBoundaryProps } from 'expo-router';
import { View } from 'react-native';
import { Body, Button, Display } from './primitives';
import { color, space } from './theme';

/**
 * Shown instead of a crash when a screen fails to render (e.g. a saved set
 * written by another version of the app). Exported as `ErrorBoundary` by routes.
 */
export function ErrorScreen({ retry }: ErrorBoundaryProps) {
  return (
    <View style={{ flex: 1, backgroundColor: color.ground, padding: space.xl, justifyContent: 'center', gap: space.lg }}>
      <Display>Something went wrong</Display>
      <Body tone="muted">This screen could not be shown. Your saved sets are safe.</Body>
      <Button label="Try again" onPress={() => void retry()} />
      <Button label="Back home" variant="ghost" onPress={() => (router.canDismiss() ? router.dismissTo('/') : router.replace('/'))} />
    </View>
  );
}
