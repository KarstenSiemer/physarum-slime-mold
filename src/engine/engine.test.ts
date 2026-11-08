import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../model/params';
import { diffusePlan, equilibrium, gridSize } from './sizing';

describe('gridSize', () => {
  it('puts the resolution on the long side', () => {
    expect(gridSize(1024, 2)).toEqual([1024, 512]);
    expect(gridSize(1024, 0.5)).toEqual([512, 1024]);
    expect(gridSize(1024, 1000)).toEqual([1024, 16]);
  });
});

describe('equilibrium', () => {
  it('is deposit × density / decay for one strain', () => {
    const s = defaultSettings();
    expect(equilibrium(s)).toBeCloseTo((5 * 1) / 0.1);
  });
});

describe('diffusePlan', () => {
  it('adds deposits on the first pass and decays on the last', () => {
    expect(diffusePlan(0)).toEqual([{ first: true, last: true, blur: false }]);
    expect(diffusePlan(1)).toEqual([{ first: true, last: true, blur: true }]);
    expect(diffusePlan(3).map((p) => [p.first, p.last])).toEqual([
      [true, false],
      [false, false],
      [false, true],
    ]);
  });
});
