import { Redirect, router, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EXERCISE_IDS, EXERCISES, isTimed } from '@/engine/exercises';
import type { Exercise } from '@/engine/types';
import { HistoryList } from '@/features/history/HistoryList';
import { ScreenTimeCard } from '@/features/screentime/ScreenTimeCard';
import { fatGrams, kgToLb, lbToKg, weightPlan } from '@/fitness/energy';
import { dayMonth, kcal, weight } from '@/fitness/format';
import { goalProgress, setsKcal } from '@/fitness/goal';
import { formatDuration } from '@/session/copy';
import { dailyTotals, listSessions, listSessionsSince, type SessionRow } from '@/storage/history';
import { bodyOf, LIMITS, useProfile, withWeighIn, type Profile } from '@/storage/profile';
import { GOAL_TARGETS, useSettings } from '@/storage/settings';
import { ExerciseGlyph } from '@/ui/Diagrams';
import { NumberField } from '@/ui/NumberField';
import { Body, Button, Chip, Display, Label, Strong } from '@/ui/primitives';
import { Scoreboard } from '@/ui/Scoreboard';
import { color, font, radius, space } from '@/ui/theme';
import { useTapGuard } from '@/ui/useTapGuard';

const show = (e: Exercise, v: number) => (isTimed(e) ? formatDuration(v) : String(v));

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/**
 * Home: the goal as a big filling number, today's work and what it burned,
 * every exercise one tap away, and recent sets.
 */
