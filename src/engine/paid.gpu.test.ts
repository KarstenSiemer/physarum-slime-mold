// The births that the flux pays on both backends (ADR 0071), in Chromium with real GPU APIs (ADR 0010): the agents of
// the front, their keys, the rank, the claims of the paid parents and the budget of each strain, each against the CPU
// copy (growth-reference.ts, paid.ts), and each with two strains. A key of a GPU differs from that of the CPU by a few
// units in the last place: the keys are compared with a tolerance, and the CPU copy ranks the keys of the GPU, so the
// rank, the births and the budget are compared exactly.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { defaultSettings, defaultStrain, type Settings } from '../model/params';
import { WebGl2Backend } from './gl/backend';
import { claimKey, growthStep, rngSeed, stream, type GrowthInput, type PaidStep } from './growth-reference';
import { strainEnds } from './pack';
import { BUDGET_LANE, CLAIMS_LANE, FRONT_LANE, NO_KEY, PAID_KEY, nextBudget, paidIncrement } from './paid';
import { RATE_ONE, SINK_STATE_LANES } from './sinks';
import type { AgentState, Backend, Sim, Stroke } from './types';
import { WebGpuBackend } from './webgpu';

const BACKENDS = {
  webgpu: (c: HTMLCanvasElement): Promise<Backend> => WebGpuBackend.create(c),
  webgl2: (c: HTMLCanvasElement): Promise<Backend> => Promise.resolve(WebGl2Backend.create(c)),
};

const ALIVE = 4;
// Each agent in the middle of its cell with a step of 0.1 cells: no move leaves its cell, so the moves of a twin without
// growth, which runs no rule of stage 4, are those of the step (territory.gpu.test.ts).
const TWO = [defaultStrain(0, 2), defaultStrain(1, 2)].map((st) => ({ ...st, stepSize: 0.1 }));

/**
 * The rules of stage 4 as territoryOn() runs them: the extended model with one agent per cell, growth and the flow. A
 * growth test in every step, no shrinkage test, no agent at the start.
 */
const stage4 = (patch: Partial<Settings> = {}): Settings => ({
  ...defaultSettings(),
  model: 'extended',
  layout: 'empty',
  boundary: 'wrap',
  collisions: true,
  growth: true,
  growthEvery: 1,
  shrinkEvery: 0,
  shrink: 0,
  flow: true,
  territory: true,
  seed: 7,
  strains: TWO,
  ...patch,
});

/** A random number generator for the layouts of the tests. */
function random(seed: number) {
  let r = seed >>> 0;
  return () => (r = (Math.imul(r, 1103515245) + 12345) >>> 0) / 2 ** 32;
}

/** A sink rate of size in (0, 1] in whole steps of 2^-24, with a minus sign for a sink of the step before at random. */
const someRate = (rnd: () => number) => ((rnd() < 0.5 ? -1 : 1) * (1 + Math.floor(rnd() * (RATE_ONE - 1)))) / RATE_ONE;

/** A case of the paid births: the layout of one step. */
interface Case {
  settings: Settings;
  w: number;
  h: number;
  strokes?: Stroke[];
  /** Cells that hold a wall, written into the environment after the strokes. */
  walls?: [number, number][];
  /** The strain of the agent of cell (x, y), or undefined for an empty cell; `rnd` draws the layout. */
  place: (x: number, y: number, rnd: () => number) => number | undefined;
  /** The flow memory and the tube body of a strain at a cell before the step. */
  memory: (strain: number, x: number, y: number) => [number, number];
  /** The sink rate of a strain at a cell before the step. */
  rate: (strain: number, x: number, y: number) => number;
  /** Whether a cell lies in the territory of a strain. */
  inside: (strain: number, x: number, y: number) => boolean;
  /** The budget of each strain before the step. */
  budget: number[];
}

