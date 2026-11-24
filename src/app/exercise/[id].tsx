import { Redirect, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DIFFICULTIES } from '@/engine/difficulty';
import { EXERCISES, isExercise, isTimed, viewFor } from '@/engine/exercises';
import type { Exercise } from '@/engine/types';
import { setupSteps } from '@/features/exercise/setupSteps';
import { TechniqueSteps } from '@/features/exercise/TechniqueList';
import { safetyNotes } from '@/features/onboarding/safety';
import { HistoryList } from '@/features/history/HistoryList';
import { FOCUS_CHOICES, type FocusChoice } from '@/screentime/focus';
import { effectiveStrictness } from '@/screentime/rules';
import { setFocusBlockAll, setFocusChoice, useScreenTime } from '@/screentime/store';
import { difficultyCopy, formatDuration, rotationCopy } from '@/session/copy';
import { bestFor, dailyTotals, listSessionsFor, listSessionsSince, type SessionRow } from '@/storage/history';
import { HOLD_TARGETS, TARGETS, useSettings } from '@/storage/settings';
import { ExerciseGlyph } from '@/ui/Diagrams';
import { ExerciseAnimation } from '@/ui/ExerciseAnimation';
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
  const view = viewFor(exercise, settings.views);
  const notes = safetyNotes(settings.safety, exercise);

  const go = (demo: boolean) => {
    // The set runs with this exercise; the choice is remembered for next time.
    update({ exercise });
    if (demo) router.push({ pathname: '/session', params: { demo: '1', ex: exercise } });
    // The step-by-step guide comes first in guided mode, and before anyone's first set of an exercise.
    else if (guided || rows.length === 0) router.push({ pathname: '/guide', params: { ex: exercise } });
    else router.push('/session');
  };

  const start = (demo = false) =>
    guard(() => {
      // Landscape only tracks well when the picture turns with the phone: ask first.
      if (demo || settings.orientation !== 'landscape' || !settings.rotationReminder) {
        go(demo);
        return;
      }
      const c = rotationCopy(Platform.OS);
      Alert.alert(c.title, c.body, [
        {
          text: "Don't remind me",
          onPress: () => {
            update({ rotationReminder: false });
            go(false);
          },
        },
        { text: c.ok, style: 'default', isPreferred: true, onPress: () => go(false) },
      ]);
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

      <View style={styles.card}>
        <View style={styles.cardHead}>
          <Label tone="vial">How to do it</Label>
          <Pressable
            accessibilityRole="button"
            hitSlop={10}
            onPress={guard(() => router.push({ pathname: '/guide', params: { ex: exercise, view: '1' } }))}
          >
            <Label tone="chalk">Step-by-step guide ›</Label>
          </Pressable>
        </View>
        <ExerciseAnimation exercise={exercise} orientation={settings.orientation} width={art} view={view} />
        <TechniqueSteps exercise={exercise} compact={!guided} />
      </View>

      {notes.length > 0 && (
        <View style={styles.warn}>
          <Label tone="cue">Take care</Label>
          {notes.map((n) => (
            <Body key={n} size={14}>
              {n}
            </Body>
          ))}
        </View>
      )}

      {info.frontView && (
        <View style={{ gap: space.md }}>
          <Label>Camera view</Label>
          <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Camera view">
            <Chip label="Side-on" selected={view === 'side'} onPress={() => update({ views: { ...settings.views, [exercise]: 'side' } })} />
            <Chip
              label="Facing the phone"
              selected={view === 'front'}
              onPress={() => update({ views: { ...settings.views, [exercise]: 'front' } })}
            />
          </View>
          <Body tone="muted" size={14}>
            {view === 'side'
              ? 'The phone beside you sees your whole body line: the strictest form checks.'
              : exercise === 'plank'
                ? 'The phone on the floor beyond your hands. Easier to set up; times the hold and checks your arms. Hips and knees are only judged side-on, so plank test mode ends only when you drop out of position.'
                : 'The phone on the floor beyond your hands. Easier to set up; counts reps and checks depth, arms and elbows. Hips and knees are only judged side-on, so knee push-ups count here.'}
          </Body>
        </View>
      )}

      {guided ? (
        <View style={styles.card}>
          <Label tone="vial">Before you start</Label>
          <OrientationPicker value={settings.orientation} onChange={(orientation) => update({ orientation })} />
          <View style={{ gap: space.md }}>
            {setupSteps(exercise, settings.difficulty, settings.orientation, view).map((s, i) => (
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
            <Chip
              key={d}
              label={difficultyCopy(d, exercise).label}
              selected={settings.difficulty === d}
              onPress={() => update({ difficulty: d })}
            />
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
        <Label>{info.perSide ? 'Target, each side' : 'Target'}</Label>
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
                <Chip
                  key={t}
                  label={t === 0 ? 'Open' : String(t)}
                  selected={settings.targetReps === t}
                  onPress={() => update({ targetReps: t })}
                />
              ))}
        </View>
        <FocusChooser />
        <Button label={`Start ${info.label.toLowerCase()}`} size="lg" onPress={start()} />
        {__DEV__ && (
          <Pressable accessibilityRole="button" onPress={start(true)} hitSlop={8} style={{ alignSelf: 'center' }}>
            <Label tone="muted">Preview a demo set</Label>
          </Pressable>
        )}
      </View>

      <View style={{ gap: space.md }}>
        <Label>History</Label>
        <HistoryList rows={rows} guard={guard} showExercise={false} empty="No sets yet. Each finished set is saved here." />
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

/**
 * Workout focus: block the Screen Time apps while this set runs (research guide §10.4).
 * Only shown once screen time is set up on a phone that supports it.
 */
function FocusChooser() {
  const st = useScreenTime();
  if (!st.meta.setUp || st.availability === 'unsupported') return null;
  const choice = st.meta.focusChoice;
  const strict = effectiveStrictness(st.rules, st.now) === 'strict';
  const options: [FocusChoice | null, string][] = [[null, 'Off'], ['set', 'This set'], ...FOCUS_CHOICES.map((m) => [m, `${m} min`] as [FocusChoice, string])];
  const what = st.meta.focusBlockAll ? 'All apps except your always-allowed ones' : 'Your blocked apps';
  return (
    <View style={{ gap: space.sm }}>
      <Label>Focus</Label>
      <View style={styles.chips}>
        {options.map(([v, l]) => (
          <Chip key={l} label={l} selected={choice === v} onPress={() => setFocusChoice(v)} />
        ))}
      </View>
      {choice !== null && (
        <View style={styles.chips}>
          <Chip label="My blocked apps" selected={!st.meta.focusBlockAll} onPress={() => setFocusBlockAll(false)} />
          <Chip label="Everything" selected={st.meta.focusBlockAll} onPress={() => setFocusBlockAll(true)} />
        </View>
      )}
      <Body tone="muted" size={13}>
        {choice === null
          ? 'Block your Screen Time apps while you train.'
          : choice === 'set'
            ? `${what} stay closed until the set ends (at most 1 hour)${strict ? '. Strict: leaving early doesn\u2019t end it' : ''}.`
            : `${what} stay closed for ${choice} minutes, even after the set${strict ? '. Strict: it can\u2019t be ended early' : ''}.`}
      </Body>
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
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  warn: {
    gap: space.sm,
    padding: space.lg,
    borderRadius: radius.md,
    backgroundColor: color.cueSoft,
    borderWidth: 1,
    borderColor: color.cue,
  },
});
