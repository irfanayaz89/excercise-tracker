import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { AppState, Platform, Pressable, StyleSheet, View } from 'react-native';
import { ScreenTime, type UsageSummary } from '../../../modules/screen-time/src';
import { countLabel } from '@/screentime/edit';
import { KEY_LOCK_HOURS } from '@/screentime/focus';
import { MAX_APP_LIMITS, PAUSE_CHOICES, PAUSE_PASS_MIN } from '@/screentime/rules';
import { newKey, startKeyLockNow, type ScreenTimeState } from '@/screentime/store';
import { formatClock, formatMin } from '@/screentime/summary';
import { deviceZone } from '@/screentime/time';
import type { RulesCore } from '@/screentime/types';
import { Body, Button, Chip, Label, Mono, Strong } from '@/ui/primitives';
import { LinkRow, Section, ToggleRow } from '@/ui/rows';
import { color, radius, space } from '@/ui/theme';

type Change = (p: Partial<RulesCore>) => void;
type Guard = (fn: () => void) => () => void;

/** Per-app limits: "Instagram 20 min", "YouTube 5 opens". */
export function AppLimitsSection({ st, guard }: { st: ScreenTimeState; guard: Guard }) {
  const { rules, today } = st;
  return (
    <Section title="App limits">
      <View style={styles.pad}>
        <Body tone="muted" size={13}>
          {Platform.OS === 'ios'
            ? 'A daily limit for one app or a group, on top of the daily limit above. Earned time doesn’t open them.'
            : 'A daily limit for one app or a group: minutes, number of opens, or both. Earned time doesn’t open them.'}
        </Body>
      </View>
      {rules.appLimits.map((l) => {
        const used = today.appUsed?.[l.id] ?? 0;
        const opens = today.appOpens?.[l.id] ?? 0;
        const parts = [
          l.dailyMin !== null ? `${formatMin(Math.min(used, l.dailyMin))} / ${formatMin(l.dailyMin)}` : null,
          l.opensPerDay !== null && Platform.OS === 'android' ? `${Math.min(opens, l.opensPerDay)} / ${l.opensPerDay} opens` : null,
        ].filter(Boolean);
        const done = st.decision.limitBlocks.some((b) => b.id === l.id);
        return (
          <LinkRow
            key={l.id}
            label={l.name}
            hint={`${countLabel(l.apps)} · ${parts.join(' · ')}${l.enabled ? '' : ' · off'}`}
            value={done ? 'Done today' : undefined}
            onPress={guard(() => router.push({ pathname: '/screen-time/limit/[id]', params: { id: l.id } }))}
          />
        );
      })}
      {rules.appLimits.length < MAX_APP_LIMITS && (
        <LinkRow label="Add an app limit" onPress={guard(() => router.push({ pathname: '/screen-time/limit/[id]', params: { id: 'new' } }))} />
      )}
    </Section>
  );
}

/** A short wait before a blocked app opens outside lock times and limits. */
export function PauseSection({ st, change }: { st: ScreenTimeState; change: Change }) {
  const p = st.rules.pause;
  return (
    <Section title="Pause before opening">
      <ToggleRow
        label="Take a breath first"
        hint={
          Platform.OS === 'ios'
            ? `When nothing blocks your apps, opening one shows a pause screen. Wait, then tap Open: it stays open ${PAUSE_PASS_MIN} min. Each pass today makes the next wait 5 s longer.`
            : `When nothing blocks your apps, opening one shows a countdown first. Then it stays open ${PAUSE_PASS_MIN} min. Each pass today makes the next wait 5 s longer.`
        }
        value={p.enabled}
        onChange={(v) => change({ pause: { ...p, enabled: v } })}
      />
      {p.enabled && (
        <View style={styles.pad}>
          <Body size={13}>First wait of the day</Body>
          <View style={styles.chips}>
            {PAUSE_CHOICES.map((s) => (
              <Chip key={s} label={`${s} s`} selected={p.seconds === s} onPress={() => change({ pause: { ...p, seconds: s } })} />
            ))}
          </View>
          {(st.today.pauses ?? 0) > 0 && (
            <Mono size={12} tone="muted">
              {`${st.today.pauses} pass${st.today.pauses === 1 ? '' : 'es'} today`}
            </Mono>
          )}
        </View>
      )}
    </Section>
  );
}

/** Android: hide notifications from apps while they're blocked. */
export function NotificationsSection({ st, change }: { st: ScreenTimeState; change: Change }) {
  const [access, setAccess] = useState(() => ScreenTime?.notificationAccess?.() ?? false);
  useFocusEffect(
    useCallback(() => {
      const check = () => setAccess(ScreenTime?.notificationAccess?.() ?? false);
      check();
      const sub = AppState.addEventListener('change', (s) => s === 'active' && check());
      return () => sub.remove();
    }, []),
  );
  if (Platform.OS !== 'android' || !ScreenTime?.notificationAccess) return null;
  const on = st.rules.silenceNotifications;
  return (
    <Section title="Notifications">
      <ToggleRow
        label="Hide their notifications"
        hint="While an app is blocked, its notifications are hidden. Nothing is read or kept."
        value={on}
        onChange={(v) => {
          change({ silenceNotifications: v });
          if (v && !access) ScreenTime?.openSettings?.('notifications');
        }}
      />
      {on && !access && (
        <Pressable accessibilityRole="button" onPress={() => ScreenTime?.openSettings?.('notifications')} style={styles.warn}>
          <Body tone="cue" size={13}>
            Needs Notification access: tap, then turn it on for Trueline.
          </Body>
        </Pressable>
      )}
    </Section>
  );
}

