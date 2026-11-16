import { Redirect, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DIFFICULTIES } from '@/engine/difficulty';
import { EXERCISES, isExercise, isTimed } from '@/engine/exercises';
import type { Exercise } from '@/engine/types';
import { setupSteps } from '@/features/exercise/setupSteps';
import { HistoryList } from '@/features/history/HistoryList';
import { difficultyCopy, formatDuration } from '@/session/copy';
import { bestFor, dailyTotals, listSessionsFor, listSessionsSince, type SessionRow } from '@/storage/history';
import { HOLD_TARGETS, TARGETS, useSettings } from '@/storage/settings';
import { ExerciseGlyph, SetupDiagram } from '@/ui/Diagrams';
import { OrientationPicker } from '@/ui/OrientationPicker';
import { Body, Button, Chip, Display, Label, Mono, Strong } from '@/ui/primitives';
import { color, radius, space, type } from '@/ui/theme';
import { useTapGuard } from '@/ui/useTapGuard';
import { WeekBars } from '@/ui/WeekBars';

/** One exercise: how it went this week, setup, level, target, Start, and its own history. */
export default function ExerciseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  if (!isExercise(id)) return <Redirect href="/" />;
  return <ExerciseDetail exercise={id} />;
}

function ExerciseDetail({ exercise }: { exercise: Exercise }) {
  const insets = useSafeAreaInsets();
  const guard = useTapGuard();
  const { width } = useWindowDimensions();
  const [settings, update] = useSettings();
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [weekRows, setWeekRows] = useState<SessionRow[]>([]);
  const [best, setBest] = useState<number | null>(null);
  const info = EXERCISES[exercise];
  const timed = isTimed(exercise);

  useFocusEffect(
    useCallback(() => {
      setRows(listSessionsFor(exercise));
      setBest(bestFor(exercise));
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      start.setDate(start.getDate() - 6);
      setWeekRows(listSessionsSince(start.getTime()));
    }, [exercise]),
  );

  const week = useMemo(() => dailyTotals(weekRows, 7), [weekRows]);
  const values = week.map((d) => d.byExercise[exercise]);
  const show = (v: number) => (timed ? formatDuration(v) : String(v));
  const today = values[values.length - 1] ?? 0;
  const weekTotal = values.reduce((a, b) => a + b, 0);
  const guided = settings.experience !== 'quick';
  const levelCopy = difficultyCopy(settings.difficulty, exercise);
  const art = Math.min(width, 560) - space.xl * 4;

  const start = (demo = false) =>
    guard(() => {
      // The set runs with this exercise; the choice is remembered for next time.
      update({ exercise });
      if (demo) router.push({ pathname: '/session', params: { demo: '1', ex: exercise } });
      else router.push(guided ? '/guide' : '/session');
    });

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: color.ground }}
      contentContainerStyle={[styles.page, { paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.huge }]}
    >
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} hitSlop={12}>
          <Label tone="chalk">‹ Exercises</Label>
        </Pressable>
      </View>

      <View style={styles.titleRow}>
        <ExerciseGlyph exercise={exercise} size={72} />
        <View style={{ flex: 1, gap: 2 }}>
          <Display size={40}>{info.label}</Display>
          <Mono tone="vial">{info.tagline}</Mono>
        </View>
      </View>

      <View style={{ gap: space.sm }}>
        <View style={styles.statsRow}>
          <Stat label="Today" value={show(today)} />
          <Stat label="This week" value={show(weekTotal)} />
          <Stat label={timed ? 'Best hold' : 'Best set'} value={best === null ? '—' : show(best)} />
        </View>
        <WeekBars days={week.map((d) => d.day)} values={values} label={`${show(weekTotal)} ${info.unit} in the last 7 days`} height={56} />
      </View>

      {guided ? (
        <View style={styles.card}>
          <Label tone="vial">Before you start</Label>
          <OrientationPicker value={settings.orientation} onChange={(orientation) => update({ orientation })} />
          <SetupDiagram width={art} orientation={settings.orientation} exercise={exercise} />
          <View style={{ gap: space.md }}>
            {setupSteps(exercise, settings.difficulty, settings.orientation).map((s, i) => (
              <View key={i} style={{ flexDirection: 'row', gap: space.md }}>
                <Display size={28} tone="vial" style={{ width: 22 }}>
                  {i + 1}
                </Display>
                <View style={{ flex: 1, gap: 2 }}>
                  <Strong>{s.title}</Strong>
                  <Body tone="muted" size={14}>
                    {s.body}
                  </Body>
                </View>
              </View>
            ))}
          </View>
        </View>
      ) : (
        <View style={{ gap: space.md }}>
          <Label>Phone</Label>
          <OrientationPicker compact value={settings.orientation} onChange={(orientation) => update({ orientation })} />
        </View>
      )}

      <View style={{ gap: space.md }}>
        <Label>Difficulty</Label>
        <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Difficulty">
          {DIFFICULTIES.map((d) => (
            <Chip key={d} label={difficultyCopy(d, exercise).label} selected={settings.difficulty === d} onPress={() => update({ difficulty: d })} />
          ))}
        </View>
        <View style={{ gap: 2 }}>
          <Strong size={15}>{levelCopy.short}</Strong>
          <Body tone="muted" size={14}>
            {levelCopy.detail}
          </Body>
        </View>
      </View>

      <View style={{ gap: space.md }}>
        <Label>{info.perSide ? 'Target · each side' : 'Target'}</Label>
        <View style={styles.chips}>
          {timed
            ? HOLD_TARGETS.map((t) => (
                <Chip
                  key={t}
                  label={t === 0 ? 'Open' : formatDuration(t * 1000)}
                  selected={settings.targetHoldSec === t}
                  onPress={() => update({ targetHoldSec: t })}
                />
              ))
            : TARGETS.map((t) => (
                <Chip key={t} label={t === 0 ? 'Open' : String(t)} selected={settings.targetReps === t} onPress={() => update({ targetReps: t })} />
              ))}
        </View>
        <Button label={`Start ${info.label.toLowerCase()}`} size="lg" onPress={start()} />
        {__DEV__ && (
          <Pressable accessibilityRole="button" onPress={start(true)} hitSlop={8} style={{ alignSelf: 'center' }}>
            <Label tone="muted">Preview a demo set</Label>
          </Pressable>
        )}
      </View>

      <View style={{ gap: space.md }}>
        <Label>History</Label>
        <HistoryList rows={rows} guard={guard} showExercise={false} empty={`No ${info.unit} sets yet. Each finished set is saved here.`} />
      </View>
    </ScrollView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <Label>{label}</Label>
      <Display size={type.title * 1.4}>{value}</Display>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: space.xl, gap: space.xxl, width: '100%', maxWidth: 560, alignSelf: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  statsRow: { flexDirection: 'row', gap: space.md },
  card: {
    gap: space.lg,
    padding: space.xl,
    borderRadius: radius.lg,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.lineSoft,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
