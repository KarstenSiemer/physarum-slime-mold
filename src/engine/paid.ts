// The births that the flux pays, the third part of the rules of stage 4 (ADR 0071; ADR 0065, decisions 1 and 7; ADR
// 0067, decisions 1 and 6 to 8), and since ADR 0100 every birth while the rules run (ADR 0097, option 1). The budget B
// of a strain is a count of area: every birth costs one, every death that the model makes gives one back, and while
// the front takes flux the food credits 2 · I0 / 20 for each covered food, but B only up to the agents of the front.
// The respawns of a step wait for B: each of the n of them comes to life with the chance min(1, B / n). In a growth
// step each agent of the front with a free cell of its territory beside it draws a key −ln(1 − u) / r, r the sink rate
// of its cell, and the ⌊B⌋ agents of the strain with the least keys claim a child: the weighted order of Efraimidis and
// Spirakis that the prototype runs (`paidByRank()` in research/front/sim.ts). An agent claims only if its key k also
// lies below B / P, P the sum of the rates of the agents with a key (k · P < B, ADR 0100, part A): so each is paid with
// the chance 1 − e^(−B · r / P) at most, B times the share of its sink, also while B covers every agent of the front,
// and a sink on slime is not paid as one near fresh ground. Then each of the n parents of Jones' rule
// that the front did not pay claims its child with the chance min(1, B' / n), B' what the front left. The passes are
// `claim`, `pay` and `settle` in shaders/agents.wgsl, `test`, `rank`, `jones`, `win` and `birth` in shaders/growth.wgsl
// and their PASSES in gl/glsl/agents.frag and growth.frag with gl/glsl/paid.vert; the budget is in the pass `state` of
// shaders/sinks.wgsl and in PASS 3 of gl/glsl/sinks.frag. The CPU copies are in growth-reference.ts and
// territory-reference.ts.
import { FLOW_TAKE_SLOT } from './flow';
import { RATE_ONE, SINK_STATE_LANES, SINKS } from './sinks';

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
 * The sum P of the sink rates of the agents of the front with a key counts each rate in steps of 1 / SHARE_ONE, rounded
 * to the nearest (ADR 0100, part A). It goes into two counts of the step (PAID_COUNTS shareHigh and shareLow): the
 * steps / SHARE_SPLIT and the rest, so that WebGL2, which adds the counts as floats, keeps every sum a whole number
 * below 2^24 for fewer than 2^18 agents with a key. The sum of the steps fits a u32 for fewer than 2^20 such agents.
 */
export const SHARE_ONE = 2 ** 12;
export const SHARE_SPLIT = 64;

/** The steps of a sink rate in the sum P: |rate| in steps of 2^-24 (RATE_ONE), then rounded to steps of 2^-12. */
export const shareSteps = (rate: number): number => {
  const step = RATE_ONE / SHARE_ONE;
  return Math.floor((Math.round(Math.abs(rate) * RATE_ONE) + step / 2) / step);
};

/** The sum P of the rates from its two counts, as the passes compute it: (high · SHARE_SPLIT + low) / SHARE_ONE, in float32. */
export const shareSum = (high: number, low: number): number =>
  Math.fround(Math.fround(high * SHARE_SPLIT + low) / SHARE_ONE);

/**
 * Whether an agent of the front with the key `key` may be paid from the budget B (ADR 0100, part A): k · P < max(0, B),
 * P the sum of the rates of the agents of its strain with a key (shareSum()), in float32 as the passes compute it.
 */
export const sharePays = (key: number, sum: number, budget: number): boolean =>
  Math.fround(key * sum) < Math.max(0, Math.fround(budget));

/** The random streams of the draws of the paid respawns and of the paid parents of Jones' rule (ADR 0100; 7.7). */
export const PAY_RESPAWN = 13;
export const PAY_JONES = 14;

/**
 * The deaths and births of a step that settle the budget (ADR 0100): the deaths of the agent pass that the model
 * makes (starvation and random shrinkage, not the cut or a wall) and its respawns; the deaths by shrinkage of the
 * growth pass and its births.
 */
