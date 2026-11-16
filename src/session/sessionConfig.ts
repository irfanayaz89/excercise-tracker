import type { DeepPartial, EngineConfig } from '@/engine/config';
import { mergeConfig } from '@/engine/config';
import { difficultyOverrides } from '@/engine/difficulty';
import type { Settings } from '@/storage/settings';

/** Engine overrides for a set: the level, the exercise and its options (saved with tuning recordings). */
type SetOptions = Pick<Settings, 'difficulty' | 'allowKneeling' | 'exercise' | 'plankTestMode'> & Partial<Pick<Settings, 'realPersonCheck'>>;

export function sessionOverrides(s: SetOptions): DeepPartial<EngineConfig> {
  let o = difficultyOverrides(s.difficulty, { allowKneeling: s.allowKneeling, exercise: s.exercise });
  if (s.exercise === 'plank' && s.plankTestMode) o = { ...o, hold: { ...o.hold, endOnBreak: true } };
  if (s.realPersonCheck === false) o = { ...o, reality: { enabled: false } };
  return o;
}

/** The full engine config a set runs with. */
export function sessionConfig(s: SetOptions): EngineConfig {
  return mergeConfig(sessionOverrides(s));
}