/** The ids whose keys differ between a GPU and the CPU copy: in their set, or by more than 10⁻⁵ of the key. */
function keysDiffer(gpu: Float32Array, cpu: Float32Array): string[] {
  const out: string[] = [];
  for (let id = 0; id < cpu.length; id++) {
    const [g, c] = [gpu[id] ?? NO_KEY, cpu[id] ?? NO_KEY];
    if ((g === NO_KEY) !== (c === NO_KEY) || Math.abs(g - c) > 1e-5 * c) out.push(`${String(id)}: ${g} for ${c}`);
  }
  return out;
}

/** The inverse of pcg() of flow.ts, a bijection on 32 bits: pcg(unpcg(v)) is v. */
function unpcg(v: number): number {
  // The inverse of an odd number modulo 2^32, by Newton's steps.
  const inverse = (a: number) => {
    let x = a;
    for (let i = 0; i < 5; i++) x = Math.imul(x, 2 - Math.imul(a, x));
    return x >>> 0;
  };
  // The inverse of y = x ^ (x >>> s).
  const unshift = (y: number, s: number) => {
    let x = y;
    for (let k = 0; k < 32; k += s) x = (y ^ (x >>> s)) >>> 0;
    return x;
  };
  const xs = Math.imul(unshift(v >>> 0, 22), inverse(277803737)) >>> 0;
  // The shift of the step that made xs keeps the top 4 bits of the state.
  const state = unshift(xs, (xs >>> 28) + 4);
  return Math.imul((state - 2891336453) >>> 0, inverse(747796405)) >>> 0;
}

/** The agents with a key of each strain (pack.ts strainEnds()). */
function keyed(keys: Float32Array, s: Settings): number[] {
  const ends = strainEnds(s.strains, keys.length);
  return s.strains.map((_, strain) => {
    let n = 0;
    for (let id = strain > 0 ? (ends[strain - 1] ?? 0) : 0; id < (ends[strain] ?? 0); id++)
      if (keys[id] !== NO_KEY) n++;
    return n;
  });
}

