import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scanKey } from '@/screentime/store';
import { Body, Button, Display, Label } from '@/ui/primitives';
import { color, radius, space } from '@/ui/theme';

/** Scan the QR key to end a key lock (or any running focus). */
export default function ScanKeyScreen() {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [message, setMessage] = useState<string | null>(null);
  const done = useRef(false);

  const onScan = (data: string) => {
    if (done.current) return;
    const res = scanKey(data);
    if (res === 'ended') {
      done.current = true;
      setMessage('Unlocked.');
      setTimeout(() => (router.canGoBack() ? router.back() : router.replace('/screen-time')), 600);
    } else {
      setMessage(res === 'wrong-key' ? 'That isn’t this phone’s key.' : 'Nothing is locked right now.');
    }
  };

  return (
    <View style={[styles.page, { paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.xl }]}>
      <View style={styles.header}>
        <Display size={32}>Scan my key</Display>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={12}>
          <Label tone="chalk">Cancel</Label>
        </Pressable>
      </View>
      {!permission ? null : permission.granted ? (
        <View style={styles.frame}>
          <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={(r) => onScan(r.data)} />
        </View>
      ) : (
        <View style={{ gap: space.md }}>
          <Body tone="muted">Trueline needs the camera to read your key.</Body>
          <Button
            label={permission.canAskAgain ? 'Allow the camera' : 'Open Settings'}
            onPress={() => (permission.canAskAgain ? requestPermission() : Linking.openSettings())}
          />
        </View>
      )}
      <Body size={15} tone={message === 'Unlocked.' ? 'good' : 'chalk'} accessibilityLiveRegion="polite">
        {message ?? 'Point the camera at your key.'}
      </Body>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.ground, paddingHorizontal: space.xl, gap: space.xl },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.md },
  frame: { width: '100%', aspectRatio: 1, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: color.raised },
});
