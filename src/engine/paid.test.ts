// The births that the flux pays (ADR 0071): the constants in the uniform block of the flow, the key and the budget, and
// the CPU copy of the rules (growth-reference.ts) on cases made by hand. paid.gpu.test.ts compares both backends with
// the CPU copy.
import { describe, expect, it } from 'vitest';
import { defaultSettings, defaultStrain, type Settings } from '../model/params';
import { FLOW_TAKE_SLOT, packFlow } from './flow';
import { growthStep, rngSeed, stream, type GrowthInput } from './growth-reference';
import {
  budgetAfterMoves,
  exponential,
  NO_KEY,
  nextBudget,
  PAID_FLUX,
  PAID_KEY,
  paidIncrement,
  paidKey,
  payChance,
  sharePays,
  shareSteps,
  shareSum,
} from './paid';
import { RATE_ONE } from './sinks';
import { NO_SITES } from './sites';
import { packTerritory } from './territory';
import type { AgentState } from './types';

const ALIVE = 4;
const f = Math.fround;

/** −ln(1 − u) as the passes compute it in float32 (exponential() in growth.wgsl), one rounding per operation. */
function gpuExponential(u: number): number {
  if (u > 0.5) return f(-Math.log(f(1 - u)));
  const t = f(u / f(2 - u));
  const t2 = f(t * t);
  let odd = f(t2 / 15);
  for (const k of [13, 11, 9, 7, 5, 3]) odd = f(f(odd + f(1 / k)) * t2);
  odd = f(odd + 1);
  return f(f(2 * t) * odd);
}

/** A grid of w × h cells for the CPU copy: one strain, agents by id at the cells of `at`, nothing else yet. */
function gridCase(w: number, h: number, at: readonly [number, number][], patch: Partial<Settings> = {}) {
  const n = w * h;
  const settings: Settings = {
    ...defaultSettings(),
    model: 'extended',
    boundary: 'box',
    collisions: true,
    growth: true,
    growthEvery: 1,
    shrinkEvery: 0,
    flow: true,
    territory: true,
    strains: [defaultStrain(0, 1)],
    seed: 3,
    ...patch,
  };
  const agents: AgentState[] = Array.from({ length: n }, () => ({ x: 0, y: 0, heading: 0, bits: 0 }));
  at.forEach(([x, y], id) => (agents[id] = { x: x + 0.5, y: y + 0.5, heading: 0, bits: ALIVE }));
  const memory = new Float32Array(n * 4);
  for (let c = 0; c < n; c++) memory[c * 4] = 0.9;
  const input: GrowthInput & {
    memory: Float32Array[];
    territory: Uint8Array;
    paid: { rates: Float32Array[]; budget: number[] };
  } = {
    kind: 'webgpu',
    settings,
    w,
    h,
    env: new Uint8Array(n * 4),
    step: 0,
    agents,
    // No agent moved: no parent of Jones' rule unless a case says so.
    counts: new Float32Array(n * 4),
    memory: [memory],
    territory: new Uint8Array(n).fill(1),
    paid: { rates: [new Float32Array(n)], budget: [0] },
  };
  return { input, cell: (x: number, y: number) => y * w + x };
}