describe.each(Object.entries(BACKENDS))('the births that the flux pays on %s (ADR 0071)', (kind, create) => {
  let backend: Backend;
  const live: Sim[] = [];

  beforeAll(async () => {
    backend = await create(document.createElement('canvas'));
    // The passes of the territory, of the sinks, of the flow and of growth compile here, under a long timeout.
    const sim = await backend.createSim(stage4(), 16, 16, 64);
    sim.addTerritory(0, 8, 8, 4);
    sim.run(2);
    await sim.finish();
    sim.destroy();
  }, 600_000);
  afterEach(() => {
    for (const s of live.splice(0)) s.destroy();
  });
  afterAll(() => {
    backend.destroy();
  });

  async function make(settings: Settings, w: number, h: number, agents: number) {
    const sim = await backend.createSim(settings, w, h, agents);
    live.push(sim);
    return sim;
  }

  /** Writes the agents of `place` into the open cells, each in the middle of its cell, by the ids of its strain. */
  function seedAgents(sim: Sim, c: Case, env: Uint8Array) {
    const { width: w, height: h, agents: n } = sim;
    const ends = strainEnds(c.settings.strains, n);
    const next = c.settings.strains.map((_, i) => (i > 0 ? (ends[i - 1] ?? 0) : 0));
    const rnd = random(21);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const strain = c.place(x, y, rnd);
        if (strain === undefined || (env[(y * w + x) * 4] ?? 0) >= 128) continue;
        const id = next[strain] ?? 0;
        if (id >= (ends[strain] ?? 0)) continue;
        next[strain] = id + 1;
        const heading = Math.fround(rnd() * 6.28);
        sim.writeAgent(id, { x: x + 0.5, y: y + 0.5, heading, bits: strain | ALIVE });
      }
  }

  /**
   * Runs step 0 of a case on a simulation with the rules and on a twin without growth, and steps the CPU copy from the
   * moves of the twin: once with its own keys, once with the keys of the GPU. Returns both and what the GPU did.
   */
  async function step(c: Case) {
    const { settings: s, w, h } = c;
    const n = w * h;
    const twin = { ...s, growth: false };
    const [a, b] = [
      await make({ ...s, collisions: false }, w, h, n),
      await make({ ...twin, collisions: false }, w, h, n),
    ];
    for (const sim of [a, b]) {
      if (c.strokes) sim.paint(c.strokes);
      if (c.walls) {
        const env = await sim.readEnv();
        for (const [x, y] of c.walls) env[(y * w + x) * 4] = 255;
        sim.writeEnv(env);
      }
      seedAgents(sim, c, await sim.readEnv());
    }
    a.update(s);
    b.update(twin);
    const cells = (of: (x: number, y: number) => number) =>
      Float32Array.from({ length: n }, (_, i) => of(i % w, Math.floor(i / w)));
    const memory = s.strains.map((_, strain) => {
      const m = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) m.set([...c.memory(strain, i % w, Math.floor(i / w)), 0, 0], i * 4);
      return m;
    });
    for (const sim of [a, b])
      memory.forEach((m, strain) => {
        sim.writeFlow(m, strain);
      });
    const territory = new Uint8Array(n);
    for (let i = 0; i < n; i++)
      s.strains.forEach((_, strain) => {
        if (c.inside(strain, i % w, Math.floor(i / w))) territory[i] = (territory[i] ?? 0) | (1 << strain);
      });
    a.writeTerritory(territory);
    const rates = s.strains.map((_, strain) => cells((x, y) => c.rate(strain, x, y)));
    rates.forEach((r, strain) => {
      a.writeSinks(r, strain);
    });
    const before = new Float32Array(SINK_STATE_LANES * s.strains.length);
    c.budget.forEach((v, strain) => (before[strain * SINK_STATE_LANES + BUDGET_LANE] = v));
    a.writeSinkState(before);
    const env = await a.readEnv();
    a.run(1);
    b.run(1);
    const [moved, counts] = [await b.readAgents(), await b.readCounts()];
    const input: GrowthInput = {
      kind: kind as 'webgpu' | 'webgl2',
      settings: s,
      w,
      h,
      env,
      step: 0,
      agents: moved,
      counts,
      memory,
      territory,
      paid: { rates, budget: c.budget },
    };
    const keys = await a.readPaidKeys();
    const own = growthStep(input).paid;
    const expected = growthStep({ ...input, paid: { rates, budget: c.budget, keys } });
    if (!own || !expected.paid) throw new Error('No paid births in a growth step');
    return {
      sim: a,
      input,
      keys,
      own,
      expected,
      paid: expected.paid,
      got: await a.readAgents(),
      state: await a.readSinkState(),
    };
  }

  /** The state of each strain after the step, as the CPU copy gives it from the counts and the flag of the step. */
  function budgets(c: Case, state: Float32Array, paid: PaidStep) {
    return c.budget.map((before, strain) => {
      const lanes = strain * SINK_STATE_LANES;
      const takes = state[lanes + 4] === 1;
      const [front, claims] = [paid.front[strain] ?? 0, paid.claims[strain] ?? 0];
      return [nextBudget(before, front, claims, true, takes, paidIncrement(c.settings.flowStrength)), front, claims];
    });
  }

  /** The lanes of the budget, F and K of each strain (paid.ts BUDGET_LANE to CLAIMS_LANE). */
  const lanesOf = (state: Float32Array, strains: number) =>
    Array.from({ length: strains }, (_, strain) => {
      const lanes = strain * SINK_STATE_LANES;
      return [state[lanes + BUDGET_LANE], state[lanes + FRONT_LANE], state[lanes + CLAIMS_LANE]];
    });

  /** The children of the step: agents alive after it that were dead after the moves. */
  const children = (got: readonly AgentState[], moved: readonly AgentState[]) =>
    got.filter((g, id) => g.bits & ALIVE && !((moved[id]?.bits ?? 0) & ALIVE)).length;

  it('pays births at the front of each strain by the rank of the keys, as the CPU copy does', async () => {
    const [w, h] = [72, 54];
    // Jones' rule divides only where at most 14 agents lie in the window of 7 × 7 cells: in the sparse rim of a colony,
    // not in its dense core. So agents of the front are parents of Jones' rule, and others are not. A growth test in
    // every second step.
    const s = stage4({ seed: 23, growthEvery: 2, growthWindow: 7, growthMin: 1, growthMax: 14, lightGrowth: 1 });
    // Strain 0 on the left and strain 1 on the right: a dense core of agents over a tube body of their strain, and a
    // sparse rim without one, so that the agents of the rim face ground without a tube body. A thin wall crosses the
    // left colony (the corner between two walls), and light lies on the right one.
    const core = (x: number, y: number) => (x - (x < w / 2 ? 18 : 54)) ** 2 + (y - 27) ** 2;
    const rates = random(31);
    const rate = Array.from({ length: 2 }, () =>
      Float32Array.from({ length: w * h }, () => (rates() < 0.7 ? someRate(rates) : 0)),
    );
    const fed = random(37);
    const starved = Uint8Array.from({ length: w * h }, () => (fed() < 0.08 ? 1 : 0));
    const ground = random(41);
    const inside = Array.from({ length: 2 }, () => Uint8Array.from({ length: w * h }, () => (ground() < 0.75 ? 1 : 0)));
    const c: Case = {
      settings: s,
      w,
      h,
      strokes: [
        { kind: 'wall', from: [6, 12], to: [30, 40], radius: 0.6 },
        { kind: 'light', from: [40, 16], to: [70, 16], radius: 11 },
      ],
      place: (x, y, rnd) => {
        const d = core(x, y);
        const strain = x < w / 2 ? 0 : 1;
        if (d < 80) return rnd() < 0.75 ? strain : undefined;
        if (d < 260) return rnd() < 0.3 ? strain : undefined;
        return undefined;
      },
      // A flow memory of 0.3: fed, and too low for a dead agent to come to life (FLOW.birthFrom), so the moves of the
      // twin are those of the step; 0.005 on starved cells. The tube body of a strain lies only under its own core.
      memory: (strain, x, y) => [
        starved[y * w + x] ? 0.005 : 0.3,
        (x < w / 2 ? 0 : 1) === strain && core(x, y) < 60 ? 1 : 0,
      ],
      rate: (strain, x, y) => rate[strain]?.[y * w + x] ?? 0,
      inside: (strain, x, y) => (inside[strain]?.[y * w + x] ?? 0) === 1,
      budget: [37.6, 9.3],
    };
    const { sim, input, keys, own, expected, paid, got, state } = await step(c);
    expect(keysDiffer(keys, own.keys)).toEqual([]);
    expect(got).toEqual(expected.agents);
    expect(lanesOf(state, 2)).toEqual(budgets(c, state, paid));
    // The case reaches every part of the rule: in each strain agents of the front without a key and more keys than the
    // budget pays, claims that light stops, births of Jones' rule beside the paid ones, and a front that takes flux.
    const withKey = keyed(keys, s);
    for (const strain of [0, 1]) {
      expect(paid.front[strain]).toBeGreaterThan(withKey[strain] ?? 0);
      expect(withKey[strain]).toBeGreaterThan(Math.floor(c.budget[strain] ?? 0));
      expect(state[strain * SINK_STATE_LANES + 4]).toBe(1);
    }
    expect(paid.claims[0]).toBe(Math.floor(c.budget[0] ?? 0));
    expect(paid.claims[1]).toBeLessThan(Math.floor(c.budget[1] ?? 0));
    expect(children(got, input.agents)).toBeGreaterThan(paid.parents.size + 20);
    // Without the paid births the step gives other children.
    const jones: GrowthInput = { ...input };
    delete jones.paid;
    expect(growthStep(jones).agents).not.toEqual(expected.agents);
    // Step 1 tests no growth: the budget takes nothing off and holds nothing, and F and K are 0. Step 2 tests growth
    // without a sink rate: no agent of the front, so a budget of at least 1 falls to 0 before it grows.
    const increment = paidIncrement(s.flowStrength);
    for (const [k, rates] of [
      [1, false],
      [2, true],
    ] as const) {
      const written = await sim.readSinkState();
      for (const strain of [0, 1]) written[strain * SINK_STATE_LANES + BUDGET_LANE] = 5.5;
      sim.writeSinkState(written);
      if (rates) for (const strain of [0, 1]) sim.writeSinks(new Float32Array(w * h), strain);
      sim.run(1);
      const after = await sim.readSinkState();
      const want = [0, 1].map((strain) => {
        const takes = after[strain * SINK_STATE_LANES + 4] === 1;
        return [nextBudget(5.5, 0, 0, k % 2 === 0, takes, increment), 0, 0];
      });
      expect(lanesOf(after, 2), `step ${String(k)}`).toEqual(want);
    }
  }, 120_000);

  // On WebGPU the claim key of an agent is 0 for one id in 2^32 of a step (key() in growth.wgsl); on WebGL2 it is never
  // 0 (claimKey() in common.glsl). A claim with the key 0 cannot be told from no claim: such an agent draws no key of
  // the paid births, and `win` finds no paid child of it beside an empty claim.
  it.skipIf(kind !== 'webgpu')(
    'gives no key to an agent of the front whose claim key is 0, and no child',
    async () => {
      const [w, h] = [40, 32];
      // The seed that makes the claim key of agent 5 in step 0 the number 0.
      const id = 5;
      const seed = (unpcg((unpcg(0) ^ id) >>> 0) ^ 0x9e3779b9) >>> 0;
      expect(claimKey('webgpu', id, 0, seed)).toBe(0);
      const c: Case = {
        settings: stage4({ seed, growthWindow: 7, growthMin: 1000, growthMax: 2000 }),
        w,
        h,
        place: (x, y, rnd) => (x % 3 === 1 && y % 3 === 1 && rnd() < 0.8 ? (x < w / 2 ? 0 : 1) : undefined),
        memory: () => [0.9, 0],
        rate: () => 0.25,
        inside: () => true,
        budget: [1000, 1000],
      };
      const { keys, own, expected, paid, got, input } = await step(c);
      expect(input.agents[id]?.bits).toBe(ALIVE);
      expect(own.keys[id]).toBe(NO_KEY);
      expect(keysDiffer(keys, own.keys)).toEqual([]);
      expect(paid.parents.has(id)).toBe(false);
      expect(paid.claims).toEqual(keyed(keys, c.settings));
      expect(got).toEqual(expected.agents);
    },
    120_000,
  );

  it('ranks tied keys by their ids, and pays every agent of the front with a budget above their number', async () => {
    const [w, h] = [128, 96];
    const n = w * h;
    // No parent of Jones' rule (no window holds 1,000 agents), no tube body: every agent with an empty cell beside it
    // is an agent of the front, and every one with a free cell of its territory beside it draws a key. All rates are
    // the same, so two agents with the same draw have the same key.
    const r = 0.375;
    const layout = random(53);
    const at = Uint8Array.from({ length: n }, () => (layout() < 0.45 ? (layout() < 0.5 ? 1 : 2) : 0));
    const base: Case = {
      settings: stage4({ growthWindow: 7, growthMin: 1000, growthMax: 2000 }),
      w,
      h,
      place: (x, y) => {
        const v = at[y * w + x] ?? 0;
        return v === 0 ? undefined : v - 1;
      },
      memory: () => [0.9, 0],
      rate: () => r,
      inside: () => true,
      budget: [0, 0],
    };
    // A seed with two agents of strain 0 with the same draw, whose key lies apart from every other key of the strain
    // by 10⁻⁴ of it: then no error of a GPU in a key can change the rank of the two. The agents as written: the moves
    // keep every agent in its cell, so the agents of the front and their keys are those of the step.
    const agents: AgentState[] = Array.from({ length: n }, () => ({ x: 0, y: 0, heading: 0, bits: 0 }));
    const ends = strainEnds(base.settings.strains, n);
    const next = [0, ends[0] ?? 0];
    for (let c = 0; c < n; c++) {
      const v = at[c] ?? 0;
      if (v === 0) continue;
      const id = next[v - 1] ?? 0;
      next[v - 1] = id + 1;
      agents[id] = { x: (c % w) + 0.5, y: Math.floor(c / w) + 0.5, heading: 0, bits: (v - 1) | ALIVE };
    }
    const memory = [0, 1].map(() => {
      const m = new Float32Array(n * 4);
      for (let c = 0; c < n; c++) m[c * 4] = 0.9;
      return m;
    });
    const written = {
      kind: kind as 'webgpu' | 'webgl2',
      w,
      h,
      env: new Uint8Array(n * 4),
      step: 0,
      agents,
      counts: new Float32Array(n * 4),
      memory,
      territory: new Uint8Array(n).fill(3),
      paid: { rates: [0, 1].map(() => new Float32Array(n).fill(r)), budget: [0, 0] },
    };
    let found: { seed: number; ids: [number, number]; below: number } | undefined;
    for (let seed = 1; seed <= 200 && !found; seed++) {
      const step = growthStep({ ...written, settings: { ...base.settings, seed } }).paid;
      if (!step) continue;
      const draws = new Map<number, number>();
      for (let id = 0; id < (ends[0] ?? 0) && !found; id++) {
        if (step.keys[id] === NO_KEY) continue;
        const u = stream(rngSeed(id, PAID_KEY, 0, seed))();
        const other = draws.get(u);
        draws.set(u, id);
        if (other === undefined) continue;
        const key = step.keys[id] ?? 0;
        let [below, near] = [0, false];
        for (let j = 0; j < (ends[0] ?? 0); j++) {
          const k = step.keys[j] ?? NO_KEY;
          if (j === id || j === other || k === NO_KEY) continue;
          if (k < key) below++;
          if (Math.abs(k - key) < 1e-4 * key) near = true;
        }
        if (!near && below > 10) found = { seed, ids: [other, id], below };
      }
    }
    if (!found) throw new Error('No seed of 200 gives two agents of the front with the same key');
    // Strain 0 pays the first of the two and not the second; strain 1 has a budget above all of its agents.
    const c: Case = { ...base, settings: { ...base.settings, seed: found.seed }, budget: [found.below + 1.5, 1e6] };
    const { keys, own, expected, paid, got, state } = await step(c);
    expect(keysDiffer(keys, own.keys)).toEqual([]);
    const [first, second] = found.ids;
    expect(keys[first]).toBe(keys[second]);
    expect(paid.parents.has(first)).toBe(true);
    expect(paid.parents.has(second)).toBe(false);
    expect(got).toEqual(expected.agents);
    // Every claim of strain 0 succeeds: no light. Strain 1 claims with every agent that has a key.
    const withKey = keyed(keys, c.settings);
    expect(paid.claims).toEqual([found.below + 1, withKey[1]]);
    expect(withKey[1]).toBeGreaterThan(1000);
    // The budget of strain 1 falls to the number of its agents of the front.
    expect(lanesOf(state, 2)).toEqual(budgets(c, state, paid));
    const takes1 = state[SINK_STATE_LANES + 4] === 1;
    const front1 = paid.front[1] ?? 0;
    expect(state[SINK_STATE_LANES + BUDGET_LANE]).toBe(
      takes1 ? Math.fround(front1 + paidIncrement(c.settings.flowStrength)) : front1,
    );
  }, 300_000);

  it('pays no child across the corner between two walls, in each of the four diagonal directions', async () => {
    const [w, h] = [48, 40];
    // A unit every 4 cells: an agent, its diagonal neighbour in the direction of the unit the only cell of the territory
    // beside it, and a wall in one or both of the two cells beside the corner between them. With both walls the child
    // cannot reach the diagonal cell, as no move and no birth of Jones' rule reaches it, so the agent has no free cell.
    const directions = [
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ] as const;
    const units: { x: number; y: number; dx: number; dy: number; both: boolean }[] = [];
    for (let y = 2; y < h - 2; y += 4)
      for (let x = 2; x < w - 2; x += 4) {
        const [dx, dy] = directions[units.length % 4] ?? [1, 1];
        units.push({ x, y, dx, dy, both: units.length % 8 < 4 });
      }
    const walls: [number, number][] = units.flatMap(({ x, y, dx, dy, both }) =>
      both
        ? [
            [x + dx, y],
            [x, y + dy],
          ]
        : [[x + dx, y]],
    );
    const at = new Map(units.map((u, i) => [u.y * w + u.x, i % 2]));
    const free = new Set(units.map((u) => (u.y + u.dy) * w + u.x + u.dx));
    const c: Case = {
      settings: stage4({ seed: 71, growthWindow: 7, growthMin: 1000, growthMax: 2000 }),
      w,
      h,
      walls,
      place: (x, y) => at.get(y * w + x),
      memory: () => [0.9, 0],
      rate: () => 0.5,
      inside: (_, x, y) => free.has(y * w + x),
      budget: [100, 100],
    };
    const { keys, own, expected, paid, got, input } = await step(c);
    expect(keysDiffer(keys, own.keys)).toEqual([]);
    expect(got).toEqual(expected.agents);
    // Every agent is an agent of the front; only those with one wall beside the corner have a free cell and claim.
    const idOf = new Map<number, number>();
    input.agents.forEach((a, id) => {
      if (a.bits & ALIVE) idOf.set(Math.floor(a.y) * w + Math.floor(a.x), id);
    });
    expect(idOf.size).toBe(units.length);
    expect(paid.front.reduce((p, q) => p + q, 0)).toBe(units.length);
    for (const u of units) {
      const id = idOf.get(u.y * w + u.x) ?? -1;
      expect(keys[id] !== NO_KEY, `${String(u.x)}, ${String(u.y)}`).toBe(!u.both);
      expect(paid.parents.get(id), `${String(u.x)}, ${String(u.y)}`).toBe(
        u.both ? undefined : (u.y + u.dy) * w + u.x + u.dx,
      );
    }
  }, 120_000);

  it('pays nothing below a budget of 1, and keeps that budget without a front', async () => {
    const [w, h] = [48, 40];
    const c: Case = {
      settings: stage4({ seed: 67, growthWindow: 7, growthMin: 1000, growthMax: 2000 }),
      w,
      h,
      place: (x, _, rnd) => (rnd() < 0.4 ? (x < w / 2 ? 0 : 1) : undefined),
      memory: () => [0.9, 0],
      // Strain 0 has no sink rate, so no agent of the front; strain 1 has a front.
      rate: (strain) => (strain === 0 ? 0 : 0.5),
      inside: () => true,
      budget: [0.75, 0.99],
    };
    const { keys, own, expected, paid, got, state } = await step(c);
    expect(keysDiffer(keys, own.keys)).toEqual([]);
    expect(got).toEqual(expected.agents);
    expect(paid.front[0]).toBe(0);
    expect(paid.front[1]).toBeGreaterThan(100);
    expect(paid.claims).toEqual([0, 0]);
    expect(lanesOf(state, 2)).toEqual(budgets(c, state, paid));
    // A budget below 1 keeps what it has, also without an agent of the front: min(B, F) would give 0 to strain 0.
    const kept = [0, 1].map((strain) => {
      const takes = state[strain * SINK_STATE_LANES + 4] === 1;
      const before = Math.fround(c.budget[strain] ?? 0);
      return takes ? Math.fround(before + paidIncrement(c.settings.flowStrength)) : before;
    });
    expect([state[BUDGET_LANE], state[SINK_STATE_LANES + BUDGET_LANE]]).toEqual(kept);
  }, 120_000);
});
