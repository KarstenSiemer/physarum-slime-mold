import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../model/params';
import { estimateBytes, fitResolution, memoryBudget, type Limits } from './sizing';

const roomy: Limits = { maxAgents: 2 ** 24, maxBufferBytes: 2 ** 30, maxGridSide: 8192, budget: memoryBudget(8) };

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

  it('respects the per-buffer and texture-size limits of small devices', () => {
    const s = { ...defaultSettings(), resolution: 4096, density: 0.1 };
    const r = fitResolution(s, 16 / 9, { ...roomy, maxBufferBytes: 2 ** 27, budget: 2 ** 30 });
    const [w, h] = [r, Math.round(r / (16 / 9))];
    expect(w * h * 16).toBeLessThanOrEqual(2 ** 27);
    expect(fitResolution(s, 1, { ...roomy, maxGridSide: 2048 })).toBeLessThanOrEqual(2048);
  });
});
