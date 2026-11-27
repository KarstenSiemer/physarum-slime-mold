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
    const now = { gain: 1, black: 0, strand: 2, floor: 0, building: false };
    // The white level of the frames is 1.3; the colony's plasm holds 5.
    const dark = { gain: 1.3 / 5, black: 0, strand: 5, white: 5, floor: 5 };
    expect(smooth(now, dark, 0.25)).toMatchObject({ gain: dark.gain, black: 0, strand: 5, floor: 5 });
    // A measurement that brightens the frames: a quarter of the way, and the strand a tenth.
    const bright = { gain: 2, black: 0.1, strand: 1, white: 0.75, floor: 0.5 };
    const s = smooth(now, bright, 0.25);
    expect(s.gain).toBeCloseTo(1.25);
    expect(s.black).toBeCloseTo(0.025);
    expect(s.strand).toBeCloseTo(2 - STRAND_BLEND);
    expect(smooth(now, bright, 1)).toEqual({ gain: 2, black: 0.1, strand: 1, floor: 0.5, building: false });
    // A measurement between two turns only holds the floor.
    expect(smooth(now, bright, 0)).toEqual({ ...now, floor: 0.5 });
    expect(smooth(now, dark, 0)).toMatchObject({ gain: dark.gain, black: 0, strand: 5 });
  });

  /**
   * Plays the frames of a colony as WebGPU does in the floor phase: a measurement in every frame, a turn in every sixth
   * (AutoExposure.update()). The trail under the agents of frame `k` is `floors[k]`, or the last of them after the end.
   * Gives the gain of each frame times its floor (the measure of ADR 0090) and the levels after the last frame.
   */
  const play = (start: number, floors: number[], frames = floors.length) => {
    let now = { gain: start, black: 0, strand: 0, floor: 0, building: false };
    const products: number[] = [];
    for (let k = 0; k < frames; k++) {
      const floor = floors[Math.min(k, floors.length - 1)] ?? 0;
      products.push(now.gain * floor); // the measurement of a frame lands after the frame is drawn
      now = smooth(now, { gain: 1.3 / floor, black: 0, strand: floor, white: floor, floor }, k % 6 === 0 ? 0.25 : 0);
    }
    return { products, now };
  };

  it('brightens a young colony to its gain, whatever gain the frames start from', () => {
    // A fixed gain far below the gain of the plasm (a scene with a high density, ADR 0094): the frames reach the gain
    // of the plasm within a few turns, and do not wait until the 99th percentile passes the floor.
    for (const start of [0.014, 0.08, 0.8, 2.4]) {
      const { now } = play(start, [0.4, 0.8, 1.6, 3.2, 5], 6 * 10);
      expect(now.gain / (1.3 / 5)).toBeGreaterThan(0.95);
      expect(now.gain / (1.3 / 5)).toBeLessThan(1.05);
    }
  });

  it('draws the build-up of a colony with the floor of its next frame', () => {
    // The trail under a new colony grows by 2.5 times from one frame to the next, and a measurement reaches the frames
    // one frame late: a frame that took the floor of its own measurement would draw the next one 2.5 times too bright.
    const floors = [0.08, 0.2, 0.5, 1.25, 3.1, 5];
    for (const start of [0.08, 0.8, 2.4]) expect(Math.max(...play(start, floors).products)).toBeLessThan(2);
    const now = { gain: 1.3 / 0.5, black: 0, strand: 0.5, floor: 0.5, building: true };
    const grown = { gain: 1.3 / 1.25, black: 0, strand: 1.25, white: 1.25, floor: 1.25 };
    expect(smooth(now, grown, 0).gain).toBeCloseTo(1.3 / 3.125);
    // A blend of 1 takes the measurement as it is.
    expect(smooth(now, grown, 1).gain).toBeCloseTo(grown.gain);
  });

  it('ends the build-up at the first floor that does not rise', () => {
    // After the build-up the floor of a small colony goes up and down. A rise is no growth: the frames reach the floor
    // of the measurement, not a floor grown once more.
    expect(play(0.8, [0.4, 0.8, 1.6, 3.2, 5, 4.5]).now.building).toBe(false);
    // Frames with the white level 5 after the build-up, whose floor fell to 4.5 and rises to 6.
    const now = { gain: 1.3 / 5, black: 0, strand: 5, floor: 4.5, building: false };
    const up = smooth(now, { gain: 1.3 / 6, black: 0, strand: 6, white: 6, floor: 6 }, 0);
    expect(up.gain).toBeCloseTo(1.3 / 6);
    expect(up.building).toBe(false);
    // A new colony on an empty dish builds up again: the first measurement with a floor after one without.
    const empty = { gain: 1.3 / 5, black: 0, strand: 5, floor: 0, building: false };
    expect(smooth(empty, { gain: 1.3 / 0.4, black: 0, strand: 0.4, white: 0.4, floor: 0.4 }, 0).building).toBe(true);
    // Where the 99th percentile lies above the floor, no build-up.
    expect(smooth(empty, { gain: 1.3 / 0.6, black: 0, strand: 0.4, white: 0.6, floor: 0.4 }, 0).building).toBe(false);
  });

  it('measures in every frame while the floor sets the white level or nothing was measured', () => {
    expect(measureSoon(undefined)).toBe(true);
    expect(measureSoon({ gain: 0.26, black: 0, strand: 5, white: 5, floor: 5 })).toBe(true);
    expect(measureSoon({ gain: 0.1, black: 0, strand: 13, white: 13, floor: 5 })).toBe(false);
  });
});
