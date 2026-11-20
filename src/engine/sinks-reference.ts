// The CPU copy of the sinks of each strain (sinks.ts, ADR 0069), for tests only: sinks.gpu.test.ts steps it from the
// state that a GPU backend leaves and compares both backends with it. It holds the passes of shaders/sinks.wgsl and
// gl/glsl/sinks.frag: the sink test of each cell, the mean of its sink rate, the sums R, C and N of each strain, and
// the state of each strain. It follows the paths over the cells of the grid with a queue; the passes hold rows of bits.
import { grid } from './growth-reference';
import { nextBudget } from './paid';
import { RATE_ONE, SINKS, SLIME_WEIGHT, SUM_ONE } from './sinks';
import { wall, type TerritoryGrid } from './territory-reference';

/** What the pass of the sinks of one strain reads in a step. */
export interface SinkInput {
  g: TerritoryGrid;
  strain: number;
  /** The owners of the step, after the moves and the births (Sim.readOwners()). */
  owners: Uint8Array;
  /** The territory of the step, before its push (Sim.readTerritory() before the step). */
  territory: Uint8Array;
  /** The slime field after the stamps of the step (Sim.readSlime() after it). */
  stamps: Uint32Array;
  /** The life time of the slime in steps (slime.ts slimeSteps()). */
  life: number;
  step: number;
  /** The memory of the flow of the strain after the update of the step (Sim.readFlow() after it), 4 values per cell. */
  memory: Float32Array;
  /** The sink rates of the strain before the step (Sim.readSinks() before it). */
  rates: Float32Array;
}

/** Whether cell c (an index, or −1) is open: in the arena and no wall. */
const open = (g: TerritoryGrid, c: number) => c >= 0 && (g.env[c * 4] ?? 0) < 128;

/**
 * The cells that a path of at most `steps` steps from cell c reaches, with the least steps to each (ADR 0067, decision
 * 10). A step goes from a cell to an open one of its 8 neighbours, across the seam of the periodic grid, and a diagonal
 * step only where the two cells beside its corner are not both walls. The cell c takes 0 steps.
 */
export function paths(g: TerritoryGrid, c: number, steps: number): Map<number, number> {
  const { cellAt } = grid(g.w, g.h, g.boundary);
  const reached = new Map<number, number>([[c, 0]]);
  let ring = [c];
  for (let k = 1; k <= steps; k++) {
    const next: number[] = [];
    for (const from of ring) {
      const [x, y] = [from % g.w, Math.floor(from / g.w)];
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const to = cellAt(x + dx, y + dy);
          if (!open(g, to) || reached.has(to)) continue;
          if (dx !== 0 && dy !== 0 && wall(g, cellAt(x + dx, y)) && wall(g, cellAt(x, y + dy))) continue;
          reached.set(to, k);
          next.push(to);
        }
    }
    ring = next;
  }
  return reached;
}

/** Whether a cell with the stamp `held` has slime for a reader after the stamps of step `step` (slime.ts, 6.9). */
export const slimeAfter = (held: number, step: number, life: number) => held !== 0 && step + 2 - held < life;

/**
 * The weight of cell c for the strain of `input`, in steps of the rate (RATE_ONE is 1): 0 if it is no sink. A sink holds
 * an agent of the strain and a tube of it, has a free cell of its territory that one step reaches, and lies at the
 * edge of its territory: open ground outside it lies within SINKS.edge steps. Its weight is RATE_ONE if ground without
 * slime lies within SINKS.fresh steps, else SLIME_WEIGHT.
 */
export function sinkWeight(input: SinkInput, c: number): number {
  const { g, owners, territory, stamps } = input;
  const mine = 1 << input.strain;
  if (!((owners[c] ?? 0) & mine) || !((input.memory[c * 4 + 2] ?? 0) > 0)) return 0;
  const reached = [...paths(g, c, SINKS.fresh)];
  const within = (steps: number) => reached.flatMap(([t, k]) => (k <= steps ? [t] : []));
  if (!within(1).some((t) => (owners[t] ?? 0) === 0 && (territory[t] ?? 0) & mine)) return 0;
  if (!within(SINKS.edge).some((t) => !((territory[t] ?? 0) & mine))) return 0;
  const fresh = within(SINKS.fresh).some((t) => !slimeAfter(stamps[t] ?? 0, input.step, input.life));
  return fresh ? RATE_ONE : SLIME_WEIGHT;
}

