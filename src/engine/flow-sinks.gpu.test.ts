// The flow takes the sinks of each strain on both backends (ADR 0070), in Chromium with real GPU APIs (ADR 0010): the
// pressure with the sinks and the sources, the adaptation while the front took flux, and the drift in the sensors,
// each against the CPU copy (flow-reference.ts), with two strains, in a dish with walls.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { defaultSettings, defaultStrain, type Settings } from '../model/params';
import { FLOW, FLOW_ITERATIONS, packFlow } from './flow';
import {
  drifted,
  flowPorts,
  flowPressure,
  flowStart,
  flowStep,
  flowUpdate,
  groundOf,
  openCell,
  sinksAndSources,
  takesOf,
  type FlowFields,
  type FlowGrid,
} from './flow-reference';
import { WebGl2Backend } from './gl/backend';
import { rngSeed, stream } from './growth-reference';
import { strainEnds } from './pack';
import { flowSites, NO_SITES, type FlowSites, type FoodStroke } from './sites';
import { RATE_ONE, SINK_STATE_LANES, SINKS, SUM_ONE } from './sinks';
import { DRIFT_BYTES_PER_CELL_GL, SINK_BYTES_PER_CELL, SINK_BYTES_PER_CELL_GL } from './sizing';
import { packTerritory } from './territory';
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
 * No growth test and no shrinkage test, no random shrinkage, no agent at the start.
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

/**
 * A memory of the flow for one strain: the flow memory `d`, and a full tube body where `tube` says so (writeFlow()). At
 * a memory of 0.5 or less no dead agent comes to life (docs/model.md, 8.5).
 */
function memoryOf(cells: number, tube: (c: number) => boolean, d = 0.9) {
  const m = new Float32Array(cells * 4);
  for (let c = 0; c < cells; c++) m.set([d, tube(c) ? 1 : 0, 0, 0], c * 4);
  return m;
}

/** The largest difference of two pressures, over the largest pressure of `want`, and that largest pressure. */
function offOf(got: Float32Array, want: Float32Array) {
  let [off, top] = [0, 0];
  for (let i = 0; i < want.length; i++) {
    off = Math.max(off, Math.abs((got[i] ?? 0) - (want[i] ?? 0)));
    top = Math.max(top, Math.abs(want[i] ?? 0));
  }
  return { off: off / top, top };
}

/** The largest relative difference of two memories (flow.gpu.test.ts). */
function worstOf(got: Float32Array, want: Float32Array) {
  let worst = 0;
  for (let i = 0; i < want.length; i++)
    worst = Math.max(worst, Math.abs((got[i] ?? 0) - (want[i] ?? 0)) / (1e-5 + Math.abs(want[i] ?? 0)));
  return worst;
}

/** The state of strain `strain` among the lanes of every strain (Sim.readSinkState()). */
const stateOf = (all: Float32Array, strain: number) =>
  all.subarray(strain * SINK_STATE_LANES, (strain + 1) * SINK_STATE_LANES);

/** The uniform block of the flow of a strain with the constants of stage 4, as the simulations write it. */
const blockOf = (s: Settings, sites: FlowSites, strain: number) =>
  new Float32Array(packTerritory(packFlow(s, sites, undefined, strain)));

/**
 * The pressure of a step from `fields` with what the sinks take and the sources give at each cell given by `extra`:
 * the ports, the update and the pressure iterations of flowStep(), with the update of `took`.
 */
function pressureWith(
  grid: FlowGrid,
  u: Float32Array,
  fields: FlowFields,
  trail: Float32Array,
  step: number,
  seed: number,
  sites: FlowSites,
  took: boolean,
  extraOf: (memory: Float32Array, ports: Int32Array) => Float32Array,
) {
  const ports = flowPorts(grid, u, sites.cells, fields);
  const memory = flowUpdate(grid, u, fields, trail, step, seed, ports, took);
  const extra = extraOf(memory, ports);
  let [pressure, before] = [fields.pressure, fields.before];
  for (let i = 0; i < FLOW_ITERATIONS; i++) {
    const next = flowPressure(grid, u, memory, pressure, before, i === 0 ? 1 : i === 1 ? 2 : 0, ports, extra);
    [before, pressure] = [pressure, next];
  }
  return pressure;
}

