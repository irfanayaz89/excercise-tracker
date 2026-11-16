/// <reference types="jest" />
import { attitudeFromGravity } from '../attitude';
import { PhoneGate } from '../gates';
import { DEFAULT_CONFIG } from '../config';

const G = 9.81;
const tilt = (deg: number) => [Math.sin((deg * Math.PI) / 180) * G, Math.cos((deg * Math.PI) / 180) * G] as const;

describe('attitudeFromGravity', () => {
  it('reads level landscape on either side as zero roll', () => {
    expect(attitudeFromGravity(G, 0, 0, 'landscape')!.rollDeg).toBeCloseTo(0);
    expect(attitudeFromGravity(-G, 0, 0, 'landscape')!.rollDeg).toBeCloseTo(0);
  });

  it('reads upright portrait as zero roll on both sign conventions', () => {
    expect(attitudeFromGravity(0, -G, 0, 'portrait')!.rollDeg).toBeCloseTo(0);
    expect(attitudeFromGravity(0, G, 0, 'portrait')!.rollDeg).toBeCloseTo(0);
  });

  it('measures a small sideways tilt in portrait', () => {
    const [s, c] = tilt(4);
    expect(Math.abs(attitudeFromGravity(s, -c, 0, 'portrait')!.rollDeg)).toBeCloseTo(4);
  });

  it('reports a portrait phone as wrong when landscape was picked, and vice versa', () => {
    const gate = new PhoneGate(DEFAULT_CONFIG);
    const portraitPhone = attitudeFromGravity(0, -G, 0, 'landscape')!;
    gate.push({ t: 0, ...portraitPhone, motionDegPerSec: 0 });
    expect(gate.check(10).issue).toBe('wrong-orientation');

    const gate2 = new PhoneGate(DEFAULT_CONFIG);
    const landscapePhone = attitudeFromGravity(G, 0, 0, 'portrait')!;
    gate2.push({ t: 0, ...landscapePhone, motionDegPerSec: 0 });
    expect(gate2.check(10).issue).toBe('wrong-orientation');
  });

  it('still detects a phone lying flat in portrait mode', () => {
    const flat = attitudeFromGravity(0, -0.5, -G, 'portrait')!;
    expect(Math.abs(flat.pitchDeg)).toBeGreaterThan(55);
  });

  it('rejects bogus readings', () => {
    expect(attitudeFromGravity(0, 0, 0, 'portrait')).toBeNull();
    expect(attitudeFromGravity(NaN, 1, 1, 'landscape')).toBeNull();
  });
});