export default function Home() {
  const insets = useSafeAreaInsets();
  const guard = useTapGuard();
  const [settings] = useSettings();
  const [profile, setProfile] = useProfile();
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [weekRows, setWeekRows] = useState<SessionRow[]>([]);
  const [goalRows, setGoalRows] = useState<SessionRow[]>([]);
  const [filter, setFilter] = useState<Exercise | 'all'>('all');

  const reload = useCallback(() => {
    setRows(listSessions());
    // Totals need every set of the last 7 days, not just the latest 60.
    setWeekRows(listSessionsSince(startOfToday() - 6 * 86_400_000));
    const g = profile?.repGoal;
    setGoalRows(profile && profile.aim === 'get-stronger' && g ? listSessions(2000, profile.startedAt, g.exercise) : []);
  }, [profile]);
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
  const todayRows = weekRows.filter((r) => r.startedAt >= startOfToday());
  const weekTotal = (e: Exercise) => week.reduce((s, d) => s + d.byExercise[e], 0);
  const doneToday = EXERCISE_IDS.filter((e) => (today?.[e] ?? 0) > 0);
  // Picked exercises first, the rest after in the usual order.
  const order = [...settings.focus, ...EXERCISE_IDS.filter((e) => !settings.focus.includes(e))];
  const daily = settings.dailyGoal === 'none' ? null : GOAL_TARGETS[settings.dailyGoal];
  const repsToday = (today?.pushup ?? 0) + (today?.crunch ?? 0) + (today?.pullup ?? 0);
  const holdToday = (today?.plank ?? 0) + (today?.sidePlank ?? 0);
  const shown = filter === 'all' ? rows : rows.filter((r) => r.exercise === filter);

  const progress = useMemo(
    () => (profile ? goalProgress(profile, profile.aim === 'get-stronger' ? goalRows : weekRows) : null),
    [profile, goalRows, weekRows],
  );
  // The first time a lasting goal is met: remember the day and celebrate once.
  useEffect(() => {
    if (profile && progress?.met && profile.aim !== 'stay-active' && profile.goalMetAt === null) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setProfile({ ...profile, goalMetAt: Date.now() });
    }
  }, [profile, progress?.met, setProfile]);

  if (settings.experience === null) return <Redirect href="/welcome" />;

  const burned = profile ? setsKcal(todayRows, profile.weightKg) : 0;
  const editGoal = guard(() => router.push({ pathname: '/welcome', params: { redo: '1' } }));

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: color.ground }}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[styles.page, { paddingTop: insets.top + space.md, paddingBottom: insets.bottom + space.huge }]}
    >
      <View style={styles.header}>
        <Display size={26}>Trueline</Display>
        <Pressable accessibilityRole="button" onPress={guard(() => router.push('/settings'))} hitSlop={12} style={styles.headerBtn}>
          <Strong size={16}>Settings</Strong>
        </Pressable>
      </View>

      {profile && progress ? (
        <GoalBlock profile={profile} progress={progress} onEdit={editGoal} onWeigh={(kg) => setProfile(withWeighIn(profile, kg))} />
      ) : (
        <View style={{ gap: space.md }}>
          <Display size={40}>No goal yet</Display>
          <Body tone="chalk2">Set one and Trueline works out the calories, a target date and how far along you are.</Body>
          <Button label="Set a goal" size="lg" onPress={editGoal} />
        </View>
      )}

      <View style={{ gap: space.md }}>
        <Label>Today</Label>
        {doneToday.length === 0 ? (
          <Body tone="chalk2">No sets yet today. Pick an exercise below to start.</Body>
        ) : (
          <>
            <View style={styles.todayRow}>
              {doneToday.map((e) => (
                <View key={e}>
                  <Display size={48} style={{ fontFamily: font.displayBlack }}>
                    {show(e, today![e])}
                  </Display>
                  <Body size={14} tone="chalk2">
                    {EXERCISES[e].unit}
                  </Body>
                </View>
              ))}
            </View>
            {profile && burned > 0 && (
              <Body size={15} accessibilityLabel={`${Math.round(burned)} calories burned in sets today`}>
                <Strong size={15}>{kcal(burned)} kcal</Strong>
                {` burned in sets, the energy in about ${Math.max(1, Math.round(fatGrams(burned)))} g of fat.`}
              </Body>
            )}
          </>
        )}
        {daily && (
          <View
            style={{ gap: space.sm }}
            accessibilityLabel={`Daily goal: ${repsToday} of ${daily.reps} reps, ${formatDuration(holdToday)} of ${formatDuration(daily.holdMs)} plank`}
          >
            <GoalBar label="Reps" value={repsToday} target={daily.reps} text={`${repsToday} of ${daily.reps}`} />
            <GoalBar
              label="Plank"
              value={holdToday}
              target={daily.holdMs}
              text={`${formatDuration(holdToday)} of ${formatDuration(daily.holdMs)}`}
            />
          </View>
        )}
      </View>

      <ScreenTimeCard guard={guard} />

      <View style={{ gap: space.md }}>
        <Label>Exercises</Label>
        <View style={{ gap: 2 }}>
          {order.map((e) => {
            const last = settings.exercise === e;
            return (
              <Pressable
                key={e}
                accessibilityRole="button"
                accessibilityLabel={`${EXERCISES[e].label}. ${EXERCISES[e].tagline}. ${show(e, weekTotal(e))} this week.`}
                onPress={guard(() => router.push({ pathname: '/exercise/[id]', params: { id: e } }))}
                style={({ pressed }) => [styles.lane, pressed && { backgroundColor: color.raised }]}
              >
                <View style={[styles.laneMark, last && { backgroundColor: color.vial }]} />
                <ExerciseGlyph exercise={e} active size={44} />
                <View style={{ flex: 1, gap: 0 }}>
                  <Display size={26}>{EXERCISES[e].label}</Display>
                  <Body size={13} tone="chalk2">
                    {EXERCISES[e].tagline}
                  </Body>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Display size={26} style={{ fontVariant: ['tabular-nums'] }}>
                    {show(e, weekTotal(e))}
                  </Display>
                  <Body size={12} tone="muted">
                    this week
                  </Body>
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
          empty={rows.length === 0 ? 'Each finished set is saved here.' : 'No sets of this exercise yet.'}
        />
      </View>
    </ScrollView>
  );
}

function goalTitle(p: Profile): string {
  if (p.aim === 'lose-fat' && p.targetKg !== null) return `Get to ${weight(p.targetKg, p.units)}`;
  if (p.aim === 'get-stronger' && p.repGoal)
    return `${p.repGoal.reps} ${p.repGoal.exercise === 'pullup' ? 'pull-ups' : 'push-ups'} in one set`;
  return `${p.daysPerWeek} workout days a week`;
}

/** The goal: a title, the filling scoreboard number, where it's heading, and the weigh-in. */
function GoalBlock({
  profile: p,
  progress,
  onEdit,
  onWeigh,
}: {
  profile: Profile;
  progress: ReturnType<typeof goalProgress>;
  onEdit: () => void;
  onWeigh: (kg: number) => void;
}) {
  const [weighing, setWeighing] = useState(false);
  const [draft, setDraft] = useState(p.weightKg);
  const imperial = p.units === 'imperial';
  const lose = p.aim === 'lose-fat' && p.targetKg !== null;
  const plan = lose ? weightPlan(bodyOf(p), p.targetKg!, p.pace) : null;
  // The date set at the start, so it does not drift with every weigh-in.
  const startPlan = lose ? weightPlan({ ...bodyOf(p), weightKg: p.startKg }, p.targetKg!, p.pace, p.startedAt) : null;
  const lastWeigh = p.log[p.log.length - 1];
  const weighedToday = lastWeigh && new Date(lastWeigh.at).toDateString() === new Date().toDateString();
  const value = lose && imperial ? String(Math.round(kgToLb(Number(progress.value)))) : progress.value;
  const unit = lose && imperial ? progress.unit.replace('kg', 'lb') : progress.unit;
  const of = lose && imperial ? `of ${Math.round(kgToLb(p.startKg - p.targetKg!))} lb` : progress.of;
  const reached = progress.met && p.aim !== 'stay-active';

  return (
    <View style={{ gap: space.md }}>
      <View style={styles.goalHead}>
        <Strong size={17} style={{ flex: 1 }}>
          {goalTitle(p)}
        </Strong>
        <Pressable accessibilityRole="button" accessibilityLabel="Change goal" onPress={onEdit} hitSlop={10} style={styles.headerBtn}>
          <Strong size={15} tone="vial">
            Change
          </Strong>
        </Pressable>
      </View>
      <View style={styles.score}>
        <Scoreboard value={value} fraction={progress.fraction} met={progress.met} size={176} label={`${value} ${unit}, ${of}`} />
        <View style={styles.scoreSide} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <Strong size={18}>{unit}</Strong>
          <Display size={30} tone={progress.met ? 'good' : 'chalk2'}>
            {of}
          </Display>
        </View>
      </View>

      {reached ? (
        <View style={styles.won}>
          <Display size={32} tone="ink">
            Goal reached
          </Display>
          <Body size={15} tone="ink">
            {p.goalMetAt ? `You got there on ${dayMonth(p.goalMetAt)}.` : 'You got there.'} Set the next one when you are ready.
          </Body>
          <Button label="Set a new goal" variant="quiet" onPress={onEdit} style={{ backgroundColor: color.ground, marginTop: space.xs }} />
        </View>
      ) : p.aim === 'stay-active' && progress.met ? (
        <Body tone="good">This week is done. Anything more is a bonus.</Body>
      ) : lose && startPlan && plan ? (
        <Body tone="chalk2">
          {Number.isFinite(startPlan.by) ? `Planned for ${dayMonth(startPlan.by)}. ` : ''}
          {`Eat about ${kcal(plan.eatKcal)} kcal a day.`}
        </Body>
      ) : null}

      {lose && !reached && (
        weighing ? (
          <View style={{ gap: space.md }}>
            <NumberField
              label="Today’s weight"
              value={imperial ? Math.round(kgToLb(draft)) : draft}
              onChange={(v) => setDraft(imperial ? lbToKg(v) : v)}
              min={imperial ? Math.round(kgToLb(LIMITS.weightKg[0])) : LIMITS.weightKg[0]}
              max={imperial ? Math.round(kgToLb(LIMITS.weightKg[1])) : LIMITS.weightKg[1]}
              step={imperial ? 1 : 0.1}
              decimals={imperial ? 0 : 1}
              unit={imperial ? 'lb' : 'kg'}
            />
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Button
                label="Save"
                style={{ flex: 1 }}
                onPress={() => {
                  onWeigh(draft);
                  setWeighing(false);
                }}
              />
              <Button label="Cancel" variant="ghost" style={{ flex: 1 }} onPress={() => setWeighing(false)} />
            </View>
            <Body tone="muted" size={13}>
              Weight swings by a kilo or two from water and food. Weigh in at the same time each week, before breakfast.
            </Body>
          </View>
        ) : (
          <Button
            label={weighedToday ? `Weighed in today: ${weight(p.weightKg, p.units)}` : 'Log my weight'}
            variant="quiet"
            onPress={() => {
              setDraft(p.weightKg);
              setWeighing(true);
            }}
          />
        )
      )}
    </View>
  );
}

/** One line of the daily goal: a thin bar that turns green when met. */
function GoalBar({ label, value, target, text }: { label: string; value: number; target: number; text: string }) {
  const k = Math.min(1, value / Math.max(1, target));
  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Body size={13} tone="chalk2">
          {label}
        </Body>
        <Strong size={13} tone={k >= 1 ? 'good' : 'chalk'}>
          {k >= 1 ? `${text}, done` : text}
        </Strong>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${Math.round(k * 100)}%`, backgroundColor: k >= 1 ? color.good : color.vial }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: 6, backgroundColor: color.lineSoft, overflow: 'hidden' },
  fill: { height: 6 },
  page: { paddingHorizontal: space.xl, gap: space.xxl, width: '100%', maxWidth: 560, alignSelf: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerBtn: { minHeight: 44, justifyContent: 'center' },
  score: { flexDirection: 'row', alignItems: 'flex-end', gap: space.lg, marginTop: -space.lg },
  scoreSide: { flex: 1, paddingBottom: 30, gap: 2 },
  goalHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  won: { gap: space.xs, padding: space.lg, borderRadius: radius.md, backgroundColor: color.good },
  todayRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xl },
  lane: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    paddingRight: space.lg,
    backgroundColor: color.surface,
    minHeight: 72,
  },
  laneMark: { width: 4, alignSelf: 'stretch', backgroundColor: 'transparent' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
