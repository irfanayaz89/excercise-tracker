import { Linking, StyleSheet, View } from 'react-native';
import { Body, Button, Display, Label } from '@/ui/primitives';
import { color, space, type } from '@/ui/theme';

/** Full-screen explainer for anything that blocks the camera from starting. */
export function Gate({
  eyebrow,
  title,
  body,
  primary,
  secondary,
}: {
  eyebrow: string;
  title: string;
  body: string;
  primary?: { label: string; onPress: () => void };
  secondary?: { label: string; onPress: () => void };
}) {
  return (
    <View style={styles.wrap}>
      <View style={styles.card}>
        <Label tone="vial">{eyebrow}</Label>
        <Display size={type.pageHero}>{title}</Display>
        <Body tone="muted" style={{ maxWidth: 460 }}>
          {body}
        </Body>
        <View style={styles.row}>
          {primary && <Button label={primary.label} onPress={primary.onPress} />}
          {secondary && <Button label={secondary.label} variant="ghost" onPress={secondary.onPress} />}
        </View>
      </View>
    </View>
  );
}

export const openSettings = () => void Linking.openSettings().catch(() => {});

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: color.ground, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  card: { gap: space.md, maxWidth: 520, width: '100%' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, marginTop: space.md },
});
