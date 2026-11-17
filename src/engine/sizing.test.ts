import { describe, expect, it } from 'vitest';
import { defaultSettings, defaultStrain, type Settings } from '../model/params';
import {
  agentCount,
  BYTES_PER_AGENT,
  BYTES_PER_CELL,
  BYTES_PER_CELL_HALF_FLOAT,
  capacityCount,
  diffusePlan,
  diffusePlanOf,
  estimateBytes,
  fitResolution,
  FLOW_BYTES_PER_CELL,
  flowBytesPerCell,
  SITE_BYTES_PER_CELL,
  gridSize,
  memoryBudget,
  SLIME_BYTES_PER_CELL,
  slimeBytesPerCell,
  TUBE_MAP_BYTES_PER_CELL_GL,
  tubesBytesPerCell,
  VIEW_BYTES_PER_CELL,
  viewTrailOn,
  type Limits,
} from './sizing';

const roomy: Limits = { maxAgents: 2 ** 24, maxBufferBytes: 2 ** 30, maxGridSide: 8192, budget: memoryBudget(8) };

describe('agentCount', () => {
  it('counts a dish over the square of the short side, as Jones counts %p (p. 134, p. 147)', () => {
    // Jones: %p 50 on a 300 × 300 lattice is 45,000 agents; his dish spans 0.945 of its side (ADR 0027).
    expect(agentCount({ density: 0.5, boundary: 'dish' }, 300, 300)).toBe(45_000);
    // Shrinking plasmodium on 512 × 320: 0.71 agents per cell of the dish, not 1.13 as with every cell of the grid.
    expect(agentCount({ density: 0.5, boundary: 'dish' }, 512, 320)).toBe(51_200);
    expect(agentCount({ density: 0.5, boundary: 'dish' }, 320, 512)).toBe(51_200);
  });

  it('counts every cell of a box or a periodic grid', () => {
    expect(agentCount({ density: 0.5, boundary: 'box' }, 512, 320)).toBe(81_920);
    expect(agentCount({ density: 3, boundary: 'wrap' }, 1536, 960)).toBe(4_423_680);
  });

  it('is what the memory estimate counts', () => {
    const s = { ...defaultSettings(), boundary: 'dish' as const, density: 8, resolution: 4096 };
    // A dish needs fewer agents than the grid's cells would get, so it fits a larger grid on a tight budget.
    const budget = estimateBytes(2048, 1280, 8 * 1280 * 1280);
    expect(fitResolution(s, 1.6, { ...roomy, budget })).toBe(2048);
    expect(fitResolution({ ...s, boundary: 'box' }, 1.6, { ...roomy, budget })).toBeLessThan(2048);
  });
});

describe('memory budget', () => {
  it('is an eighth of device memory, at most 1 GiB, 512 MiB when unknown', () => {
    expect(memoryBudget(2)).toBe(2 ** 28);
    expect(memoryBudget(16)).toBe(2 ** 30);
    expect(memoryBudget()).toBe(2 ** 29);
  });

  it('lowers the grid of a hostile link until it fits', () => {
    const s = { ...defaultSettings(), resolution: 4096, density: 8 };
    const r = fitResolution(s, 16 / 10, { ...roomy, budget: memoryBudget(4) });
    expect(r).toBeLessThan(4096);
    const [w, h] = [r, Math.round(r / 1.6)];
    expect(estimateBytes(w, h, Math.min(2 ** 24, 8 * w * h))).toBeLessThanOrEqual(memoryBudget(4));
  });

  it('keeps settings that fit', () => {
    expect(fitResolution(defaultSettings(), 16 / 10, roomy)).toBe(1536);
  });

  it('counts the bytes per cell of the backend', () => {
    const s = defaultSettings();
    const [w, h] = gridSize(s.resolution, 16 / 10);
    const budget = estimateBytes(w, h, s.density * w * h, BYTES_PER_CELL); // 1536 just fits at BYTES_PER_CELL (102 B)
    expect(fitResolution(s, 16 / 10, { ...roomy, budget })).toBe(s.resolution);
    const halfFloat = { ...roomy, budget, bytesPerCell: BYTES_PER_CELL_HALF_FLOAT };
    expect(fitResolution(s, 16 / 10, halfFloat)).toBeLessThan(s.resolution);
  });

  it('respects the per-buffer and texture-size limits of small devices', () => {
    const s = { ...defaultSettings(), resolution: 4096, density: 0.1 };
    const r = fitResolution(s, 16 / 9, { ...roomy, maxBufferBytes: 2 ** 27, budget: 2 ** 30 });
    const [w, h] = [r, Math.round(r / (16 / 9))];
    expect(w * h * 16).toBeLessThanOrEqual(2 ** 27);
    expect(fitResolution(s, 1, { ...roomy, maxGridSide: 2048 })).toBeLessThanOrEqual(2048);
  });
});

