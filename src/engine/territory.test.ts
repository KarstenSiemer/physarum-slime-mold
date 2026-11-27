// The constants of the territory (ADR 0068): when the rules of stage 4 run, and the chances of the push in the
// uniform block of the flow; and the corner rule of the push in the CPU copy (ADR 0069).
import { describe, expect, it } from 'vitest';
import { defaultSettings, type Settings } from '../model/params';
import { FLOW_BYTES, FLOW_SINK_SLOT, FLOW_TERRITORY_SLOT, packFlow } from './flow';
import { NO_SITES } from './sites';
import { packTerritory, PUSH_CHANCES, TERRITORY, territoryOn } from './territory';
import { push } from './territory-reference';

describe('the territory (ADR 0068)', () => {
  const on: Settings = { ...defaultSettings(), territory: true, flow: true, growth: true, collisions: true };

  it('runs with the setting only in the extended model with growth, one agent per cell and the flow', () => {
    expect(defaultSettings().territory).toBe(false);
    expect(territoryOn(on)).toBe(true);
    const off: Partial<Settings>[] = [
      { territory: false },
      { flow: false },
      { growth: false },
      { collisions: false },
      { model: 'jones' },
    ];
    for (const patch of off) expect(territoryOn({ ...on, ...patch }), JSON.stringify(patch)).toBe(false);
  });

  it('pushes a cell in with the chance 1 − (1 − 0.004)^n for n agents beside it, as float32', () => {
    expect(TERRITORY.speed).toBe(0.004);
    expect(TERRITORY.rim).toBe(3);
    expect(PUSH_CHANCES).toHaveLength(8);
    PUSH_CHANCES.forEach((p, k) => {
      expect(p).toBe(Math.fround(p));
      expect(p).toBeCloseTo(1 - 0.996 ** (k + 1), 7);
    });
    // One agent pushes with the speed, eight with a little less than eight times it.
    expect(PUSH_CHANCES[0]).toBe(Math.fround(0.004));
    expect(PUSH_CHANCES[7]).toBeCloseTo(0.03156, 5);
  });

  it('writes the chances and the constants of the sinks after the sites of the uniform block of the flow', () => {
    const plain = new Float32Array(packFlow(on, NO_SITES).slice(0));
    const f = new Float32Array(packTerritory(packFlow(on, NO_SITES), on));
    expect(f.length * 4).toBe(FLOW_BYTES);
    const at = FLOW_TERRITORY_SLOT * 4;
    expect(Array.from(f.subarray(at, at + 8))).toEqual(PUSH_CHANCES);
    expect(FLOW_SINK_SLOT * 4).toBe(at + 8);
    // The steps of a path to ground without slime and to the edge, of the mean, and the weight on slime (sinks.ts);
    // then what the sinks take, in units of the flow strength (ADR 0070), and the growth of the budget of the paid
    // births in a step, 2 · I0 / 20 (ADR 0071).
    const growth = Math.fround((2 * on.flowStrength) / 20);
    expect(Array.from(f.subarray(at + 8))).toEqual([6, 2, 100, 419430, 2, growth, 0, 0]);
    expect(Array.from(f.subarray(0, at))).toEqual(Array.from(plain.subarray(0, at)));
    // packFlow() clears the slots of stage 4.
    expect(plain.subarray(at).every((v) => v === 0)).toBe(true);
  });

  it('pushes no cell from a diagonal neighbour between two walls, as no move or birth passes there', () => {
    // An agent of strain 0 at (1, 1) and the walls (2, 1) and (1, 2): the cell (2, 2) has the agent as its diagonal
    // neighbour across their corner. The territory holds every other cell, so only (2, 2) could join.
    const [w, h] = [4, 4];
    const env = new Uint8Array(w * h * 4);
    for (const c of [1 * w + 2, 2 * w + 1]) env[c * 4] = 255;
    const g = { w, h, boundary: 'box' as const, env };
    const owned = new Uint8Array(w * h);
    owned[1 * w + 1] = 1;
    const before = new Uint8Array(w * h).fill(1);
    before[2 * w + 2] = 0;
    const joins = () => {
      let n = 0;
      for (let step = 0; step < 2000; step++) if ((push(before, owned, g, step, 5)[2 * w + 2] ?? 0) & 1) n++;
      return n;
    };
    expect(joins()).toBe(0);
    // With one of the walls gone the agent counts, and the cell joins with the chance 0.004 per step.
    env[(1 * w + 2) * 4] = 0;
    expect(joins()).toBeGreaterThan(2);
  });
});
