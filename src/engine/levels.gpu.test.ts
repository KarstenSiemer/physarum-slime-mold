// The black level of the auto levels on both backends (ADR 0062), in Chromium with real GPU APIs (ADR 0010): with one
// agent per cell it stays below the plasm, which is the cells that hold an agent.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { defaultSettings, defaultStrain, type Settings } from '../model/params';
import { levels, PLASM_EDGE } from './exposure';
import { WebGl2Backend } from './gl/backend';
import type { Backend, Sim } from './types';
import { WebGpuBackend } from './webgpu';

const BACKENDS = {
  webgpu: (c: HTMLCanvasElement): Promise<Backend> => WebGpuBackend.create(c),
  webgl2: (c: HTMLCanvasElement): Promise<Backend> => Promise.resolve(WebGl2Backend.create(c)),
};

// WebGL2 measures the levels on a grid of samples 160 wide (gl/backend.ts SAMPLES): on this grid a sample is a cell,
// so both backends count every cell once.
const [W, H] = [160, 100];
const CELLS = W * H;

const scene = (patch: Partial<Settings>): Settings => ({
  ...defaultSettings(),
  style: 'glow',
  boundary: 'box',
  seed: 7,
  strains: [defaultStrain(0)],
  ...patch,
});

/** The bin of a summed trail above 0, as histogram.wgsl and gl/backend.ts count it. */
const binOf = (t: number) => Math.min(63, Math.max(0, Math.floor((Math.log2(t) + 10) * 2)));

/** The value that the share `q` of the values lies below. */
function quantile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(q * (sorted.length - 1))] ?? 0;
}

/** The trail that a frame draws, summed per cell, and whether each cell holds an agent. */
async function state(sim: Sim) {
  const picture = await sim.readPicture();
  const trail = Array.from({ length: CELLS }, (_, c) =>
    [0, 1, 2, 3].reduce((t, l) => t + (picture[c * 4 + l] ?? 0), 0),
  );
  const holds = new Uint8Array(CELLS);
  for (const a of await sim.readAgents()) if (a.bits & 4) holds[Math.floor(a.y) * W + Math.floor(a.x)] = 1;
  const bins = new Array<number>(64).fill(0);
  const held = new Array<number>(64).fill(0);
  trail.forEach((t, c) => {
    if (t > 0) bins[binOf(t)] = (bins[binOf(t)] ?? 0) + 1;
    if (holds[c]) held[t > 0 ? binOf(t) : 0] = (held[t > 0 ? binOf(t) : 0] ?? 0) + 1;
  });
  return { trail, holds, bins, held, under: trail.filter((_, c) => holds[c]) };
}

