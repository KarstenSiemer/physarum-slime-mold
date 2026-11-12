import { describe, expect, it } from 'vitest';
import { defaultSettings, defaultStrain, type Strain } from '../model/params';
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
  scentOver,
  scentSensors,
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
  it('draws about one pixel where the ratio is 1, and nothing without a ratio', () => {
    const slope = (r: number) => r * Math.LN10 * 0.1; // 0.1 powers of ten per cell, at one cell per pixel
    expect(scentLine(1, slope(1), 1)).toBeCloseTo(SCENT_LINE, 12);
    expect(scentLine(10 ** 0.05, slope(1), 1)).toBeGreaterThan(0.5 * SCENT_LINE); // half a pixel off
    expect(scentLine(10 ** 0.2, slope(1), 1)).toBe(0); // two pixels off
    expect(scentLine(10 ** -0.2, slope(1), 1)).toBe(0);
    expect(scentLine(0, 0, 1)).toBe(0);
  });
});

describe('scentSensors', () => {
  const s = { ...defaultSettings(), model: 'extended' as const, trailSaturation: 0 };
  const half = 9 * Math.sin((22.5 * Math.PI) / 180);
  const one = (patch: Partial<Strain>) => ({ ...s, strains: [{ ...defaultStrain(0, 1), ...patch }] });
  it('gives each strain that follows food its half spread of sensors and the hold of a strand', () => {
    const r = scentSensors(one({ food: 2 }), 8);
    expect(r.half[0]).toBeCloseTo(half, 12);
    expect(r.holds[0]).toBe(4); // 1 · 8 / 2
    expect([...r.half.slice(1), ...r.holds.slice(1)]).toEqual([0, 0, 0, 0, 0, 0]);
    expect(scentSensors(one({}), 0)).toEqual({ half: [0, 0, 0, 0], holds: [0, 0, 0, 0] }); // nothing measured yet
    expect(scentSensors(one({}), 8).holds[0]).toBe(8); // food and own trail weigh 1
    expect(scentSensors(one({ food: 0.5 }), 8).holds[0]).toBe(16); // food that weighs half needs twice the scent
  });

  it('reads the strand as a saturated sensor does, and weighs food as the own trail in the Jones model', () => {
    const k = { ...one({}), trailSaturation: 8 };
    expect(scentSensors(k, 8).holds[0]).toBe(4); // a sensor reads 8 / (1 + 8 / 8)
    expect(scentSensors({ ...k, model: 'jones' }, 8).holds[0]).toBe(8); // Jones has no saturation
    // The Jones model weighs food as the strain's own trail: the hold is the strand, whatever the food weight.
    expect(scentSensors({ ...one({ food: 0.2 }), model: 'jones' }, 8).holds[0]).toBe(8);
  });

  it('lets strains of one spread share the lowest hold, and gives other spreads pairs of their own', () => {
    const two = {
      ...s,
      strains: [
        { ...defaultStrain(0, 2), food: 0.5 },
        { ...defaultStrain(1, 2), food: 2 },
      ],
    };
    const a = scentSensors(two, 8);
    expect(a.half.filter((h) => h > 0)).toEqual([a.half[0]]);
    expect(a.holds[0]).toBe(4); // the lower of 16 and 4
    const other = { ...s, strains: [defaultStrain(0, 2), { ...defaultStrain(1, 2), sensorOffset: 4 }] };
    const b = scentSensors(other, 8);
    expect(b.half[1]).toBeCloseTo(4 * Math.sin((22.5 * Math.PI) / 180), 12);
    expect(b.holds.slice(0, 2)).toEqual([8, 8]);
    // A strain that flees food has no line.
    expect(scentSensors(one({ food: -1 }), 8).half).toEqual([0, 0, 0, 0]);
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

  // Within the bin the cells thin out at the rate of the bins beside it: a tail of the trail as the networks have it
  // (review of 2026-11-11: a flat share ran up to 20 % high). The trail of 100,000 cells from a log-normal distribution,
  // binned as histogram.wgsl bins it, against its exact 99th percentile.
  it.each([
    [1, 0.5],
    [2, 0.35],
    [0.5, 0.8],
  ])('reads the 99th percentile of a log-normal trail within 3 percent (median %f, sigma %f)', (median, sigma) => {
    const n = 100_000;
    // The inverse of the normal distribution by bisection of erf, for quantiles of the log-normal.
    const erf = (x: number) => {
      const t = 1 / (1 + 0.3275911 * Math.abs(x));
      const y =
        1 -
        ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
          t *
          Math.exp(-x * x);
      return x < 0 ? -y : y;
    };
    const z = (q: number) => {
      let [lo, hi] = [-10, 10];
      for (let k = 0; k < 60; k++) {
        const mid = (lo + hi) / 2;
        if (0.5 * (1 + erf(mid / Math.SQRT2)) < q) lo = mid;
        else hi = mid;
      }
      return lo;
    };
    const bins = new Array<number>(64).fill(0);
    for (let i = 0; i < n; i++) {
      const v = median * Math.exp(sigma * z((i + 0.5) / n));
      const b = Math.min(63, Math.max(0, Math.floor((Math.log2(v) + 10) * 2)));
      bins[b] = (bins[b] ?? 0) + 1;
    }
    const exact = median * Math.exp(sigma * z(0.99));
    expect(strandLevel(bins, n) / exact).toBeGreaterThan(0.97);
    expect(strandLevel(bins, n) / exact).toBeLessThan(1.03);
  });
});

describe('scentLevel', () => {
  it('reads the grid up to 2 cells per pixel, then maps of 2, 4 and 8 cells', () => {
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
