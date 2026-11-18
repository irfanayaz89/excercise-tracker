import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { AppState, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenTime } from '../../../modules/screen-time/src';
import { countLabel, pickApps } from '@/screentime/edit';
import { DEFAULT_STRICT_DAYS, describeLock, LOCK_PRESETS, startStrict } from '@/screentime/rules';
import { availability, getScreenTime, markSetUp, saveRules, syncScreenTime } from '@/screentime/store';
import { formatMin } from '@/screentime/summary';
import type { LockTime, ScreenTimeRules, Strictness } from '@/screentime/types';
import { Body, Button, Chip, Display, Label, Mono, Strong } from '@/ui/primitives';
import { color, radius, space } from '@/ui/theme';
import { useTapGuard } from '@/ui/useTapGuard';

type Step = 'why' | 'access' | 'blocked' | 'allowed' | 'limit' | 'locks' | 'strictness' | 'done';
const STEPS: Step[] = ['why', 'access', 'blocked', 'allowed', 'limit', 'locks', 'strictness', 'done'];

const LIMITS: [number | null, string][] = [
  [30, '30 min'],
  [60, '1 h'],
  [90, '1.5 h'],
  [120, '2 h'],
  [null, 'No limit'],
];

/**
 * First-time screen time setup (plan §6), about a minute: why access is
 * needed, the system permission, blocked and allowed apps, a daily limit,
 * lock times and strictness. Also reopened when access was switched off,
 * in which case only the access step is shown.
 */
