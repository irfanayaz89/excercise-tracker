import { Pressable, StyleSheet, View } from 'react-native';
import type { PhoneOrientation } from '@/engine/types';
import { PLACEMENT } from '@/session/copy';
import { Mono, Strong } from './primitives';
import { color, radius, space, type } from './theme';

/**
 * Two big tappable tiles, each with a little phone drawn the way it will
 * stand, so the choice reads without any words.
 */
export function OrientationPicker({
  value,
  onChange,
  compact = false,
}: {
  value: PhoneOrientation;
  onChange: (o: PhoneOrientation) => void;
  compact?: boolean;
}) {
  return (
    <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel="Phone orientation">
      {(['landscape', 'portrait'] as const).map((o) => {
        const on = value === o;
        return (
          <Pressable
            key={o}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            accessibilityLabel={`${PLACEMENT[o].label}, about ${PLACEMENT[o].spoken} away`}
            onPress={() => onChange(o)}
            style={({ pressed }) => [styles.tile, compact && styles.tileCompact, on && styles.tileOn, pressed && { opacity: 0.85 }]}
          >
            <View style={styles.glyphBox}>
              <View style={[styles.phone, o === 'landscape' ? styles.phoneLand : styles.phonePort, on && { borderColor: color.vial }]}>
                <View style={[styles.lens, on && { backgroundColor: color.vial }]} />
              </View>
            </View>
            <View style={{ gap: 2, flexShrink: 1 }}>
              <Strong size={compact ? 14 : 15} tone={on ? 'chalk' : 'chalk'}>
                {PLACEMENT[o].label}
              </Strong>
              <Mono size={type.small} tone={on ? 'vial' : 'muted'}>
                {PLACEMENT[o].distance}
              </Mono>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.sm },
  tile: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    minHeight: 64,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: color.line,
    backgroundColor: color.ground,
  },
  tileCompact: { minHeight: 52, paddingVertical: space.sm },
  tileOn: { borderColor: color.vial, backgroundColor: color.raised },
  glyphBox: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  phone: { borderWidth: 2, borderColor: color.muted, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  phoneLand: { width: 30, height: 19 },
  phonePort: { width: 19, height: 30 },
  lens: { width: 5, height: 5, borderRadius: 3, backgroundColor: color.muted },
});
