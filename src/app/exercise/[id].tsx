import { Redirect, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DIFFICULTIES } from '@/engine/difficulty';
import { EXERCISES, isExercise, isTimed, viewFor } from '@/engine/exercises';
import type { Exercise } from '@/engine/types';
import { TechniqueSteps } from '@/features/exercise/TechniqueList';
import { safetyNotes } from '@/features/onboarding/safety';
import { HistoryList } from '@/features/history/HistoryList';
import { AddWeightForCalories, CaloriesHow, useEnergyBody } from '@/features/energy/Calories';
import { TYPICAL_SET, typicalSetKcal } from '@/fitness/energy';
import { kcalText } from '@/fitness/format';
import { setsKcal } from '@/fitness/goal';
import { FOCUS_CHOICES, type FocusChoice } from '@/screentime/focus';
import { effectiveStrictness } from '@/screentime/rules';
import { setFocusBlockAll, setFocusChoice, useScreenTime } from '@/screentime/store';
import { difficultyCopy, formatDuration, rotationCopy } from '@/session/copy';
import { bestFor, dailyTotals, listSessionsFor, listSessionsSince, type SessionRow } from '@/storage/history';
import { HOLD_TARGETS, TARGETS, targetFor, useSettings } from '@/storage/settings';
import { ExerciseGlyph } from '@/ui/Diagrams';
import { ExerciseAnimation } from '@/ui/ExerciseAnimation';
import { OrientationPicker } from '@/ui/OrientationPicker';
import { Body, Button, Chip, Display, Label, Mono, Stat, Strong } from '@/ui/primitives';
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
  const body = useEnergyBody();
  const weekKcal = body
    ? setsKcal(
        weekRows.filter((r) => r.exercise === exercise),
        body,
      )
    : null;
  const guided = settings.experience !== 'quick';
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
    <View style={{ flex: 1, backgroundColor: color.ground }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.page, { paddingTop: insets.top + space.lg, paddingBottom: space.huge }]}
      >
        <View style={styles.header}>
          <Pressable accessibilityRole="button" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} hitSlop={12}>
            <Label tone="chalk">‹ Exercises</Label>
          </Pressable>
        </View>

        <View style={styles.titleRow}>
          <ExerciseGlyph exercise={exercise} size={72} />
          <View style={{ flex: 1, gap: 2 }}>
            <Display size={type.headline}>{info.label}</Display>
            <Mono tone="vial">{info.tagline}</Mono>
          </View>
        </View>

        <View style={{ gap: space.sm }}>
          <View style={styles.statsRow}>
            <Stat size="lg" label="Today" value={show(today)} />
            <Stat size="lg" label="Last 7 days" value={show(weekTotal)} />
            <Stat size="lg" label={timed ? 'Best hold' : 'Best set'} value={best === null ? '—' : show(best)} />
          </View>
          <WeekBars
            days={week.map((d) => d.day)}
            values={values}
            label={`${show(weekTotal)} ${info.unit} in the last 7 days`}
            height={56}
          />
          {body ? (
            <View style={{ gap: space.xs }}>
              <Mono size={type.small} tone="muted">
                {`${weekKcal && weekKcal.kcal >= 1 ? `${kcalText(weekKcal)} this week from ${info.label.toLowerCase()} · ` : ''}${TYPICAL_SET[exercise].label} ${kcalText(typicalSetKcal(exercise, body))}`}
              </Mono>
              <CaloriesHow />
            </View>
          ) : (
            <AddWeightForCalories />
          )}
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
              <Body key={n} size={type.note}>
                {n}
              </Body>
            ))}
          </View>
        )}

        <View style={{ gap: space.md }}>
          <Label>{info.perSide ? 'Target · each side' : 'Target'}</Label>
          <View style={styles.chips}>
            {timed
              ? HOLD_TARGETS.map((t) => (
                  <Chip
                    key={t}
                    label={t === 0 ? 'Open' : formatDuration(t * 1000)}
                    selected={targetFor(settings, exercise) === t}
                    onPress={() => update({ targets: { ...settings.targets, [exercise]: t } })}
                  />
                ))
              : TARGETS.map((t) => (
                  <Chip
                    key={t}
                    label={t === 0 ? 'Open' : String(t)}
                    selected={targetFor(settings, exercise) === t}
                    onPress={() => update({ targets: { ...settings.targets, [exercise]: t } })}
                  />
                ))}
          </View>
        </View>

        {/* Camera view, phone, difficulty and focus: set once, rarely changed, so one row says what they are. */}
        <SetOptions exercise={exercise} view={view} />

        {__DEV__ && (
          <Pressable accessibilityRole="button" onPress={start(true)} hitSlop={8} style={{ alignSelf: 'center' }}>
            <Label tone="muted">Preview a demo set</Label>
          </Pressable>
        )}

        <View style={{ gap: space.md }}>
          <Label>History</Label>
          <HistoryList rows={rows} guard={guard} showExercise={false} body={body} empty="No sets yet. Each finished set is saved here." />
        </View>
      </ScrollView>
      {/* Start is always in reach, not after the whole page (like the guide's footer). */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + space.md }]}>
        <Button label={`Start ${info.label.toLowerCase()}`} size="lg" onPress={start()} />
      </View>
    </View>
  );
}

