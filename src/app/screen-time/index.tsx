import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
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
import { changeRules, countLabel, describeChange, editBase, pickApps, selectionProblem } from '@/screentime/edit';
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
  markTurnOffPending,
  saveRules,
  screenTimeNow,
  turnOff,
  unlockNow,
  useScreenTimeTick,
  type ScreenTimeState,
} from '@/screentime/store';
import { formatClock, formatMin, rateText, summarizeDays } from '@/screentime/summary';
import { deviceZone } from '@/screentime/time';
import type { ChangeResult } from '@/screentime/rules';
import type { RulesCore, Strictness } from '@/screentime/types';
import { listSessionsSince } from '@/storage/history';
import { Body, Button, Chip, Display, Label, LinkText, Mono, Rule, Stat, Strong } from '@/ui/primitives';
import { LinkRow, Section } from '@/ui/rows';
import { color, radius, space, type } from '@/ui/theme';
import { useTapGuard } from '@/ui/useTapGuard';

const LIMITS: [number | null, string][] = [
  [null, 'None'],
  [30, '30 min'],
  [60, '1 h'],
  [90, '1.5 h'],
  [120, '2 h'],
  [180, '3 h'],
];
const CAPS = [30, 60, 90, 120];

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

/**
 * The screen's parts. "main" is today (what's blocked, earned time, Earn) and one row per group;
 * each group opens as its own view of this screen, so the rule-change logic lives in one place.
 */
type Pane = 'main' | 'rules' | 'earning' | 'strictness' | 'history' | 'more';
const PANES: Pane[] = ['main', 'rules', 'earning', 'strictness', 'history', 'more'];
const TITLES: Record<Pane, string> = {
  main: 'Screen time',
  rules: 'Rules',
  earning: 'Earning',
  strictness: 'Strictness',
  history: 'History',
  more: 'More',
};
const open = (pane: Pane) => router.push({ pathname: '/screen-time', params: { show: pane } });

