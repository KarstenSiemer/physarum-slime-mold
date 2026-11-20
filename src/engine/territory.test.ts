// The constants of the territory (ADR 0068): when the rules of stage 4 run, and the chances of the push in the
// uniform block of the flow.
import { describe, expect, it } from 'vitest';
import { defaultSettings, type Settings } from '../model/params';
import { FLOW_BYTES, FLOW_TERRITORY_SLOT, packFlow } from './flow';
import { NO_SITES } from './sites';
import { packTerritory, PUSH_CHANCES, TERRITORY, territoryOn } from './territory';

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

  it('writes the chances after the sites of the uniform block of the flow, and nothing else', () => {
    const plain = new Float32Array(packFlow(on, NO_SITES).slice(0));
    const f = new Float32Array(packTerritory(packFlow(on, NO_SITES)));
    expect(f.length * 4).toBe(FLOW_BYTES);
    const at = FLOW_TERRITORY_SLOT * 4;
    expect(Array.from(f.subarray(at, at + 8))).toEqual(PUSH_CHANCES);
    expect(Array.from(f.subarray(0, at))).toEqual(Array.from(plain.subarray(0, at)));
    // packFlow() clears the slots of stage 4.
    expect(plain.subarray(at).every((v) => v === 0)).toBe(true);
  });
});