/**
 * The set's options in one row ("Side-on · Landscape · Medium · Focus off"), opening to change them.
 * Each choice keeps its one-line explanation once open.
 */
function SetOptions({ exercise, view }: { exercise: Exercise; view: ReturnType<typeof viewFor> }) {
  const [settings, update] = useSettings();
  const [open, setOpen] = useState(false);
  const st = useScreenTime();
  const info = EXERCISES[exercise];
  const level = difficultyCopy(settings.difficulty, exercise);
  const pull = exercise === 'pullup';
  const focusOn = st.meta.setUp && st.availability !== 'unsupported';
  const focus = st.meta.focusChoice;
  const summary = [
    info.frontView ? (view === 'side' ? 'Side-on' : 'Facing the phone') : null,
    pull ? null : settings.orientation === 'landscape' ? 'Landscape' : 'Portrait',
    level.label,
    focusOn ? (focus === null ? 'Focus off' : focus === 'set' ? 'Focus this set' : `Focus ${focus} min`) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <View style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`Set options: ${summary}`}
        accessibilityHint={open ? 'Hides the options' : 'Shows the options to change them'}
        onPress={() => setOpen((o) => !o)}
        style={styles.optionsHead}
      >
        <View style={{ flex: 1, gap: 2 }}>
          <Label>Set options</Label>
          <Strong size={type.detail}>{summary}</Strong>
        </View>
        <Label tone="vial">{open ? 'Done' : 'Change'}</Label>
      </Pressable>
      {open && (
        <>
          {info.frontView && (
            <View style={{ gap: space.sm }}>
              <Label>Camera view</Label>
              <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Camera view">
                <Chip
                  label="Side-on"
                  selected={view === 'side'}
                  onPress={() => update({ views: { ...settings.views, [exercise]: 'side' } })}
                />
                <Chip
                  label="Facing the phone"
                  selected={view === 'front'}
                  onPress={() => update({ views: { ...settings.views, [exercise]: 'front' } })}
                />
              </View>
              <Body tone="muted" size={type.note}>
                {view === 'side'
                  ? 'The phone beside you sees your whole body line: the strictest form checks.'
                  : 'The phone on the floor beyond your hands: easier to set up. Hips and knees are only judged side-on.'}
              </Body>
            </View>
          )}
          {!pull && (
            <View style={{ gap: space.sm }}>
              <Label>Phone</Label>
              <OrientationPicker compact value={settings.orientation} onChange={(orientation) => update({ orientation })} />
            </View>
          )}
          <View style={{ gap: space.sm }}>
            <Label>Difficulty · all exercises</Label>
            <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Difficulty, for all exercises">
              {DIFFICULTIES.map((d) => (
                <Chip
                  key={d}
                  label={difficultyCopy(d, exercise).label}
                  selected={settings.difficulty === d}
                  onPress={() => update({ difficulty: d })}
                />
              ))}
            </View>
            <Body tone="muted" size={type.note}>
              {`${level.short}. ${level.detail}`}
            </Body>
          </View>
          <FocusChooser />
        </>
      )}
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
  const options: [FocusChoice | null, string][] = [
    [null, 'Off'],
    ['set', 'This set'],
    ...FOCUS_CHOICES.map((m) => [m, `${m} min`] as [FocusChoice, string]),
  ];
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
      <Body tone="muted" size={type.caption}>
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
  footer: {
    paddingHorizontal: space.xl,
    paddingTop: space.md,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    backgroundColor: color.ground,
    borderTopWidth: 1,
    borderTopColor: color.lineSoft,
  },
  page: { paddingHorizontal: space.xl, gap: space.xxl, width: '100%', maxWidth: 560, alignSelf: 'center' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    columnGap: space.md,
    rowGap: space.xs,
    alignItems: 'center',
  },
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
  optionsHead: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 44 },
  cardHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    columnGap: space.md,
    rowGap: space.xs,
    alignItems: 'center',
  },
  warn: {
    gap: space.sm,
    padding: space.lg,
    borderRadius: radius.md,
    backgroundColor: color.cueSoft,
    borderWidth: 1,
    borderColor: color.cue,
  },
});