describe.each(Object.entries(BACKENDS))('the black level on %s', (_kind, create) => {
  let backend: Backend;
  const live: Sim[] = [];

  beforeAll(async () => {
    backend = await create(document.createElement('canvas'));
  }, 600_000);
  afterEach(() => {
    for (const s of live.splice(0)) s.destroy();
  });
  afterAll(() => {
    backend.destroy();
  });

  /** A run of `steps` steps of `settings` with `density` agents per cell. */
  async function run(settings: Settings, steps: number) {
    const sim = await backend.createSim(settings, W, H, Math.round(settings.density * CELLS));
    live.push(sim);
    sim.run(steps);
    await sim.finish();
    return sim;
  }

  it('stays at half the median trail under the agents where a sheet covers the grid', async () => {
    // Half of the cells hold an agent: a sheet, as in the scene Shrinking plasmodium (Jones 2010, Fig. 21).
    const sim = await run(scene({ collisions: true, density: 0.5 }), 150);
    const { trail, bins, held, under } = await state(sim);
    const l = await backend.measured(sim);
    const median = quantile(under, 0.5);
    // The 65th percentile of all cells lies inside the sheet, above the edge of the plasm: the rule is in force.
    expect(quantile(trail, 0.65)).toBeGreaterThan(1.2 * PLASM_EDGE * median);
    // The backend reads the median within a bin of half a power of two.
    expect(l.black / (PLASM_EDGE * median)).toBeGreaterThan(0.85);
    expect(l.black / (PLASM_EDGE * median)).toBeLessThan(1.15);
    // It is the level of the rule on the CPU, from the same histograms.
    const want = levels(bins, CELLS, held);
    expect(l.black / (want?.black ?? NaN)).toBeCloseTo(1, 2);
    expect(l.gain / (want?.gain ?? NaN)).toBeCloseTo(1, 2);
    // The picture keeps the sheet: few cells with an agent lie at or below the black level. Without the rule of
    // ADR 0062 the 65th percentile cut about half of them.
    expect(under.filter((t) => t <= l.black).length / under.length).toBeLessThan(0.1);
    expect(under.filter((t) => t <= quantile(trail, 0.65)).length / under.length).toBeGreaterThan(0.3);
  }, 120_000);

  it('keeps the 65th percentile where the network leaves most of the grid free', async () => {
    // Jones' network: 15 % of the cells hold an agent, and the 65th percentile lies in the halo of the tubes.
    const sim = await run(scene({ collisions: true, density: 0.15 }), 400);
    const { bins, held, under } = await state(sim);
    const l = await backend.measured(sim);
    const without = levels(bins, CELLS);
    expect(without?.black).toBeGreaterThan(0);
    expect(without?.black).toBeLessThan(PLASM_EDGE * quantile(under, 0.5));
    expect(levels(bins, CELLS, held)).toEqual(without);
    expect(l.black / (without?.black ?? NaN)).toBeCloseTo(1, 2);
    expect(l.gain / (without?.gain ?? NaN)).toBeCloseTo(1, 2);
  }, 120_000);

  it('counts an agent on a cell without trail', async () => {
    // Every cell holds an agent, and a band on 45 % of the cells holds trail: the 65th percentile lies in the band,
    // and more than half of the agents hold no trail.
    const sim = await run(scene({ collisions: true, density: 1 }), 0);
    const trail = new Float32Array(CELLS * 4);
    for (let c = 0; c < 45 * W; c++) trail[c * 4] = 1 + (c % 97) / 97;
    sim.writeTrail(trail);
    const { bins, held, holds } = await state(sim);
    expect(holds.reduce((n, h) => n + h, 0)).toBe(CELLS);
    expect(levels(bins, CELLS)?.black).toBeGreaterThan(1);
    const l = await backend.measured(sim);
    // The median lies in the lowest bin, below 2^-9.5: the black level cuts no agent.
    expect(l.black).toBeLessThan(0.001);
    expect(l.black).toBe(levels(bins, CELLS, held)?.black);
  }, 120_000);

  it('keeps the 65th percentile without the rule, also after a run with the rule', async () => {
    const sim = await run(scene({ collisions: true, density: 0.5 }), 20);
    // The cells that held an agent when the rule went off: nobody keeps them up to date from here on.
    const stale = (await state(sim)).holds;
    sim.update(scene({ collisions: false, density: 0.5 }));
    sim.reset();
    sim.run(10);
    await sim.finish();
    const { trail, bins } = await state(sim);
    const held = new Array<number>(64).fill(0);
    trail.forEach((t, c) => {
      if (stale[c]) held[t > 0 ? binOf(t) : 0] = (held[t > 0 ? binOf(t) : 0] ?? 0) + 1;
    });
    const l = await backend.measured(sim);
    const without = levels(bins, CELLS);
    // The cells of before would lower the black level, if the levels read them.
    expect(levels(bins, CELLS, held)?.black).toBeLessThan(0.9 * (without?.black ?? NaN));
    expect(l.black / (without?.black ?? NaN)).toBeCloseTo(1, 2);
    expect(l.gain / (without?.gain ?? NaN)).toBeCloseTo(1, 2);
  }, 120_000);
});
