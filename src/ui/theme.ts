/**
 * Trueline design tokens.
 *
 * Concept: a gym scoreboard. Asphalt-slate ground, chalk type, and two signal
 * colours with fixed meanings: orange is effort (progress, the one main action
 * on a screen), green is done (a goal met, a clean rep). Numbers are the hero:
 * tall condensed numerals that fill with orange as you get closer to a goal.
 * No gradients, no shadows; blocks are told apart by surface tone.
 *
 * Token names are kept from the first theme so every screen picks this up:
 * `ground` is the background, `chalk` the text, `vial` the accent (now effort orange).
 */
export const color = {
  ground: '#1F2937',
  ground2: '#1F293714',
  surface: '#29313F',
  raised: '#313742',
  line: '#374151',
  lineSoft: '#2F3846',
  chalk: '#F8FAFC',
  chalk2: '#CBD5E1',
  muted: '#9AA6B8',
  faint: '#94A0B2',
  /** Effort orange: progress and the main action. */
  vial: '#F97316',
  vialInk: '#0F172A',
  vialSoft: '#F9731622',
  /** Done green: goals met, clean reps. */
  good: '#22C55E',
  goodSoft: '#22C55E22',
  cue: '#FACC15',
  cueSoft: '#FACC1522',
  fault: '#F87171',
  faultSoft: '#EF444426',
  scrim: 'rgba(15, 23, 42, 0.55)',
  scrimStrong: 'rgba(15, 23, 42, 0.84)',
} as const;

export const font = {
  /** Condensed scoreboard numerals and headlines. */
  display: 'BarlowCondensed_700Bold',
  displayBlack: 'BarlowCondensed_800ExtraBold',
  displayMed: 'BarlowCondensed_600SemiBold',
  body: 'Barlow_400Regular',
  bodyMed: 'Barlow_500Medium',
  bodySemi: 'Barlow_600SemiBold',
  bodyBold: 'Barlow_700Bold',
  /** Numbers in running text: Barlow with tabular figures (see Mono), not a monospace face. */
  mono: 'Barlow_500Medium',
  monoMed: 'Barlow_600SemiBold',
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, huge: 48 } as const;

export const radius = { sm: 4, md: 8, lg: 12, pill: 999 } as const;

/** Type scale. Live-session sizes are tuned for reading at ~2 m. */
export const type = {
  micro: 11,
  caption: 13,
  body: 16,
  lead: 19,
  title: 26,
  headline: 40,
  hero: 72,
  liveCue: 46,
  liveCount: 168,
} as const;

export const motion = { fast: 140, base: 220, slow: 420 } as const;
