import { describe, expect, it } from 'vitest';
import {
  levelAbove,
  levels,
  measureSoon,
  PLASM_EDGE,
  plasmLevel,
  smooth,
  STRAND_BLEND,
  strandLevel,
  whiteFloor,
} from './exposure';

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

// A colony on less than 1 % of the grid: the 99th percentile lies on the faint trail around it (ADR 0090). `held` is
// the histogram of the trail over the cells that hold an agent.
describe('the floor of the white level', () => {
  /** 100,000 cells: 2,000 hold a faint trail (bin 2), and 300 agents hold the plasm (bin 30). */
  const colony = () => {
    const bins = empty();
    bins[2] = 2000;
    bins[30] = 300;
    const held = empty();
    held[30] = 300;
    return { bins, held };
  };

  it('keeps the white level at the median trail of the cells that hold an agent', () => {
    const { bins, held } = colony();
    // Without the floor the white level lies on the faint trail, and the gain is a thousand times too high.
    expect(levels(bins, 100_000)?.gain).toBeCloseTo(1.3 / bin(2));
    const l = levels(bins, 100_000, held);
    expect(whiteFloor(held)).toBe(plasmLevel(held));
    expect(l?.white).toBe(whiteFloor(held));
    expect(l?.black).toBe(0);
    expect(l?.gain).toBeCloseTo(1.3 / (plasmLevel(held) ?? NaN));
    // The measure of ADR 0090: the gain times the median trail under an agent.
    expect((l?.gain ?? NaN) * (plasmLevel(held) ?? NaN)).toBeLessThanOrEqual(2.6);
  });

  it('gives levels from the floor alone while fewer than 1 % of the cells hold trail', () => {
    const bins = empty();
    bins[30] = 300;
    const held = empty();
    held[30] = 300;
    expect(levels(bins, 100_000)).toBeUndefined();
    expect(levels(bins, 100_000, held)?.white).toBe(plasmLevel(held));
  });

  it('does not count while most of the agents hold no trail', () => {
    // The step of an inoculation: the agents of the tool deposit nothing in it.
    const { bins } = colony();
    const held = empty();
    held[0] = 300;
    held[30] = 100;
    expect(whiteFloor(held)).toBe(0);
    expect(levels(bins, 100_000, held)?.gain).toBeCloseTo(1.3 / bin(2));
    expect(levels(empty(), 100_000, held)).toBeUndefined();
    expect(whiteFloor(empty())).toBe(0);
    expect(whiteFloor()).toBe(0);
  });

  it('keeps the 99th percentile where it lies above the floor', () => {
    const bins = empty();
    bins[24] = 700;
    bins[30] = 150;
    bins[34] = 150;
    const held = empty();
    held[30] = 150;
    expect(whiteFloor(held)).toBeLessThan(edge(31));
    expect(levels(bins, 1000, held)?.white).toBeCloseTo(bin(34));
    expect(levels(bins, 1000, held)).toEqual(levels(bins, 1000));
  });

  it('holds without the rule too, where the black level keeps the 65th percentile', () => {
    // Agents share cells: the cells that an agent moved into. A dense field: 0.8 of the white level is black.
    const bins = empty();
    bins[20] = 200;
    bins[34] = 800;
    const held = empty();
    held[34] = 300;
    expect(levels(bins, 1000, held, false)).toEqual(levels(bins, 1000));
    const { bins: small, held: plasm } = colony();
    expect(levels(small, 100_000, plasm, false)?.white).toBe(plasmLevel(plasm));
  });

  it('puts the strand of the scent view on the floor too', () => {
    const { bins, held } = colony();
    expect(strandLevel(bins, 100_000)).toBeLessThan(edge(3));
    expect(strandLevel(bins, 100_000, whiteFloor(held))).toBe(plasmLevel(held));
  });

  it('holds the floor in the frames at once, and brightens them slowly', () => {
    const now = { gain: 1, black: 0, strand: 2 };
    // The white level of the frames is 1.3; the colony's plasm holds 5.
    const dark = { gain: 1.3 / 5, black: 0, strand: 5, white: 5, floor: 5 };
    expect(smooth(now, dark, 0.25)).toEqual({ gain: dark.gain, black: 0, strand: 5 });
    // A measurement that brightens the frames: a quarter of the way, and the strand a tenth.
    const bright = { gain: 2, black: 0.1, strand: 1, white: 0.75, floor: 0.5 };
    const s = smooth(now, bright, 0.25);
    expect(s.gain).toBeCloseTo(1.25);
    expect(s.black).toBeCloseTo(0.025);
    expect(s.strand).toBeCloseTo(2 - STRAND_BLEND);
    expect(smooth(now, bright, 1)).toEqual({ gain: 2, black: 0.1, strand: 1 });
    // A measurement between two turns only holds the floor.
    expect(smooth(now, bright, 0)).toEqual(now);
    expect(smooth(now, dark, 0)).toEqual({ gain: dark.gain, black: 0, strand: 5 });
  });

  it('brightens a colony whose floor sets the white level no higher than the fixed gain', () => {
    // The first steps of a colony: its trail is still small, and grows by up to 2.6 times from frame to frame.
    const now = { gain: 0.8, black: 0, strand: 0.5 };
    const young = { gain: 1.3 / 0.4, black: 0, strand: 0.4, white: 0.4, floor: 0.4 };
    expect(smooth(now, young, 0.25, 0.8).gain).toBe(0.8);
    expect(smooth(now, young, 0.25).gain).toBeCloseTo(0.8 + 0.25 * (young.gain - 0.8));
    // Where the 99th percentile lies above the floor, the levels of before.
    expect(smooth(now, { ...young, white: 0.5 }, 0.25, 0.8).gain).toBeCloseTo(0.8 + 0.25 * (young.gain - 0.8));
  });

  it('measures in every frame while the floor sets the white level or nothing was measured', () => {
    expect(measureSoon(undefined)).toBe(true);
    expect(measureSoon({ gain: 0.26, black: 0, strand: 5, white: 5, floor: 5 })).toBe(true);
    expect(measureSoon({ gain: 0.1, black: 0, strand: 13, white: 13, floor: 5 })).toBe(false);
  });
});
