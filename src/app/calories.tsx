import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EXERCISE_IDS, EXERCISES } from '@/engine/exercises';
import { TYPICAL_SET, typicalSetKcal } from '@/fitness/energy';
import { kcalText } from '@/fitness/format';
import { AddWeightForCalories, useEnergyBody } from '@/features/energy/Calories';
import { Body, Display, Label, Mono, Strong } from '@/ui/primitives';
import { color, radius, space, type } from '@/ui/theme';

/**
 * How calories are worked out: the method, the sources and how far off it can
 * be (App Store guideline 1.4.1 asks apps to disclose the method behind health
 * numbers). Plain words, no decimals.
 */
export default function CaloriesInfo() {
  const insets = useSafeAreaInsets();
  const body = useEnergyBody();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: color.ground }}
      contentContainerStyle={[styles.page, { paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.huge }]}
    >
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} hitSlop={12}>
          <Label tone="chalk">‹ Back</Label>
        </Pressable>
      </View>
      <Display size={type.headline}>How calories are worked out</Display>
      <Body tone="muted">
        Trueline counts the energy a set uses above what your body burns anyway at rest. Apple Health and Health Connect call this active
        energy.
      </Body>

      <View style={styles.card}>
        <Label>Your sets</Label>
        {body ? (
          EXERCISE_IDS.map((e) => (
            <View key={e} style={styles.row}>
              <Body size={type.detail} style={{ flex: 1 }}>
                {`${EXERCISES[e].label}: ${TYPICAL_SET[e].label}`}
              </Body>
              <Strong size={type.detail}>{kcalText(typicalSetKcal(e, body))}</Strong>
            </View>
          ))
        ) : (
          <AddWeightForCalories />
        )}
        <Mono size={type.small} tone="muted">
          Sets burn only a few calories each. Most of any weight change comes from what you eat.
        </Mono>
      </View>

      <Section title="The method">
        Each rep is priced from two parts: the work of lifting part of your body (your weight, and a distance scaled to your height), and
        the cost of holding the position for as long as the rep takes, which the camera measures. The push-up figures are calibrated to a
        lab study that measured them (Nakagata 2022). Pull-up and crunch figures are inferred from the same physics and the 2024 Compendium
        of Physical Activities. Planks count 3 METs above rest for each second in good form (Ratamess 2015, Huang 2023). Rest between sets
        adds nothing. Body fat doesn&apos;t change it: fat is lifted like muscle.
      </Section>
      <Section title="How far off it can be">
        For any one set the true figure can easily be a third higher or lower, which is why each number comes with a range. No method, not
        even a lab, measures a 30-second set to 99%: lab methods disagree by two to three times depending on what they count, and wrist
        trackers barely track strength work at all. Over a week the figure is good to about ±25%.
      </Section>
      <Section title="Calories and body fat">
        A gram of body fat holds about 7.7 kcal, so totals are shown as the energy in that much fat, after taking off the fifth of workout
        calories people tend to eat back. It isn&apos;t fat actually burned, and weight doesn&apos;t fall in a straight line: the scale may
        not move while fat goes down, because strength work adds a little muscle.
      </Section>
      <Section title="The 30 and 60 day outlook">
        Each column shows the one number that matters for your goal, with its likely range: weight with an eating target, your best set once
        you have two weeks of sets, otherwise workout calories. People tend to eat back about a fifth of workout calories, which is already
        taken off. Weight lost in the first month holds more water, so the fast end of the range counts it at 4,858 kcal per kg; the middle
        uses 7,700. Over months and years the body adapts: a lasting 100 kcal a day less moves weight about 4.5 kg in the end, half of it
        within a year (Hall 2011).
      </Section>
      <Section title="Your daily calories">
        Your goal&apos;s plan uses the Mifflin–St Jeor equation, or Ten Haaf&apos;s if you lift regularly or are very muscular, accurate to
        about 10% for most adults. A waist measurement gives a body-fat estimate (Relative Fat Mass, about ±5 points). Your weekly weigh-in
        is the real check. This is not medical advice; if food or weight feels hard to manage, talk to your doctor or an eating-disorder
        helpline.
      </Section>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: string }) {
  return (
    <View style={{ gap: space.sm }}>
      <Label>{title}</Label>
      <Body size={type.detail}>{children}</Body>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: space.xl, gap: space.xl, width: '100%', maxWidth: 560, alignSelf: 'center' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    columnGap: space.md,
    rowGap: space.xs,
    alignItems: 'center',
  },
  card: {
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.lg,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.lineSoft,
  },
  row: { flexDirection: 'row', alignItems: 'baseline', gap: space.md },
});
