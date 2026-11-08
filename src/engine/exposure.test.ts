import { describe, expect, it } from 'vitest';
import { levelAbove, levels } from './exposure';

const bin = (b: number) => 2 ** ((b + 0.5) / 2 - 10);

describe('auto levels', () => {
  it('finds the level that only 1 % of the cells exceed', () => {
    const bins = new Array<number>(64).fill(0);
    bins[20] = 980;
    bins[40] = 20;
    expect(levelAbove(bins, 1000, 0.01)).toBeCloseTo(bin(40));
  });

  it('counts empty cells as dark', () => {
    const bins = new Array<number>(64).fill(0);
    bins[30] = 50; // only 5 % of the cells hold trail
    expect(levelAbove(bins, 1000, 0.01)).toBeCloseTo(bin(30));
    expect(levels(bins, 1000)?.black).toBe(0);
  });

  it('puts black at the 65th percentile of a dense field', () => {
    const bins = new Array<number>(64).fill(0);
    bins[24] = 700; // lacunae
    bins[34] = 300; // network
    const l = levels(bins, 1000);
    expect(l?.black).toBeCloseTo(bin(24));
    expect(l?.gain).toBeCloseTo(1.3 / (bin(34) - bin(24)));
  });

  it('keeps the old levels for an empty field', () => {
    expect(levels(new Array<number>(64).fill(0), 1000)).toBeUndefined();
  });
});
