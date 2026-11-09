import { describe, expect, it } from 'vitest';
import { hexToLinear, oklchToHex } from './color';

describe('color', () => {
  it('converts sRGB hex to linear light', () => {
    expect(hexToLinear('#000000')).toEqual([0, 0, 0]);
    expect(hexToLinear('#ffffff')).toEqual([1, 1, 1]);
    expect(hexToLinear('#808080')[0]).toBeCloseTo(0.21586, 5);
  });

  it('maps OKLCH white, black and a known red', () => {
    expect(oklchToHex(1, 0, 0)).toBe('#ffffff');
    expect(oklchToHex(0, 0, 0)).toBe('#000000');
    expect(oklchToHex(0.628, 0.2577, 29.23)).toBe('#ff0000');
  });
});
