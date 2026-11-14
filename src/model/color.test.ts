import { describe, expect, it } from 'vitest';
import { hexToLinear, linearToHex } from './color';

describe('color', () => {
  it('converts sRGB hex to linear light', () => {
    expect(hexToLinear('#000000')).toEqual([0, 0, 0]);
    expect(hexToLinear('#ffffff')).toEqual([1, 1, 1]);
    expect(hexToLinear('#808080')[0]).toBeCloseTo(0.21586, 5);
  });

  it('converts linear light back to sRGB hex, clamped', () => {
    expect(linearToHex([0, 0, 0])).toBe('#000000');
    expect(linearToHex([1, 1, 1])).toBe('#ffffff');
    expect(linearToHex([2, -1, 0])).toBe('#ff0000');
    for (const hex of ['#808080', '#f2c14e', '#3fc1c9']) expect(linearToHex(hexToLinear(hex))).toBe(hex);
  });
});
