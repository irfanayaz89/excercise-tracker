import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EXERCISE_IDS, EXERCISES } from '@/engine/exercises';
import { DayTimeline } from '@/features/screentime/DayTimeline';
import {
  AppLimitsSection,
  FriendPasscodeNote,
  KeyLockSection,
  NotificationsSection,
  PauseSection,
  UsageSection,
} from '@/features/screentime/ScreenTimeExtras';
import { changeRules, countLabel, describeChange, pickApps, selectionProblem } from '@/screentime/edit';
import {
  cancelPending,
  coreOf,
  describeLock,
  effectiveStrictness,
  EMPTY_SELECTION,
  endStrictEarly,
  MAX_LOCK_TIMES,
  skipNext,
  startStrict,
  STRICT_OFF_PUSHUPS,
  STRICT_WAIT_MS,
  strictActive,
} from '@/screentime/rules';
import {
  clearTokensExpired,
  endFocusNow,
  getScreenTime,
  saveRules,
  turnOff,
  unlockNow,
  useScreenTimeTick,
  type ScreenTimeState,
} from '@/screentime/store';
import { formatClock, formatMin, summarizeDays } from '@/screentime/summary';
import { deviceZone } from '@/screentime/time';
import type { ChangeResult } from '@/screentime/rules';
import type { RulesCore, Strictness } from '@/screentime/types';
import { listSessionsSince } from '@/storage/history';
import { Body, Button, Chip, Display, Label, Mono, Rule, Strong } from '@/ui/primitives';
import { LinkRow, Section } from '@/ui/rows';
import { color, radius, space } from '@/ui/theme';
import { useTapGuard } from '@/ui/useTapGuard';

const LIMITS: [number | null, string][] = [
  [null, 'None'],
  [30, '30 min'],
  [60, '1 h'],
  [90, '1.5 h'],
  [120, '2 h'],
  [180, '3 h'],
];
const CAPS = [30, 60, 120, 180, 240];

const STRICTNESS: Record<Strictness, { label: string; hint: string }> = {
  nudge: { label: 'Nudge', hint: 'Changes apply at once and the blocked screen offers "1 more minute" three times a day.' },
  standard: {
    label: 'Standard',
    hint: 'Making things easier waits until midnight. One 10-minute emergency unlock a day.',
  },
  strict: {
    label: 'Strict',
    hint: "For a set number of days: apps can't be taken off the list, a running lock time can't be shortened, and other easing waits 24 hours. No unlocks.",
  },
};

