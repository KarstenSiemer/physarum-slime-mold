// The territory of each strain on both backends (ADR 0068), in Chromium with real GPU APIs (ADR 0010): the moves, the
// respawn and the births only onto the territory, the owners, the push and the start territory, each against the CPU
// copy (territory-reference.ts, growth-reference.ts), and each with two strains.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { defaultSettings, defaultStrain, type Boundary, type Settings } from '../model/params';
import { WebGl2Backend } from './gl/backend';
import { growthStep } from './growth-reference';
import { strainEnds } from './pack';
import { TERRITORY } from './territory';
import { addDisc, owners, push, respawnStep, territoryMoves, type TerritoryGrid } from './territory-reference';
import type { Backend, Sim, Stroke } from './types';
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

/** The memory of the flow of every cell for one strain: memory `d` and tube body `body` (Sim.writeFlow()). */
function memoryOf(cells: number, d: number, body: number) {
  const m = new Float32Array(cells * 4);
  for (let c = 0; c < cells; c++) m.set([d, body, 0, 0], c * 4);
  return m;
}

/** The cells that differ between two territories, as text (a readable failure). */
function differ(a: Uint8Array, b: Uint8Array, w: number, skip: ReadonlySet<number> = new Set()) {
  const out: string[] = [];
  for (let c = 0; c < a.length; c++)
    if (!skip.has(c) && a[c] !== b[c]) out.push(`(${c % w}, ${Math.floor(c / w)}): ${a[c]} for ${b[c]}`);
  return out;
}

