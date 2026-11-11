import { describe, expect, it } from 'vitest';
import { SCENT_BANDS, SCENT_FILL, SCENT_LEVELS, SCENT_LINE, scentBands, scentOver } from './scent';

// The scale of the scent view (ADR 0009, amendment 2026-11-11). The GPU tests hold both render passes to these numbers.
describe('scentBands', () => {
  const flat = 1e-9; // a scent that hardly changes over a pixel
  const fill = (v: number) => scentBands(v, flat * v, 1)[0];
  const line = (v: number, slope = 0.01 * v) => scentBands(v, slope, 1)[1];

  it('draws nothing below 0.01, and nothing for no scent', () => {
    expect(scentBands(0, 0, 1)).toEqual([0, 0]);
    expect(scentBands(0.0099, 0, 1)).toEqual([0, 0]);
    expect(scentBands(-1, 1, 1)).toEqual([0, 0]);
  });

  it('steps the fill up once per power of ten, from 0.01 to the last band', () => {
    expect(SCENT_LEVELS).toEqual([0.01, 0.1, 1, 10, 100, 1000, 10000]);
    for (let k = 0; k < SCENT_BANDS; k++) {
      const want = SCENT_FILL[0] + SCENT_FILL[1] * k;
      expect(fill(3 * 10 ** (k - 2))).toBeCloseTo(want, 6);
    }
    expect(fill(3e9)).toBeCloseTo(SCENT_FILL[0] + SCENT_FILL[1] * (SCENT_BANDS - 1), 6);
  });

  it('draws a line at each power of ten and none between them', () => {
    for (const v of SCENT_LEVELS) expect(line(v)).toBeCloseTo(SCENT_LINE, 6);
    for (const v of [0.03, 3, 300, 30000]) expect(line(v)).toBe(0);
    expect(line(1e5)).toBe(0); // no line above the last band's start
  });

  // A pixel that spans many bands shows their mean fill, and no lines.
  it('filters the fill over the pixel and fades out crowded lines', () => {
    const steep = (v: number) => scentBands(v, v * Math.LN10 * 4, 1); // four powers of ten per pixel
    const [f, l] = steep(10);
    expect(l).toBe(0);
    expect(f).toBeCloseTo(SCENT_FILL[0] + SCENT_FILL[1] * 3, 1); // the mean of the bands from 0.1 to 1,000
    expect(scentBands(10, 10 * Math.LN10 * 0.2, 1)[1]).toBeCloseTo(SCENT_LINE, 6); // 5 pixels per band: full lines
  });

  it('puts each layer over the colour below with its fill and its line', () => {
    const c = [0.5, 0.5, 0.5] as const;
    expect(scentOver(c, 'glow', [0, 0], [0, 0])).toEqual(c);
    const food = scentOver(c, 'glow', [0.4, 0], [0, 0]);
    expect(food[1]).toBeGreaterThan(c[1]);
    expect(food[0]).toBeLessThan(c[0]);
    const paper = scentOver(c, 'paper', [0.4, 0], [0, 0]);
    expect(paper[1]).toBeLessThan(c[1]); // dark green over paper
  });
});
