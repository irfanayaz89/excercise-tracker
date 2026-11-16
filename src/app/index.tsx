import { Redirect, router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EXERCISE_IDS, EXERCISES, isTimed } from '@/engine/exercises';
import type { Exercise } from '@/engine/types';
import { HistoryList } from '@/features/history/HistoryList';
import { formatDuration } from '@/session/copy';
import { dailyTotals, listSessions, listSessionsSince, type SessionRow } from '@/storage/history';
import { useSettings } from '@/storage/settings';
import { ExerciseGlyph } from '@/ui/Diagrams';
import { Body, Chip, Display, Label, Mono, Strong } from '@/ui/primitives';
import { color, radius, space } from '@/ui/theme';
import { useTapGuard } from '@/ui/useTapGuard';

const show = (e: Exercise, v: number) => (isTimed(e) ? formatDuration(v) : String(v));

/**
 * Home: today at a glance, every exercise as a card, and recent sets.
 * Each exercise has its own screen (setup, level, target, Start, its history),
 * so adding an exercise adds a card, not more controls here.
 */
export default function Home() {
  const insets = useSafeAreaInsets();
  const guard = useTapGuard();
  const [settings] = useSettings();
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [weekRows, setWeekRows] = useState<SessionRow[]>([]);
  const [filter, setFilter] = useState<Exercise | 'all'>('all');

  const reload = useCallback(() => {
    setRows(listSessions());
    // Totals need every set of the last 7 days, not just the latest 60.
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - 6);
    setWeekRows(listSessionsSince(start.getTime()));
  }, []);
  useFocusEffect(reload);
  // Coming back to the app (e.g. the next morning) does not refocus the screen,
  // but "Today" must move on to the new day.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') reload();
    });
    return () => sub.remove();
  }, [reload]);

  const week = useMemo(() => dailyTotals(weekRows, 7), [weekRows]);
  const today = week[week.length - 1]?.byExercise;
  const weekTotal = (e: Exercise) => week.reduce((s, d) => s + d.byExercise[e], 0);
  const doneToday = EXERCISE_IDS.filter((e) => (today?.[e] ?? 0) > 0);
  const shown = filter === 'all' ? rows : rows.filter((r) => r.exercise === filter);

  if (settings.experience === null) return <Redirect href="/welcome" />;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: color.ground }}
      contentContainerStyle={[styles.page, { paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.huge }]}
    >
      <View style={styles.header}>
        <View style={styles.wordmark}>
          <View style={styles.markLine} />
          <Display size={28} style={{ letterSpacing: 5 }}>
            TRUELINE
          </Display>
        </View>
        <Pressable accessibilityRole="button" onPress={guard(() => router.push('/settings'))} hitSlop={12}>
          <Label tone="chalk">Settings</Label>
        </Pressable>
      </View>

      <View style={{ gap: space.md }}>
        <Label>Today</Label>
        {doneToday.length === 0 ? (
          <Display size={40}>Nothing yet today</Display>
        ) : (
          <View style={styles.todayRow}>
            {doneToday.map((e) => (
              <View key={e} style={styles.todayItem}>
                <Display size={56} style={{ fontFamily: 'BigShouldersDisplay_900Black' }}>
                  {show(e, today![e])}
                </Display>
                <Mono size={12} tone="muted">
                  {EXERCISES[e].unit}
                </Mono>
              </View>
            ))}
          </View>
        )}
      </View>

      <View style={{ gap: space.md }}>
        <Label>Exercises</Label>
        <View style={styles.grid}>
          {EXERCISE_IDS.map((e) => {
            const last = settings.exercise === e;
            return (
              <Pressable
                key={e}
                accessibilityRole="button"
                accessibilityLabel={`${EXERCISES[e].label}. ${EXERCISES[e].tagline}. ${show(e, weekTotal(e))} this week.`}
                onPress={guard(() => router.push({ pathname: '/exercise/[id]', params: { id: e } }))}
                style={({ pressed }) => [styles.card, last && styles.cardLast, pressed && { opacity: 0.85 }]}
              >
                <ExerciseGlyph exercise={e} active size={56} />
                <View style={{ gap: 2 }}>
                  <Strong size={17}>{EXERCISES[e].label}</Strong>
                  <Mono size={12} tone={last ? 'vial' : 'muted'}>
                    {EXERCISES[e].tagline}
                  </Mono>
                </View>
                <View style={styles.cardFoot}>
                  <Mono size={12} tone="muted">
                    This week
                  </Mono>
                  <Strong size={15}>{show(e, weekTotal(e))}</Strong>
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={{ gap: space.md }}>
        <Label>Recent sets</Label>
        {rows.length > 0 && (
          <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Show sets of">
            <Chip label="All" selected={filter === 'all'} onPress={() => setFilter('all')} />
            {EXERCISE_IDS.map((e) => (
              <Chip key={e} label={EXERCISES[e].label} selected={filter === e} onPress={() => setFilter(e)} />
            ))}
          </View>
        )}
        <HistoryList
          rows={shown.slice(0, 30)}
          guard={guard}
          empty={rows.length === 0 ? 'No sets yet. Pick an exercise above; each finished set is saved here.' : 'No sets of this exercise yet.'}
        />
      </View>
      {rows.length === 0 && (
        <Body tone="faint" size={13}>
          More exercises are on the way.
        </Body>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: space.xl, gap: space.xxl, width: '100%', maxWidth: 560, alignSelf: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  wordmark: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  markLine: { width: 22, height: 4, borderRadius: 2, backgroundColor: color.vial },
  todayRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xl },
  todayItem: { gap: 0 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  card: {
    flexBasis: '47%',
    flexGrow: 1,
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.lg,
    backgroundColor: color.surface,
    borderWidth: 1.5,
    borderColor: color.lineSoft,
  },
  cardLast: { borderColor: color.vial },
  cardFoot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