/** Screen time: today, the app lists, the daily limit, lock times, earning, strictness and history (plan §6). */
export default function ScreenTimeScreen() {
  const insets = useSafeAreaInsets();
  const guard = useTapGuard();
  const st = useScreenTimeTick();
  const [message, setMessage] = useState<string | null>(null);
  const { rules, decision: d, today, now } = st;
  const mode = effectiveStrictness(rules, now);

  const apply = useCallback((res: ChangeResult) => setMessage(describeChange(res)), []);
  const change = useCallback((patch: Partial<RulesCore>) => apply(changeRules({ ...coreOf(getScreenTime().rules), ...patch })), [apply]);

  // Clear the note when leaving, not when coming back: on Android the app picker is its own screen,
  // and the answer to a pick ("Strict mode: apps can't be taken off…") arrives as this one returns.
  useFocusEffect(useCallback(() => () => setMessage(null), []));

  if (!st.meta.setUp) {
    return (
      <Page insets={insets}>
        <Header />
        <Body tone="muted">Screen time isn&apos;t set up yet.</Body>
        <Button label="Set up" onPress={guard(() => router.replace('/screen-time/setup'))} />
      </Page>
    );
  }

  const limit = rules.dailyLimitMin;
  const pendingAt = rules.pending?.effectiveAt ?? null;
  const lost = st.meta.permissionLost || st.availability === 'needs-permission';

  return (
    <Page insets={insets}>
      <Header />

      {lost && (
        <Pressable accessibilityRole="button" onPress={guard(() => router.push('/screen-time/setup'))} style={styles.alert}>
          <Strong tone="fault">Screen Time access is off</Strong>
          <Body tone="fault" size={14}>
            Your apps aren&apos;t blocked. Tap to give Trueline access again.
          </Body>
        </Pressable>
      )}
      {st.meta.tokensExpired && (
        <View style={styles.alert}>
          <Strong tone="cue">Pick your apps again</Strong>
          <Body size={14}>iPhone reset the app lists Trueline uses. Until you pick them again, they may not be blocked.</Body>
          <Button
            size="sm"
            label="Pick blocked apps"
            onPress={guard(async () => {
              const picked = await pickApps('Blocked apps', getScreenTime().rules.blocked);
              if (picked) {
                change({ blocked: picked });
                clearTokensExpired();
              }
            })}
          />
        </View>
      )}
      {st.problems.length > 0 && (
        <View style={styles.alert}>
          <Strong tone="cue">Some schedules couldn&apos;t start</Strong>
          <Mono size={11} tone="muted">
            {st.problems.slice(0, 3).join('\n')}
          </Mono>
        </View>
      )}
      {message && (
        <View style={styles.note} accessibilityLiveRegion="polite">
          <Body size={14}>{message}</Body>
        </View>
      )}

      <View style={{ gap: space.md }}>
        <Label>Today</Label>
        <Display size={34}>
          {d.blocked
            ? d.reason === 'focus' && d.focus
              ? `Workout focus until ${formatClock(deviceZone, d.focus.until, now)}`
              : d.reason === 'lock' && d.lock
                ? `${d.lock.name} until ${formatClock(deviceZone, d.lock.until, now)}`
                : 'Time is up for today'
            : d.usingEarned
              ? `Earned time: ${formatMin(d.earnedLeftMin)} left`
              : d.unlockedUntil
                ? `Unlocked until ${formatClock(deviceZone, d.unlockedUntil, now)}`
                : limit !== null && d.limitLeftMin !== null
                  ? `${formatMin(d.limitLeftMin)} left`
                  : 'Apps are open'}
        </Display>
        {d.focus && (
          <View style={styles.note}>
            <Body size={14}>
              {d.focus.strict
                ? 'Strict: the workout focus runs until its end.'
                : d.focus.kind === 'timed'
                  ? 'A timed workout focus keeps your apps closed until it ends.'
                  : 'The workout focus ends when the set ends.'}
            </Body>
            {!d.focus.strict && (
              <Button
                size="sm"
                variant="ghost"
                label="End focus now"
                onPress={() => {
                  const res = endFocusNow('manual');
                  if (!res.ended) setMessage('This focus can\'t be ended early.');
                }}
              />
            )}
          </View>
        )}
        <DayTimeline rules={rules} now={now} />
        <View style={styles.stats}>
          <Stat label="Used" value={limit === null ? formatMin(today.usedMin) : `${formatMin(Math.min(today.usedMin, limit))} / ${formatMin(limit)}`} />
          <Stat label="Earned today" value={`${formatMin(today.earnedMin)} / ${formatMin(rules.earning.dailyCapMin)}`} />
          <Stat label="Earned left" value={formatMin(d.earnedLeftMin)} />
        </View>
        {rules.earning.enabled && (
          <Button label="Earn time" onPress={guard(() => router.push('/earn'))} disabled={today.earnedMin >= rules.earning.dailyCapMin} />
        )}
        {(d.blocked || d.ownLocks.length > 0) && (d.emergency.available || d.oneMore.available) && (
          <Button
            variant="ghost"
            label={d.emergency.available ? `Emergency unlock: ${d.emergency.minutes} min` : `1 more minute (${d.oneMore.left} left today)`}
            onPress={() => {
              const res = unlockNow(d.emergency.available ? 'emergency' : 'one-more');
              if (!res.ok) setMessage('No unlocks left today.');
            }}
          />
        )}
        <Body tone="faint" size={12}>
          {Platform.OS === 'ios'
            ? 'iPhone reports usage in 15-minute steps, so "used" can lag a little behind.'
            : 'Usage is counted while the apps are on screen.'}
        </Body>
      </View>

      {pendingAt !== null && (
        <View style={styles.note}>
          <Body size={14}>
            {`A change you made starts ${formatClock(deviceZone, pendingAt, now)}.`}
          </Body>
          <Pressable accessibilityRole="button" onPress={() => saveRules(cancelPending(getScreenTime().rules))} hitSlop={8}>
            <Label tone="vial">Cancel the change</Label>
          </Pressable>
        </View>
      )}

      <Section title="Apps">
        <LinkRow
          label="Blocked apps"
          hint="Blocked during lock times and once the daily limit is used up."
          value={countLabel(rules.blocked)}
          onPress={guard(async () => {
            const picked = await pickApps('Blocked apps', getScreenTime().rules.blocked);
            if (!picked) return;
            const bad = selectionProblem(picked);
            if (bad) setMessage(bad);
            else {
              change({ blocked: picked });
              clearTokensExpired();
            }
          })}
        />
        <LinkRow
          label="Always allowed"
          hint="Never blocked, even inside a blocked category (Phone, Maps, Messages…)."
          value={countLabel(rules.allowed)}
          onPress={guard(async () => {
            const picked = await pickApps('Always allowed', getScreenTime().rules.allowed);
            if (!picked) return;
            const bad = selectionProblem(picked);
            if (bad) setMessage(bad);
            else change({ allowed: picked });
          })}
        />
      </Section>

      <Section title="Daily limit">
        <View style={styles.pad}>
          <Body tone="muted" size={13}>
            Total time a day in your blocked apps outside lock times. After it, they open only with earned time.
          </Body>
          <View style={styles.chips}>
            {LIMITS.map(([v, l]) => (
              <Chip key={l} label={l} selected={limit === v} onPress={() => change({ dailyLimitMin: v })} />
            ))}
          </View>
        </View>
      </Section>

      <Section title="Lock times">
        {rules.lockTimes.length === 0 && (
          <View style={styles.pad}>
            <Body tone="muted" size={13}>
              Times when your blocked apps can&apos;t be opened, like nights or work hours.
            </Body>
          </View>
        )}
        {rules.lockTimes.map((l) => (
          <View key={l.id} style={styles.lockRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Edit ${l.name}`}
              style={{ flex: 1, gap: 2 }}
              onPress={guard(() => router.push({ pathname: '/screen-time/lock/[id]', params: { id: l.id } }))}
            >
              <Strong>{l.name}</Strong>
              <Body tone="muted" size={13}>
                {describeLock(l)}
                {l.earnable ? ' · earned time works' : ''}
                {l.apps === 'all' ? ' · everything except always allowed' : l.apps !== 'main' ? ` · ${countLabel(l.apps)}` : ''}
              </Body>
              {l.skipDate && (
                <Mono size={11} tone="cue">
                  Skipping {l.skipDate}
                </Mono>
              )}
            </Pressable>
            {l.enabled && !l.skipDate && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Skip the next ${l.name}`}
                hitSlop={8}
                onPress={() => apply(skipNext(deviceZone, getScreenTime().rules, l.id, Date.now()))}
              >
                <Label>Skip next</Label>
              </Pressable>
            )}
            <Switch
              value={l.enabled}
              onValueChange={(v) =>
                change({ lockTimes: getScreenTime().rules.lockTimes.map((x) => (x.id === l.id ? { ...x, enabled: v } : x)) })
              }
              trackColor={{ false: color.raised, true: color.vial }}
              thumbColor={l.enabled ? color.vialInk : color.chalk2}
              accessibilityLabel={`${l.name} on`}
            />
          </View>
        ))}
        <LinkRow
          label="Add lock time"
          disabled={rules.lockTimes.length >= MAX_LOCK_TIMES}
          hint={rules.lockTimes.length >= MAX_LOCK_TIMES ? `Up to ${MAX_LOCK_TIMES} lock times.` : undefined}
          onPress={guard(() => router.push({ pathname: '/screen-time/lock/[id]', params: { id: 'new' } }))}
        />
      </Section>

      <AppLimitsSection st={st} guard={guard} />

      <PauseSection st={st} change={change} />

      <KeyLockSection st={st} guard={guard} onMessage={setMessage} />

      <NotificationsSection st={st} change={change} />

      <EarningSection st={st} change={change} />

      <StrictnessSection st={st} now={now} mode={mode} apply={apply} change={change} />

      <UsageSection st={st} />

      <HistorySection st={st} />

      <Section title="Turn off">
        <View style={styles.pad}>
          <Body tone="muted" size={13}>
            {mode === 'strict'
              ? 'Strict mode is on: screen time can be turned off once its period ends.'
              : mode === 'standard'
                ? 'Takes effect at midnight, like any change that makes things easier.'
                : 'Stops blocking straight away.'}
          </Body>
          <Button
            variant="danger"
            size="sm"
            label="Turn off screen time"
            disabled={mode === 'strict'}
            onPress={() => {
              const res = changeRules({ ...coreOf(getScreenTime().rules), blocked: EMPTY_SELECTION, lockTimes: [], dailyLimitMin: null });
              if (res.result === 'applied') {
                turnOff();
                // Opened from a link there may be nothing to go back to.
                if (router.canGoBack()) router.back();
                else router.replace('/');
              } else apply(res);
            }}
          />
        </View>
      </Section>
    </Page>
  );
}

