import { describe, expect, it } from 'vitest';
import { levelAbove, levels, PLASM_EDGE, plasmLevel } from './exposure';

const bin = (b: number) => 2 ** ((b + 0.5) / 2 - 10);
/** The low edge of bin `b`: the high edge of the bin below it. */
const edge = (b: number) => 2 ** (b / 2 - 10);
const empty = () => new Array<number>(64).fill(0);

describe('auto levels', () => {
  it('finds the level that only 1 % of the cells exceed', () => {
    const bins = new Array<number>(64).fill(0);
    bins[20] = 980;
    bins[40] = 20;
    expect(levelAbove(bins, 1000, 0.01)).toBeCloseTo(bin(40));
  });

  it('counts empty cells as dark', () => {
    const bins = new Array<number>(64).fill(0);
    bins[30] = 50; // only 5 % of the cells hold trail
    expect(levelAbove(bins, 1000, 0.01)).toBeCloseTo(bin(30));
    expect(levels(bins, 1000)?.black).toBe(0);
  });

  it('puts black at the 65th percentile of a dense field', () => {
    const bins = new Array<number>(64).fill(0);
    bins[24] = 700; // lacunae
    bins[34] = 300; // network
    const l = levels(bins, 1000);
    expect(l?.black).toBeCloseTo(bin(24));
    expect(l?.gain).toBeCloseTo(1.3 / (bin(34) - bin(24)));
  });

  it('keeps the old levels for an empty field', () => {
    expect(levels(new Array<number>(64).fill(0), 1000)).toBeUndefined();
  });
});

// With one agent per cell the agents are the plasm (ADR 0062). `held` is the histogram of the trail over the cells
// that hold an agent.
describe('the black level below the plasm', () => {
  it('reads the median of the trail of the cells that hold an agent within its bin', () => {
    const held = empty();
    held[30] = 100;
    const median = plasmLevel(held);
    expect(median).toBeGreaterThanOrEqual(edge(30));
    expect(median).toBeLessThanOrEqual(edge(31));
    // More than half of the agents hold more: the median lies in their bin.
    held[36] = 101;
    expect(plasmLevel(held)).toBeGreaterThanOrEqual(edge(36));
    expect(plasmLevel(held)).toBeLessThanOrEqual(edge(37));
    expect(plasmLevel(empty())).toBeUndefined();
  });

  it('keeps the black level at half the trail under the agents where a sheet covers most of the grid', () => {
    // A sheet on 80 % of the cells: the 65th percentile lies inside it.
    const bins = empty();
    bins[34] = 800;
    bins[20] = 200;
    const held = empty();
    held[34] = 300;
    const without = levels(bins, 1000);
    const l = levels(bins, 1000, held);
    // Without the agents the black level is 0.8 of the white level: it cuts most of the sheet.
    expect(without?.black).toBeCloseTo(0.8 * bin(34));
    // Half of the median trail under the agents: at the edge of a band of plasm the trail is half of the trail inside.
    expect(PLASM_EDGE).toBe(0.5);
    expect(l?.black).toBe(0.5 * (plasmLevel(held) ?? NaN));
    expect(l?.black).toBeLessThanOrEqual(0.5 * edge(35));
    expect(l?.black).toBeGreaterThanOrEqual(0.5 * edge(34));
    // The gain maps the range above the new black level to the same radiance.
    expect(l?.gain).toBeCloseTo(1.3 / (bin(34) - (l?.black ?? NaN)));
  });

  it('keeps the 65th percentile where it lies below the plasm', () => {
    const bins = empty();
    bins[24] = 700; // lacunae
    bins[34] = 300; // network
    const held = empty();
    held[34] = 150;
    expect(levels(bins, 1000, held)).toEqual(levels(bins, 1000));
    expect(levels(bins, 1000, held)?.black).toBeCloseTo(bin(24));
  });

  it('counts an agent on a cell without trail: most agents there keep the black level near 0', () => {
    const bins = empty();
    bins[24] = 700;
    bins[34] = 300;
    const held = empty();
    held[0] = 100; // histogram.wgsl `held` counts a cell without trail in the lowest bin
    held[34] = 50;
    expect(levels(bins, 1000, held)?.black).toBeLessThanOrEqual(PLASM_EDGE * edge(1));
  });

  it('gives the levels of before while no cell holds an agent', () => {
    const bins = empty();
    bins[24] = 700;
    bins[34] = 300;
    expect(levels(bins, 1000, empty())).toEqual(levels(bins, 1000));
  });
});
