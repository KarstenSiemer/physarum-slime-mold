// The flow in the tubes on both backends (ADR 0029), in Chromium with real GPU APIs (ADR 0010). Every strain has a
// flow of its own (ADR 0031).
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { defaultSettings, defaultStrain, type Settings, type Strain } from '../model/params';
import { FLOW, flowSites, packFlow } from './flow';
import { flowFlux, flowStart, flowStep, openCell, roleSigns, type FlowGrid } from './flow-reference';
import { WebGl2Backend } from './gl/backend';
import { compile } from './gl/programs';
import { AgentToolKind } from './pack';
import { GlSim } from './gl/sim';
import type { AgentState, Backend, Sim, Stroke } from './types';
import { WebGpuBackend } from './webgpu';

const BACKENDS = {
  webgpu: (c: HTMLCanvasElement): Promise<Backend> => WebGpuBackend.create(c),
  webgl2: (c: HTMLCanvasElement): Promise<Backend> => Promise.resolve(WebGl2Backend.create(c)),
};

const ALIVE = 4;
/** A tube of one cell along a line of cells: x0, y0, x1, y1. */
type Line = readonly [number, number, number, number];
/** An extended scene with the flow on: Jones' agent with the rule in a closed box. */
const flowing = (patch: Partial<Settings> = {}): Settings => ({
  ...defaultSettings(),
  model: 'extended',
  flow: true,
  flowStrength: 4,
  boundary: 'box',
  collisions: true,
  seed: 5,
  strains: [{ ...defaultStrain(0), sensorOffset: 5 }],
  ...patch,
});