function EarningSection({ st, change }: { st: ScreenTimeState; change: (p: Partial<RulesCore>) => void }) {
  const e = st.rules.earning;
  return (
    <Section title="Earning">
      <View style={[styles.lockRow, { borderBottomWidth: StyleSheet.hairlineWidth }]}>
        <View style={{ flex: 1, gap: 2 }}>
          <Strong>Earn time with exercise</Strong>
          <Body tone="muted" size={13}>
            Finished sets add minutes for today. Earned time ends at midnight.
          </Body>
        </View>
        <Switch
          value={e.enabled}
          onValueChange={(v) => change({ earning: { ...e, enabled: v } })}
          trackColor={{ false: color.raised, true: color.vial }}
          thumbColor={e.enabled ? color.vialInk : color.chalk2}
          accessibilityLabel="Earn time with exercise"
        />
      </View>
      {e.enabled && (
        <View style={styles.pad}>
          {EXERCISE_IDS.map((x) => {
            const r = e.rates[x];
            return (
              <View key={x} style={styles.rateRow}>
                <Body size={14}>{EXERCISES[x].label}</Body>
                <Mono size={12} tone="muted">
                  {r.per10s !== undefined ? `${r.per10s} min per 10 s in good form` : `${r.perCleanRep} min per clean rep · ${r.perFlaggedRep} flagged`}
                </Mono>
              </View>
            );
          })}
          <Rule style={{ marginVertical: space.sm }} />
          <Strong size={14}>Most you can earn a day</Strong>
          <View style={styles.chips}>
            {CAPS.map((c) => (
              <Chip key={c} label={formatMin(c)} selected={e.dailyCapMin === c} onPress={() => change({ earning: { ...e, dailyCapMin: c } })} />
            ))}
          </View>
        </View>
      )}
    </Section>
  );
}

