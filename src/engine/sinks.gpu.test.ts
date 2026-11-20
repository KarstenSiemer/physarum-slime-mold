// The sinks of each strain on both backends (ADR 0069), in Chromium with real GPU APIs (ADR 0010): the sink test of
// every cell, the mean of its sink rate, the sums R, C and N and the state of each strain, each against the CPU copy
// (sinks-reference.ts), exactly, with two strains, in each arena and with thin walls.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { defaultSettings, defaultStrain, type Boundary, type Settings } from '../model/params';
import { FLOW_SITES, packFlow } from './flow';
import { flowPorts } from './flow-reference';
import { WebGl2Backend } from './gl/backend';
import { grid } from './growth-reference';
import { growthTests, strainEnds } from './pack';
import { BUDGET_LANE, CLAIMS_LANE, FRONT_LANE, paidIncrement } from './paid';
import { flowSites, type FlowSites, type FoodStroke } from './sites';
import { RATE_ONE, SINK_STATE_LANES, SINK_SUM_WORDS, SINKS, SLIME_WEIGHT } from './sinks';
import { sinkState, sinksStep, sinkWeight, slimeAfter, type SinkInput, type SinkStep } from './sinks-reference';
import { slimeSteps } from './slime';
import type { TerritoryGrid } from './territory-reference';
import type { Backend, Sim } from './types';
import { WebGpuBackend } from './webgpu';

const BACKENDS = {
  webgpu: (c: HTMLCanvasElement): Promise<Backend> => WebGpuBackend.create(c),
  webgl2: (c: HTMLCanvasElement): Promise<Backend> => Promise.resolve(WebGl2Backend.create(c)),
};

const ALIVE = 4;
const TWO = [defaultStrain(0, 2), defaultStrain(1, 2)];

/**
 * The rules of stage 4 as territoryOn() runs them: the extended model with one agent per cell, growth and the flow.
 * No growth test and no shrinkage test unless a test asks for them, no random shrinkage, no agent at the start.
 */