describe.each(Object.entries(BACKENDS))('the flow in the tubes on %s', (kind, create) => {
  let backend: Backend;
  const live: Sim[] = [];

  beforeAll(async () => {
    backend = await create(document.createElement('canvas'));
    // The first simulation with the flow compiles its pipelines: here, under a long timeout. In the CI image on an
    // M3 Pro this hook took 45 s on WebGPU and 7 s on WebGL2 (2026-11-13), and GitHub runs SwiftShader's WebGPU
    // compute about twice as slowly: 600 s keeps it under a quarter of the limit (ADR 0010).
    const sim = await backend.createSim(flowing(), 16, 16, 8);
    sim.run(1);
    await sim.finish();
    sim.destroy();
  }, 600_000);
  afterEach(() => {
    for (const s of live.splice(0)) s.destroy();
  });
  afterAll(() => {
    backend.destroy();
  });

  async function make(settings: Settings, w: number, h: number, agents: number, start = agents) {
    const sim = await backend.createSim(settings, w, h, agents, start);
    live.push(sim);
    return sim;
  }

  /** How many living agents are in another place after `steps` steps: none if the steps did not run. */
  async function moved(sim: Sim, steps: number) {
    const before = await sim.readAgents();
    sim.run(steps);
    const after = await sim.readAgents();
    return before.filter((a, i) => {
      const b = after[i];
      return b !== undefined && (a.bits & ALIVE) !== 0 && (a.x !== b.x || a.y !== b.y);
    }).length;
  }

  /**
   * Six steps of the flow of the strain `strain` of a scene with the strains `strains`, against the CPU reference: the
   * memory and the pressure of every step.
   */
  async function followsReference(strains: Strain[], strain: number) {
    const [w, h] = [48, 40];
    const settings = flowing({ strains });
    const sim = await make(settings, w, h, 500);
    // A wall with a gap, and two foods on either side of it. The first food of the list lies under the wall: its
    // centre is a closed cell, so it never gives or takes, and the passes recentre the pressure by the next food.
    const strokes: Stroke[] = [
      { kind: 'food', from: [24.5, 10.5], to: [24.5, 10.5], radius: 2.5 },
      { kind: 'wall', from: [24, 0], to: [24, 24], radius: 1 },
      { kind: 'food', from: [8.5, 8.5], to: [8.5, 8.5], radius: 2.5 },
      { kind: 'food', from: [40.5, 30.5], to: [40.5, 30.5], radius: 2.5 },
    ];
    sim.paint(strokes);
    const centres: [number, number][] = [
      [24.5, 10.5],
      [8.5, 8.5],
      [40.5, 30.5],
    ];
    sim.foodSites(centres);
    sim.reset();
    const sites = flowSites(centres, w, h);
    const env = await sim.readEnv();
    const grid: FlowGrid = { width: w, height: h, boundary: 'box', env };
    let fields = flowStart(grid, FLOW.fresh);
    // Every cell but those of a block holds a tube from the start, so both foods give or take from the first step
    // on. The memory adapts from the second step on: a step reads which sites gave or took in the step before. The
    // cells of the block hold no tube: they take part in the pressure iteration only, with the ghost conductivity
    // and without the momentum (ADR 0029, decision 6).
    const bare = (c: number) => c % w >= 28 && Math.floor(c / w) < 18;
    for (let c = 0; c < w * h; c++) fields.memory[c * 4 + 1] = bare(c) ? 0 : 1;
    sim.writeFlow(fields.memory, strain);
    for (let step = 0; step < 6; step++) {
      sim.run(1);
      const trail = await sim.readTrail();
      const u = new Float32Array(packFlow(settings, sites, undefined, strain));
      fields = flowStep(grid, u, fields, trail, step, settings.seed);
      const [memory, pressure] = [await sim.readFlow(strain), await sim.readPressure(strain)];
      expect(memory.length).toBe(w * h * 4);
      let worst = 0;
      for (let i = 0; i < memory.length; i++)
        worst = Math.max(
          worst,
          Math.abs((memory[i] ?? 0) - (fields.memory[i] ?? 0)) / (1e-5 + Math.abs(fields.memory[i] ?? 0)),
        );
      expect(worst, `memory at step ${String(step)}`).toBeLessThan(1e-3);
      const top = fields.pressure.reduce((a, v) => Math.max(a, Math.abs(v)), 0);
      let off = 0;
      for (let i = 0; i < pressure.length; i++)
        off = Math.max(off, Math.abs((pressure[i] ?? 0) - (fields.pressure[i] ?? 0)));
      expect(top, 'a pressure builds up').toBeGreaterThan(0);
      expect(off / top, `pressure at step ${String(step)}`).toBeLessThan(1e-3);
      // The roles lie on the centre cells of the two foods beside the wall, and nowhere else.
      const roles = [...memory].flatMap((v, i) => (i % 4 === 3 && v !== 0 ? [(i - 3) / 4] : []));
      expect(roles).toEqual([8 * w + 8, 30 * w + 40]);
      // The centre of the first food of the list is a closed cell: it holds no pressure.
      expect(env[(10 * w + 24) * 4] ?? 0).toBeGreaterThanOrEqual(128);
      expect([0, 1, 2, 3].map((k) => pressure[(10 * w + 24) * 4 + k])).toEqual([0, 0, 0, 0]);
      // At the end cells of the block still conduct nothing, and they hold a pressure: that of the tubes beside
      // them.
      if (step < 5) continue;
      let ghosts = 0;
      for (let c = 0; c < w * h; c++)
        if (bare(c) && memory[c * 4 + 2] === 0 && Math.abs(pressure[c * 4] ?? 0) > 0.01 * top) ghosts++;
      expect(ghosts, 'cells without a tube that hold a pressure').toBeGreaterThan(100);
    }
  }

  it('follows the CPU reference: the memory and the pressure of every step', async () => {
    await followsReference([{ ...defaultStrain(0), sensorOffset: 5 }], 0);
  }, 120_000);

  it('follows the CPU reference for the third and the fourth of four strains', async () => {
    // Each strain has a layer or targets of its own for its passes: the passes of a strain must not run on the state
    // of another one.
    const four = [5, 2, 3, 8].map((deposit, i) => ({ ...defaultStrain(i), sensorOffset: 5, deposit }));
    await followsReference(four, 2);
    await followsReference(four, 3);
  }, 120_000);

  it('follows the CPU reference for the second of two strains, with the trail and the deposit of that strain', async () => {
    // The second strain deposits 2 where the first deposits 5: the levels of its trail are 0.4 and 2, not 1 and 5.
    const second = { ...defaultStrain(1), sensorOffset: 5, deposit: 2 };
    await followsReference([{ ...defaultStrain(0), sensorOffset: 5 }, second], 1);
  }, 120_000);

  /**
   * A simulation without diffusion and with almost no decay, so that the trail that the test writes stays: two foods
   * at (4, 12) and (35, 12), and tubes of one cell along lines: `lines` in the trail of the strain `lane`, and `other`
   * in the trail of the next strain. Its agents start dead, and the flow brings them to life on a fed tube: with a
   * deposit of 0 they leave no trail of their own. The memory, the pressure and the flux that it gives are those of
   * the flow of the strain `lane`; `of()` gives those of another strain.
   */
  async function tubes(
    lines: readonly Line[],
    steps: number,
    { strains = 1, agents = 1, lane = 0, other = [] as readonly Line[] } = {},
  ) {
    const [w, h] = [40, 24];
    const settings = flowing({
      layout: 'empty',
      collisions: false,
      diffusion: 0,
      flowStrength: 2,
      strains: Array.from({ length: strains }, (_, i) => ({ ...defaultStrain(i), decay: 0.0001, deposit: 0 })),
    });
    const sim = await make(settings, w, h, agents);
    const centres: [number, number][] = [
      [4.5, 12.5],
      [35.5, 12.5],
    ];
    sim.paint(centres.map((c): Stroke => ({ kind: 'food', from: c, to: c, radius: 0.75 })));
    sim.foodSites(centres);
    sim.reset();
    const cells = (list: readonly Line[]) => {
      const set = new Set<number>();
      for (const [x0, y0, x1, y1] of list)
        for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++)
          for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) set.add(y * w + x);
      return set;
    };
    const tube = cells(lines);
    const trail = new Float32Array(w * h * 4);
    for (const c of tube) trail[c * 4 + lane] = 10;
    for (const c of cells(other)) trail[c * 4 + lane + 1] = 10;
    sim.writeTrail(trail);
    for (let k = 0; k < steps; k += 100) {
      sim.run(100);
      await sim.finish();
    }
    const grid: FlowGrid = { width: w, height: h, boundary: 'box', env: await sim.readEnv() };
    const of = async (strain: number) => {
      const [memory, pressure] = [await sim.readFlow(strain), await sim.readPressure(strain)];
      return { memory, pressure, flux: flowFlux(grid, memory, pressure) };
    };
    return { sim, w, tube, grid, i0: settings.flowStrength, of, ...(await of(lane)) };
  }

  it('obeys Kirchhoff’s law, adapts a tube to f(Q) and lets a dead end starve', async () => {
    // One route between the foods over row 6, and a dead end up from it.
    const route = [
      [4, 6, 4, 12],
      [4, 6, 35, 6],
      [35, 6, 35, 12],
    ] as const;
    const { w, tube, memory, pressure, grid, i0, flux } = await tubes([...route, [20, 1, 20, 5]], 1500);
    // Kirchhoff: the fluxes over the edges of a cell sum to what the cell gives or takes, in every lane.
    const edge = (a: number, b: number) => (a <= 0 || b <= 0 ? 0 : (2 * a * b) / (a + b));
    let worst = 0;
    for (const c of tube) {
      const [x, y] = [c % w, Math.floor(c / w)];
      const signs = roleSigns(memory[c * 4 + 3] ?? 0);
      for (let k = 0; k < 4; k++) {
        let net = 0;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const nb = openCell(grid, x + dx, y + dy);
          if (nb < 0) continue;
          const g = edge(memory[c * 4 + 2] ?? 0, memory[nb * 4 + 2] ?? 0);
          net += g * ((pressure[c * 4 + k] ?? 0) - (pressure[nb * 4 + k] ?? 0));
        }
        worst = Math.max(worst, Math.abs(net - (signs[k] ?? 0) * i0));
      }
    }
    expect(worst / i0).toBeLessThan(0.01);
    // The site that gives and the site that takes, in every lane (two sites never swap).
    expect(roleSigns(memory[(12 * w + 4) * 4 + 3] ?? 0)).toEqual([1, 1, 1, 1]);
    expect(roleSigns(memory[(12 * w + 35) * 4 + 3] ?? 0)).toEqual([-1, -1, -1, -1]);
    // The whole flux I0 passes every cell of the route, and its memory is Tero's f(I0) = I0^gamma / (1 + I0^gamma)
    // (Tero 2007, Eq. 5 at rest). 1,500 steps at the rate 0.003 leave 1.1 % of the way from the fresh memory.
    const f = i0 ** FLOW.gamma / (1 + i0 ** FLOW.gamma);
    for (const c of [6 * w + 12, 6 * w + 28, 9 * w + 4]) {
      expect(flux[c * 4] ?? 0).toBeCloseTo(i0, 2);
      expect(memory[c * 4] ?? 0).toBeGreaterThan(f - 0.012);
      expect(memory[c * 4] ?? 0).toBeLessThan(f + 0.002);
    }
    // The dead end carries no flux and starves: its memory decays as exp(−t) (Tero 2007, Sec. 5.1), from the fresh
    // memory to below the level at which half of the agents on it would die.
    for (const y of [1, 2, 3, 4]) {
      const c = y * w + 20;
      expect(flux[c * 4] ?? 0).toBeLessThan(1e-3);
      expect(memory[c * 4] ?? 0).toBeLessThan(FLOW.half);
      expect(memory[c * 4] ?? 0).toBeGreaterThanOrEqual(FLOW.floor);
    }
  }, 240_000);

  it('lets a food give or take only when a tube covers it and one more food, and keeps the memory until then', async () => {
    // A tube from the first food that ends before the second food: one covered food alone has no role.
    const { tube, memory, pressure } = await tubes(
      [
        [4, 6, 4, 12],
        [4, 6, 30, 6],
      ],
      300,
    );
    expect(memory.some((v, i) => i % 4 === 3 && v !== 0)).toBe(false);
    // No site gives or takes: no pressure builds up anywhere, and no cell adapts.
    expect(pressure.every((v) => v === 0)).toBe(true);
    for (const c of tube) {
      expect(memory[c * 4 + 1] ?? 0).toBeGreaterThan(0.9);
      expect(memory[c * 4] ?? 0).toBe(Math.fround(FLOW.fresh));
    }
  }, 240_000);

  it('gives food without a tube no conductivity, so it holds no pressure of its own', async () => {
    // One route between the foods, and a third food beside it that no tube reaches.
    const [w, h] = [40, 24];
    const settings = flowing({
      layout: 'empty',
      collisions: false,
      diffusion: 0,
      flowStrength: 2,
      strains: [{ ...defaultStrain(0), decay: 0.0001, deposit: 0 }],
    });
    const sim = await make(settings, w, h, 1);
    const centres: [number, number][] = [
      [4.5, 12.5],
      [35.5, 12.5],
      [20.5, 18.5],
    ];
    sim.paint(centres.map((c): Stroke => ({ kind: 'food', from: c, to: c, radius: 1.5 })));
    sim.foodSites(centres);
    sim.reset();
    const trail = new Float32Array(w * h * 4);
    for (let x = 4; x <= 35; x++) trail[(12 * w + x) * 4] = 10;
    sim.writeTrail(trail);
    for (let k = 0; k < 600; k += 100) {
      sim.run(100);
      await sim.finish();
    }
    const [memory, pressure] = [await sim.readFlow(), await sim.readPressure()];
    const env = await sim.readEnv();
    // The two foods on the tube give and take; the third food has no role and conducts nowhere.
    const roles = [...memory].flatMap((v, i) => (i % 4 === 3 && v !== 0 ? [(i - 3) / 4] : []));
    expect(roles).toEqual([12 * w + 4, 12 * w + 35]);
    let foodCells = 0;
    for (let c = 0; c < w * h; c++) {
      if ((env[c * 4 + 1] ?? 0) === 0 || Math.abs((c % w) - 20) > 2 || Math.abs(Math.floor(c / w) - 18) > 2) continue;
      foodCells++;
      expect(memory[c * 4 + 2], `conductivity of food cell ${String(c)}`).toBe(0);
    }
    expect(foodCells).toBeGreaterThan(4);
    // Food cells on the tube conduct as food does: the conductivity of food times the tube body.
    expect(memory[(12 * w + 4) * 4 + 2] ?? 0).toBeGreaterThan(0.9 * FLOW.food);
    // The pressure of every cell stays within the pressure between the two sites: no part runs away.
    const span = Math.abs((pressure[(12 * w + 4) * 4] ?? 0) - (pressure[(12 * w + 35) * 4] ?? 0));
    expect(span).toBeGreaterThan(1);
    const top = pressure.reduce((a, v) => Math.max(a, Math.abs(v)), 0);
    expect(top).toBeLessThan(2 * span);
  }, 240_000);

  it('stops a food at its pressure limit when no tube joins it to the other food, so both tubes starve', async () => {
    // Each food holds a piece of tube of its own, and open ground lies between the two.
    const { w, memory, pressure, i0, flux } = await tubes(
      [
        [4, 8, 4, 12],
        [35, 8, 35, 12],
      ],
      600,
    );
    const [a, b] = [12 * w + 4, 12 * w + 35];
    // Both foods are covered, so one gives and the other takes.
    expect(roleSigns(memory[a * 4 + 3] ?? 0)).toEqual([1, 1, 1, 1]);
    expect(roleSigns(memory[b * 4 + 3] ?? 0)).toEqual([-1, -1, -1, -1]);
    // The pressure between them is almost twice the limit of a site and no more. Without the limit it is 20 times
    // as high here, and the whole flux I0 runs through the open ground (CPU copy, 2026-11-13).
    const limit = FLOW.head * i0;
    for (let k = 0; k < 4; k++) {
      const span = (pressure[a * 4 + k] ?? 0) - (pressure[b * 4 + k] ?? 0);
      expect(span).toBeGreaterThan(1.9 * limit);
      expect(span).toBeLessThanOrEqual(2 * limit);
    }
    const top = pressure.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    expect(top).toBeLessThanOrEqual(2 * limit);
    // So almost no flux passes the two pieces of tube, and their memory falls below the fresh memory: they starve.
    for (const c of [9 * w + 4, 11 * w + 4, 9 * w + 35, 11 * w + 35]) {
      expect(flux[c * 4] ?? 0).toBeLessThan(0.05 * i0);
      expect(memory[c * 4] ?? 0).toBeLessThan(0.3 * FLOW.fresh);
    }
  }, 240_000);

  it('sends more flux through the shorter of two tubes, and gives it the higher memory', async () => {
    // Two tubes between the foods: one over row 6, a longer one over row 20.
    const { w, flux, memory, i0 } = await tubes(
      [
        [4, 6, 4, 20],
        [35, 6, 35, 20],
        [4, 6, 35, 6],
        [4, 20, 35, 20],
      ],
      800,
    );
    const [short, long] = [6 * w + 20, 20 * w + 20];
    expect(flux[short * 4] ?? 0).toBeGreaterThan(flux[long * 4] ?? 0);
    expect(memory[short * 4] ?? 0).toBeGreaterThan(memory[long * 4] ?? 0);
    // Both together carry the flux I0 (the pressure lags the memory by a few per cent while the tubes compete).
    expect(((flux[short * 4] ?? 0) + (flux[long * 4] ?? 0)) / i0).toBeGreaterThan(0.93);
    expect(((flux[short * 4] ?? 0) + (flux[long * 4] ?? 0)) / i0).toBeLessThan(1.07);
  }, 240_000);

  it('brings a dead agent to life only on a tube of its own strain', async () => {
    // One route between the foods, in the trail of the second of two strains. Every agent starts dead.
    const route = [
      [4, 6, 4, 12],
      [4, 6, 35, 6],
      [35, 6, 35, 12],
    ] as const;
    const { sim, w, memory } = await tubes([...route], 1500, { strains: 2, agents: 400, lane: 1 });
    // The flux runs: the route has the memory at which the flow brings agents to life.
    expect(memory[(6 * w + 20) * 4] ?? 0).toBeGreaterThan(FLOW.birthFrom + 0.2);
    const [first, second] = await sim.alive();
    // The second strain owns the tube: most of its 200 agents live. No agent of the first strain comes to life: it
    // has no tube. Before, the flow gave life to the agents of every strain on any tube (the owner saw strains
    // appear in a scene that had no agent of them, 2026-11-13).
    expect(second).toBeGreaterThan(100);
    expect(first).toBe(0);
  }, 240_000);

  it('lets no flux pass from the tubes of one strain into the tubes of another', async () => {
    // One route between the foods in two halves that meet on row 6: the left half is in the trail of the first
    // strain, the right half in the trail of the second.
    const { w, tube, memory, pressure, of } = await tubes(
      [
        [4, 6, 4, 12],
        [4, 6, 19, 6],
      ],
      600,
      {
        strains: 2,
        other: [
          [20, 6, 35, 6],
          [35, 6, 35, 12],
        ],
      },
    );
    const second = await of(1);
    // Each strain holds its half as a tube, and no tube on the half of the other strain.
    const [left, right] = [6 * w + 10, 6 * w + 28];
    expect(memory[left * 4 + 1] ?? 0).toBeGreaterThan(0.9);
    expect(memory[right * 4 + 1] ?? 0).toBe(0);
    expect(second.memory[right * 4 + 1] ?? 0).toBeGreaterThan(0.9);
    expect(second.memory[left * 4 + 1] ?? 0).toBe(0);
    // So each strain covers one food. In neither flow a site gives or takes, no pressure builds up, and no cell
    // adapts. As one network of both strains, the two halves would carry the flux from food to food.
    for (const flow of [{ memory, pressure }, second]) {
      expect(flow.memory.some((v, i) => i % 4 === 3 && v !== 0)).toBe(false);
      expect(flow.pressure.every((v) => v === 0)).toBe(true);
    }
    for (const c of tube) expect(memory[c * 4] ?? 0).toBe(Math.fround(FLOW.fresh));
  }, 240_000);

  it('gives every strain its whole flux on its own route between the same foods', async () => {
    // Two routes between the foods: one over row 6 in the trail of the first strain, one over row 18 in the trail of
    // the second. Both hold the cells of the two sites.
    const { w, memory, flux, i0, of } = await tubes(
      [
        [4, 6, 4, 12],
        [4, 6, 35, 6],
        [35, 6, 35, 12],
      ],
      1500,
      {
        strains: 2,
        other: [
          [4, 12, 4, 18],
          [4, 18, 35, 18],
          [35, 12, 35, 18],
        ],
      },
    );
    const second = await of(1);
    const [upper, lower, give, take] = [6 * w + 20, 18 * w + 20, 12 * w + 4, 12 * w + 35];
    for (const flow of [{ memory }, second]) {
      expect(roleSigns(flow.memory[give * 4 + 3] ?? 0)).toEqual([1, 1, 1, 1]);
      expect(roleSigns(flow.memory[take * 4 + 3] ?? 0)).toEqual([-1, -1, -1, -1]);
    }
    // As two tubes of one network, the routes would share the flux I0. Each strain sends its whole flux along its
    // own route, and none along the route of the other strain, where it has no tube.
    expect(flux[upper * 4] ?? 0).toBeCloseTo(i0, 2);
    expect(flux[lower * 4] ?? 0).toBe(0);
    expect(second.flux[lower * 4] ?? 0).toBeCloseTo(i0, 2);
    expect(second.flux[upper * 4] ?? 0).toBe(0);
    const f = i0 ** FLOW.gamma / (1 + i0 ** FLOW.gamma);
    expect(memory[upper * 4] ?? 0).toBeGreaterThan(f - 0.012);
    expect(second.memory[lower * 4] ?? 0).toBeGreaterThan(f - 0.012);
  }, 240_000);

  it('lets an agent starve and come to life by the flow memory of its own strain', async () => {
    const [w, h] = [64, 64];
    // No food: no flux runs, and the memory that the test writes stays. Without the rule every draw can place. Four
    // strains with 10,000 living and 10,000 dead agents each.
    const strains = [0, 1, 2, 3].map((i) => ({ ...defaultStrain(i), sensorOffset: 5 }));
    const settings = flowing({ boundary: 'wrap', collisions: false, seed: 11, strains });
    const sim = await make(settings, w, h, 80_000, 40_000);
    // A tube of every strain everywhere, with another flow memory for each strain: starved for the first one, and fed
    // to three levels for the others. So each strain has a chance to starve and a chance of a birth of its own.
    const memories = [FLOW.floor, 0.9, 0.6, 0.75];
    memories.forEach((d, strain) => {
      const memory = new Float32Array(w * h * 4);
      for (let c = 0; c < w * h; c++) memory.set([d, 1, 0.5, 0], c * 4);
      sim.writeFlow(memory, strain);
    });
    const before = await sim.readAgents();
    sim.run(1);
    const after = await sim.readAgents();
    const alive = (a: AgentState) => (a.bits & ALIVE) !== 0;
    // Gone: dead after the step, or alive far away (it starved and came to life elsewhere in the same step). An agent
    // moves one cell per step, also around the edge of the periodic grid.
    const around = (d: number, n: number) => Math.min(Math.abs(d), n - Math.abs(d));
    const gone = (a: AgentState, b: AgentState) =>
      !alive(b) || Math.hypot(around(a.x - b.x, w), around(a.y - b.y, h)) > 2;
    const count = memories.map(() => ({ alive: 0, gone: 0, dead: 0, born: 0 }));
    before.forEach((a, i) => {
      const [b, of] = [after[i], count[a.bits & 3]];
      if (!b || !of) throw new Error('agent missing');
      if (alive(a)) {
        of.alive++;
        if (gone(a, b)) of.gone++;
      } else {
        of.dead++;
        if (alive(b)) of.born++;
      }
    });
    count.forEach((of, strain) => {
      const d = memories[strain] ?? 0;
      expect([of.alive, of.dead], `strain ${String(strain)}`).toEqual([10_000, 10_000]);
      // Starvation: death · half² / (D² + half²). About 2 % on the floor of the memory, and 2.5 to 5.6 in a million on
      // the fed levels: less than 0.06 agents of 10,000.
      const p = (FLOW.death * FLOW.half ** 2) / (d ** 2 + FLOW.half ** 2);
      const starving = Math.max(1.5, 6 * Math.sqrt(of.alive * p * (1 - p)));
      expect(Math.abs(of.gone - of.alive * p), `starved of strain ${String(strain)}`).toBeLessThan(starving);
      // Births: birth · (D − from) / (1 − from), and none below `from`: 0, 16, 4 and 10 % of the dead agents.
      const q = Math.max(0, (FLOW.birth * (d - FLOW.birthFrom)) / (1 - FLOW.birthFrom));
      const births = Math.max(0.5, 6 * Math.sqrt(of.dead * q * (1 - q)));
      expect(Math.abs(of.born - of.dead * q), `births of strain ${String(strain)}`).toBeLessThan(births);
    });
    // The chances lie far apart: a strain with the memory of another strain would miss its number.
    expect(count.map((of) => Math.round(of.born / 100))).toEqual([0, 16, 4, 10]);
  }, 120_000);

  it('lets agents starve on cells that the flux passed by, and brings dead agents to life on fed cells', async () => {
    const [w, h] = [64, 64];
    // No food: no flux runs, and the memory that the test writes stays. Without the rule every draw can place.
    const settings = flowing({ boundary: 'wrap', collisions: false, seed: 11 });
    const sim = await make(settings, w, h, 40_000, 20_000);
    // The left half starved, the right half fed; a tube everywhere.
    const memory = new Float32Array(w * h * 4);
    for (let c = 0; c < w * h; c++) memory.set(c % w < w / 2 ? [FLOW.floor, 1, 0.02, 0] : [0.9, 1, 0.9, 0], c * 4);
    sim.writeFlow(memory);
    const before = await sim.readAgents();
    sim.run(1);
    const after = await sim.readAgents();
    const left = (a: AgentState) => a.x < w / 2;
    const alive = (a: AgentState) => (a.bits & ALIVE) !== 0;
    // Gone: dead after the step, or alive far away (it starved and came to life elsewhere in the same step).
    const gone = (a: AgentState, b: AgentState) =>
      !alive(b) || Math.hypot(Math.abs(a.x - b.x) % (w - 4), Math.abs(a.y - b.y) % (h - 4)) > 4;
    let [leftAlive, leftGone, rightGone, born, bornLeft, dead] = [0, 0, 0, 0, 0, 0];
    before.forEach((a, i) => {
      const b = after[i];
      if (!b) throw new Error('agent missing');
      if (alive(a)) {
        if (left(a)) {
          leftAlive++;
          if (gone(a, b)) leftGone++;
        } else if (gone(a, b)) rightGone++;
      } else {
        dead++;
        if (alive(b)) {
          born++;
          if (left(b)) bornLeft++;
        }
      }
    });
    // Starvation: the chance death · half² / (D² + half²) is almost `death` on the floor of the memory.
    const p = (FLOW.death * FLOW.half ** 2) / (FLOW.floor ** 2 + FLOW.half ** 2);
    const sd = Math.sqrt(leftAlive * p * (1 - p));
    expect(leftAlive).toBeGreaterThan(8000);
    expect(Math.abs(leftGone - leftAlive * p)).toBeLessThan(6 * sd);
    expect(rightGone).toBeLessThanOrEqual(2);
    // Births: a dead agent draws a cell; in the right half it comes to life with birth · (D − from) / (1 − from).
    const q = 0.5 * ((FLOW.birth * (0.9 - FLOW.birthFrom)) / (1 - FLOW.birthFrom));
    expect(dead).toBe(20_000);
    expect(Math.abs(born - dead * q)).toBeLessThan(6 * Math.sqrt(dead * q * (1 - q)));
    expect(bornLeft).toBe(0);
  }, 120_000);

  it('brings dead agents to life by the flow also in a step in which a tool is held', async () => {
    const [w, h] = [64, 64];
    // No food: the memory that the test writes stays. The whole grid is fed and holds a tube. Without the rule every
    // draw can place.
    const settings = flowing({ boundary: 'wrap', collisions: false, seed: 11 });
    const sim = await make(settings, w, h, 40_000, 20_000);
    const memory = new Float32Array(w * h * 4);
    for (let c = 0; c < w * h; c++) memory.set([0.9, 1, 0.9, 0], c * 4);
    sim.writeFlow(memory);
    const before = await sim.readAgents();
    // Inoculate, held on a disc of 6 cells: it places each dead agent in the disc with the chance one half.
    const [cx, cy, r, revive] = [16, 16, 6, 0.5];
    sim.run(1, { kind: AgentToolKind.inoculate, x: cx, y: cy, radius: r, strain: 0, revive });
    const after = await sim.readAgents();
    const alive = (a: AgentState) => (a.bits & ALIVE) !== 0;
    let [dead, inside, outside] = [0, 0, 0];
    before.forEach((a, i) => {
      const b = after[i];
      if (!b) throw new Error('agent missing');
      if (alive(a)) return;
      dead++;
      if (!alive(b)) return;
      if (Math.hypot(b.x - cx, b.y - cy) <= r) inside++;
      else outside++;
    });
    expect(dead).toBe(20_000);
    // A dead agent that the tool does not place draws a cell of the flow, as in a step without a tool: it comes to
    // life with birth · (D − from) / (1 − from), anywhere on the grid (ADR 0029, decision 8).
    const q = (FLOW.birth * (0.9 - FLOW.birthFrom)) / (1 - FLOW.birthFrom);
    const disc = (Math.PI * r * r) / (w * h);
    const byFlow = dead * (1 - revive) * q;
    expect(Math.abs(outside - byFlow * (1 - disc))).toBeLessThan(6 * Math.sqrt(byFlow));
    // In the disc: the agents that the tool placed, and the few births of the flow that fall into it. An agent has one
    // placement per step, so no agent counts twice.
    const byTool = dead * revive;
    expect(Math.abs(inside - byTool - byFlow * disc)).toBeLessThan(6 * Math.sqrt(byTool * (1 - revive)));
  }, 120_000);

  it('keeps one agent per cell when the flow brings agents to life with the rule', async () => {
    const [w, h] = [48, 48];
    const settings = flowing({ boundary: 'box', collisions: true, seed: 3 });
    const sim = await make(settings, w, h, 2000, 600);
    const memory = new Float32Array(w * h * 4);
    for (let c = 0; c < w * h; c++) memory.set([0.95, 1, 0.9, 0], c * 4);
    let alive = 0;
    for (let k = 0; k < 8; k++) {
      // The memory again before every step: without food the update keeps the flow memory, but the body follows the trail.
      sim.writeFlow(memory);
      sim.run(1);
      const agents = (await sim.readAgents()).filter((a) => (a.bits & ALIVE) !== 0);
      const cells = new Set(agents.map((a) => Math.floor(a.y) * w + Math.floor(a.x)));
      expect(cells.size, `step ${String(k)}`).toBe(agents.length);
      alive = agents.length;
    }
    expect(alive).toBeGreaterThan(900);
  }, 120_000);

  it('brings dead agents of every strain to life with the rule, each on a cell of its own', async () => {
    const [w, h] = [48, 48];
    // Four strains with the rule of one agent per cell: 150 living and 350 dead agents each. The second and the
    // fourth strain are fed everywhere; the ground of the other two is fresh, where no agent comes to life.
    const strains = [0, 1, 2, 3].map((i) => ({ ...defaultStrain(i), sensorOffset: 5 }));
    const settings = flowing({ boundary: 'box', collisions: true, seed: 3, strains });
    const sim = await make(settings, w, h, 2000, 600);
    const start = await sim.alive();
    expect(start).toEqual([150, 150, 150, 150]);
    let alive = start;
    for (let k = 0; k < 8; k++) {
      // The memory again before every step: without food the update keeps the flow memory, but the body follows the
      // trail.
      strains.forEach((_, strain) => {
        const memory = new Float32Array(w * h * 4);
        for (let c = 0; c < w * h; c++) memory.set([strain % 2 === 1 ? 0.95 : FLOW.fresh, 1, 0.9, 0], c * 4);
        sim.writeFlow(memory, strain);
      });
      sim.run(1);
      const agents = (await sim.readAgents()).filter((a) => (a.bits & ALIVE) !== 0);
      const cells = new Set(agents.map((a) => Math.floor(a.y) * w + Math.floor(a.x)));
      expect(cells.size, `step ${String(k)}`).toBe(agents.length);
      alive = await sim.alive();
    }
    // A dead agent of a fed strain claims the cell that it draws, as a move does, and the settle pass places it there.
    // The two passes and the claim itself must read the memory of the same strain: else a claim is for another cell,
    // and no agent of that strain comes to life.
    expect(alive[1]).toBeGreaterThan(300);
    expect(alive[3]).toBeGreaterThan(300);
    expect(alive[0]).toBeLessThanOrEqual(150);
    expect(alive[2]).toBeLessThanOrEqual(150);
  }, 120_000);

  it('keeps stepping when the trail saturation or the walls change during a run with the flow', async () => {
    // With the rule of one agent per cell the pass `settle` places agents by the flow too. With the flow its pipeline
    // depends on the walls and on the trail saturation. On WebGPU a bind group belongs to its pipeline, so the group
    // of one variant must not serve another: the step would be invalid, and no pass of it would run (review of
    // 2026-11-13).
    const [w, h] = [48, 48];
    const settings = flowing({ seed: 3 });
    const sim = await make(settings, w, h, 2000, 600);
    const device = kind === 'webgpu' ? (backend as WebGpuBackend).gpu.device : undefined;
    device?.pushErrorScope('validation');
    // Four steps bind the passes at both parities of the buffers.
    expect(await moved(sim, 4)).toBeGreaterThan(300);
    // A trail saturation above 0: the agent passes that saturate the trail.
    sim.update({ ...settings, trailSaturation: 20 });
    expect(await moved(sim, 4), 'with a trail saturation').toBeGreaterThan(300);
    // The first wall: the agent passes whose sensors check for walls.
    sim.paint([{ kind: 'wall', from: [10, 10], to: [30, 10], radius: 1 }]);
    expect(await moved(sim, 4), 'with a wall').toBeGreaterThan(300);
    sim.update(settings);
    expect(await moved(sim, 4), 'without the trail saturation again').toBeGreaterThan(300);
    expect((await device?.popErrorScope())?.message).toBeUndefined();
  }, 120_000);

  it('keeps stepping when the rule, growth, the food or the flow itself change during a run', async () => {
    // Each change selects other passes or other buffers for the passes of the flow. The engine resets the simulation
    // after a change of the rule of one agent per cell (engine.ts RESET_KEYS).
    const [w, h] = [48, 48];
    const base = flowing({ seed: 4, density: 0.065, capacity: 0.65 });
    const sim = await make(base, w, h, 2000, 600);
    const device = kind === 'webgpu' ? (backend as WebGpuBackend).gpu.device : undefined;
    const food = (x: number): Stroke => ({ kind: 'food', from: [x, 30.5], to: [x, 30.5], radius: 3 });
    /** The state of the second strain as read right after the settings lost that strain. */
    let second: Promise<Float32Array> | undefined;
    const changes: [string, () => void][] = [
      ['at the start', () => undefined],
      [
        'with two foods: the scent is no longer empty',
        () => {
          sim.paint([food(12.5), food(36.5)]);
        },
      ],
      [
        'without the rule of one agent per cell',
        () => {
          sim.update({ ...base, collisions: false });
          sim.reset();
        },
      ],
      [
        'with the rule again',
        () => {
          sim.update(base);
          sim.reset();
        },
      ],
      [
        'with growth and shrinkage',
        () => {
          sim.update({ ...base, growth: true, growthEvery: 1, shrinkEvery: 1 });
        },
      ],
      [
        'without growth again',
        () => {
          sim.update(base);
        },
      ],
      [
        'with the flow off',
        () => {
          sim.update({ ...base, flow: false });
        },
      ],
      [
        'with the flow on again',
        () => {
          sim.update(base);
        },
      ],
      [
        'with a second strain: the flow gets the state of two strains',
        () => {
          sim.update({ ...base, strains: [...base.strains, { ...defaultStrain(1), sensorOffset: 5 }] });
          sim.reset();
        },
      ],
      [
        'with one strain again',
        () => {
          sim.update(base);
          // The settings no longer hold the second strain: its state is not read, also before the next step.
          second = sim.readFlow(1);
          sim.reset();
        },
      ],
      [
        'after a clear of the environment',
        () => {
          sim.clearEnvironment();
        },
      ],
      [
        'after a reset',
        () => {
          sim.reset();
        },
      ],
    ];
    device?.pushErrorScope('validation');
    for (const [what, change] of changes) {
      change();
      // A new strain has no state until the next step makes it.
      if (what.startsWith('with a second strain')) expect((await sim.readFlow(1)).length, what).toBe(0);
      expect(await moved(sim, 4), what).toBeGreaterThan(100);
      // The flow holds a state for each strain of the settings, and for no other.
      if (what.startsWith('with a second strain')) expect((await sim.readFlow(1)).length, what).toBe(w * h * 4);
      if (what.startsWith('with one strain again')) {
        expect((await second)?.length, what).toBe(0);
        expect((await sim.readFlow(1)).length, what).toBe(0);
      }
    }
    expect((await device?.popErrorScope())?.message).toBeUndefined();
    // The flow runs at the end: the simulation holds its memory.
    expect((await sim.readFlow()).length).toBe(w * h * 4);
  }, 240_000);

  it('lets no agent divide on a cell that the flux passed by (growth of Jones 2011)', async () => {
    const [w, h] = [96, 48];
    // Growth tested at every step, no shrinkage: 300 of 3,000 agents live at the start, spread over the box.
    const settings = flowing({ seed: 8, growth: true, growthEvery: 1, shrinkEvery: 0, density: 0.065, capacity: 0.65 });
    const far = 28;
    // Agents that live in the columns left of `far` after 12 steps and were dead at the start: children. `left` is the
    // flow memory of the left half, the right half is fresh ground. No food: the memory keeps these values.
    const children = async (left: number) => {
      const sim = await make(settings, w, h, 3000, 300);
      const memory = new Float32Array(w * h * 4);
      for (let c = 0; c < w * h; c++) memory.set([c % w < w / 2 ? left : FLOW.fresh, 1, 0.1, 0], c * 4);
      sim.writeFlow(memory);
      const before = await sim.readAgents();
      sim.run(12);
      const after = await sim.readAgents();
      const alive = (a: AgentState | undefined) => a !== undefined && (a.bits & ALIVE) !== 0;
      const born = after.filter((a, i) => alive(a) && !alive(before[i]));
      return { all: born.length, left: born.filter((a) => a.x < far).length };
    };
    // Fresh ground on both sides: the colony grows everywhere.
    const fresh = await children(FLOW.fresh);
    expect(fresh.all).toBeGreaterThan(300);
    expect(fresh.left).toBeGreaterThan(60);
    // The left half starved: no agent divides there. A child of the right half walks at most 12 cells in 12 steps, so
    // none reaches the columns left of `far`, 20 cells from the middle.
    const starved = await children(FLOW.floor);
    expect(starved.all).toBeGreaterThan(150);
    expect(starved.left).toBe(0);
    // Just above the level `half` an agent divides, just below it does not.
    expect((await children(FLOW.half * 1.01)).left).toBeGreaterThan(60);
    expect((await children(FLOW.half * 0.99)).left).toBe(0);
  }, 240_000);

  it('lets an agent divide by the flow memory of its own strain', async () => {
    const [w, h] = [96, 48];
    const strains = [0, 1, 2, 3].map((i) => ({ ...defaultStrain(i), sensorOffset: 5 }));
    const settings = flowing({
      seed: 8,
      growth: true,
      growthEvery: 1,
      shrinkEvery: 0,
      density: 0.13,
      capacity: 1,
      strains,
    });
    // The agents of each strain that live after 12 steps and were dead at the start: children. The whole ground of
    // the strains in `starved` starved; the ground of the others is fresh. No food: the memory keeps these values.
    const children = async (starved: readonly number[]) => {
      const sim = await make(settings, w, h, 4608, 600);
      strains.forEach((_, strain) => {
        const memory = new Float32Array(w * h * 4);
        const d = starved.includes(strain) ? FLOW.floor : FLOW.fresh;
        for (let c = 0; c < w * h; c++) memory.set([d, 1, 0.1, 0], c * 4);
        sim.writeFlow(memory, strain);
      });
      const before = await sim.readAgents();
      sim.run(12);
      const after = await sim.readAgents();
      const alive = (a: AgentState | undefined) => a !== undefined && (a.bits & ALIVE) !== 0;
      const born = after.filter((a, i) => alive(a) && !alive(before[i]));
      return strains.map((_, strain) => born.filter((a) => (a.bits & 3) === strain).length);
    };
    // All strains walk the same cells. Only a strain whose own ground is fresh has children. The two runs give each
    // strain another pair of grounds, so a strain with the memory of another strain would show.
    const grounds: readonly (readonly number[])[] = [
      [0, 2],
      [0, 1],
    ];
    for (const starved of grounds) {
      const born = await children(starved);
      born.forEach((n, strain) => {
        if (starved.includes(strain)) expect(n, `strain ${String(strain)} starved`).toBe(0);
        else expect(n, `strain ${String(strain)} on fresh ground`).toBeGreaterThan(40);
      });
    }
  }, 240_000);

  it('gives the same bytes for the same seed, and others for another seed', async () => {
    const [w, h] = [64, 48];
    const run = async (seed: number) => {
      const settings = flowing({ seed, density: 0.2 });
      const sim = await make(settings, w, h, Math.round(0.2 * w * h));
      const centres: [number, number][] = [
        [10.5, 10.5],
        [52.5, 38.5],
      ];
      sim.paint(centres.map((c): Stroke => ({ kind: 'food', from: c, to: c, radius: 2 })));
      sim.foodSites(centres);
      sim.reset();
      sim.run(150);
      return { agents: await sim.readAgents(), trail: await sim.readTrail(), flow: await sim.readFlow() };
    };
    const [a, b, c] = [await run(21), await run(21), await run(22)];
    expect(b.agents).toEqual(a.agents);
    expect(b.trail).toEqual(a.trail);
    expect(b.flow).toEqual(a.flow);
    expect(c.flow).not.toEqual(a.flow);
    // The flow ran: tubes have a body, and the memory left its start value.
    const bodies = a.flow.filter((_, i) => i % 4 === 1);
    expect(Math.max(...bodies)).toBeGreaterThan(0.5);
    expect(a.flow.some((v, i) => i % 4 === 0 && Math.abs(v - FLOW.fresh) > 0.01)).toBe(true);
  }, 240_000);

  it('holds no flow while the setting is off, and never in the Jones model', async () => {
    const off = await make(flowing({ flow: false }), 32, 32, 100);
    off.run(3);
    expect((await off.readFlow()).length).toBe(0);
    // A Jones model with the switch on, past constrain(): the simulation runs Jones' rules alone.
    const jones = await make(flowing({ model: 'jones' }), 32, 32, 100);
    jones.run(3);
    expect((await jones.readFlow()).length).toBe(0);
    // Switching the flow off frees its state.
    const sim = await make(flowing(), 32, 32, 100);
    sim.run(2);
    expect((await sim.readFlow()).length).toBe(32 * 32 * 4);
    sim.update(flowing({ flow: false }));
    sim.run(1);
    expect((await sim.readFlow()).length).toBe(0);
  }, 120_000);
});