describe('the births that the flux pays (ADR 0071)', () => {
  it('holds the flux of a birth, the stream of the key and the key of an agent that cannot claim', () => {
    expect(PAID_FLUX).toBe(20);
    expect(PAID_KEY).toBe(12);
    // The largest float32, finite: the next one up is infinite.
    expect(new Float32Array(new Uint32Array([0x7f7fffff]).buffer)[0]).toBe(NO_KEY);
    // A key of the rule lies far below it: the least rate, 2^-24, with the largest draw below 1.
    expect(paidKey(1 - 2 ** -24, 2 ** -24)).toBeLessThan(3e8);
  });

  it('grows the budget by 2 · I0 / 20 in a step, in the slot of what the sinks take', () => {
    expect(paidIncrement(8)).toBe(f(0.8));
    expect(paidIncrement(1)).toBe(f(0.1));
    const s = { ...defaultSettings(), flowStrength: 3 };
    const block = new Float32Array(packTerritory(packFlow(s, NO_SITES), s));
    expect(block[FLOW_TAKE_SLOT * 4 + 1]).toBe(paidIncrement(3));
  });

  it('draws the key −ln(1 − u) / |r|: an agent comes first with odds in its rate', () => {
    expect(paidKey(0.5, 0.25)).toBe(f(Math.log(2) / 0.25));
    // The rate of a sink of the step before holds a minus sign: its size counts.
    expect(paidKey(0.3, -0.125)).toBe(paidKey(0.3, 0.125));
    expect(exponential(0)).toBe(0);
    // Three agents with the rates 1, 2 and 5: the one with the least key comes first in about 1 / 8, 2 / 8 and 5 / 8 of
    // the steps (Efraimidis and Spirakis), each step with draws of its own.
    const rates = [1, 2, 5];
    const first = [0, 0, 0];
    const steps = 40000;
    for (let k = 0; k < steps; k++) {
      const keys = rates.map((r, id) => paidKey(stream(rngSeed(id, PAID_KEY, k, 9))(), r));
      const least = keys.indexOf(Math.min(...keys));
      first[least] = (first[least] ?? 0) + 1;
    }
    rates.forEach((r, i) => {
      expect((first[i] ?? 0) / steps).toBeCloseTo(r / 8, 2);
    });
  });

  it('computes −ln(1 − u) in float32 to a few units in the last place, near 0 as near 1', () => {
    // Every draw is k / 2^24. Draws near 0 give the least keys, which the rank needs most: there `log` near 1 could err
    // by 2^-21 (WGSL), which the series avoids.
    let worst = 0;
    for (let k = 1; k < 2 ** 24; k += 997) {
      const u = k / 2 ** 24;
      worst = Math.max(worst, Math.abs(gpuExponential(u) - exponential(u)) / exponential(u));
    }
    for (const k of [1, 2, 3, 2 ** 23, 2 ** 23 + 1, 2 ** 24 - 1]) {
      const u = k / 2 ** 24;
      worst = Math.max(worst, Math.abs(gpuExponential(u) - exponential(u)) / exponential(u));
    }
    expect(worst).toBeLessThan(5e-7);
  });

  it('settles the deaths and births of a step, then credits each covered food up to the agents of the front', () => {
    const inc = f(0.4);
    const none = { died: 0, reborn: 0, crowded: 0, born: 0 };
    // A death gives one back and a birth costs one, in the agent pass and in growth (ADR 0100).
    expect(nextBudget(5.5, { died: 3, reborn: 1, crowded: 2, born: 6 }, 100, 1, false, inc)).toBe(3.5);
    // While the front takes flux the food credits the increment for each covered port, at least one (ADR 0093).
    expect(nextBudget(5.5, none, 100, 0, true, inc)).toBe(f(5.5 + inc));
    expect(nextBudget(5.5, none, 100, 3, true, inc)).toBe(f(5.5 + f(3 * inc)));
    // But only up to the agents of the front (the cap of docs/model.md 9.1 on the credit): it destroys no plasm.
    expect(nextBudget(5.5, none, 6, 3, true, inc)).toBe(6);
    expect(nextBudget(7, none, 6, 3, true, inc)).toBe(7);
    // A budget that the draws took below 0 gets the whole credit.
    expect(nextBudget(-2, none, 100, 1, true, inc)).toBe(f(-2 + inc));
    // Each operation rounds to float32 once.
    const b = f(1000.3);
    expect(nextBudget(b, { ...none, born: 1 }, 2000, 1, true, f(0.1))).toBe(f(f(b - 1) + f(0.1)));
    expect(nextBudget(b, { ...none, born: 1 }, 2000, 1, true, f(0.1))).not.toBe(b - 1 + f(0.1));
    // The growth pass spends the budget after the agent pass: its deaths come back, its respawns cost.
    expect(budgetAfterMoves(f(2.5), 4, 1)).toBe(5.5);
  });

  it('pays each of n waiting claims with the chance min(1, max(0, B) / n)', () => {
    expect(payChance(5, 10)).toBe(0.5);
    expect(payChance(50, 10)).toBe(1);
    expect(payChance(-3, 10)).toBe(0);
    expect(payChance(5, 0)).toBe(0);
    expect(payChance(1, 3)).toBe(f(1 / 3));
  });

  it('gives a key to each agent of the front with a free cell, a parent of Jones’ rule too', () => {
    // Strain 0 in a box of 14 × 10 cells. A tube body under the cells with x ≤ 4.
    const at: [number, number][] = [
      [7, 5], // 0: at the rim, a rate: a key
      [2, 5], // 1: on the tube body, every empty neighbour holds one: not at the rim
      [10, 2], // 2: no rate
      [11, 7], // 3: the rate of a sink of the step before, with a minus sign: a key
      [7, 8], // 4: no free cell of the territory beside it: of the front, no key
      [12, 4], // 5: on a starved cell
      [4, 1], // 6: a parent of Jones' rule at the rim: of the front too (ADR 0100)
    ];
    const { input, cell } = gridCase(14, 10, at, { growthWindow: 3, growthMin: 1, growthMax: 5 });
    const { memory, territory, counts, paid } = input;
    const d = memory[0] ?? new Float32Array(0);
    for (let y = 0; y < 10; y++) for (let x = 0; x <= 4; x++) d[cell(x, y) * 4 + 1] = 1;
    const rates = paid.rates[0] ?? new Float32Array(0);
    for (const [x, y] of at) rates[cell(x, y)] = 0.5;
    rates[cell(10, 2)] = 0;
    rates[cell(11, 7)] = -0.25;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) territory[cell(7 + dx, 8 + dy)] = 0;
    territory[cell(7, 8)] = 1;
    d[cell(12, 4) * 4] = 0.005;
    counts[cell(4, 1) * 4] = 1;
    const step = growthStep(input).paid;
    expect(step?.front).toEqual([4]);
    const keys = Array.from(step?.keys ?? []).slice(0, at.length);
    const u = (id: number) => stream(rngSeed(id, PAID_KEY, 0, input.settings.seed))();
    expect(keys).toEqual([paidKey(u(0), 0.5), NO_KEY, NO_KEY, paidKey(u(3), 0.25), NO_KEY, NO_KEY, paidKey(u(6), 0.5)]);
    // A budget below 1 claims nothing.
    expect(step?.claims).toEqual([0]);
    // A budget of 1.5 pays the agent with the least key; a budget of 99 every agent with a key: k · P < B for each
    // (ADR 0100, part A).
    paid.budget[0] = 1.5;
    const one = growthStep(input).paid;
    const least = [0, 3, 6].reduce((a, b) => ((keys[b] ?? 0) < (keys[a] ?? 0) ? b : a));
    expect([...(one?.parents.keys() ?? [])]).toEqual([least]);
    paid.budget[0] = 99;
    expect([...(growthStep(input).paid?.parents.keys() ?? [])].sort()).toEqual([0, 3, 6]);
  });

  it('ranks tied keys by their ids, and lets the child go out onto ground without a tube body', () => {
    // Agents of the front in a row, each with ground without a tube body above it, and a tube body in its row and below
    // it.
    const at: [number, number][] = [2, 5, 8, 11, 14].map((x) => [x, 4]);
    const { input, cell } = gridCase(17, 9, at);
    const d = input.memory[0] ?? new Float32Array(0);
    for (let y = 4; y < 9; y++) for (let x = 0; x < 17; x++) d[cell(x, y) * 4 + 1] = 1;
    const rates = input.paid.rates[0] ?? new Float32Array(0);
    for (const [x, y] of at) rates[cell(x, y)] = 0.5;
    // The keys of a GPU, tied for the agents 1 and 3: a budget of 2 pays agent 4 and then agent 1, not agent 3.
    const keys = new Float32Array(input.agents.length).fill(NO_KEY);
    keys.set([0.9, 0.2, 0.7, 0.2, 0.1]);
    for (const budget of [2.5, 3.5]) {
      const step = growthStep({ ...input, paid: { ...input.paid, budget: [budget], keys } }).paid;
      expect([...(step?.parents.keys() ?? [])].sort()).toEqual(budget < 3 ? [1, 4] : [1, 3, 4]);
      // Every child goes to a cell without a tube body, above its parent, in every step.
      for (const [id, t] of step?.parents ?? []) {
        expect(Math.floor(t / 17), String(id)).toBe(3);
        expect(d[t * 4 + 1]).toBe(0);
      }
    }
  });

  it('sums the rates of the agents with a key in steps of 2^-12, in two counts (ADR 0100, part A)', () => {
    expect(shareSteps(1)).toBe(4096);
    expect(shareSteps(-0.5)).toBe(2048);
    // 0.025 in steps of 2^-24, as the sinks hold it: 102.4 steps of 2^-12, rounded to the nearest.
    expect(shareSteps(Math.round(0.025 * RATE_ONE) / RATE_ONE)).toBe(102);
    expect(shareSteps(2048 / RATE_ONE)).toBe(1);
    expect(shareSteps(2047 / RATE_ONE)).toBe(0);
    expect(shareSum(64, 63)).toBe(f(4159 / 4096));
    expect(sharePays(1, 3, 3.5)).toBe(true);
    expect(sharePays(1, 3, 3)).toBe(false);
    expect(sharePays(0, 3, -1)).toBe(false);
  });

  it('pays an agent of the front only while its key lies below B / P, also with a budget that covers the front', () => {
    // As the case of the tied keys: five agents of the front in a row, three near fresh ground (rate 1) and two on
    // slime (rate 0.025). The budget 5.5 covers all five; P = 3.05 in steps of 2^-12, so the threshold B / P is 1.80:
    // the keys 0.5, 1.0 and 1.5 pass, the keys 2.0 and 40 do not, the second on slime.
    const at: [number, number][] = [2, 5, 8, 11, 14].map((x) => [x, 4]);
    const { input, cell } = gridCase(17, 9, at);
    const slime = Math.round(0.025 * RATE_ONE) / RATE_ONE;
    const rates = input.paid.rates[0] ?? new Float32Array(0);
    [1, 1, 1, slime, slime].forEach((r, k) => {
      const [x, y] = at[k] ?? [0, 0];
      rates[cell(x, y)] = r;
    });
    const keys = new Float32Array(input.agents.length).fill(NO_KEY);
    keys.set([0.5, 1.0, 2.0, 1.5, 40]);
    const step = growthStep({ ...input, paid: { ...input.paid, budget: [5.5], keys } }).paid;
    // Each agent adds its steps / 64 and the rest: 4096 = 64 · 64 + 0, and 102 = 1 · 64 + 38.
    expect(step?.shareHigh).toEqual([3 * 64 + 2 * 1]);
    expect(step?.shareLow).toEqual([2 * 38]);
    expect([...(step?.parents.keys() ?? [])].sort()).toEqual([0, 1, 3]);
    // A budget far above every key pays all five.
    const all = growthStep({ ...input, paid: { ...input.paid, budget: [500.5], keys } }).paid;
    expect([...(all?.parents.keys() ?? [])].sort()).toEqual([0, 1, 2, 3, 4]);
  });

  it('makes no paid claim where light stops the birth', () => {
    const { input, cell } = gridCase(9, 9, [[4, 4]], { lightGrowth: 1 });
    (input.paid.rates[0] ?? new Float32Array(0))[cell(4, 4)] = 0.5;
    input.paid.budget[0] = 3;
    expect(growthStep(input).paid?.claims).toEqual([1]);
    // Light of the byte 255 on every neighbour: the chance is 1.
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) input.env[cell(4 + dx, 4 + dy) * 4 + 2] = 255;
    const step = growthStep(input).paid;
    expect(step?.front).toEqual([1]);
    expect(step?.claims).toEqual([0]);
    expect(step?.parents.size).toBe(0);
  });
});
