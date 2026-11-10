// Runs in Chromium with real GPU APIs (Metal locally, SwiftShader in CI). See ADR 0010.
// Every model test runs against both backends, so WGSL and GLSL cannot drift apart (ADR 0003).
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { defaultSettings, defaultStrain, STYLES, type Settings } from '../model/params';
import { WebGl2Backend } from './gl/backend';
import { AgentToolKind } from './pack';
import { readBuffer } from './readback';
import agentsWgsl from './shaders/agents.wgsl?raw';
import bloomWgsl from './shaders/bloom.wgsl?raw';
import common from './shaders/common.wgsl?raw';
import diffuseWgsl from './shaders/diffuse.wgsl?raw';
import histogramWgsl from './shaders/histogram.wgsl?raw';
import initWgsl from './shaders/init.wgsl?raw';
import paintWgsl from './shaders/paint.wgsl?raw';
import renderWgsl from './shaders/render.wgsl?raw';
import sortWgsl from './shaders/sort.wgsl?raw';
import type { Simulation } from './sim';
import type { Backend, Sim } from './types';
import { WebGpuBackend } from './webgpu';

const lane = (a: Float32Array, l = 0) => Float64Array.from({ length: a.length / 4 }, (_, i) => a[i * 4 + l] ?? 0);
const total = (a: ArrayLike<number>) => Array.from(a).reduce((s, v) => s + v, 0);

describe('WGSL', () => {
  it('compiles without errors or warnings', async () => {
    const backend = await WebGpuBackend.create(document.createElement('canvas'));
    const { device } = backend.gpu;
    const sources = {
      agents: common + agentsWgsl,
      init: common + initWgsl,
      diffuse: common + diffuseWgsl,
      paint: common + paintWgsl,
      sort: common + sortWgsl,
      render: renderWgsl,
      bloom: bloomWgsl,
      histogram: histogramWgsl,
    };
    for (const [name, code] of Object.entries(sources)) {
      const info = await device.createShaderModule({ code }).getCompilationInfo();
      expect(info.messages.map((m) => `${name}:${m.lineNum}: ${m.type}: ${m.message}`)).toEqual([]);
    }
    backend.destroy();
  });
});

const BACKENDS = {
  webgpu: (c: HTMLCanvasElement): Promise<Backend> => WebGpuBackend.create(c),
  // Creating the backend compiles and links every GLSL program; errors throw here.
  webgl2: (c: HTMLCanvasElement): Promise<Backend> => Promise.resolve(WebGl2Backend.create(c)),
};

