import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { EXERCISES, isTimed } from '@/engine/exercises';
import { formatDuration } from '@/session/copy';
import type { SessionRow } from '@/storage/history';
import { setKcal, type ExerciseBody } from '@/fitness/energy';
import { kcalText } from '@/fitness/format';
import { ExerciseGlyph } from '@/ui/Diagrams';
import { Body, Display, Mono, Rule, Strong } from '@/ui/primitives';
import { color, radius, space, type } from '@/ui/theme';

/** A set's headline number: reps, or time in good form. */
export function rowValue(r: SessionRow): string {
  return isTimed(r.exercise) ? formatDuration(r.holdMs) : String(r.totalReps);
}

/** Past sets, newest first; tapping one opens its summary. */
export function HistoryList({
  rows,
  guard,
  empty,
  showExercise = true,
  body = null,
}: {
  rows: SessionRow[];
  guard: (fn: () => void) => () => void;
  empty: string;
  /** Show each set's exercise (off on an exercise's own screen). */
  showExercise?: boolean;
  /** Weight and age, for each set's calories (none shown without them). */
  body?: ExerciseBody | null;
}) {
  if (rows.length === 0) return <Body tone="muted">{empty}</Body>;
  return (
    <View style={styles.list}>
      {rows.map((r, i) => {
        const timed = isTimed(r.exercise);
        const share = timed ? Math.min(1, r.holdMs / Math.max(1, r.activeMs)) : r.totalReps > 0 ? r.cleanReps / r.totalReps : 0;
        return (
          <View key={r.id}>
            {i > 0 && <Rule />}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${EXERCISES[r.exercise].label}, ${rowValue(r)}, ${formatWhen(r.startedAt)}`}
              onPress={guard(() => router.push({ pathname: '/summary/[id]', params: { id: r.id } }))}
              style={({ pressed }) => [styles.row, pressed && { backgroundColor: color.surface }]}
            >
              <Display size={type.stat} style={{ minWidth: 72 }}>
                {rowValue(r)}
              </Display>
              <View style={{ flex: 1, gap: 2 }}>
                <Strong size={type.detail}>{formatWhen(r.startedAt)}</Strong>
                <Mono size={type.small} tone="muted">
                  {`${showExercise ? `${EXERCISES[r.exercise].label} · ` : ''}${
                    timed ? `${Math.round(share * 100)}% good form` : `${r.cleanReps} clean · ${formatDuration(r.activeMs)}`
                  }${body ? ` · ${kcalText(setKcal(r, body), false)}` : ''}`}
                </Mono>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 6 }}>
                {showExercise && <ExerciseGlyph exercise={r.exercise} active={false} size={32} />}
                <View style={styles.bar} accessible accessibilityLabel={`${Math.round(share * 100)} percent good form`}>
                  <View style={{ width: `${share * 100}%`, height: '100%', backgroundColor: color.good }} />
                </View>
              </View>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

export function formatWhen(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `Today, ${time}`;
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `Yesterday, ${time}`;
  return `${d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}, ${time}`;
}

const styles = StyleSheet.create({
  list: { borderRadius: radius.lg, borderWidth: 1, borderColor: color.lineSoft, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.lg, paddingHorizontal: space.lg, paddingVertical: space.md },
  bar: { width: 56, height: 6, borderRadius: 3, backgroundColor: color.raised, overflow: 'hidden' },
});
