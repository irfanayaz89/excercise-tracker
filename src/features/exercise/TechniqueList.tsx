import { StyleSheet, View } from 'react-native';
import type { Exercise } from '@/engine/types';
import { Body, Display, Label, Strong } from '@/ui/primitives';
import { color, radius, space } from '@/ui/theme';
import { TECHNIQUE } from './technique';

/** The numbered how-to steps for an exercise. `compact` hides each step's detail. */
export function TechniqueSteps({ exercise, compact = false }: { exercise: Exercise; compact?: boolean }) {
  return (
    <View style={{ gap: compact ? space.sm : space.lg }} accessibilityRole="list">
      {TECHNIQUE[exercise].steps.map((s, i) => (
        <View key={s.title} style={styles.row}>
          <Display size={compact ? 22 : 28} tone="vial" style={{ width: compact ? 18 : 22 }}>
            {i + 1}
          </Display>
          <View style={{ flex: 1, gap: 2 }}>
            <Strong size={compact ? 15 : 16}>{s.title}</Strong>
            {!compact && (
              <Body tone="muted" size={14}>
                {s.body}
              </Body>
            )}
          </View>
        </View>
      ))}
    </View>
  );
}

/** Common mistakes, breathing, how much to start with, and the safety note. */
export function TechniqueAvoid({ exercise }: { exercise: Exercise }) {
  const t = TECHNIQUE[exercise];
  return (
    <View style={{ gap: space.xl }}>
      <View style={{ gap: space.sm }} accessibilityRole="list">
        {t.avoid.map((a) => (
          <View key={a} style={styles.row}>
            <Strong tone="cue" style={{ width: 18 }}>
              ✕
            </Strong>
            <Body style={{ flex: 1 }} size={15}>
              {a}
            </Body>
          </View>
        ))}
      </View>
      <View style={{ gap: space.xs }}>
        <Label tone="vial">Breathing</Label>
        <Body size={15}>{t.breathe}</Body>
      </View>
      <View style={{ gap: space.xs }}>
        <Label tone="vial">To start</Label>
        <Body size={15}>{t.dose}</Body>
      </View>
      <View style={styles.safety}>
        <Label tone="cue">Take care</Label>
        <Body size={14}>{t.safety}</Body>
      </View>
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