/** Screen time: today and Earn first; rules, earning, strictness, history and more each one tap away (plan §6). */
export default function ScreenTimeScreen() {
  const insets = useSafeAreaInsets();
  const guard = useTapGuard();
  const st = useScreenTimeTick();
  const [message, setMessage] = useState<string | null>(null);
  const { rules, decision: d, today, now } = st;
  const mode = effectiveStrictness(rules, now);
  const { show } = useLocalSearchParams<{ show?: string }>();
  const pane: Pane = PANES.includes(show as Pane) ? (show as Pane) : 'main';

  const apply = useCallback((res: ChangeResult) => {
    const m = describeChange(res);
    // A change that waits or is refused gets an alert (and a waiting one its own "Cancel the change" box),
    // so the note is only for what applied ("…the easier change that was waiting has been cancelled").
    setMessage(res.result === 'applied' ? m : null);
    if (m && res.result !== 'applied') Alert.alert(res.result === 'refused' ? 'Can’t change that now' : 'Starts later', m);
    return res;
  }, []);
  const change = useCallback((patch: Partial<RulesCore>) => apply(changeRules({ ...editBase(), ...patch })), [apply]);

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
  const unsupported = st.meta.setUp && st.availability === 'unsupported';

  return (
    <Page insets={insets}>
      <Header pane={pane} />

      {pane === 'main' && unsupported && (
        <View style={styles.alert}>
          <Strong tone="fault">This version of Trueline can&apos;t block apps</Strong>
          <Body tone="fault" size={type.note}>
            Your rules are saved, but nothing is blocked on this phone until a version with Screen Time is installed.
          </Body>
        </View>
      )}
      {pane === 'main' && lost && (
        <Pressable accessibilityRole="button" onPress={guard(() => router.push('/screen-time/setup'))} style={styles.alert}>
          <Strong tone="fault">Screen Time access is off</Strong>
          <Body tone="fault" size={type.note}>
            Your apps aren&apos;t blocked. Tap to give Trueline access again.
          </Body>
        </Pressable>
      )}
      {(pane === 'main' || pane === 'rules') && st.meta.tokensExpired && (
        <View style={styles.alert}>
          <Strong tone="cue">Pick your apps again</Strong>
          <Body size={type.note}>iPhone reset the app lists Trueline uses. Until you pick them again, they may not be blocked.</Body>
          <Button
            size="sm"
            label="Pick blocked apps"
            onPress={guard(async () => {
              const picked = await pickApps('Blocked apps', getScreenTime().rules.blocked);
              // Only when the new lists are really in use: a refused or waiting change leaves the warning up.
              if (picked && change({ blocked: picked }).result === 'applied') clearTokensExpired();
            })}
          />
        </View>
      )}
      {pane === 'main' && st.problems.length > 0 && (
        <View style={styles.alert}>
          {/* Native problems, a moved clock or a storage failure: one heading that fits them all. */}
          <Strong tone="cue">Check this</Strong>
          <Body size={type.caption} tone="chalk2">
            {st.problems.slice(0, 3).join('\n')}
          </Body>
        </View>
      )}
      {message && (
        <View style={styles.note} accessibilityLiveRegion="polite">
          <Body size={type.note}>{message}</Body>
        </View>
      )}

      {pane === 'main' && (
        <View style={{ gap: space.md }}>
          <Label>Today</Label>
          <Display size={type.displayM}>
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
              <Body size={type.note}>
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
                    if (!res.ended) setMessage("This focus can't be ended early.");
                  }}
                />
              )}
            </View>
          )}
          <DayTimeline rules={rules} now={now} />
          <View style={styles.stats}>
            <Stat
              label="Used"
              value={limit === null ? formatMin(today.usedMin) : `${formatMin(Math.min(today.usedMin, limit))} / ${formatMin(limit)}`}
            />
            <Stat label="Earned today" value={`${formatMin(today.earnedMin)} / ${formatMin(rules.earning.dailyCapMin)}`} />
            <Stat label="Earned left" value={formatMin(d.earnedLeftMin)} />
          </View>
          {rules.earning.enabled && (
            <Button label="Earn time" onPress={guard(() => router.push('/earn'))} disabled={today.earnedMin >= rules.earning.dailyCapMin} />
          )}
          {(d.blocked || d.ownLocks.length > 0 || d.limitBlocks.length > 0) && (d.emergency.available || d.oneMore.available) && (
            <Button
              variant="ghost"
              label={
                d.emergency.available ? `Emergency unlock: ${d.emergency.minutes} min` : `1 more minute (${d.oneMore.left} left today)`
              }
              onPress={() => {
                const take = () => {
                  const res = unlockNow(d.emergency.available ? 'emergency' : 'one-more');
                  if (!res.ok) setMessage('No unlocks left today.');
                };
                // The emergency unlock is the day's only one: ask before using it up.
                if (!d.emergency.available) take();
                else
                  Alert.alert('Use today’s emergency unlock?', `Your apps open for ${d.emergency.minutes} minutes. There’s one a day.`, [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Unlock', onPress: take },
                  ]);
              }}
            />
          )}
          <Body tone="muted" size={type.small}>
            {Platform.OS === 'ios'
              ? 'iPhone reports usage in 15-minute steps, so "used" can lag a little behind.'
              : 'Usage is counted while the apps are on screen.'}
          </Body>
        </View>
      )}

      {pendingAt !== null && (
        <View style={styles.note}>
          <Body size={type.note}>{`A change you made starts ${formatClock(deviceZone, pendingAt, now)}.`}</Body>
          <Pressable accessibilityRole="button" onPress={() => saveRules(cancelPending(getScreenTime().rules))} hitSlop={8}>
            <LinkText>Cancel the change</LinkText>
          </Pressable>
        </View>
      )}

      {pane === 'main' && (
        <Section title="Settings">
          <LinkRow
            label="Rules"
            hint={[
              countLabel(rules.blocked),
              limit === null ? 'no daily limit' : `${formatMin(limit)} a day`,
              rules.lockTimes.length === 1 ? '1 lock time' : `${rules.lockTimes.length} lock times`,
            ].join(' · ')}
            onPress={guard(() => open('rules'))}
          />
          <LinkRow
            label="Earning"
            hint={rules.earning.enabled ? `Up to ${formatMin(rules.earning.dailyCapMin)} a day from exercise` : 'Off'}
            onPress={guard(() => open('earning'))}
          />
          <LinkRow
            label="Strictness"
            hint={
              mode === 'strict' && rules.strictUntil
                ? `Strict until ${formatClock(deviceZone, rules.strictUntil, now)}`
                : `${STRICTNESS[mode].label} · key lock`
            }
            onPress={guard(() => open('strictness'))}
          />
          <LinkRow label="History" hint="Usage and the last two weeks" onPress={guard(() => open('history'))} />
          <LinkRow
            label="More"
            hint={Platform.OS === 'android' ? 'Pause before opening, notifications, turn off' : 'Pause before opening, turn off'}
            onPress={guard(() => open('more'))}
          />
        </Section>
      )}

      {pane === 'rules' && (
        <>
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
                else if (change({ blocked: picked }).result === 'applied') clearTokensExpired();
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
              <Body tone="muted" size={type.caption}>
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
                <Body tone="muted" size={type.caption}>
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
                  <Body tone="muted" size={type.caption}>
                    {describeLock(l)}
                    {l.earnable ? ' · earned time works' : ''}
                    {l.apps === 'all' ? ' · everything except always allowed' : l.apps !== 'main' ? ` · ${countLabel(l.apps)}` : ''}
                  </Body>
                  {l.skipDate && (
                    <Mono size={type.micro} tone="cue">
                      Skipping {l.skipDate}
                    </Mono>
                  )}
                </Pressable>
                {l.enabled && !l.skipDate && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Skip the next ${l.name}`}
                    hitSlop={8}
                    onPress={() => apply(skipNext(deviceZone, getScreenTime().rules, l.id, screenTimeNow(), getScreenTime().focus))}
                  >
                    <LinkText>Skip next</LinkText>
                  </Pressable>
                )}
                <Switch
                  value={l.enabled}
                  onValueChange={(v) => {
                    change({ lockTimes: editBase().lockTimes.map((x) => (x.id === l.id ? { ...x, enabled: v } : x)) });
                  }}
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
        </>
      )}

      {pane === 'earning' && <EarningSection st={st} change={change} />}

      {pane === 'strictness' && (
        <>
          <StrictnessSection st={st} now={now} mode={mode} apply={apply} change={change} />
          <KeyLockSection st={st} guard={guard} onMessage={setMessage} />
        </>
      )}

      {pane === 'history' && (
        <>
          <UsageSection st={st} />
          <HistorySection st={st} />
        </>
      )}

      {pane === 'more' && (
        <>
          <PauseSection st={st} change={change} />

          <NotificationsSection st={st} change={change} />

          <Section title="Turn off">
            <View style={styles.pad}>
              <Body tone="muted" size={type.caption}>
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
                onPress={() =>
                  Alert.alert(
                    'Turn off screen time?',
                    'This removes your blocked apps, lock times and limits. Earned time and history stay. Depending on your strictness it may only start at midnight.',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Turn off', style: 'destructive', onPress: turnOffNow },
                    ],
                  )
                }
              />
            </View>
          </Section>
        </>
      )}
    </Page>
  );

  function turnOffNow() {
    const cur = getScreenTime();
    // A key lock ends only with the key; a Strict focus only at its end.
    if (cur.focus && cur.focus.until > screenTimeNow() && (cur.focus.kind === 'key' || cur.focus.strict)) {
      // Shown as an alert: the page's message box is far above this button.
      Alert.alert(
        'Can’t turn off yet',
        cur.focus.kind === 'key'
          ? 'A key lock is running: scan your key first.'
          : 'A Strict focus is running: it ends at its planned time.',
      );
      return;
    }
    // Everything off counts as making things easier, so it follows the strictness rules.
    const res = changeRules({
      ...coreOf(cur.rules),
      blocked: EMPTY_SELECTION,
      lockTimes: [],
      dailyLimitMin: null,
      appLimits: [],
      pause: { ...cur.rules.pause, enabled: false },
      silenceNotifications: false,
    });
    if (res.result === 'applied') {
      turnOff();
      // Opened from a link there may be nothing to go back to.
      if (router.canGoBack()) router.back();
      else router.replace('/');
    } else {
      if (res.result === 'scheduled') markTurnOffPending();
      Alert.alert('Turn off screen time', describeChange(res));
    }
  }
}

function EarningSection({ st, change }: { st: ScreenTimeState; change: (p: Partial<RulesCore>) => void }) {
  const e = st.rules.earning;
  return (
    // The page is titled "Earning": no second heading saying the same.
    <Section>
      <View style={[styles.lockRow, { borderBottomWidth: StyleSheet.hairlineWidth }]}>
        <View style={{ flex: 1, gap: 2 }}>
          <Strong>Earn time with exercise</Strong>
          <Body tone="muted" size={type.caption}>
            Finished sets add minutes for today. Earned time ends at midnight.
          </Body>
        </View>
        <Switch
          value={e.enabled}
          onValueChange={(v) => {
            change({ earning: { ...editBase().earning, enabled: v } });
          }}
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
                <Body size={type.note}>{EXERCISES[x].label}</Body>
                <Mono size={type.small} tone="muted">
                  {r.per10s !== undefined ? rateText(r) : `${rateText(r)} · ${r.perFlaggedRep} flagged`}
                </Mono>
              </View>
            );
          })}
          <Body size={type.caption} tone="muted">
            {`A set earns ${formatMin(e.milestoneMin)} more at 10 and again at 20 push-up equivalents (10 push-ups 15 min, 20 push-ups 30 min), up to ${e.setCapPe} a set. First set of the day +${formatMin(e.firstSetMin)}, coming back after a break +${formatMin(e.comebackMin)}. After ${formatMin(e.fullRateMin)} earned in a day, sets earn half until the daily most.`}
          </Body>
          <Rule style={{ marginVertical: space.sm }} />
          <Strong size={type.note}>Most you can earn a day</Strong>
          <View style={styles.chips}>
            {CAPS.map((c) => (
              <Chip
                key={c}
                label={formatMin(c)}
                selected={e.dailyCapMin === c}
                onPress={() =>
                  change({ earning: { ...editBase().earning, dailyCapMin: c, fullRateMin: Math.min(editBase().earning.fullRateMin, c) } })
                }
              />
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
    // Recounted as time passes and on return to this screen (sets are done on another one).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [askedAt, now],
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
        { text: 'Turn on Strict', onPress: () => saveRules(startStrict(getScreenTime().rules, screenTimeNow(), strictDays)) },
      ],
    );
  };
  return (
    <Section>
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
        <Body tone="muted" size={type.caption}>
          {STRICTNESS[mode].hint}
        </Body>
        {!strictOn && (
          <View style={{ gap: space.xs }}>
            <Body size={type.caption}>Strict lasts</Body>
            <View style={styles.chips}>
              {[1, 3, 7, 14, 30].map((n) => (
                <Chip key={n} label={n === 1 ? '1 day' : `${n} days`} selected={strictDays === n} onPress={() => setStrictDays(n)} />
              ))}
            </View>
          </View>
        )}
        {strictOn && (
          <View style={{ gap: space.sm }}>
            <Strong size={type.note}>{`Strict until ${formatClock(deviceZone, r.strictUntil!, now)}`}</Strong>
            <FriendPasscodeNote />
            {askedAt === null ? (
              <Button
                size="sm"
                variant="ghost"
                label="End Strict early"
                onPress={() => apply(endStrictEarly(getScreenTime().rules, screenTimeNow(), 0))}
              />
            ) : (
              <>
                <Body tone="muted" size={type.caption}>
                  {`Strict ends 24 hours after you asked, or now if you do ${STRICT_OFF_PUSHUPS} verified push-ups first: ${Math.min(pushups, STRICT_OFF_PUSHUPS)} / ${STRICT_OFF_PUSHUPS}.`}
                </Body>
                {pushups >= STRICT_OFF_PUSHUPS && (
                  <Button
                    size="sm"
                    label="End Strict now"
                    onPress={() => apply(endStrictEarly(getScreenTime().rules, screenTimeNow(), pushups))}
                  />
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
            <Mono size={type.small} style={{ width: 92 }}>
              {d.day}
            </Mono>
            {/* A busy day has up to five items: let them wrap onto a second line instead of squeezing each other. */}
            <View style={styles.histItems}>
              <Mono size={type.small} tone={d.overLimit ? 'cue' : 'chalk'}>
                {`${formatMin(d.usedMin)} used`}
              </Mono>
              <Mono size={type.small} tone="good">
                {` · +${formatMin(d.earnedMin)}`}
              </Mono>
              {d.unlocks > 0 && (
                <Mono size={type.small} tone="muted">
                  {` · ${d.unlocks} unlock${d.unlocks > 1 ? 's' : ''}`}
                </Mono>
              )}
              {d.focusMin > 0 && (
                <Mono size={type.small} tone="vial">
                  {` · focus ${formatMin(d.focusMin)}`}
                </Mono>
              )}
              {d.offMin > 0 && (
                <Mono size={type.small} tone="fault">
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

function Header({ pane = 'main' }: { pane?: Pane }) {
  // Opened from a link there may be nothing to go back to.
  const leave = () => (router.canGoBack() ? router.back() : router.replace(pane === 'main' ? '/' : '/screen-time'));
  return (
    <View style={styles.header}>
      <Display size={type.stat}>{TITLES[pane]}</Display>
      <Pressable accessibilityRole="button" onPress={leave} hitSlop={12}>
        <Label tone="chalk">{pane === 'main' ? 'Done' : '‹ Screen time'}</Label>
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

const styles = StyleSheet.create({
  page: { paddingHorizontal: space.xl, gap: space.xxl, width: '100%', maxWidth: 560, alignSelf: 'center' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    columnGap: space.md,
    rowGap: space.xs,
    alignItems: 'center',
  },
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
  rateRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    rowGap: space.xs,
    alignItems: 'baseline',
    gap: space.md,
  },
  histRow: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: space.lg, paddingVertical: space.sm },
  histItems: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', rowGap: space.xs },
  alert: {
    gap: space.xs,
    padding: space.lg,
    borderRadius: radius.lg,
    backgroundColor: color.faultSoft,
    borderWidth: 1,
    borderColor: color.fault,
  },
  note: { gap: space.sm, padding: space.lg, borderRadius: radius.lg, backgroundColor: color.raised },
});