describe.each(Object.entries(BACKENDS))('the flow with the rules of stage 4 on %s (ADR 0070)', (kind, create) => {
  let backend: Backend;
  const live: Sim[] = [];

  beforeAll(async () => {
    backend = await create(document.createElement('canvas'));
    // The passes of the flow with the sinks, of the sinks, of the territory and of the agents compile here, under a
    // long timeout (flow.gpu.test.ts).
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

  it('takes the sinks and the sources in the pressure and adapts while the front took flux, as the CPU copy', async () => {
    // Two strains in a dish with a wall that has a gap. Strain 0 covers a food dab: one covered port gives what its
    // sinks take, and it has no roles (one site). Strain 1 covers no food: its tube cells give it. Neither strain has
    // two sites with a role, so a tube adapts only while the front of its strain took flux in the step before.
    const [w, h] = [48, 40];
    const n = w * h;
    const s = stage4({ boundary: 'dish', seed: 19 });
    const sim = await make({ ...s, collisions: false }, w, h, n);
    const food: FoodStroke[] = [[{ kind: 'food', from: [30, 26], to: [30, 26], radius: 1.5 }]];
    sim.paint(food.flat());
    const sites = flowSites(food, w, h, 'dish');
    sim.foodSites(sites);
    sim.paint([{ kind: 'wall', from: [24, 4], to: [24, 18], radius: 0.5 }]);
    sim.paint([{ kind: 'wall', from: [24, 24], to: [24, 36], radius: 0.5 }]);
    const env = await sim.readEnv();
    const rnd = random(29);
    seed(sim, s, env, rnd, (x, y) => (Math.hypot(x - 23.5, y - 19.5) < 17 && rnd() < 0.3 ? (x + y) % 2 : undefined));
    sim.update(s);
    const foodCell = (c: number) => (env[c * 4 + 1] ?? 0) > 0;
    const grid: FlowGrid = { width: w, height: h, boundary: 'dish', env };
    const fields = [0, 1].map((strain) => {
      const f = flowStart(grid, FLOW.fresh);
      f.memory = memoryOf(n, (c) => (strain === 0 ? foodCell(c) || rnd() < 0.8 : !foodCell(c) && rnd() < 0.8));
      sim.writeFlow(f.memory, strain);
      return f;
    });
    sim.writeTerritory(randomTerritory(n, 2, 0.55, random(31)));
    for (const strain of [0, 1])
      sim.writeSinks(
        Float32Array.from({ length: n }, () => Math.fround((rnd() < 0.5 ? -1 : 1) * rnd())),
        strain,
      );
    // Per strain the tube cells whose flow memory changed in the first step, and in the steps after it.
    const frozen = [0, 0];
    const adapted = [0, 0];
    for (let step = 0; step < 5; step++) {
      const before = await sim.readSinkState();
      const prior = [await sim.readFlow(0), await sim.readFlow(1)];
      sim.run(1);
      const [trail, state] = [await sim.readTrail(), await sim.readSinkState()];
      for (const strain of [0, 1]) {
        const at = `strain ${String(strain)}, step ${String(step)}`;
        const u = blockOf(s, sites, strain);
        const old = fields[strain] ?? flowStart(grid, FLOW.fresh);
        const took = stateOf(before, strain)[4] === 1;
        const sinks = { took, rates: await sim.readSinks(strain), state: stateOf(state, strain) };
        // Every step the front of each strain takes flux; before the first step it took none.
        expect(sinks.state[4], at).toBe(1);
        expect(took, at).toBe(step > 0);
        const next = flowStep(grid, u, old, trail, step, s.seed, sites.cells, sinks);
        const [memory, pressure] = [await sim.readFlow(strain), await sim.readPressure(strain)];
        expect(worstOf(memory, next.memory), `memory, ${at}`).toBeLessThan(1e-3);
        const { off, top } = offOf(pressure, next.pressure);
        expect(top, `a pressure, ${at}`).toBeGreaterThan(0);
        expect(off, `pressure, ${at}`).toBeLessThan(1e-3);
        // The CPU copy without the sinks gives another pressure: the test sees them.
        const without = flowStep(grid, u, old, trail, step, s.seed, sites.cells);
        expect(offOf(without.pressure, next.pressure).off, `without the sinks, ${at}`).toBeGreaterThan(0.1);
        // The open tube cells whose flow memory changed in the step: none in the first step, many from the second on.
        const was = prior[strain] ?? new Float32Array(0);
        let moved = 0;
        for (let c = 0; c < n; c++) {
          const tube = (was[c * 4 + 1] ?? 0) >= FLOW.bodyLow && openCell(grid, c % w, Math.floor(c / w)) >= 0;
          if (tube && memory[c * 4] !== was[c * 4]) moved++;
        }
        if (step === 0) frozen[strain] = moved;
        else adapted[strain] = (adapted[strain] ?? 0) + moved;
        fields[strain] = next;
      }
    }
    // The covered port of strain 0, and none of strain 1.
    const state = await sim.readSinkState();
    expect([stateOf(state, 0)[3], stateOf(state, 1)[3]]).toEqual([1, 0]);
    expect(frozen).toEqual([0, 0]);
    for (const k of adapted) expect(k).toBeGreaterThan(500);
  }, 120_000);

  it('keeps the flow memory of a tube while its strain has no sink and fewer than two sites with a role', async () => {
    const [w, h] = [40, 32];
    const n = w * h;
    const s = stage4({ boundary: 'box', seed: 37 });
    const sim = await make({ ...s, collisions: false }, w, h, 64);
    const food: FoodStroke[] = [[{ kind: 'food', from: [20, 16], to: [20, 16], radius: 1.5 }]];
    sim.paint(food.flat());
    sim.foodSites(flowSites(food, w, h, 'box'));
    sim.update(s);
    const memory = memoryOf(n, () => true);
    sim.writeFlow(memory, 0);
    sim.writeTerritory(new Uint8Array(n).fill(3));
    for (let step = 0; step < 3; step++) {
      sim.run(1);
      expect(stateOf(await sim.readSinkState(), 0)[4]).toBe(0);
    }
    const after = await sim.readFlow(0);
    let tubes = 0;
    for (let c = 0; c < n; c++)
      if ((after[c * 4 + 1] ?? 0) >= FLOW.bodyLow) {
        tubes++;
        expect(after[c * 4], `cell ${String(c)}`).toBe(memory[c * 4]);
      }
    expect(tubes).toBeGreaterThan(n / 2);
    // No sink takes and no source gives: no pressure.
    expect((await sim.readPressure(0)).every((v) => v === 0)).toBe(true);
  }, 120_000);

  it('lets the sinks take exactly what the sources give, with the rates as R counted them', async () => {
    // A box full of tube cells of strain 0 whose rates fall to 127 steps of 2^-24 in the step: R counts none of them,
    // and two sinks at the edge of the territory take all of S. With its own rate each such cell would take a share
    // too, and the sinks would take more than twice what the sources give. Each sink heads out of the territory and
    // stays in its cell. The flow memory 0.5 brings no dead agent to life.
    const [w, h] = [64, 48];
    const n = w * h;
    const s = stage4({ boundary: 'box', seed: 43 });
    const sim = await make({ ...s, collisions: false }, w, h, 64);
    const env = await sim.readEnv();
    for (const [i, y] of [16, 32].entries()) sim.writeAgent(i, { x: 59.5, y: y + 0.5, heading: 0, bits: ALIVE });
    sim.update(s);
    const grid: FlowGrid = { width: w, height: h, boundary: 'box', env };
    const fields = flowStart(grid, FLOW.fresh);
    fields.memory = memoryOf(n, () => true, 0.5);
    sim.writeFlow(fields.memory, 0);
    // The territory of strain 0 ends at x = 60.
    sim.writeTerritory(Uint8Array.from({ length: n }, (_, c) => (c % w < 60 ? 1 : 0)));
    // 129 − ⌈129 / 100⌉ = 127.
    sim.writeSinks(new Float32Array(n).fill(129 / RATE_ONE), 0);
    sim.run(1);
    const [trail, rates, all] = [await sim.readTrail(), await sim.readSinks(0), await sim.readSinkState()];
    const state = stateOf(all, 0);
    expect(state[2]).toBe(2);
    expect(Array.from(rates).filter((r) => r * RATE_ONE === 127).length).toBe(n - 2);
    const u = blockOf(s, NO_SITES, 0);
    const want = flowStep(grid, u, fields, trail, 0, s.seed, NO_SITES.cells, { took: false, rates, state });
    const got = await sim.readPressure(0);
    expect(offOf(got, want.pressure).off).toBeLessThan(1e-3);
    // With its own rate a sink takes another share: the pressure is another one, far beyond the tolerance.
    const total = Math.fround(SINKS.take * s.flowStrength);
    const own = (memory: Float32Array) => {
      const out = new Float32Array(n);
      for (let c = 0; c < n; c++)
        if ((memory[c * 4 + 2] ?? 0) > 0)
          out[c] = total / (state[1] ?? 1) - (total * Math.abs(rates[c] ?? 0)) / (state[0] ?? 1);
      return out;
    };
    let rest = 0;
    for (const v of own(want.memory)) rest += v;
    expect(-rest / total).toBeGreaterThan(1);
    const wrong = pressureWith(grid, u, fields, trail, 0, s.seed, NO_SITES, false, own);
    expect(offOf(got, wrong).off).toBeGreaterThan(1e-2);
    // As the CPU copy computes it: the sources give what the sinks take.
    const extra = sinksAndSources(u, want.memory, want.ports, rates, state);
    expect(Math.abs(extra.reduce((a, v) => a + v, 0))).toBeLessThan(1e-6 * total);
  }, 120_000);

  it('lets the sinks take exactly what the sources give also when R is large: its low word wraps', async () => {
    // Every cell a tube cell of strain 0 with a rate of 0.9 to 1: R passes 2^32 steps of 2^-16. Two sinks at the edge of
    // the territory, each heading out of it. Each cell takes the share of its rate, and the colony gives S / C at each:
    // with rates that differ, what is left at a cell lies far above the rounding of float32. R from the low word alone
    // would give every cell 4 times its share.
    const [w, h] = [320, 256];
    const n = w * h;
    const s = stage4({ seed: 47 });
    const sim = await make({ ...s, collisions: false }, w, h, 64);
    const env = await sim.readEnv();
    for (const [i, y] of [100, 140].entries())
      sim.writeAgent(i, { x: 1.5, y: y + 0.5, heading: Math.fround(Math.PI), bits: ALIVE });
    sim.update(s);
    const grid: FlowGrid = { width: w, height: h, boundary: 'wrap', env };
    const fields = flowStart(grid, FLOW.fresh);
    fields.memory = memoryOf(n, () => true, 0.5);
    sim.writeFlow(fields.memory, 0);
    sim.writeTerritory(Uint8Array.from({ length: n }, (_, c) => (c % w > 0 ? 1 : 0)));
    const rnd = random(71);
    sim.writeSinks(
      Float32Array.from({ length: n }, () => Math.fround(0.9 + 0.1 * rnd())),
      0,
    );
    sim.run(1);
    const [trail, rates, all, sums] = [
      await sim.readTrail(),
      await sim.readSinks(0),
      await sim.readSinkState(),
      await sim.readSinkSums(),
    ];
    const state = stateOf(all, 0);
    expect(sums[1]).toBeGreaterThan(0);
    expect(state[2]).toBe(2);
    expect(state[0]).toBeGreaterThan(65_536);
    const u = blockOf(s, NO_SITES, 0);
    const want = flowStep(grid, u, fields, trail, 0, s.seed, NO_SITES.cells, { took: false, rates, state });
    const got = await sim.readPressure(0);
    expect(offOf(got, want.pressure).off).toBeLessThan(1e-3);
    // R of the low word alone: another pressure, far beyond the tolerance.
    const low = [...state];
    low[0] = (sums[0] ?? 0) / SUM_ONE;
    expect((state[0] ?? 0) / low[0]).toBeGreaterThan(4);
    const wrong = pressureWith(grid, u, fields, trail, 0, s.seed, NO_SITES, false, (memory, ports) =>
      sinksAndSources(u, memory, ports, rates, low),
    );
    expect(offOf(got, wrong).off).toBeGreaterThan(1e-2);
  }, 180_000);

  /**
   * The case of the drift (ADR 0075): agents of both strains in the middle of their cells, heading along x, with the
   * sensors 9 cells ahead and 45° to each side (sim.gpu.test.ts, the agent rule); no trail, no food, a territory of
   * every cell, so every move goes. Each strain has a tube on half of the cells, of the conductivity 1 or 2, a sink
   * rate of k / 16 on every cell (k from 0 to 15, with a sign and a rest that R rounds away), and a pressure of whole
   * numbers in every lane: so take / G and every value that a sensor reads are exact. Strain 0 takes flux with R = 16,
   * strain 1 with R = 8 takes none. `shift`: a pressure added to every lane of every tube cell, + for strain 0 and −
   * for strain 1. The memory 0.5 lets almost no agent starve and no dead agent come to life.
   */
  async function driftCase(drift: number, shift = 0) {
    const [w, h] = [64, 64];
    const n = w * h;
    const RA = 30;
    const strains = TWO.map((st) => ({ ...st, sensorAngle: 45, rotationAngle: RA, sensorOffset: 9, randomTurn: 0 }));
    const s = stage4({ seed: 53, strains, drift });
    const sim = await make({ ...s, collisions: false }, w, h, 512);
    const ends = strainEnds(s.strains, sim.agents);
    const placed: { id: number; x: number; y: number; strain: number }[] = [];
    for (let y = 2; y < h; y += 4)
      for (let x = 2; x < w; x += 4) {
        const strain = (x + y) % 8 === 0 ? 0 : 1;
        const id = (ends[strain - 1] ?? 0) + placed.filter((p) => p.strain === strain).length;
        placed.push({ id, x, y, strain });
        sim.writeAgent(id, { x: x + 0.5, y: y + 0.5, heading: 0, bits: strain | ALIVE });
      }
    sim.update(s);
    sim.writeTerritory(new Uint8Array(n).fill(3));
    const rnd = random(61);
    const memories = [0, 1].map((strain) => {
      const m = new Float32Array(n * 4);
      for (let c = 0; c < n; c++) {
        const tube = rnd() < 0.5;
        m.set([0.5, tube ? 1 : 0, tube ? (rnd() < 0.5 ? 1 : 2) : 0, 0], c * 4);
      }
      sim.writeFlow(m, strain);
      return m;
    });
    const rates = [0, 1].map((strain) => {
      const r = Float32Array.from(
        { length: n },
        () => ((rnd() < 0.5 ? -1 : 1) * (Math.floor(rnd() * 16) * 2 ** 20 + Math.floor(rnd() * 201) - 100)) / RATE_ONE,
      );
      sim.writeSinks(r, strain);
      return r;
    });
    const state = new Float32Array(SINK_STATE_LANES * 2);
    state.set([16, 0, 0, 0, 1, 0, 0, 0], 0);
    state.set([8, 0, 0, 0, 0, 0, 0, 0], SINK_STATE_LANES);
    sim.writeSinkState(state);
    const pressures = [0, 1].map((strain) => {
      const p = Float32Array.from({ length: n * 4 }, () => Math.floor(rnd() * 8));
      const tubes = memories[strain] ?? new Float32Array(0);
      for (let c = 0; c < n; c++)
        if ((tubes[c * 4 + 2] ?? 0) > 0)
          for (let k = 0; k < 4; k++) p[c * 4 + k] = (p[c * 4 + k] ?? 0) + (strain === 0 ? shift : -shift);
      sim.writePressure(p, strain);
      return p;
    });
    const takes = [0, 1].map((strain) =>
      takesOf(
        blockOf(s, NO_SITES, strain),
        memories[strain] ?? new Float32Array(0),
        rates[strain] ?? new Float32Array(0),
        stateOf(state, strain),
      ),
    );
    sim.run(1);
    const agents = await sim.readAgents();
    /** What the sensors of an agent read (agents.wgsl steer()): forward, left and right. */
    const reads = (x: number, y: number, strain: number, form: 'take' | 'all' | 'no take') => {
      const [m, p, t] = [memories[strain], pressures[strain], takes[strain]];
      if (!m || !p || !t) throw new Error(`no strain ${String(strain)}`);
      const at = (cx: number, cy: number) => (((cy % h) + h) % h) * w + (((cx % w) + w) % w);
      const tube = (c: number) => (m[c * 4 + 2] ?? 0) > 0;
      const lanes = (c: number) => p.subarray(c * 4, c * 4 + 4);
      const a = at(x, y);
      const ground = groundOf(tube(a), lanes(a), form === 'no take' ? 0 : (t[a] ?? 0), 9);
      return [at(x + 9, y), at(x + 6, y - 6), at(x + 6, y + 6)].map((c) =>
        form === 'all'
          ? drifted(0, Math.fround(drift), 0, true, lanes(c))
          : drifted(0, Math.fround(drift), ground, tube(c), lanes(c)),
      );
    };
    const tubeAgent = (x: number, y: number, strain: number) => (memories[strain]?.[(y * w + x) * 4 + 2] ?? 0) > 0;
    return { s, sim, agents, placed, reads, tubeAgent, takes, RA };
  }

  it('counts the memory of what the sensors read on its backend (ADR 0075)', () => {
    // WebGPU holds take / G in a layer per strain of the sinks; WebGL2 the mean pressures and take / G in two targets.
    const gl = kind === 'webgl2';
    expect(backend.sinkBytesPerCell).toBe(gl ? SINK_BYTES_PER_CELL_GL : SINK_BYTES_PER_CELL);
    expect(backend.driftBytesPerCell).toBe(gl ? DRIFT_BYTES_PER_CELL_GL : 0);
  });

  /** The turn of steer() in agents.wgsl from the values of its sensors: 0 keep, 1 right, −1 left, 2 a random turn. */
  const turnOf = ([f = 0, l = 0, r = 0]: number[]) =>
    f > l && f > r ? 0 : f < l && f < r ? 2 : l < r ? 1 : r < l ? -1 : 0;

  it('turns an agent by the pressure on the tubes of its strain and by what its sink takes, times the drift', async () => {
    for (const drift of [1.5, 0]) {
      const { s, sim, agents, placed, reads, tubeAgent, takes, RA } = await driftCase(drift);
      const ra = Math.fround((RA * Math.PI) / 180);
      const counts = { keep: 0, left: 0, right: 0, random: 0, offTube: 0, byTake: 0, dead: 0 };
      for (const { id, x, y, strain } of placed) {
        const agent = agents[id];
        if (!agent || (agent.bits & ALIVE) === 0) {
          counts.dead++;
          continue;
        }
        let turn = turnOf(reads(x, y, strain, 'take'));
        if (turn === 2) turn = stream(rngSeed(id, 0, 0, s.seed))() < 0.5 ? 1 : -1;
        if (!tubeAgent(x, y, strain)) counts.offTube++;
        else if (turn === 0) counts.keep++;
        else if (Math.abs(turnOf(reads(x, y, strain, 'take'))) === 2) counts.random++;
        else if (turn > 0) counts.right++;
        else counts.left++;
        // An agent on a tube of strain 0 whose sink takes, and whose turn the take decides.
        if (turnOf(reads(x, y, strain, 'take')) !== turnOf(reads(x, y, strain, 'no take'))) counts.byTake++;
        const want = turn === 0 ? 0 : turn > 0 ? ra : 2 * Math.PI - ra;
        expect(
          Math.abs(agent.heading - want),
          `agent ${String(id)} at (${String(x)}, ${String(y)}), drift ${String(drift)}`,
        ).toBeLessThan(1e-5);
      }
      expect(counts.dead, `drift ${String(drift)}`).toBeLessThan(3);
      // Half of the agents lie on a tube of their strain. The sink of strain 0 takes at a cell, and that of strain 1
      // takes nothing: its front takes no flux.
      expect(counts.offTube).toBeGreaterThan(80);
      expect(Math.max(...(takes[0] ?? [])), 'strain 0 takes').toBeGreaterThan(0);
      expect(
        (takes[1] ?? []).every((v) => v === 0),
        'strain 1 takes nothing',
      ).toBe(true);
      if (drift > 0) {
        for (const k of ['keep', 'left', 'right', 'random'] as const) expect(counts[k], k).toBeGreaterThan(5);
        expect(counts.byTake).toBeGreaterThan(5);
      } else expect(counts.keep + counts.offTube + counts.dead).toBe(placed.length);
      sim.destroy();
      live.splice(live.indexOf(sim), 1);
    }
  }, 120_000);

  it('changes no move when the pressure of every tube cell of a strain moves by the same amount', async () => {
    // The level of a network against its ground (ADR 0072, finding 3; ADR 0074): a sensor off the tubes reads no
    // pressure of its own cell, so a shift of the pressure of the tubes of a strain shifts every value that an agent on
    // a tube reads alike. With the form of before, where every sensor read the pressure of its cell, the shift turns
    // many agents otherwise.
    const runs = [];
    for (const shift of [0, 200]) {
      const run = await driftCase(1.5, shift);
      runs.push(run);
    }
    const [base, shifted] = runs;
    if (!base || !shifted) throw new Error('two runs');
    let [turned, before] = [0, 0];
    for (const { id, x, y, strain } of base.placed) {
      const [a, b] = [base.agents[id], shifted.agents[id]];
      expect(b, `agent ${String(id)}`).toEqual(a);
      if (turnOf(base.reads(x, y, strain, 'take')) !== 0) turned++;
      if (turnOf(base.reads(x, y, strain, 'all')) !== turnOf(shifted.reads(x, y, strain, 'all'))) before++;
    }
    expect(turned).toBeGreaterThan(40);
    expect(before).toBeGreaterThan(20);
  }, 120_000);
});
