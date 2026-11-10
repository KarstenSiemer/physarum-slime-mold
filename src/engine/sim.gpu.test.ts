// Runs in Chromium with real GPU APIs (Metal locally, SwiftShader in CI). See ADR 0010.
// Every model test runs against both backends, so WGSL and GLSL cannot drift apart (ADR 0003).
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { hexToLinear } from '../model/color';
import { BOUNDARIES, defaultSettings, defaultStrain, LAYOUTS, STYLES, type Settings } from '../model/params';
import { outlineBox, paintBox, paintsCell, paintSegments, type Rect } from './brush';
import { WebGl2Backend } from './gl/backend';
import type { GlSim } from './gl/sim';
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
import { equilibrium } from './sizing';
import { SHAPE_RANGE, type Backend, type Sim, type Stroke, type View } from './types';
import { WebGpuBackend } from './webgpu';

const lane = (a: Float32Array, l = 0) => Float64Array.from({ length: a.length / 4 }, (_, i) => a[i * 4 + l] ?? 0);
const total = (a: ArrayLike<number>) => Array.from(a).reduce((s, v) => s + v, 0);

/** Rec. 709 luma of an sRGB pixel, averaged over the square of side 2r + 1 around it. */
function luma(img: ImageData, x: number, y: number, r = 1) {
  let sum = 0;
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      const i = ((y + dy) * img.width + x + dx) * 4;
      sum += 0.2126 * (img.data[i] ?? 0) + 0.7152 * (img.data[i + 1] ?? 0) + 0.0722 * (img.data[i + 2] ?? 0);
    }
  return sum / (2 * r + 1) ** 2;
}

/** Sum over R, G and B of the difference between two captures, averaged over the square of side 2r + 1. */
function colorDiff(a: ImageData, b: ImageData, x: number, y: number, r = 1) {
  let sum = 0;
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      const i = ((y + dy) * a.width + x + dx) * 4;
      for (let k = 0; k < 3; k++) sum += Math.abs((a.data[i + k] ?? 0) - (b.data[i + k] ?? 0));
    }
  return sum / (2 * r + 1) ** 2;
}

/** The largest difference of one channel between two captures. */
function maxDiff(a: ImageData, b: ImageData) {
  let max = 0;
  for (let i = 0; i < a.data.length; i++)
    if (i % 4 !== 3) max = Math.max(max, Math.abs((a.data[i] ?? 0) - (b.data[i] ?? 0)));
  return max;
}

/** Distance from a point to a segment. */
function segmentDistance([px, py]: [number, number], [ax, ay]: [number, number], [bx, by]: [number, number]) {
  const [abx, aby] = [bx - ax, by - ay];
  const t = Math.min(1, Math.max(0, ((px - ax) * abx + (py - ay) * aby) / Math.max(abx * abx + aby * aby, 1e-6)));
  return Math.hypot(px - ax - t * abx, py - ay - t * aby);
}

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
 * The styles on the CPU without food, light and walls, as render.wgsl drew them before PR 3 (ef7f2af): the trail
 * filtered bilinearly (four taps when zoomed out), levels(), then glow (without bloom), paper or gel; the agents
 * style draws the agent counts of the cell under each pixel. The gel lighting runs the full trail filter for every
 * height lookup, as before its height pre-pass. The box edge and the dish rim fade over one pixel into the outside
 * colour, as render.wgsl draws them now. Returns sRGB bytes without the dither.
 */
