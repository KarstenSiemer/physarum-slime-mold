import { describe, expect, it } from 'vitest';
import { defaultSettings, defaultStrain } from '../model/params';
import { levelAbove, levelWithin, strandLevel } from './exposure';
import {
  SCENT_GLOW,
  SCENT_LEVELS,
  SCENT_LINE,
  SCENT_PAPER_FILL,
  scentColours,
  scentGlow,
  scentLevel,
  scentLevelSize,
  scentLine,
  scentMark,
  scentOver,
} from './scent';

// The scale of the scent view (ADR 0009, amendments of 2026-11-11). The GPU tests hold both render passes to it.
describe('scentGlow', () => {
  it('is 0 up to 0.01 and for no scent, and SCENT_GLOW from 10,000 up', () => {
    for (const v of [0, -1, Number.NaN, 0.001, 0.01]) expect(scentGlow(v)).toBe(0);
    for (const v of [1e4, 1e5, 1e9]) expect(scentGlow(v)).toBeCloseTo(SCENT_GLOW, 12);
  });

  it('rises by the same step for every power of ten, with no step inside one', () => {
    expect(SCENT_LEVELS).toEqual([0.01, 0.1, 1, 10, 100, 1000, 10000]);
    SCENT_LEVELS.forEach((v, i) => {
      expect(scentGlow(v)).toBeCloseTo((SCENT_GLOW * i) / 6, 12);
    });
    expect(scentGlow(10 ** 1.5)).toBeCloseTo((SCENT_GLOW * 3.5) / 6, 12);
    expect(scentGlow(3.01) - scentGlow(3)).toBeLessThan(1e-3);
  });
});

describe('scentLine', () => {
  it('draws about one pixel where the scent equals the mark, and nothing without a mark', () => {
    const slope = (v: number) => v * Math.LN10 * 0.1; // 0.1 powers of ten per cell, at one cell per pixel
    expect(scentLine(5, slope(5), 1, 5)).toBeCloseTo(SCENT_LINE, 12);
    expect(scentLine(5 * 10 ** 0.05, slope(5), 1, 5)).toBeGreaterThan(0.5 * SCENT_LINE); // half a pixel off
    expect(scentLine(5 * 10 ** 0.2, slope(5), 1, 5)).toBe(0); // two pixels off
    expect(scentLine(5, slope(5), 1, 0)).toBe(0);
    expect(scentLine(0, 0, 1, 5)).toBe(0);
  });
});

describe('scentMark', () => {
  const s = defaultSettings();
  it('is the trail of a strand, as the sensor weighs it against the food scent', () => {
    expect(scentMark(s, 0)).toBe(0); // nothing measured yet
    expect(scentMark(s, 8)).toBe(8); // food and own trail weigh 1
    const half = { ...s, strains: [{ ...defaultStrain(0), food: 0.5 }] };
    expect(scentMark(half, 8)).toBe(16); // food that weighs half needs twice the scent
    const k = { ...s, trailSaturation: 8 };
    expect(scentMark(k, 8)).toBe(4); // a sensor reads 8 / (1 + 8 / 8)
    expect(scentMark({ ...k, model: 'jones' }, 8)).toBe(8); // Jones has no saturation
  });

  it('weighs food as the own trail in the Jones model, and takes the lowest mark of several strains', () => {
    const jones = { ...s, model: 'jones' as const, strains: [{ ...defaultStrain(0), food: 0.2 }] };
    expect(scentMark(jones, 8)).toBe(8);
    const two = {
      ...s,
      strains: [
        { ...defaultStrain(0, 2), food: 0.5 },
        { ...defaultStrain(1, 2), food: 2 },
      ],
    };
    expect(scentMark(two, 8)).toBe(4);
    const fleeing = { ...s, strains: [{ ...defaultStrain(0), food: -1 }] };
    expect(scentMark(fleeing, 8)).toBe(0); // no strain follows food: no mark
  });
});

describe('strand level', () => {
  it('reads the 99th percentile within its log2 bin, where the exposure takes the bin centre', () => {
    const bins = new Array<number>(64).fill(0);
    bins[30] = 990; // 2^5 to 2^5.5
    bins[40] = 10; // 2^10 to 2^10.5: the top 1 %
    expect(levelAbove(bins, 1000, 0.01)).toBeCloseTo(2 ** 10.25, 9);
    expect(strandLevel(bins, 1000)).toBeCloseTo(2 ** 10, 9); // all 10 cells of the bin are needed: its bottom
    bins[40] = 20;
    expect(levelWithin(bins, 1010, 0.01)).toBeCloseTo(2 ** (10 + (1 - 10.1 / 20) / 2), 9);
    expect(strandLevel(new Array<number>(64).fill(0), 1000)).toBe(0);
  });
});

describe('scentLevel', () => {
  it('reads the grid up to 2 cells per pixel, then lattices of 2, 4 and 8 cells', () => {
    expect([0.1, 1, 1.99, 2, 3.9, 4, 8, 64].map(scentLevel)).toEqual([0, 0, 0, 1, 1, 2, 3, 3]);
    expect([scentLevelSize(1024, 1), scentLevelSize(1023, 1), scentLevelSize(236, 3)]).toEqual([512, 512, 30]);
  });
});

describe('scentOver', () => {
  it('lays the food glow, its line and the repellent glow over the colour below', () => {
    const c = [0.5, 0.5, 0.5] as const;
    expect(scentOver(c, 'glow', 0, 0, 0)).toEqual(c);
    const food = scentOver(c, 'glow', 0.4, 0, 0);
    expect(food[1]).toBeGreaterThan(c[1]);
    expect(food[0]).toBeLessThan(c[0]);
    expect(scentOver(c, 'paper', 0.4, 0, 0)[1]).toBeLessThan(c[1]); // dark green over paper
    const k = scentColours('paper');
    expect(scentOver(c, 'paper', 0.2, 0, 0)[1]).toBeCloseTo(0.5 + (k.food[1] - 0.5) * 0.2 * SCENT_PAPER_FILL, 12);
  });
});