export default function ScreenTimeSetup() {
  const insets = useSafeAreaInsets();
  const guard = useTapGuard();
  const st = getScreenTime();
  const reconnect = st.meta.setUp;
  const [step, setStep] = useState<Step>(reconnect ? 'access' : 'why');
  const [rules, setRules] = useState<ScreenTimeRules>(() => ({
    ...st.rules,
    lockTimes: st.rules.lockTimes.length ? st.rules.lockTimes : [{ id: 'lock-sleep', ...LOCK_PRESETS[0] }],
  }));
  const [access, setAccess] = useState(availability());
  const [busy, setBusy] = useState(false);
  const [asked, setAsked] = useState(false);
  // Android grants access in Settings screens: check again when the user comes back.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') setAccess(availability());
    });
    return () => sub.remove();
  }, []);
  const next = () => setStep(STEPS[Math.min(STEPS.length - 1, STEPS.indexOf(step) + 1)]);
  const back = () => (STEPS.indexOf(step) === 0 || reconnect ? router.back() : setStep(STEPS[STEPS.indexOf(step) - 1]));
  const set = (patch: Partial<ScreenTimeRules>) => setRules((r) => ({ ...r, ...patch }));

  const askAccess = async () => {
    if (!ScreenTime) return;
    setBusy(true);
    setAsked(true);
    try {
      const res = await ScreenTime.requestAuthorization();
      void ScreenTime.requestNotifications().catch(() => false);
      setAccess(res === 'approved' ? 'ready' : 'needs-permission');
      if (res === 'approved') {
        if (reconnect) {
          syncScreenTime();
          router.back();
        } else next();
      }
    } finally {
      setBusy(false);
    }
  };

  const finish = () => {
    const now = Date.now();
    saveRules(rules.strictness === 'strict' ? startStrict(rules, now, DEFAULT_STRICT_DAYS) : { ...rules, strictUntil: null, pending: null });
    markSetUp();
    router.replace('/screen-time');
  };

  const toggleLock = (preset: Omit<LockTime, 'id'>) => {
    const has = rules.lockTimes.find((l) => l.name === preset.name);
    set({
      lockTimes: has
        ? rules.lockTimes.filter((l) => l !== has)
        : [...rules.lockTimes, { id: `lock-${preset.name.toLowerCase()}`, ...preset }],
    });
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: color.ground }}
      contentContainerStyle={[styles.page, { paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.huge }]}
    >
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={back} hitSlop={12}>
          <Label tone="chalk">{STEPS.indexOf(step) === 0 || reconnect ? 'Close' : 'Back'}</Label>
        </Pressable>
        {!reconnect && (
          <Mono size={12} tone="muted">
            {`${STEPS.indexOf(step) + 1} / ${STEPS.length}`}
          </Mono>
        )}
      </View>

      {step === 'why' && (
        <Block title="Earn your scroll">
          <Body tone="muted">
            Pick the apps that take more of your day than you&apos;d like. Trueline blocks them during lock times and once your daily limit is
            used up. Do a set (push-ups, crunches or a plank) and you earn minutes to open them again.
          </Body>
          <Body tone="muted">
            {Platform.OS === 'ios'
              ? "Trueline uses Apple's Screen Time. Apple only tells us tokens for the apps you pick, never their names or what you do in them. Nothing leaves your phone."
              : 'Trueline needs to see which app is open (usage access) and to show its blocked screen over other apps. Nothing leaves your phone.'}
          </Body>
          {access === 'unsupported' ? (
            <Body tone="cue">
              {Platform.OS === 'ios'
                ? 'This build of Trueline was made without Screen Time (it needs iOS 17.4 or later and a build with the Family Controls capability).'
                : "This phone can't run Trueline's screen time yet."}
            </Body>
          ) : (
            <Button label="Next" onPress={next} />
          )}
        </Block>
      )}

      {step === 'access' && (
        <Block title={reconnect ? 'Turn access back on' : 'Give access'}>
          <Body tone="muted">
            {Platform.OS === 'ios'
              ? 'iPhone will ask you to allow Screen Time access, using Face ID or your passcode.'
              : 'Android will open two settings screens: turn on Usage access, then Display over other apps, for Trueline.'}
          </Body>
          {access === 'needs-permission' && asked && !busy && (
            <Body tone="cue" size={14}>
              Access isn&apos;t on yet. Without it Trueline can&apos;t block anything.
            </Body>
          )}
          <Button label={busy ? 'Waiting…' : 'Allow access'} disabled={busy || access === 'unsupported'} onPress={guard(askAccess)} />
          {access === 'ready' && Platform.OS === 'android' && (
            <>
              <Body tone="muted" size={14}>
                Some phones stop apps running in the background to save battery, which would stop blocking. Let Trueline keep running:
              </Body>
              <Button variant="ghost" size="sm" label="Allow background running" onPress={() => ScreenTime?.openSettings?.('battery')} />
            </>
          )}
          {access === 'ready' && !reconnect && <Button variant="ghost" label="Next" onPress={next} />}
        </Block>
      )}

      {step === 'blocked' && (
        <Block title="Which apps eat your time?">
          <Body tone="muted">Pick apps or whole categories (Social, Games, Entertainment…). You can change this later.</Body>
          <Strong>{countLabel(rules.blocked)}</Strong>
          <Button
            variant="ghost"
            label="Pick apps"
            onPress={guard(async () => {
              const picked = await pickApps('Blocked apps', rules.blocked);
              if (picked) set({ blocked: picked });
            })}
          />
          <Button label="Next" disabled={countLabel(rules.blocked) === 'None picked'} onPress={next} />
        </Block>
      )}

      {step === 'allowed' && (
        <Block title="Always allowed">
          <Body tone="muted">
            Apps that should never be blocked, even when their whole category is (Phone, Messages, Maps, your bank…). Optional.
          </Body>
          <Strong>{countLabel(rules.allowed)}</Strong>
          <Button
            variant="ghost"
            label="Pick apps"
            onPress={guard(async () => {
              const picked = await pickApps('Always allowed', rules.allowed);
              if (picked) set({ allowed: picked });
            })}
          />
          <Button label="Next" onPress={next} />
        </Block>
      )}

      {step === 'limit' && (
        <Block title="Daily limit">
          <Body tone="muted">How long a day can you use those apps outside lock times? After that, only earned time opens them.</Body>
          <View style={styles.chips}>
            {LIMITS.map(([v, l]) => (
              <Chip key={l} label={l} selected={rules.dailyLimitMin === v} onPress={() => set({ dailyLimitMin: v })} />
            ))}
          </View>
          <Button label="Next" onPress={next} />
        </Block>
      )}

      {step === 'locks' && (
        <Block title="Lock times">
          <Body tone="muted">
            Times when the apps don&apos;t open at all. Sleep is on to start with. You can add your own times later.
          </Body>
          {LOCK_PRESETS.map((p) => {
            const on = rules.lockTimes.some((l) => l.name === p.name);
            return (
              <Pressable
                key={p.name}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                onPress={() => toggleLock(p)}
                style={[styles.option, on && styles.optionOn]}
              >
                <Strong>{p.name}</Strong>
                <Body tone="muted" size={13}>
                  {describeLock({ id: '', ...p })}
                </Body>
              </Pressable>
            );
          })}
          <Button label="Next" onPress={next} />
        </Block>
      )}

      {step === 'strictness' && (
        <Block title="How strict?">
          {(
            [
              ['nudge', 'Nudge', 'Changes apply at once. The blocked screen offers "1 more minute", three times a day.'],
              ['standard', 'Standard', 'Making things easier waits until midnight. One 10-minute emergency unlock a day.'],
              [
                'strict',
                'Strict (7 days)',
                "No unlocks, apps can't come off the list, and any easing waits 24 hours. To end it early: 100 verified push-ups.",
              ],
            ] as [Strictness, string, string][]
          ).map(([v, label, hint]) => (
            <Pressable
              key={v}
              accessibilityRole="radio"
              accessibilityState={{ selected: rules.strictness === v }}
              onPress={() => set({ strictness: v })}
              style={[styles.option, rules.strictness === v && styles.optionOn]}
            >
              <Strong>{label}</Strong>
              <Body tone="muted" size={13}>
                {hint}
              </Body>
            </Pressable>
          ))}
          <Button label="Next" onPress={next} />
        </Block>
      )}

      {step === 'done' && (
        <Block title="Ready">
          <Summary label="Blocked" value={countLabel(rules.blocked)} />
          <Summary label="Always allowed" value={countLabel(rules.allowed)} />
          <Summary label="Daily limit" value={rules.dailyLimitMin === null ? 'None' : formatMin(rules.dailyLimitMin)} />
          <Summary label="Lock times" value={rules.lockTimes.length ? rules.lockTimes.map(describeLock).join('\n') : 'None'} />
          <Summary label="Earning" value={`Up to ${formatMin(rules.earning.dailyCapMin)} a day · 1 min per clean push-up`} />
          <Summary label="Strictness" value={rules.strictness[0].toUpperCase() + rules.strictness.slice(1)} />
          <Button label="Turn on" size="lg" onPress={finish} />
        </Block>
      )}
    </ScrollView>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: space.lg }}>
      <Display size={40}>{title}</Display>
      {children}
    </View>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summary}>
      <Mono size={12} tone="muted" style={{ width: 110 }}>
        {label}
      </Mono>
      <Body size={14} style={{ flex: 1 }}>
        {value}
      </Body>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: space.xl, gap: space.xxl, width: '100%', maxWidth: 560, alignSelf: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  option: { gap: 2, padding: space.lg, borderRadius: radius.lg, borderWidth: 1.5, borderColor: color.lineSoft, backgroundColor: color.surface },
  optionOn: { borderColor: color.vial },
  summary: { flexDirection: 'row', gap: space.md, paddingVertical: space.xs },
});
