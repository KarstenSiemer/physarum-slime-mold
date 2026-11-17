// The flow in the tubes on both backends (ADR 0029), in Chromium with real GPU APIs (ADR 0010). Every strain has a
// flow of its own (ADR 0031).
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { packDrawing, unpackDrawing } from '../model/link';
import { defaultSettings, defaultStrain, type Boundary, type Settings, type Strain } from '../model/params';
import { fromStroke, strokeOn } from './environment';
import { FLOW, packFlow } from './flow';
import { at } from './at';
import { flowFlux, flowStart, flowStep, openCell, roleSigns, type FlowFields, type FlowGrid } from './flow-reference';
import { WebGl2Backend } from './gl/backend';
import { compile } from './gl/programs';
import { growthStep } from './growth-reference';
import { AgentToolKind, strainEnds, type AgentTool } from './pack';
import { GlSim } from './gl/sim';
import { flowSites, foodStrokes, type FlowSites, type FoodStroke } from './sites';
import type { AgentState, Backend, Sim, Stroke } from './types';
import { WebGpuBackend } from './webgpu';

const BACKENDS = {
  webgpu: (c: HTMLCanvasElement): Promise<Backend> => WebGpuBackend.create(c),
  webgl2: (c: HTMLCanvasElement): Promise<Backend> => Promise.resolve(WebGl2Backend.create(c)),
};

const ALIVE = 4;
/** A tube of one cell along a line of cells: x0, y0, x1, y1. */
type Line = readonly [number, number, number, number];
/** A food dab of `radius` cells at `at`. */
const dab = (at: [number, number], radius: number): FoodStroke => [{ kind: 'food', from: at, to: at, radius }];
/**
 * Paints food strokes into a simulation and gives it their sites, as the engine does after a paint (ADR 0029,
 * decision 17): a site per stroke, with the cells that it paints.
 */