/** The QR key: a lock that only scanning the key (or its safety end) lifts. */
export function KeyLockSection({ st, guard, onMessage }: { st: ScreenTimeState; guard: Guard; onMessage: (m: string) => void }) {
  const [hours, setHours] = useState<number>(2);
  const [all, setAll] = useState(false);
  const key = st.meta.key;
  const running = st.focus?.kind === 'key' && st.focus.until > st.now;
  return (
    <Section title="Key lock">
      <View style={styles.pad}>
        <Body tone="muted" size={13}>
          Print your key or save it on another device, and leave it somewhere out of reach. A key lock blocks your apps until you scan it
          (or the time you set runs out). Backing out or pressing End won’t lift it.
        </Body>
        {!key && <Button label="Make my key" variant="quiet" onPress={guard(() => {
              if (newKey()) router.push('/screen-time/key');
            })} />}
        {key && running && (
          <>
            <Strong>{`Key lock until you scan your key (at most ${formatClock(deviceZone, st.focus!.until, st.now)})`}</Strong>
            <Button label="Scan my key" onPress={guard(() => router.push('/screen-time/scan'))} />
          </>
        )}
        {key && !running && (
          <>
            <Body size={13}>Lock for at most</Body>
            <View style={styles.chips}>
              {KEY_LOCK_HOURS.map((h) => (
                <Chip key={h} label={`${h} h`} selected={hours === h} onPress={() => setHours(h)} />
              ))}
            </View>
            <View style={styles.chips}>
              <Chip label="My blocked apps" selected={!all} onPress={() => setAll(false)} />
              <Chip label="Everything" selected={all} onPress={() => setAll(true)} />
            </View>
            <Button
              label="Lock now"
              onPress={guard(() => {
                if (!startKeyLockNow(hours, all)) onMessage('Screen time isn’t set up yet.');
              })}
            />
          </>
        )}
      </View>
      {key && <LinkRow label="My key" hint="Show, save or print it, or make a new one." onPress={guard(() => router.push('/screen-time/key'))} />}
    </Section>
  );
}

/** Phone use: Android's exact numbers, or (iPhone) the blocked apps' minutes the app has seen. */
export function UsageSection({ st }: { st: ScreenTimeState }) {
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  useFocusEffect(
    useCallback(() => {
      let live = true;
      ScreenTime?.usageSummary?.().then((s) => live && setSummary(s), () => {});
      return () => {
        live = false;
      };
    }, []),
  );
  const days =
    summary?.days ??
    st.days
      .slice(0, 7)
      .reverse()
      .map((d) => ({ day: d.day, minutes: Math.round(d.usedMin) }));
  const most = Math.max(30, ...days.map((d) => d.minutes));
  const total = days.reduce((n, d) => n + d.minutes, 0);
  return (
    <Section title="Your use">
      <View style={styles.pad}>
        <Body tone="muted" size={13}>
          {summary
            ? 'Time on your phone each day (all apps), from Android’s own records. It stays on your phone.'
            : 'Time in your blocked apps each day. iPhone reports it in 15-minute steps.'}
        </Body>
        <View style={styles.bars} accessibilityLabel={`Last ${days.length} days: ${formatMin(total)} in all`}>
          {days.map((d) => (
            <View key={d.day} style={styles.barCol}>
              <View style={styles.barTrack}>
                <View style={[styles.bar, { height: `${Math.max(2, (d.minutes / most) * 100)}%` }]} />
              </View>
              <Label>{['S', 'M', 'T', 'W', 'T', 'F', 'S'][new Date(`${d.day}T12:00:00`).getDay()]}</Label>
            </View>
          ))}
        </View>
        <Mono size={12} tone="muted">
          {`Today ${formatMin(days[days.length - 1]?.minutes ?? 0)} · 7-day average ${formatMin(Math.round(total / Math.max(1, days.length)))}`}
        </Mono>
        {summary && summary.top.length > 0 && (
          <View style={{ gap: space.xs }}>
            <Strong size={14}>Most used today</Strong>
            {summary.top.map((a) => (
              <View key={a.packageName} style={styles.topRow}>
                <Body size={13} style={{ flex: 1 }} numberOfLines={1}>
                  {a.label}
                </Body>
                <Mono size={12}>{formatMin(a.minutes)}</Mono>
              </View>
            ))}
          </View>
        )}
      </View>
    </Section>
  );
}

/** iPhone, Strict: a friend holding the Screen Time passcode makes switching protection off much harder. */
export function FriendPasscodeNote() {
  if (Platform.OS !== 'ios') return null;
  return (
    <View style={styles.note}>
      <Strong size={14}>Make it harder to switch off</Strong>
      <Body tone="muted" size={13}>
        Ask a friend to set a Screen Time passcode on your iPhone (Settings › Screen Time › Lock Screen Time Settings) and to use their
        own Apple Account for passcode recovery, or you could reset it yourself. Also, under Screen Time › Content &amp; Privacy
        Restrictions, set Deleting Apps to Don’t Allow. From iOS 26.4, switching off Trueline’s access then
        needs their code.
      </Body>
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { padding: space.lg, gap: space.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  warn: { marginHorizontal: space.lg, marginBottom: space.md, padding: space.md, borderRadius: radius.md, backgroundColor: color.cueSoft },
  note: { gap: space.xs, padding: space.md, borderRadius: radius.md, backgroundColor: color.raised },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm, height: 96 },
  barCol: { flex: 1, alignItems: 'center', gap: space.xs, height: '100%' },
  barTrack: { flex: 1, width: '100%', justifyContent: 'flex-end' },
  bar: { width: '100%', borderRadius: 4, backgroundColor: color.vial },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
});
