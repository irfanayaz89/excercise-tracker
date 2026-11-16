/**
 * Trueline design tokens.
 *
 * Concept: the app is used from the floor, two metres away, mid-set. So the
 * identity comes from that: a deep pool-tile teal ground (calm, low glare in a
 * dim room), chalk-white type, and one signal colour taken from a spirit-level
 * vial. Numerals are condensed stadium-signage type, big enough to read from
 * across a room. Reps are tally marks, the oldest way of counting.
 */
export const color = {
  ground: '#0C1A1D',
  ground2: '#10232714',
  surface: '#132A2F',
  raised: '#1A363C',
  line: '#24464D',
  lineSoft: '#1C3A40',
  chalk: '#EEF1EA',
  chalk2: '#C9D3CE',
  muted: '#86A1A4',
  faint: '#557377',
  /** Spirit-level vial yellow: the one accent. */
  vial: '#F3D64B',
  vialInk: '#1D1A05',
  good: '#4FD69C',
  goodSoft: '#4FD69C22',
  cue: '#F5A83B',
  cueSoft: '#F5A83B22',
  fault: '#FF6B5B',
  faultSoft: '#FF6B5B22',
  scrim: 'rgba(8, 20, 23, 0.55)',
  scrimStrong: 'rgba(8, 20, 23, 0.82)',
} as const;

export const font = {
  /** Condensed stadium numerals and headlines. */
  display: 'BigShouldersDisplay_800ExtraBold',
  displayBlack: 'BigShouldersDisplay_900Black',
  displayMed: 'BigShouldersDisplay_600SemiBold',
  body: 'Archivo_400Regular',
  bodyMed: 'Archivo_500Medium',
  bodySemi: 'Archivo_600SemiBold',
  bodyBold: 'Archivo_700Bold',
  mono: 'JetBrainsMono_400Regular',
  monoMed: 'JetBrainsMono_500Medium',
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, huge: 48 } as const;

export const radius = { sm: 6, md: 10, lg: 16, pill: 999 } as const;

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