// A device without EXT_float_blend has no rule of one agent per cell and no occupancy (ADR 0008). The flow needs
// neither: its passes draw without blending.
describe('the flow in the tubes on WebGL2 without float blending', () => {
  it('adapts the memory, lets agents starve and come to life, and gives the same bytes for a seed', async () => {
    const [w, h] = [64, 48];
    const context = document.createElement('canvas').getContext('webgl2');
    if (!context?.getExtension('EXT_color_buffer_float')) throw new Error('WebGL2 with float render targets needed');
    const programs = compile(context);
    const run = async (seed: number) => {
      const settings = flowing({ seed, collisions: false, density: 0.3 });
      const sim = new GlSim(context, programs, settings, w, h, 2 * Math.round(0.3 * w * h), false);
      const centres: [number, number][] = [
        [10.5, 10.5],
        [52.5, 38.5],
      ];
      sim.paint(centres.map((c): Stroke => ({ kind: 'food', from: c, to: c, radius: 2 })));
      sim.foodSites(centres);
      sim.reset();
      sim.run(400);
      const out = { agents: await sim.readAgents(), flow: await sim.readFlow() };
      sim.destroy();
      return out;
    };
    const [a, b] = [await run(31), await run(31)];
    expect(b.agents).toEqual(a.agents);
    expect(b.flow).toEqual(a.flow);
    // Both foods give or take: their centre cells hold their roles.
    const roles = [...a.flow].flatMap((v, i) => (i % 4 === 3 && v !== 0 ? [(i - 3) / 4] : []));
    expect(roles).toEqual([10 * w + 10, 38 * w + 52]);
    // The memory adapted: above the fresh value where the flux runs, below it elsewhere.
    const memory = a.flow.filter((_, i) => i % 4 === 0);
    expect(Math.max(...memory)).toBeGreaterThan(FLOW.fresh + 0.2);
    expect(Math.min(...memory)).toBeLessThan(FLOW.fresh / 2);
    context.getExtension('WEBGL_lose_context')?.loseContext();
  }, 240_000);
});
