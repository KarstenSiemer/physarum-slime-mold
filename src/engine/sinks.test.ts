// The sinks of each strain (ADR 0069): the constants in the uniform block of the flow, and the CPU copy of the rules
// (sinks-reference.ts) on cases made by hand. sinks.gpu.test.ts compares both backends with the CPU copy.
import { describe, expect, it } from 'vitest';
import { defaultSettings, type Boundary, type Settings } from '../model/params';
import { FLOW_BYTES, FLOW_SINK_SLOT, FLOW_SLOTS, FLOW_TAKE_SLOT, FLOW_TERRITORY_SLOT, packFlow } from './flow';
import { NO_SITES } from './sites';
import { RATE_ONE, SINK_WINDOW, SINKS, SLIME_WEIGHT, SUM_ONE } from './sinks';
import { paths, sinkState, sinksStep, sinkWeight, sumOf, toward, tubeOut, type SinkInput } from './sinks-reference';
import { sinkLevels } from './sizing';
import { packTerritory } from './territory';
import type { TerritoryGrid } from './territory-reference';

/** A grid of `w` × `h` open cells, with walls where `walls` names them. */
function gridOf(w: number, h: number, boundary: Boundary, walls: readonly [number, number][] = []): TerritoryGrid {
  const env = new Uint8Array(w * h * 4);
  for (const [x, y] of walls) env[(y * w + x) * 4] = 255;
  return { w, h, boundary, env };
}

/** A random number generator for the cases. */
function random(seed: number) {
  let r = seed >>> 0;
  return () => (r = (Math.imul(r, 1103515245) + 12345) >>> 0) / 2 ** 32;
}

/** The cells of the square of side 2 · k + 1 around cell c that lie in the grid, as the prototype looks at them. */
function square(g: TerritoryGrid, c: number, k: number): number[] {
  const out: number[] = [];
  const [x, y] = [c % g.w, Math.floor(c / g.w)];
  for (let yy = y - k; yy <= y + k; yy++)
    for (let xx = x - k; xx <= x + k; xx++) if (xx >= 0 && yy >= 0 && xx < g.w && yy < g.h) out.push(yy * g.w + xx);
  return out;
}

