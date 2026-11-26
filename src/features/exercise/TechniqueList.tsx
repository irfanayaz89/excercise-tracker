import { StyleSheet, View } from 'react-native';
import type { Exercise } from '@/engine/types';
import { Body, Display, Strong } from '@/ui/primitives';
import { color, radius, space, type } from '@/ui/theme';
import { TECHNIQUE } from './technique';

/** The numbered how-to steps for an exercise. `compact` hides each step's detail. */
export function TechniqueSteps({ exercise, compact = false }: { exercise: Exercise; compact?: boolean }) {
  return (
    <View style={{ gap: compact ? space.sm : space.lg }} accessibilityRole="list">
      {TECHNIQUE[exercise].steps.map((s, i) => (
        <View key={s.title} style={styles.row}>
          <Display size={compact ? 22 : type.displayS} tone="vial" style={{ width: compact ? 18 : 22 }}>
            {i + 1}
          </Display>
          <View style={{ flex: 1, gap: 2 }}>
            <Strong size={compact ? 15 : 16}>{s.title}</Strong>
            {!compact && (
              <Body tone="muted" size={type.note}>
                {s.body}
              </Body>
            )}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  safety: {
    gap: space.xs,
    padding: space.lg,
    borderRadius: radius.md,
    backgroundColor: color.cueSoft,
    borderWidth: 1,
    borderColor: color.cue,
  },
});