function StrictnessSection({
  st,
  now,
  mode,
  apply,
  change,
}: {
  st: ScreenTimeState;
  now: number;
  mode: Strictness;
  apply: (r: ChangeResult) => void;
  change: (p: Partial<RulesCore>) => void;
}) {
  const r = st.rules;
  const [strictDays, setStrictDays] = useState(7);
  const strictOn = strictActive(r, now);
  // Ending Strict early: 100 verified push-ups since the request (or wait 24 hours).
  const askedAt = r.pending?.next.strictness === 'standard' && strictOn ? r.pending.effectiveAt - STRICT_WAIT_MS : null;
  const pushups = useMemo(
    () => (askedAt === null ? 0 : listSessionsSince(askedAt).reduce((n, s) => n + (s.exercise === 'pushup' ? s.cleanReps : 0), 0)),
    [askedAt],
  );
  // Strict can't be undone with a tap, so starting it is always a deliberate choice.
  const confirmStrict = () => {
    if (strictOn) return;
    const days = `${strictDays} day${strictDays === 1 ? '' : 's'}`;
    Alert.alert(
      `Turn on Strict for ${days}?`,
      `Until then you can't take apps off the list, shorten a running lock time, use unlocks or turn screen time off. Ending it early takes ${STRICT_OFF_PUSHUPS} verified push-ups or a 24-hour wait.` +
        (Platform.OS === 'ios'
          ? '\n\nTo make it harder to switch off in Settings, ask a friend to set a Screen Time passcode on this iPhone.'
          : ''),
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Turn on Strict', onPress: () => saveRules(startStrict(getScreenTime().rules, Date.now(), strictDays)) },
      ],
    );
  };
  return (
    <Section title="Strictness">
      <View style={styles.pad}>
        <View style={styles.chips}>
          {(['nudge', 'standard', 'strict'] as const).map((s) => (
            <Chip
              key={s}
              label={STRICTNESS[s].label}
              selected={mode === s}
              onPress={() => (s === 'strict' ? confirmStrict() : change({ strictness: s }))}
            />
          ))}
        </View>
        <Body tone="muted" size={13}>
          {STRICTNESS[mode].hint}
        </Body>
        {!strictOn && (
          <View style={{ gap: space.xs }}>
            <Body size={13}>Strict lasts</Body>
            <View style={styles.chips}>
              {[1, 3, 7, 14, 30].map((n) => (
                <Chip key={n} label={n === 1 ? '1 day' : `${n} days`} selected={strictDays === n} onPress={() => setStrictDays(n)} />
              ))}
            </View>
          </View>
        )}
        {strictOn && (
          <View style={{ gap: space.sm }}>
            <Strong size={14}>{`Strict until ${formatClock(deviceZone, r.strictUntil!, now)}`}</Strong>
            <FriendPasscodeNote />
            {askedAt === null ? (
              <Button
                size="sm"
                variant="ghost"
                label="End Strict early"
                onPress={() => apply(endStrictEarly(getScreenTime().rules, Date.now(), 0))}
              />
            ) : (
              <>
                <Body tone="muted" size={13}>
                  {`Strict ends 24 hours after you asked, or now if you do ${STRICT_OFF_PUSHUPS} verified push-ups first: ${Math.min(pushups, STRICT_OFF_PUSHUPS)} / ${STRICT_OFF_PUSHUPS}.`}
                </Body>
                {pushups >= STRICT_OFF_PUSHUPS && (
                  <Button size="sm" label="End Strict now" onPress={() => apply(endStrictEarly(getScreenTime().rules, Date.now(), pushups))} />
                )}
              </>
            )}
          </View>
        )}
      </View>
    </Section>
  );
}