describe('capacity (ADR 0025)', () => {
  it('holds the start population, or the capacity when it is higher, counted as agentCount() counts', () => {
    const s = { ...defaultSettings(), density: 0.12, boundary: 'box' as const };
    expect(capacityCount(s, 512, 320)).toBe(agentCount(s, 512, 320));
    expect(capacityCount({ ...s, capacity: 1 }, 512, 320)).toBe(512 * 320);
    expect(capacityCount({ ...s, capacity: 0.5, boundary: 'dish' }, 512, 320)).toBe(0.5 * 320 * 320);
  });

  it('is what the memory estimate counts, with the bytes of growth while it is on', () => {
    const s = { ...defaultSettings(), density: 0.05, capacity: 1, collisions: true, resolution: 2048 };
    const [w, h] = gridSize(2048, 1.6);
    const budget = estimateBytes(w, h, w * h);
    expect(fitResolution(s, 1.6, { ...roomy, budget })).toBe(2048);
    // With the rule a capacity of 2 holds one agent per cell (capacityOf()); without it, two.
    expect(fitResolution({ ...s, capacity: 2 }, 1.6, { ...roomy, budget })).toBe(2048);
    expect(fitResolution({ ...s, capacity: 2, collisions: false }, 1.6, { ...roomy, budget })).toBeLessThan(2048);
    const growth = { ...roomy, budget, bytesPerCell: BYTES_PER_CELL + 34, bytesPerAgent: BYTES_PER_AGENT + 6 };
    expect(fitResolution(s, 1.6, growth)).toBeLessThan(2048);
  });
});

// ADR 0027: the view of a step that moves first needs a third trail and scent from two diffusion passes on.
describe('the view of a step that moves first', () => {
  it('needs a third trail and scent of 24 B per cell only from two passes on', () => {
    expect(VIEW_BYTES_PER_CELL).toBe(24);
    const extended = { model: 'extended', meanWindow: 3 } as const;
    for (const diffusion of [0, 1, 2, 3, 4]) {
      expect(viewTrailOn({ ...extended, stepOrder: 'move-first', diffusion }), `${diffusion}`).toBe(diffusion >= 2);
      expect(viewTrailOn({ ...extended, stepOrder: 'sense-first', diffusion }), `${diffusion}`).toBe(false);
    }
    expect(viewTrailOn(defaultSettings())).toBe(false);
  });

  // ADR 0046: a mean window above 3 × 3 runs two dispatches per pass, so its view needs the third pair with one pass.
  it('needs them with one pass and a mean window above 3 × 3, in the Jones model only', () => {
    const jones = { model: 'jones', diffusion: 1 } as const;
    for (const meanWindow of [3, 5, 15]) {
      expect(viewTrailOn({ ...jones, stepOrder: 'move-first', meanWindow }), `${meanWindow}`).toBe(meanWindow > 3);
      expect(viewTrailOn({ ...jones, stepOrder: 'sense-first', meanWindow }), `${meanWindow}`).toBe(false);
      const extended = { model: 'extended', diffusion: 1, stepOrder: 'move-first', meanWindow } as const;
      expect(viewTrailOn(extended), `extended, ${meanWindow}`).toBe(false);
    }
  });
});