const stage4 = (patch: Partial<Settings> = {}): Settings => ({
  ...defaultSettings(),
  model: 'extended',
  layout: 'empty',
  boundary: 'wrap',
  collisions: true,
  growth: true,
  growthEvery: 0,
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

/** A territory with each strain's bit in each cell with the chance `share`. */
function randomTerritory(cells: number, strains: number, share: number, rnd: () => number) {
  const t = new Uint8Array(cells);
  for (let c = 0; c < cells; c++) for (let s = 0; s < strains; s++) if (rnd() < share) t[c] = (t[c] ?? 0) | (1 << s);
  return t;
}

/** A memory of the flow for one strain: the flow memory 0.9, and a full tube body where `tube` says so (writeFlow()). */
function memoryOf(cells: number, tube: (c: number) => boolean) {
  const m = new Float32Array(cells * 4);
  for (let c = 0; c < cells; c++) m.set([0.9, tube(c) ? 1 : 0, 0, 0], c * 4);
  return m;
}

/** The cells whose rates differ between the GPU and the CPU copy, as text (a readable failure). */
function differ(got: Float32Array, want: SinkStep, w: number) {
  const out: string[] = [];
  for (let c = 0; c < got.length; c++)
    if (got[c] !== want.rates[c])
      out.push(`(${c % w}, ${Math.floor(c / w)}): ${got[c]} for ${want.rates[c]}, weight ${want.weights[c]}`);
  return out.slice(0, 20);
}

/**
 * The weight of cell c by the squares of the prototype, without paths (research/front/sim.ts paidSinks() with
 * `fresh` 'box'): room among the 8 neighbours without the rule of a corner, open ground outside the territory in the
 * square of 5 × 5 cells, open ground without slime in the square of 13 × 13. Only to show that a test sees the paths.
 */
function squareWeight(input: SinkInput, c: number): number {
  const { g, owners, territory, stamps } = input;
  const { cellAt } = grid(g.w, g.h, g.boundary);
  const mine = 1 << input.strain;
  if (!((owners[c] ?? 0) & mine) || !((input.memory[c * 4 + 2] ?? 0) > 0)) return 0;
  const [x, y] = [c % g.w, Math.floor(c / g.w)];
  const open = (t: number) => t >= 0 && (g.env[t * 4] ?? 0) < 128;
  const around = (k: number) => {
    const out: number[] = [];
    for (let dy = -k; dy <= k; dy++) for (let dx = -k; dx <= k; dx++) out.push(cellAt(x + dx, y + dy));
    return out.filter(open);
  };
  if (!around(1).some((t) => !owners[t] && (territory[t] ?? 0) & mine)) return 0;
  if (!around(SINKS.edge).some((t) => !((territory[t] ?? 0) & mine))) return 0;
  return around(SINKS.fresh).some((t) => !slimeAfter(stamps[t] ?? 0, input.step, input.life)) ? RATE_ONE : SLIME_WEIGHT;
}

describe.each(Object.entries(BACKENDS))('the sinks on %s (ADR 0069)', (_kind, create) => {
  let backend: Backend;
  const live: Sim[] = [];

  beforeAll(async () => {
    backend = await create(document.createElement('canvas'));
    // The passes of the sinks, of the territory, of the flow and of growth compile here, under a long timeout
    // (flow.gpu.test.ts).
    const sim = await backend.createSim(stage4({ growthEvery: 1, shrinkEvery: 1 }), 16, 16, 64);
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

  /**
   * Writes agents into the open cells that `place` names, each of the strain that `place` gives, with the next id of
   * that strain (pack.ts strainEnds()), at a random point of the cell and with a random heading.
   */
  function seed(
    sim: Sim,
    s: Settings,
    env: Uint8Array,
    rnd: () => number,
    place: (x: number, y: number) => number | undefined,
  ) {
    const { width: w, height: h, agents: n } = sim;
    const ends = strainEnds(s.strains, n);
    const next = s.strains.map((_, i) => (i > 0 ? (ends[i - 1] ?? 0) : 0));
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const strain = place(x, y);
        if (strain === undefined || (env[(y * w + x) * 4] ?? 0) >= 128) continue;
        const id = next[strain] ?? 0;
        if (id >= (ends[strain] ?? 0)) continue;
        next[strain] = id + 1;
        const [fx, fy] = [Math.fround(0.05 + 0.9 * rnd()), Math.fround(0.05 + 0.9 * rnd())];
        sim.writeAgent(id, { x: x + fx, y: y + fy, heading: Math.fround(rnd() * 6.28), bits: strain | ALIVE });
      }
  }

  /** The ports of a strain in a step, a cell per site or −1, from its memory before the step (flow.wgsl `sites`). */
  function portsOf(s: Settings, g: TerritoryGrid, sites: FlowSites, strain: number, memory: Float32Array) {
    const u = new Float32Array(packFlow(s, sites, undefined, strain));
    const fields = {
      memory,
      pressure: new Float32Array(0),
      before: new Float32Array(0),
      ports: new Int32Array(FLOW_SITES * 2).fill(-1),
    };
    const ports = flowPorts({ width: g.w, height: g.h, boundary: g.boundary, env: g.env }, u, sites.cells, fields);
    return Array.from({ length: FLOW_SITES }, (_, i) => ports[i * 2] ?? -1);
  }

  /**
   * Runs step `k` of `sim` and compares the sinks of every strain with the CPU copy: the rates, the sums and the
   * state. Returns the input and the pass of the CPU copy for each strain.
   */
  async function stepOnce(sim: Sim, s: Settings, g: TerritoryGrid, sites: FlowSites, k: number) {
    const strains = s.strains.length;
    const all = Array.from({ length: strains }, (_, strain) => strain);
    const territory = await sim.readTerritory();
    const before = await Promise.all(all.map((strain) => sim.readSinks(strain)));
    const memoryBefore = await Promise.all(all.map((strain) => sim.readFlow(strain)));
    const stateBefore = await sim.readSinkState();
    sim.run(1);
    const [owners, stamps, sums, state] = [
      await sim.readOwners(),
      await sim.readSlime(),
      await sim.readSinkSums(),
      await sim.readSinkState(),
    ];
    expect(sums.length).toBe(SINK_SUM_WORDS * strains);
    expect(state.length).toBe(SINK_STATE_LANES * strains);
    const out: { input: SinkInput; pass: SinkStep }[] = [];
    for (const strain of all) {
      const memory = await sim.readFlow(strain);
      const rates = before[strain] ?? new Float32Array(0);
      const ports = portsOf(s, g, sites, strain, memoryBefore[strain] ?? new Float32Array(0));
      const life = slimeSteps(s);
      const input: SinkInput = { g, strain, owners, territory, stamps, life, step: k, memory, rates, ports };
      const pass = sinksStep(input);
      const at = `strain ${String(strain)}, step ${String(k)}`;
      expect(differ(await sim.readSinks(strain), pass, g.w), at).toEqual([]);
      const words = SINK_SUM_WORDS * strain;
      expect(Array.from(sums.subarray(words, words + SINK_SUM_WORDS)), at).toEqual(pass.sums);
      const covered = ports.filter((c) => c >= 0).length;
      const lanes = SINK_STATE_LANES * strain;
      // The budget of the paid births from the one before the step, with F and K of the step as the GPU counted them:
      // paid.gpu.test.ts compares those with the CPU copy (ADR 0071).
      const budget = {
        budget: stateBefore[lanes + BUDGET_LANE] ?? 0,
        front: state[lanes + FRONT_LANE] ?? 0,
        claims: state[lanes + CLAIMS_LANE] ?? 0,
        grew: growthTests(s, k).grow,
        increment: paidIncrement(s.flowStrength),
      };
      expect(Array.from(state.subarray(lanes, lanes + SINK_STATE_LANES)), at).toEqual(
        sinkState(pass.sums, covered, budget),
      );
      out.push({ input, pass });
    }
    return out;
  }

  it.each(['wrap', 'box', 'dish'] as const)(
    'finds the sinks of each strain, their rates, sums and state as the CPU copy does, with thin walls (%s)',
    async (boundary: Boundary) => {
      const [w, h] = [45, 38];
      const n = w * h;
      const s = stage4({ boundary, seed: 41 });
      const sim = await make({ ...s, collisions: false }, w, h, n);
      // A food dab on the right that the tube of strain 0 covers and that of strain 1 does not, and slime on the left.
      const food: FoodStroke[] = [[{ kind: 'food', from: [35, 30], to: [35, 30], radius: 1.5 }]];
      sim.paint(food.flat());
      const sites = flowSites(food, w, h, boundary);
      sim.foodSites(sites);
      sim.paint([{ kind: 'slime', from: [11, -10], to: [11, 50], radius: 11 }]);
      // Thin walls: a column at x = 22 between the slime and the fresh ground, a diagonal line of cells that touch at
      // their corners, and a block.
      const env = await sim.readEnv();
      const walls: [number, number][] = [];
      for (let y = 2; y <= 35; y++) walls.push([22, y]);
      for (let i = 0; i <= 10; i++) walls.push([10 + i, 20 + i]);
      for (let y = 5; y <= 8; y++) for (let x = 12; x <= 15; x++) walls.push([x, y]);
      for (const [x, y] of walls) env[(y * w + x) * 4] = 255;
      sim.writeEnv(env);
      const rnd = random(43);
      seed(sim, s, env, rnd, (x, y) => {
        const left = x >= 8 && x <= 21 && y >= 2 && y <= 35 && rnd() < 0.45;
        const right = x >= 30 && x <= 40 && y >= 10 && y <= 26 && rnd() < 0.3;
        return left || right ? (rnd() < 0.5 ? 0 : 1) : undefined;
      });
      sim.update(s);
      const foodCell = (c: number) => (env[c * 4 + 1] ?? 0) > 0;
      sim.writeFlow(
        memoryOf(n, (c) => foodCell(c) || rnd() < 0.7),
        0,
      );
      sim.writeFlow(
        memoryOf(n, (c) => !foodCell(c) && rnd() < 0.7),
        1,
      );
      sim.writeTerritory(randomTerritory(n, 2, 0.55, random(47)));
      for (const strain of [0, 1])
        sim.writeSinks(
          Float32Array.from({ length: n }, () => Math.fround((rnd() < 0.5 ? -1 : 1) * rnd())),
          strain,
        );
      const g: TerritoryGrid = { w, h, boundary, env: await sim.readEnv() };
      const passes = await stepOnce(sim, s, g, sites, 0);
      // Sinks of both weights for each strain, and cells where the squares of the prototype would see through a thin
      // wall: so the test sees the paths (ADR 0067, decision 10).
      let seen = 0;
      for (const { input, pass } of passes) {
        const weights = Array.from(pass.weights);
        expect(weights.filter((v) => v > 0).length).toBeGreaterThan(20);
        expect(weights.filter((v) => v === RATE_ONE).length).toBeGreaterThan(3);
        expect(weights.filter((v) => v === SLIME_WEIGHT).length).toBeGreaterThan(3);
        for (let c = 0; c < n; c++) if (squareWeight(input, c) !== pass.weights[c]) seen++;
        // The weight of the CPU copy is the weight of its pass.
        for (const c of [0, 777, n - 1]) expect(sinkWeight(input, c)).toBe(pass.weights[c]);
      }
      expect(seen).toBeGreaterThan(3);
      // The covered port of strain 0, and none of strain 1.
      const state = await sim.readSinkState();
      expect([state[3], state[SINK_STATE_LANES + 3]]).toEqual([1, 0]);
      expect([state[4], state[SINK_STATE_LANES + 4]]).toEqual([1, 1]);
    },
    120_000,
  );

  it.each(['wrap', 'box', 'dish'] as const)(
    'takes no sink on a patch of tube without a port inside the square of its paths, as the CPU copy (%s, ADR 0072)',
    async (boundary: Boundary) => {
      const [w, h] = [46, 40];
      const n = w * h;
      // The agents stay in their cells (a step size of 0): the owners are the cells that the test fills, on every GPU,
      // so the counts below do not hang on how a GPU rounds a move.
      const s = stage4({ boundary, seed: 61, strains: TWO.map((st) => ({ ...st, stepSize: 0 })) });
      const sim = await make({ ...s, collisions: false }, w, h, n);
      // Food dabs, each in a patch of tube of strain 0 that no other tube joins: its port lets the patch keep its
      // sinks. On the periodic grid the patches lie across the seam, and each port lies at x = 0: a sink at x = 44 or
      // 45 finds it only across the seam.
      const dabs: [number, number][] = boundary === 'wrap' ? [6, 16, 26, 36].map((y) => [0, y]) : [[12, 20]];
      const food: FoodStroke[] = dabs.map(([x, y]) => [{ kind: 'food', from: [x, y], to: [x, y], radius: 1.5 }]);
      sim.paint(food.flat());
      const sites = flowSites(food, w, h, boundary);
      sim.foodSites(sites);
      const env = await sim.readEnv();
      const rnd = random(67);
      seed(sim, s, env, rnd, () => (rnd() < 0.45 ? (rnd() < 0.5 ? 0 : 1) : undefined));
      sim.update(s);
      // The distance of a cell from the nearest dab, across the seam of the periodic grid.
      const far = (c: number) =>
        Math.min(
          ...dabs.map(([x, y]) => {
            const dx = Math.abs((c % w) - x);
            return Math.hypot(boundary === 'wrap' ? Math.min(dx, w - dx) : dx, Math.floor(c / w) - y);
          }),
        );
      // Tube on half of the cells, near the share where the patches of 4-neighbours join: many small patches. Around
      // the food a patch of strain 0 within 2 cells, and a ring without a tube of strain 0 around it.
      sim.writeFlow(
        memoryOf(n, (c) => far(c) <= 2 || (far(c) > 4 && rnd() < 0.5)),
        0,
      );
      sim.writeFlow(
        memoryOf(n, () => rnd() < 0.5),
        1,
      );
      sim.writeTerritory(randomTerritory(n, 2, 0.55, random(71)));
      const g: TerritoryGrid = { w, h, boundary, env: await sim.readEnv() };
      const passes = await stepOnce(sim, s, g, sites, 0);
      // Sinks that the test of the tube takes away, sinks of the patches of the ports, and those across the seam.
      let [cut, kept, across] = [0, 0, 0];
      for (const { input, pass } of passes)
        for (let c = 0; c < n; c++) {
          if (sinkWeight(input, c, false) > 0 && pass.weights[c] === 0) cut++;
          if (input.strain !== 0 || far(c) > 2 || !((pass.weights[c] ?? 0) > 0)) continue;
          kept++;
          if (c % w >= w - 2) across++;
        }
      expect(cut).toBeGreaterThan(20);
      expect(kept).toBeGreaterThan(0);
      if (boundary === 'wrap') expect(across).toBeGreaterThan(0);
    },
    120_000,
  );

  it('finds no edge across a corner between two walls, in each of the four diagonal directions', async () => {
    // Two thin diagonal walls make an X in a box. Strain 0 holds the quarters at the top and the bottom, strain 1 those
    // on the left and the right, and the territory of each strain is its quarters, with holes 3 cells or more from a
    // wall. So an agent near a wall finds open ground outside its territory only across the wall, where a path would
    // take a diagonal step between two walls; a square of 5 × 5 cells sees it.
    const n = 48;
    const s = stage4({ boundary: 'box', seed: 73 });
    const sim = await make({ ...s, collisions: false }, n, n, n * n);
    const env = new Uint8Array(n * n * 4);
    for (let i = 0; i < n; i++) for (const c of [i * n + i, i * n + n - 1 - i]) env[c * 4] = 255;
    sim.writeEnv(env);
    const strainAt = (x: number, y: number) => (y < x === x + y < n - 1 ? 0 : 1);
    const wallAt = (x: number, y: number) => x === y || x + y === n - 1;
    const rnd = random(79);
    seed(sim, s, env, rnd, (x, y) => (!wallAt(x, y) && rnd() < 0.45 ? strainAt(x, y) : undefined));
    sim.update(s);
    for (const strain of [0, 1])
      sim.writeFlow(
        memoryOf(n * n, () => true),
        strain,
      );
    const territory = new Uint8Array(n * n);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const far = Math.min(Math.abs(x - y), Math.abs(x + y - (n - 1))) >= 6;
        if (!wallAt(x, y) && !(far && rnd() < 0.08)) territory[y * n + x] = 1 << strainAt(x, y);
      }
    sim.writeTerritory(territory);
    const g: TerritoryGrid = { w: n, h: n, boundary: 'box', env };
    const passes = await stepOnce(sim, s, g, { list: [], cells: new Uint32Array(0) }, 0);
    let seen = 0;
    for (const { input, pass } of passes) {
      expect(Array.from(pass.weights).filter((v) => v > 0).length).toBeGreaterThan(10);
      for (let c = 0; c < n * n; c++) if (squareWeight(input, c) > 0 && pass.weights[c] === 0) seen++;
    }
    expect(seen).toBeGreaterThan(20);
  }, 120_000);

  it('follows the rates of the sinks over the steps of a run with births, as the CPU copy does', async () => {
    const [w, h] = [47, 40];
    const n = w * h;
    // A growth test every third step: the births change the owners and the sinks. Slime lives 4 steps: ground that
    // held plasm 3 steps before has none for the sinks.
    const growth = { growthEvery: 3, growthWindow: 7, growthMin: 1, growthMax: 30 };
    const s = stage4({ seed: 53, ...growth, slimeLife: 4 / 1800 });
    expect(slimeSteps(s)).toBe(4);
    const sim = await make({ ...s, collisions: false }, w, h, n);
    const food: FoodStroke[] = [[{ kind: 'food', from: [6, 30], to: [6, 30], radius: 1.5 }]];
    sim.paint(food.flat());
    const sites = flowSites(food, w, h, 'wrap');
    sim.foodSites(sites);
    sim.paint([{ kind: 'wall', from: [20, 5], to: [20, 30], radius: 0.5 }]);
    const env = await sim.readEnv();
    const rnd = random(59);
    seed(sim, s, env, rnd, (x, y) =>
      x >= 4 && x <= 36 && y >= 8 && y <= 32 && rnd() < 0.35 ? (x + y) % 2 : undefined,
    );
    sim.update(s);
    const foodCell = (c: number) => (env[c * 4 + 1] ?? 0) > 0;
    sim.writeFlow(
      memoryOf(n, (c) => foodCell(c) || rnd() < 0.8),
      0,
    );
    sim.writeFlow(
      memoryOf(n, (c) => !foodCell(c) && rnd() < 0.8),
      1,
    );
    sim.writeTerritory(randomTerritory(n, 2, 0.55, random(61)));
    const g: TerritoryGrid = { w, h, boundary: 'wrap', env };
    let last: { input: SinkInput; pass: SinkStep }[] = [];
    for (let k = 0; k < 9; k++) last = await stepOnce(sim, s, g, sites, k);
    // A sink has a minus sign, and a cell that was a sink before and is none now keeps a rate that falls.
    for (const { pass } of last) {
      const sinks = Array.from(pass.rates).filter((r) => r < 0);
      expect(sinks.length).toBeGreaterThan(20);
      expect(Array.from(pass.rates).filter((r) => r > 0).length).toBeGreaterThan(20);
      expect(Math.min(...sinks)).toBeLessThan(-0.005);
    }
  }, 120_000);

  it('reads the slime after the stamps of the step: slime whose life ends in the step is ground without slime', async () => {
    // Slime lives 2 steps and covers every cell before step 0 (its stamp is 1, as a stamp of step 0). In step 1 a
    // reader of step 2 finds slime only where plasm stamped the cell in step 1.
    const [w, h] = [40, 32];
    const n = w * h;
    const s = stage4({ boundary: 'box', seed: 83, slimeLife: 2 / 1800 });
    expect(slimeSteps(s)).toBe(2);
    const sim = await make({ ...s, collisions: false }, w, h, n);
    sim.paint([{ kind: 'slime', from: [20, 16], to: [20, 16], radius: 40 }]);
    const env = await sim.readEnv();
    const rnd = random(89);
    seed(sim, s, env, rnd, () => (rnd() < 0.4 ? (rnd() < 0.5 ? 0 : 1) : undefined));
    sim.update(s);
    for (const strain of [0, 1])
      sim.writeFlow(
        memoryOf(n, () => true),
        strain,
      );
    sim.writeTerritory(randomTerritory(n, 2, 0.55, random(97)));
    const g: TerritoryGrid = { w, h, boundary: 'box', env };
    const sites = { list: [], cells: new Uint32Array(0) };
    expect((await sim.readSlime()).every((v) => v === 1)).toBe(true);
    await stepOnce(sim, s, g, sites, 0);
    // Sinks that find ground without slime only where the painted slime has ended.
    const passes = await stepOnce(sim, s, g, sites, 1);
    for (const { pass } of passes)
      expect(Array.from(pass.weights).filter((v) => v === RATE_ONE).length).toBeGreaterThan(10);
  }, 120_000);

  it('carries the low word of R into the high word, exactly', async () => {
    // Every cell a tube cell of both strains with a rate near 1 and no agent: the rates fall by a hundredth, and R of
    // each strain passes 2^32 steps of 2^-16.
    const [w, h] = [512, 256];
    const n = w * h;
    const s = stage4({ seed: 67 });
    const sim = await make(s, w, h, 64);
    const rnd = random(71);
    for (const strain of [0, 1]) {
      sim.writeFlow(
        memoryOf(n, () => true),
        strain,
      );
      sim.writeSinks(
        Float32Array.from({ length: n }, () => Math.fround((rnd() < 0.5 ? -1 : 1) * (0.9 + 0.1 * rnd()))),
        strain,
      );
    }
    const g: TerritoryGrid = { w, h, boundary: 'wrap', env: await sim.readEnv() };
    const passes = await stepOnce(sim, s, g, { list: [], cells: new Uint32Array(0) }, 0);
    for (const { pass } of passes) {
      expect(pass.sums[1]).toBeGreaterThan(0);
      expect(pass.sums[2]).toBe(n);
      expect(pass.sums[3]).toBe(0);
    }
  }, 120_000);

  it('holds no sinks while the rules of stage 4 do not run, and a reset clears them', async () => {
    const [w, h] = [33, 24];
    const off = await make(stage4({ flow: false }), w, h, 64);
    off.writeSinks(new Float32Array(w * h).fill(0.5));
    off.run(1);
    expect((await off.readSinks()).every((v) => v === 0)).toBe(true);
    expect((await off.readSinkSums()).every((v) => v === 0)).toBe(true);
    // With the rules: a step writes rates and sums, and a reset clears them.
    const s = stage4();
    const sim = await make(s, w, h, 64);
    sim.writeFlow(
      memoryOf(w * h, () => true),
      0,
    );
    sim.writeSinks(new Float32Array(w * h).fill(0.5), 0);
    sim.run(1);
    expect((await sim.readSinks(0)).every((v) => v > 0)).toBe(true);
    expect((await sim.readSinkSums())[2]).toBe(w * h);
    sim.reset();
    expect((await sim.readSinks(0)).every((v) => v === 0)).toBe(true);
    expect((await sim.readSinkSums()).every((v) => v === 0)).toBe(true);
    expect((await sim.readSinkState()).every((v) => v === 0)).toBe(true);
    // A third strain gets rates and sums of its own: after a step its flow has a state, and the next step counts its
    // tube cells.
    sim.update({ ...s, strains: [...TWO, defaultStrain(2, 3)] });
    sim.run(1);
    sim.writeFlow(
      memoryOf(w * h, () => true),
      2,
    );
    sim.run(1);
    const sums = await sim.readSinkSums();
    expect(sums.length).toBe(3 * SINK_SUM_WORDS);
    expect(sums[2 * SINK_SUM_WORDS + 2]).toBe(w * h);
    expect((await sim.readSinks(2)).length).toBe(w * h);
  }, 60_000);
});
