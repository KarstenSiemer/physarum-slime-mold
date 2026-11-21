// The sinks of each strain, the second part of the rules of stage 4 (ADR 0069; ADR 0065, decisions 1, 5 and 8; ADR
// 0067, decisions 3, 6 to 8 and 10). An agent is a sink of the flow of its strain where it holds a tube of its strain,
// has a free cell of the territory of its strain beside it, and lies at the edge of that territory. Its weight is 1
// near ground without slime and the setting Weight on slime elsewhere (0.025 by default; ADR 0088). Each cell keeps a
// sink rate per strain, the mean of its weight over 100 steps, and the passes sum the rates, the tube cells and the
// sinks of each strain. The passes are in shaders/sinks.wgsl and gl/glsl/sinks.frag, the CPU copy in
// sinks-reference.ts. The pressure of the flow takes the sinks (ADR 0070): `//#if TERRITORY` in shaders/flow.wgsl and
// gl/glsl/flow.frag, the CPU copy in flow-reference.ts.
import type { Settings } from '../model/params';
import { FLOW_SINK_SLOT, FLOW_TAKE_SLOT } from './flow';

/**
 * The constants of the sinks (ADR 0065, decisions 1, 5 and 8; `paidSinks()` in research/front/sim.ts). Two settings
 * took the place of two constants (ADR 0088): the steps of a path to ground without slime (`freshReach`, 6 by default)
 * and the weight of a sink without such ground (`slimeWeight`, 0.025 by default).
 */
export const SINKS = {
  /** A sink lies at the edge of the territory: a path of at most this many steps reaches open ground outside it. */
  edge: 2,
  /** The steps of the exponential mean of the sink rate. */
  tau: 100,
  /**
   * The sinks of a strain take together this many times the flow strength, S = 2 · I0 (ADR 0065, decision 1), times the
   * setting Flux to the front k (`frontFlux`, ADR 0086): S = 2 k · I0.
   */
  take: 2,
} as const;

/**
 * The sink rate counts in steps of 2^-24 as an integer: RATE_ONE is the weight 1. The mean of a step is integer
 * arithmetic, so every GPU computes the same rate (ADR 0069, decision 3). A rate of at most 1 is an exact float32.
 */
export const RATE_ONE = 2 ** 24;
/** The sums count a sink rate in steps of 2^-16 (ADR 0067, decision 3): RATE_ONE / SUM_ONE = 256 steps of the rate. */
export const SUM_ONE = 2 ** 16;
/**
 * The most steps that a path of the passes takes: they hold the cells within this distance of a sink in rows of bits,
 * 13 rows of 13 bits (ADR 0067, decision 10). SINKS.edge and the setting `freshReach` must not exceed it.
 */
export const SINK_WINDOW = 6;

/**
 * The weight of a sink on slime in steps of the rate: the setting Weight on slime (`slimeWeight`, ADR 0088), rounded
 * to the nearest. 419,430 for the default 0.025, and RATE_ONE for 1, the weight near ground without slime: then slime
 * changes no sink.
 */
export const slimeWeightOf = (s: Pick<Settings, 'slimeWeight'>) => Math.round(s.slimeWeight * RATE_ONE);

/**
 * The steps of a path to ground without slime: the setting Reach to fresh ground (`freshReach`, ADR 0088), a whole
 * number from SINKS.edge to SINK_WINDOW. The passes go on from the paths of the edge to those of this reach, so it is
 * at least SINKS.edge; and they hold no cell beyond SINK_WINDOW. constrain() of params.ts keeps the setting there, and
 * this keeps the passes inside their rows of bits for every value.
 */
export const freshReachOf = (s: Pick<Settings, 'freshReach'>) =>
  Math.min(SINK_WINDOW, Math.max(SINKS.edge, Math.round(s.freshReach)));

/**
 * The state of each strain (ADR 0067, decision 7): 2 vec4 of floats. The lanes: R, the sum of the sink rates of its tube
 * cells; C, its tube cells; N, its sinks; the covered ports; 1 while the front takes flux, else 0; then the budget B of
 * the paid births, the agents of the front F and the paid claims K of the step (paid.ts, ADR 0071). The sums as
 * integers are the 4 words R low, R high, C and N per strain (Sim.readSinkSums()).
 */
export const SINK_STATE_LANES = 8;
export const SINK_SUM_WORDS = 4;

/**
 * Writes the constants of the sinks into the uniform block of the flow (`f` over flow.ts packFlow()), in the slot after
 * those of the push (FLOW_SINK_SLOT): the steps of the path to ground without slime (freshReachOf()), the steps of the
 * path to the edge, the steps of the mean, and the weight on slime in steps of the rate (slimeWeightOf()). Each is a
 * whole number, exact as a float32. In the slot after it (FLOW_TAKE_SLOT, ADR 0070): x what the sinks of a strain take
 * together in units of the flow strength, 2 k with k the setting Flux to the front (ADR 0086); y is the growth of the
 * budget of the paid births (paid.ts packPaid(), ADR 0071), which k does not change; z and w stay 0.
 */
export function packSinks(
  f: Float32Array,
  s: Pick<Settings, 'frontFlux' | 'slimeWeight' | 'freshReach'>,
): Float32Array {
  f.set([freshReachOf(s), SINKS.edge, SINKS.tau, slimeWeightOf(s)], FLOW_SINK_SLOT * 4);
  f.set([SINKS.take * s.frontFlux, 0, 0, 0], FLOW_TAKE_SLOT * 4);
  return f;
}