// ADR 0046: the dispatches of a step. The window of 3 keeps the plan of the code before, object for object.
describe('diffusePlanOf', () => {
  it('runs one dispatch per pass with the 3 × 3 mean, as before', () => {
    for (const diffusion of [0, 1, 2, 3, 4]) {
      const plan = diffusePlanOf({ model: 'extended', diffusion, meanWindow: 3 });
      expect(plan, `${diffusion}`).toEqual(diffusePlan(diffusion));
      expect(plan.some((v) => v.box)).toBe(false);
      expect(diffusePlanOf({ model: 'extended', diffusion, meanWindow: 9 })).toEqual(plan);
      expect(diffusePlanOf({ model: 'jones', diffusion, meanWindow: 3 })).toEqual(plan);
    }
    expect(diffusePlan(1)).toEqual([{ first: true, last: true, blur: true }]);
  });

  it('runs the rows and then the columns of a window above 3 × 3, the sources first and the decay last', () => {
    expect(diffusePlanOf({ model: 'jones', diffusion: 1, meanWindow: 5 })).toEqual([
      { first: true, last: false, blur: true, box: { radius: 2, columns: false } },
      { first: false, last: true, blur: true, box: { radius: 2, columns: true } },
    ]);
    const two = diffusePlan(2, 15);
    expect(two.map((v) => [v.first, v.last, v.box?.radius, v.box?.columns])).toEqual([
      [true, false, 7, false],
      [false, false, 7, true],
      [false, false, 7, false],
      [false, true, 7, true],
    ]);
    // Without diffusion there is no window.
    expect(diffusePlan(0, 15)).toEqual(diffusePlan(0));
  });
});

// ADR 0029: the flow in the tubes holds the memory of each cell twice and the pressure of its four fields three times.
describe('the flow in the tubes', () => {
  it('holds five textures of 16 B per cell, which the memory estimate counts per cell', () => {
    expect(FLOW_BYTES_PER_CELL).toBe(5 * 16);
    const [w, h] = gridSize(512, 1.6);
    const without = estimateBytes(w, h, 1000);
    expect(estimateBytes(w, h, 1000, BYTES_PER_CELL + FLOW_BYTES_PER_CELL) - without).toBe(w * h * FLOW_BYTES_PER_CELL);
    // The Tokyo scene on its lattice: 20 MiB more.
    expect((512 * 512 * FLOW_BYTES_PER_CELL) / 2 ** 20).toBe(20);
  });

  // ADR 0031: every strain has a flow of its own, with textures of its own.
  it('counts the textures of every strain, and none while the flow is off or the model is Jones’', () => {
    const strains = (n: number) => Array.from({ length: n }, (_, i) => defaultStrain(i));
    const on = { ...defaultSettings(), model: 'extended' as const, flow: true };
    // The cells of the food sites once for all strains (ADR 0029, decision 17).
    expect(SITE_BYTES_PER_CELL).toBe(4);
    expect(flowBytesPerCell({ ...on, strains: strains(1) })).toBe(84);
    expect(flowBytesPerCell({ ...on, strains: strains(3) })).toBe(244);
    expect(flowBytesPerCell({ ...on, strains: strains(4) })).toBe(324);
    expect(flowBytesPerCell({ ...on, flow: false, strains: strains(3) })).toBe(0);
    expect(flowBytesPerCell({ ...on, model: 'jones', strains: strains(1) })).toBe(0);
  });

  // ADR 0034: the picture of the tubes has three textures of 16 B per cell. Its switch changes only the view, so the
  // memory counts them with the flow, whatever the switch says: the switch must not change the grid that fits.
  it('counts the picture of the tubes while the flow is on, with its switch on or off', () => {
    const on = { ...defaultSettings(), model: 'extended' as const, flow: true };
    // Three textures of 16 B per cell: the factors of the radius, the picture and the stream of the plasm.
    expect(tubesBytesPerCell(on)).toBe(48);
    const off = { ...on, showTubes: false };
    expect(tubesBytesPerCell(off)).toBe(48);
    // WebGL2 holds the map of the tiles too, 4 B per tile of 8 × 8 cells, and its rows, 4 B per 8 cells (amendment of
    // 2026-11-15): its backend adds them, only while the flow is on.
    expect(TUBE_MAP_BYTES_PER_CELL_GL).toBe(0.5625);
    expect(tubesBytesPerCell(on, TUBE_MAP_BYTES_PER_CELL_GL)).toBe(48.5625);
    expect(tubesBytesPerCell({ ...on, flow: false }, TUBE_MAP_BYTES_PER_CELL_GL)).toBe(0);
    expect(tubesBytesPerCell({ ...on, flow: false })).toBe(0);
    expect(tubesBytesPerCell({ ...on, model: 'jones' })).toBe(0);
  });
});