// One backend per API for all model tests: on SwiftShader (CI) a WebGPU device with its pipelines takes
// tens of seconds to start.
describe.each(Object.entries(BACKENDS))('%s', (kind, create) => {
  let backend: Backend;
  const live: Sim[] = [];

  beforeAll(async () => {
    backend = await create(document.createElement('canvas'));
    console.info('backend', backend.description);
    // The first simulation compiles the pipelines: here, under a long timeout, and not in the first test.
    (await backend.createSim(defaultSettings(), 16, 16, 1)).destroy();
  }, 180_000);
  afterEach(() => {
    for (const s of live.splice(0)) s.destroy();
  });
  afterAll(() => {
    backend.destroy();
  });

  async function make(patch: Partial<Settings>, w: number, h: number, agents: number) {
    const sim = await backend.createSim({ ...defaultSettings(), ...patch }, w, h, agents);
    live.push(sim);
    return sim;
  }

  describe('diffusion and decay', () => {
    it('apply a periodic 3×3 mean, then × (1 − decay) (Jones 2010, p. 132)', async () => {
      const [w, h] = [32, 16];
      const strains = [0, 1, 2, 3].map((i) => defaultStrain(i));
      const sim = await make({ layout: 'empty', strains }, w, h, 1);
      const trail = Float32Array.from({ length: w * h * 4 }, (_, i) => ((i * 7919) % 101) / 10);
      sim.writeTrail(trail);
      sim.run(1);
      const out = await sim.readTrail();
      let maxErr = 0;
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++)
          for (let c = 0; c < 4; c++) {
            let s = 0;
            for (let dy = -1; dy <= 1; dy++)
              for (let dx = -1; dx <= 1; dx++) s += trail[(((y + dy + h) % h) * w + ((x + dx + w) % w)) * 4 + c] ?? 0;
            maxErr = Math.max(maxErr, Math.abs((s / 9) * 0.9 - (out[(y * w + x) * 4 + c] ?? 0)));
          }
      expect(maxErr).toBeLessThan(1e-5);
    });

    it('balance mass with deposits: Σ trail′ = keep · (Σ trail + deposit · Σ counts)', async () => {
      const sim = await make({ density: 0.5 }, 64, 64, 2048);
      sim.run(10);
      const before = total(lane(await sim.readTrail()));
      sim.run(1);
      const after = total(lane(await sim.readTrail()));
      const moved = total(lane(await sim.readCounts()));
      expect(moved).toBe(2048);
      const expected = 0.9 * (before + 5 * moved);
      expect(Math.abs(after - expected) / expected).toBeLessThan(1e-5);
    });
  });

  describe('agent rule (Jones 2010, Fig. 3)', () => {
    const RA = 30;
    // Agent at the centre of a 64² grid, heading +x. SO 9, SA 45°: sensor cells F (41,32), FL (38,26), FR (38,38).
    async function turn(f: number, fl: number, fr: number) {
      const [w, h] = [64, 64];
      const strains = [{ ...defaultStrain(0), sensorAngle: 45, rotationAngle: RA, sensorOffset: 9 }];
      const sim = await make({ layout: 'empty', strains }, w, h, 1);
      const trail = new Float32Array(w * h * 4);
      for (const [x, y, v] of [
        [41, 32, f],
        [38, 26, fl],
        [38, 38, fr],
      ] as const)
        trail[(y * w + x) * 4] = v;
      sim.writeTrail(trail);
      sim.writeAgent(0, { x: 32.5, y: 32.5, heading: 0, bits: 4 });
      sim.run(1);
      const [a] = await sim.readAgents();
      if (!a) throw new Error('no agent');
      return { ...a, deg: Math.round((a.heading * 180) / Math.PI) % 360 };
    }

    it('keeps the heading when the front sensor is strongest', async () => {
      expect((await turn(10, 1, 1)).deg).toBe(0);
    });
    it('turns right by RA toward a stronger right sensor', async () => {
      expect((await turn(1, 1, 10)).deg).toBe(RA);
    });
    it('turns left by RA toward a stronger left sensor', async () => {
      expect((await turn(1, 10, 1)).deg).toBe(360 - RA);
    });
    it('turns randomly left or right when the front is weakest', async () => {
      expect([RA, 360 - RA]).toContain((await turn(1, 10, 10)).deg);
    });
    it('keeps the heading when all sensors are equal', async () => {
      expect((await turn(0, 0, 0)).deg).toBe(0);
    });
    it('moves one step along the new heading', async () => {
      const a = await turn(1, 1, 10);
      expect(a.x).toBeCloseTo(32.5 + Math.cos((RA * Math.PI) / 180), 3);
      expect(a.y).toBeCloseTo(32.5 + Math.sin((RA * Math.PI) / 180), 3);
    });

    it('is blocked by a wall: no move, no deposit, new random heading', async () => {
      const sim = await make({ layout: 'empty' }, 64, 64, 1);
      sim.paint({ kind: 'wall', from: [33.5, 32.5], to: [33.5, 32.5], radius: 1.2 });
      sim.writeAgent(0, { x: 32.5, y: 32.5, heading: 0, bits: 4 });
      sim.run(1);
      const [a] = await sim.readAgents();
      expect(a?.x).toBe(32.5);
      expect(a?.y).toBe(32.5);
      expect(a?.heading).not.toBe(0);
      expect(total(await sim.readCounts())).toBe(0);
    });
  });

  describe('environment', () => {
    it('paints food, light and walls, and erases them', async () => {
      const sim = await make({ layout: 'empty' }, 64, 64, 1);
      sim.paint({ kind: 'food', from: [10, 10], to: [20, 10], radius: 3 });
      sim.paint({ kind: 'light', from: [40, 40], to: [40, 40], radius: 6 });
      sim.paint({ kind: 'wall', from: [10, 50], to: [50, 50], radius: 1.5 });
      const env = await sim.readEnv();
      const at = (x: number, y: number, ch: number) => env[(y * 64 + x) * 4 + ch] ?? 0;
      expect(at(15, 10, 1)).toBe(255); // food
      expect(at(40, 40, 2)).toBeGreaterThan(200); // light, soft edge
      expect(at(30, 50, 0)).toBe(255); // wall
      expect(at(5, 30, 1) + at(5, 30, 0)).toBe(0);
      sim.paint({ kind: 'erase', from: [15, 10], to: [15, 10], radius: 2 });
      expect((await sim.readEnv())[(10 * 64 + 15) * 4 + 1]).toBe(0);
    });
  });

  describe('determinism and collisions', () => {
    it('gives identical agents and trails for one seed, different ones for another', async () => {
      const run = async (seed: number) => {
        const sim = await make({ density: 1, seed }, 64, 64, 4096);
        sim.run(30);
        return [await sim.readAgents(), Array.from(await sim.readTrail())];
      };
      expect(await run(42)).toEqual(await run(42));
      expect(await run(43)).not.toEqual(await run(42));
    });

    it('collision mode keeps at most one agent per cell and loses none (ADR 0008)', async () => {
      const [w, h, n] = [64, 64, 2048];
      const sim = await make({ collisions: true, density: 0.5 }, w, h, n);
      sim.run(40);
      const agents = await sim.readAgents();
      const cells = agents
        .filter((a) => a.bits & 4)
        .map((a) => (((Math.floor(a.y) % h) + h) % h) * w + (((Math.floor(a.x) % w) + w) % w));
      expect(cells).toHaveLength(n);
      expect(new Set(cells).size).toBe(n);
    });
  });

  describe('pattern formation', () => {
    // Mean length of runs of below-mean cells along rows and columns: the typical lacuna width.
    function lacunaWidth(t: Float64Array, w: number, h: number) {
      const m = total(t) / t.length;
      let runs = 0;
      let cells = 0;
      const scan = (get: (i: number) => number, n: number) => {
        let run = 0;
        for (let i = 0; i < n; i++) {
          if (get(i) < m) run++;
          else if (run > 0) {
            runs++;
            cells += run;
            run = 0;
          }
        }
      };
      for (let y = 0; y < h; y++) scan((x) => t[y * w + x] ?? 0, w);
      for (let x = 0; x < w; x++) scan((y) => t[y * w + x] ?? 0, h);
      return cells / Math.max(1, runs);
    }

    // Autocorrelation half width: the typical thickness of the paths.
    function halfWidth(t: Float64Array, w: number, h: number) {
      const m = total(t) / t.length;
      const v = total(t.map((x) => (x - m) ** 2)) / t.length;
      for (let r = 1; r < w / 2; r++) {
        let c = 0;
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++) {
            const a = (t[y * w + x] ?? 0) - m;
            c += a * ((t[y * w + ((x + r) % w)] ?? 0) - m) + a * ((t[((y + r) % h) * w + x] ?? 0) - m);
          }
        if (c / (2 * t.length * v) < 0.5) return r;
      }
      return w / 2;
    }

    // Jones 2010, Fig. 10: %p 15, SA 45, RA 45, collisions, 500 steps on a 200² lattice.
    async function grow(sensorOffset: number) {
      const [size, density] = [200, 0.15];
      const strain = { ...defaultStrain(0), sensorOffset, sensorAngle: 45, rotationAngle: 45 };
      const sim = await make(
        { density, seed: 3, collisions: true, strains: [strain] },
        size,
        size,
        Math.round(density * size * size),
      );
      sim.run(500);
      const t = lane(await sim.readTrail());
      return { sensorOffset, lacuna: lacunaWidth(t, size, size), half: halfWidth(t, size, size) };
    }

    // 2000 WebGPU steps on SwiftShader (CPU) took 102 to over 240 s on GitHub runners (not profiled). On macOS
    // SwiftShader a step of this test takes 19 ms with the tiled diffuse pass and 4.1 ms without the tile; the
    // tile stays because Metal runs it faster (docs/knowledge-base/webgpu-platform.md).
    it(
      'forms networks whose scale grows with the sensor offset (Jones 2010, Fig. 10)',
      { timeout: 600_000 },
      async () => {
        const runs = [];
        for (const so of [3, 9, 15, 25]) runs.push(await grow(so));
        console.info('pattern scale', runs);
        for (let i = 1; i < runs.length; i++) {
          expect(runs[i]?.lacuna).toBeGreaterThan(runs[i - 1]?.lacuna ?? Infinity);
          expect(runs[i]?.half).toBeGreaterThanOrEqual(runs[i - 1]?.half ?? Infinity);
        }
        expect(runs.at(-1)?.lacuna).toBeGreaterThan(2 * (runs[0]?.lacuna ?? Infinity));
      },
    );
  });

  // The gel style's height field (render.wgsl `heightField`, gl/glsl/height.frag, ADR 0009): a blob of trail
  // around one cell, seen at 8 px per cell (one bilinear lookup per height) and at 1.5 cells per px (four
  // taps), must sit on that cell, across the wrap seam too.
  describe('gel height field', () => {
    const SIZE = 192;

    /** Centre of the pixels the gel draws (anything clearly away from the background), in canvas pixels. */
    function blobCentre(img: ImageData) {
      const bg = [img.data[0] ?? 0, img.data[1] ?? 0, img.data[2] ?? 0];
      let [n, sx, sy] = [0, 0, 0];
      for (let y = 0; y < img.height; y++)
        for (let x = 0; x < img.width; x++) {
          const i = (y * img.width + x) * 4;
          const d = Math.abs((img.data[i] ?? 0) - (bg[0] ?? 0)) + Math.abs((img.data[i + 1] ?? 0) - (bg[1] ?? 0));
          if (d > 40) [n, sx, sy] = [n + 1, sx + x + 0.5, sy + y + 0.5];
        }
      return { pixels: n, x: sx / n, y: sy / n };
    }

    it.each([
      ['wrap', 5, 9, 1 / 8],
      ['wrap', 0, 0, 1 / 8],
      ['wrap', 0, 0, 1.5],
      ['box', 0, 13, 1 / 8],
      ['box', 40, 3, 1 / 8],
      ['box', 30, 20, 1.5],
    ] as const)('is drawn in place (%s, cell %i, %i, scale %f)', async (boundary, cx, cy, scale) => {
      const [w, h] = [64, 48];
      const patch: Partial<Settings> = { style: 'gel', boundary, layout: 'empty', strains: [defaultStrain(0)] };
      const sim = await make(patch, w, h, 1);
      const trail = new Float32Array(w * h * 4);
      for (let dy = -8; dy <= 8; dy++)
        for (let dx = -8; dx <= 8; dx++) {
          const [x, y] = [cx + dx, cy + dy];
          if (boundary !== 'wrap' && (x < 0 || y < 0 || x >= w || y >= h)) continue;
          trail[((((y % h) + h) % h) * w + (((x % w) + w) % w)) * 4] = 400 * Math.exp(-(dx * dx + dy * dy) / 8);
        }
      sim.writeTrail(trail);
      const view = { center: [cx + 0.5, cy + 0.5] as [number, number], scale };
      const img = await backend.capture(sim, { ...defaultSettings(), ...patch }, view, SIZE, SIZE);
      const c = blobCentre(img);
      expect(c.pixels).toBeGreaterThan(30);
      // A closed arena cuts the blob at its edge: only check the axes it does not cut. A lookup one cell
      // off moves the centre by 8 px at 8 px per cell.
      const tolerance = scale < 1 ? 1.5 : 0.75;
      if (boundary === 'wrap' || (cx > 8 && cx < w - 9)) expect(Math.abs(c.x - SIZE / 2)).toBeLessThan(tolerance);
      if (boundary === 'wrap' || (cy > 8 && cy < h - 9)) expect(Math.abs(c.y - SIZE / 2)).toBeLessThan(tolerance);
    });
  });

  // The gel height field has a one-cell border, so it is two texels larger than the grid (render.ts).
  if (kind === 'webgpu')
    it.each([true, false])('draws a grid at the largest side it reports, in every style (wide %s)', async (wide) => {
      const { device } = (backend as WebGpuBackend).gpu;
      const side = backend.maxGridSide;
      const sim = await make({}, wide ? side : 16, wide ? 16 : side, 64);
      for (const style of STYLES) {
        device.pushErrorScope('validation');
        await backend.capture(sim, { ...defaultSettings(), style }, { center: [8, 8], scale: 1 }, 8, 8);
        expect((await device.popErrorScope())?.message, style).toBeUndefined();
      }
    });

  // WebGPU sorts the agent buffer by position now and then, into the other of two buffers (shaders/sort.wgsl);
  // the model must not notice (ADR 0005). Random streams and claim keys follow the agent id, not the slot.
  if (kind === 'webgpu')
    describe('agent sort', () => {
      const strains = [0, 1, 2].map((i) => defaultStrain(i));

      // 72 steps: sorting every 1, 8 or 32 steps makes 72, 9 or 3 sorts, so runs end on either buffer.
      async function open(collisions: boolean, sortInterval: number) {
        const patch = { seed: 7, collisions, density: collisions ? 0.5 : 2, strains };
        const sim = (await make(patch, 64, 48, collisions ? 1536 : 6144)) as Simulation;
        sim.sortInterval = sortInterval;
        sim.run(72);
        return sim;
      }

      // Every random stream: inoculate and cut draw from TOOL, shrinkage from SHRINK, and the wall and the
      // box edge block moves (BLOCK). Agent counts that are not a multiple of the workgroup size and a grid
      // that is not a multiple of the 8-cell sort tile check the bounds of the sort.
      async function arena(collisions: boolean, sortInterval: number) {
        const patch: Partial<Settings> = {
          seed: 11,
          collisions,
          density: collisions ? 0.4 : 2,
          strains,
          boundary: 'box',
          shrink: 0.01,
        };
        const sim = (await make(patch, 61, 45, collisions ? 1001 : 5003)) as Simulation;
        sim.sortInterval = sortInterval;
        sim.paint({ kind: 'wall', from: [10, 10], to: [50, 30], radius: 1.5 });
        sim.run(20);
        sim.run(1, { kind: AgentToolKind.inoculate, x: 30, y: 22, radius: 8, strain: 1, revive: 0.5, teleport: 0.3 });
        sim.run(15);
        sim.run(1, { kind: AgentToolKind.cut, x: 20, y: 20, radius: 6, strain: 0, revive: 0, teleport: 0 });
        sim.run(35);
        return sim;
      }

      const state = async (sim: Sim) => ({ agents: await sim.readAgents(), trail: Array.from(await sim.readTrail()) });

      it.each([
        ['wrap', false],
        ['wrap', true],
        ['box with tools and shrinkage', false],
        ['box with tools and shrinkage', true],
      ] as const)(
        'gives the same agents and trails as unsorted runs (%s, collisions %s)',
        async (scene, collisions) => {
          const build = scene === 'wrap' ? open : arena;
          const unsorted = await state(await build(collisions, 0));
          if (scene !== 'wrap') {
            // Shrinkage must kill a part of the agents, or its random stream would not matter.
            const dead = unsorted.agents.filter((a) => (a.bits & 4) === 0).length;
            expect(dead).toBeGreaterThan(unsorted.agents.length / 10);
            expect(dead).toBeLessThan(unsorted.agents.length);
          }
          for (const interval of [1, 8, 32]) {
            const sorted = await state(await build(collisions, interval));
            expect(sorted.trail, `sort every ${interval} steps`).toEqual(unsorted.trail);
            expect(sorted.agents, `sort every ${interval} steps`).toEqual(unsorted.agents);
          }
        },
      );

      it('really reorders the buffer, and keeps every id once', async () => {
        const sim = (await make({ seed: 7, density: 2, strains: [defaultStrain(0)] }, 96, 80, 15360)) as Simulation;
        sim.run(33); // two sorts: steps 0 and 32
        const raw = new Uint32Array(await readBuffer(sim.device, sim.agentBuffer));
        const ids = Array.from({ length: sim.agents }, (_, k) => (raw[k * 4 + 3] ?? 0) >>> 3);
        expect(new Set(ids).size).toBe(sim.agents);
        expect(ids.filter((id, k) => id !== k).length).toBeGreaterThan(sim.agents / 2);
      });

      // One step sorts once (buffer 1 is current), 40 steps sort twice (buffer 0).
      it.each([
        ['one sort', 1],
        ['two sorts', 40],
      ] as const)('writes an agent by id after %s, without creating a duplicate id', async (_, steps) => {
        const sim = await make({ seed: 7, density: 1, strains: [defaultStrain(0), defaultStrain(1)] }, 64, 64, 4096);
        sim.run(steps);
        const before = await sim.readAgents();
        sim.writeAgent(1234, { x: 10.5, y: 20.5, heading: 1, bits: 4 | 1 });
        const after = await sim.readAgents(); // throws if an id is missing or doubled
        expect(after[1234]).toEqual({ x: 10.5, y: 20.5, heading: 1, bits: 5 });
        expect(after.filter((_, i) => i !== 1234)).toEqual(before.filter((_, i) => i !== 1234));
        expect(() => {
          sim.writeAgent(4096, { x: 0, y: 0, heading: 0, bits: 4 });
        }).toThrow(RangeError);
      });

      it('builds the occupancy from the current buffer when collisions are switched on', async () => {
        const run = async (sortInterval: number) => {
          const settings = { ...defaultSettings(), seed: 9, density: 0.5, strains };
          const sim = (await make(settings, 64, 48, 1500)) as Simulation;
          sim.sortInterval = sortInterval;
          sim.run(1); // sorted: buffer 1 is current
          sim.update({ ...settings, collisions: true });
          sim.run(40);
          return state(sim);
        };
        expect(await run(32)).toEqual(await run(0));
      });

      it.each([false, true])('starts over from scratch after an odd number of sorts (collisions %s)', async (c) => {
        const patch = { seed: 9, collisions: c, density: 0.5, strains };
        const sim = (await make(patch, 64, 48, 1500)) as Simulation;
        sim.run(1); // sorted: buffer 1 is current
        sim.reset();
        sim.run(40);
        const fresh = await make(patch, 64, 48, 1500);
        fresh.run(40);
        expect(await state(sim)).toEqual(await state(fresh));
      });
    });
});