describe.each(Object.entries(BACKENDS))('the territory on %s (ADR 0068)', (kind, create) => {
  let backend: Backend;
  const live: Sim[] = [];

  beforeAll(async () => {
    backend = await create(document.createElement('canvas'));
    // The passes of the territory, of the flow and of growth compile here, under a long timeout (flow.gpu.test.ts).
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

  /** The grid of a simulation for the CPU copy. */
  async function gridOf(sim: Sim, boundary: Boundary): Promise<TerritoryGrid> {
    return { w: sim.width, h: sim.height, boundary, env: await sim.readEnv() };
  }

  /**
   * Writes agents into the open cells that `place` names, each of the strain that `place` gives, with the next id of
   * that strain (the strains own their ids: pack.ts strainEnds()). `centre`: in the middle of its cell; else at a
   * random point of it. Every agent gets a random heading.
   */
  function seed(
    sim: Sim,
    s: Settings,
    env: Uint8Array,
    rnd: () => number,
    place: (x: number, y: number) => number | undefined,
    centre = false,
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
        const [fx, fy] = centre ? [0.5, 0.5] : [Math.fround(0.05 + 0.9 * rnd()), Math.fround(0.05 + 0.9 * rnd())];
        sim.writeAgent(id, { x: x + fx, y: y + fy, heading: Math.fround(rnd() * 6.28), bits: strain | ALIVE });
      }
  }

  it('moves an agent only onto the territory of its strain, and changes nothing else', async () => {
    const [w, h] = [63, 48];
    const s = stage4({ seed: 11 });
    // Three simulations: the territory of the test, a territory of every cell for both strains, and no rules of
    // stage 4. Agents on a lattice of every third cell: no two claim one cell.
    const plain = { ...s, collisions: false };
    const [a, b, c] = [await make(plain, w, h, 600), await make(plain, w, h, 600), await make(plain, w, h, 600)];
    const sims = [a, b, c];
    const env = await a.readEnv();
    for (const sim of sims) {
      const rnd = random(5);
      seed(sim, s, env, rnd, (x, y) => (x % 3 === 1 && y % 3 === 1 ? (x + y) % 2 : undefined));
    }
    a.update(s);
    b.update(s);
    c.update({ ...s, territory: false });
    const territory = randomTerritory(w * h, 2, 0.5, random(9));
    a.writeTerritory(territory);
    b.writeTerritory(new Uint8Array(w * h).fill(3));
    const before = await a.readAgents();
    for (const sim of sims) sim.run(1);
    const free = await b.readAgents();
    // A territory of every cell is no territory: the agents of b move as those of c.
    expect(free).toEqual(await c.readAgents());
    const expected = territoryMoves(before, free, territory, await gridOf(a, 'wrap'), 0, s.seed);
    expect(await a.readAgents()).toEqual(expected.agents);
    // 336 agents: about half of the moves into another cell end outside the territory.
    expect(expected.blocked).toBeGreaterThan(80);
    expect(expected.moved).toBeGreaterThan(80);
  }, 120_000);

  it('brings a dead agent to life only on the territory of its strain', async () => {
    const [w, h] = [64, 64];
    const s = stage4({ seed: 13 });
    const sim = await make(s, w, h, 3000);
    // A fed tube on every cell for both strains: a dead agent comes to life on its cell with the chance 0.2.
    const memory = [memoryOf(w * h, 1, 1), memoryOf(w * h, 1, 1)];
    memory.forEach((m, strain) => {
      sim.writeFlow(m, strain);
    });
    const territory = randomTerritory(w * h, 2, 0.5, random(3));
    sim.writeTerritory(territory);
    const before = await sim.readAgents();
    expect(before.every((a) => !(a.bits & ALIVE))).toBe(true);
    sim.run(1);
    const g = await gridOf(sim, 'wrap');
    const expected = respawnStep({
      kind: kind as 'webgpu' | 'webgl2',
      g,
      agents: before,
      memory,
      territory,
      step: 0,
      seed: s.seed,
    });
    expect(await sim.readAgents()).toEqual(expected.agents);
    const born = expected.agents.filter((a) => a.bits & ALIVE);
    // Without the territory about 600 of 3,000 dead agents would come to life; it refuses about half of the draws.
    expect(born.length).toBeGreaterThan(200);
    expect(expected.refused).toBeGreaterThan(1000);
    for (const a of born) {
      const cell = Math.floor(a.y) * w + Math.floor(a.x);
      expect(((territory[cell] ?? 0) >> (a.bits & 3)) & 1).toBe(1);
    }
  }, 120_000);

  it('gives birth only onto the territory of the strain of the parent, as the CPU copy of growth', async () => {
    const [w, h] = [62, 48];
    const n = w * h;
    // Each agent in the middle of its cell with a step of 0.1 cells: no move leaves its cell, so the moves of a twin
    // without growth, which runs no rule of stage 4, are those of the step. A growth test in every step.
    const strains = TWO.map((st) => ({ ...st, stepSize: 0.1 }));
    const s = stage4({ seed: 17, strains, growthEvery: 1, growthWindow: 7, growthMin: 1, growthMax: 30 });
    const twin = { ...s, growth: false };
    const [a, b] = [
      await make({ ...s, collisions: false }, w, h, n),
      await make({ ...twin, collisions: false }, w, h, n),
    ];
    const wall: Stroke[] = [{ kind: 'wall', from: [10, 30], to: [50, 34], radius: 1.2 }];
    for (const sim of [a, b]) {
      sim.paint(wall);
      const rnd = random(21);
      seed(sim, s, await sim.readEnv(), rnd, () => (rnd() < 0.35 ? (rnd() < 0.5 ? 0 : 1) : undefined), true);
    }
    a.update(s);
    b.update(twin);
    // Fed ground without a tube: no cell is starved, and no dead agent comes to life.
    const memory = [memoryOf(n, 0.9, 0), memoryOf(n, 0.9, 0)];
    for (const sim of [a, b])
      memory.forEach((m, strain) => {
        sim.writeFlow(m, strain);
      });
    const territory = randomTerritory(n, 2, 0.6, random(23));
    a.writeTerritory(territory);
    const env = await a.readEnv();
    a.run(1);
    b.run(1);
    const moved = await b.readAgents();
    const input = { kind: kind as 'webgpu' | 'webgl2', settings: s, w, h, env, step: 0, agents: moved, memory };
    const counts = await b.readCounts();
    const expected = growthStep({ ...input, counts, territory });
    const got = await a.readAgents();
    expect(got).toEqual(expected.agents);
    const children = got.filter((g, id) => g.bits & ALIVE && !((moved[id]?.bits ?? 0) & ALIVE));
    expect(children.length).toBeGreaterThan(100);
    for (const g of children) {
      const cell = Math.floor(g.y) * w + Math.floor(g.x);
      expect(((territory[cell] ?? 0) >> (g.bits & 3)) & 1).toBe(1);
    }
    // Without the territory the same step gives other children.
    expect(growthStep({ ...input, counts }).agents).not.toEqual(expected.agents);
  }, 120_000);

  it.each(['wrap', 'box', 'dish'] as const)(
    'fills the owners and pushes the territory as the CPU copy does (%s)',
    async (boundary) => {
      const [w, h] = [47, 40];
      // Growth and shrinkage every third step, as in Jones' foraging scenes: births and deaths change the owners.
      const s = stage4({ boundary, seed: 19, growthEvery: 3, shrinkEvery: 3 });
      const sim = await make({ ...s, collisions: false }, w, h, w * h);
      sim.paint([
        { kind: 'wall', from: [5, 20], to: [43, 22], radius: 1.5 },
        { kind: 'wall', from: [30, -4], to: [30, 12], radius: 1 },
      ]);
      const rnd = random(29);
      seed(sim, s, await sim.readEnv(), rnd, () => (rnd() < 0.3 ? (rnd() < 0.5 ? 0 : 1) : undefined));
      sim.update(s);
      // Fed ground without a tube: no cell is starved, and no dead agent comes to life.
      const memory = memoryOf(w * h, 0.9, 0);
      sim.writeFlow(memory, 0);
      sim.writeFlow(memory, 1);
      // A territory of about a third of the cells for each strain: most agents push cells around them, and the agents
      // outside their territory join it by their cell.
      sim.writeTerritory(randomTerritory(w * h, 2, 0.35, random(31)));
      const g = await gridOf(sim, boundary);
      let [joined, owned] = [0, 0];
      for (let k = 0; k < 6; k++) {
        const before = await sim.readTerritory();
        sim.run(1);
        const agents = await sim.readAgents();
        const got = await sim.readOwners();
        expect(Array.from(got)).toEqual(Array.from(owners(agents, g)));
        const expected = push(before, got, g, k, s.seed);
        expect(differ(await sim.readTerritory(), expected, w)).toEqual([]);
        for (let c = 0; c < w * h; c++) {
          const added = (expected[c] ?? 0) & ~(before[c] ?? 0);
          if (added & ~(got[c] ?? 0)) joined++;
          if (added & (got[c] ?? 0)) owned++;
        }
      }
      // Cells that joined by the chance of the agents beside them, and cells that joined because an agent held them.
      expect(joined).toBeGreaterThan(20);
      expect(owned).toBeGreaterThan(20);
    },
    120_000,
  );

  it.each(['wrap', 'box', 'dish'] as const)(
    'adds the open cells of a disc to the territory of a strain: the start territory (%s)',
    async (boundary) => {
      const [w, h] = [45, 38];
      const s = stage4({ boundary });
      const sim = await make(s, w, h, 64);
      sim.paint([{ kind: 'wall', from: [0, 14], to: [20, 14], radius: 1 }]);
      const g = await gridOf(sim, boundary);
      // The disc of the start layout Food and its rim; on the periodic grid across the seam.
      const r = Math.sqrt(100 / Math.PI) + TERRITORY.rim;
      const discs: [number, [number, number], number][] = [
        [0, [boundary === 'wrap' ? 2.3 : 12.3, 16.7], r],
        [1, [30.6, 22.1], r],
        [0, [33.1, 20.4], 3.4],
      ];
      let expected: Uint8Array = new Uint8Array(w * h);
      const unsure = new Set<number>();
      for (const [strain, at, radius] of discs) {
        sim.addTerritory(strain, at[0], at[1], radius);
        const next = addDisc(expected, g, strain, at, radius);
        expected = next.territory;
        for (const c of next.unsure) unsure.add(c);
      }
      const got = await sim.readTerritory();
      expect(differ(got, expected, w, unsure)).toEqual([]);
      expect(expected.filter((v) => v & 1).length).toBeGreaterThan(150);
      expect(expected.filter((v) => v & 2).length).toBeGreaterThan(150);
      // A reset clears it.
      sim.reset();
      expect((await sim.readTerritory()).every((v) => v === 0)).toBe(true);
    },
    120_000,
  );

  it('holds no territory while the rules of stage 4 do not run', async () => {
    const [w, h] = [33, 24];
    const sim = await make(stage4({ flow: false }), w, h, 64);
    sim.addTerritory(0, 10, 10, 6);
    sim.writeTerritory(new Uint8Array(w * h).fill(1));
    sim.run(1);
    expect((await sim.readTerritory()).every((v) => v === 0)).toBe(true);
    expect((await sim.readOwners()).every((v) => v === 0)).toBe(true);
  }, 60_000);
});
