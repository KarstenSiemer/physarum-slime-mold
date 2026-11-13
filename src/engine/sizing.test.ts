import { describe, expect, it } from 'vitest';
import { defaultSettings, defaultStrain } from '../model/params';
import {
  agentCount,
  BYTES_PER_AGENT,
  BYTES_PER_CELL,
  BYTES_PER_CELL_HALF_FLOAT,
  capacityCount,
  estimateBytes,
  fitResolution,
  FLOW_BYTES_PER_CELL,
  flowBytesPerCell,
  gridSize,
  memoryBudget,
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
    const budget = estimateBytes(w, h, s.density * w * h, BYTES_PER_CELL); // 1536 just fits at BYTES_PER_CELL (98 B)
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
    for (const diffusion of [0, 1, 2, 3, 4]) {
      expect(viewTrailOn({ stepOrder: 'move-first', diffusion }), `${diffusion}`).toBe(diffusion >= 2);
      expect(viewTrailOn({ stepOrder: 'sense-first', diffusion }), `${diffusion}`).toBe(false);
    }
    expect(viewTrailOn(defaultSettings())).toBe(false);
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
    expect(flowBytesPerCell({ ...on, strains: strains(1) })).toBe(80);
    expect(flowBytesPerCell({ ...on, strains: strains(3) })).toBe(240);
    expect(flowBytesPerCell({ ...on, strains: strains(4) })).toBe(320);
    expect(flowBytesPerCell({ ...on, flow: false, strains: strains(3) })).toBe(0);
    expect(flowBytesPerCell({ ...on, model: 'jones', strains: strains(1) })).toBe(0);
  });
});
