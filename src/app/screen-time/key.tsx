import { File, Paths } from 'expo-file-system';
import { router } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { keyText, newKey, useScreenTime } from '@/screentime/store';
import { Body, Button, Display, Label } from '@/ui/primitives';
import { color, radius, space } from '@/ui/theme';

/**
 * The QR key: show it, save or print it, or replace it. Keep it somewhere that takes effort to
 * reach (another room, a friend's phone): scanning it is the way out of a key lock.
 */
export default function KeyScreen() {
  const insets = useSafeAreaInsets();
  const st = useScreenTime();
  const key = st.meta.key;
  const running = st.focus?.kind === 'key' && st.focus.until > st.now;
  const qr = useRef<{ toDataURL: (cb: (data: string) => void) => void } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const share = () =>
    qr.current?.toDataURL(async (data) => {
      try {
        const f = new File(Paths.cache, 'trueline-key.png');
        if (f.exists) f.delete();
        await f.write(data, { encoding: 'base64' });
        await Sharing.shareAsync(f.uri, { mimeType: 'image/png', dialogTitle: 'Save or print your Trueline key' });
      } catch {
        setMessage('Couldn’t share the key. Take a screenshot instead.');
      }
    });

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: color.ground }}
      contentContainerStyle={[styles.page, { paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.huge }]}
    >
      <View style={styles.header}>
        <Display size={32}>My key</Display>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={12}>
          <Label tone="chalk">Done</Label>
        </Pressable>
      </View>
      {key && running ? (
        // While a key lock runs the key isn't shown here: it would be a way round keeping it out of reach.
        <View style={{ gap: space.md }}>
          <Body tone="muted" size={15}>
            A key lock is running. Scan the key you saved or printed to end it; it isn’t shown here until then.
          </Body>
          <Button label="Scan my key" onPress={() => router.replace('/screen-time/scan')} />
        </View>
      ) : key ? (
        <>
          <View style={styles.card} accessibilityLabel="Your key, a QR code">
            <QRCode value={keyText(key.secret)} size={240} color="#1F2937" backgroundColor="#FFFFFF" getRef={(c) => (qr.current = c)} />
          </View>
          <Body tone="muted" size={14}>
            Save it on another device or print it, and keep it out of easy reach. During a key lock, scan it in Trueline to unlock. Only this
            phone’s current key works.
          </Body>
          <Button label="Save or print" onPress={share} />
          <Button
            variant="ghost"
            label="Make a new key"
            onPress={() => {
              newKey();
              setMessage('New key made. The old one no longer works: save this one.');
            }}
          />
        </>
      ) : (
        <Button label="Make my key" onPress={() => newKey()} />
      )}
      {message && (
        <Body size={14} accessibilityLiveRegion="polite">
          {message}
        </Body>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: space.xl, gap: space.xl, width: '100%', maxWidth: 560, alignSelf: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.md },
  card: { alignSelf: 'center', padding: space.lg, borderRadius: radius.lg, backgroundColor: '#FFFFFF' },
});