function styleReference(
  { trail, counts }: { trail: Float32Array; counts?: Float32Array },
  [w, h]: [number, number],
  settings: Settings,
  view: View,
  { exposure, black }: { exposure: number; black: number },
  [cw, ch]: [number, number],
) {
  const { style, boundary } = settings;
  const wrap = boundary === 'wrap';
  const colors = settings.strains.map((st) => hexToLinear(st.color));
  const bg = hexToLinear(BACKGROUND[style]);
  const cellOf = (x: number, y: number) => {
    if (wrap) [x, y] = [((x % w) + w) % w, ((y % h) + h) % h];
    else if (x < 0 || y < 0 || x >= w || y >= h) return -1;
    return y * w + x;
  };
  const trailAt = (x: number, y: number, s: number) => {
    const i = cellOf(x, y);
    return i < 0 ? 0 : (trail[i * 4 + s] ?? 0);
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
  const tint = (v: number[]) =>
    [0, 1, 2].map((k) => colors.reduce((sum, col, s) => sum + (v[s] ?? 0) * (col[k] ?? 0), 0));
  const glow = (v: number[]) => {
    const t = tint(v);
    return bg.map((b, k) => b + (1 - b) * (1 - Math.exp(-(t[k] ?? 0) * exposure)));
  };
  const paper = (v: number[]) =>
    bg.map((b, k) => {
      const absorb = colors.reduce((sum, col, s) => sum + (v[s] ?? 0) * (0.15 + 0.85 * (1 - (col[k] ?? 0))), 0);
      return b * Math.exp(-absorb * exposure);
    });
  const height = (px: number, py: number) =>
    1 - Math.exp(-levels(filtered(px, py)).reduce((a, b) => a + b, 0) * exposure);
  const norm = (v: Vec3): Vec3 => {
    const l = Math.hypot(...v);
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const light = norm([-0.45, -0.6, 0.65]);
  const half = norm([light[0], light[1], light[2] + 1]);
  const gel = (px: number, py: number, v: number[]) => {
    const d = Math.max(view.scale, 0.75);
    const hh = height(px, py);
    const gx = height(px + d, py) - height(px - d, py);
    const gy = height(px, py + d) - height(px, py - d);
    const n = norm([-gx, -gy, 0.35 * d]);
    const diffuse = Math.max(dot(n, light), 0);
    const spec = Math.max(dot(n, half), 0) ** 48;
    const total = v.reduce((a, b) => a + b, 0);
    const albedo = total > 1e-6 ? tint(v).map((t) => t / total) : (colors[0] ?? bg);
    const mix = smoothstep(0.02, 0.35, hh);
    return albedo.map((a, k) => (bg[k] ?? 0) * (1 - mix) + (a * (0.25 + 0.9 * diffuse) + 0.6 * spec * hh) * mix);
  };
  const srgb = (c: number) => {
    const x = Math.min(1, Math.max(0, c));
    return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
  };
  const outside = bg.map((b) => b * (style === 'paper' ? 0.92 : 0.55));
  const out = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < ch; y++)
    for (let x = 0; x < cw; x++) {
      const [px, py] = [
        (x + 0.5 - cw / 2) * view.scale + view.center[0],
        (y + 0.5 - ch / 2) * view.scale + view.center[1],
      ];
      // The share of the pixel inside the arena: a ramp one pixel wide across the box edge and the dish rim.
      const ramp = (sd: number) => smoothstep(-0.5 * view.scale, 0.5 * view.scale, sd);
      const inside = wrap
        ? 1
        : boundary === 'box'
          ? ramp(Math.min(px, py, w - px, h - py))
          : ramp(0.5 * Math.min(w, h) - 1 - Math.hypot(px - w / 2, py - h / 2));
      let c = outside;
      if (inside > 0) {
        let lit: number[];
        if (style === 'agents') {
          const i = cellOf(Math.floor(px), Math.floor(py));
          lit = glow([0, 1, 2, 3].map((s) => (i < 0 ? 0 : (counts?.[i * 4 + s] ?? 0))));
        } else {
          const v = levels(filtered(px, py));
          lit = style === 'glow' ? glow(v) : style === 'paper' ? paper(v) : gel(px, py, v);
        }
        c = inside >= 1 ? lit : lit.map((l, k) => (outside[k] ?? 0) * (1 - inside) + l * inside);
      }
      for (let k = 0; k < 3; k++) out[(y * cw + x) * 4 + k] = Math.round(srgb(c[k] ?? 0) * 255);
      out[(y * cw + x) * 4 + 3] = 255;
    }
  return out;
}

function smoothstep(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
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
  /** The canvas of the backend: on WebGL2, getContext() hands back the backend's own context. */
  const canvas = document.createElement('canvas');
  const live: Sim[] = [];

  beforeAll(async () => {
    backend = await create(canvas);
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
      expect(await move([[11, 1]])).toEqual([11, 2]); // and this one: float32 walks into the other one first
    });

    // Both cells beside the corner count, in every diagonal direction: float32 rounding decides which of them a
    // plain walk enters, so each one alone must block (agents.wgsl and agents.frag clearPath, CORNER).
    it('counts both cells beside a corner the move passes, in every diagonal direction', async () => {
      const strains = [{ ...defaultStrain(0), sensorAngle: 0, sensorOffset: 1, stepSize: Math.SQRT2 }];
      const results: string[] = [];
      for (const [sx, sy] of [
        [1, -1],
        [1, 1],
        [-1, 1],
        [-1, -1],
      ] as const) {
        for (const side of [
          [11 + sx, 2],
          [11, 2 + sy],
        ] as const) {
          const sim = await make({ layout: 'empty', strains }, 32, 32, 1);
          const env = new Uint8Array(32 * 32 * 4);
          env[(side[1] * 32 + side[0]) * 4] = 255;
          sim.writeEnv(env);
          sim.writeAgent(0, { x: 11.5, y: 2.5, heading: Math.atan2(sy, sx), bits: 4 });
          sim.run(1);
          const [a] = await sim.readAgents();
          results.push(`${sx},${sy} wall ${side.join(',')}: ${Math.floor(a?.x ?? -1)},${Math.floor(a?.y ?? -1)}`);
        }
      }
      expect(results).toEqual([
        '1,-1 wall 12,2: 11,2',
        '1,-1 wall 11,1: 11,2',
        '1,1 wall 12,2: 11,2',
        '1,1 wall 11,3: 11,2',
        '-1,1 wall 10,2: 11,2',
        '-1,1 wall 11,3: 11,2',
        '-1,-1 wall 10,2: 11,2',
        '-1,-1 wall 11,1: 11,2',
      ]);
    });

    // The longest step the panel allows: a move of 8 cells enters up to 13 cells, so the wall can be the fourth
    // or a later one on the way (the walk loop in clearPath runs up to 24 cells).
    it('never lets a step of 8 cells cross a one-cell wall, also where the wall is far along the move', async () => {
      const [w, h, n, wall] = [64, 40, 128, 32];
      const strains = [{ ...defaultStrain(0), sensorAngle: 0, sensorOffset: 1, stepSize: 8 }];
      const beyond = async (painted: boolean) => {
        const sim = await make({ layout: 'empty', strains }, w, h, n);
        if (painted) sim.paint([{ kind: 'wall', from: [wall + 0.5, 0], to: [wall + 0.5, h], radius: 0.5 }]);
        for (let i = 0; i < n; i++) {
          // 4 to 7 cells before the wall, off the cell centres, heading up to 60° off +x.
          const x = wall - 7 + (i % 4) + 0.1 + (0.8 * ((i * 7) % 11)) / 11;
          const heading = ((((i * 37) % 121) - 60) * Math.PI) / 180;
          sim.writeAgent(i, { x, y: 4.3 + 0.25 * Math.floor(i / 4), heading, bits: 4 });
        }
        sim.run(1);
        const agents = await sim.readAgents();
        expect(agents.every((a) => a.bits & 4)).toBe(true);
        return agents.filter((a) => a.x >= wall).length;
      };
      expect(await beyond(false)).toBeGreaterThan(40);
      expect(await beyond(true)).toBe(0);
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

  // The renderer's outlines (paint.wgsl `outline`, gl/glsl/shape.frag, ADR 0009): signed distances that the
  // simulation never reads. At every cell centre they must agree with `env`, which the simulation reads.
  describe('outline distances for the renderer', () => {
    const [W, H] = [64, 48];
    // Overlapping strokes, walls over food, light under a wall, two erasers, and strokes across the edges
    // and a corner of the grid.
    const strokes: Stroke[] = [
      { kind: 'wall', from: [6, 6], to: [50, 9], radius: 2.56 },
      { kind: 'food', from: [16, 8], to: [24, 16], radius: 5.2 },
      { kind: 'wall', from: [20, 2], to: [21, 34], radius: 1.7 },
      { kind: 'food', from: [1, 26], to: [1, 26], radius: 6 },
      { kind: 'food', from: [W - 3, 30], to: [W + 2, 31], radius: 3.3 },
      { kind: 'light', from: [40, 30], to: [40, 30], radius: 7 },
      { kind: 'erase', from: [18, 12], to: [22, 14], radius: 3.1 },
      { kind: 'wall', from: [W - 4, H - 3], to: [W + 3, H + 2], radius: 2 },
      { kind: 'food', from: [30, H - 1], to: [34, H - 1], radius: 2.2 },
      { kind: 'erase', from: [3, 26], to: [3, 26], radius: 2.4 },
      { kind: 'light', from: [8, 40], to: [12, 44], radius: 5 },
      { kind: 'wall', from: [36, 28], to: [44, 32], radius: 1.1 },
    ];

    /** Cells the simulation has: every cell of a periodic grid or a box, the cells inside the dish (common.wgsl). */
    const inArena = (boundary: string, w: number, h: number, x: number, y: number) =>
      boundary !== 'dish' || Math.hypot(x + 0.5 - w / 2, y + 0.5 - h / 2) <= 0.5 * Math.min(w, h) - 1;

    /** Index of a cell of the arena (wrapped on the periodic grid), or −1, as common.wgsl `cellAt`. */
    const cellAt = (boundary: string, w: number, h: number, x: number, y: number) => {
      if (boundary === 'wrap') return (((y % h) + h) % h) * w + (((x % w) + w) % w);
      if (x < 0 || y < 0 || x >= w || y >= h || !inArena(boundary, w, h, x, y)) return -1;
      return y * w + x;
    };

    /** The drop shadow byte of a cell from a wall test per cell index (paint.wgsl `shadowByte`). */
    function shadowByte(isWall: (i: number) => boolean, boundary: string, w: number, h: number, x: number, y: number) {
      const [sx, sy] = [x + 0.5 - 1.08, y + 0.5 - 1.44];
      const [kx, ky] = [Math.floor(sx), Math.floor(sy)];
      let [sum, all] = [0, 0];
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const weight = Math.max(1 - Math.hypot(kx + dx + 0.5 - sx, ky + dy + 0.5 - sy) / 1.5, 0);
          all += weight;
          const c = cellAt(boundary, w, h, kx + dx, ky + dy);
          if (c >= 0 && isWall(c)) sum += weight;
        }
      return Math.round((sum / all) * 255);
    }

    /**
     * Cells whose outline bytes disagree with `env`: wall or food on the other side, another light, or a drop
     * shadow other than the one of its walls. Cells outside the arena keep their bytes, which are 0 in a new
     * simulation, unless strokes under another boundary painted there (`outside` false: not checked).
     */
    async function disagreements(sim: Sim, boundary: string, outside = true) {
      const [env, shape] = [await sim.readEnv(), await sim.readShape()];
      const { width: w, height: h } = sim;
      const isWall = (i: number) => (env[i * 4] ?? 0) >= 128;
      const wrong: string[] = [];
      const cells = [0, 0];
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          if (!inArena(boundary, w, h, x, y)) {
            if (outside && shape.subarray(i, i + 4).some((v) => v !== 0)) wrong.push(`outside the arena at ${x},${y}`);
            continue;
          }
          const shadow = shadowByte(isWall, boundary, w, h, x, y);
          if (Math.abs((shape[i + 3] ?? 0) - shadow) > 1)
            wrong.push(`shadow at ${x},${y}: ${shape[i + 3]}, not ${shadow}`);
          for (const ch of [0, 1]) {
            const painted = (env[i + ch] ?? 0) >= 128;
            if (painted) cells[ch] = (cells[ch] ?? 0) + 1;
            if (painted !== (shape[i + ch] ?? 0) >= 128)
              wrong.push(`${ch ? 'food' : 'wall'} at ${x},${y}: env ${env[i + ch]}, outline ${shape[i + ch]}`);
          }
          if (shape[i + 2] !== env[i + 2]) wrong.push(`light at ${x},${y}: env ${env[i + 2]}, outline ${shape[i + 2]}`);
        }
      return { wrong, walls: cells[0] ?? 0, food: cells[1] ?? 0 };
    }

    it.each(BOUNDARIES)('agree with the environment at every cell centre (%s)', async (boundary) => {
      const sim = await make({ layout: 'empty', boundary }, W, H, 1);
      for (const stroke of strokes) sim.paint([stroke]);
      const { wrong, walls, food } = await disagreements(sim, boundary);
      expect(wrong).toEqual([]);
      expect(walls).toBeGreaterThan(80);
      expect(food).toBeGreaterThan(80);
    });

    // On WebGPU the brush pass visits a cell twice when its box is wider than the periodic grid.
    it('agree under brushes larger than a small periodic grid', async () => {
      const sim = await make({ layout: 'empty' }, 24, 16, 1);
      sim.paint([{ kind: 'light', from: [5, 5], to: [30, 9], radius: 20 }]);
      sim.paint([{ kind: 'food', from: [3, 3], to: [40, 3], radius: 6.5 }]);
      sim.paint([{ kind: 'wall', from: [-10, 12], to: [50, 12.4], radius: 1.3 }]);
      sim.paint([{ kind: 'erase', from: [12, 8], to: [14, 9], radius: 4.4 }]);
      const { wrong, walls, food } = await disagreements(sim, 'wrap');
      expect(wrong).toEqual([]);
      expect(walls).toBeGreaterThan(20);
      expect(food).toBeGreaterThan(20);
    });

    /**
     * The outline bytes on the CPU: per stroke, the clamped signed distance as a byte, unions by the maximum,
     * a wall over food and the eraser by the minimum with the complement. Every byte is then held to the
     * environment after the stroke: at least 128 where it holds the layer, else at most 127 and at most the byte
     * of k − 1.5 cells outside, with the nearest cell of the layer k cells away (Chebyshev, up to 5 cells; none:
     * 0), after subtractions at every cell of the stroke's outline box (brush.ts outlineBox). The stroke's own byte,
     * of a union and of a subtraction, is held in the same way to the cells the stroke paints itself, at every cell it
     * does not paint: the shaders skip that search where it cannot lower the byte (paint.wgsl `ownHeld`), and this
     * model never does. A cell is painted when its centre lies within the radius; cells outside the arena keep their
     * bytes, and a stroke outside a closed arena changes nothing.
     */
    function outlineModel(list: Stroke[], boundary: string, w: number, h: number) {
      const bytes = new Uint8Array(w * h * 2);
      const painted = new Uint8Array(w * h * 2);
      const own = new Uint8Array(w * h);
      const images = boundary === 'wrap' ? [-1, 0, 1] : [0];
      const toByte = (sd: number) => Math.round((Math.min(1, Math.max(-1, sd / SHAPE_RANGE)) * 0.5 + 0.5) * 255);
      // The nearest cell k rings from x, y (Chebyshev, up to 5 cells) for which `is` holds, as the byte of k − 1.5
      // cells outside; none: 0. The grid, wrapped on the periodic one; the dish does not count (paint.wgsl `holds`).
      const ringHold = (x: number, y: number, is: (i: number) => boolean) => {
        for (let k = 1; k <= 5; k++)
          for (let dy = -k; dy <= k; dy++)
            for (let dx = -k; dx <= k; dx++) {
              if (Math.max(Math.abs(dx), Math.abs(dy)) !== k) continue;
              let [cx, cy] = [x + dx, y + dy];
              if (boundary === 'wrap') [cx, cy] = [((cx % w) + w) % w, ((cy % h) + h) % h];
              else if (cx < 0 || cy < 0 || cx >= w || cy >= h) continue;
              if (is(cy * w + cx)) return toByte(1.5 - k);
            }
        return 0;
      };
      const holds = (x: number, y: number, layer: number) => painted[(y * w + x) * 2 + layer] === 1;
      const held = (b: number, x: number, y: number, layer: number) => {
        if (holds(x, y, layer)) return Math.max(b, 128);
        const v = Math.min(b, 127);
        return v === 0
          ? 0
          : Math.min(
              v,
              ringHold(x, y, (i) => painted[i * 2 + layer] === 1),
            );
      };
      const united = (old: number, s: number, x: number, y: number, layer: number) => {
        if (holds(x, y, layer)) return Math.max(old, s, 128);
        const u = Math.min(s, 127);
        return u <= old
          ? old
          : Math.max(
              old,
              Math.min(
                u,
                ringHold(x, y, (i) => own[i] === 1),
              ),
            );
      };
      for (const stroke of list) {
        const { kind, from, to, radius } = stroke;
        // A stroke outside a closed arena paints no cell and gets no outline (sim.ts and gl/sim.ts paint()).
        if (!paintBox(stroke, w, h, boundary === 'wrap')) continue;
        // The cells the outline pass visits (brush.ts outlineBox), wrapped on the periodic grid.
        const [bx, by, bw, bh] = outlineBox(stroke, w, h, boundary === 'wrap') ?? [0, 0, 0, 0];
        const inBox = (x: number, y: number) =>
          boundary === 'wrap'
            ? (((x - bx) % w) + w) % w < bw && (((y - by) % h) + h) % h < bh
            : x >= bx && x < bx + bw && y >= by && y < by + bh;
        const distances = new Float64Array(w * h);
        own.fill(0);
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++) {
            let d = Infinity;
            for (const ox of images)
              for (const oy of images) d = Math.min(d, segmentDistance([x + 0.5 + ox * w, y + 0.5 + oy * h], from, to));
            distances[y * w + x] = d;
            const i = (y * w + x) * 2;
            if (inArena(boundary, w, h, x, y) && d <= radius && kind !== 'light') {
              painted[i] = kind === 'wall' ? 1 : kind === 'erase' ? 0 : (painted[i] ?? 0);
              painted[i + 1] = kind === 'food' ? 1 : 0;
              own[y * w + x] = 1;
            }
          }
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++) {
            if (!inArena(boundary, w, h, x, y)) continue;
            const d = distances[y * w + x] ?? Infinity;
            const s = toByte(radius - d);
            // Unions round the distance off near the middle line of the stroke (paint.wgsl `rounded`).
            const rounded = (slope: number) => {
              const rho = Math.min(radius, Math.max(2 * slope - radius, 0));
              return toByte(radius - (d >= rho ? d : (d * d + rho * rho) / (2 * rho)));
            };
            const i = (y * w + x) * 2;
            const reach = inBox(x, y);
            let [wall, food] = [bytes[i] ?? 0, bytes[i + 1] ?? 0];
            // A subtraction's byte, held to the cells the stroke paints where it does not paint this one.
            const t =
              own[y * w + x] === 1
                ? s
                : Math.min(
                    s,
                    ringHold(x, y, (c) => own[c] === 1),
                  );
            if (kind === 'erase' && reach)
              [wall, food] = [held(Math.min(wall, 255 - t), x, y, 0), held(Math.min(food, 255 - t), x, y, 1)];
            if (kind === 'wall') {
              wall = united(wall, rounded(1.5), x, y, 0);
              if (reach) food = held(Math.min(food, 255 - t), x, y, 1);
            }
            if (kind === 'food') food = united(food, rounded(2), x, y, 1);
            [bytes[i], bytes[i + 1]] = [wall, food];
          }
      }
      return bytes;
    }

    it.each(BOUNDARIES)('hold the distances of all strokes, as unions and subtractions (%s)', async (boundary) => {
      const sim = await make({ layout: 'empty', boundary }, W, H, 1);
      for (const stroke of strokes) sim.paint([stroke]);
      const shape = await sim.readShape();
      const model = outlineModel(strokes, boundary, W, H);
      let worst = 0;
      for (let i = 0; i < W * H; i++)
        for (const ch of [0, 1]) worst = Math.max(worst, Math.abs((shape[i * 4 + ch] ?? 0) - (model[i * 2 + ch] ?? 0)));
      expect(worst).toBeLessThanOrEqual(1);
    });

    // Random strokes of every kind, also thin, across the edges and beside the rim: unions and subtractions next to
    // each other, so that holds come from every ring and direction. Strokes with a cell centre within 0.001 cells of
    // the brush edge are left out, where float32 could paint it the other way.
    it.each(BOUNDARIES)('hold the distances of random strokes as the CPU model does (%s)', async (boundary) => {
      const [w, h] = [64, 48];
      let state = 17;
      const rnd = () => (state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32;
      const kinds = ['food', 'wall', 'erase', 'food', 'wall', 'light'] as const;
      const list: Stroke[] = [];
      while (list.length < 160) {
        const [x, y] = [-6 + (w + 12) * rnd(), -6 + (h + 12) * rnd()];
        const a = 2 * Math.PI * rnd();
        const length = 6 * rnd();
        const s: Stroke = {
          kind: kinds[Math.floor(rnd() * kinds.length)] ?? 'food',
          from: [x, y],
          to: [x + length * Math.cos(a), y + length * Math.sin(a)],
          radius: 0.75 + 6 * rnd() ** 2,
        };
        const margin = { min: Infinity };
        paintReference(new Uint8Array(w * h * 4), w, h, s, boundary, margin);
        if (margin.min >= 1e-3) list.push(s);
      }
      const sim = await make({ layout: 'empty', boundary }, w, h, 1);
      sim.paint(list);
      const shape = await sim.readShape();
      const model = outlineModel(list, boundary, w, h);
      const wrong: string[] = [];
      for (let i = 0; i < w * h; i++)
        for (const ch of [0, 1]) {
          const [gpu, cpu] = [shape[i * 4 + ch] ?? 0, model[i * 2 + ch] ?? 0];
          if (Math.abs(gpu - cpu) > 1) wrong.push(`layer ${ch} at ${i % w},${Math.floor(i / w)}: ${gpu}, not ${cpu}`);
        }
      expect(wrong).toEqual([]);
    });

    // Erasers wide enough that whole workgroups of the outline pass lie deep inside them (paint.wgsl `eraserCore`):
    // those write 0 without reading `env`. Food over the whole grid, so that every byte near the erasers' edges is
    // above 0, walls with their shadows, light, and erasers across the edges, in rounds on fresh food.
    it.each(BOUNDARIES)('hold the distances under wide erasers as the CPU model does (%s)', async (boundary) => {
      const [w, h] = [96, 64];
      let state = 29;
      const rnd = () => (state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32;
      const wrong: string[] = [];
      let erasers = 0;
      for (let round = 0; round < 8; round++) {
        const list: Stroke[] = [{ kind: 'food', from: [0.31, 0.37], to: [95.63, 63.71], radius: 60.17 }];
        for (let i = 0; i < 9; i++) {
          const [x, y, a] = [rnd() * w, rnd() * h, 2 * Math.PI * rnd()];
          const kind = i % 3 === 2 ? 'light' : 'wall';
          list.push({ kind, from: [x, y], to: [x + 30 * Math.cos(a), y + 30 * Math.sin(a)], radius: 1 + 4 * rnd() });
        }
        for (let i = 0; i < 2; i++) {
          const [x, y] = [rnd() * w - 10, rnd() * h - 10];
          list.push({ kind: 'erase', from: [x, y], to: [x + 20 * rnd(), y + 20 * rnd()], radius: 18 + 16 * rnd() });
        }
        // Without strokes that pass a cell centre within 0.001 cells of their edge, where float32 could round it.
        const kept = list.filter((s) => {
          const margin = { min: Infinity };
          paintReference(new Uint8Array(w * h * 4), w, h, s, boundary, margin);
          return margin.min >= 1e-3;
        });
        erasers += kept.filter((s) => s.kind === 'erase').length;
        const sim = await make({ layout: 'empty', boundary }, w, h, 1);
        sim.paint(kept);
        const shape = await sim.readShape();
        const model = outlineModel(kept, boundary, w, h);
        for (let i = 0; i < w * h; i++)
          for (const ch of [0, 1]) {
            const [gpu, cpu] = [shape[i * 4 + ch] ?? 0, model[i * 2 + ch] ?? 0];
            if (Math.abs(gpu - cpu) > 1)
              wrong.push(`round ${round}, layer ${ch} at ${i % w},${Math.floor(i / w)}: ${gpu}, not ${cpu}`);
          }
        wrong.push(...(await disagreements(sim, boundary)).wrong.map((s) => `round ${round}: ${s}`));
      }
      expect(wrong).toEqual([]);
      expect(erasers).toBeGreaterThan(12);
    });

    // The nearest cell of a layer 5 cells away along a row, or along a column: an eraser takes the near cells, and
    // the byte between is held to that cell (paint.wgsl searches rows, then columns).
    it.each(BOUNDARIES)(
      'hold a byte to the cell of its layer 5 cells away along a row or a column (%s)',
      async (boundary) => {
        const found: string[] = [];
        for (const kind of ['food', 'wall'] as const)
          for (const [axis, near, far, probe] of [
            ['row', [20.5, 24.5], [32.5, 24.5], [25, 24]],
            ['column', [32.5, 12.5], [32.5, 24.5], [32, 17]],
          ] as const) {
            const sim = await make({ layout: 'empty', boundary }, W, H, 1);
            sim.paint([
              { kind, from: [...near], to: [...near], radius: 2.9 },
              { kind, from: [...far], to: [...far], radius: 2.9 },
              { kind: 'erase', from: [...near], to: [...near], radius: 4 },
            ]);
            const [env, shape] = [await sim.readEnv(), await sim.readShape()];
            const i = (probe[1] * W + probe[0]) * 4 + (kind === 'food' ? 1 : 0);
            // The byte of 3.5 cells outside the outline, as distanceByte(1.5 − 5).
            found.push(`${kind} ${axis}: env ${env[i]}, outline ${shape[i]}`);
          }
        expect(found).toEqual([
          'food row: env 0, outline 16',
          'food column: env 0, outline 16',
          'wall row: env 0, outline 16',
          'wall column: env 0, outline 16',
        ]);
      },
    );

    /** The byte that a cell may hold at most for a layer the environment does not hold there (paint.wgsl `holdByte`). */
    function holdBound(env: Uint8Array, boundary: string, w: number, h: number, x: number, y: number, ch: number) {
      const holds = (cx: number, cy: number) => {
        if (boundary === 'wrap') [cx, cy] = [((cx % w) + w) % w, ((cy % h) + h) % h];
        else if (cx < 0 || cy < 0 || cx >= w || cy >= h) return false;
        return (env[(cy * w + cx) * 4 + ch] ?? 0) >= 128;
      };
      for (let k = 1; k <= 5; k++)
        for (let dy = -k; dy <= k; dy++)
          for (let dx = -k; dx <= k; dx++)
            if (Math.max(Math.abs(dx), Math.abs(dy)) === k && holds(x + dx, y + dy))
              return Math.round((Math.min(1, Math.max(-1, (1.5 - k) / SHAPE_RANGE)) * 0.5 + 0.5) * 255);
      return 0;
    }

    /** Bytes of arena cells without their layer that lie above the hold of `env` (holdBound()). */
    async function overHold(sim: Sim, boundary: string, label: string) {
      const [env, shape] = [await sim.readEnv(), await sim.readShape()];
      const { width: w, height: h } = sim;
      const wrong: string[] = [];
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++)
          for (const ch of [0, 1]) {
            const i = (y * w + x) * 4 + ch;
            if (!inArena(boundary, w, h, x, y) || (env[i] ?? 0) >= 128) continue;
            const bound = holdBound(env, boundary, w, h, x, y, ch);
            if ((shape[i] ?? 0) > bound) wrong.push(`${label}, layer ${ch} at ${x},${y}: ${shape[i]} > ${bound}`);
          }
      return wrong;
    }

    // After erasers every byte that `env` does not hold stays within the hold of the cells of its layer near it: no
    // outline nearer than the cells of `env` allow. An eraser can take the last cells of a layer within 5 rings of a
    // byte that lies more than SHAPE_RANGE from its brush; it holds every byte of its outline box.
    it.each(BOUNDARIES)('hold every byte that erasers leave without its layer (%s)', async (boundary) => {
      const wrong: string[] = [];
      for (let seed = 1; seed <= 6; seed++) {
        let state = seed;
        const rnd = () => (state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32;
        const list: Stroke[] = [];
        for (let i = 0; i < 9; i++) {
          const kind = i % 3 === 2 ? 'wall' : 'food';
          list.push({ kind, from: [rnd() * W, rnd() * H], to: [rnd() * W, rnd() * H], radius: 1.5 + 4 * rnd() });
        }
        for (let i = 0; i < 30; i++) {
          const [x, y] = [rnd() * W, rnd() * H];
          list.push({ kind: 'erase', from: [x, y], to: [x + 3 * rnd(), y + 3 * rnd()], radius: 0.75 + 5 * rnd() });
        }
        // One call, which gives the bytes of one call per stroke (tests below) and is one submission on SwiftShader.
        const sim = await make({ layout: 'empty', boundary }, W, H, 1);
        sim.paint(list);
        wrong.push(...(await overHold(sim, boundary, `seed ${seed}`)));
      }
      expect(wrong).toEqual([]);
    });

    // Beside the edge of a box or the rim of the dish a stroke can pass near cells of the arena and paint none of
    // them: a fast drag that leaves a box at a shallow angle paints cells near where it leaves, and then runs on
    // outside. A union holds its bytes to the cells it paints, so it draws no line along the edge. Strokes along the
    // edges and the rim, some of them painting no cell at all.
    it.each(BOUNDARIES)('hold the bytes of unions beside the edges to the cells they paint (%s)', async (boundary) => {
      const [w, h] = [97, 61];
      let state = 7;
      const rnd = () => (state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32;
      const wrong: string[] = [];
      for (let round = 0; round < 4; round++) {
        const list: Stroke[] = [];
        for (let n = 0; n < 40; n++) {
          // Within 3 cells of an edge or the rim (start x, y and direction), along it at a shallow angle.
          const [t, off, side] = [rnd(), -3 + 6 * rnd(), Math.floor(rnd() * 4)];
          const [a, r] = [2 * Math.PI * t, 0.5 * Math.min(w, h) - 1 + off];
          const sides: [number, number, number, number][] = [
            [t * w, off, 1, 0],
            [t * w, h + off, 1, 0],
            [off, t * h, 0, 1],
            [w + off, t * h, 0, 1],
          ];
          const [x, y, dx, dy]: [number, number, number, number] =
            boundary === 'dish'
              ? [w / 2 + r * Math.cos(a), h / 2 + r * Math.sin(a), -Math.sin(a), Math.cos(a)]
              : (sides[side] ?? [0, 0, 1, 0]);
          const [length, turn] = [5 + 60 * rnd(), (rnd() - 0.5) * 0.3];
          const [ux, uy] = [dx * Math.cos(turn) - dy * Math.sin(turn), dx * Math.sin(turn) + dy * Math.cos(turn)];
          list.push({
            kind: rnd() < 0.5 ? 'food' : 'wall',
            from: [x, y],
            to: [x + length * ux, y + length * uy],
            radius: 0.75 + 3 * rnd() ** 2,
          });
        }
        const sim = await make({ layout: 'empty', boundary }, w, h, 1);
        sim.paint(list);
        wrong.push(...(await overHold(sim, boundary, `round ${round}`)));
      }
      expect(wrong).toEqual([]);
    });

    // A stroke beside a box or the dish that paints no cell changes nothing on screen (ADR 0019): no byte of `env` and
    // no outline byte, also where its outline box reaches food and walls along the edge. A replay can map an edit
    // there on another grid. Food, walls and light along the edges first, then such strokes of every kind.
    it.each(['box', 'dish'] as const)(
      'change no outline byte with a stroke that paints no cell (%s)',
      async (boundary) => {
        const [w, h] = [97, 61];
        const [cx, cy, rim] = [w / 2, h / 2, 0.5 * Math.min(w, h) - 1];
        // A point at angle a, `out` cells outside the box edge or the dish rim (inside where negative).
        const at = (a: number, out: number): [number, number] => {
          if (boundary === 'dish') return [cx + (rim + out) * Math.cos(a), cy + (rim + out) * Math.sin(a)];
          const [dx, dy] = [Math.cos(a), Math.sin(a)];
          const t = Math.min(cx / Math.abs(dx || 1e-9), cy / Math.abs(dy || 1e-9));
          const [ex, ey] = [cx + t * dx, cy + t * dy];
          return Math.abs(ex - cx) >= cx - 1e-9 ? [ex + Math.sign(dx) * out, ey] : [ex, ey + Math.sign(dy) * out];
        };
        let state = 13;
        const rnd = () => (state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32;
        const base: Stroke[] = [];
        for (let k = 0; k < 24; k++) {
          const a = 2 * Math.PI * rnd();
          base.push({
            kind: (['food', 'wall', 'light'] as const)[k % 3] ?? 'food',
            from: at(a, -2),
            to: at(a + 0.1, -2),
            radius: 2 + 2 * rnd(),
          });
        }
        const quiet: Stroke[] = [];
        const kinds = ['food', 'wall', 'erase', 'light'] as const;
        while (quiet.length < 40) {
          const a = 2 * Math.PI * rnd();
          const s: Stroke = {
            kind: kinds[quiet.length % 4] ?? 'food',
            from: at(a, 0.3 + 2 * rnd()),
            to: at(a + 0.05 * rnd(), 0.3 + 2 * rnd()),
            radius: 0.75 + rnd(),
          };
          const margin = { min: Infinity };
          paintReference(new Uint8Array(w * h * 4), w, h, s, boundary, margin);
          // Paints no cell, by a margin, and still has an outline box in the grid.
          if (margin.min < 1e-2 || paintsCell(s, w, h, boundary) || !paintBox(s, w, h, false)) continue;
          quiet.push(s);
        }
        const sim = await make({ layout: 'empty', boundary }, w, h, 1);
        sim.paint(base);
        const [env, shape] = [await sim.readEnv(), await sim.readShape()];
        sim.paint(quiet);
        const [env2, shape2] = [await sim.readEnv(), await sim.readShape()];
        expect(differing(env2, env), 'env').toBe(0);
        expect(differing(shape2, shape), 'outlines').toBe(0);
      },
    );

    // Inside the dish too: a thin stroke just inside the rim paints one cell (53, 30), and cells 2 to 5 rows above it
    // lie nearer the stroke than that cell allows. The search can be skipped only where the brush lies in the dish
    // (paint.wgsl `ownHeld`), not wherever the nearest point of the stroke does.
    it.each(['food', 'wall'] as const)('hold the bytes of a thin %s just inside the rim of the dish', async (kind) => {
      const sim = await make({ layout: 'empty', boundary: 'dish' }, W, H, 1);
      sim.paint([{ kind, from: [54.31, 29.42], to: [54.18, 30.65], radius: 0.75 }]);
      const env = await sim.readEnv();
      const ch = kind === 'food' ? 1 : 0;
      expect(Array.from({ length: W * H }, (_, i) => i).filter((i) => (env[i * 4 + ch] ?? 0) >= 128)).toEqual([
        30 * W + 53,
      ]);
      expect(await overHold(sim, 'dish', kind)).toEqual([]);
    });

    // A stroke changes no byte outside its outline box (brush.ts outlineBox), on WebGL2 as on WebGPU: also a stroke
    // longer than a closed arena, whose box is cut at the grid, and one beside the grid. Food under the periodic
    // boundary at x = −0.3 paints cell 63 and leaves bytes at x = 0 that the box does not hold until the next readback
    // (ADR 0009, item 10); a later food dab at x = 1 lets them stay.
    it('change no byte outside the outline box of a stroke longer than a box or beside it', async () => {
      const lead: Stroke[] = [{ kind: 'food', from: [-0.3, 20], to: [-0.3, 28], radius: 0.75, boundary: 'wrap' }];
      const tail: Stroke[] = [{ kind: 'food', from: [1.5, 24.5], to: [1.5, 24.5], radius: 0.75 }];
      const middle: Stroke[] = [
        { kind: 'erase', from: [30, 24], to: [200, 24], radius: 1 },
        { kind: 'wall', from: [36, 44], to: [-300, 46], radius: 1.2 }, // across the box, far from row 24
        { kind: 'erase', from: [70, 24], to: [400, 24], radius: 1 },
      ];
      const results: Uint8Array[] = [];
      for (const list of [
        [...lead, ...tail],
        [...lead, ...middle, ...tail],
      ]) {
        const sim = await make({ layout: 'empty', boundary: 'box' }, W, H, 1);
        sim.paint(list);
        results.push(await sim.readShape());
      }
      const [without, beside] = results;
      const boxes = middle.map((s): Rect => outlineBox(s, W, H, false) ?? [0, 0, 0, 0]);
      const changed: string[] = [];
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          if (boxes.some(([bx, by, bw, bh]) => x >= bx && x < bx + bw && y >= by && y < by + bh)) continue;
          for (let k = 0; k < 4; k++)
            if (without?.[(y * W + x) * 4 + k] !== beside?.[(y * W + x) * 4 + k]) changed.push(`${x},${y} byte ${k}`);
        }
      expect(changed).toEqual([]);
      // The bytes the test is about: food bytes at x = 0 above 0, held by the dab.
      expect(without?.[24 * W * 4 + 1]).toBeGreaterThan(100);
    });

    // A drag that paints food near the top edge of a box and then runs on just outside it: the food's outline ends
    // with the food, no line runs on along the edge (as far as 5 rings, the hold of the last food cell).
    it('end the outline of a stroke that runs on outside a box with its last painted cell', async () => {
      const [w, h] = [256, 48];
      const sim = await make({ layout: 'empty', boundary: 'box' }, w, h, 1);
      sim.paint([{ kind: 'food', from: [20, 0.3], to: [420, -3.7], radius: 0.75 }]);
      const [env, shape] = [await sim.readEnv(), await sim.readShape()];
      const food = Array.from({ length: w }, (_, x) => env[x * 4 + 1] ?? 0);
      const last = food.lastIndexOf(255);
      expect(last).toBeGreaterThan(60); // the stroke paints row 0 up to here
      expect(Array.from({ length: w - last - 6 }, (_, k) => shape[(last + 6 + k) * 4 + 1]).every((v) => v === 0)).toBe(
        true,
      );
      expect(await overHold(sim, 'box', 'edge')).toEqual([]);
    });

    // The boundary can change while `env` stays (Engine.apply: update, then reset). A dish counts only the cells
    // inside it and the periodic grid has neighbours across its edges, so after the change `shape` is held to
    // `env` again: signs, light, the walls' shadow, and no outline nearer than the cells of `env` allow.
    it.each([
      ['dish', 'box'],
      ['box', 'dish'],
      ['wrap', 'box'],
      ['box', 'wrap'],
      ['wrap', 'dish'],
      ['dish', 'wrap'],
    ] as const)('follow the environment after the boundary changes from %s to %s', async (from, to) => {
      const settings = (boundary: Settings['boundary']): Settings => ({
        ...defaultSettings(),
        layout: 'empty',
        style: 'paper',
        strains: [defaultStrain(0)],
        boundary,
      });
      const sim = await make(settings('box'), W, H, 1);
      // Food and light painted before, under the box: an eraser under the dish crosses the rim over them.
      sim.paint([{ kind: 'food', from: [5, 24], to: [5, 24], radius: 5 }]);
      sim.paint([{ kind: 'light', from: [6, 6], to: [6, 6], radius: 8 }]);
      sim.update(settings(from));
      sim.reset();
      const before = await sim.readShape();
      // Across the dish rim (left at x = 9, top at y = 1), walls at the right and bottom edges (their shadow falls
      // across the edge of the periodic grid), and an eraser across the rim.
      for (const stroke of [
        { kind: 'food', from: [8, 30], to: [8, 30], radius: 5 },
        { kind: 'wall', from: [24, 1.5], to: [40, 1.5], radius: 2 },
        { kind: 'wall', from: [W - 1, 10], to: [W - 1, 20], radius: 1.5 },
        { kind: 'wall', from: [44, H - 1], to: [52, H - 1], radius: 1.5 },
        { kind: 'erase', from: [6, 24], to: [6, 24], radius: 3 },
        { kind: 'food', from: [15, 14], to: [15, 14], radius: 2 },
      ] as Stroke[])
        sim.paint([stroke]);
      // The dish paints no `env` outside itself, so its strokes leave the bytes there as other boundaries left them
      // (the food under the eraser stays whole for the box).
      if (from === 'dish') {
        const after = await sim.readShape();
        let changed = 0;
        for (let i = 0; i < W * H; i++)
          if (
            !inArena('dish', W, H, i % W, Math.floor(i / W)) &&
            after.subarray(i * 4, i * 4 + 4).some((v, k) => v !== before[i * 4 + k])
          )
            changed++;
        expect(changed, 'cells outside the dish that its strokes changed').toBe(0);
      }
      sim.update(settings(to));
      sim.reset();
      const [env, shape] = [await sim.readEnv(), await sim.readShape()];
      const isWall = (i: number) => (env[i * 4] ?? 0) >= 128;
      const wrong: string[] = [];
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          if (!inArena(to, W, H, x, y)) continue;
          const i = (y * W + x) * 4;
          const shadow = shadowByte(isWall, to, W, H, x, y);
          if (Math.abs((shape[i + 3] ?? 0) - shadow) > 1)
            wrong.push(`shadow at ${x},${y}: ${shape[i + 3]}, not ${shadow}`);
          if (shape[i + 2] !== env[i + 2]) wrong.push(`light at ${x},${y}: env ${env[i + 2]}, outline ${shape[i + 2]}`);
          for (const ch of [0, 1]) {
            const [e, s] = [env[i + ch] ?? 0, shape[i + ch] ?? 0];
            if (e >= 128 !== s >= 128) wrong.push(`${ch ? 'food' : 'wall'} at ${x},${y}: env ${e}, outline ${s}`);
            else if (e < 128 && s > holdBound(env, to, W, H, x, y, ch))
              wrong.push(`${ch ? 'food' : 'wall'} at ${x},${y}: outline ${s} nearer than env allows`);
          }
        }
      expect(wrong).toEqual([]);
    });

    /**
     * Random strokes for the batched paint: drags of one kind (runs whose outlines overlap), kinds that change at the
     * same place (food, then a wall or an eraser over it, light under walls), strokes across the edges of the grid and
     * longer than half of it (cut into segments on the periodic grid), dabs and thin brushes.
     */
    function mixedStrokes(seed: number, w: number, h: number, n: number): Stroke[] {
      let state = seed;
      const rnd = () => (state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32;
      const kinds = ['food', 'wall', 'erase', 'light'] as const;
      const out: Stroke[] = [];
      let [x, y] = [rnd() * w, rnd() * h];
      let kind: Stroke['kind'] = 'food';
      while (out.length < n) {
        const roll = rnd();
        if (roll < 0.25) kind = kinds[Math.floor(rnd() * 4)] ?? 'food';
        if (roll > 0.9) [x, y] = [rnd() * w, rnd() * h];
        const radius = 0.75 + 7 * rnd() ** 2;
        const a = rnd() * 2 * Math.PI;
        const length = rnd() < 0.08 ? (0.6 + rnd()) * w : 0.6 * radius * rnd();
        const to: [number, number] = [x + length * Math.cos(a), y + length * Math.sin(a)];
        out.push({ kind, from: [x, y], to, radius });
        // The drag goes on from there, a few cells past the edges at most.
        [x, y] = [
          ((to[0] + 4) % (w + 8)) - 4 + (to[0] < -4 ? w + 8 : 0),
          ((to[1] + 4) % (h + 8)) - 4 + (to[1] < -4 ? h + 8 : 0),
        ];
      }
      return out;
    }

    /** Bytes that differ (a readable failure instead of a diff of thousands of bytes). */
    const differing = (a: Uint8Array, b: Uint8Array) =>
      a.length === b.length ? a.reduce((k, v, i) => k + (v === b[i] ? 0 : 1), 0) : Infinity;

    // Sim.paint with a list must give the bytes of one call per stroke, and of one call per segment (brush.ts
    // paintSegments): WebGPU outlines every segment right after its paint, WebGL2 in runs (gl/sim.ts paint()).
    it.each(BOUNDARIES)('give one call the bytes of one call per stroke and per segment (%s)', async (boundary) => {
      const [w, h] = [64, 48];
      const list = mixedStrokes(11, w, h, 400);
      const segments = list.flatMap((s) => paintSegments(s, w, h, boundary === 'wrap'));
      if (boundary === 'wrap') expect(segments.length).toBeGreaterThan(list.length + 20);
      const ways = ['one call', 'one call per stroke', 'one call per segment'] as const;
      const results: { env: Uint8Array; shape: Uint8Array }[] = [];
      for (const way of ways) {
        const sim = await make({ layout: 'empty', boundary }, w, h, 1);
        if (way === 'one call') sim.paint(list);
        else for (const s of way === 'one call per stroke' ? list : segments) sim.paint([s]);
        results.push({ env: await sim.readEnv(), shape: await sim.readShape() });
        if (way === 'one call') {
          const { wrong, walls, food } = await disagreements(sim, boundary);
          expect(wrong).toEqual([]);
          expect(walls).toBeGreaterThan(50);
          expect(food).toBeGreaterThan(50);
        }
      }
      const [first] = results;
      if (!first) throw new Error('no result');
      results.slice(1).forEach((r, k) => {
        expect(differing(r.env, first.env), `env, ${ways[k + 1]}`).toBe(0);
        expect(differing(r.shape, first.shape), `outlines, ${ways[k + 1]}`).toBe(0);
      });
    });

    // A replay paints every edit under the boundary it was painted under (ADR 0019): the outlines follow `env` under
    // the boundary on screen at the next readback, after one call and after one call per stroke alike.
    it.each(BOUNDARIES)(
      'give one call the bytes of one call per stroke under mixed boundaries (%s)',
      async (boundary) => {
        const [w, h] = [64, 48];
        let state = 5;
        const rnd = () => (state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32;
        const list = mixedStrokes(23, w, h, 300).map((s): Stroke => ({
          ...s,
          boundary: BOUNDARIES[Math.floor(rnd() * 3)] ?? 'box',
        }));
        const results: Uint8Array[][] = [];
        for (const split of [false, true]) {
          const sim = await make({ layout: 'empty', boundary }, w, h, 1);
          if (split) for (const s of list) sim.paint([s]);
          else sim.paint(list);
          results.push([await sim.readEnv(), await sim.readShape()]);
          const { wrong } = await disagreements(sim, boundary, false);
          expect(wrong).toEqual([]);
        }
        const [[env1, shape1] = [], [env2, shape2] = []] = results;
        if (!env1 || !shape1 || !env2 || !shape2) throw new Error('no result');
        expect(differing(env2, env1), 'env').toBe(0);
        expect(differing(shape2, shape1), 'outlines').toBe(0);
      },
    );

    // Sim.writeEnv (tests only) writes bytes, whose outline distances nobody knows: the outlines are then held to
    // them, so their sides, the light and the shadow follow `env`, and the simulation counts as painted.
    it.each(BOUNDARIES)('follow an environment written as bytes (%s)', async (boundary) => {
      const sim = await make({ layout: 'empty', boundary }, W, H, 1);
      sim.paint([{ kind: 'food', from: [30, 20], to: [36, 22], radius: 6 }]);
      const env = new Uint8Array(W * H * 4);
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4;
          if (x >= 8 && x < 40 && y >= 10 && y < 13) env[i] = x % 3 ? 255 : 128; // walls, from 128 on
          // The bytes of the wall threshold test: below 128 no wall, as isWall() in common.wgsl and common.glsl.
          if (x >= 8 && x < 40 && y === 20) env[i] = [1, 64, 127, 129][x % 4] ?? 0;
          if (Math.hypot(x - 50, y - 30) < 6) env[i + 1] = 255;
          if (x === 20 && y >= 30) env[i + 1] = 127; // not food
          env[i + 2] = Math.hypot(x - 15, y - 35) < 5 ? 200 : 0;
        }
      sim.writeEnv(env);
      expect(sim.hasEnvironment).toBe(true);
      const { wrong, walls, food } = await disagreements(sim, boundary);
      expect(wrong).toEqual([]);
      expect(walls).toBeGreaterThan(50);
      expect(food).toBeGreaterThan(50);
      sim.writeEnv(new Uint8Array(W * H * 4));
      expect(sim.hasEnvironment).toBe(false);
      expect((await sim.readShape()).every((v) => v === 0)).toBe(true);
    });

    it('mark the simulation as painted until the environment is cleared, but not after erasing only', async () => {
      const sim = await make({ layout: 'empty' }, W, H, 1);
      const nonzero = async () => (await sim.readShape()).filter((v) => v !== 0).length;
      expect(sim.hasEnvironment).toBe(false);
      sim.paint([{ kind: 'erase', from: [10, 10], to: [20, 10], radius: 5 }]);
      expect(sim.hasEnvironment).toBe(false);
      expect(await nonzero()).toBe(0);
      sim.paint([{ kind: 'light', from: [10, 10], to: [10, 10], radius: 3 }]);
      expect(sim.hasEnvironment).toBe(true);
      expect(await nonzero()).toBeGreaterThan(0);
      sim.clearEnvironment();
      expect(sim.hasEnvironment).toBe(false);
      expect(await nonzero()).toBe(0);
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

    // Every strain draws again in its own region: its band, its sector, its colony (init.wgsl and init.frag start()).
    it.each(['bands', 'sectors', 'colonies'] as const)(
      'keeps every strain of the %s layout in its own region when its agents draw again',
      async (layout) => {
        const [w, h] = [64, 48];
        const m = Math.min(w, h);
        const strains = [1, 0.5, 0.75].map((share, i) => ({ ...defaultStrain(i), share }));
        const sim = await make({ layout, strains, collisions: true, seed: 11 }, w, h, 108);
        sim.paint([{ kind: 'wall', from: [0, 23.5], to: [64, 25.5], radius: 1.5 }]);
        sim.reset();
        const inside = (x: number, y: number, s: number) => {
          const [dx, dy] = [x - w / 2, y - h / 2];
          if (layout === 'bands') return x >= (s / 3) * w - 1e-3 && x <= ((s + 1) / 3) * w + 1e-3;
          if (layout === 'sectors') {
            // How far past the start of its own sector the angle lies, in sectors (3 make a turn).
            const past = ((((Math.atan2(dy, dx) / (2 * Math.PI)) * 3 - s) % 3) + 3) % 3;
            return Math.hypot(dx, dy) <= 0.45 * m + 1e-3 && (past <= 1 + 1e-3 || past >= 3 - 1e-3);
          }
          const c = (s / 3) * 2 * Math.PI - Math.PI / 2;
          return Math.hypot(dx - 0.28 * m * Math.cos(c), dy - 0.28 * m * Math.sin(c)) <= 0.1 * m + 1e-3;
        };
        const agents = await sim.readAgents();
        const strayed = agents.filter((a) => a.bits & 4 && !inside(a.x, a.y, a.bits & 3));
        expect(strayed).toEqual([]);
        expect(await starts(sim, 'wrap')).toEqual({ alive: 108, shared: 0, blocked: 0 });
      },
    );

    // Without the rule an agent may share a cell, but one that drew a wall or a cell outside the dish draws again
    // in its region, up to 32 times (init.wgsl and init.frag, ROUNDS). The wall covers about half the centre spot.
    it.each([
      ['center', 'box'],
      ['mixed', 'dish'],
    ] as const)(
      'starts the %s layout in a %s without the rule on open cells of its region',
      async (layout, boundary) => {
        const [w, h] = [64, 48];
        const sim = await make({ layout, boundary, seed: 13 }, w, h, 300);
        sim.paint([{ kind: 'wall', from: [0, 24], to: [64, 24], radius: 1.5 }]);
        sim.reset();
        const s = await starts(sim, boundary);
        expect([s.alive, s.blocked]).toEqual([300, 0]);
        if (layout === 'center')
          for (const a of await sim.readAgents())
            expect(Math.hypot(a.x - w / 2, a.y - h / 2)).toBeLessThanOrEqual(0.08 * 48 + 1e-3);
      },
    );

    // A move that ends a hair left of x = 0 on the periodic grid: wrapped in float32, its position rounded up to
    // x = W, in cell 0, while WebGPU counted the move and the occupancy in cell W − 1 (wrapPos in common.wgsl and
    // common.glsl). Agent 1 then walked into cell 0 as well.
    it('keeps an agent that crosses the wrap seam inside the grid, in the cell its move counted', async () => {
      const [w, h] = [512, 8];
      const straight = { sensorAngle: 0, sensorOffset: 1, randomTurn: 0 };
      const strains = [
        { ...defaultStrain(0), ...straight, stepSize: 0.500001 },
        { ...defaultStrain(1), ...straight, stepSize: 1 },
      ];
      const sim = await make({ layout: 'empty', strains }, w, h, 2);
      sim.writeAgent(0, { x: 0.5, y: 0.5, heading: Math.PI, bits: 4 });
      sim.writeAgent(1, { x: 2.5, y: 0.5, heading: Math.PI, bits: 4 | 1 });
      // The occupancy is built from the agents written above when the rule is switched on.
      sim.update({ ...defaultSettings(), layout: 'empty', strains, collisions: true });
      const cells = async () => (await sim.readAgents()).map((a) => Math.floor(a.y) * w + Math.floor(a.x));
      sim.run(1);
      const [a] = await sim.readAgents();
      expect(a?.x).toBeLessThan(w);
      const counts = await sim.readCounts();
      const counted = Array.from({ length: w * h }, (_, c) => c).filter((c) => (counts[c * 4] ?? 0) > 0);
      expect(counted).toEqual([w - 1]);
      expect(await cells()).toEqual([w - 1, 1]);
      sim.run(1);
      expect(await cells()).toEqual([w - 1, 0]);
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

  // How food, light and walls look (render.wgsl, gl/glsl/render.frag, ADR 0009). The captures use the
  // fallback exposure of a backend without auto levels: forget() drops them.
  describe('food, light and walls on screen', () => {
    const [W, H] = [64, 48];
    const SIZE = 192;
    const cyan = { ...defaultStrain(0), color: '#3fc1c9' };

    // With food over the trail at 90 % opacity (before), the trail changed the colour on food by a tenth of
    // what it changes on the bare dish. The gel style lets 60 % of the flake show through its trail
    // (GEL_CLEAR), so there the trail changes the colour on food by less: 23 % of the bare change on Metal.
    it.each([
      ['glow', 0.5],
      ['gel', 0.15],
      ['paper', 0.5],
    ] as const)('draw food below the trail, so the trail on food shows (%s)', async (style, share) => {
      backend.forget();
      const settings: Settings = { ...defaultSettings(), style, layout: 'empty', strains: [cyan], bloom: 0 };
      const sim = await make(settings, W, H, 1);
      sim.paint([{ kind: 'food', from: [32, 24], to: [32, 24], radius: 10 }]);
      const view: View = { center: [32, 24], scale: 1 / 4 };
      const capture = async (t: number) => {
        sim.writeTrail(Float32Array.from({ length: W * H * 4 }, (_, i) => (i % 4 === 0 ? t : 0)));
        return backend.capture(sim, settings, view, SIZE, SIZE);
      };
      const [none, some] = [await capture(0), await capture(1.5 / (0.4 / equilibrium(settings)))];
      const onFood = colorDiff(none, some, 96, 96); // the centre of the food
      const bare = colorDiff(none, some, 24, 96); // grid (14, 24)
      expect(bare).toBeGreaterThan(60);
      expect(onFood).toBeGreaterThan(share * bare);
    });

    // The gel style draws its trail as an opaque gel: food under a thick trail vanished (Shortest path, owner
    // decision D2: food B reads as food in every style). The flake now shows through it, grain and outline.
    it('show food below the thick trail of the gel style', async () => {
      backend.forget();
      const settings: Settings = { ...defaultSettings(), style: 'gel', layout: 'empty', strains: [cyan], bloom: 0 };
      const sim = await make(settings, W, H, 1);
      sim.paint([{ kind: 'food', from: [32, 24], to: [32, 24], radius: 6 }]);
      sim.paint([{ kind: 'light', from: [2, 2], to: [2, 2], radius: 1 }]); // keeps the environment pass on
      const thick = 6 / (0.4 / equilibrium(settings)); // far above the level where the gel turns opaque
      sim.writeTrail(Float32Array.from({ length: W * H * 4 }, (_, i) => (i % 4 === 0 ? thick : 0)));
      const view: View = { center: [32, 24], scale: 1 / 8 };
      const food = await backend.capture(sim, settings, view, SIZE, SIZE);
      sim.paint([{ kind: 'erase', from: [32, 24], to: [32, 24], radius: 12 }]);
      const none = await backend.capture(sim, settings, view, SIZE, SIZE);
      // The middle of the food (grid 32, 24), its outline (grid 37.5, 24) and the gel beside it (grid 40, 24).
      expect(colorDiff(food, none, 96, 96)).toBeGreaterThan(60);
      expect(colorDiff(food, none, 140, 96, 0)).toBeGreaterThan(60);
      expect(colorDiff(food, none, 160, 96, 0)).toBeLessThanOrEqual(6);
    });

    it('draw the agents on food in collision mode as trail, and only on food (presence)', async () => {
      if (!backend.supportsCollisions) return; // WebGL2 without float blending has no collision mode
      backend.forget();
      const base: Settings = { ...defaultSettings(), layout: 'empty', strains: [defaultStrain(0)], bloom: 0 };
      const sim = await make(base, W, H, 2);
      sim.paint([{ kind: 'food', from: [32, 24], to: [32, 24], radius: 10 }]);
      sim.writeAgent(0, { x: 32.5, y: 24.5, heading: 0, bits: 4 }); // on food
      sim.writeAgent(1, { x: 8.5, y: 8.5, heading: 0, bits: 4 }); // on the bare dish
      const rule = { ...base, collisions: true };
      sim.update(rule); // switching the rule on builds the occupancy
      const view: View = { center: [32, 24], scale: 1 / 4 };
      for (const style of ['glow', 'gel', 'paper'] as const) {
        const on = await backend.capture(sim, { ...rule, style }, view, SIZE, SIZE);
        const off = await backend.capture(sim, { ...base, style }, view, SIZE, SIZE);
        // One agent alone shows at about half the level (the spline spreads it over 3 × 3 cells); food packed
        // with agents shows at the full level. The dither moves each channel by at most 1 per capture.
        expect(colorDiff(on, off, 98, 98), `${style}: the agent on food`).toBeGreaterThan(30);
        expect(colorDiff(on, off, 2, 34, 0), `${style}: the agent on the bare dish`).toBeLessThanOrEqual(6);
        expect(colorDiff(on, off, 82, 98, 0), `${style}: food without an agent`).toBeLessThanOrEqual(6);
      }
    });

    it('show agents that stayed put in the agents style in collision mode, each agent once', async () => {
      if (!backend.supportsCollisions) return;
      const base: Settings = { ...defaultSettings(), layout: 'empty', boundary: 'box', strains: [defaultStrain(0)] };
      const rule = { ...base, collisions: true };
      const sim = await make(rule, W, H, 2);
      sim.writeAgent(0, { x: 0.5, y: 10.5, heading: Math.PI, bits: 4 }); // faces the box edge: blocked
      sim.writeAgent(1, { x: 30.5, y: 10.5, heading: 0, bits: 4 }); // free: moves to x = 31.5
      sim.run(1);
      expect(total(await sim.readCounts())).toBe(1);
      const view: View = { center: [16, 16], scale: 1 / 4 };
      const on = await backend.capture(sim, { ...rule, style: 'agents' }, view, SIZE, SIZE);
      const off = await backend.capture(sim, { ...base, style: 'agents' }, view, SIZE, SIZE);
      // Grid (0.5, 10.5) is pixel (34, 74), grid (31.5, 10.5) pixel (158, 74).
      expect(luma(on, 34, 74)).toBeGreaterThan(80);
      expect(luma(off, 34, 74)).toBeLessThan(4); // without the rule only agents that moved show
      expect(luma(on, 158, 74)).toBeGreaterThan(80);
      expect(Math.abs(luma(on, 158, 74) - luma(off, 158, 74))).toBeLessThanOrEqual(2);
    });

    // Paper: the food's rim is a dark outline on a light dish. At 16 pixels per cell, the outline must lie on
    // the brush circle, not on the cells (before, it followed their edges: up to 0.7 cells off).
    it('draw the outline of food on the brush circle, between the cells', async () => {
      const settings: Settings = { ...defaultSettings(), style: 'paper', layout: 'empty', strains: [defaultStrain(0)] };
      const sim = await make(settings, W, H, 1);
      const [cx, cy, r] = [32.4, 24.2, 5.3];
      sim.paint([{ kind: 'food', from: [cx, cy], to: [cx, cy], radius: r }]);
      const scale = 1 / 16;
      const img = await backend.capture(sim, settings, { center: [cx, cy], scale }, SIZE, SIZE);
      const dish = luma(img, 2, 2, 0);
      let worst = 0;
      for (let k = 0; k < 24; k++) {
        const [dx, dy] = [Math.cos((k / 24) * 2 * Math.PI), Math.sin((k / 24) * 2 * Math.PI)];
        // Walk in from outside the disc to the first pixel that is clearly darker than the dish.
        let found = NaN;
        for (let t = 95; t > 60; t -= 0.25) {
          const [x, y] = [Math.round(96 + dx * t - 0.5), Math.round(96 + dy * t - 0.5)];
          if (luma(img, x, y, 0) < dish - 25) {
            found = Math.hypot(x + 0.5 - 96, y + 0.5 - 96) * scale;
            break;
          }
        }
        worst = Math.max(worst, Math.abs(found - r));
      }
      expect(worst).toBeLessThan(0.1);
    });

    // Paper: the bevel of a round wall is lit by the direction of its outline. Bilinear interpolation of the
    // distances bends that direction at every cell edge, which showed as seams along the rim; the spline does
    // not. Along a circle in the middle of the bevel, neighbouring samples half a pixel apart must stay
    // within the dither of each other.
    it('light the bevel of a round wall without seams at the cell edges', async () => {
      const settings: Settings = { ...defaultSettings(), style: 'paper', layout: 'empty', strains: [defaultStrain(0)] };
      const sim = await make(settings, W, H, 1);
      const [cx, cy, r] = [32.3, 24.4, 6.2];
      sim.paint([{ kind: 'wall', from: [cx, cy], to: [cx, cy], radius: r }]);
      const scale = 1 / 12;
      const img = await backend.capture(sim, settings, { center: [cx, cy], scale }, SIZE, SIZE);
      // Luma at a canvas position, bilinear between pixel centres.
      const at = (x: number, y: number) => {
        const [x0, y0] = [Math.floor(x - 0.5), Math.floor(y - 0.5)];
        const [fx, fy] = [x - 0.5 - x0, y - 0.5 - y0];
        const l = (i: number, j: number) => luma(img, x0 + i, y0 + j, 0);
        return (l(0, 0) * (1 - fx) + l(1, 0) * fx) * (1 - fy) + (l(0, 1) * (1 - fx) + l(1, 1) * fx) * fy;
      };
      const radius = (r - 0.75) / scale;
      const n = Math.round(2 * Math.PI * radius * 2);
      const ring = Array.from({ length: n }, (_, k) => {
        const a = (k / n) * 2 * Math.PI;
        return at(96 + radius * Math.cos(a), 96 + radius * Math.sin(a));
      });
      const steps = ring.map((v, k) => Math.abs(v - (ring[(k + 1) % n] ?? v)));
      expect(Math.max(...ring) - Math.min(...ring)).toBeGreaterThan(50); // the light changes around the ring
      // Measured on Metal: at most 1.0 with the spline, 6.5 with bilinear weights (2026-11-10).
      expect(Math.max(...steps)).toBeLessThan(3);
    });

    it('repeat the grain of food with the grid, so food across the wrap seam shows no seam', async () => {
      const settings: Settings = { ...defaultSettings(), style: 'paper', layout: 'empty', strains: [defaultStrain(0)] };
      const sim = await make(settings, W, H, 1);
      sim.paint([{ kind: 'food', from: [0, 20], to: [2, 28], radius: 9 }]); // across x = 0
      const capture = (x: number, y: number) =>
        backend.capture(sim, settings, { center: [x, y], scale: 1 / 8 }, SIZE, SIZE);
      const seam = await capture(0, 24);
      expect(maxDiff(seam, await capture(W, 24))).toBeLessThanOrEqual(2);
      expect(maxDiff(seam, await capture(-W, 24 + H))).toBeLessThanOrEqual(2);
      // The grain is there: food pixels on both sides of the seam vary by more than the dither.
      const row = Array.from({ length: 64 }, (_, i) => luma(seam, 64 + i, 96, 0));
      expect(Math.max(...row) - Math.min(...row)).toBeGreaterThan(8);
    });

    it('anti-alias the edge of the box and the rim of the dish', async () => {
      backend.forget();
      for (const boundary of ['box', 'dish'] as const) {
        const settings: Settings = {
          ...defaultSettings(),
          boundary,
          layout: 'empty',
          strains: [defaultStrain(0)],
          bloom: 0,
        };
        const sim = await make(settings, W, H, 1);
        sim.writeTrail(
          Float32Array.from({ length: W * H * 4 }, (_, i) => (i % 4 === 0 ? 2 / (0.4 / equilibrium(settings)) : 0)),
        );
        // The left edge of the box (x = 0) and the left of the dish rim (x = 9) cross pixel 94 at 4 px per cell.
        const x = boundary === 'box' ? 0.3 : 9.3;
        const img = await backend.capture(sim, settings, { center: [x, 24], scale: 1 / 4 }, SIZE, SIZE);
        const [out, edge, inside] = [luma(img, 90, 96, 0), luma(img, 94, 96, 0), luma(img, 100, 96, 0)];
        expect(inside - out, boundary).toBeGreaterThan(100);
        expect(edge, boundary).toBeGreaterThan(out + 0.05 * (inside - out));
        expect(edge, boundary).toBeLessThan(out + 0.95 * (inside - out));
      }
    });

    // An eraser exactly over a stroke leaves the distance to the old outline at almost 0 along it. Without the
    // hold after subtractions, faint food outlines stayed there when zoomed out; with the shadow taken from those
    // distances instead of from env, the drop shadow of an erased wall stayed (up to 29 levels in paper).
    // The bytes held at 1.5 cells outside were covered when zoomed out past 3 cells per pixel (the coverage ramp
    // is a pixel wide): up to 35 levels at 4 cells per pixel and 108 at 8 in gel, and a larger eraser left a crease
    // 2 cells outside. Every zoom the engine allows (up to 8 cells per pixel, engine.ts zoomAt), every style.
    it('leave nothing on screen after erasing what was painted', async () => {
      for (const style of ['paper', 'glow', 'gel'] as const) {
        const settings: Settings = { ...defaultSettings(), style, layout: 'empty', strains: [defaultStrain(0)] };
        const sim = await make(settings, W, H, 1);
        const views = [1 / 2, 1 / 6, 1 / 30, 1.5, 4, 8].map((scale): View => ({ center: [32.2, 24.3], scale }));
        const empty = await Promise.all(views.map((view) => backend.capture(sim, settings, view, SIZE, SIZE)));
        const strokes: [Stroke, number][] = [
          [{ kind: 'food', from: [32.2, 24.3], to: [32.2, 24.3], radius: 4.3 }, 0],
          [{ kind: 'food', from: [31.6, 23.9], to: [31.6, 23.9], radius: 6.7 }, 0],
          [{ kind: 'wall', from: [20, 20], to: [44, 30], radius: 2 }, 0],
          [{ kind: 'food', from: [10, 40], to: [26, 41.5], radius: 3.2 }, 0],
          [{ kind: 'wall', from: [48, 8], to: [56, 12], radius: 2.5 }, 2.5],
          [{ kind: 'food', from: [12, 10], to: [12, 10], radius: 3 }, 3],
        ];
        for (const [stroke, wider] of strokes) {
          sim.paint([stroke]);
          sim.paint([{ ...stroke, kind: 'erase', radius: stroke.radius + wider }]);
        }
        expect(sim.hasEnvironment).toBe(true);
        for (const [k, view] of views.entries()) {
          const img = await backend.capture(sim, settings, view, SIZE, SIZE);
          expect(maxDiff(img, empty[k] ?? img), `${style}, ${1 / view.scale} px per cell`).toBeLessThanOrEqual(2);
        }
      }
    });

    /** The largest difference of one channel between pixels next to each other in a row. */
    function largestStep(img: ImageData) {
      let worst = 0;
      for (let y = 0; y < img.height; y++)
        for (let x = 1; x < img.width; x++)
          for (let k = 0; k < 3; k++) {
            const i = (y * img.width + x) * 4 + k;
            worst = Math.max(worst, Math.abs((img.data[i] ?? 0) - (img.data[i - 4] ?? 0)));
          }
      return worst;
    }

    // The light of a cell reaches into the cells around it through the spline. When only the cell under a pixel
    // decided whether the pass rebuilds anything, a cell next to the light that held none dropped it: the lit area
    // ended in steps along the cell edges, 57 levels in glow at 10 px per cell (Metal). The 3 × 3 cells: 8.
    it.each(['glow', 'gel'] as const)(
      'draw the edge of a small light without steps at the cell edges (%s)',
      async (style) => {
        backend.forget();
        const settings: Settings = {
          ...defaultSettings(),
          style,
          layout: 'empty',
          strains: [defaultStrain(0)],
          bloom: 0,
        };
        const sim = await make(settings, W, H, 1);
        const [cx, cy] = [32.3, 24.2];
        sim.paint([{ kind: 'light', from: [cx, cy], to: [cx, cy], radius: 3.6 }]);
        const img = await backend.capture(sim, settings, { center: [cx, cy], scale: 0.1 }, 140, 140);
        expect(largestStep(img)).toBeLessThanOrEqual(12);
      },
    );

    // The spline weighs the cell under a point 0.5625 at its centre: food or a hole thinner than about half a cell
    // came out on the other side of its outline there, unlike `env`, and so did a ring of single cells that an
    // eraser left along the edge of food. Every cell centre must be drawn as `env` holds it.
    it('draw food and holes thinner than a cell where env holds them', async () => {
      const settings: Settings = { ...defaultSettings(), style: 'paper', layout: 'empty', strains: [defaultStrain(0)] };
      const sim = await make(settings, W, H, 1);
      for (const [i, r] of [0.3, 0.45].entries()) {
        sim.paint([{ kind: 'food', from: [6.5 + 6 * i, 6.5], to: [6.5 + 6 * i, 6.5], radius: r }]);
        sim.paint([{ kind: 'food', from: [8.5 + 6 * i, 18.5], to: [8.5 + 6 * i, 18.5], radius: 4 }]);
        sim.paint([{ kind: 'erase', from: [8.5 + 6 * i, 18.5], to: [8.5 + 6 * i, 18.5], radius: r }]);
      }
      // Food of radius 10 less an eraser of radius 9.6: single cells along a ring.
      sim.paint([{ kind: 'food', from: [40.5, 24.5], to: [40.5, 24.5], radius: 10 }]);
      sim.paint([{ kind: 'erase', from: [40.5, 24.5], to: [40.5, 24.5], radius: 9.6 }]);
      const [env, shape] = [await sim.readEnv(), await sim.readShape()];
      // 16 px per cell: the centre of cell (x, y) is pixel (16x + 8, 16y + 8), a 32nd of a cell from it.
      const img = await backend.capture(sim, settings, { center: [W / 2, H / 2], scale: 1 / 16 }, W * 16, H * 16);
      const wrong: string[] = [];
      let [food, near] = [0, 0];
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4;
          const byte = shape[i + 1] ?? 0;
          if (byte > 125 && byte < 130) continue; // the outline passes within a 32nd of a cell of the centre
          const p = ((y * 16 + 8) * W * 16 + x * 16 + 8) * 4;
          const drawn = (img.data[p] ?? 0) - (img.data[p + 2] ?? 0) > 30; // the flake is yellow, the dish grey
          const held = (env[i + 1] ?? 0) >= 128;
          if (held) food++;
          if (!held && byte > 0) near++;
          if (drawn !== held) wrong.push(`${x},${y}: env ${env[i + 1]}, byte ${byte}, drawn ${drawn}`);
        }
      expect(wrong).toEqual([]);
      expect(food).toBeGreaterThan(90);
      expect(near).toBeGreaterThan(90);
    });

    // An outline that touches the edge of a closed arena must stay whole up to it: the renderer reads the cells
    // inside instead of wrapping (box), or instead of the cells outside the dish, which a dish leaves alone. Food
    // (yellow against the grey dish) along a line a quarter cell inside the edge starts where it starts 3 cells in.
    it.each(['box', 'dish'] as const)('draw outlines whole up to the edge of the arena (%s)', async (boundary) => {
      const settings: Settings = {
        ...defaultSettings(),
        style: 'paper',
        boundary,
        layout: 'empty',
        strains: [defaultStrain(0)],
      };
      const sim = await make(settings, W, H, 1);
      // Box: down from the top edge (y = 0). Dish: from the middle out through the left of the rim (x = 9).
      const box = boundary === 'box';
      sim.paint([{ kind: 'food', from: box ? [32, -2] : [32, 24], to: box ? [32, 30] : [2, 24], radius: 2.56 }]);
      const centre: [number, number] = box ? [32, 2] : [11, 24];
      const img = await backend.capture(sim, settings, { center: centre, scale: 1 / 8 }, 96, 96);
      // The first pixel of food on the line `at` cells inside the edge, counted across the stroke.
      const outlineAt = (at: number) => {
        const k = Math.floor(((box ? 0 : 9) + at - centre[box ? 1 : 0]) * 8 + 48);
        for (let s = 0; s < 96; s++) {
          const i = ((box ? k : s) * 96 + (box ? s : k)) * 4;
          if ((img.data[i] ?? 0) - (img.data[i + 2] ?? 0) > 30) return s;
        }
        return NaN;
      };
      expect(Math.abs(outlineAt(0.25) - outlineAt(3))).toBeLessThanOrEqual(1);
    });

    // Walls hold no trail (diffuse.wgsl), and their cells step along a slanted wall. Where the wall's smooth outline
    // no longer covered a step, the trail fell to nothing towards it: a saw tooth with the period of the cells,
    // lit as dark teeth in the gel style (up to 78 levels, Metal), and in glow and paper up to 82 levels within half
    // a cell of the wall. A wall's cells now take the trail around them. On the side away from the drop shadow.
    it.each(['gel', 'glow', 'paper'] as const)(
      'draw the trail along a slanted wall without a saw tooth (%s)',
      async (style) => {
        const settings: Settings = {
          ...defaultSettings(),
          style,
          layout: 'empty',
          strains: [defaultStrain(0)],
          bloom: 0,
        };
        const sim = await make(settings, W, H, 1);
        const [a, b]: [[number, number], [number, number]] = [
          [8, 10],
          [56, 40],
        ];
        sim.paint([{ kind: 'wall', from: a, to: b, radius: 2 }]);
        // Thick trail everywhere but in the wall's cells, as diffusion leaves it.
        const env = await sim.readEnv();
        const thick = 4 / (0.4 / equilibrium(settings));
        sim.writeTrail(
          Float32Array.from({ length: W * H * 4 }, (_, i) => (i % 4 === 0 && (env[i] ?? 0) < 128 ? thick : 0)),
        );
        backend.forget();
        const scale = 1 / 8;
        const centre: [number, number] = [32, 25];
        const img = await backend.capture(sim, settings, { center: centre, scale }, SIZE, SIZE);
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const [dx, dy] = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
        // Over 12 cells along the wall, a quarter and a half cell outside its outline, above it.
        for (const off of [2.25, 2.5]) {
          const line: number[] = [];
          for (let t = -6; t <= 6; t += 0.05) {
            const [gx, gy] = [centre[0] + dx * t + dy * off, centre[1] + dy * t - dx * off];
            line.push(
              luma(
                img,
                Math.floor((gx - centre[0]) / scale + SIZE / 2),
                Math.floor((gy - centre[1]) / scale + SIZE / 2),
                0,
              ),
            );
          }
          expect(Math.max(...line) - Math.min(...line), `${off - 2} cells outside`).toBeLessThan(16);
        }
      },
    );

    // A thin wall's distance has a crease along its middle line, and the spline smooths a crease differently at
    // every position against the grid: the lit ridge of a thin wall showed beads with the period of the cells,
    // 9 to 14 levels along it (Metal). The outline pass rounds the distance off near that line.
    it.each(['paper', 'gel'] as const)('light the ridge of a thin wall without beads (%s)', async (style) => {
      const settings: Settings = { ...defaultSettings(), style, layout: 'empty', strains: [defaultStrain(0)] };
      const sim = await make(settings, W, H, 1);
      sim.paint([{ kind: 'wall', from: [8.2, 0.3], to: [56.2, 48.3], radius: 1 }]);
      const scale = 1 / 15;
      const centre: [number, number] = [32.2, 24.3];
      const img = await backend.capture(sim, settings, { center: centre, scale }, SIZE, SIZE);
      const ridge = Array.from({ length: 200 }, (_, k) => {
        const t = -4 + (8 * k) / 200;
        const [gx, gy] = [centre[0] + t * Math.SQRT1_2, centre[1] + t * Math.SQRT1_2];
        return luma(
          img,
          Math.floor((gx - centre[0]) / scale + SIZE / 2),
          Math.floor((gy - centre[1]) / scale + SIZE / 2),
          0,
        );
      });
      expect(Math.max(...ridge) - Math.min(...ridge)).toBeLessThanOrEqual(5);
    });

    // Without anything painted the renderer must take the pass without food, light and walls (render.ts,
    // gl/backend.ts), which never reads `shape`: with garbage in `shape` it draws as before. Once something is
    // painted, the other pass reads the garbage. Every style, collisions on (presence, gel heights).
    it('draw without the environment until something is painted', async () => {
      const collisions = backend.supportsCollisions;
      const settings: Settings = {
        ...defaultSettings(),
        layout: 'empty',
        collisions,
        density: 0.5,
        strains: [defaultStrain(0)],
      };
      const sim = await make(settings, W, H, (W * H) / 2);
      sim.run(5);
      const view: View = { center: [W / 2, H / 2], scale: 1 / 2 };
      const captures = () =>
        Promise.all(STYLES.map((style) => backend.capture(sim, { ...settings, style }, view, SIZE, SIZE)));
      const clean = await captures();
      // Every cell deep inside food.
      const garbage = Uint8Array.from({ length: W * H * 4 }, (_, i) => (i % 4 === 1 ? 255 : 0));
      if (kind === 'webgpu') {
        const s = sim as Simulation;
        s.device.queue.writeBuffer(s.shape, 0, garbage);
      } else {
        const gl = canvas.getContext('webgl2');
        if (!gl) throw new Error('The WebGL2 backend has no context.');
        gl.bindTexture(gl.TEXTURE_2D, (sim as GlSim).shapeTexture);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, garbage);
      }
      const ignored = await captures();
      for (const [i, img] of ignored.entries()) expect(maxDiff(img, clean[i] ?? img), STYLES[i]).toBeLessThanOrEqual(2);
      sim.paint([{ kind: 'light', from: [1, 1], to: [1, 1], radius: 0.8 }]);
      const read = await captures();
      for (const [i, img] of read.entries()) expect(maxDiff(img, clean[i] ?? img), STYLES[i]).toBeGreaterThan(40);
    });

    // Painted and erased again, the environment pass runs (hasEnvironment) but must draw what the pass without
    // it draws: at most the dither apart. Both bilinear paths (fit and zoomed out), every style, collisions on and
    // off. Erasing everything leaves no byte: with no cell of a layer within 5 cells, its bytes go to 0.
    it.each(BOUNDARIES)('draw an erased environment like none at all (%s)', async (boundary) => {
      for (const collisions of backend.supportsCollisions ? [false, true] : [false]) {
        const settings: Settings = {
          ...defaultSettings(),
          boundary,
          collisions,
          density: 0.5,
          strains: [defaultStrain(0), defaultStrain(1)],
        };
        const sim = await make(settings, W, H, (W * H) / 2);
        sim.run(20);
        const views: View[] = [
          { center: [W / 2, H / 2], scale: 1 / 2 },
          { center: [W / 2, H / 2], scale: 1.5 },
        ];
        const captures = async () => {
          const out: ImageData[] = [];
          for (const style of STYLES)
            for (const view of views) out.push(await backend.capture(sim, { ...settings, style }, view, SIZE, SIZE));
          return out;
        };
        const before = await captures();
        sim.paint([{ kind: 'food', from: [20, 20], to: [20, 20], radius: 3 }]);
        sim.paint([{ kind: 'wall', from: [40, 30], to: [46, 33], radius: 1.5 }]);
        sim.paint([{ kind: 'light', from: [50, 12], to: [50, 12], radius: 4 }]);
        sim.paint([{ kind: 'erase', from: [20, 20], to: [20, 20], radius: 9 }]);
        sim.paint([{ kind: 'erase', from: [43, 31.5], to: [43, 31.5], radius: 8 }]);
        sim.paint([{ kind: 'erase', from: [50, 12], to: [50, 12], radius: 8 }]);
        expect(sim.hasEnvironment).toBe(true);
        expect((await sim.readShape()).every((v) => v === 0)).toBe(true);
        const after = await captures();
        expect(after).toHaveLength(before.length);
        const diffs = after.map((img, i) => maxDiff(img, before[i] ?? img));
        expect(Math.max(...diffs), `collisions ${collisions}: ${diffs.join(' ')}`).toBeLessThanOrEqual(2);
      }
    });
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
      const ref = styleReference({ trail }, [w, h], settings, view, { exposure, black: levels.black }, [SIZE, SIZE]);
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

  // Without food, light or walls the renderer takes the pass without them (`ENV` off), which must draw the pixels
  // of ef7f2af: the reference above computes them on the CPU. The dither moves a channel by at most 1, rounding by
  // 1 more, the gel's hardware filtering of its height field by at most 2. Fit (one bilinear lookup) and zoomed
  // out (four taps), every style, across the wrap seam, the box edge and the dish rim.
  describe('styles without food, light or walls', () => {
    const SIZE = 128;
    it.each(BOUNDARIES)(
      'match the colours of the pass before food and walls looked like them (%s)',
      async (boundary) => {
        const [w, h] = [64, 48];
        const base: Settings = {
          ...defaultSettings(),
          boundary,
          layout: 'empty',
          strains: [defaultStrain(0), defaultStrain(1)],
          exposure: 1,
          bloom: 0,
          density: 0.5,
        };
        const sim = await make(base, w, h, (w * h) / 2);
        sim.run(3); // agents that moved, for the agents style
        const counts = await sim.readCounts();
        const trail = new Float32Array(w * h * 4);
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++) {
            const blob = (bx: number, by: number, r: number) =>
              Math.exp(-((x - bx) ** 2 + (y - by) ** 2) / (2 * r * r));
            trail[(y * w + x) * 4] = 1 + 30 * blob(14, 14, 3) + 12 * blob(3, 22, 2) + 9 * blob(60, 40, 3);
            trail[(y * w + x) * 4 + 1] = 20 * blob(40, 28, 4) + 6 * blob(10, 2, 2);
          }
        sim.writeTrail(trail);
        const levels = await backend.settle(sim);
        expect(sim.hasEnvironment).toBe(false);
        const worst: string[] = [];
        for (const style of STYLES)
          for (const view of [
            { center: [14, 12], scale: 1 / 4 },
            { center: [32, 24], scale: 1.5 },
          ] as View[]) {
            const settings = { ...base, style };
            const agents = style === 'agents';
            const exposure = (agents ? 0.4 / base.density : levels.gain) * 2 ** base.exposure;
            const img = await backend.capture(sim, settings, view, SIZE, SIZE);
            const ref = styleReference(
              { trail, counts },
              [w, h],
              settings,
              view,
              { exposure, black: agents ? 0 : levels.black },
              [SIZE, SIZE],
            );
            let [max, sum] = [0, 0];
            for (let i = 0; i < ref.length; i++) {
              if (i % 4 === 3) continue;
              const d = Math.abs((img.data[i] ?? 0) - (ref[i] ?? 0));
              [max, sum] = [Math.max(max, d), sum + d];
            }
            const mean = sum / ((ref.length / 4) * 3);
            if (max > (style === 'gel' ? 3 : 2) || mean > 0.75)
              worst.push(`${style} at scale ${view.scale}: max ${max}, mean ${mean.toFixed(2)}`);
          }
        expect(worst).toEqual([]);
      },
    );
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
