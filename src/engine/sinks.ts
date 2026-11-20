// The sinks of each strain, the second part of the rules of stage 4 (ADR 0069; ADR 0065, decisions 1, 5 and 8; ADR
// 0067, decisions 3, 6 to 8 and 10). An agent is a sink of the flow of its strain where it holds a tube of its strain,
// has a free cell of the territory of its strain beside it, and lies at the edge of that territory. Its weight is 1
// near ground without slime and 0.025 elsewhere. Each cell keeps a sink rate per strain, the mean of its weight over
// 100 steps, and the passes sum the rates, the tube cells and the sinks of each strain. The passes are in
// shaders/sinks.wgsl and gl/glsl/sinks.frag, the CPU copy in sinks-reference.ts.
import { FLOW_SINK_SLOT } from './flow';

/** The constants of the sinks (ADR 0065, decisions 1, 5 and 8; `paidSinks()` in research/front/sim.ts). */
export const SINKS = {
  /** A sink lies at the edge of the territory: a path of at most this many steps reaches open ground outside it. */
  edge: 2,
  /** A sink takes the weight 1 if a path of at most this many steps reaches open ground without slime. */
  fresh: 6,
  /** The weight of a sink without such ground. */
  slime: 0.025,
  /** The steps of the exponential mean of the sink rate. */
  tau: 100,
} as const;

/**
 * The sink rate counts in steps of 2^-24 as an integer: RATE_ONE is the weight 1. The mean of a step is integer
 * arithmetic, so every GPU computes the same rate (ADR 0069, decision 3). A rate of at most 1 is an exact float32.
 */
export const RATE_ONE = 2 ** 24;
/** The sums count a sink rate in steps of 2^-16 (ADR 0067, decision 3): RATE_ONE / SUM_ONE = 256 steps of the rate. */
export const SUM_ONE = 2 ** 16;
/** The weight of a sink on slime in steps of the rate, rounded to the nearest: 419,430 for 0.025. */
export const SLIME_WEIGHT = Math.round(SINKS.slime * RATE_ONE);
/**
 * The most steps that a path of the passes takes: they hold the cells within this distance of a sink in rows of bits,
 * 13 rows of 13 bits (ADR 0067, decision 10). SINKS.edge and SINKS.fresh must not exceed it.
 */
export const SINK_WINDOW = 6;

/**
 * The state of each strain (ADR 0067, decision 7): 2 vec4 of floats. The lanes: R, the sum of the sink rates of its tube
 * cells; C, its tube cells; N, its sinks; the covered ports; 1 while the front takes flux, else 0; then three lanes
 * for the parts after this one (the budget of the paid births). The sums as integers are the 4 words R low, R high, C
 * and N per strain (Sim.readSinkSums()).
 */
export const SINK_STATE_LANES = 8;
export const SINK_SUM_WORDS = 4;

/**
 * Writes the constants of the sinks into the uniform block of the flow (`f` over flow.ts packFlow()), in the slot after
 * those of the push (FLOW_SINK_SLOT): the steps of the path to ground without slime, the steps of the path to the edge,
 * the steps of the mean, and the weight on slime in steps of the rate. Each is a whole number, exact as a float32.
 */
export function packSinks(f: Float32Array): Float32Array {
  f.set([SINKS.fresh, SINKS.edge, SINKS.tau, SLIME_WEIGHT], FLOW_SINK_SLOT * 4);
  return f;
}
