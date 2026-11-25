/**
 * A "now" the user can't move by changing the phone's clock (audit B1).
 *
 * Every rule here runs on wall-clock time: Strict's end, waiting changes, a
 * key lock, a new day's allowance. Setting the clock forward would end them
 * all. The phone also has a clock that only counts up since it booted (it
 * keeps counting while asleep). Each time we read the time we compare how far
 * the wall clock moved with how far that clock moved since the last good
 * reading: if they disagree by more than a couple of minutes, the wall clock
 * was changed and we carry on from the last good reading instead.
 *
 * Once anchored, time always runs on from the boot clock, even while the two
 * agree: re-anchoring to the wall clock each time would let small moves (under
 * the two-minute slack) add up.
 *
 * After a reboot the boot clock starts again and there is nothing to compare
 * with, so the wall clock is trusted then. That is also how a genuinely wrong
 * clock gets corrected: restart the phone. A wall clock before 2026 (a phone
 * that booted with a reset clock, before network time arrived) is never used
 * as an anchor.
 */

export interface BootReading {
  uptimeMs: number;
  boot: string;
}

/** The last reading the wall clock and the boot clock agreed on. */
export interface ClockAnchor {
  wall: number;
  up: number;
  boot: string;
}

/** Network time corrections are seconds; anything past this is a changed clock. */
export const JUMP_MS = 120_000;
/** No phone running this build has a real date before this: an earlier wall clock is unset. */
export const PLAUSIBLE_FROM = Date.UTC(2026, 0, 1);

export interface Trusted {
  now: number;
  /** The wall clock disagrees with the boot clock: it was changed. */
  jumped: boolean;
  anchor: ClockAnchor | null;
}

export function trustedTime(anchor: ClockAnchor | null, wall: number, reading: BootReading | null): Trusted {
  if (!reading || !Number.isFinite(reading.uptimeMs)) return { now: wall, jumped: false, anchor };
  // First reading, or the phone restarted: nothing to compare with.
  if (!anchor || anchor.boot !== reading.boot || reading.uptimeMs < anchor.up) {
    return { now: wall, jumped: false, anchor: wall >= PLAUSIBLE_FROM ? { wall, up: reading.uptimeMs, boot: reading.boot } : null };
  }
  const expected = anchor.wall + (reading.uptimeMs - anchor.up);
  // Carry on from the boot clock either way (see above); only say "changed" past the slack.
  return { now: expected, jumped: Math.abs(wall - expected) > JUMP_MS, anchor: { wall: expected, up: reading.uptimeMs, boot: reading.boot } };
}

export function parseAnchor(raw: unknown): ClockAnchor | null {
  const o = raw as ClockAnchor | null;
  return o && typeof o.wall === 'number' && typeof o.up === 'number' && typeof o.boot === 'string' && Number.isFinite(o.wall) && Number.isFinite(o.up)
    ? { wall: o.wall, up: o.up, boot: o.boot }
    : null;
}
