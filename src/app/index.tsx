import { Redirect, router, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EXERCISE_IDS, EXERCISES, isTimed } from '@/engine/exercises';
import type { Exercise } from '@/engine/types';
import { HistoryList } from '@/features/history/HistoryList';
import { AddWeightForCalories, CaloriesHow } from '@/features/energy/Calories';
import { ScreenTimeCard } from '@/features/screentime/ScreenTimeCard';
import { fatGrams, kgToLb, lbToKg, scaleKcal, weightPlan, workoutKcal, ZERO_KCAL } from '@/fitness/energy';
import { ProjectionCard } from '@/features/energy/Projection';
import { dayMonth, kcal, kcalText, weight, WHY_LABELS } from '@/fitness/format';
import { daysSinceLastSet, goalProgress, planWorkoutKcalPerDay, setsKcal, weekStreak } from '@/fitness/goal';
import { formatDuration } from '@/session/copy';
import { dailyTotals, listSessions, listSessionsSince, type SessionRow } from '@/storage/history';
import { bodyOf, LIMITS, useProfile, withWeighIn, type Profile } from '@/storage/profile';
import { GOAL_TARGETS, useSettings } from '@/storage/settings';
import { ExerciseGlyph } from '@/ui/Diagrams';
import { NumberField } from '@/ui/NumberField';
import { Body, Button, Chip, Display, Label, Mono, Strong } from '@/ui/primitives';
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
  // Half a year of sets for the weekly streak.
  const [streakRows, setStreakRows] = useState<SessionRow[]>([]);
  const [filter, setFilter] = useState<Exercise | 'all'>('all');

  const reload = useCallback(() => {
    setRows(listSessions());
    // Totals need every set of the last 7 days, not just the latest 60.
    setWeekRows(listSessionsSince(startOfToday() - 6 * 86_400_000));
    setStreakRows(listSessions(5000, startOfToday() - 26 * 7 * 86_400_000));
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

  const body = profile ? { weightKg: profile.weightKg, heightCm: profile.heightCm, sex: profile.sex } : null;
  // 30/60-day outlook: from the user's own last two weeks when there are some, else the plan's 10-minute workout.
  const DAY = 86_400_000;
  const since14 = startOfToday() - 13 * DAY;
  const recent = streakRows.filter((r) => r.startedAt >= since14);
  const recentDays = new Set(recent.map((r) => new Date(r.startedAt).toDateString())).size;
  const perSession = body ? (recentDays >= 2 ? scaleKcal(setsKcal(recent, body), 1 / recentDays) : workoutKcal(body)) : null;
  const fx = profile?.repGoal?.exercise ?? 'pushup';
  const fxRecent = recent.filter((r) => r.exercise === fx);
  const forecast =
    fxRecent.length > 0 && streakRows.some((r) => r.exercise === fx && r.startedAt < since14)
      ? { label: fx === 'pullup' ? 'Pull-ups' : 'Push-ups', best: Math.max(...fxRecent.map((r) => r.totalReps)) }
      : null;
  const deficit =
    profile && profile.aim === 'lose-fat' && profile.targetKg !== null && profile.weightKg > profile.targetKg
      ? weightPlan(bodyOf(profile), profile.targetKg, profile.pace).dailyDeficit
      : 0;

  const streakTarget = Math.min(profile?.daysPerWeek ?? 2, 3);
  const streak = weekStreak(streakRows, streakTarget);
  const away = daysSinceLastSet(rows);

  if (settings.experience === null) return <Redirect href="/welcome" />;

  const burned = body ? setsKcal(todayRows, body) : ZERO_KCAL;
  const weekBurned = body ? setsKcal(weekRows, body) : ZERO_KCAL;
  const editGoal = guard(() => router.push({ pathname: '/welcome', params: { redo: '1' } }));

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: color.ground }}
      keyboardShouldPersistTaps="handled"
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

      {away !== null && away >= 7 && (
        <View style={styles.back}>
          <Label tone="vial">Welcome back</Label>
          <Body size={15}>
            {`It's been ${away} days. Everything you did is still here: ${rows.length} sets saved. Start with an easy set; any set counts.`}
          </Body>
        </View>
      )}

      {profile && progress ? (
        <GoalBlock profile={profile} progress={progress} onEdit={editGoal} onWeigh={(kg) => setProfile(withWeighIn(profile, kg))} />
      ) : (
        <View style={{ gap: space.md }}>
          <Display size={40}>No goal yet</Display>
          <Body tone="muted">Set one and Trueline works out the calories, a target date and how far along you are.</Body>
          <Button label="Set a goal" size="lg" onPress={editGoal} />
        </View>
      )}

      {profile && perSession && (
        <ProjectionCard
          perSession={perSession}
          perWeek={profile.daysPerWeek}
          units={profile.units}
          dailyDeficit={deficit}
          forecast={forecast}
          targetChangeKg={deficit > 0 && profile.targetKg !== null ? profile.weightKg - profile.targetKg : null}
        />
      )}

      <View style={{ gap: space.md }}>
        <View style={styles.todayHead}>
          <Label>Today</Label>
          {(streak.current > 0 || streak.best > 0) && (
            <Mono
              size={12}
              tone={streak.current > 0 ? 'vial' : 'muted'}
              accessibilityLabel={`Weekly streak: ${streak.current} weeks in a row with ${streakTarget} workout days. Best ${streak.best}.`}
            >
              {streak.current > 0
                ? `${streak.current}-week streak${streak.thisWeekMet ? '' : `, ${streakTarget} days to keep it`}`
                : `Best streak ${streak.best} ${streak.best === 1 ? 'week' : 'weeks'}`}
            </Mono>
          )}
        </View>
        {doneToday.length === 0 ? (
          <Display size={40}>Nothing yet today</Display>
        ) : (
          <>
            <View style={styles.todayRow}>
              {doneToday.map((e) => (
                <View key={e}>
                  <Display size={56} style={{ fontFamily: font.displayBlack }}>
                    {show(e, today![e])}
                  </Display>
                  <Mono size={12} tone="muted">
                    {EXERCISES[e].unit}
                  </Mono>
                </View>
              ))}
            </View>
            {profile && burned.kcal > 0 && (
              <Body size={15} tone="muted" accessibilityLabel={`About ${Math.max(1, Math.round(burned.kcal))} calories burned in sets today`}>
                <Strong size={15} tone="chalk">{kcalText(burned)}</Strong>
                {' burned in sets today, above resting.'}
              </Body>
            )}
          </>
        )}
        {profile && weekBurned.kcal >= 1 && (
          <View style={{ gap: space.xs }}>
            <Body size={15} tone="muted">
              <Strong size={15} tone="chalk">{`${kcalText(weekBurned)} this week`}</Strong>
              {`, about the energy in ${Math.max(1, Math.round(fatGrams(weekBurned.kcal)))} g of body fat.`}
            </Body>
            <CaloriesHow />
          </View>
        )}
        {!profile && doneToday.length > 0 && <AddWeightForCalories />}
        {daily && (
          <View
            style={styles.goal}
            accessibilityLabel={`Daily goal: ${repsToday} of ${daily.reps} reps, ${formatDuration(holdToday)} of ${formatDuration(daily.holdMs)} plank`}
          >
            <GoalBar label="Reps" value={repsToday} target={daily.reps} text={`${repsToday} / ${daily.reps}`} />
            <GoalBar
              label="Plank"
              value={holdToday}
              target={daily.holdMs}
              text={`${formatDuration(holdToday)} / ${formatDuration(daily.holdMs)}`}
            />
          </View>
        )}
      </View>

      <ScreenTimeCard guard={guard} />

      <View style={{ gap: space.md }}>
        <Label>Exercises</Label>
        <View style={styles.grid}>
          {order.map((e) => {
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
          body={body}
          rows={shown.slice(0, 30)}
          guard={guard}
          empty={
            rows.length === 0 ? 'No sets yet. Pick an exercise above; each finished set is saved here.' : 'No sets of this exercise yet.'
          }
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

function goalTitle(p: Profile): string {
  if (p.aim === 'lose-fat' && p.targetKg !== null) return `Get to ${weight(p.targetKg, p.units)}`;
  if (p.aim === 'get-stronger' && p.repGoal)
    return `${p.repGoal.reps} ${p.repGoal.exercise === 'pullup' ? 'pull-ups' : 'push-ups'} in one set`;
  if (p.aim === 'less-screen') return `${p.daysPerWeek} workout days a week, earning your screen time`;
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
  const plan = lose ? weightPlan(bodyOf(p), p.targetKg!, p.pace, undefined, planWorkoutKcalPerDay(p)) : null;
  // The date set at the start, so it does not drift with every weigh-in.
  const startPlan = lose
    ? weightPlan({ ...bodyOf(p), weightKg: p.startKg }, p.targetKg!, p.pace, p.startedAt, planWorkoutKcalPerDay({ ...p, weightKg: p.startKg }))
    : null;
  const lastWeigh = p.log[p.log.length - 1];
  const weighedToday = lastWeigh && new Date(lastWeigh.at).toDateString() === new Date().toDateString();
  const value = lose && imperial ? String(Math.round(kgToLb(Number(progress.value)))) : progress.value;
  const unit = lose && imperial ? progress.unit.replace('kg', 'lb') : progress.unit;
  const of = lose && imperial ? `of ${Math.round(kgToLb(p.startKg - p.targetKg!))} lb` : progress.of;
  const reached = progress.met && p.aim !== 'stay-active';

  return (
    <View style={{ gap: space.md }}>
      <View style={styles.goalHead}>
        <View style={{ flex: 1, gap: 2 }}>
          <Label>{goalTitle(p)}</Label>
          {p.why.length > 0 && (
            <Mono size={12} tone="muted">
              {`For ${p.why.map((w) => WHY_LABELS[w].toLowerCase()).join(', ')}`}
            </Mono>
          )}
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Change goal" onPress={onEdit} hitSlop={12}>
          <Label tone="vial">Change</Label>
        </Pressable>
      </View>
      <View style={styles.score} accessible accessibilityLabel={`${value} ${unit}, ${of}`}>
        <Display size={72} tone={progress.met ? 'good' : 'chalk'} style={{ fontFamily: font.displayBlack }}>
          {value}
        </Display>
        <Mono size={12} tone="muted" style={{ marginBottom: 14 }}>
          {`${unit}, ${of}`}
        </Mono>
      </View>
      <View style={styles.track}>
        <View
          style={[styles.fill, { width: `${Math.round(progress.fraction * 100)}%`, backgroundColor: progress.met ? color.good : color.vial }]}
        />
      </View>

      {reached ? (
        <View style={styles.won}>
          <Label tone="good">Goal reached</Label>
          <Body size={15}>
            {p.goalMetAt ? `You got there on ${dayMonth(p.goalMetAt)}.` : 'You got there.'} Set the next one when you are ready.
          </Body>
          <Button label="Set a new goal" onPress={onEdit} style={{ marginTop: space.xs }} />
        </View>
      ) : p.aim === 'stay-active' && progress.met ? (
        <Body tone="good">This week is done. Anything more is a bonus.</Body>
      ) : lose && startPlan && plan ? (
        <Body tone="muted">
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
        <Mono size={12} tone="muted">
          {label}
        </Mono>
        <Mono size={12} tone={k >= 1 ? 'good' : 'chalk'}>
          {k >= 1 ? `${text} ✓` : text}
        </Mono>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${Math.round(k * 100)}%`, backgroundColor: k >= 1 ? color.good : color.vial }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  goal: { gap: space.sm, marginTop: space.xs },
  track: { height: 6, borderRadius: 3, backgroundColor: color.lineSoft, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  page: { paddingHorizontal: space.xl, gap: space.xxl, width: '100%', maxWidth: 560, alignSelf: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  wordmark: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  markLine: { width: 22, height: 4, borderRadius: 2, backgroundColor: color.vial },
  todayHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.md },
  back: { gap: space.xs, padding: space.lg, borderRadius: radius.md, backgroundColor: color.surface, borderWidth: 1, borderColor: color.vial },
  goalHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  score: { flexDirection: 'row', alignItems: 'flex-end', gap: space.md, flexWrap: 'wrap' },
  won: {
    gap: space.sm,
    padding: space.lg,
    borderRadius: radius.md,
    backgroundColor: color.goodSoft,
    borderWidth: 1,
    borderColor: color.good,
  },
  todayRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xl },
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