describe('the sinks (ADR 0069)', () => {
  const on: Settings = { ...defaultSettings(), territory: true, flow: true, growth: true, collisions: true };

  it('holds the constants of the rule set of ADR 0065 in the slot after the push, as whole numbers', () => {
    expect(SINKS).toEqual({ edge: 2, fresh: 6, slime: 0.025, tau: 100, take: 2 });
    expect([RATE_ONE, SUM_ONE, SLIME_WEIGHT]).toEqual([16777216, 65536, 419430]);
    expect(SINK_WINDOW).toBe(6);
    // The passes hold a window of 13 × 13 cells: no reach of the block may leave it, and the edge lies nearer.
    expect(SINKS.edge).toBeGreaterThanOrEqual(1);
    expect(SINKS.fresh).toBeGreaterThanOrEqual(SINKS.edge);
    expect(SINK_WINDOW).toBeGreaterThanOrEqual(SINKS.fresh);
    expect(FLOW_SINK_SLOT).toBe(FLOW_TERRITORY_SLOT + 2);
    // The slot of what the sinks take comes last (ADR 0070): x the share of the flow strength, y the growth of the
    // budget of the paid births in a step (ADR 0071), z and w free.
    expect(FLOW_TAKE_SLOT).toBe(FLOW_SINK_SLOT + 1);
    expect(FLOW_SLOTS).toBe(FLOW_TAKE_SLOT + 1);
    const f = new Float32Array(packTerritory(packFlow(on, NO_SITES)));
    expect(f.length * 4).toBe(FLOW_BYTES);
    expect(Array.from(f.subarray(FLOW_SINK_SLOT * 4, FLOW_SINK_SLOT * 4 + 4))).toEqual([6, 2, 100, 419430]);
    const growth = Math.fround((2 * on.flowStrength) / 20);
    expect(Array.from(f.subarray(FLOW_TAKE_SLOT * 4, FLOW_TAKE_SLOT * 4 + 4))).toEqual([2, growth, 0, 0]);
  });

  it('moves a rate a hundredth of the way to its weight, rounded toward it, and reaches it', () => {
    // From 0 to the weight 1: as the exact mean within 100 steps of the rate, never past it, and then exactly on it.
    let [r, exact] = [0, 0];
    for (let k = 1; k <= 3000; k++) {
      r = toward(r, RATE_ONE);
      exact += (RATE_ONE - exact) / 100;
      expect(r).toBeLessThanOrEqual(RATE_ONE);
      expect(r).toBeGreaterThanOrEqual(exact);
      expect(r - exact).toBeLessThanOrEqual(100);
    }
    expect(r).toBe(RATE_ONE);
    // A cell that is no sink comes to 0, and a sink on slime to its weight from above.
    let down = RATE_ONE;
    for (let k = 0; k < 3000; k++) down = toward(down, 0);
    expect(down).toBe(0);
    let slime = RATE_ONE;
    for (let k = 0; k < 3000; k++) slime = toward(slime, SLIME_WEIGHT);
    expect(slime).toBe(SLIME_WEIGHT);
    // The first step of a new sink.
    expect(toward(0, SLIME_WEIGHT)).toBe(4195);
    expect(toward(0, RATE_ONE)).toBe(167773);
    expect(toward(5, 5)).toBe(5);
  });

  it('counts a rate in the sums in steps of 2^-16, rounded to the nearest', () => {
    expect([sumOf(0), sumOf(127), sumOf(128), sumOf(383), sumOf(384), sumOf(RATE_ONE)]).toEqual([0, 0, 1, 1, 2, 65536]);
    expect(sumOf(SLIME_WEIGHT)).toBe(1638);
  });

  it('builds the pyramid of WebGL2 up to one texel', () => {
    expect(sinkLevels(45, 38)).toEqual([
      [12, 10],
      [3, 3],
      [1, 1],
    ]);
    expect(sinkLevels(1, 1)).toEqual([[1, 1]]);
    expect(sinkLevels(4096, 4)).toEqual([
      [1024, 1],
      [256, 1],
      [64, 1],
      [16, 1],
      [4, 1],
      [1, 1],
    ]);
  });

  it.each(['wrap', 'box', 'dish'] as const)(
    'reaches every cell of the square around a cell without walls, as the box of the prototype (%s)',
    (boundary) => {
      const g = gridOf(21, 17, boundary);
      for (const c of [0, 5, 10 * 21 + 10, 16 * 21 + 20]) {
        for (const k of [1, SINKS.edge, SINKS.fresh]) {
          const reached = [...paths(g, c, k).keys()].sort((a, b) => a - b);
          if (boundary === 'box') expect(reached).toEqual(square(g, c, k).sort((a, b) => a - b));
          else if (boundary === 'wrap') expect(reached.length).toBe(Math.min(21, 2 * k + 1) * Math.min(17, 2 * k + 1));
          // A path of k steps ends at most k cells away along each axis.
          for (const t of reached) {
            const [dx, dy] = [Math.abs((t % 21) - (c % 21)), Math.abs(Math.floor(t / 21) - Math.floor(c / 21))];
            expect(Math.min(dx, 21 - dx) <= k && Math.min(dy, 17 - dy) <= k).toBe(true);
          }
        }
      }
    },
  );

  it('takes no diagonal step between two walls, and a path goes around a wall', () => {
    // A thin wall along the diagonal x = y: no path crosses it, but a square of 13 × 13 would see past it.
    const walls = Array.from({ length: 21 }, (_, i): [number, number] => [i, i]);
    const g = gridOf(21, 21, 'box', walls);
    const c = 10 * 21 + 11; // (11, 10), above the wall
    const reached = paths(g, c, SINKS.fresh);
    for (const t of reached.keys()) expect(t % 21).toBeGreaterThan(Math.floor(t / 21));
    expect(reached.has(11 * 21 + 10)).toBe(false); // (10, 11): beside it across the corner
    // A wall of one row with a gap: the path goes through the gap.
    const row = Array.from({ length: 21 }, (_, x): [number, number] => [x, 10]).filter(([x]) => x !== 3);
    const h = gridOf(21, 21, 'box', row);
    const from = 9 * 21 + 10; // (10, 9)
    expect(paths(h, from, 6).has(11 * 21 + 10)).toBe(false); // 2 cells straight down, behind the wall
    expect(paths(h, from, 8).get(11 * 21 + 4)).toBe(8); // (4, 11): to the gap at x = 3 and back
    // One wall at a corner lets the diagonal step pass, as for a move.
    const one = gridOf(5, 5, 'box', [[2, 1]]);
    expect(paths(one, 1 * 5 + 1, 1).get(2 * 5 + 2)).toBe(1);
  });

  /** One strain of a sink test on a grid of 15 × 9 cells around (7, 4) (sinkWeight()). */
  function caseOf({ walls, ...patch }: Partial<SinkInput> & { walls?: [number, number][] } = {}): SinkInput {
    const [w, h] = [15, 9];
    const n = w * h;
    const memory = new Float32Array(n * 4);
    for (let c = 0; c < n; c++) memory[c * 4 + 2] = 1;
    // The territory of strain 0 is the left half, x ≤ 7.
    const territory = new Uint8Array(n);
    for (let c = 0; c < n; c++) if (c % w <= 7) territory[c] = 1;
    // Agents of strain 0 fill the territory but for the cell (6, 4); slime everywhere.
    const owners = new Uint8Array(n);
    for (let c = 0; c < n; c++) if (territory[c]) owners[c] = 1;
    owners[4 * w + 6] = 0;
    return {
      g: gridOf(w, h, 'box', walls),
      strain: 0,
      owners,
      territory,
      stamps: new Uint32Array(n).fill(1),
      life: 1000,
      step: 10,
      memory,
      rates: new Float32Array(n),
      ports: [],
      ...patch,
    };
  }

  it('makes a sink of an agent with room at the edge of the territory, with the weight of its ground', () => {
    const c = 4 * 15 + 7; // (7, 4): beside the free cell (6, 4), at the edge x = 8
    expect(sinkWeight(caseOf(), c)).toBe(SLIME_WEIGHT);
    // Ground without slime 6 steps away gives the weight 1; 7 steps away does not.
    const near = caseOf();
    near.stamps[4 * 15 + 13] = 0;
    expect(sinkWeight(near, c)).toBe(RATE_ONE);
    const far = caseOf();
    far.stamps[4 * 15 + 14] = 0;
    expect(sinkWeight(far, c)).toBe(SLIME_WEIGHT);
    // Slime that is too old is no slime.
    expect(sinkWeight(caseOf({ step: 1000 }), c)).toBe(RATE_ONE);
    // No room: the free cell holds an agent of another strain.
    const full = caseOf();
    full.owners[4 * 15 + 6] = 2;
    expect(sinkWeight(full, c)).toBe(0);
    // No edge within 2 steps: the agent at (5, 4) beside the free cell lies 3 cells from x = 8.
    expect(sinkWeight(caseOf(), 4 * 15 + 5)).toBe(0);
    // No tube, no agent of the strain, or the strain of another bit.
    const dry = caseOf();
    dry.memory[c * 4 + 2] = 0;
    expect(sinkWeight(dry, c)).toBe(0);
    expect(sinkWeight(caseOf({ strain: 1 }), c)).toBe(0);
  });

  it('finds no edge and no room behind a thin wall that a square sees through', () => {
    const c = 4 * 15 + 7;
    // A wall in the column x = 8 hides the ground outside the territory: the next open cell outside lies 4 steps away,
    // around the wall, and the square of 5 × 5 holds it.
    const column = Array.from({ length: 9 }, (_, y): [number, number] => [8, y]).filter(([, y]) => y !== 0);
    const hidden = caseOf({ walls: column });
    expect(sinkWeight(hidden, c)).toBe(0);
    const g = hidden.g;
    expect(square(g, c, SINKS.edge).some((t) => (g.env[t * 4] ?? 0) < 128 && !hidden.territory[t])).toBe(true);
    // Room only across a corner between two walls: none.
    const corner = caseOf({
      walls: [
        [6, 4],
        [7, 3],
        [8, 5],
      ],
    });
    corner.owners.fill(1);
    corner.owners[3 * 15 + 6] = 0; // (6, 3): free, but between the walls (6, 4) and (7, 3)
    expect(sinkWeight(corner, c)).toBe(0);
    const free = caseOf({
      walls: [
        [6, 4],
        [8, 5],
      ],
    });
    free.owners.fill(1);
    free.owners[3 * 15 + 6] = 0;
    expect(sinkWeight(free, c)).toBe(SLIME_WEIGHT);
  });

  it('takes no sink on a patch of tube that a square of 13 × 13 cells holds without a port (ADR 0072)', () => {
    const c = 4 * 15 + 7; // (7, 4), the sink of caseOf()
    // Only the cells of `cells` hold a tube.
    const tubes = (cells: [number, number][], patch: Partial<SinkInput> = {}) => {
      const input = caseOf(patch);
      input.memory.fill(0);
      for (const [x, y] of [[7, 4] as [number, number], ...cells]) input.memory[(y * 15 + x) * 4 + 2] = 0.5;
      return input;
    };
    // A patch of two cells: no sink, but with a port in it, and on a tube that reaches the edge of the square, x = 1.
    expect(sinkWeight(tubes([[7, 3]]), c)).toBe(0);
    expect(tubeOut(tubes([[7, 3]]), c)).toBe(false);
    expect(sinkWeight(tubes([[7, 3]], { ports: [-1, 3 * 15 + 7] }), c)).toBe(SLIME_WEIGHT);
    expect(sinkWeight(tubes([[7, 3]], { ports: [3 * 15 + 8] }), c)).toBe(0);
    const row = Array.from({ length: 6 }, (_, i): [number, number] => [6 - i, 4]);
    expect(sinkWeight(tubes(row), c)).toBe(SLIME_WEIGHT);
    expect(sinkWeight(tubes(row.slice(0, 5)), c)).toBe(0);
    // Steps between 4-neighbours only: the row one cell lower touches the cell at a corner and does not join it.
    expect(sinkWeight(tubes(row.map(([x, y]) => [x, y + 1])), c)).toBe(0);
    // A winding tube inside the square counts with every step: down, right, up and right to x = 13.
    const winding: [number, number][] = [
      ...[5, 6, 7, 8].map((y): [number, number] => [7, y]),
      ...[8, 9, 10, 11].map((x): [number, number] => [x, 8]),
      ...[7, 6, 5, 4, 3, 2].map((y): [number, number] => [11, y]),
      [12, 2],
      [13, 2],
    ];
    expect(sinkWeight(tubes(winding), c)).toBe(SLIME_WEIGHT);
    expect(sinkWeight(tubes(winding.slice(0, -1)), c)).toBe(0);
    // Across the seam of the periodic grid: from (1, 4) the tube reaches x = 10, which is 6 cells to the left of it.
    const seam = caseOf({ g: gridOf(15, 9, 'wrap') });
    seam.memory.fill(0);
    for (const x of [1, 0, 14, 13, 12, 11, 10]) seam.memory[(4 * 15 + x) * 4 + 2] = 0.5;
    expect(tubeOut(seam, 4 * 15 + 1)).toBe(true);
    seam.memory[(4 * 15 + 10) * 4 + 2] = 0;
    expect(tubeOut(seam, 4 * 15 + 1)).toBe(false);
  });

  it('sums the rates of the tube cells in two words, the tube cells and the sinks', () => {
    // Every cell a tube cell at the full rate, no sink: each rate falls by a hundredth, and R wraps its low word.
    const [w, h] = [400, 250];
    const n = w * h;
    const memory = new Float32Array(n * 4);
    for (let c = 0; c < n; c++) memory[c * 4 + 2] = c % 7 === 0 ? 0 : 0.5;
    const rnd = random(3);
    const rates = Float32Array.from({ length: n }, () => (rnd() < 0.5 ? -1 : 1) * Math.fround(0.9 + 0.1 * rnd()));
    const input: SinkInput = {
      g: gridOf(w, h, 'wrap'),
      strain: 1,
      owners: new Uint8Array(n),
      territory: new Uint8Array(n),
      stamps: new Uint32Array(n),
      life: 0,
      step: 0,
      memory,
      rates,
      ports: [],
    };
    const out = sinksStep(input);
    let r = 0;
    for (let c = 0; c < n; c++) {
      const next = Math.abs(out.rates[c] ?? 0) * RATE_ONE;
      expect(Number.isInteger(next)).toBe(true);
      expect(out.rates[c]).toBeGreaterThanOrEqual(0);
      if (c % 7 !== 0) r += Math.round(next / 256);
    }
    const tubes = n - Math.ceil(n / 7);
    expect(out.sums).toEqual([r % 2 ** 32, Math.floor(r / 2 ** 32), tubes, 0]);
    expect(out.sums[1]).toBeGreaterThan(0);
    // The state: R as a float, and no flux without a sink.
    const state = sinkState(out.sums, 0);
    expect(state[0]).toBe(Math.fround(r / SUM_ONE));
    expect(state.slice(1)).toEqual([tubes, 0, 0, 0, 0, 0, 0]);
    expect(sinkState([5, 0, 3, 1], 0)[4]).toBe(1);
    expect(sinkState([0, 0, 3, 1], 2)[4]).toBe(0);
  });
});