export interface BudgetCounts {
  died: number;
  reborn: number;
  crowded: number;
  born: number;
}

/**
 * The budget that the growth pass of a step spends (ADR 0100): the budget before the step, plus a death and less a
 * respawn of the agent pass. Each pass settles in the next one, as atomic counts do. In float32: the difference of
 * the counts is a whole number, and the sum rounds once.
 */
export const budgetAfterMoves = (budget: number, died: number, reborn: number): number =>
  Math.fround(Math.fround(budget) + (died - reborn));

/**
 * The chance of each of n waiting claims to be paid from a budget b: min(1, max(0, b) / n), in float32 as the passes
 * compute it; 0 without a claim. The respawns of the agent pass wait for the budget before the step, and the parents
 * of Jones' rule for what the front left of the budget of the growth pass (ADR 0100).
 */
export const payChance = (budget: number, n: number): number =>
  n > 0 ? Math.min(1, Math.fround(Math.max(0, Math.fround(budget)) / n)) : 0;

/**
 * The budget of a strain after a step, from the budget before it (ADR 0100; ADR 0097, option 1): every death that the
 * model makes gives one back and every birth costs one, the agent pass and the growth pass each (`counts`). Then the
 * food credits it while the front takes flux: `increment` for each covered food, at least one (`covered`; ADR 0093),
 * but only up to the agents F of the front of the last growth step (`front`; the cap of docs/model.md 9.1 on the
 * credit). In float32 with one rounding per operation, as the passes compute it.
 */
export function nextBudget(
  budget: number,
  counts: BudgetCounts,
  front: number,
  covered: number,
  takes: boolean,
  increment: number,
): number {
  const f = Math.fround;
  let b = budgetAfterMoves(budget, counts.died, counts.reborn);
  b = f(b + (counts.crowded - counts.born));
  if (!takes) return b;
  const credit = Math.min(f(f(increment) * Math.max(1, covered)), Math.max(0, f(front - b)));
  return f(b + credit);
}

/** The strains that the state of the sinks holds room for on WebGPU: the 2 bits of the strain of an agent. */
export const STATE_STRAINS = 4;

/**
 * The counts of the paid births of a strain in a step (ADR 0071, ADR 0100), whole numbers that every step clears: F,
 * the agents of the front; K, the paid claims; the respawns that wait for the budget, and those that came to life;
 * the deaths of the agent pass that give plasm back; the parents of Jones' rule that wait for the budget; the births
 * of the growth pass; its deaths by shrinkage; and the sum P of the rates of the agents with a key in two parts
 * (shareSteps()). On WebGPU PAID_COUNT_LANES words per strain, on WebGL2 a texel each
 * with a lane per strain.
 */
export const PAID_COUNTS = {
  front: 0,
  claims: 1,
  waiting: 2,
  reborn: 3,
  died: 4,
  parents: 5,
  born: 6,
  crowded: 7,
  shareHigh: 8,
  shareLow: 9,
} as const;
export const PAID_COUNT_LANES = 10;

/**
 * WebGPU: the buffer of the state of the sinks (sim.ts `sinks.state`; ADR 0067, decision 7). From byte 0 the state of
 * STATE_STRAINS strains, SINK_STATE_LANES floats each; from PAID_COUNTS_BYTE the counts of each strain (PAID_COUNTS),
 * which the passes add with atomics and every step clears; from PAID_KEYS_BYTE the key of every agent, a float by its
 * id.
 */
export const PAID_COUNTS_BYTE = STATE_STRAINS * SINK_STATE_LANES * 4;
export const PAID_COUNTS_BYTES = STATE_STRAINS * PAID_COUNT_LANES * 4;
export const PAID_KEYS_BYTE = PAID_COUNTS_BYTE + PAID_COUNTS_BYTES;

/**
 * The lanes of the state of a strain that the paid births use (SINK_STATE_LANES): the budget, F of the last growth
 * step (ADR 0100: the cap of the credit reads it), and K of the step.
 */
export const BUDGET_LANE = 5;
export const FRONT_LANE = 6;
export const CLAIMS_LANE = 7;