function HistorySection({ st }: { st: ScreenTimeState }) {
  const days = summarizeDays(st.rules, st.days);
  return (
    <Section title="Last two weeks">
      {days.map((d, i) => (
        <View key={d.day}>
          {i > 0 && <Rule />}
          <View style={styles.histRow}>
            <Mono size={12} style={{ width: 92 }}>
              {d.day}
            </Mono>
            {/* A busy day has up to five items: let them wrap onto a second line instead of squeezing each other. */}
            <View style={styles.histItems}>
              <Mono size={12} tone={d.overLimit ? 'cue' : 'chalk'}>
                {`${formatMin(d.usedMin)} used`}
              </Mono>
              <Mono size={12} tone="good">
                {` · +${formatMin(d.earnedMin)}`}
              </Mono>
              {d.unlocks > 0 && (
                <Mono size={12} tone="muted">
                  {` · ${d.unlocks} unlock${d.unlocks > 1 ? 's' : ''}`}
                </Mono>
              )}
              {d.focusMin > 0 && (
                <Mono size={12} tone="vial">
                  {` · focus ${formatMin(d.focusMin)}`}
                </Mono>
              )}
              {d.offMin > 0 && (
                <Mono size={12} tone="fault">
                  {` · off ${formatMin(d.offMin)}`}
                </Mono>
              )}
            </View>
          </View>
        </View>
      ))}
    </Section>
  );
}

function Header() {
  return (
    <View style={styles.header}>
      <Display size={36}>Screen time</Display>
      <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={12}>
        <Label tone="chalk">Done</Label>
      </Pressable>
    </View>
  );
}

function Page({ insets, children }: { insets: { top: number; bottom: number }; children: React.ReactNode }) {
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: color.ground }}
      contentContainerStyle={[styles.page, { paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.huge }]}
    >
      {children}
    </ScrollView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <Mono size={11} tone="muted">
        {label}
      </Mono>
      <Strong size={15}>{value}</Strong>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: space.xl, gap: space.xxl, width: '100%', maxWidth: 560, alignSelf: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  stats: { flexDirection: 'row', gap: space.md },
  pad: { padding: space.lg, gap: space.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  lockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.line,
  },
  rateRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: space.md },
  histRow: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: space.lg, paddingVertical: space.sm },
  histItems: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', rowGap: space.xs },
  alert: { gap: space.xs, padding: space.lg, borderRadius: radius.lg, backgroundColor: color.faultSoft, borderWidth: 1, borderColor: color.fault },
  note: { gap: space.sm, padding: space.lg, borderRadius: radius.lg, backgroundColor: color.raised },
});