function feed(sim: Sim, strokes: readonly FoodStroke[], boundary: Boundary = 'box'): FlowSites {
  sim.paint(strokes.flat());
  const sites = flowSites(strokes, sim.width, sim.height, boundary);
  sim.foodSites(sites);
  return sites;
}
/** The cells that hold a role in a memory (4 values per cell). */
const roleCells = (memory: Float32Array) =>
  [...memory].flatMap((v, i) => (i % 4 === 3 && v !== 0 ? [(i - 3) / 4] : []));
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
    // A wall with a gap, painted over foods on either side of it. The first food of the list lies under the wall, a
    // dab of one cell: it never gives or takes, and the passes recentre the pressure by the next food. The second food
    // lies half under the wall: its open cells hold its port. The fifth lies at the edge of the block without a tube
    // (below): its port is the covered cell nearest its centre, not its centre. The sixth is painted over the wall:
    // its cells under the wall hold food and stay closed, so its port is an open cell beside them.
    const foods = [
      dab([24.5, 10.5], 0.75),
      dab([24.5, 20.5], 2.5),
      dab([8.5, 8.5], 2.5),
      dab([40.5, 30.5], 2.5),
      dab([29.5, 17.5], 2.5),
    ];
    const over = dab([24.5, 4.5], 1.5);
    sim.paint(foods.flat());
    sim.paint([{ kind: 'wall', from: [24, 0], to: [24, 24], radius: 1 }]);
    sim.paint(over);
    const sites = flowSites([...foods, over], w, h, 'box');
    sim.foodSites(sites);
    sim.reset();
    expect(sites.list.map((s) => s.count)).toEqual([1, 21, 21, 21, 21, 9]);
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
      fields = flowStep(grid, u, fields, trail, step, settings.seed, sites.cells);
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
      // The roles lie on the ports of the reference, and on none of the first food. At the start the fourth food has
      // its port on the cell below its centre: the cells around the centre hold no tube.
      const roles = roleCells(memory);
      expect(roles).toEqual(roleCells(fields.memory));
      if (step === 0) {
        const ports = [-1, 20 * w + 25, 8 * w + 8, 30 * w + 40, 18 * w + 29, 4 * w + 25];
        expect(fields.ports.subarray(0, 12)).toEqual(Int32Array.from(ports.flatMap((c) => [c, -1])));
        expect(roles.length).toBe(5);
        expect(env[(4 * w + 24) * 4 + 1] ?? 0).toBe(255);
      }
      expect(roles).not.toContain(10 * w + 24);
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
   * at (4, 12) and (35, 12) of one cell each, or the strokes `foods`, and tubes of one cell along lines: `lines` in
   * the trail of the strain `lane`, and `other` in the trail of the next strain. Its agents start dead, and the flow
   * brings them to life on a fed tube: with a deposit of 0 they leave no trail of their own. The memory, the pressure
   * and the flux that it gives are those of the flow of the strain `lane`; `of()` gives those of another strain.
   */
  async function tubes(
    lines: readonly Line[],
    steps: number,
    {
      strains = 1,
      agents = 1,
      lane = 0,
      other = [] as readonly Line[],
      foods = [dab([4.5, 12.5], 0.75), dab([35.5, 12.5], 0.75)] as readonly FoodStroke[],
    } = {},
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
    const sites = feed(sim, foods);
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
    return { sim, w, tube, grid, sites, cells, i0: settings.flowStrength, of, ...(await of(lane)) };
  }

  it('makes one food site of a dragged line of food, with its port at the covered cell nearest its start', async () => {
    // A line of food dragged up column 4 from row 12 to row 2: ten segments and the dab of its first one, recorded as
    // the engine records them, and held in a link made before decision 17 (ADR 0021). The tube covers the line only
    // from row 6 up, and joins it to a dab at (35, 12).
    const drag = Array.from({ length: 11 }, (_, k): Stroke => {
      const [y0, y1] = [12.5 - Math.max(0, k - 1), 12.5 - k];
      return { kind: 'food', from: [4.5, y0], to: [4.5, y1], radius: 0.75 };
    });
    const list = [...drag, ...dab([35.5, 12.5], 0.75)].map((s) => fromStroke(s, [40, 24], 'box'));
    const bytes = packDrawing({ scene: '', revision: 0, origins: [0], shapes: [], strokes: list });
    const link = unpackDrawing(bytes ?? new Uint8Array());
    const strokes = foodStrokes(link?.strokes ?? []).map((st) => st.flatMap((e) => strokeOn(e, 40, 24) ?? []));
    expect(strokes.map((st) => st.length)).toEqual([11, 1]);
    const route = [
      [4, 2, 4, 6],
      [4, 6, 35, 6],
      [35, 6, 35, 12],
    ] as const;
    const { w, memory, flux, i0, sites } = await tubes(route, 1500, { foods: strokes });
    // Two sites: the line with its 11 cells, and the dab.
    expect(sites.list.map((s) => s.count)).toEqual([11, 1]);
    // Two sites give or take, so the line gives in every lane and the dab takes: one cell each, the line at row 6.
    // Before, each segment of the line was a site: five of them covered, each with a flux of its own.
    expect(roleCells(memory)).toEqual([6 * w + 4, 12 * w + 35]);
    expect(roleSigns(memory[(6 * w + 4) * 4 + 3] ?? 0)).toEqual([1, 1, 1, 1]);
    expect(roleSigns(memory[(12 * w + 35) * 4 + 3] ?? 0)).toEqual([-1, -1, -1, -1]);
    // The flux of the line is I0, as that of a dab: the whole of it runs along row 6, and none up the line.
    expect(flux[(6 * w + 20) * 4] ?? 0).toBeCloseTo(i0, 2);
    expect(flux[(4 * w + 4) * 4] ?? 0).toBeLessThan(1e-3);
  }, 240_000);

  it('lets a strain cover a site from any of its cells, and moves the port to the covered cell nearest the centre', async () => {
    // Two dabs of radius 2.9 at (4, 12) and (35, 12): five cells across. The tube reaches each dab at its top cell,
    // two cells above its centre, and none reaches a centre.
    const foods = [dab([4.5, 12.5], 2.9), dab([35.5, 12.5], 2.9)];
    const route = [
      [4, 6, 4, 10],
      [4, 6, 35, 6],
      [35, 6, 35, 10],
    ] as const;
    const { sim, w, memory, flux, i0, cells, of } = await tubes(route, 1500, { foods });
    // Before, a site was covered only at its centre: no flux would run. Now the top cells are the ports.
    expect(roleCells(memory)).toEqual([10 * w + 4, 10 * w + 35]);
    expect(flux[(6 * w + 20) * 4] ?? 0).toBeCloseTo(i0, 2);
    // The tube grows down into the dabs to the row below their centres: the ports move to the centres.
    const trail = new Float32Array(w * 24 * 4);
    for (const c of cells([...route, [4, 10, 4, 13], [35, 10, 35, 13]])) trail[c * 4] = 10;
    sim.writeTrail(trail);
    for (let k = 0; k < 300; k += 100) {
      sim.run(100);
      await sim.finish();
    }
    const later = await of(0);
    expect(roleCells(later.memory)).toEqual([12 * w + 4, 12 * w + 35]);
    expect(later.flux[(6 * w + 20) * 4] ?? 0).toBeCloseTo(i0, 1);
  }, 240_000);

  it('gives each of two strains on the same strokes its whole flux, through cells of its own', async () => {
    // The dabs of the test before. The first strain reaches them from above, the second from below: each covers both
    // sites, at other cells.
    const foods = [dab([4.5, 12.5], 2.9), dab([35.5, 12.5], 2.9)];
    const { w, memory, flux, i0, of } = await tubes(
      [
        [4, 6, 4, 10],
        [4, 6, 35, 6],
        [35, 6, 35, 10],
      ],
      1500,
      {
        strains: 2,
        foods,
        other: [
          [4, 14, 4, 18],
          [4, 18, 35, 18],
          [35, 14, 35, 18],
        ],
      },
    );
    const second = await of(1);
    expect(roleCells(memory)).toEqual([10 * w + 4, 10 * w + 35]);
    expect(roleCells(second.memory)).toEqual([14 * w + 4, 14 * w + 35]);
    // No share: each strain carries the whole I0 along its own route.
    expect(flux[(6 * w + 20) * 4] ?? 0).toBeCloseTo(i0, 2);
    expect(second.flux[(18 * w + 20) * 4] ?? 0).toBeCloseTo(i0, 2);
  }, 240_000);

  it('keeps two food dabs that touch two sites, each with a port of its own', async () => {
    // Two dabs at (4, 12) and (7, 12) that overlap, and a third at (35, 12). The tube covers all three.
    const foods = [dab([4.5, 12.5], 2), dab([7.5, 12.5], 2), dab([35.5, 12.5], 0.75)];
    const { w, memory, sites } = await tubes(
      [
        [2, 12, 35, 12],
        [4, 10, 4, 14],
        [7, 10, 7, 14],
      ],
      600,
      { foods },
    );
    expect(sites.list.length).toBe(3);
    // Three sites that the strain covers: their centres hold their roles, and the two dabs are no single site.
    expect(roleCells(memory)).toEqual([12 * w + 4, 12 * w + 7, 12 * w + 35]);
  }, 240_000);

  it('follows the CPU reference while a port moves to a cell nearer the centre', async () => {
    // The two dabs of the tests before, a tube from the top cell of each, and a trail in the cell below the top cell
    // of the first one. That cell starts with a tube body just below the level of a tube, and reaches it after one
    // step: the port of the first site moves there in the second step. With two sites only, the flux of that step runs
    // only if the passes read the roles of the step before at the ports of the step before.
    const [w, h] = [40, 24];
    const settings = flowing({
      layout: 'empty',
      collisions: false,
      diffusion: 0,
      flowStrength: 2,
      strains: [{ ...defaultStrain(0), decay: 0.0001, deposit: 0 }],
    });
    const sim = await make(settings, w, h, 1);
    const sites = feed(sim, [dab([4.5, 12.5], 2.9), dab([35.5, 12.5], 2.9)]);
    sim.reset();
    const tube = new Set<number>();
    for (let x = 4; x <= 35; x++) tube.add(6 * w + x);
    for (let y = 6; y <= 10; y++) [4, 35].forEach((x) => tube.add(y * w + x));
    const trail = new Float32Array(w * h * 4);
    for (const c of [...tube, 11 * w + 4]) trail[c * 4] = 10;
    sim.writeTrail(trail);
    const env = await sim.readEnv();
    const grid: FlowGrid = { width: w, height: h, boundary: 'box', env };
    let fields = flowStart(grid, FLOW.fresh);
    for (const c of tube) fields.memory[c * 4 + 1] = 1;
    fields.memory[(11 * w + 4) * 4 + 1] = 0.035;
    sim.writeFlow(fields.memory);
    const ports: number[] = [];
    for (let step = 0; step < 6; step++) {
      sim.run(1);
      const u = new Float32Array(packFlow(settings, sites));
      fields = flowStep(grid, u, fields, await sim.readTrail(), step, settings.seed, sites.cells);
      ports.push(fields.ports[0] ?? -1);
      const [memory, pressure] = [await sim.readFlow(), await sim.readPressure()];
      let worst = 0;
      for (let i = 0; i < memory.length; i++)
        worst = Math.max(
          worst,
          Math.abs((memory[i] ?? 0) - (fields.memory[i] ?? 0)) / (1e-5 + Math.abs(fields.memory[i] ?? 0)),
        );
      expect(worst, `memory at step ${String(step)}`).toBeLessThan(1e-4);
      const top = fields.pressure.reduce((a, v) => Math.max(a, Math.abs(v)), 0);
      let off = 0;
      for (let i = 0; i < pressure.length; i++)
        off = Math.max(off, Math.abs((pressure[i] ?? 0) - (fields.pressure[i] ?? 0)));
      expect(off / top, `pressure at step ${String(step)}`).toBeLessThan(1e-3);
      expect(roleCells(memory)).toEqual(roleCells(fields.memory));
    }
    expect(ports).toEqual([10 * w + 4, ...Array.from({ length: 5 }, () => 11 * w + 4)]);
    // The tubes adapted in the step in which the port moved: the roles of the step before lay at its ports.
    expect(fields.memory[(6 * w + 20) * 4] ?? 0).not.toBe(Math.fround(FLOW.fresh));
  }, 240_000);

  it('finds the port of a large site that a tube covers only far from its centre, as the CPU reference does', async () => {
    // A dab of radius 60: about 11,300 cells, in 177 blocks of 64 entries of its list. The passes look at the blocks of
    // a site in 64 lanes, lane l at the blocks l, l + 64 and l + 128. A tube comes down column 70 into the dab and ends
    // 38 cells from its centre: it covers the cells of the column from 38 to 60 cells out, one in each of many blocks.
    // The nearest lies in the second round of its lane, and farther ones lie in lanes before and after it, in the
    // second and the third round: only the least hit of all lanes is the port.
    const [w, h] = [144, 144];
    const settings = flowing({
      layout: 'empty',
      collisions: false,
      diffusion: 0,
      flowStrength: 2,
      strains: [{ ...defaultStrain(0), decay: 0.0001, deposit: 0 }],
    });
    const sim = await make(settings, w, h, 1);
    const sites = feed(sim, [dab([70.5, 72.5], 60), dab([140.5, 6.5], 2)]);
    sim.reset();
    const tube = new Set<number>();
    for (let y = 2; y <= 34; y++) tube.add(y * w + 70);
    for (let x = 70; x <= 140; x++) tube.add(2 * w + x);
    for (let y = 2; y <= 6; y++) tube.add(y * w + 140);
    // Where the cells of the column lie in the list of the dab: the nearest in the second round of its lane, and a
    // farther one in the third round of a lane before it.
    const entry = (y: number) => sites.cells.indexOf(y * w + 70);
    const [block, lane] = [(y: number) => Math.floor(entry(y) / 64), (y: number) => Math.floor(entry(y) / 64) % 64];
    expect(Math.floor(block(34) / 64)).toBe(1);
    const column = Array.from({ length: 34 - 12 + 1 }, (_, k) => 12 + k);
    expect(column.some((y) => block(y) >= 128 && lane(y) < lane(34))).toBe(true);
    expect(column.some((y) => block(y) > block(34) && lane(y) > lane(34))).toBe(true);
    const trail = new Float32Array(w * h * 4);
    for (const c of tube) trail[c * 4] = 10;
    sim.writeTrail(trail);
    const env = await sim.readEnv();
    const grid: FlowGrid = { width: w, height: h, boundary: 'box', env };
    let fields = flowStart(grid, FLOW.fresh);
    for (const c of tube) fields.memory[c * 4 + 1] = 1;
    sim.writeFlow(fields.memory);
    sim.run(1);
    const u = new Float32Array(packFlow(settings, sites));
    fields = flowStep(grid, u, fields, await sim.readTrail(), 0, 5, sites.cells);
    expect([fields.ports[0], fields.ports[2]]).toEqual([34 * w + 70, 6 * w + 140]);
    expect(roleCells(await sim.readFlow())).toEqual([6 * w + 140, 34 * w + 70].sort((a, b) => a - b));
  }, 240_000);

  /**
   * A simulation of `strains` strains without agents of their own, no diffusion and almost no decay, whose trail is
   * the cells of `tubes` (one set per strain) from the start, and the memory of the CPU copy for each strain with a
   * full tube body on those cells: so the passes and the CPU copy start from the same state.
   */
  async function painted(w: number, h: number, foods: readonly FoodStroke[], tubes: readonly Set<number>[]) {
    const settings = flowing({
      layout: 'empty',
      collisions: false,
      diffusion: 0,
      flowStrength: 2,
      strains: tubes.map((_, i) => ({ ...defaultStrain(i), decay: 0.0001, deposit: 0 })),
    });
    const sim = await make(settings, w, h, 1);
    const sites = feed(sim, foods);
    sim.reset();
    const trail = new Float32Array(w * h * 4);
    tubes.forEach((tube, strain) => {
      for (const c of tube) trail[c * 4 + strain] = 10;
    });
    sim.writeTrail(trail);
    const grid: FlowGrid = { width: w, height: h, boundary: 'box', env: await sim.readEnv() };
    const fields = tubes.map((tube, strain) => {
      const f = flowStart(grid, FLOW.fresh);
      for (const c of tube) f.memory[c * 4 + 1] = 1;
      sim.writeFlow(f.memory, strain);
      return f;
    });
    return { settings, sim, sites, grid, fields };
  }

  /** The largest difference of the memory of a strain from the CPU copy, relative, and of its pressure, over the top. */
  async function offReference(sim: Sim, strain: number, fields: FlowFields) {
    const [memory, pressure] = [await sim.readFlow(strain), await sim.readPressure(strain)];
    let worst = 0;
    for (let i = 0; i < memory.length; i++)
      worst = Math.max(
        worst,
        Math.abs((memory[i] ?? 0) - (fields.memory[i] ?? 0)) / (1e-5 + Math.abs(fields.memory[i] ?? 0)),
      );
    const top = fields.pressure.reduce((a, v) => Math.max(a, Math.abs(v)), 0);
    let off = 0;
    for (let i = 0; i < pressure.length; i++)
      off = Math.max(off, Math.abs((pressure[i] ?? 0) - (fields.pressure[i] ?? 0)));
    return { memory: worst, pressure: top > 0 ? off / top : off, roles: roleCells(memory) };
  }

  it('finds the ports of two strains on a large site, each in the rows of the hits of its own strain', async () => {
    // The large dab of the test before on a grid of 144 cells across: its 178 blocks fill two rows of the hits of a
    // strain on WebGL2, and the rows of the second strain start at row 2. The first strain comes into the dab from
    // above, the second from below; each reaches the small dab from its own side. Each strain has its port in the dab
    // on its own side, as the CPU copy has it.
    const [w, h] = [144, 144];
    const foods = [dab([70.5, 72.5], 60), dab([140.5, 6.5], 2)];
    const above = new Set<number>();
    for (let y = 2; y <= 34; y++) above.add(y * w + 70);
    for (let x = 70; x <= 140; x++) above.add(2 * w + x);
    for (let y = 2; y <= 6; y++) above.add(y * w + 140);
    const below = new Set<number>();
    for (let y = 111; y <= 141; y++) below.add(y * w + 70);
    for (let x = 70; x <= 140; x++) below.add(141 * w + x);
    for (let y = 7; y <= 141; y++) below.add(y * w + 140);
    const { settings, sim, sites, grid, fields } = await painted(w, h, foods, [above, below]);
    expect(Math.ceil(sites.cells.length / 64 / w)).toBe(2);
    for (let step = 0; step < 3; step++) {
      sim.run(1);
      const trail = await sim.readTrail();
      for (let strain = 0; strain < 2; strain++) {
        const u = new Float32Array(packFlow(settings, sites, undefined, strain));
        const f = flowStep(grid, u, at(fields, strain), trail, step, settings.seed, sites.cells);
        fields[strain] = f;
        const off = await offReference(sim, strain, f);
        expect(off.memory, `memory of strain ${String(strain)} at step ${String(step)}`).toBeLessThan(1e-4);
        expect(off.pressure, `pressure of strain ${String(strain)} at step ${String(step)}`).toBeLessThan(1e-3);
        expect(off.roles).toEqual(roleCells(f.memory));
      }
    }
    // The port of each strain in the large dab: 38 cells above its centre and 39 below it.
    expect(at(fields, 0).ports[0]).toBe(34 * w + 70);
    expect(at(fields, 1).ports[0]).toBe(111 * w + 70);
  }, 240_000);

  it('follows the CPU copy while the list of sites gets shorter, reading the roles of the step before at every port', async () => {
    // Three sites: one that no tube covers, then two joined by a tube. The tube gives and takes from the first step on.
    // After two steps the first site goes (an erase, and the list of the engine without it): the two others move to the
    // places 0 and 1, and the roles of the step before lie at the ports of the places 1 and 2. The step after it adapts
    // only if the passes read the ports of the step before at every place, also at those past the sites of now.
    const [w, h] = [40, 24];
    const [lone, a, b] = [dab([20.5, 20.5], 0.75), dab([4.5, 12.5], 0.75), dab([35.5, 12.5], 0.75)];
    const tube = new Set<number>();
    for (let x = 4; x <= 35; x++) tube.add(6 * w + x);
    for (let y = 6; y <= 12; y++) [4, 35].forEach((x) => tube.add(y * w + x));
    const ready = await painted(w, h, [lone, a, b], [tube]);
    const { settings, sim, grid } = ready;
    let [sites, fields] = [ready.sites, at(ready.fields, 0)];
    let before = 0;
    for (let step = 0; step < 6; step++) {
      if (step === 2) {
        sim.paint([{ kind: 'erase', from: [20.5, 20.5], to: [20.5, 20.5], radius: 2 }]);
        sites = flowSites([a, b], w, h, 'box');
        sim.foodSites(sites);
        grid.env = await sim.readEnv();
      }
      sim.run(1);
      const u = new Float32Array(packFlow(settings, sites));
      fields = flowStep(grid, u, fields, await sim.readTrail(), step, settings.seed, sites.cells);
      const off = await offReference(sim, 0, fields);
      expect(off.memory, `memory at step ${String(step)}`).toBeLessThan(1e-4);
      expect(off.pressure, `pressure at step ${String(step)}`).toBeLessThan(1e-3);
      expect(off.roles).toEqual([12 * w + 4, 12 * w + 35]);
      // In the step after the erase the roles of the step before lie at the ports of the places 1 and 2, and the tube
      // adapts: the flow memory leaves the fresh value there.
      if (step === 2) {
        expect([...fields.ports.subarray(0, 6)]).toEqual([12 * w + 4, -1, 12 * w + 35, 12 * w + 4, -1, 12 * w + 35]);
        expect(fields.memory[(6 * w + 20) * 4]).not.toBe(before);
      }
      before = fields.memory[(6 * w + 20) * 4] ?? 0;
    }
  }, 240_000);

  it('follows the CPU copy with 64 sites of 65 strokes, every one of them covered', async () => {
    // 65 dabs of one cell and a tube on every cell: 64 sites take part, spread over the 65 strokes, and all 64 give
    // or take, 32 and 32 in each lane. A pass that leaves out the last site, or a 65th, does not give these roles.
    const [w, h] = [48, 40];
    const foods = Array.from({ length: 65 }, (_, i) => dab([2.5 + 5 * (i % 9), 2.5 + 4 * Math.floor(i / 9)], 0.75));
    const all = new Set(Array.from({ length: w * h }, (_, c) => c));
    const { settings, sim, sites, grid, fields } = await painted(w, h, foods, [all]);
    expect(sites.list.length).toBe(64);
    expect(sites.list.map((site) => site.stroke)).toEqual(Array.from({ length: 64 }, (_, i) => i));
    let f = at(fields, 0);
    for (let step = 0; step < 3; step++) {
      sim.run(1);
      const u = new Float32Array(packFlow(settings, sites));
      f = flowStep(grid, u, f, await sim.readTrail(), step, settings.seed, sites.cells);
      const off = await offReference(sim, 0, f);
      expect(off.memory, `memory at step ${String(step)}`).toBeLessThan(1e-4);
      expect(off.pressure, `pressure at step ${String(step)}`).toBeLessThan(1e-3);
      expect(off.roles.length, `roles at step ${String(step)}`).toBe(64);
      expect(off.roles).toEqual(roleCells(f.memory));
    }
    // Every lane has 32 sites that give and 32 that take.
    const signs = sites.list.map((site) => roleSigns(f.memory[(site.y * w + site.x) * 4 + 3] ?? 0));
    for (let k = 0; k < 4; k++) {
      expect(signs.filter((sg) => sg[k] === 1).length).toBe(32);
      expect(signs.filter((sg) => sg[k] === -1).length).toBe(32);
    }
  }, 240_000);

  it('follows a change of the food sites during a run, as after a paint', async () => {
    // One dab first: no site has a partner, and no flux runs. Then a second dab, and the sites of both.
    const route = [
      [4, 6, 4, 12],
      [4, 6, 35, 6],
      [35, 6, 35, 12],
    ] as const;
    const { sim, w, memory, of } = await tubes(route, 300, { foods: [dab([4.5, 12.5], 2)] });
    expect(roleCells(memory)).toEqual([]);
    feed(sim, [dab([4.5, 12.5], 2), dab([35.5, 12.5], 2)]);
    for (let k = 0; k < 300; k += 100) {
      sim.run(100);
      await sim.finish();
    }
    expect(roleCells((await of(0)).memory)).toEqual([12 * w + 4, 12 * w + 35]);
  }, 240_000);

  it('lets no cell of a site that an erase cleared hold its port', async () => {
    // The tube reaches the first dab at its top cell, and an erase cleared the top of that dab: the strain covers no
    // cell of it, so no site has a partner and no flux runs.
    const route = [
      [4, 6, 4, 10],
      [4, 6, 35, 6],
      [35, 6, 35, 10],
    ] as const;
    const foods = [dab([4.5, 12.5], 2.9), dab([35.5, 12.5], 2.9)];
    const [w, h] = [40, 24];
    const settings = flowing({
      layout: 'empty',
      collisions: false,
      diffusion: 0,
      flowStrength: 2,
      strains: [{ ...defaultStrain(0), decay: 0.0001, deposit: 0 }],
    });
    const sim = await make(settings, w, h, 1);
    const sites = feed(sim, foods);
    sim.paint([{ kind: 'erase', from: [4.5, 9.5], to: [4.5, 9.5], radius: 1.6 }]);
    sim.reset();
    const trail = new Float32Array(w * h * 4);
    for (const [x0, y0, x1, y1] of route)
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) trail[(y * w + x) * 4] = 10;
    sim.writeTrail(trail);
    sim.run(300);
    const env = await sim.readEnv();
    // The cell (4, 10) is a cell of the first site that holds no food now.
    expect([...sites.cells.subarray(0, sites.list[0]?.count ?? 0)]).toContain(10 * w + 4);
    expect(env[(10 * w + 4) * 4 + 1]).toBe(0);
    expect(roleCells(await sim.readFlow())).toEqual([]);
  }, 240_000);

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

  it('lets starved ground recover by the factor of the rule, up to the memory of fresh ground', async () => {
    // Ground without a tube (ADR 0029, decisions 7 and 19): a memory above that of fresh ground falls to it at once; a
    // smaller one, at least the floor, grows by the factor 1 + FLOW.recover per step, up to fresh ground. No agent
    // lives, so no trail and no tube: every cell is ground. The column of a cell gives its memory at the start.
    const [w, h] = [20, 8];
    const starts = [0, FLOW.floor, 0.001, FLOW.half, 0.05, 0.1, 0.19, FLOW.fresh, 0.5, 1];
    const sim = await make(flowing(), w, h, 32, 0);
    const memory = new Float32Array(w * h * 4);
    for (let c = 0; c < w * h; c++) memory.set([starts[c % starts.length] ?? 0, 0, 0, 0], c * 4);
    sim.writeFlow(memory);
    // The rule in float32, as the passes compute it.
    const f = Math.fround;
    const [fresh, floor, factor] = [f(FLOW.fresh), f(FLOW.floor), f(1 + f(FLOW.recover))];
    const expected = starts.map(f);
    let done = 0;
    for (const steps of [1, 99, 400]) {
      sim.run(steps);
      for (let s = 0; s < steps; s++)
        expected.forEach((d, i) => {
          expected[i] = f(Math.min(fresh, f(Math.max(d, floor) * factor)));
        });
      done += steps;
      const got = await sim.readFlow();
      for (let c = 0; c < w * h; c++) {
        const want = expected[c % starts.length] ?? 0;
        expect(got[c * 4 + 1], 'no tube').toBe(0);
        expect(Math.abs((got[c * 4] ?? 0) - want) / want, `column ${String(c % w)}, step ${String(done)}`).toBeLessThan(
          1e-4,
        );
      }
    }
    // After 500 steps the mark of the starved cells has faded by the factor of the rule, and not to fresh ground.
    expect(expected[1]).toBeCloseTo(FLOW.floor * (1 + FLOW.recover) ** 500, 7);
    expect(expected[1]).toBeLessThan(FLOW.half);
    expect(expected[8]).toBe(fresh);
  }, 240_000);

  it('lets starved ground recover in the Slime life time: with eight times the share at 18 hours', async () => {
    // ADR 0055, decision 5: the setting gives the mark of starved ground its time. The ground of the test before, with
    // the share of each life time: FLOW.recover at 144 hours, 0.00023 at 18 hours, and FLOW.recover without slime.
    const [w, h] = [20, 8];
    const starts = [0, FLOW.floor, 0.001, FLOW.half, 0.05, 0.1, 0.19, FLOW.fresh, 0.5, 1];
    const f = Math.fround;
    const [fresh, floor] = [f(FLOW.fresh), f(FLOW.floor)];
    for (const [slimeLife, share] of [
      [18, 0.00023],
      [72, 2 * FLOW.recover],
      [144, FLOW.recover],
      [0, FLOW.recover],
    ] as const) {
      const sim = await make(flowing({ slimeLife }), w, h, 32, 0);
      const memory = new Float32Array(w * h * 4);
      for (let c = 0; c < w * h; c++) memory.set([starts[c % starts.length] ?? 0, 0, 0, 0], c * 4);
      sim.writeFlow(memory);
      sim.run(300);
      const factor = f(1 + f(share));
      const expected = starts.map(f);
      for (let s = 0; s < 300; s++)
        expected.forEach((d, i) => {
          expected[i] = f(Math.min(fresh, f(Math.max(d, floor) * factor)));
        });
      const got = await sim.readFlow();
      for (let c = 0; c < w * h; c++) {
        const want = expected[c % starts.length] ?? 0;
        const what = `column ${String(c % w)}, ${String(slimeLife)} hours`;
        expect(Math.abs((got[c * 4] ?? 0) - want) / want, what).toBeLessThan(1e-4);
      }
      // The floor after 300 steps: 7 % above itself at 18 hours, and 0.9 % at 144 hours.
      expect((expected[1] ?? 0) / FLOW.floor, `${String(slimeLife)} hours`).toBeCloseTo((1 + share) ** 300, 3);
    }
    expect(1.00023 ** 300).toBeGreaterThan(1.07);
    expect((1 + FLOW.recover) ** 300).toBeLessThan(1.009);
  }, 240_000);

  it('leaves the ground of a starved tube that vanishes at the floor of the flow memory', async () => {
    // ADR 0054. No agent lives, so no trail: the tube body of a cell falls by the share FLOW.bodyRate per step, and a
    // cell loses its tube in the step in which its body falls below FLOW.bodyLow. No food: no tube adapts. The column of
    // a cell gives its flow memory at the start. The rows 0 and 1 hold a tube that vanishes in the first step, the rows
    // 2 and 3 a tube that vanishes in the tenth step, and the other rows ground without a tube.
    const [w, h] = [18, 8];
    const starts = [FLOW.floor, 0.001, 0.005, FLOW.half * 0.99, FLOW.half * 1.01, 0.05, 0.19, FLOW.fresh, 0.5];
    const bodies = [0.0505, 0.0505, 0.06, 0.06, 0, 0, 0, 0];
    const sim = await make(flowing(), w, h, 32, 0);
    const memory = new Float32Array(w * h * 4);
    for (let c = 0; c < w * h; c++)
      memory.set([starts[c % starts.length] ?? 0, bodies[Math.floor(c / w)] ?? 0, 0, 0], c * 4);
    sim.writeFlow(memory);
    // The rule in float32, as the passes compute it: the memory and the tube body of every cell.
    const f = Math.fround;
    const [fresh, floor, factor] = [f(FLOW.fresh), f(FLOW.floor), f(1 + f(FLOW.recover))];
    const [low, rate, half2] = [f(FLOW.bodyLow), f(FLOW.bodyRate), f(FLOW.half * FLOW.half)];
    const cells = Array.from({ length: w * h }, (_, c) => ({
      d: f(starts[c % starts.length] ?? 0),
      body: f(bodies[Math.floor(c / w)] ?? 0),
    }));
    const step = () => {
      for (const cell of cells) {
        const tube = cell.body >= low;
        if (!tube) cell.d = f(Math.min(fresh, f(Math.max(cell.d, floor) * factor)));
        const body = f(cell.body + f(rate * f(0 - cell.body)));
        if (tube && body < low && f(cell.d * cell.d) < half2) cell.d = floor;
        cell.body = body;
      }
    };
    let done = 0;
    for (const steps of [1, 1, 7, 1, 1, 40]) {
      sim.run(steps);
      for (let s = 0; s < steps; s++) step();
      done += steps;
      const got = await sim.readFlow();
      cells.forEach((want, c) => {
        const what = `cell ${String(c)}, step ${String(done)}`;
        expect(Math.abs((got[c * 4] ?? 0) - want.d) / want.d, `memory of ${what}`).toBeLessThan(1e-4);
        expect((got[c * 4 + 1] ?? 0) >= low, `tube of ${what}`).toBe(want.body >= low);
      });
      // The cells of the first columns are starved: FLOW.floor to just below FLOW.half.
      const starved = (row: number) => [0, 1, 2, 3].map((x) => got[(row * w + x) * 4]);
      const fed = (row: number) => [4, 5, 6, 7, 8].map((x) => got[(row * w + x) * 4]);
      // A starved tube that vanished holds the floor in the step in which it vanishes, and it recovers from there.
      if (done === 1) expect(starved(0)).toEqual([floor, floor, floor, floor]);
      // A tube that is not starved keeps its memory when it vanishes; the step after, a memory above fresh ground falls
      // to fresh ground (ADR 0029, decision 7).
      if (done === 1) expect(fed(0)).toEqual([4, 5, 6, 7, 8].map((x) => f(starts[x] ?? 0)));
      if (done === 2) expect(fed(0)[4]).toBe(fresh);
      // A starved tube keeps its memory while it stands, and falls to the floor in the step in which it vanishes.
      if (done === 9) expect(starved(2)).toEqual([0, 1, 2, 3].map((x) => f(starts[x] ?? 0)));
      if (done === 10) expect(starved(2)).toEqual([floor, floor, floor, floor]);
      // Starved ground without a tube does not fall: it recovers from its own memory.
      if (done === 1) expect((starved(5)[2] ?? 0) / f(0.005)).toBeCloseTo(1 + FLOW.recover, 6);
    }
    // 51 steps after the start the ground of the first tubes has recovered by the factor of the rule for 50 steps.
    expect(cells[2]?.d).toBeCloseTo(FLOW.floor * (1 + FLOW.recover) ** 50, 8);
    expect(cells[2]?.d).toBeLessThan(0.001);
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
    feed(sim, [dab([4.5, 12.5], 1.5), dab([35.5, 12.5], 1.5), dab([20.5, 18.5], 1.5)]);
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
    expect(roleCells(memory)).toEqual([12 * w + 4, 12 * w + 35]);
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

  it('stops a food at its pressure limit by the mean pressure at the ports, also off the centre of a dab', async () => {
    // The test before with two dabs of five cells across: each piece of tube reaches its dab at the top cell, two
    // cells above the centre, so the port of each site is not the first cell of its list. The limit of each site
    // counts from the mean pressure at the two ports: almost twice the limit between them, and no more.
    const foods = [dab([4.5, 12.5], 2.9), dab([35.5, 12.5], 2.9)];
    const { w, memory, pressure, i0 } = await tubes(
      [
        [4, 6, 4, 10],
        [35, 6, 35, 10],
      ],
      600,
      { foods },
    );
    const [a, b] = [10 * w + 4, 10 * w + 35];
    expect(roleCells(memory)).toEqual([a, b]);
    const limit = FLOW.head * i0;
    for (let k = 0; k < 4; k++) {
      const span = (pressure[a * 4 + k] ?? 0) - (pressure[b * 4 + k] ?? 0);
      expect(span).toBeGreaterThan(1.9 * limit);
      expect(span).toBeLessThanOrEqual(2 * limit);
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

  it('holds a tube on the weak trail of a strain whose trail decays fast', async () => {
    const [w, h] = [32, 24];
    // Two strains, one with Jones' decay of 0.1 and one with a decay of 0.6. No agents live (the layout Empty), and
    // nothing diffuses: the trail that the test writes before a step is what the flow reads after the decay of that
    // step.
    const strains = [
      { ...defaultStrain(0), decay: 0.1 },
      { ...defaultStrain(1), decay: 0.6 },
    ];
    const settings = flowing({ layout: 'empty', collisions: false, diffusion: 0, strains });
    const sim = await make(settings, w, h, 2);
    // A row in which each strain holds 0.1 deposits after its decay.
    const held = 0.1 * 5;
    const trail = new Float32Array(w * h * 4);
    for (let x = 4; x < 28; x++) trail.set([held / (1 - 0.1), held / (1 - 0.6), 0, 0], (12 * w + x) * 4);
    for (let step = 0; step < 60; step++) {
      sim.writeTrail(trail);
      sim.run(1);
    }
    const [first, second] = [await sim.readFlow(0), await sim.readFlow(1)];
    const [on, off] = [12 * w + 16, 6 * w + 16];
    // At Jones' decay 0.1 deposits lie below the level of a tube (0.2 deposits): no tube body at all.
    expect(first[on * 4 + 1]).toBe(0);
    // At a decay of 0.6 a cell that an agent enters at every step holds 0.67 deposits, where Jones' holds 9. The
    // levels follow: 0.1 deposits are a full tube there (ADR 0032), and the body is 1 − 0.98⁶⁰ = 0.70 after 60 steps.
    expect(second[on * 4 + 1] ?? 0).toBeGreaterThan(0.65);
    expect(second[on * 4 + 1] ?? 0).toBeLessThan(0.75);
    expect(second[on * 4 + 2] ?? 0).toBeGreaterThan(0);
    expect(second[off * 4 + 1]).toBe(0);
  }, 120_000);

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

  describe('respawn while the cut is held (ADR 0041)', () => {
    const [w, h] = [64, 64];
    // The wound lies across two edges of the periodic grid and covers 62 % of it, so most draws of a respawn fall into
    // it. A point within 0.001 cells of its rim counts as unsure: float32 and the CPU can put it on either side.
    const [cx, cy, r] = [20.3, 40.7, 28.4];
    const across = (d: number, size: number) => d - size * Math.round(d / size);
    const rim = (a: AgentState) => Math.hypot(across(a.x - cx, w), across(a.y - cy, h)) - r;
    const inWound = (a: AgentState) => rim(a) < -1e-3;
    const outside = (a: AgentState) => rim(a) > 1e-3;
    const alive = (a: AgentState) => (a.bits & ALIVE) !== 0;
    const cut: AgentTool = { kind: AgentToolKind.cut, x: cx, y: cy, radius: r, strain: 0, revive: 0 };
    /** A fed tube of the first strain on every cell. */
    const fed = () => {
      const memory = new Float32Array(w * h * 4);
      for (let c = 0; c < w * h; c++) memory.set([0.9, 1, 0.9, 0], c * 4);
      return memory;
    };

    it('brings no dead agent to life in the wound, and every other one as without the cut', async () => {
      // No food: the memory that the test writes stays. Without the rule every draw can place, and no agent changes
      // what another one does: a run with a tool held differs from a run without one only by the tool.
      const settings = flowing({ boundary: 'wrap', collisions: false, seed: 11 });
      const step = async (tool?: AgentTool) => {
        const sim = await make(settings, w, h, 40_000, 20_000);
        sim.writeFlow(fed());
        const before = await sim.readAgents();
        sim.run(1, tool);
        return { before, after: await sim.readAgents() };
      };
      const free = await step();
      const held = await step(cut);
      // Inoculate on the same disc, with the chance 0 to place an agent: only the cut makes a wound.
      const other = await step({ ...cut, kind: AgentToolKind.inoculate });
      expect(held.before).toEqual(free.before);
      expect(other.before).toEqual(free.before);
      let [dead, inside, kept, unsure] = [0, 0, 0, 0];
      const wrong: string[] = [];
      free.before.forEach((a, i) => {
        const [b, c, d] = [free.after[i], held.after[i], other.after[i]];
        if (!b || !c || !d) throw new Error('agent missing');
        if (alive(a)) return;
        dead++;
        // The same draws: under Inoculate every dead agent does what it does without a tool.
        if (JSON.stringify(d) !== JSON.stringify(b)) wrong.push(`${String(i)}: Inoculate changed the agent`);
        if (alive(c) && inWound(c)) wrong.push(`${String(i)}: alive in the wound, ${String(rim(c))} from its rim`);
        if (!alive(b) || inWound(b)) {
          // No birth without the cut, or one in the wound: with the cut the agent stays dead where it was.
          if (alive(b)) inside++;
          if (JSON.stringify(c) !== JSON.stringify(a)) wrong.push(`${String(i)}: not dead where it was`);
        } else if (outside(b)) {
          // A birth outside the wound: the same point and heading with the cut.
          kept++;
          if (JSON.stringify(c) !== JSON.stringify(b)) wrong.push(`${String(i)}: another birth with the cut`);
        } else unsure++;
      });
      expect(wrong.slice(0, 5)).toEqual([]);
      expect(dead).toBe(20_000);
      // Without the cut a dead agent comes to life with birth · (D − from) / (1 − from), and the wound holds its share
      // of these births: the fault would show at more than a thousand agents in one step.
      const q = (FLOW.birth * (0.9 - FLOW.birthFrom)) / (1 - FLOW.birthFrom);
      const disc = (Math.PI * r * r) / (w * h);
      expect(Math.abs(inside - dead * q * disc)).toBeLessThan(6 * Math.sqrt(dead * q * disc));
      expect(Math.abs(kept - dead * q * (1 - disc))).toBeLessThan(6 * Math.sqrt(dead * q * (1 - disc)));
      expect(inside).toBeGreaterThan(1500);
      expect(kept).toBeGreaterThan(1000);
      expect(unsure).toBeLessThanOrEqual(2);
    }, 120_000);

    it('brings no dead agent to life in the wound while growth runs, in every step of the hold', async () => {
      // Growth runs (one agent per cell, a growth test every 50 steps), and no shrinkage test: step 0 is the only
      // growth step here, so in the steps of the hold only respawn brings an agent to life. 1,000 of 6,000 agents live
      // at the start.
      const settings = flowing({ boundary: 'wrap', seed: 11, growth: true, growthEvery: 50, shrinkEvery: 0 });
      const sim = await make(settings, w, h, 6000, 1000);
      sim.writeFlow(fed());
      sim.run(1);
      let [born, removed] = [0, 0];
      const wrong: string[] = [];
      for (let k = 0; k < 6; k++) {
        // The memory again before every step: without food the update keeps the flow memory, but the body follows the
        // trail.
        sim.writeFlow(fed());
        const before = await sim.readAgents();
        sim.run(1, cut);
        const after = await sim.readAgents();
        expect((sim.step - 1) % settings.growthEvery, 'no growth step').not.toBe(0);
        before.forEach((a, i) => {
          const b = after[i];
          if (!b) throw new Error('agent missing');
          // The cut kills the alive agents of its wound (ADR 0039), also one that walked into it in the step before.
          // Such an agent is a dead agent like any other in this step: it can come to life again, outside the wound.
          if (alive(a) && !inWound(a)) return;
          if (alive(a)) removed++;
          if (!alive(b)) return;
          if (!alive(a)) born++;
          if (inWound(b)) wrong.push(`step ${String(k)}, agent ${String(i)}: alive ${String(rim(b))} from the rim`);
        });
      }
      expect(wrong.slice(0, 5)).toEqual([]);
      // Outside the wound the flow brings agents to life: 635 on WebGPU and 639 on WebGL2 in the 6 steps (M3 Pro,
      // 2026-11-15), and the cut killed 925 and 913.
      expect(born).toBeGreaterThan(300);
      expect(removed).toBeGreaterThan(300);
    }, 120_000);
  });

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

  // No child is born onto starved ground (ADR 0053): one growth step against the CPU copy of the growth passes
  // (growth-reference.ts), which gets the flow memory of each strain. A twin without growth runs the same moves. The
  // ground of each strain is a pattern of blocks of 3 × 3 cells of its own, with four levels of the memory: its floor,
  // just below the level `half`, just above it, and fresh ground. So parents on fed cells stand beside starved cells,
  // and parents on starved cells beside fed ones. In a box, and on the periodic grid, where a child lies across the
  // seam.
  it.each(['box', 'wrap'] as const)(
    'lets no child be born onto starved ground, as the CPU copy of the growth passes does (%s)',
    async (boundary) => {
      const [w, h] = [64, 48];
      const n = w * h;
      const strains = [defaultStrain(0, 2), { ...defaultStrain(1, 2), share: 0.6 }].map((st) => ({
        ...st,
        sensorOffset: 5,
      }));
      const s = flowing({
        seed: 17,
        boundary,
        layout: 'empty',
        density: 1,
        strains,
        growth: true,
        growthEvery: 1,
        growthMax: 30,
        shrink: 0,
      });
      const plain = { ...s, growth: false, collisions: false };
      const [a, b] = [await make(plain, w, h, n), await make(plain, w, h, n)];
      const levels = [FLOW.floor, FLOW.half * 0.99, FLOW.half * 1.01, FLOW.fresh];
      const ground = (strain: number) => {
        const memory = new Float32Array(n * 4);
        for (let c = 0; c < n; c++) {
          const block = Math.floor((c % w) / 3) + 2 * Math.floor(Math.floor(c / w) / 3) + strain;
          memory[c * 4] = levels[block % 4] ?? 0;
        }
        return memory;
      };
      const ends = strainEnds(s.strains, n);
      for (const sim of [a, b]) {
        // An agent in about every seventh cell, of either strain: each strain owns a range of the ids.
        let r = 5;
        const rnd = () => (r = (Math.imul(r, 1103515245) + 12345) >>> 0) / 2 ** 32;
        const next = [0, ends[0] ?? 0];
        for (let c = 0; c < n; c++) {
          if (rnd() > 0.15) continue;
          const strain = rnd() < 0.5 ? 0 : 1;
          const id = next[strain] ?? 0;
          next[strain] = id + 1;
          const [fx, fy] = [Math.fround(0.05 + 0.9 * rnd()), Math.fround(0.05 + 0.9 * rnd())];
          const heading = Math.fround(rnd() * 6.28);
          sim.writeAgent(id, { x: (c % w) + fx, y: Math.floor(c / w) + fy, heading, bits: strain | ALIVE });
        }
        // The rule is switched on after the agents are written: the switch builds the occupancy from them.
        sim.update({ ...s, growth: sim === a });
        strains.forEach((_, strain) => {
          sim.writeFlow(ground(strain), strain);
        });
      }
      const env = await a.readEnv();
      const memory = [await a.readFlow(0), await a.readFlow(1)];
      expect(Array.from(memory[0]?.subarray(0, 40) ?? [])).toEqual(Array.from(ground(0).subarray(0, 40)));
      a.run(1);
      b.run(1);
      const moved = await b.readAgents();
      const input = {
        kind: kind as 'webgpu' | 'webgl2',
        settings: s,
        ...{ w, h, env, step: 0, agents: moved, counts: await b.readCounts(), memory },
      };
      const got = await a.readAgents();
      expect(got).toEqual(growthStep(input).agents);
      // A child is an agent that was dead after the moves and lives now. `starved`: only the children on a cell that
      // is starved for their strain.
      const half2 = Math.fround(FLOW.half * FLOW.half);
      const children = (agents: readonly AgentState[], starved: boolean) =>
        agents.filter((g, id) => {
          const m = moved[id];
          if ((g.bits & ALIVE) === 0 || (m !== undefined && (m.bits & ALIVE) !== 0)) return false;
          const d = memory[g.bits & 3]?.[(Math.floor(g.y) * w + Math.floor(g.x)) * 4] ?? 0;
          return !starved || Math.fround(d * d) < half2;
        }).length;
      expect(children(got, false)).toBeGreaterThan(60);
      expect(children(got, true)).toBe(0);
      // Both halves of the rule act on this ground. The copy that reads the cell of the parent alone, the rule before
      // ADR 0053, puts children onto starved cells. The copy that reads the cell of the child alone lets the agents on
      // starved cells divide: it has more children.
      const parentAlone = growthStep({ ...input, starvedCells: 'parent' }).agents;
      expect(children(parentAlone, true)).toBeGreaterThan(20);
      const childAlone = growthStep({ ...input, starvedCells: 'child' }).agents;
      expect(children(childAlone, true)).toBe(0);
      expect(children(childAlone, false)).toBeGreaterThan(children(got, false) + 20);
    },
    240_000,
  );

  it('gives the same bytes for the same seed, and others for another seed', async () => {
    const [w, h] = [64, 48];
    const run = async (seed: number) => {
      const settings = flowing({ seed, density: 0.2 });
      const sim = await make(settings, w, h, Math.round(0.2 * w * h));
      feed(sim, [dab([10.5, 10.5], 2), dab([52.5, 38.5], 2)]);
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
      feed(sim, [dab([10.5, 10.5], 2), dab([52.5, 38.5], 2)]);
      sim.reset();
      sim.run(400);
      const out = { agents: await sim.readAgents(), flow: await sim.readFlow() };
      sim.destroy();
      return out;
    };
    const [a, b] = [await run(31), await run(31)];
    expect(b.agents).toEqual(a.agents);
    expect(b.flow).toEqual(a.flow);
    // Both foods give or take: a cell of each holds its roles, its port.
    const roles = roleCells(a.flow);
    expect(roles.length).toBe(2);
    const near = (c: number, x: number, y: number) => Math.hypot((c % w) + 0.5 - x, Math.floor(c / w) + 0.5 - y) <= 2;
    expect(near(roles[0] ?? 0, 10.5, 10.5) && near(roles[1] ?? 0, 52.5, 38.5)).toBe(true);
    // The memory adapted: above the fresh value where the flux runs, below it elsewhere.
    const memory = a.flow.filter((_, i) => i % 4 === 0);
    expect(Math.max(...memory)).toBeGreaterThan(FLOW.fresh + 0.2);
    expect(Math.min(...memory)).toBeLessThan(FLOW.fresh / 2);
    context.getExtension('WEBGL_lose_context')?.loseContext();
  }, 240_000);
});
