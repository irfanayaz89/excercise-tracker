/// <reference types="jest" />
import { bmr, cmToFtIn, ftInToCm, lowestHealthyKg, relativeFatMass, maintenance, strengthFuel, weightPlan, type Body } from '../energy';

const man: Body = { sex: 'male', age: 30, heightCm: 180, weightKg: 80, activity: 'low' };
const woman: Body = { sex: 'female', age: 30, heightCm: 165, weightKg: 65, activity: 'some' };

describe('energy', () => {
  test('Mifflin–St Jeor matches worked examples', () => {
    // 10×80 + 6.25×180 − 5×30 + 5 = 1780
    expect(bmr(man)).toBe(1780);
    // 10×65 + 6.25×165 − 150 − 161 = 1370.25
    expect(bmr(woman)).toBeCloseTo(1370.25, 2);
    // Unspecified sits between the two.
    expect(bmr({ ...man, sex: 'unspecified' })).toBe(1780 - 83);
    expect(maintenance(man)).toBeCloseTo(2136, 0);
  });

  test('muscular people use Ten Haaf, and waist gives a body-fat estimate', () => {
    // 11.936×80 + 587.728×1.8 − 8.129×30 + 191.027 + 29.279 ≈ 1989
    expect(bmr({ ...man, muscular: true })).toBeCloseTo(1989.2, 0);
    // RFM: men 64 − 20 × 180/90 = 24 %; women 76 − 20 × 165/80 = 34.75 %
    expect(relativeFatMass('male', 180, 90)).toBeCloseTo(24, 5);
    expect(relativeFatMass('female', 165, 80)).toBeCloseTo(34.75, 5);
    expect(relativeFatMass('male', 180, 0)).toBeNull();
  });

  test('the lowest healthy target', () => {
    expect(lowestHealthyKg(180)).toBeCloseTo(59.94, 2);
  });

  test('a weight plan at a safe pace', () => {
    const p = weightPlan({ ...man, activity: 'some' }, 75, 0.5, 0);
    expect(p.weeks).toBe(10);
    expect(p.dailyDeficit).toBeCloseTo(550, 0);
    expect(p.eatKcal).toBe(Math.round(1780 * 1.375 - 550));
    expect(p.weeks * 7 * p.dailyDeficit).toBeGreaterThanOrEqual(5 * 7700);
    expect(p.floored).toBe(false);
    expect(p.by).toBe(10 * 7 * 86_400_000);
  });

  test('workouts bring the date forward, counted at 80% (people eat back about a fifth)', () => {
    const body = { ...man, activity: 'some' as const };
    // 550 from eating + 0.8 × 100 from workouts = 630 a day: 5 kg × 7,700 / (630 × 7) = 8.7 → 9 weeks.
    const p = weightPlan(body, 75, 0.5, 0, 100);
    expect(p.dailyGap).toBeCloseTo(630, 0);
    expect(p.weeks).toBe(9);
    expect(p.eatKcal).toBe(weightPlan(body, 75, 0.5, 0).eatKcal);
    expect(weightPlan(body, 75, 0.5, 0).weeks).toBe(10);
  });

  test('heights in feet and inches never read 12 inches', () => {
    for (const cm of [152, 182, 213]) expect(cmToFtIn(cm).inch).toBeLessThan(12);
    expect(cmToFtIn(182)).toEqual({ ft: 6, inch: 0 });
  });

  test('a weight-loss plan never asks someone to eat more than they use', () => {
    const tiny: Body = { sex: 'female', age: 60, heightCm: 150, weightKg: 50, activity: 'low' };
    const p = weightPlan(tiny, 47, 0.5, 0);
    expect(p.eatKcal).toBeLessThanOrEqual(Math.round(maintenance(tiny)));
    expect(p.weeks).toBe(Infinity);
  });

  test('eating never drops below resting energy or 1,200 kcal', () => {
    const small: Body = { sex: 'female', age: 60, heightCm: 150, weightKg: 55, activity: 'low' };
    const p = weightPlan(small, 50, 0.75, 0);
    expect(p.floored).toBe(true);
    expect(p.eatKcal).toBeGreaterThanOrEqual(1200);
    expect(p.eatKcal).toBeGreaterThanOrEqual(Math.round(bmr(small)));
    // The smaller gap means more weeks than the asked-for pace (5 kg at 0.75 kg a week = 7).
    expect(p.weeks).toBeGreaterThan(7);
    // A body whose maintenance is already near the floor gets no date at all.
    const tiny = weightPlan({ ...small, heightCm: 145, weightKg: 45, age: 80 }, 42, 0.5, 0);
    expect(tiny.weeks).toBe(Infinity);
  });

  test('strength fuel and units', () => {
    expect(strengthFuel(man)).toEqual({ eatKcal: Math.round(1780 * 1.2 + 250), proteinG: 128 });
    expect(ftInToCm(5, 10)).toBeCloseTo(177.8, 1);
  });
});
