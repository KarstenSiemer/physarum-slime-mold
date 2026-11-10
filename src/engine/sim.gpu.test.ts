// Runs in Chromium with real GPU APIs (Metal locally, SwiftShader in CI). See ADR 0010.
// Every model test runs against both backends, so WGSL and GLSL cannot drift apart (ADR 0003).
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { hexToLinear } from '../model/color';
import { BOUNDARIES, defaultSettings, defaultStrain, LAYOUTS, STYLES, type Settings } from '../model/params';
import { WebGl2Backend } from './gl/backend';
import { AgentToolKind } from './pack';
import { paintReference } from './paint-reference';
import { readBuffer } from './readback';
import { BACKGROUND } from './render';
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
import type { Backend, Sim, Stroke, View } from './types';
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

type Vec3 = [number, number, number];

/**
 * The gel style on the CPU, as render.wgsl drew it before its height pre-pass: every height lookup runs the
 * full trail filter, with levels() applied to the filtered trail. Returns sRGB bytes without the dither.
 */
function gelReference(
  trail: Float32Array,
  [w, h]: [number, number],
  settings: Settings,
  view: View,
  { exposure, black }: { exposure: number; black: number },
  [cw, ch]: [number, number],
) {
  const wrap = settings.boundary === 'wrap';
  const colors = settings.strains.map((st) => hexToLinear(st.color));
  const bg = hexToLinear(BACKGROUND.gel);
  const trailAt = (x: number, y: number, s: number) => {
    if (wrap) [x, y] = [((x % w) + w) % w, ((y % h) + h) % h];
    else if (x < 0 || y < 0 || x >= w || y >= h) return 0;
    return trail[(y * w + x) * 4 + s] ?? 0;
  };
  const bilinear = (px: number, py: number) => {
    const [qx, qy] = [px - 0.5, py - 0.5];
    const [x0, y0] = [Math.floor(qx), Math.floor(qy)];
    const [fx, fy] = [qx - x0, qy - y0];
    return [0, 1, 2, 3].map((s) => {
      const a = trailAt(x0, y0, s) * (1 - fx) + trailAt(x0 + 1, y0, s) * fx;
      const b = trailAt(x0, y0 + 1, s) * (1 - fx) + trailAt(x0 + 1, y0 + 1, s) * fx;
      return a * (1 - fy) + b * fy;
    });
  };
  const filtered = (px: number, py: number) => {
    if (view.scale <= 1) return bilinear(px, py);
    const o = 0.25 * view.scale;
    const taps = [
      bilinear(px - o, py - o),
      bilinear(px + o, py - o),
      bilinear(px - o, py + o),
      bilinear(px + o, py + o),
    ];
    return [0, 1, 2, 3].map((s) => 0.25 * taps.reduce((sum, t) => sum + (t[s] ?? 0), 0));
  };
  const levels = (v: number[]) => {
    const t = v.reduce((a, b) => a + b, 0);
    return v.map((x) => (x * Math.max(t - black, 0)) / Math.max(t, 1e-20));
  };
  const height = (px: number, py: number) =>
    1 - Math.exp(-levels(filtered(px, py)).reduce((a, b) => a + b, 0) * exposure);
  const norm = (v: Vec3): Vec3 => {
    const l = Math.hypot(...v);
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const light = norm([-0.45, -0.6, 0.65]);
  const half = norm([light[0], light[1], light[2] + 1]);
  const srgb = (c: number) => {
    const x = Math.min(1, Math.max(0, c));
    return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
  };
  const out = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < ch; y++)
    for (let x = 0; x < cw; x++) {
      const [px, py] = [
        (x + 0.5 - cw / 2) * view.scale + view.center[0],
        (y + 0.5 - ch / 2) * view.scale + view.center[1],
      ];
      let c: number[];
      if (!wrap && (px < 0 || py < 0 || px >= w || py >= h)) c = bg.map((b) => b * 0.55);
      else {
        const v = levels(filtered(px, py));
        const d = Math.max(view.scale, 0.75);
        const hh = height(px, py);
        const gx = height(px + d, py) - height(px - d, py);
        const gy = height(px, py + d) - height(px, py - d);
        const n = norm([-gx, -gy, 0.35 * d]);
        const diffuse = Math.max(dot(n, light), 0);
        const spec = Math.max(dot(n, half), 0) ** 48;
        const total = v.reduce((a, b) => a + b, 0);
        const tint = [0, 1, 2].map((k) => colors.reduce((sum, col, s) => sum + (v[s] ?? 0) * (col[k] ?? 0), 0));
        const albedo = total > 1e-6 ? tint.map((t) => t / total) : (colors[0] ?? bg);
        const t = Math.min(1, Math.max(0, (hh - 0.02) / 0.33));
        const mix = t * t * (3 - 2 * t);
        c = albedo.map((a, k) => (bg[k] ?? 0) * (1 - mix) + (a * (0.25 + 0.9 * diffuse) + 0.6 * spec * hh) * mix);
      }
      for (let k = 0; k < 3; k++) out[(y * cw + x) * 4 + k] = Math.round(srgb(c[k] ?? 0) * 255);
      out[(y * cw + x) * 4 + 3] = 255;
    }
  return out;
}

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
      sim.paint([{ kind: 'wall', from: [33.5, 32.5], to: [33.5, 32.5], radius: 1.2 }]);
      sim.writeAgent(0, { x: 32.5, y: 32.5, heading: 0, bits: 4 });
      sim.run(1);
      const [a] = await sim.readAgents();
      expect(a?.x).toBe(32.5);
      expect(a?.y).toBe(32.5);
      expect(a?.heading).not.toBe(0);
      expect(total(await sim.readCounts())).toBe(0);
    });

    // A step longer than a wall is thick must not jump it: a move checks every cell it crosses (clearPath in
    // agents.wgsl and agents.frag). A one-cell wall in column `wall`, 96 agents in the three columns before it,
    // heading up to 60° off +x; column 1 makes the moves cross the wrap seam.
    it.each([
      [24, false],
      [24, true],
      [1, false],
      [1, true],
    ])('never lets a step of 3 cells cross a one-cell wall (column %i, collisions %s)', async (wall, collisions) => {
      const [w, h, n] = [48, 32, 96];
      const strains = [{ ...defaultStrain(0), sensorAngle: 0, sensorOffset: 1, stepSize: 3 }];
      const beyond = async (painted: boolean) => {
        const sim = await make({ layout: 'empty', strains }, w, h, n);
        if (painted) sim.paint([{ kind: 'wall', from: [wall + 0.5, 0], to: [wall + 0.5, h], radius: 0.5 }]);
        for (let i = 0; i < n; i++) {
          const x = (wall - 3 + (i % 3) + 0.25 + (0.5 * ((i * 7) % 11)) / 11 + w) % w;
          const heading = ((((i * 37) % 121) - 60) * Math.PI) / 180;
          sim.writeAgent(i, { x, y: Math.floor(i / 3) + 0.5, heading, bits: 4 });
        }
        // The occupancy is built from the agents written above when the rule is switched on.
        if (collisions) sim.update({ ...defaultSettings(), layout: 'empty', strains, collisions: true });
        sim.run(1);
        const agents = await sim.readAgents();
        expect(agents.every((a) => a.bits & 4)).toBe(true);
        // Columns from the wall on, in the direction of the moves.
        return agents.filter((a) => (Math.floor(a.x) - wall + w) % w < w / 2).length;
      };
      expect(await beyond(false)).toBeGreaterThan(20); // without the wall, many moves end at or past its column
      expect(await beyond(true)).toBe(0);
    });

    it('cannot slip through two wall cells that touch at a corner, nor touch a wall at a corner', async () => {
      // A move from (11.5, 2.5) to (12.5, 1.5) passes exactly through the grid corner (12, 2).
      const strains = [{ ...defaultStrain(0), sensorAngle: 0, sensorOffset: 1, stepSize: Math.SQRT2 }];
      const move = async (walls: [number, number][]) => {
        const sim = await make({ layout: 'empty', strains }, 32, 32, 1);
        const env = new Uint8Array(32 * 32 * 4);
        for (const [x, y] of walls) env[(y * 32 + x) * 4] = 255;
        sim.writeEnv(env);
        sim.writeAgent(0, { x: 11.5, y: 2.5, heading: -Math.PI / 4, bits: 4 });
        sim.run(1);
        const [a] = await sim.readAgents();
        return [Math.floor(a?.x ?? -1), Math.floor(a?.y ?? -1)];
      };
      expect(await move([])).toEqual([12, 1]);
      expect(await move([[13, 13]])).toEqual([12, 1]); // a wall elsewhere turns the walk on
      expect(
        await move([
          [11, 1],
          [12, 2],
        ]),
      ).toEqual([11, 2]); // the destination is free, the way is not
      expect(await move([[12, 2]])).toEqual([11, 2]); // the segment touches this wall cell at its corner
    });
  });

  describe('environment', () => {
    it('paints food, light and walls, and erases them', async () => {
      const sim = await make({ layout: 'empty' }, 64, 64, 1);
      sim.paint([{ kind: 'food', from: [10, 10], to: [20, 10], radius: 3 }]);
      sim.paint([{ kind: 'light', from: [40, 40], to: [40, 40], radius: 6 }]);
      sim.paint([{ kind: 'wall', from: [10, 50], to: [50, 50], radius: 1.5 }]);
      const env = await sim.readEnv();
      const at = (x: number, y: number, ch: number) => env[(y * 64 + x) * 4 + ch] ?? 0;
      expect(at(15, 10, 1)).toBe(255); // food
      expect(at(40, 40, 2)).toBeGreaterThan(200); // light, soft edge
      expect(at(30, 50, 0)).toBe(255); // wall
      expect(at(5, 30, 1) + at(5, 30, 0)).toBe(0);
      sim.paint([{ kind: 'erase', from: [15, 10], to: [15, 10], radius: 2 }]);
      expect((await sim.readEnv())[(10 * 64 + 15) * 4 + 1]).toBe(0);
    });

    /** Bytes that differ from the CPU reference (light, a soft edge rounded to 8 bits from float32, by more than 1). */
    function unlike(env: Uint8Array, ref: Uint8Array) {
      const wrong: string[] = [];
      for (let i = 0; i < ref.length; i++) {
        const tolerance = i % 4 === 2 ? 1 : 0;
        if (Math.abs((env[i] ?? 0) - (ref[i] ?? 0)) > tolerance)
          wrong.push(`cell ${Math.floor(i / 4)} byte ${i % 4}: ${env[i] ?? '-'} ≠ ${ref[i] ?? '-'}`);
      }
      return wrong;
    }

    // The engine tests in Node paint with this CPU reference (engine-env.test.ts), so it must match both shaders.
    // WebGL2 scissors each stroke to its cells (brush.ts): the strokes cross the edges of the grid. One call with
    // every stroke must paint what one call per stroke paints.
    it('paints like the CPU reference, across the edges and under each stroke’s own boundary', async () => {
      const [w, h] = [48, 32];
      const strokes: Stroke[] = [
        { kind: 'wall', from: [2.31, 3.13], to: [40.72, 29.41], radius: 0.75 },
        { kind: 'food', from: [46.63, 16.21], to: [46.63, 16.21], radius: 3.33, boundary: 'wrap' }, // wraps to x = 0
        { kind: 'light', from: [24.23, 1.17], to: [30.41, 1.17], radius: 5.23, boundary: 'wrap' }, // and to the bottom
        { kind: 'food', from: [0.37, 0.41], to: [0.37, 0.41], radius: 4.11, boundary: 'wrap' }, // into all four corners
        { kind: 'erase', from: [20.13, 15.37], to: [22.61, 17.93], radius: 1.91 },
        { kind: 'food', from: [5.43, 30.61], to: [9.37, 30.61], radius: 4.27 }, // clipped by the box
        { kind: 'wall', from: [30.23, 20.31], to: [44.17, 9.23], radius: 2.21, boundary: 'dish' },
      ];
      const ref = new Uint8Array(w * h * 4);
      const margin = { min: Infinity };
      for (const s of strokes) paintReference(ref, w, h, s, 'box', margin);
      // No cell centre within 0.001 cells of a brush edge, where float32 could round it the other way.
      expect(margin.min).toBeGreaterThan(1e-3);
      const one = await make({ layout: 'empty', boundary: 'box' }, w, h, 1);
      for (const s of strokes) one.paint([s]);
      const all = await make({ layout: 'empty', boundary: 'box' }, w, h, 1);
      all.paint(strokes);
      for (const sim of [one, all]) {
        const env = await sim.readEnv();
        expect(unlike(env, ref)).toEqual([]);
        // The strokes reach every corner and both sides of the wrap seam.
        for (const c of [0, w - 1, (h - 1) * w, h * w - 1]) expect(env[c * 4 + 1], `corner cell ${c}`).toBe(255);
      }
    });

    // A view zoomed out over a periodic grid shows many copies of it, and a fast drag there gives a stroke longer
    // than the grid; a stroke mapped from a coarse grid to a fine one can be a brush larger than the grid. Both
    // passes paint them as segments (brush.ts paintSegments), WebGPU over a box of at most one grid (paintBox).
    it.each([
      [
        'far copies and strokes longer than the grid',
        [
          { kind: 'food', from: [-2 * 64 + 10.31, 20.73], to: [-2 * 64 + 13.17, 21.41], radius: 3.34 }, // two periods left
          { kind: 'food', from: [40.23, 3 * 48 + 5.43], to: [40.23, 3 * 48 + 5.43], radius: 2.71 }, // three periods down
          { kind: 'wall', from: [-70.31, 10.63], to: [140.77, -60.41], radius: 0.98 }, // over three periods
          { kind: 'light', from: [5.31, 40.37], to: [5.31, 40.37], radius: 41.22 }, // wider than the grid
          { kind: 'erase', from: [-20.17, 30.29], to: [100.43, 31.61], radius: 2.21 }, // longer than the grid
          { kind: 'food', from: [33.11, 2.37], to: [-90.71, 8.13], radius: 1.28, boundary: 'box' }, // cut by the box
        ],
      ],
      [
        'brushes larger than a closed arena',
        [
          { kind: 'light', from: [20.17, 25.41], to: [20.17, 25.41], radius: 300.29, boundary: 'dish' },
          { kind: 'food', from: [10.29, 10.37], to: [70.29, 10.37], radius: 130.43, boundary: 'box' },
          { kind: 'erase', from: [-500, 5.5], to: [500, 5.5], radius: 2.21, boundary: 'box' },
        ],
      ],
    ] satisfies [string, Stroke[]][])('paints %s like the CPU reference', async (_, strokes) => {
      const [w, h] = [64, 48];
      const ref = new Uint8Array(w * h * 4);
      const margin = { min: Infinity };
      for (const s of strokes) paintReference(ref, w, h, s, 'wrap', margin);
      expect(margin.min).toBeGreaterThan(1e-3);
      for (const split of [false, true]) {
        const sim = await make({ layout: 'empty' }, w, h, 1);
        if (split) for (const s of strokes) sim.paint([s]);
        else sim.paint(strokes);
        expect(unlike(await sim.readEnv(), ref), split ? 'one call per stroke' : 'one call').toEqual([]);
      }
    });

    // WebGPU paints 4096 strokes per submission: 5000 strokes cross that edge. Strokes that pass a cell centre
    // within float32 rounding of their edge are drawn again.
    it('paints 5000 strokes in one call like the CPU reference', async () => {
      const [w, h] = [64, 48];
      let seed = 3;
      const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
      const kinds = ['food', 'wall', 'light', 'erase'] as const;
      const ref = new Uint8Array(w * h * 4);
      const strokes: Stroke[] = [];
      while (strokes.length < 5000) {
        const [x, y] = [rnd() * w, rnd() * h];
        const kind = kinds[strokes.length % 4] ?? 'food';
        const s: Stroke = { kind, from: [x, y], to: [x + 2 * rnd(), y + 2 * rnd()], radius: 0.75 + 2 * rnd() };
        const margin = { min: Infinity };
        paintReference(new Uint8Array(w * h * 4), w, h, s, 'wrap', margin);
        if (margin.min < 1e-3) continue;
        paintReference(ref, w, h, s, 'wrap');
        strokes.push(s);
      }
      const sim = await make({ layout: 'empty' }, w, h, 1);
      sim.paint(strokes);
      expect(unlike(await sim.readEnv(), ref)).toEqual([]);
    });

    // One threshold in every shader that reads walls (isWall in common.wgsl and common.glsl): a wall byte of
    // 128 or more. Row 2 + k holds wall byte BYTES[k] in columns 11 to 20.
    describe('wall bytes from 128 on are walls', () => {
      const BYTES = [0, 1, 64, 127, 128, 129, 200, 255];
      const [w, h] = [32, 16];
      const env = new Uint8Array(w * h * 4);
      BYTES.forEach((b, k) => {
        for (let x = 11; x <= 20; x++) env[((2 + k) * w + x) * 4] = b;
      });
      const wall = BYTES.map((b) => b >= 128);

      it('for moves', async () => {
        // All three sensors on the next cell: they read the same value, so the agent keeps its heading.
        const strains = [{ ...defaultStrain(0), sensorAngle: 0, sensorOffset: 1 }];
        const sim = await make({ layout: 'empty', strains }, w, h, BYTES.length);
        sim.writeEnv(env);
        BYTES.forEach((_, k) => {
          sim.writeAgent(k, { x: 10.5, y: 2.5 + k, heading: 0, bits: 4 });
        });
        sim.run(1);
        expect((await sim.readAgents()).map((a) => Math.floor(a.x) === 10)).toEqual(wall);
      });

      it('for diffusion', async () => {
        const sim = await make({ layout: 'empty' }, w, h, 1);
        sim.writeEnv(env);
        sim.writeTrail(new Float32Array(w * h * 4).fill(1));
        sim.run(1);
        const trail = await sim.readTrail();
        // A wall holds no trail; an open cell keeps the mean of its open neighbours, all 1, times 1 − decay.
        const at = BYTES.map((_, k) => trail[((2 + k) * w + 15) * 4] ?? -1);
        expect(at.map((v) => (v === 0 ? 'wall' : Math.abs(v - 0.9) < 1e-6 ? 'open' : v))).toEqual(
          wall.map((x) => (x ? 'wall' : 'open')),
        );
      });

      it('for start positions', async () => {
        const sim = await make({ layout: 'mixed', density: 8 }, w, h, 8 * w * h);
        sim.writeEnv(env);
        sim.reset();
        const inRow = BYTES.map(() => 0);
        for (const a of await sim.readAgents()) {
          const [x, y] = [Math.floor(a.x), Math.floor(a.y)];
          if (a.bits & 4 && x >= 11 && x <= 20 && y >= 2 && y < 2 + BYTES.length)
            inRow[y - 2] = (inRow[y - 2] ?? 0) + 1;
        }
        // 80 agents per row on average; none in a wall.
        expect(inRow.map((n) => n > 20)).toEqual(wall.map((x) => !x));
        expect(inRow.filter((_, k) => wall[k])).toEqual([0, 0, 0, 0]);
      });
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

    /** Alive agents, the cells holding more than one, and alive agents in a wall or outside the arena. */
    async function starts(sim: Sim, boundary: Settings['boundary']) {
      const { width: w, height: h } = sim;
      const env = await sim.readEnv();
      const per = new Map<number, number>();
      let [alive, blocked] = [0, 0];
      for (const a of await sim.readAgents()) {
        if (!(a.bits & 4)) continue;
        alive++;
        const [x, y] = [Math.floor(a.x), Math.floor(a.y)];
        const inside =
          x >= 0 &&
          y >= 0 &&
          x < w &&
          y < h &&
          (boundary !== 'dish' || Math.hypot(x + 0.5 - w / 2, y + 0.5 - h / 2) <= Math.min(w, h) / 2 - 1);
        const c = y * w + x;
        if (!inside || (env[c * 4] ?? 0) >= 128) blocked++;
        per.set(c, (per.get(c) ?? 0) + 1);
      }
      return { alive, shared: [...per.values()].filter((k) => k > 1).length, blocked };
    }

    // Every layout and arena, with a wall across the middle: 20 agents fit every layout's region (the centre
    // spot holds about 46 cells on this grid), so all of them start alive, each in a cell of its own (ADR 0008).
    it.each(LAYOUTS.filter((l) => l !== 'empty').flatMap((l) => BOUNDARIES.map((b) => [l, b] as const)))(
      'starts every agent of the %s layout in a %s on a free cell of its own',
      async (layout, boundary) => {
        const sim = await make({ layout, boundary, collisions: true, seed: 5 }, 64, 48, 20);
        sim.paint([{ kind: 'wall', from: [0, 23.5], to: [64, 25.5], radius: 1.5 }]);
        sim.reset();
        expect(await starts(sim, boundary)).toEqual({ alive: 20, shared: 0, blocked: 0 });
      },
    );

    it('keeps the region of a layout: the centre spot, a colony, the ring', async () => {
      const [w, h] = [64, 48];
      const m = Math.min(w, h);
      for (const [layout, near, far] of [
        ['center', 0, 0.08 * m + 1],
        ['colonies', 0, 0.1 * m + 1],
        ['ring', 0.3 * m - 2, 0.3 * m + 2],
      ] as const) {
        const sim = await make({ layout, collisions: true, seed: 5 }, w, h, 20);
        for (const a of await sim.readAgents()) {
          const r = Math.hypot(a.x - w / 2, a.y - h / 2);
          expect(r, layout).toBeGreaterThanOrEqual(near);
          expect(r, layout).toBeLessThanOrEqual(far);
        }
      }
    });

    // Shrinking plasmodium: 0.64 agents per dish cell, and 0.5 % more agents than the dish has free cells for.
    it('fills a dish to 64 % with every agent on a cell of its own, and starts the rest dead when it is full', async () => {
      const [w, h] = [64, 48];
      const cells = Array.from({ length: w * h }, (_, c) => [c % w, Math.floor(c / w)] as const).filter(
        ([x, y]) => Math.hypot(x + 0.5 - w / 2, y + 0.5 - h / 2) <= Math.min(w, h) / 2 - 1,
      ).length;
      const dense = await make({ boundary: 'dish', collisions: true, seed: 3 }, w, h, Math.round(0.64 * cells));
      expect(await starts(dense, 'dish')).toEqual({ alive: Math.round(0.64 * cells), shared: 0, blocked: 0 });
      const full = await make({ boundary: 'dish', collisions: true, seed: 3 }, w, h, cells + 8);
      const s = await starts(full, 'dish');
      expect([s.shared, s.blocked]).toEqual([0, 0]);
      expect(s.alive).toBeGreaterThan(0.97 * cells);
      expect(s.alive).toBeLessThanOrEqual(cells);
    });

    // An offset just below 1 rounds into the next cell from coordinate 256 on (f32): with seed 7 the old start
    // shared one cell here. The clamp keeps every agent of the permutation in its own cell.
    it('keeps every agent of the mixed layout inside its own cell on a 512 × 288 grid', async () => {
      const sim = await make({ collisions: true, seed: 7 }, 512, 288, Math.round(0.2 * 512 * 288));
      expect(await starts(sim, 'wrap')).toEqual({ alive: Math.round(0.2 * 512 * 288), shared: 0, blocked: 0 });
    });

    it('places the same agents again for the same seed', async () => {
      const place = async () => {
        const sim = await make({ layout: 'center', boundary: 'dish', collisions: true, seed: 9 }, 64, 48, 30);
        return sim.readAgents();
      };
      expect(await place()).toEqual(await place());
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

    // The colours, against the CPU reference above. Every cell holds trail below the black level, which
    // must stay background, and two blobs of two strains rise above it. Fit (one lookup per height) and
    // zoomed out (four taps), across the wrap seam and the edge of a closed box.
    it.each([
      ['wrap', 16, 12, 1 / 4],
      ['wrap', 0, 0, 1 / 8],
      ['wrap', 32, 24, 1.5],
      ['box', 2, 20, 1 / 4],
      ['box', 32, 24, 1.5],
    ] as const)('matches the reference colours (%s, centre %i, %i, scale %f)', async (boundary, cx, cy, scale) => {
      const [w, h] = [64, 48];
      const strains = [defaultStrain(0), defaultStrain(1)];
      const settings: Settings = {
        ...defaultSettings(),
        style: 'gel',
        boundary,
        layout: 'empty',
        strains,
        exposure: 1,
      };
      const sim = await make(settings, w, h, 1);
      const trail = new Float32Array(w * h * 4);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const blob = (bx: number, by: number, r: number) => Math.exp(-((x - bx) ** 2 + (y - by) ** 2) / (2 * r * r));
          trail[(y * w + x) * 4] = 1 + 30 * blob(14, 14, 3) + 12 * blob(3, 22, 2);
          trail[(y * w + x) * 4 + 1] = 20 * blob(40, 28, 4);
        }
      sim.writeTrail(trail);
      const levels = await backend.settle(sim);
      expect(levels.black).toBeGreaterThan(1); // above the trail of the empty cells
      const view = { center: [cx, cy] as [number, number], scale };
      const img = await backend.capture(sim, settings, view, SIZE, SIZE);
      const exposure = levels.gain * 2 ** settings.exposure;
      const ref = gelReference(trail, [w, h], settings, view, { exposure, black: levels.black }, [SIZE, SIZE]);
      // The dither moves a channel by at most 1, hardware filtering of the height field by at most 2.
      let [max, sum] = [0, 0];
      for (let i = 0; i < ref.length; i++) {
        if (i % 4 === 3) continue;
        const d = Math.abs((img.data[i] ?? 0) - (ref[i] ?? 0));
        [max, sum] = [Math.max(max, d), sum + d];
      }
      expect(max).toBeLessThanOrEqual(3);
      expect(sum / ((ref.length / 4) * 3)).toBeLessThan(0.75);
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
        sim.paint([{ kind: 'wall', from: [10, 10], to: [50, 30], radius: 1.5 }]);
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