/**
 * One step of the mean of a sink rate toward `target`, in steps of the rate: a 1 / SINKS.tau of the way, rounded toward
 * the target. So the rate reaches the target and stays there, and a cell that is no sink comes to 0.
 */
export function toward(old: number, target: number): number {
  const tau = SINKS.tau;
  if (target > old) return old + Math.floor((target - old + tau - 1) / tau);
  if (old > target) return old - Math.floor((old - target + tau - 1) / tau);
  return old;
}

/** A sink rate in steps of the rate as the sums count it: in steps of 2^-16, rounded to the nearest, ties up. */
export const sumOf = (rate: number) => Math.floor((rate + RATE_ONE / SUM_ONE / 2) / (RATE_ONE / SUM_ONE));

/** The pass of the sinks of a strain in a step. */
export interface SinkStep {
  /** The sink rates after the step, as Sim.readSinks() gives them: with a minus sign for a sink. */
  rates: Float32Array;
  /** The weight of each cell in steps of the rate, 0 for a cell that is no sink. */
  weights: Uint32Array;
  /** R low, R high, C and N, as Sim.readSinkSums() gives them for the strain. */
  sums: number[];
}

/**
 * The pass of the sinks of the strain of `input` in a step (sinks.wgsl `sinks`): the weight of every cell, the mean of
 * its rate, and the sums. R counts the rates of the tube cells (a conductivity above 0) in steps of 2^-16, C the tube
 * cells, N the sinks.
 */
export function sinksStep(input: SinkInput): SinkStep {
  const n = input.g.w * input.g.h;
  const rates = new Float32Array(n);
  const weights = new Uint32Array(n);
  let [r, tubes, count] = [0, 0, 0];
  for (let c = 0; c < n; c++) {
    const tube = (input.memory[c * 4 + 2] ?? 0) > 0;
    const weight = tube ? sinkWeight(input, c) : 0;
    weights[c] = weight;
    // The rate before the step in steps of the rate, cut to a whole number as the passes do.
    const next = toward(Math.trunc(Math.abs(input.rates[c] ?? 0) * RATE_ONE), weight);
    rates[c] = ((weight > 0 ? -1 : 1) * next) / RATE_ONE;
    if (tube) {
      r += sumOf(next);
      tubes++;
    }
    if (weight > 0) count++;
  }
  return { rates, weights, sums: [r % 2 ** 32, Math.floor(r / 2 ** 32), tubes, count] };
}

/** What the budget of the paid births of a strain reads in the pass of its state (sinkState(); ADR 0071). */
export interface BudgetInput {
  /** The budget before the step (paid.ts BUDGET_LANE of the state before it). */
  budget: number;
  /** F and K of the step: the agents of the front and the paid claims of the strain, 0 in a step without growth. */
  front: number;
  claims: number;
  /** Whether the step tested growth (pack.ts growthTests()). */
  grew: boolean;
  /** The growth of the budget in a step while the front takes flux (paid.ts paidIncrement()). */
  increment: number;
}

const NO_BUDGET: BudgetInput = { budget: 0, front: 0, claims: 0, grew: false, increment: 0 };

/**
 * The state of a strain after the step (sinks.wgsl `state`) from its sums and the number of its covered ports: R as a
 * float in the unit of the rate, C, N, the ports, and 1 while the front takes flux (a sink, R above 0, and a covered
 * port or a tube cell that pays); then the budget of the paid births after the step (paid.ts nextBudget()), F and K of
 * the step, from `paid`, by default a budget of 0 that does not grow.
 */
export function sinkState(sums: readonly number[], covered: number, paid: BudgetInput = NO_BUDGET): number[] {
  const f = Math.fround;
  const [low = 0, high = 0, tubes = 0, count = 0] = sums;
  const r = f(f(high * 65536 + (low >>> 16)) + (low & 0xffff) / 65536);
  const takes = count > 0 && (low > 0 || high > 0) && (covered > 0 || tubes > 0);
  const { budget, front, claims, grew, increment } = paid;
  const next = nextBudget(budget, front, claims, grew, takes, increment);
  return [r, f(tubes), f(count), covered, takes ? 1 : 0, next, front, claims];
}
