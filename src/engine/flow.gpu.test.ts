// The flow in the tubes on both backends (ADR 0029), in Chromium with real GPU APIs (ADR 0010).
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { defaultSettings, defaultStrain, type Settings } from '../model/params';
import { FLOW, flowSites, packFlow } from './flow';
import { flowFlux, flowStart, flowStep, openCell, roleSigns, type FlowGrid } from './flow-reference';
import { WebGl2Backend } from './gl/backend';
import { compile } from './gl/programs';
import { GlSim } from './gl/sim';
import type { AgentState, Backend, Sim, Stroke } from './types';
import { WebGpuBackend } from './webgpu';

const BACKENDS = {
  webgpu: (c: HTMLCanvasElement): Promise<Backend> => WebGpuBackend.create(c),
  webgl2: (c: HTMLCanvasElement): Promise<Backend> => Promise.resolve(WebGl2Backend.create(c)),
};

const ALIVE = 4;
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

describe.each(Object.entries(BACKENDS))('the flow in the tubes on %s', (_kind, create) => {
  let backend: Backend;
  const live: Sim[] = [];

  beforeAll(async () => {
    backend = await create(document.createElement('canvas'));
    // The first simulation with the flow compiles its pipelines: here, under a long timeout.
    const sim = await backend.createSim(flowing(), 16, 16, 8);
    sim.run(1);
    await sim.finish();
    sim.destroy();
  }, 360_000);
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

  it('follows the CPU reference: the memory and the pressure of every step', async () => {
    const [w, h] = [48, 40];
    const settings = flowing();
    const sim = await make(settings, w, h, 500);
    // A wall with a gap, and two foods on either side of it.
    const strokes: Stroke[] = [
      { kind: 'wall', from: [24, 0], to: [24, 24], radius: 1 },
      { kind: 'food', from: [8.5, 8.5], to: [8.5, 8.5], radius: 2.5 },
      { kind: 'food', from: [40.5, 30.5], to: [40.5, 30.5], radius: 2.5 },
    ];
    sim.paint(strokes);
    const centres: [number, number][] = [
      [8.5, 8.5],
      [40.5, 30.5],
    ];
    sim.foodSites(centres);
    sim.reset();
    const sites = flowSites(centres, w, h);
    const grid: FlowGrid = { width: w, height: h, boundary: 'box', env: await sim.readEnv() };
    let fields = flowStart(grid, FLOW.fresh);
    // Every cell holds a tube from the start, so both foods give or take from the first step on. The memory adapts
    // from the second step on: a step reads which sites gave or took in the step before.
    for (let c = 0; c < w * h; c++) fields.memory[c * 4 + 1] = 1;
    sim.writeFlow(fields.memory);
    for (let step = 0; step < 6; step++) {
      sim.run(1);
      const trail = await sim.readTrail();
      const u = new Float32Array(packFlow(settings, sites));
      fields = flowStep(grid, u, fields, trail, step, settings.seed);
      const [memory, pressure] = [await sim.readFlow(), await sim.readPressure()];
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
      // The roles lie on the two centre cells, and nowhere else.
      const roles = [...memory].flatMap((v, i) => (i % 4 === 3 && v !== 0 ? [(i - 3) / 4] : []));
      expect(roles).toEqual([8 * w + 8, 30 * w + 40]);
    }
  }, 120_000);

  /**
   * A simulation without diffusion and with almost no decay, so that the trail that the test writes stays: two foods
   * at (4, 12) and (35, 12), and tubes of one cell along the lines of `lines` (x0, y0, x1, y1). Its one agent starts
   * dead, and the flow brings it to life on a fed tube: with a deposit of 0 it leaves no trail of its own.
   */
  async function tubes(lines: readonly (readonly [number, number, number, number])[], steps: number) {
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
    ];
    sim.paint(centres.map((c): Stroke => ({ kind: 'food', from: c, to: c, radius: 0.75 })));
    sim.foodSites(centres);
    sim.reset();
    const tube = new Set<number>();
    for (const [x0, y0, x1, y1] of lines)
      for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++)
        for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) tube.add(y * w + x);
    const trail = new Float32Array(w * h * 4);
    for (const c of tube) trail[c * 4] = 10;
    sim.writeTrail(trail);
    for (let k = 0; k < steps; k += 100) {
      sim.run(100);
      await sim.finish();
    }
    const [memory, pressure] = [await sim.readFlow(), await sim.readPressure()];
    const grid: FlowGrid = { width: w, height: h, boundary: 'box', env: await sim.readEnv() };
    return { w, tube, memory, pressure, grid, i0: settings.flowStrength, flux: flowFlux(grid, memory, pressure) };
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
