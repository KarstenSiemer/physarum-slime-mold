// The births that the flux pays, the third part of the rules of stage 4 (ADR 0071; ADR 0065, decisions 1 and 7; ADR
// 0067, decisions 1 and 6 to 8). While the front of a strain takes flux, the budget B of the strain grows by 2 · I0 / 20
// in a step: S / 20 with the flux to the front k = 1, S / (20 k) with another k (ADR 0086). In a growth step, after
// Jones' births, each agent of the front with a free cell of its territory beside it draws a key −ln(1 − u) / r, r the
// sink rate of its cell, and the ⌊B⌋ agents of the strain with the least keys claim a child as a parent of Jones' rule
// does: the weighted order of Efraimidis and Spirakis that the prototype runs
// (`paidByRank()` in research/front/sim.ts). The passes are `test`, `rank` and `win` in shaders/growth.wgsl and PASS 2
// and 5 of gl/glsl/growth.frag with gl/glsl/paid.vert; the budget is in the pass `state` of shaders/sinks.wgsl and in
// PASS 3 of gl/glsl/sinks.frag. The CPU copy is in growth-reference.ts.
import { FLOW_TAKE_SLOT } from './flow';
import { SINK_STATE_LANES, SINKS } from './sinks';

/**
 * The flux that pays one birth (ADR 0065, decision 7) with the flux to the front k = 1: the budget grows by S / PAID_FLUX
 * in a step. With another k one birth costs k · PAID_FLUX (ADR 0086): the budget grows as with k = 1.
 */
export const PAID_FLUX = 20;

/** The random stream of the key of an agent: one draw per agent and growth step (docs/model.md, 7.7). */
export const PAID_KEY = 12;

/**
 * The key of an agent that cannot claim a paid child: the largest float32. It stands for an infinite key, which WGSL
 * may assume never to meet (ADR 0071). A key of the rule is at most 16.7 / 2^-24, far below it.
 */
export const NO_KEY = 3.4028234663852886e38;

/**
 * The births by which the budget of a strain grows in a step while its front takes flux: SINKS.take · I0 / PAID_FLUX,
 * the flow strength I0 as float32, so S / PAID_FLUX with the flux to the front k = 1. The prototype pays a birth with
 * `paid` = 20 k of flux while its front takes `norm` = 2 k times I0 (research/front/e2m.sh), so k does not change the
 * number (ADR 0086). The CPU computes it once and rounds it to float32, so both backends and the CPU copy add the same
 * number (ADR 0071).
 */
export const paidIncrement = (flowStrength: number): number =>
  Math.fround((SINKS.take * Math.fround(flowStrength)) / PAID_FLUX);

/**
 * Writes the growth of the budget into lane y of the slot of what the sinks take (FLOW_TAKE_SLOT) of the uniform block
 * of the flow, `f` over flow.ts packFlow(), whose lane 0 holds the flow strength. Returns `f`.
 */
export function packPaid(f: Float32Array): Float32Array {
  f[FLOW_TAKE_SLOT * 4 + 1] = paidIncrement(f[0] ?? 0);
  return f;
}

/** −ln(1 − u) for a draw u in [0, 1): a draw of the exponential distribution with the mean 1, in double. */
export const exponential = (u: number): number => -Math.log1p(-u);

/**
 * The key of an agent with the draw u on a cell with the sink rate `rate`: −ln(1 − u) / |rate|, rounded to float32.
 * The engine holds the rate of a sink of the step with a minus sign (ADR 0069), so the size counts. A GPU computes the
 * key to a few units in the last place (ADR 0071): the tests compare keys with a tolerance.
 */
export const paidKey = (u: number, rate: number): number => Math.fround(exponential(u) / Math.abs(rate));

/**
 * The budget of a strain after a step, from the budget before it (ADR 0071): in a growth step with a budget of at
 * least 1, the paid claims K come off, and the budget becomes at most the agents F of the front; then it grows by
 * `increment` while the front takes flux in the step. A budget below 1 pays nothing and keeps what it has, as in the
 * prototype. In float32 with one rounding per operation, as the passes compute it.
 */
export function nextBudget(
  budget: number,
  front: number,
  claims: number,
  grew: boolean,
  takes: boolean,
  increment: number,
): number {
  const f = Math.fround;
  let b = f(budget);
  if (grew && b >= 1) b = Math.min(f(b - claims), front);
  return takes ? f(b + increment) : b;
}

/** The strains that the state of the sinks holds room for on WebGPU: the 2 bits of the strain of an agent. */
export const STATE_STRAINS = 4;

/**
 * WebGPU: the buffer of the state of the sinks (sim.ts `sinks.state`; ADR 0067, decision 7). From byte 0 the state of
 * STATE_STRAINS strains, SINK_STATE_LANES floats each; from PAID_COUNTS_BYTE the agents of the front F and the paid
 * claims K of each strain as integers, which the passes add with atomics and every step clears; from PAID_KEYS_BYTE the
 * key of every agent, a float by its id.
 */
export const PAID_COUNTS_BYTE = STATE_STRAINS * SINK_STATE_LANES * 4;
export const PAID_COUNTS_BYTES = STATE_STRAINS * 2 * 4;
export const PAID_KEYS_BYTE = PAID_COUNTS_BYTE + PAID_COUNTS_BYTES;

/** The lanes of the state of a strain that the paid births use (SINK_STATE_LANES): the budget, F and K of the step. */
export const BUDGET_LANE = 5;
export const FRONT_LANE = 6;
export const CLAIMS_LANE = 7;
