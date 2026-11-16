import { Redirect, router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DIFFICULTIES } from '@/engine/difficulty';
import { DIFFICULTY_COPY, PLACEMENT, formatDuration } from '@/session/copy';
import { dailyTotals, listSessions, listSessionsSince, type SessionRow } from '@/storage/history';
import { TARGETS, useSettings } from '@/storage/settings';
import { SetupDiagram } from '@/ui/Diagrams';
import { OrientationPicker } from '@/ui/OrientationPicker';
import { Body, Button, Chip, Display, Label, Mono, Rule, Strong } from '@/ui/primitives';
import { color, radius, space, type } from '@/ui/theme';
import { useTapGuard } from '@/ui/useTapGuard';

const DAY = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export default function Home() {
  const insets = useSafeAreaInsets();
  const guard = useTapGuard();
  const { width } = useWindowDimensions();
  const [settings, update] = useSettings();
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [weekRows, setWeekRows] = useState<SessionRow[]>([]);

  const reload = useCallback(() => {
    setRows(listSessions());
    // The chart needs every set of the last 7 days, not just the latest 60.
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - 6);
    setWeekRows(listSessionsSince(start.getTime()));
  }, []);
  useFocusEffect(reload);
  // Coming back to the app (e.g. the next morning) does not refocus the screen,
  // but "Today" and the week bars must move on to the new day.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') reload();
    });
    return () => sub.remove();
  }, [reload]);

  const week = useMemo(() => dailyTotals(weekRows, 7), [weekRows]);
  const today = week[week.length - 1]?.reps ?? 0;
  const weekTotal = week.reduce((s, d) => s + d.reps, 0);
  const peak = Math.max(1, ...week.map((d) => d.reps));
  const contentW = Math.min(width, 560) - space.xl * 2;
  const guided = settings.experience !== 'quick';
  const place = PLACEMENT[settings.orientation];

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

      <View style={styles.hero}>
        <Label>Today</Label>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.md }}>
          <Display size={type.hero * 1.4} style={{ fontFamily: 'BigShouldersDisplay_900Black' }}>
            {today}
          </Display>
          <Body tone="muted" style={{ marginBottom: 14 }}>
            push-ups
          </Body>
        </View>
        <View style={styles.week} accessible accessibilityLabel={`${weekTotal} push-ups in the last 7 days`}>
          {week.map((d, i) => {
            const isToday = i === week.length - 1;
            return (
              <View key={i} style={styles.weekCol}>
                <View style={styles.weekTrack}>
                  <View
                    style={[
                      styles.weekBar,
                      {
                        height: `${Math.max(d.reps > 0 ? 8 : 0, (d.reps / peak) * 100)}%`,
                        backgroundColor: isToday ? color.vial : color.chalk2,
                      },
                    ]}
                  />
                </View>
                <Mono size={11} tone={isToday ? 'vial' : 'faint'}>
                  {DAY[d.day.getDay()]}
                </Mono>
              </View>
            );
          })}
        </View>
        <Mono tone="muted">{`${weekTotal} this week`}</Mono>
      </View>

      {guided ? (
        <View style={styles.card}>
          <Label tone="vial">Before you start</Label>
          <OrientationPicker value={settings.orientation} onChange={(orientation) => update({ orientation })} />
          <SetupDiagram width={contentW - space.xl * 2} orientation={settings.orientation} />
          <View style={{ gap: space.md }}>
            <Step
              n={1}
              title={`Phone on the floor, ${place.label.toLowerCase()}`}
              body={`Prop it upright ${place.distance} away, level with your hips, side-on to where you will be.`}
            />
            {settings.difficulty === 'easy' ? (
              <Step n={2} title="Upper body in view" body="Arms, shoulders and hips on screen. Feet help but are not required." />
            ) : (
              <Step n={2} title="Whole body in view" body="Head to feet inside the screen, in a well-lit spot." />
            )}
            <Step n={3} title="Hold a plank to begin" body="Counting starts by itself. Reps count when you lock out at the top." />
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
            <Chip key={d} label={DIFFICULTY_COPY[d].label} selected={settings.difficulty === d} onPress={() => update({ difficulty: d })} />
          ))}
        </View>
        <View style={{ gap: 2 }}>
          <Strong size={15}>{DIFFICULTY_COPY[settings.difficulty].short}</Strong>
          <Body tone="muted" size={14}>
            {DIFFICULTY_COPY[settings.difficulty].detail}
          </Body>
        </View>
      </View>

      <View style={{ gap: space.md }}>
        <Label>Target</Label>
        <View style={styles.chips}>
          {TARGETS.map((t) => (
            <Chip
              key={t}
              label={t === 0 ? 'Open' : String(t)}
              selected={settings.targetReps === t}
              onPress={() => update({ targetReps: t })}
            />
          ))}
        </View>
        <Button label="Start a set" size="lg" onPress={guard(() => router.push(guided ? '/guide' : '/session'))} />
        {__DEV__ && (
          <Pressable
            accessibilityRole="button"
            onPress={guard(() => router.push({ pathname: '/session', params: { demo: '1' } }))}
            hitSlop={8}
            style={{ alignSelf: 'center' }}
          >
            <Label tone="muted">Preview a demo set</Label>
          </Pressable>
        )}
      </View>

      <View style={{ gap: space.md }}>
        <Label>History</Label>
        {rows.length === 0 ? (
          <Body tone="muted">No sets yet. Each finished set is saved here, with clean and flagged reps.</Body>
        ) : (
          <View style={styles.history}>
            {rows.slice(0, 30).map((r, i) => (
              <View key={r.id}>
                {i > 0 && <Rule />}
                <Pressable
                  accessibilityRole="button"
                  onPress={guard(() => router.push({ pathname: '/summary/[id]', params: { id: r.id } }))}
                  style={({ pressed }) => [styles.row, pressed && { backgroundColor: color.surface }]}
                >
                  <Display size={40} style={{ minWidth: 64 }}>
                    {r.totalReps}
                  </Display>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Strong size={15}>{formatWhen(r.startedAt)}</Strong>
                    <Mono size={12} tone="muted">{`${r.cleanReps} clean · ${formatDuration(r.activeMs)}`}</Mono>
                  </View>
                  <CleanBar clean={r.cleanReps} total={r.totalReps} />
                </Pressable>
              </View>
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: space.md }}>
      <Display size={28} tone="vial" style={{ width: 22 }}>
        {n}
      </Display>
      <View style={{ flex: 1, gap: 2 }}>
        <Strong>{title}</Strong>
        <Body tone="muted" size={14}>
          {body}
        </Body>
      </View>
    </View>
  );
}

function CleanBar({ clean, total }: { clean: number; total: number }) {
  const k = total > 0 ? clean / total : 0;
  return (
    <View style={styles.cleanBar} accessible accessibilityLabel={`${Math.round(k * 100)} percent clean`}>
      <View style={{ width: `${k * 100}%`, height: '100%', backgroundColor: color.good }} />
    </View>
  );
}

function formatWhen(ts: number): string {
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
  page: { paddingHorizontal: space.xl, gap: space.xxl, width: '100%', maxWidth: 560, alignSelf: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  wordmark: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  markLine: { width: 22, height: 4, borderRadius: 2, backgroundColor: color.vial },
  hero: { gap: space.sm },
  week: { flexDirection: 'row', gap: space.sm, height: 70, marginTop: space.sm },
  weekCol: { flex: 1, alignItems: 'center', gap: 4 },
  weekTrack: { flex: 1, width: '100%', justifyContent: 'flex-end', borderRadius: 3, backgroundColor: color.surface, overflow: 'hidden' },
  weekBar: { width: '100%', borderRadius: 3 },
  card: {
    gap: space.lg,
    padding: space.xl,
    borderRadius: radius.lg,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.lineSoft,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  history: { borderRadius: radius.lg, borderWidth: 1, borderColor: color.lineSoft, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.lg, paddingHorizontal: space.lg, paddingVertical: space.md },
  cleanBar: { width: 56, height: 6, borderRadius: 3, backgroundColor: color.raised, overflow: 'hidden' },
});
