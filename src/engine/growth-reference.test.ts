// The order of the births (place() in growth.wgsl and growth.glsl; the CPU copy equals both, bit for bit, by the
// CPU-copy test in sim.gpu.test.ts). ADR 0025, decision 9.
import { describe, expect, it } from 'vitest';
import { place } from './growth-reference';

describe('place(): the order of the births', () => {
  const sizes: [number, number][] = [
    [16, 16],
    [17, 16],
    [64, 48],
    [513, 287],
    [256, 160],
    [512, 288],
    [1023, 17],
    [16, 4096],
  ];

  it.each(sizes)('is a bijection of the cells of %i × %i, new for every step', (w, h) => {
    for (const step of [0, 3, 1001]) {
      const seen = new Uint8Array(w * h);
      for (let c = 0; c < w * h; c++) {
        const p = place(c, w, h, step, 7);
        expect(p >= 0 && p < w * h, `${c} → ${p}`).toBe(true);
        expect(seen[p], `step ${step}: ${c} → ${p}`).toBe(0);
        seen[p] = 1;
      }
    }
    expect(place(5, w, h, 0, 7)).not.toBe(place(5, w, h, 3, 7));
  });

  // When the dead agents run out, the births of the first positions get them: those must lie all over the grid, not in
  // the rows from the top.
  it.each(sizes.filter(([w, h]) => w >= 64 && h >= 64))('spreads the first tenth of %i × %i over the grid', (w, h) => {
    for (const step of [0, 9]) {
      const first = Array.from({ length: w * h }, (_, c) => c).filter((c) => place(c, w, h, step, 7) < (w * h) / 10);
      for (const [axis, side] of [
        [(c: number) => Math.floor(c / w), h],
        [(c: number) => c % w, w],
      ] as const) {
        const quarters = [0, 0, 0, 0];
        for (const c of first) {
          const q = Math.min(3, Math.floor((4 * axis(c)) / side));
          quarters[q] = (quarters[q] ?? 0) + 1;
        }
        for (const q of quarters) expect(q / first.length).toBeGreaterThan(0.2);
      }
    }
  });
});
