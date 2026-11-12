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
      let fault = '';
      for (let c = 0; c < w * h && !fault; c++) {
        const p = place(c, w, h, step, 7);
        if (!(p >= 0 && p < w * h)) fault = `${c} → ${p}: outside the grid`;
        else if (seen[p]) fault = `${c} → ${p}: taken twice`;
        else seen[p] = 1;
      }
      // One expect per step: one per cell took 1.8 s of the 5 s limit on 512 × 288 (ADR 0010).
      expect(fault, `step ${step}`).toBe('');
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