// ADR 0058: the outline distances of the electrodes are 4 B per cell on both backends. The fit counts them from the
// start, with a pole or without one, so that a stroke of a pole never changes the grid.
describe('the outline distances of the electrodes', () => {
  it('are 4 of the bytes per cell of every backend', () => {
    // 98 and 118 before them (ADR 0047).
    expect(BYTES_PER_CELL).toBe(102);
    expect(BYTES_PER_CELL_HALF_FLOAT).toBe(122);
    // On 2048 × 1280 cells they are 10 MiB.
    const [w, h] = gridSize(2048, 1.6);
    expect(estimateBytes(w, h, 1000, BYTES_PER_CELL) - estimateBytes(w, h, 1000, 98)).toBe(10 * 2 ** 20);
  });
});

// ADR 0055, decision 9, ADR 0057 and ADR 0059: per cell the slime field holds a stamp, an amount and a front stamp of
// 4 B each, and the renderer holds the maps of the film, 2.5 B, and the map of the growth front, 8 B per texel of 64
// cells, on both backends: 14.6 B, counted as 15.
describe('the slime field', () => {
  it('holds 15 B per cell with its picture, which the memory estimate counts per cell', () => {
    expect(SLIME_BYTES_PER_CELL).toBe(15);
    expect(SLIME_BYTES_PER_CELL).toBe(Math.ceil(4 + 4 + 4 + 2 + 2 / 4 + 8 / 64));
    const [w, h] = gridSize(1536, 1.6);
    const without = estimateBytes(w, h, 1000);
    expect(estimateBytes(w, h, 1000, BYTES_PER_CELL + SLIME_BYTES_PER_CELL) - without).toBe(w * h * 15);
    // The grid of the default settings: 21.1 MiB more.
    expect((w * h * SLIME_BYTES_PER_CELL) / 2 ** 20).toBeCloseTo(21.094, 3);
  });

  // The setting changes no grid: the fit counts the field in the extended model with slime and without it.
  it('is counted in the extended model with a life time above 0 and with 0, and not in the Jones model', () => {
    const extended: Settings = { ...defaultSettings(), model: 'extended' };
    expect(extended.slimeLife).toBe(144);
    expect(slimeBytesPerCell(extended)).toBe(15);
    // Without slime, with the longest life time, and with the flow.
    const others: Settings[] = [
      { ...extended, slimeLife: 0 },
      { ...extended, slimeLife: 240 },
      { ...extended, flow: true },
    ];
    for (const s of others) expect(slimeBytesPerCell(s), `${String(s.slimeLife)} h`).toBe(15);
    expect(slimeBytesPerCell({ model: 'jones' })).toBe(0);
  });

  it('lowers a grid that just fits without it', () => {
    const s = defaultSettings();
    const [w, h] = gridSize(s.resolution, 16 / 10);
    const budget = estimateBytes(w, h, s.density * w * h, BYTES_PER_CELL);
    const limits = { ...roomy, budget };
    expect(fitResolution(s, 16 / 10, limits)).toBe(s.resolution);
    const withSlime = { ...limits, bytesPerCell: BYTES_PER_CELL + slimeBytesPerCell(s) };
    expect(fitResolution(s, 16 / 10, withSlime)).toBeLessThan(s.resolution);
    // The bytes of the field and its picture and no more: the budget with 15 B more per cell holds the grid again.
    const more = { ...withSlime, budget: budget + w * h * SLIME_BYTES_PER_CELL };
    expect(fitResolution(s, 16 / 10, more)).toBe(s.resolution);
  });
});
