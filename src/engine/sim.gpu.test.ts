// Runs in Chromium with real GPU APIs (Metal locally, SwiftShader in CI). See ADR 0010.
// Every model test runs against both backends, so WGSL and GLSL cannot drift apart (ADR 0003).
import { afterAll, afterEach, beforeAll, describe, expect, it, onTestFinished, vi } from 'vitest';
import { hexToLinear } from '../model/color';
import {
  BOUNDARIES,
  defaultSettings,
  defaultStrain,
  emissionScale,
  LAYOUTS,
  MODELS,
  STYLES,
  type Boundary,
  type Settings,
} from '../model/params';
import { presetById } from '../model/presets';
import { dishRadius, outlineBox, paintBox, paintsCell, paintSegments, type Rect } from './brush';
import { WebGl2Backend } from './gl/backend';
import agentsFrag from './gl/glsl/agents.frag?raw';
import diffuseFrag from './gl/glsl/diffuse.frag?raw';
import wallsFrag from './gl/glsl/walls.frag?raw';
import { agentsProgram, compile, diffuseProgram, type Programs, type Walled } from './gl/programs';
import { GlSim } from './gl/sim';
import { AgentToolKind, type AgentTool } from './pack';
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
import wallsWgsl from './shaders/walls.wgsl?raw';
import { Simulation } from './sim';
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

/** The largest float32 below x > 0. */
function below(x: number) {
  const bits = new Uint32Array(Float32Array.of(x).buffer);
  bits.set([(bits[0] ?? 1) - 1]);
  return new Float32Array(bits.buffer)[0] ?? x;
}

/** Distance from a point to a segment. */
function segmentDistance([px, py]: [number, number], [ax, ay]: [number, number], [bx, by]: [number, number]) {
  const [abx, aby] = [bx - ax, by - ay];
  const t = Math.min(1, Math.max(0, ((px - ax) * abx + (py - ay) * aby) / Math.max(abx * abx + aby * aby, 1e-6)));
  return Math.hypot(px - ax - t * abx, py - ay - t * aby);
}

/**
 * Walls in the way of many sensors, on a grid of 64 × 48 cells or larger: a column at the wrap seam, a diagonal one
 * cell thick, a short thick dash and a ring.
 */
const WALLS: Stroke[] = [
  { kind: 'wall', from: [0.5, 10], to: [0.5, 40], radius: 0.5 },
  { kind: 'wall', from: [10, 6], to: [40, 30], radius: 0.6 },
  { kind: 'wall', from: [50, 20], to: [52, 20], radius: 1.5 },
  ...Array.from({ length: 12 }, (_, k): Stroke => {
    const [a, b] = [k, k + 1].map((j) => (j / 12) * 2 * Math.PI) as [number, number];
    return {
      kind: 'wall',
      from: [30 + 8 * Math.cos(a), 36 + 8 * Math.sin(a)],
      to: [30 + 8 * Math.cos(b), 36 + 8 * Math.sin(b)],
      radius: 0.75,
    };
  }),
];

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
      walls: common + wallsWgsl,
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
          : ramp(dishRadius(w, h) - Math.hypot(px - w / 2, py - h / 2));
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
  }, 360_000);
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

  /**
   * The first step after a reset moves the agents without sensing (Jones' order, ADR 0027). A test that writes a trail
   * and agents to see them sense in one step runs this step first. With the layout `empty` no agent lives then, and on
   * a trail of zeros without food the step changes nothing but the step count.
   */
  const pastFirstStep = (sim: Sim) => {
    sim.run(1);
  };

  describe('diffusion and decay', () => {
    // 47 and 246 are sides where a float floor(c / side) was not exact on an Apple M3 Pro (WebGL2 on Metal): there
    // GLSL's cellAt took the cell right of the seam from the next row and the row above the top from outside the
    // grid (ADR 0023).
    it.each([
      [32, 16],
      [47, 246],
    ])('apply a periodic 3×3 mean, then × (1 − decay) (Jones 2010, p. 132; %i × %i cells)', async (w, h) => {
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

    // Jones' order (ADR 0027): the step's deposits come after its diffusion, for the sensors of the next step.
    it('balance mass with deposits: Σ trail′ = keep · Σ trail + deposit · Σ counts', async () => {
      const sim = await make({ density: 0.5 }, 64, 64, 2048);
      sim.run(10);
      const before = total(lane(await sim.readTrail()));
      sim.run(1);
      const after = total(lane(await sim.readTrail()));
      const moved = total(lane(await sim.readCounts()));
      expect(moved).toBe(2048);
      const expected = 0.9 * before + 5 * moved;
      expect(Math.abs(after - expected) / expected).toBeLessThan(1e-5);
    });
  });

  // Jones 2010, p. 132–133: every agent moves and deposits, then every agent senses and turns, then the trail map
  // diffuses (ADR 0027). A step here senses for the moves before it, moves, diffuses, and then adds the deposits of its
  // moves: the trail holds the map as the next sensors read it.
  describe("Jones' order of a step (ADR 0027)", () => {
    const RA = 30;
    // SA 10° and SO 9 from (32.5, 32.5), heading +x: sensor cells F (41, 32), FL (41, 30), FR (41, 34).
    const strains = [{ ...defaultStrain(0), sensorAngle: 10, rotationAngle: RA, sensorOffset: 9 }];
    const deg = (a: { heading: number } | undefined) => Math.round(((a?.heading ?? 0) * 180) / Math.PI + 360) % 360;

    it.each([false, true])(
      'adds the deposits of a step after its diffusion, so the trail holds them undiffused (collisions %s)',
      async (collisions) => {
        const [w, h] = [32, 32];
        const settings = { ...defaultSettings(), layout: 'empty' as const, strains, collisions };
        const sim = await make(settings, w, h, 1);
        pastFirstStep(sim);
        sim.writeAgent(0, { x: 10.5, y: 10.5, heading: 0, bits: 4 });
        if (collisions) sim.update({ ...settings, collisions: true });
        sim.run(1);
        const trail = lane(await sim.readTrail());
        // The agent moved into cell (11, 10): the deposit there, and nothing in the cells around it.
        expect(trail[10 * w + 11]).toBe(5);
        expect(total(trail)).toBe(5);
        // The next step diffuses and decays it, then adds the next deposit, in cell (12, 10).
        sim.run(1);
        const next = lane(await sim.readTrail());
        expect(next[10 * w + 12]).toBeCloseTo(5 + (0.9 * 5) / 9, 5);
        expect(next[9 * w + 11]).toBeCloseTo((0.9 * 5) / 9, 5);
        expect(total(next)).toBeCloseTo(0.9 * 5 + 5, 4);
      },
    );

    /**
     * Agent A at (31.5, 32.5) and agent B at `b`, both heading +x on a map without trail: in the first sensing step both
     * read 0 and move one cell, so A reaches (32.5, 32.5) and B deposits in the cell ahead of it. Returns A's turn in
     * the next step, in degrees.
     */
    async function turnAfter(b: [number, number], collisions: boolean) {
      const settings = { ...defaultSettings(), layout: 'empty' as const, strains, collisions };
      const sim = await make(settings, 64, 64, 2);
      pastFirstStep(sim);
      sim.writeAgent(0, { x: 31.5, y: 32.5, heading: 0, bits: 4 });
      sim.writeAgent(1, { x: b[0], y: b[1], heading: 0, bits: 4 });
      if (collisions) sim.update({ ...settings, collisions: true });
      sim.run(1);
      expect(total(lane(await sim.readCounts())), 'both moved').toBe(2);
      sim.run(1);
      return deg((await sim.readAgents())[0]);
    }

    it.each([false, true])(
      'senses the deposits of the last moves before they diffuse (collisions %s)',
      async (collisions) => {
        // B deposits in FL's cell (41, 30): A turns left toward it.
        expect(await turnAfter([40.5, 30.5], collisions)).toBe(360 - RA);
        // B deposits in cell (41, 31), between F and FL. Undiffused, no sensor reads it and A keeps its heading. After
        // a diffusion F and FL would read the same and FR less, and A would turn left.
        expect(await turnAfter([40.5, 31.5], collisions)).toBe(0);
      },
    );

    it.each([false, true])(
      'moves with the start heading in the first step after a reset, and senses from the second (collisions %s)',
      async (collisions) => {
        const [w, h] = [64, 64];
        const settings = { ...defaultSettings(), layout: 'empty' as const, strains, collisions };
        const sim = await make(settings, w, h, 1);
        // Only the right sensor reads trail, here and one cell further on.
        const trail = new Float32Array(w * h * 4);
        for (const x of [41, 42]) trail[(34 * w + x) * 4] = 100;
        sim.writeTrail(trail);
        sim.writeAgent(0, { x: 32.5, y: 32.5, heading: 0, bits: 4 });
        if (collisions) sim.update({ ...settings, collisions: true });
        sim.run(1);
        const [first] = await sim.readAgents();
        expect([first?.x, first?.y, deg(first)]).toEqual([33.5, 32.5, 0]);
        sim.run(1);
        expect(deg((await sim.readAgents())[0])).toBe(RA);
      },
    );
  });

  describe('agent rule (Jones 2010, Fig. 3)', () => {
    const RA = 30;
    // Agent at the centre of a 64² grid, heading +x. SO 9, SA 45°: sensor cells F (41,32), FL (38,26), FR (38,38).
    async function turn(f: number, fl: number, fr: number) {
      const [w, h] = [64, 64];
      const strains = [{ ...defaultStrain(0), sensorAngle: 45, rotationAngle: RA, sensorOffset: 9 }];
      const sim = await make({ layout: 'empty', strains }, w, h, 1);
      pastFirstStep(sim);
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
    // or a later one on the way (the walk in clearPath enters up to WALK = 92 cells).
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

    // In a dish only a wall byte inside the dish is a wall (wallIn in agents.wgsl and agents.frag, as cellAt() for
    // the cell of a move). On a 64 × 64 dish a move of 4.21 cells from (22.5, 3.5) at −18° ends in cell (26, 2) and
    // enters cell (24, 2) on its way, whose centre lies 30.44 cells from the centre of the dish, outside its radius
    // of 30.24 (ADR 0027). A wall byte there does not block the move; one in cell (25, 2), also on the way, does.
    it.each([false, true])('lets a move pass a wall byte outside the dish (collisions %s)', async (collisions) => {
      const strains = [{ ...defaultStrain(0), sensorAngle: 0, sensorOffset: 1, stepSize: 4.21 }];
      const settings = { ...defaultSettings(), layout: 'empty' as const, boundary: 'dish' as const, strains };
      const move = async ([x, y]: [number, number]) => {
        const sim = await make(settings, 64, 64, 1);
        const env = new Uint8Array(64 * 64 * 4);
        env[(y * 64 + x) * 4] = 255;
        sim.writeEnv(env);
        sim.writeAgent(0, { x: 22.5, y: 3.5, heading: (-18 * Math.PI) / 180, bits: 4 });
        // The occupancy is built from the agent written above when the rule is switched on.
        if (collisions) sim.update({ ...settings, collisions: true });
        sim.run(1);
        const [a] = await sim.readAgents();
        return [Math.floor(a?.x ?? -1), Math.floor(a?.y ?? -1)];
      };
      expect(await move([24, 2])).toEqual([26, 2]);
      expect(await move([25, 2])).toEqual([22, 3]);
    });
  });

  // A sensor reads BLOCKED where a wall lies between the agent and the sensor (sense in agents.wgsl and agents.frag,
  // ADR 0020): the segment's cells go through the walk of the moves (clearPath). One agent with SA 45°, RA 30° and
  // trail 10 only in the cell of its front-right sensor turns right by RA toward it. With a wall on the way the sensor
  // reads BLOCKED, the lowest value, and the agent turns left, away from it. A sensor that read the trail behind the
  // wall would turn it right, one that read 0 would keep its heading. The cells on each sensor's way were listed with
  // a float32 copy of the walk, so every wall below lies on the front-right sensor's way only, or on no sensor's way.
  describe('walls block sensors (ADR 0020)', () => {
    const RA = 30;
    interface Probe {
      size: [number, number];
      at: [number, number];
      /** Degrees. */
      heading: number;
      sensorOffset: number;
      /** The cell of the front-right sensor, which gets the trail. */
      trail: [number, number];
      /** In this order: strokes painted, wall cells written with writeEnv, strokes painted. */
      before?: Stroke[];
      walls?: [number, number][];
      strokes?: Stroke[];
      /** The periodic grid if not given. */
      boundary?: Boundary;
      collisions: boolean;
    }

    /** The turn of the agent in one step, in whole degrees: RA to the right, 360 − RA to the left, 0 none. */
    async function turn(o: Probe) {
      const [w, h] = o.size;
      const strains = [{ ...defaultStrain(0), sensorAngle: 45, rotationAngle: RA, sensorOffset: o.sensorOffset }];
      const settings = { ...defaultSettings(), layout: 'empty' as const, boundary: o.boundary ?? 'wrap', strains };
      const sim = await make(settings, w, h, 1);
      pastFirstStep(sim);
      if (o.before) sim.paint(o.before);
      if (o.walls) {
        const env = new Uint8Array(w * h * 4);
        for (const [x, y] of o.walls) env[(y * w + x) * 4] = 255;
        sim.writeEnv(env);
      }
      if (o.strokes) sim.paint(o.strokes);
      const trail = new Float32Array(w * h * 4);
      trail[(o.trail[1] * w + o.trail[0]) * 4] = 10;
      sim.writeTrail(trail);
      const heading = (o.heading * Math.PI) / 180;
      sim.writeAgent(0, { x: o.at[0], y: o.at[1], heading, bits: 4 });
      // The occupancy is built from the agent written above when the rule is switched on.
      if (o.collisions) sim.update({ ...settings, collisions: true });
      sim.run(1);
      const [a] = await sim.readAgents();
      if (!a) throw new Error('no agent');
      // A blocked move would give a random heading: every move here must succeed.
      expect(total(await sim.readCounts()), 'the agent moved').toBe(1);
      return (Math.round((a.heading * 180) / Math.PI - o.heading) + 720) % 360;
    }

    for (const collisions of [false, true]) {
      // From (32.3, 32.6) the front-right sensor's way to cell (38, 38) enters cells (35, 35) and (35, 36).
      it(`do not let a sensor read the trail behind a wall one cell thick (collisions ${collisions})`, async () => {
        const probe: Probe = {
          size: [64, 64],
          at: [32.3, 32.6],
          heading: 0,
          sensorOffset: 9,
          trail: [38, 38],
          collisions,
        };
        const wall: Stroke = { kind: 'wall', from: [35.5, 33.5], to: [35.5, 36.5], radius: 0.5 };
        expect(await turn(probe)).toBe(RA);
        expect(await turn({ ...probe, strokes: [wall] })).toBe(360 - RA);
        // Beside the way, and past the sensor's cell: no wall on the way.
        expect(await turn({ ...probe, walls: [[34, 36]] })).toBe(RA);
        expect(await turn({ ...probe, walls: [[39, 39]] })).toBe(RA);
        // Erased again: the clearance follows (Sim.paint), and the trail is read again.
        expect(await turn({ ...probe, strokes: [wall, { ...wall, kind: 'erase', radius: 1 }] })).toBe(RA);
        // A wall far away gives the agent's tile a clearance above the sensor's way; the wall added next must lower it.
        const far: Stroke = { kind: 'wall', from: [2.5, 2.5], to: [2.5, 2.5], radius: 0.5 };
        expect(await turn({ ...probe, walls: [[2, 2]], strokes: [wall] })).toBe(360 - RA);
        expect(await turn({ ...probe, before: [far], walls: [[35, 35]] })).toBe(360 - RA);
      });

      // From the centre of cell (16, 16) at 45° the way to cell (16 + 4·sx, 16 + 4·sy) runs through grid corners. At the
      // middle one it touches the cells (16 + 2·sx, 16 + sy) and (16 + sx, 16 + 2·sy): float32 rounding decides which a
      // plain walk would enter, so each one alone blocks (CORNER). (16 + 3·sx, 16 + sy) lies beside the way.
      it(`count both cells beside a corner the sensor's way passes, in every direction (collisions ${collisions})`, async () => {
        const results: string[] = [];
        for (const heading of [0, 90, 180, 270]) {
          const r = ((heading + 45) * Math.PI) / 180;
          const [sx, sy] = [Math.sign(Math.round(Math.cos(r) * 2)), Math.sign(Math.round(Math.sin(r) * 2))];
          const probe: Probe = {
            size: [32, 32],
            at: [16.5, 16.5],
            heading,
            sensorOffset: 4 * Math.SQRT2,
            trail: [16 + 4 * sx, 16 + 4 * sy],
            collisions,
          };
          const turns = [];
          for (const wall of [
            undefined,
            [16 + 2 * sx, 16 + sy],
            [16 + sx, 16 + 2 * sy],
            [16 + 3 * sx, 16 + sy],
          ] as const)
            turns.push(await turn(wall ? { ...probe, walls: [[wall[0], wall[1]]] } : probe));
          results.push(`${heading}°: ${turns.join(' ')}`);
        }
        const [right, left] = [RA, 360 - RA];
        expect(results).toEqual([0, 90, 180, 270].map((hd) => `${hd}°: ${right} ${left} ${left} ${right}`));
      });

      // A corner on the wrap seam of a 32 × 32 periodic grid: from (30.5, 30.5) at 45° the way to the sensor's cell
      // (34, 34), wrapped (2, 2), passes the grid corner (32, 32), which is (0, 0). The two cells beside it, (0, 31) and
      // (31, 0), and the cell past it, (0, 0), each block alone; (2, 0) lies beside the way. From (1.5, 1.5) at 225° the
      // way to (29, 29) passes the same corner in the other direction: beside it (31, 0) and (0, 31), past it (31, 31),
      // and (29, 31) beside the way. The walk wraps these cells step by step (stepAxis in agents.wgsl).
      it(`count the cells at a corner on the wrap seam, in both directions (collisions ${collisions})`, async () => {
        const results: string[] = [];
        for (const { at, heading, trail, walls } of [
          {
            at: [30.5, 30.5],
            heading: 0,
            trail: [2, 2],
            walls: [
              [0, 31],
              [31, 0],
              [0, 0],
              [2, 0],
            ],
          },
          {
            at: [1.5, 1.5],
            heading: 180,
            trail: [29, 29],
            walls: [
              [31, 0],
              [0, 31],
              [31, 31],
              [29, 31],
            ],
          },
        ] as const) {
          const probe: Probe = {
            size: [32, 32],
            at: [at[0], at[1]],
            heading,
            sensorOffset: 4 * Math.SQRT2,
            trail: [trail[0], trail[1]],
            collisions,
          };
          const turns = [await turn(probe)];
          for (const [x, y] of walls) turns.push(await turn({ ...probe, walls: [[x, y]] }));
          results.push(`${heading}°: ${turns.join(' ')}`);
        }
        const [right, left] = [RA, 360 - RA];
        expect(results).toEqual([0, 180].map((hd) => `${hd}°: ${right} ${left} ${left} ${left} ${right}`));
      });

      // In a dish only a wall byte inside the dish is a wall (wallIn). On a 64 × 64 dish, from (22.5, 60.5) at −27°,
      // the front-right sensor's way to cell (26, 61) enters cell (24, 61), whose centre lies 30.44 cells from the
      // centre of the dish, outside its radius of 30.24 (ADR 0027). A wall byte there does not block the sensor; one in
      // cell (25, 61), also on the way, does.
      it(`count no wall byte outside the dish on a sensor's way (collisions ${collisions})`, async () => {
        const probe: Probe = {
          size: [64, 64],
          at: [22.5, 60.5],
          heading: -27,
          sensorOffset: 4.21,
          trail: [26, 61],
          boundary: 'dish',
          collisions,
        };
        expect(await turn(probe)).toBe(RA);
        expect(await turn({ ...probe, walls: [[24, 61]] })).toBe(RA);
        expect(await turn({ ...probe, walls: [[25, 61]] })).toBe(360 - RA);
      });

      // The longest sensor distance, 64 cells, at 45° and off the grid corners: the way enters 89 cells, and the wall
      // is the last one before the sensor's cell (65, 105). A walk of fewer cells than WALK would miss it.
      it(`block a sensor 64 cells away at the last cell before it (collisions ${collisions})`, async () => {
        const probe: Probe = {
          size: [128, 128],
          at: [20.3, 60.6],
          heading: 0,
          sensorOffset: 64,
          trail: [65, 105],
          collisions,
        };
        expect(await turn(probe)).toBe(RA);
        expect(await turn({ ...probe, walls: [[64, 105]] })).toBe(360 - RA);
        expect(await turn({ ...probe, walls: [[20, 61]] })).toBe(360 - RA); // and at the first one
      });

      // On the periodic grid the way crosses the seam: from (W − 3.7, 16.6) to the sensor's cell (2, 22) through cell
      // (1, 21) on the far side, and from (3.7, 16.6), heading 180°, to cell (W − 3, 10) through cell (W − 2, 11).
      // 264 cells make 33 clearance tiles. WebGL2 wrapped the tiles with a float floor(tile / 33), which gave 0 for
      // tile 33 on an Apple M3 Pro: the tiles beside the seam missed the wall and skipped the walk (ADR 0023).
      it.each([64, 264])(
        `block a sensor whose way crosses the wrap seam at a wall on the far side (W %i, collisions ${collisions})`,
        async (w) => {
          for (const [at, heading, trail, wall] of [
            [[w - 3.7, 16.6], 0, [2, 22], [1, 21]],
            [[3.7, 16.6], 180, [w - 3, 10], [w - 2, 11]],
          ] as const) {
            const probe: Probe = {
              size: [w, 32],
              at: [at[0], at[1]],
              heading,
              sensorOffset: 9,
              trail: [trail[0], trail[1]],
              collisions,
            };
            expect(await turn(probe), `${heading}°`).toBe(RA);
            expect(await turn({ ...probe, walls: [[wall[0], wall[1]]] }), `${heading}°`).toBe(360 - RA);
          }
        },
      );
    }

    // Two runs with one seed and walls in the way of many sensors give the same agents and trails; another seed not.
    it.each([false, true])('give identical agents and trails for one seed (collisions %s)', async (collisions) => {
      const run = async (seed: number) => {
        const strains = [9, 30, 64].map((sensorOffset, i) => ({ ...defaultStrain(i), sensorOffset }));
        const sim = await make({ seed, collisions, density: collisions ? 0.5 : 1, strains }, 64, 48, 3072);
        sim.paint(WALLS);
        sim.reset();
        sim.run(30);
        return [await sim.readAgents(), Array.from(await sim.readTrail())];
      };
      expect(await run(42)).toEqual(await run(42));
      expect(await run(43)).not.toEqual(await run(42));
    });

    // Built at the start, the passes for walls made the app reach its engine 2.6 s later on SwiftShader (CI, ADR 0020).
    // The simulation here gets pipelines or programs of its own, also in a repeated run: no other test or run can have
    // built them already.
    let runs = 0;
    it('build the passes for walls at the first wall, and none without walls', async () => {
      const [w, h, n] = [64, 48, 1500];
      const settings = { ...defaultSettings(), seed: 3 };
      let sim: Sim;
      /** The passes for walls built so far: the clearance passes and the agent passes that check for walls. */
      let walled: () => string[];
      let errors = async (during: () => Promise<void>) => during();
      if (kind === 'webgpu') {
        const { device } = (backend as WebGpuBackend).gpu;
        const now = vi.spyOn(device, 'createComputePipeline');
        const later = vi.spyOn(device, 'createComputePipelineAsync');
        onTestFinished(() => {
          now.mockRestore();
          later.mockRestore();
        });
        walled = () =>
          [...now.mock.calls, ...later.mock.calls]
            .map(([d]) => d.compute)
            .filter(
              (c) => c.entryPoint === 'markWalls' || c.entryPoint === 'measureClearance' || c.constants?.SENSE_WALLS,
            )
            .map((c) => `${c.entryPoint ?? ''}${c.constants?.SENSE_WALLS ? ' with the check' : ''}`)
            .sort();
        errors = async (during) => {
          device.pushErrorScope('validation');
          await during();
          expect((await device.popErrorScope())?.message).toBeUndefined();
        };
        device.pushErrorScope('validation');
        sim = await Simulation.create(device, settings, w, h, n, `${agentsWgsl}\n// Run ${++runs} of one test.\n`);
        expect((await device.popErrorScope())?.message).toBeUndefined();
      } else {
        const context = document.createElement('canvas').getContext('webgl2');
        if (!context?.getExtension('EXT_color_buffer_float'))
          throw new Error('WebGL2 with float render targets needed');
        onTestFinished(() => context.getExtension('WEBGL_lose_context')?.loseContext());
        const sources = vi.spyOn(context, 'shaderSource');
        walled = () =>
          sources.mock.calls
            .map(([, source]) => source)
            .filter((s) => s.includes(wallsFrag) || s.includes('#define SENSE_WALLS 1'))
            .map((s) => (s.includes(wallsFrag) ? 'walls.frag' : 'agents.frag with the check'))
            .sort();
        sim = new GlSim(context, compile(context), settings, w, h, n, context.getExtension('EXT_float_blend') !== null);
      }
      live.push(sim);
      const food: Stroke = { kind: 'food', from: [10, 10], to: [30, 12], radius: 3 };
      const wall: Stroke = { kind: 'wall', from: [40, 10], to: [40, 30], radius: 1 };
      const erase = (s: Stroke): Stroke => ({ ...s, kind: 'erase', radius: s.radius + 1 });
      /** An environment with 255 in the given byte of the given cells: 0 a wall, 1 food. */
      const env = (cells: [number, number, number][]) => {
        const data = new Uint8Array(w * h * 4);
        for (const [x, y, byte] of cells) data[(y * w + x) * 4 + byte] = 255;
        return data;
      };

      // Food, light and erasing, written food, and both agent rules: no pass for walls.
      sim.paint([food, { kind: 'light', from: [50, 30], to: [50, 30], radius: 4 }, erase(food)]);
      sim.writeEnv(env([[5, 5, 1]]));
      sim.run(3);
      sim.update({ ...settings, collisions: true });
      sim.run(3);
      sim.clearEnvironment();
      sim.paint([erase(wall)]);
      sim.run(1);
      await sim.finish();
      expect(walled(), 'without walls').toEqual([]);

      await errors(async () => {
        sim.paint([wall]);
        sim.run(2);
        await sim.finish();
      });
      const all =
        kind === 'webgpu'
          ? ['advance with the check', 'claim with the check', 'markWalls', 'measureClearance']
          : ['agents.frag with the check', 'walls.frag'];
      expect(walled(), 'at the first wall').toEqual(all);
      // Built once: more walls, erased walls and written walls build none again.
      sim.paint([erase(wall), wall]);
      sim.writeEnv(env([[20, 20, 0]]));
      sim.clearEnvironment();
      sim.paint([wall]);
      sim.update({ ...settings, collisions: false });
      sim.run(2);
      await sim.finish();
      expect(walled(), 'after more walls').toEqual(all);
    }, 120_000);
  });

  // The passes from the shipped shaders against the same passes from another version of agents.wgsl or agents.frag, on
  // the same device or context. `noSensorCheck`: the shipped source with the wall check cut out of sense(). Where no
  // wall is painted, the passes built without the check (the override SENSE_WALLS, in agents.frag the #define) must
  // give the bytes of that source: a check that is built in but never runs changed the float rounding on an M3 Pro.
  // The version keeps every other change of ADR 0020 (the clearance, the walk with wallIn and stepAxis), so it is not
  // the code before ADR 0020, and a change in the code that both share does not show here. ADR 0020 records the
  // comparison with the code before it. `everyWalk`: without the clearance skip (walls.wgsl), so every walk runs to its
  // end.
  describe('agent passes against other versions of the agent shader', () => {
    const edit = (source: string, from: string, to: string) => {
      if (source.split(from).length !== 2) throw new Error(`Not found once in the agent shader: ${from}`);
      return source.replace(from, to);
    };
    const VERSIONS = {
      noSensorCheck: {
        wgsl: edit(agentsWgsl, '(!habitable(c) || (SENSE_WALLS && !clearPath(pos, p, clear)))', '(!habitable(c))'),
        glsl: edit(
          agentsFrag,
          '  if (!habitable(c) || !clearPath(pos, p, clear)) return BLOCKED;\n#else',
          '  if (!habitable(c)) return BLOCKED;\n#else',
        ),
      },
      everyWalk: {
        wgsl: edit(agentsWgsl, ' || max(span.x, span.y) < clear)', ')'),
        glsl: edit(agentsFrag, ' || max(span.x, span.y) < clear)', ')'),
      },
    };
    type Version = keyof typeof VERSIONS;
    let gl: { gl: WebGL2RenderingContext; floatBlend: boolean; shipped: Programs; versions: Record<Version, Programs> };

    // Every version compiles every pipeline once: on SwiftShader (CI) that takes seconds per version.
    beforeAll(async () => {
      if (kind === 'webgpu') {
        for (const v of Object.values(VERSIONS)) (await variant(v.wgsl, defaultSettings(), 16, 16, 1)).destroy();
        return;
      }
      const context = document.createElement('canvas').getContext('webgl2');
      if (!context?.getExtension('EXT_color_buffer_float')) throw new Error('WebGL2 with float render targets needed');
      const shipped = compile(context);
      const programs = (glsl: string): Programs => {
        let walled: Walled | undefined;
        return {
          ...shipped,
          agents: agentsProgram(context, glsl, false),
          walled: () =>
            (walled ??= {
              agents: agentsProgram(context, glsl, true),
              walls: shipped.walled().walls,
            }),
        };
      };
      gl = {
        gl: context,
        floatBlend: context.getExtension('EXT_float_blend') !== null,
        shipped,
        versions: {
          noSensorCheck: programs(VERSIONS.noSensorCheck.glsl),
          everyWalk: programs(VERSIONS.everyWalk.glsl),
        },
      };
    }, 180_000);

    /** A WebGPU simulation from another agent shader; a validation error fails the test. */
    async function variant(wgsl: string, s: Settings, w: number, h: number, n: number) {
      const { device } = (backend as WebGpuBackend).gpu;
      device.pushErrorScope('validation');
      const sim = await Simulation.create(device, s, w, h, n, wgsl);
      expect((await device.popErrorScope())?.message).toBeUndefined();
      return sim;
    }

    /** A simulation from the shipped shaders and one from `version`, with the same settings and walls. */
    async function pair(version: Version, patch: Partial<Settings>, w: number, h: number, n: number, walls: Stroke[]) {
      const s = { ...defaultSettings(), ...patch };
      const sims: [Sim, Sim] =
        kind === 'webgpu'
          ? [await backend.createSim(s, w, h, n), await variant(VERSIONS[version].wgsl, s, w, h, n)]
          : [
              new GlSim(gl.gl, gl.shipped, s, w, h, n, gl.floatBlend),
              new GlSim(gl.gl, gl.versions[version], s, w, h, n, gl.floatBlend),
            ];
      live.push(...sims);
      // The pipelines for walls are built at the first paint with a wall (Kernels.walled in sim.ts).
      const device = kind === 'webgpu' ? (backend as WebGpuBackend).gpu.device : undefined;
      device?.pushErrorScope('validation');
      for (const sim of sims) {
        sim.paint(walls);
        sim.reset();
      }
      expect((await device?.popErrorScope())?.message).toBeUndefined();
      return sims;
    }

    const state = async (sim: Sim) => ({ agents: await sim.readAgents(), trail: Array.from(await sim.readTrail()) });
    const strains = [0, 1, 2].map((i) => ({
      ...defaultStrain(i),
      sensorAngle: 35,
      rotationAngle: 40,
      sensorOffset: 18,
      stepSize: 1.4,
      decay: 0.6,
      attraction: [0, 1, 2].map((j) => (j === i ? 1 : -0.7)),
    }));

    // Three strains that flee each other, as in the start scene, and Jones' agents with one agent per cell. A wall check
    // that is built into the passes but never runs can change how the compiler rounds the sensor positions. On an M3
    // Pro the three strains then gave other agents by step 4 on both backends; on 96 × 64 cells, and in the other
    // scene, they did not within 64 steps. SwiftShader (CI) gave the same agents in both scenes.
    const SCENES = [
      ['three strains', { seed: 7, density: 3, diffusion: 2, layout: 'sectors', strains }, [160, 144], 8],
      ['one agent per cell', { seed: 7, density: 0.5, collisions: true }, [96, 64], 64],
    ] as const;

    it.each(SCENES)(
      'give the agents and trail of the source without the sensor check while no wall is painted (%s)',
      async (_, patch, [w, h], steps) => {
        const n = Math.round(patch.density * w * h);
        const [shipped, unchecked] = await pair('noSensorCheck', patch, w, h, n, []);
        for (const sim of [shipped, unchecked]) sim.run(steps);
        expect(await state(shipped)).toEqual(await state(unchecked));
        // With walls, sensors see them only in the shipped passes.
        const [walled, blind] = await pair('noSensorCheck', patch, w, h, n, WALLS);
        for (const sim of [walled, blind]) sim.run(steps);
        expect(await state(walled)).not.toEqual(await state(blind));
      },
      // Up to 27.6 s on SwiftShader in CI (#28): 120 s keeps it under a quarter (ADR 0010).
      120_000,
    );

    // Sensors of 9, 30 and 64 cells and walls at every distance from the agents: the clearance skips only walks
    // that cannot meet a wall, on the periodic grid, in a box and in a dish.
    it.each(BOUNDARIES.flatMap((b) => [false, true].map((c) => [b, c] as const)))(
      'skip only walks that cannot meet a wall (%s, collisions %s)',
      async (boundary, collisions) => {
        const [w, h] = [96, 64];
        const far = [9, 30, 64].map((sensorOffset, i) => ({ ...defaultStrain(i), sensorOffset, stepSize: 1 + 3 * i }));
        const patch = { seed: 3, boundary, collisions, density: collisions ? 0.4 : 1, strains: far };
        const [shipped, every] = await pair('everyWalk', patch, w, h, Math.round(patch.density * w * h), WALLS);
        for (const sim of [shipped, every]) sim.run(48);
        expect(await state(shipped)).toEqual(await state(every));
      },
    );
  });

  // The model switch (ADR 0022): the scaled sources of the extended model, covered food and the saturating trail
  // perception, each against a CPU reference, and the passes without them against the sources without them.
  describe('model switch (ADR 0022)', () => {
    /** `source` with the one match of `from` replaced by `to`. */
    const cut = (source: string, from: RegExp, to: string) => {
      if ((source.match(new RegExp(from.source, 'g')) ?? []).length !== 1)
        throw new Error(`Not found once in the shader: ${from.source}`);
      return source.replace(from, to);
    };
    // The shipped sources with the saturation and covered food cut out: the code of sense() and of the sources
    // before ADR 0022. The patterns match whatever the saturating and covering branches hold.
    const PLAIN = {
      agentsWgsl: cut(
        agentsWgsl,
        / {2}var t = textureLoad\(trail, q, 0\);\n {2}if \(SATURATE\) \{[^\n]*\}\n {2}return dot\(t, P\.attraction\[s\]\)/,
        '  return dot(textureLoad(trail, q, 0), P.attraction[s])',
      ),
      diffuseWgsl: cut(
        diffuseWgsl,
        / {6}if \(COVERED\) \{\n[\s\S]*?\n {6}\} else \{\n {8}(s \+= vec2f\(e\.y \* P\.scent\.x, e\.z \* P\.scent\.y\);)\n {6}\}/,
        '      $1',
      ),
      agentsFrag: cut(
        agentsFrag,
        /#if SATURATE\n[\s\S]*?#else\n( {2}return dot\(texelFetch\(trail, q, 0\)[^\n]*)\n#endif/,
        '$1',
      ),
      diffuseFrag: cut(
        diffuseFrag,
        /#if COVERED\n {6}float food[\s\S]*?#else\n( {6}s \+= vec2\(e\.g \* P\.scent\.x, e\.b \* P\.scent\.y\);)\n#endif/,
        '$1',
      ),
    };
    let plainGl: { gl: WebGL2RenderingContext; floatBlend: boolean; shipped: Programs; plain: Programs } | undefined;

    beforeAll(async () => {
      if (kind === 'webgpu') {
        const { device } = (backend as WebGpuBackend).gpu;
        (await Simulation.create(device, defaultSettings(), 16, 16, 1, PLAIN.agentsWgsl, PLAIN.diffuseWgsl)).destroy();
        return;
      }
      const context = document.createElement('canvas').getContext('webgl2');
      if (!context?.getExtension('EXT_color_buffer_float')) throw new Error('WebGL2 with float render targets needed');
      const shipped = compile(context);
      const plain: Programs = {
        ...shipped,
        agents: agentsProgram(context, PLAIN.agentsFrag, false),
        diffuse: diffuseProgram(context, PLAIN.diffuseFrag, false),
      };
      plainGl = { gl: context, floatBlend: context.getExtension('EXT_float_blend') !== null, shipped, plain };
    }, 180_000);

    /** A simulation from the shipped shaders, or with `plain` from the sources without saturation and covered food. */
    async function build(s: Settings, w: number, h: number, n: number, plain = false) {
      let sim: Sim;
      if (kind === 'webgpu') {
        const { device } = (backend as WebGpuBackend).gpu;
        device.pushErrorScope('validation');
        sim = plain
          ? await Simulation.create(device, s, w, h, n, PLAIN.agentsWgsl, PLAIN.diffuseWgsl)
          : await backend.createSim(s, w, h, n);
        expect((await device.popErrorScope())?.message).toBeUndefined();
      } else {
        const g = plainGl;
        if (!g) throw new Error('no WebGL2 context');
        sim = new GlSim(g.gl, plain ? g.plain : g.shipped, s, w, h, n, g.floatBlend);
      }
      live.push(sim);
      return sim;
    }

    const state = async (sim: Sim) => ({
      agents: await sim.readAgents(),
      trail: Array.from(await sim.readTrail()),
      scent: Array.from(await sim.readScent()),
    });
    const FOOD: Stroke[] = [
      { kind: 'food', from: [20, 20], to: [60, 30], radius: 4 },
      { kind: 'light', from: [80, 40], to: [80, 40], radius: 6 },
    ];
    const rivals = [0, 1, 2].map((i) => ({
      ...defaultStrain(i),
      sensorAngle: 35,
      rotationAngle: 40,
      sensorOffset: 18,
      stepSize: 1.4,
      decay: 0.6,
      attraction: [0, 1, 2].map((j) => (j === i ? 1 : -0.7)),
    }));
    // The scenes of the comparison with other versions of the agent shader (above), with food and light.
    const SCENES = [
      ['three strains', { seed: 7, density: 3, diffusion: 2, layout: 'sectors', strains: rivals }, [160, 144], 8],
      ['one agent per cell', { seed: 7, density: 0.5, collisions: true }, [96, 64], 64],
    ] as const;

    // Overrides that are off build the passes from the shipped sources: in both models they must give the bytes of
    // the sources without saturation and covered food. The GPU runs what packParams() packs, the same for both.
    it.each(SCENES)(
      'give the agents, trail and scent of the sources without the switch while it changes nothing (%s)',
      async (_, patch, [w, h], steps) => {
        const n = Math.round(patch.density * w * h);
        const run = async (s: Settings, plain = false) => {
          const sim = await build(s, w, h, n, plain);
          sim.paint(FOOD);
          sim.reset();
          sim.run(steps);
          return state(sim);
        };
        for (const model of MODELS) {
          const s: Settings = { ...defaultSettings(), ...patch, model, trailSaturation: 0 };
          const expected = await run(s, true);
          expect(await run(s), model).toEqual(expected);
          // A K that reached the settings past sanitize(): the Jones model never saturates (pack.ts trailSaturation()).
          if (model === 'jones') expect(await run({ ...s, trailSaturation: 20 }), 'Jones with K').toEqual(expected);
        }
        // K and covered food change them.
        const ext: Settings = { ...defaultSettings(), ...patch, model: 'extended', trailSaturation: 0 };
        const expected = await run(ext, true);
        for (const more of [{ trailSaturation: 20 }, { coveredFood: true }])
          expect(await run({ ...ext, ...more }), JSON.stringify(more)).not.toEqual(expected);
      },
      // Up to 62.8 s on SwiftShader in CI (#28): 300 s keeps it under a quarter (ADR 0010).
      300_000,
    );

    /**
     * One step of one lane of the map on the CPU after the moves, with the boundaries of ADR 0027: the 3 × 3 mean of
     * 9 cells at every site of the arena, a cell outside it counting 0; a wall diffuses where `wallsDiffuse` (the
     * Jones model) and is a sink holding 0 otherwise; then the decay; then `source` at the cells that are no wall.
     */
    const siteStep = (
      map: Float64Array,
      env: Uint8Array,
      w: number,
      cellAt: (x: number, y: number) => number,
      wallsDiffuse: boolean,
      keep: number,
      source: (c: number) => number,
      reflective = false,
    ) => {
      const wall = (c: number) => (env[c * 4] ?? 0) >= 128;
      const site = (c: number) => c >= 0 && (wallsDiffuse || !wall(c));
      return map.map((_, c) => {
        const [x, y] = [c % w, Math.floor(c / w)];
        if (!site(cellAt(x, y))) return 0;
        let [sum, n] = [0, 0];
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const q = cellAt(x + dx, y + dy);
            if (site(q)) [sum, n] = [sum + (map[q] ?? 0), n + 1];
          }
        // `reflective`: the mean over the sites only, the rule before ADR 0027 (for the tests that it is gone).
        return (keep * sum) / (reflective ? n : 9) + (wall(c) ? 0 : source(c));
      });
    };

    const cellAtFor = (boundary: Boundary, w: number, h: number) => (x: number, y: number) => {
      if (boundary === 'wrap') return (((y % h) + h) % h) * w + (((x % w) + w) % w);
      if (x < 0 || y < 0 || x >= w || y >= h) return -1;
      if (boundary === 'dish' && Math.hypot(x + 0.5 - w / 2, y + 0.5 - h / 2) > dishRadius(w, h)) return -1;
      return y * w + x;
    };

    // Jones 2010, p. 144: food goes into the one trail map and diffuses and decays with it. The app keeps food in a
    // scent field of its own (ADR 0007); the Jones model gives it the strain's decay (pack.ts), so trail + scent must
    // be Jones' map. CPU reference of that one map, stepped with the deposits that the GPU's agents made in each step.
    it.each([
      ['attraction, closed box with a wall', 1, 'box', 0.05],
      ['chemorepulsion, periodic grid', -1, 'wrap', 0.1],
      ['attraction, dish', 1, 'dish', 0.2],
    ] as const)(
      'keep trail + scent equal to Jones’ one trail map (%s)',
      async (_, self, boundary, decay) => {
        const [w, h] = [48, 40];
        const strain = { ...defaultStrain(0), decay, food: self, attraction: [self, 0, 0, 0] };
        const settings: Settings = {
          ...defaultSettings(),
          seed: 3,
          model: 'jones',
          collisions: true,
          density: 0.15,
          boundary,
          foodStrength: 0.05,
          // Past constrain(): packParams() must bind the scent to the strain's decay itself.
          scentDecay: 0.1,
          strains: [strain],
        };
        const cells = boundary === 'dish' ? Math.min(w, h) ** 2 : w * h;
        const sim = await build(settings, w, h, Math.round(0.15 * cells));
        sim.paint([
          { kind: 'food', from: [10, 12], to: [30, 14], radius: 3 },
          { kind: 'food', from: [1, 30], to: [1, 30], radius: 2 }, // across the seam of the periodic grid
          { kind: 'wall', from: [24, 20], to: [24, 34], radius: 1 },
        ]);
        sim.reset();
        const env = await sim.readEnv();
        const cellAt = cellAtFor(boundary, w, h);
        const keep = 1 - decay;
        // Jones' order (p. 132–133, ADR 0027): the map diffuses and decays, then takes the deposits of the next moves
        // and the food (p. 144), and the agents sense it. The mean runs at every site of the lattice, the wall too, and
        // the outside of a closed arena holds 0 (ADR 0027).
        let map = new Float64Array(w * h);
        for (let k = 0; k < 40; k++) {
          sim.run(1);
          const counts = await sim.readCounts();
          const source = (c: number) =>
            (counts[c * 4] ?? 0) * strain.deposit + ((env[c * 4 + 1] ?? 0) / 255) * 255 * 0.05;
          map = siteStep(map, env, w, cellAt, true, keep, source);
        }
        const [trail, scent] = [await sim.readTrail(), await sim.readScent()];
        const sum = Float32Array.from({ length: w * h }, (_, c) => (trail[c * 4] ?? 0) + (scent[c * 2] ?? 0));
        expect(maxRelError(sum, map)).toBeLessThan(1e-5);
        // Food and agents both count: the map without the deposits or without the food is far off.
        expect(Math.max(...Array.from(scent))).toBeGreaterThan(1);
        expect(Math.max(...Array.from(trail))).toBeGreaterThan(1);
      },
      // Up to 20.4 s on SwiftShader in CI (#28): 120 s keeps it under a quarter (ADR 0010).
      120_000,
    );

    // ADR 0027: trail and scent that leave a closed arena are lost (Jones 2011, p. 1353), and the mean runs at every
    // site of the lattice (Jones and Adamatzky 2014, p. 23; Jones 2015, p. 14). In the Jones model walls are such sites;
    // in the extended model they are sinks. Food and light follow the trail's rule. A random trail, food along
    // and across the edges and beside the walls, light, and walls across the middle and at the edge; 20 steps without
    // agents against a float64 CPU reference, in both models and every arena.
    it.each(MODELS.flatMap((model) => BOUNDARIES.map((boundary) => [model, boundary] as const)))(
      'diffuse trail, food and light at the edges and walls as the CPU reference does (%s model, %s)',
      async (model, boundary) => {
        const [w, h] = [48, 40];
        const jones = model === 'jones';
        const settings: Settings = {
          ...defaultSettings(),
          layout: 'empty',
          model,
          collisions: jones,
          boundary,
          foodStrength: 0.05,
          lightStrength: 0.2,
          strains: [defaultStrain(0)],
        };
        const sim = await build(settings, w, h, 1);
        sim.paint([
          { kind: 'food', from: [1, 4], to: [1, 36], radius: 2.5 }, // along the left edge
          { kind: 'food', from: [46, 30], to: [50, 33], radius: 3 }, // across the right edge
          { kind: 'food', from: [20, 10], to: [20, 10], radius: 3 }, // beside the wall
          { kind: 'light', from: [30, 1], to: [40, 2], radius: 3 }, // along the top edge
          { kind: 'wall', from: [24, 5], to: [24, 30], radius: 1 },
          { kind: 'wall', from: [10, 39], to: [16, 39], radius: 1.5 }, // at the bottom edge
        ]);
        const env = await sim.readEnv();
        let r = 5;
        const rnd = () => (r = (Math.imul(r, 1103515245) + 12345) >>> 0) / 2 ** 32;
        const trail = Float32Array.from({ length: w * h * 4 }, () => Math.fround(100 * rnd()));
        sim.writeTrail(trail);
        const steps = 20;
        sim.run(steps);
        const [gpuTrail, gpuScent] = [await sim.readTrail(), await sim.readScent()];
        const cellAt = cellAtFor(boundary, w, h);
        const keep = 1 - 0.1;
        const g = jones ? 1 : emissionScale(settings.scentDecay);
        const food = (c: number) => ((env[c * 4 + 1] ?? 0) / 255) * 255 * 0.05 * g;
        const light = (c: number) => (jones ? 0 : ((env[c * 4 + 2] ?? 0) / 255) * 255 * 0.2 * g);
        const run = (lane: Float64Array, source: (c: number) => number, walls: boolean, reflective = false) => {
          let v = lane;
          for (let k = 0; k < steps; k++) v = siteStep(v, env, w, cellAt, walls, keep, source, reflective);
          return v;
        };
        // The lane of the one strain (the others have no decay of a strain and keep nothing).
        const lanes = [0].map((l) => Float64Array.from({ length: w * h }, (_, c) => trail[c * 4 + l] ?? 0));
        const zero = new Float64Array(w * h);
        const none = () => 0;
        const expected = {
          trail: lanes.map((lane) => run(lane, none, jones)),
          food: run(zero, food, jones),
          light: run(zero, light, jones),
        };
        const gpu = (data: Float32Array, stride: number, l: number) =>
          Float32Array.from({ length: w * h }, (_, c) => data[c * stride + l] ?? 0);
        expected.trail.forEach((cpu, l) => {
          expect(maxRelError(gpu(gpuTrail, 4, l), cpu), `trail lane ${l}`).toBeLessThan(1e-5);
        });
        expect(maxRelError(gpu(gpuScent, 2, 0), expected.food), 'food').toBeLessThan(1e-5);
        if (jones) expect(Math.max(...gpu(gpuScent, 2, 1))).toBe(0);
        else expect(maxRelError(gpu(gpuScent, 2, 1), expected.light), 'light').toBeLessThan(1e-5);
        // The rule of the other model at walls, and the reflective mean of before, are far off. On the periodic grid of
        // the Jones model every neighbour is a site, so there the reflective mean is the same.
        expect(maxRelError(gpu(gpuTrail, 4, 0), run(lanes[0] ?? zero, none, !jones))).toBeGreaterThan(1e-3);
        expect(maxRelError(gpu(gpuScent, 2, 0), run(zero, food, !jones))).toBeGreaterThan(1e-3);
        if (!jones || boundary !== 'wrap') {
          expect(maxRelError(gpu(gpuTrail, 4, 0), run(lanes[0] ?? zero, none, jones, true))).toBeGreaterThan(1e-3);
          expect(maxRelError(gpu(gpuScent, 2, 0), run(zero, food, jones, true))).toBeGreaterThan(1e-3);
        }
        // Outside a closed arena and in a wall of the extended model no trail stays; in the Jones model a wall holds it.
        const wallCells = Array.from({ length: w * h }, (_, c) => c).filter((c) => (env[c * 4] ?? 0) >= 128);
        const inWalls = wallCells.reduce((sum, c) => sum + (gpuTrail[c * 4] ?? 0), 0);
        if (jones) expect(inWalls).toBeGreaterThan(0);
        else expect(inWalls).toBe(0);
        if (boundary === 'dish')
          for (let c = 0; c < w * h; c++)
            if (cellAt(c % w, Math.floor(c / w)) < 0) expect(gpuTrail[c * 4] ?? 0, `cell ${c}`).toBe(0);
      },
    );

    // Jones does not say what a sensor reads behind a wall (ADR 0020): only the extended model's sensors check the
    // cells on the way for walls, and the Jones model reads the sensor's cell (ADR 0022). Without walls both agree.
    it('check the sensors for walls on the way in the extended model only', async () => {
      const [w, h] = [64, 48];
      const settings: Settings = {
        ...defaultSettings(),
        seed: 7,
        model: 'jones',
        collisions: true,
        density: 0.3,
        strains: [{ ...defaultStrain(0), sensorOffset: 12 }],
      };
      const run = async (model: Settings['model'], walls: boolean) => {
        const sim = await build({ ...settings, model }, w, h, Math.round(0.3 * w * h));
        if (walls) sim.paint(WALLS);
        sim.reset();
        sim.run(48);
        return state(sim);
      };
      expect(await run('jones', false)).toEqual(await run('extended', false));
      expect(await run('jones', true)).not.toEqual(await run('extended', true));
    });

    // Jones 2010, p. 148: the wound loses its agents, which go elsewhere. The extended model also clears its chemicals.
    it('clear the trail and scent in a cut in the extended model only', async () => {
      const [w, h] = [64, 48];
      const settings: Settings = {
        ...defaultSettings(),
        seed: 4,
        model: 'jones',
        collisions: true,
        density: 0.3,
      };
      const inWound = async (model: Settings['model']) => {
        const sim = await build({ ...settings, model }, w, h, Math.round(0.3 * w * h));
        sim.paint([{ kind: 'food', from: [32, 24], to: [32, 24], radius: 4 }]);
        sim.reset();
        sim.run(30);
        const cut: AgentTool = { kind: AgentToolKind.cut, x: 32, y: 24, radius: 8, strain: 0, revive: 0 };
        sim.run(1, cut);
        const [trail, scent] = [await sim.readTrail(), await sim.readScent()];
        const c = 24 * w + 32;
        return { trail: trail[c * 4] ?? 0, scent: scent[c * 2] ?? 0 };
      };
      const jones = await inWound('jones');
      const ext = await inWound('extended');
      expect(jones.scent).toBeGreaterThan(1);
      expect(jones.trail).toBeGreaterThan(0);
      expect([ext.trail, ext.scent]).toEqual([0, 0]);
    });

    /**
     * One step of the scent on the CPU, on a periodic grid, in Jones' order (ADR 0027): the 3 × 3 means, the decay, then
     * the sources (food × `covered` factor; with `coverLight` the light too, which the shaders must not do). The Jones
     * model has no light, and its scent decays with the strain's decay (pack.ts).
     */
    function scentStep(
      s: Float64Array,
      env: Uint8Array,
      [w, h]: [number, number],
      settings: Settings,
      coveredAt: (c: number) => boolean = () => false,
      coverLight = false,
    ) {
      const jones = settings.model === 'jones';
      const g = jones ? 1 : emissionScale(settings.scentDecay);
      const decay = jones ? (settings.strains[0]?.decay ?? 0) : settings.scentDecay;
      const factor = settings.coveredFood ? settings.coveredFoodFactor : 1;
      let cur = Float64Array.from(s);
      for (let pass = 0; pass < settings.diffusion; pass++) {
        const next = new Float64Array(cur.length);
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++)
            for (let k = 0; k < 2; k++) {
              let sum = 0;
              for (let dy = -1; dy <= 1; dy++)
                for (let dx = -1; dx <= 1; dx++) sum += cur[(((y + dy + h) % h) * w + ((x + dx + w) % w)) * 2 + k] ?? 0;
              next[(y * w + x) * 2 + k] = sum / 9;
            }
        cur = next;
      }
      cur = cur.map((v) => v * (1 - decay));
      for (let c = 0; c < w * h; c++) {
        const food = ((env[c * 4 + 1] ?? 0) / 255) * 255 * settings.foodStrength * g;
        const f = coveredAt(c) && (env[c * 4 + 1] ?? 0) > 0 ? factor : 1;
        cur[c * 2] = (cur[c * 2] ?? 0) + food * f;
        const light = jones ? 0 : ((env[c * 4 + 2] ?? 0) / 255) * 255 * settings.lightStrength * g;
        cur[c * 2 + 1] = (cur[c * 2 + 1] ?? 0) + light * (coverLight ? f : 1);
      }
      return cur;
    }

    const maxRelError = (gpu: Float32Array, cpu: Float64Array) => {
      const scale = Math.max(...Array.from(cpu, Math.abs), 1e-30);
      return Math.max(...Array.from(cpu, (v, i) => Math.abs((gpu[i] ?? 0) - v))) / scale;
    };

    // A food and a light disc on a periodic grid, 30 steps: the GPU scent within 1e-4 of the CPU reference, in both
    // models and at three decays. In the Jones model the decay is the strain's, Scent decay stays at 0.1 and the light
    // releases nothing.
    it.each(MODELS.flatMap((model) => [0.1, 0.01, 0.001].map((d) => [model, d] as const)))(
      'release food and light scent as the CPU reference does (%s model, scent decay %s)',
      async (model, d) => {
        const [w, h] = [48, 32];
        const jones = model === 'jones';
        const settings: Settings = {
          ...defaultSettings(),
          layout: 'empty',
          model,
          scentDecay: jones ? 0.1 : d,
          lightStrength: 0.2,
          strains: [{ ...defaultStrain(0), decay: jones ? d : 0.1 }],
        };
        const sim = await build(settings, w, h, 1);
        sim.paint([
          { kind: 'food', from: [12, 10], to: [12, 10], radius: 3.5 },
          { kind: 'light', from: [34, 20], to: [38, 22], radius: 2.5 },
        ]);
        const env = await sim.readEnv();
        let cpu = new Float64Array(w * h * 2);
        for (let k = 0; k < 30; k++) cpu = scentStep(cpu, env, [w, h], settings);
        sim.run(30);
        const scent = await sim.readScent();
        expect(maxRelError(scent, cpu)).toBeLessThan(1e-4);
        const light = Math.max(...Array.from(scent).filter((_, i) => i % 2 === 1));
        if (jones) expect(light).toBe(0);
        else expect(light).toBeGreaterThan(1);
      },
    );

    // Food on every cell: no gradient, so the scent follows s′ = (1 − d) · s + source exactly (Jones' order, ADR 0027),
    // with or without the blur, which runs here not at all, so that no rounding of the 3 × 3 sums adds up over 1200
    // steps. At decay 0.1 the extended model releases the bytes of the Jones model; at every decay it tends to the
    // plateau of decay 0.1.
    it('keep the plateau of a large food at every scent decay in the extended model', async () => {
      const [w, h] = [16, 16];
      const steps = 1200;
      const env = new Uint8Array(w * h * 4);
      for (let c = 0; c < w * h; c++) env[c * 4 + 1] = 255;
      const run = async (patch: Partial<Settings>) => {
        const sim = await build({ ...defaultSettings(), layout: 'empty', diffusion: 0, ...patch }, w, h, 1);
        sim.writeEnv(env);
        sim.run(steps);
        return sim.readScent();
      };
      expect(await run({ model: 'extended' })).toEqual(await run({ model: 'jones' }));
      const plateau = (255 * 0.05) / 0.1;
      for (const d of [0.1, 0.01, 0.001]) {
        const keep = 1 - d;
        const source = 255 * 0.05 * emissionScale(d);
        expect(source / d / plateau, `plateau at ${d}`).toBeCloseTo(1, 12);
        const expected = (source * (1 - keep ** steps)) / d;
        const scent = await run({ model: 'extended', scentDecay: d });
        for (let c = 0; c < w * h; c++) expect(Math.abs((scent[c * 2] ?? 0) / expected - 1), `${d}`).toBeLessThan(1e-4);
      }
    }, 120_000); // Up to 25.5 s on SwiftShader in CI (#28): 120 s keeps it under a quarter (ADR 0010).

    // Agents near and on food: a food cell releases `coveredFoodFactor` of its scent while the 3 × 3 window around it
    // holds an alive agent after the step's moves (Adamatzky and Jones 2010, ADR 0022). With and without the rule of
    // one agent per cell, with 1 and 2 blur passes. Food lies across both seams of the periodic grid, light lies on
    // food, and shrinkage leaves dead agents: the references with an unwrapped window, with dead agents and with
    // covered light are each far off, so a pass that did any of these would fail.
    it.each([false, true].flatMap((collisions) => [1, 2].map((diffusion) => [collisions, diffusion] as const)))(
      'release the covered-food factor of the scent where an agent covers it (collisions %s, diffusion %s)',
      async (collisions, diffusion) => {
        const [w, h] = [64, 48];
        // Two blur passes with the factor of Jones and Adamatzky 2014 and the extended model at decay 0.003 (g ≠ 1),
        // one with the default of 2010.
        const coveredFoodFactor = diffusion === 2 ? 0.01 : 0.001;
        const settings: Settings = {
          ...defaultSettings(),
          seed: 5,
          density: 0.08,
          collisions,
          diffusion,
          shrink: 0.02,
          lightStrength: 0.2,
          scentDecay: diffusion === 2 ? 0.003 : 0.1,
          coveredFood: true,
          coveredFoodFactor,
          // Agents that ignore light also cover the lit food.
          strains: [{ ...defaultStrain(0), light: 0 }],
        };
        const sim = await build(settings, w, h, Math.round(0.08 * w * h));
        sim.paint([
          { kind: 'food', from: [6, 6], to: [58, 40], radius: 3 },
          { kind: 'food', from: [6, 40], to: [58, 6], radius: 1.5 },
          { kind: 'food', from: [0.5, 4], to: [0.5, 44], radius: 2.5 }, // across the x seam
          { kind: 'food', from: [8, 0.5], to: [56, 0.5], radius: 2 }, // across the y seam
          { kind: 'light', from: [6, 6], to: [58, 40], radius: 2 }, // on the first food stroke
        ]);
        sim.reset();
        sim.run(20);
        const env = await sim.readEnv();
        const before = Float64Array.from(await sim.readScent());
        sim.run(1);
        const after = await sim.readScent();
        const agents = await sim.readAgents();
        const [alive, dead] = [new Uint8Array(w * h), new Uint8Array(w * h)];
        for (const a of agents) ((a.bits & 4) !== 0 ? alive : dead)[Math.floor(a.y) * w + Math.floor(a.x)] = 1;
        const windowOf = (held: (c: number) => boolean, wrap: boolean) => (c: number) => {
          const [x, y] = [c % w, Math.floor(c / w)];
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const [nx, ny] = [x + dx, y + dy];
              if (!wrap && (nx < 0 || ny < 0 || nx >= w || ny >= h)) continue;
              if (held(((ny + h) % h) * w + ((nx + w) % w))) return true;
            }
          return false;
        };
        const coveredAt = windowOf((c) => alive[c] === 1, true);
        const cpu = scentStep(before, env, [w, h], settings, coveredAt);
        expect(maxRelError(after, cpu)).toBeLessThan(1e-4);
        // Some food is covered and some is not: the reference without the rule is far off.
        const foodCells = Array.from({ length: w * h }, (_, c) => c).filter((c) => (env[c * 4 + 1] ?? 0) > 0);
        const covered = foodCells.filter(coveredAt).length;
        expect(covered).toBeGreaterThan(10);
        expect(foodCells.length - covered).toBeGreaterThan(10);
        const far = (other: Float64Array) => {
          expect(maxRelError(after, other)).toBeGreaterThan(1e-3);
        };
        far(scentStep(before, env, [w, h], { ...settings, coveredFood: false }));
        // The window wraps at the seams: some food cells are covered only through a seam.
        const unwrapped = windowOf((c) => alive[c] === 1, false);
        expect(foodCells.filter((c) => coveredAt(c) !== unwrapped(c)).length).toBeGreaterThan(0);
        far(scentStep(before, env, [w, h], settings, unwrapped));
        // Dead agents cover nothing.
        const withDead = windowOf((c) => alive[c] === 1 || dead[c] === 1, true);
        expect(foodCells.filter((c) => coveredAt(c) !== withDead(c)).length).toBeGreaterThan(0);
        far(scentStep(before, env, [w, h], settings, withDead));
        // Light keeps its full source on covered food.
        expect(foodCells.filter((c) => coveredAt(c) && (env[c * 4 + 2] ?? 0) > 0).length).toBeGreaterThan(0);
        far(scentStep(before, env, [w, h], settings, coveredAt, true));
      },
    );

    // WebGL2 without float blending marks the cells with an agent in a target of its own (gl/sim.ts `presence`).
    it.runIf(kind === 'webgl2')(
      'release the covered-food factor of the scent where an agent covers it without float blending',
      async () => {
        const g = plainGl;
        if (!g) throw new Error('no WebGL2 context');
        const [w, h] = [64, 48];
        const settings = { ...defaultSettings(), seed: 5, density: 0.08, diffusion: 1, coveredFood: true };
        const make = (cover: boolean) => {
          const sim = new GlSim(
            g.gl,
            g.shipped,
            { ...settings, coveredFood: cover },
            w,
            h,
            Math.round(0.08 * w * h),
            false,
          );
          live.push(sim);
          sim.paint([{ kind: 'food', from: [6, 6], to: [58, 40], radius: 3 }]);
          sim.reset();
          sim.run(20);
          return sim;
        };
        const sim = make(true);
        const env = await sim.readEnv();
        const before = Float64Array.from(await sim.readScent());
        sim.run(1);
        const held = new Uint8Array(w * h);
        for (const a of await sim.readAgents()) if (a.bits & 4) held[Math.floor(a.y) * w + Math.floor(a.x)] = 1;
        const coveredAt = (c: number) => {
          const [x, y] = [c % w, Math.floor(c / w)];
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) if (held[((y + dy + h) % h) * w + ((x + dx + w) % w)]) return true;
          return false;
        };
        expect(maxRelError(await sim.readScent(), scentStep(before, env, [w, h], settings, coveredAt))).toBeLessThan(
          1e-4,
        );
      },
    );

    // PCG and the random stream of agents.wgsl, for the random turn of an agent whose front sensor is weakest.
    const pcg = (v: number) => {
      const state = (Math.imul(v >>> 0, 747796405) + 2891336453) >>> 0;
      const word = Math.imul(((state >>> ((state >>> 28) + 4)) ^ state) >>> 0, 277803737) >>> 0;
      return ((word >>> 22) ^ word) >>> 0;
    };
    const firstDraw = (id: number, step: number, seed: number) => {
      const s = pcg((id ^ pcg((step ^ pcg((seed ^ 0) >>> 0)) >>> 0)) >>> 0);
      return (pcg(s) >>> 8) / 16777216;
    };

    // Two strains with weights on both trails, on a random trail: every agent's turn in one step against the CPU
    // reference of sense() and steer() with t / (1 + t / K) per lane. Agents whose sensors lie within 1e-3 of a cell
    // edge or whose two strongest sensors differ by less than 1e-4 are left out: float rounding could decide them.
    // With a wall painted, the passes whose sensors check for walls (SENSE_WALLS) saturate too; agents near the wall
    // are left out, so no sensor of the rest meets it.
    it.each([false, true].flatMap((collisions) => [false, true].map((walls) => [collisions, walls] as const)))(
      'saturate the trail per lane as the CPU reference does (collisions %s, walls %s)',
      async (collisions, walls) => {
        const [w, h] = [64, 64];
        const K = 120;
        const RA = 30;
        const strains = [
          { ...defaultStrain(0, 2), sensorAngle: 40, rotationAngle: RA, sensorOffset: 7, attraction: [1, 0.6, 0, 0] },
          { ...defaultStrain(1, 2), sensorAngle: 40, rotationAngle: RA, sensorOffset: 7, attraction: [-0.5, 1, 0, 0] },
        ];
        const n = 400;
        // Collisions are switched on after the agents are written: the switch builds the occupancy from them.
        const settings = {
          ...defaultSettings(),
          seed: 11,
          layout: 'empty' as const,
          density: n / (w * h),
          model: 'extended' as const,
          trailSaturation: K,
          strains,
        };
        const sim = await build(settings, w, h, n);
        pastFirstStep(sim);
        const wall = { x: 30, y: 30, r: 2 };
        if (walls) sim.paint([{ kind: 'wall', from: [wall.x, wall.y], to: [wall.x, wall.y], radius: wall.r }]);
        let r = 99;
        const rnd = () => (r = (Math.imul(r, 1103515245) + 12345) >>> 0) / 2 ** 32;
        const trail = Float32Array.from({ length: w * h * 4 }, (_, i) =>
          i % 4 < 2 ? Math.fround(1 + 2000 * rnd() ** 2) : 0,
        );
        sim.writeTrail(trail);
        const placed = Array.from({ length: n }, (_, i) => ({
          x: Math.floor(rnd() * w) + 0.5,
          y: Math.floor(rnd() * h) + 0.5,
          heading: Math.fround(rnd() * 2 * Math.PI),
          bits: 4 | (i % 2),
        }));
        // At most one agent per cell, so that no claim fails for lack of a free cell.
        const taken = new Set<number>();
        const agents = placed.filter((a) => {
          const c = Math.floor(a.y) * w + Math.floor(a.x);
          return taken.has(c) ? false : (taken.add(c), true);
        });
        agents.forEach((a, i) => {
          sim.writeAgent(i, a);
        });
        if (collisions) sim.update({ ...settings, collisions: true });
        sim.run(1);
        const after = await sim.readAgents();
        const DEG = Math.PI / 180;
        const sat = (t: number) => t / (1 + t / K);
        let checked = 0;
        let changedByK = 0;
        agents.forEach((a, i) => {
          const st = strains[a.bits & 1];
          const b = after[i];
          if (!st || !b) return;
          // In collision mode a blocked agent takes a random heading: only agents that moved show their turn.
          if (collisions && b.x === a.x && b.y === a.y) return;
          if (walls && Math.hypot(a.x - wall.x, a.y - wall.y) < wall.r + st.sensorOffset + 3) return;
          const near = { edge: false };
          const read = (angle: number, saturate: boolean) => {
            const [px, py] = [a.x + st.sensorOffset * Math.cos(angle), a.y + st.sensorOffset * Math.sin(angle)];
            const [fx, fy] = [px - Math.floor(px), py - Math.floor(py)];
            if (Math.min(fx, 1 - fx, fy, 1 - fy) < 1e-3) near.edge = true;
            const c = (((Math.floor(py) % h) + h) % h) * w + (((Math.floor(px) % w) + w) % w);
            let v = 0;
            for (let k = 0; k < 2; k++) {
              const t = trail[c * 4 + k] ?? 0;
              v += (saturate ? sat(t) : t) * (st.attraction[k] ?? 0);
            }
            return v;
          };
          const turn = (saturate: boolean) => {
            const sa = st.sensorAngle * DEG;
            const [f, l, rr] = [
              read(a.heading, saturate),
              read(a.heading - sa, saturate),
              read(a.heading + sa, saturate),
            ];
            const gap = Math.min(Math.abs(f - l), Math.abs(f - rr), Math.abs(l - rr));
            const close = gap / Math.max(1, Math.abs(f), Math.abs(l), Math.abs(rr)) < 1e-4;
            if (f > l && f > rr) return { by: 0, close };
            if (f < l && f < rr) return { by: firstDraw(i, 1, settings.seed) < 0.5 ? RA : -RA, close };
            return { by: l < rr ? RA : rr < l ? -RA : 0, close };
          };
          const withK = turn(true);
          const withoutK = turn(false);
          if (near.edge || withK.close) return;
          checked++;
          if (withK.by !== withoutK.by) changedByK++;
          const expected = a.heading + withK.by * DEG;
          const diff = Math.abs(((b.heading - expected + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
          expect(diff, `agent ${i}`).toBeLessThan(1e-4);
        });
        expect(checked).toBeGreaterThan(0.4 * agents.length);
        expect(changedByK).toBeGreaterThan(0.1 * checked);
      },
    );
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
    }, 120_000);

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

      // A wall cell takes no source in either model, and in the extended model it is a sink that holds no trail; in
      // the Jones model the trail diffuses into it (ADR 0027).
      it.each(MODELS)('for diffusion (%s model)', async (model) => {
        const sim = await make({ layout: 'empty', model, collisions: model === 'jones' }, w, h, 1);
        const food = env.slice();
        for (let c = 0; c < w * h; c++) food[c * 4 + 1] = 255;
        sim.writeEnv(food);
        // The first step adds the sources to a map of zeros; the next one diffuses a trail of ones.
        sim.run(1);
        const scent = await sim.readScent();
        sim.writeTrail(new Float32Array(w * h * 4).fill(1));
        sim.run(1);
        const trail = await sim.readTrail();
        const kinds = BYTES.map((_, k) => {
          const c = (2 + k) * w + 15;
          const source = (scent[c * 2] ?? 0) > 0;
          const t = trail[c * 4] ?? 0;
          return `${source ? 'source' : 'none'} ${t > 0 ? 'trail' : 'no trail'}`;
        });
        expect(kinds).toEqual(
          wall.map((x) => (x ? `none ${model === 'jones' ? 'trail' : 'no trail'}` : 'source trail')),
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
      boundary !== 'dish' || Math.hypot(x + 0.5 - w / 2, y + 0.5 - h / 2) <= dishRadius(w, h);

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

    /**
     * The byte that a cell may hold at least for a layer the environment does not hold there (paint.wgsl `floorByte`):
     * the byte of d cells outside, with the nearest cell of the layer in the arena d cells away.
     */
    function floorBound(env: Uint8Array, boundary: string, w: number, h: number, x: number, y: number, ch: number) {
      let near = Infinity;
      for (let dy = -3; dy <= 3; dy++)
        for (let dx = -3; dx <= 3; dx++) {
          const c = dx === 0 && dy === 0 ? -1 : cellAt(boundary, w, h, x + dx, y + dy);
          if (c >= 0 && (env[c * 4 + ch] ?? 0) >= 128) near = Math.min(near, Math.hypot(dx, dy));
        }
      return Math.round((Math.min(1, Math.max(-1, -near / SHAPE_RANGE)) * 0.5 + 0.5) * 255);
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
          const [a, r] = [2 * Math.PI * t, dishRadius(w, h) + off];
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
        const [cx, cy, rim] = [w / 2, h / 2, dishRadius(w, h)];
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
    // `env` again: signs, light, the walls' shadow, and no outline nearer or farther than the cells of `env` allow.
    // Farther: a wall along the right edge of a box, or a wall or food that the dish clipped at its rim, has cells
    // beside it that the old boundary did not count, with bytes of 4 cells or more outside.
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
      const bounded = [0, 0];
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
            else if (e < 128 && s < floorBound(env, to, W, H, x, y, ch))
              wrong.push(`${ch ? 'food' : 'wall'} at ${x},${y}: outline ${s} farther than env allows`);
            if (e < 128 && floorBound(env, to, W, H, x, y, ch) > 0) bounded[ch] = (bounded[ch] ?? 0) + 1;
          }
        }
      expect(wrong).toEqual([]);
      // The cells that the lower bound is about, beside the cells of each layer.
      expect(bounded[0]).toBeGreaterThan(20);
      expect(bounded[1]).toBeGreaterThan(20);
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
          (boundary !== 'dish' || Math.hypot(x + 0.5 - w / 2, y + 0.5 - h / 2) <= dishRadius(w, h));
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

    // Shrinking plasmodium: 0.71 agents per cell of Jones' dish (ADR 0027), and 0.5 % more agents than the dish has
    // free cells for.
    it('fills a dish to 71 % with every agent on a cell of its own, and starts the rest dead when it is full', async () => {
      const [w, h] = [64, 48];
      const cells = Array.from({ length: w * h }, (_, c) => [c % w, Math.floor(c / w)] as const).filter(
        ([x, y]) => Math.hypot(x + 0.5 - w / 2, y + 0.5 - h / 2) <= dishRadius(w, h),
      ).length;
      const dense = await make({ boundary: 'dish', collisions: true, seed: 3 }, w, h, Math.round(0.71 * cells));
      expect(await starts(dense, 'dish')).toEqual({ alive: Math.round(0.71 * cells), shared: 0, blocked: 0 });
      const full = await make({ boundary: 'dish', collisions: true, seed: 3 }, w, h, cells + 8);
      const s = await starts(full, 'dish');
      expect([s.shared, s.blocked]).toEqual([0, 0]);
      expect(s.alive).toBeGreaterThan(0.97 * cells);
      expect(s.alive).toBeLessThanOrEqual(cells);
    });

    // Jones places every agent on a free cell (p. 132). Shrinking plasmodium fills 0.71 of Jones' dish (ADR 0027): with
    // 32 claim rounds seed 6 left 2 of its 45,000 agents dead on both backends, with 64 none (pack.ts START_ROUNDS).
    it('places every agent of Shrinking plasmodium on a cell of its own in Jones’ dish', async () => {
      const shrinking = presetById('shrinking')?.settings();
      if (!shrinking) throw new Error('no Shrinking plasmodium');
      const sim = await make({ ...shrinking, seed: 6 }, 300, 300, 45_000);
      expect(await starts(sim, 'dish')).toEqual({ alive: 45_000, shared: 0, blocked: 0 });
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

    // x = 0.999999 − 2 = −1.000001 lies in cell −2, which is cell W − 2 on the periodic grid, and the move counts
    // there. Wrapped in float32 the position rounded up to 511.0, into cell W − 1, where another agent could
    // claim the same cell (wrapPos in common.wgsl and common.glsl).
    it.each([false, true])(
      'lands a move that ends just below x = −1 in the cell it counted (collisions %s)',
      async (collisions) => {
        const [w, h] = [512, 8];
        const straight = { sensorAngle: 0, sensorOffset: 1, randomTurn: 0, stepSize: 2 };
        const strains = [{ ...defaultStrain(0), ...straight }];
        const sim = await make({ layout: 'empty', strains }, w, h, 1);
        sim.writeAgent(0, { x: 0.999999, y: 0.5, heading: Math.PI, bits: 4 });
        if (collisions) sim.update({ ...defaultSettings(), layout: 'empty', strains, collisions: true });
        sim.run(1);
        const [a] = await sim.readAgents();
        const counts = await sim.readCounts();
        const counted = Array.from({ length: w * h }, (_, c) => c).filter((c) => (counts[c * 4] ?? 0) > 0);
        expect([Math.floor(a?.x ?? -1), Math.floor(a?.y ?? -1)]).toEqual([w - 2, 0]);
        expect(counted).toEqual([w - 2]);
      },
    );

    // A move across the seam lands in the cell of its floor, wrapped with whole periods from integers and rounded
    // once to float32 (wrapPos in common.wgsl and common.glsl, ADR 0023). On these sides a float division was not
    // exact on an Apple M3 Pro: on 33, 47 and 246, x = W wrapped to 0.99999994 on WebGPU, and WebGL2's cellAt put
    // cell W in the next row and row H outside the grid. On 480, x = 479.99997 wrapped to −0.00003 and landed at
    // 479.0. Each agent moves half a cell in a row or column of its own; along +x the move and its result are exact.
    describe.each([33, 47, 246, 480])('a move across the seam of a side of %i cells', (side) => {
      const STEP = 0.5;
      /** p wrapped into [0, n) in the cell of its floor, rounded once, as wrapPos() does it. */
      const wrapped = (p: number, n: number) => {
        const c = Math.floor(p);
        const lo = ((c % n) + n) % n;
        return Math.min(Math.fround(p - (c - lo)), below(lo + 1));
      };
      // Into the first cell: exactly onto the seam and past it; staying in the last cell: a hair below the seam,
      // and below it; and a move inside the grid.
      const starts = [side - STEP, side - 0.25, below(side) - STEP, side - 0.75, 0.25].map(Math.fround);

      async function moved(axis: 'x' | 'y', collisions: boolean) {
        const [w, h] = axis === 'x' ? [side, 16] : [16, side];
        const straight = { sensorAngle: 0, sensorOffset: 1, randomTurn: 0, stepSize: STEP };
        const strains = [{ ...defaultStrain(0), ...straight }];
        const sim = await make({ layout: 'empty', strains }, w, h, starts.length);
        starts.forEach((v, i) => {
          const across = 3 * i + 0.5;
          const [x, y] = axis === 'x' ? [v, across] : [across, v];
          sim.writeAgent(i, { x, y, heading: axis === 'x' ? 0 : Math.PI / 2, bits: 4 });
        });
        if (collisions) sim.update({ ...defaultSettings(), layout: 'empty', strains, collisions: true });
        sim.run(1);
        const agents = await sim.readAgents();
        const counts = await sim.readCounts();
        const counted = Array.from({ length: w * h }, (_, c) => c).filter((c) => (counts[c * 4] ?? 0) > 0);
        const cells = agents.map((a) => Math.floor(a.y) * w + Math.floor(a.x)).sort((a, b) => a - b);
        return { agents, counted, cells, w };
      }

      it.each([false, true])(
        'along +x: the exact float32 result, in the cell it counted (collisions %s)',
        async (c) => {
          const { agents, counted, cells } = await moved('x', c);
          expect(agents.map((a) => a.x)).toEqual(starts.map((v) => wrapped(Math.fround(v + STEP), side)));
          expect(agents.map((a) => a.y)).toEqual(starts.map((_, i) => 3 * i + 0.5));
          expect(counted).toEqual(cells);
        },
      );

      it.each([false, true])(
        'along +y: in row 0 past the top seam, in the cell it counted (collisions %s)',
        async (c) => {
          const { agents, counted, cells, w } = await moved('y', c);
          const rows = starts.map((v) => Math.floor(wrapped(Math.fround(v + STEP), side)));
          expect(agents.map((a) => Math.floor(a.y))).toEqual(rows);
          for (const [i, a] of agents.entries()) {
            expect(a.y, `agent ${i}`).toBeLessThan(side);
            expect(Math.abs(a.y - wrapped(Math.fround((starts[i] ?? 0) + STEP), side)), `agent ${i}`).toBeLessThan(
              1e-4,
            );
            expect(Math.floor(a.x), `agent ${i}`).toBe(3 * i);
          }
          expect(counted).toEqual(cells);
          expect(cells.every((c) => c < w * side)).toBe(true);
        },
      );
    });

    // A box does not wrap, but the float division ran there too: x = 479.99997 in a box 480 cells wide landed at
    // 479.0 (ADR 0023).
    it.each([false, true])(
      'keeps a move that ends a hair below the edge of a box where it ends (collisions %s)',
      async (c) => {
        const end = below(480); // 479.99997
        const straight = { sensorAngle: 0, sensorOffset: 1, randomTurn: 0, stepSize: 1 };
        const strains = [{ ...defaultStrain(0), ...straight }];
        const sim = await make({ layout: 'empty', boundary: 'box', strains }, 480, 16, 1);
        sim.writeAgent(0, { x: end - 1, y: 8.5, heading: 0, bits: 4 });
        if (c) sim.update({ ...defaultSettings(), layout: 'empty', boundary: 'box', strains, collisions: true });
        sim.run(1);
        const [a] = await sim.readAgents();
        expect([a?.x, a?.y]).toEqual([end, 8.5]);
      },
    );

    it('places the same agents again for the same seed', async () => {
      const place = async () => {
        const sim = await make({ layout: 'center', boundary: 'dish', collisions: true, seed: 9 }, 64, 48, 30);
        return sim.readAgents();
      };
      expect(await place()).toEqual(await place());
    });

    // The app reads the alive count to know whether the inoculate tool has dead agents left (ADR 0023). On WebGPU only
    // the steps counted them: a new simulation gave 0, and after a reset the count stayed that of the last step before
    // it, until the next step.
    it.each([false, true])(
      'counts the alive agents of a new population before its first step (collisions %s)',
      async (collisions) => {
        const n = 300;
        const patch = { layout: 'mixed', collisions, density: 0.2 } as const;
        const sim = await make(patch, 64, 48, n);
        expect(await sim.alive()).toEqual([n]);
        sim.run(2);
        expect(await sim.alive()).toEqual([n]);
        sim.update({ ...defaultSettings(), ...patch, layout: 'empty' });
        sim.reset();
        expect(await sim.alive()).toEqual([0]);
        sim.update({ ...defaultSettings(), ...patch });
        sim.reset();
        expect(await sim.alive()).toEqual([n]);
      },
    );
  });

  // Inoculate places dead agents only, and with one agent per cell a placed or moved agent claims a free cell like
  // a move (ADR 0008, ADR 0023). A tool acts on every step of a run() call; the frames here have 2 steps each, as at
  // 120 steps per second on a 60 Hz display.
  describe('agent tools (ADR 0023)', () => {
    const inoculate = (x: number, y: number, radius: number, strain: number, revive: number): AgentTool => ({
      kind: AgentToolKind.inoculate,
      ...{ x, y, radius, strain, revive },
    });
    const cut = (x: number, y: number, radius: number): AgentTool => ({
      kind: AgentToolKind.cut,
      ...{ x, y, radius, strain: 0, revive: 0 },
    });

    /** The agents with their ids, the alive ones, the most alive agents in one cell, and alive agents in a wall. */
    async function census(sim: Sim, env: Uint8Array) {
      const { width: w, height: h } = sim;
      const agents = (await sim.readAgents()).map((a, id) => ({ ...a, id }));
      const alive = agents.filter((a) => a.bits & 4);
      const per = new Map<number, number>();
      let walled = 0;
      for (const a of alive) {
        const [x, y] = [Math.floor(a.x), Math.floor(a.y)];
        const c = y * w + x;
        if (x < 0 || y < 0 || x >= w || y >= h || (env[c * 4] ?? 0) >= 128) walled++;
        per.set(c, (per.get(c) ?? 0) + 1);
      }
      return { agents, alive, most: Math.max(0, ...per.values()), walled };
    }

    // 300 frames at one spot of a box, through a wall: the brush fills, its agents walk off, and dead agents take
    // the cells they leave. Strain 0 is never placed: the tool places its own strain only.
    async function inoculation(check: boolean) {
      const strains = [defaultStrain(0), defaultStrain(1)];
      const patch = { layout: 'empty', boundary: 'box', collisions: true, strains, shrink: 0.002, seed: 21 } as const;
      const sim = await make(patch, 64, 48, 1500);
      sim.paint([{ kind: 'wall', from: [20, 24], to: [44, 24], radius: 1.5 }]);
      const env = await sim.readEnv();
      let most = 0;
      let placed = 0;
      for (let step = 0; step < 600; step++) {
        sim.run(1, inoculate(32, 24, 10, 1, 0.05));
        if (!check) continue;
        const c = await census(sim, env);
        most = Math.max(most, c.most);
        expect(c.most, `step ${step}`).toBeLessThanOrEqual(1);
        expect(c.walled, `step ${step}`).toBe(0);
        expect(c.alive.filter((a) => (a.bits & 3) === 0)).toEqual([]);
        placed = Math.max(placed, c.alive.length);
      }
      return { sim, most, placed };
    }

    it('places agents on free cells only: one agent per cell after every step of a 300-frame hold', async () => {
      const { sim, most, placed } = await inoculation(true);
      expect(most).toBe(1);
      // About 250 open cells in the brush; agents walk off and others take their cells.
      expect(placed).toBeGreaterThan(200);
      const again = (await inoculation(false)).sim;
      expect(await again.readAgents()).toEqual(await sim.readAgents());
      expect(Array.from(await again.readTrail())).toEqual(Array.from(await sim.readTrail()));
    }, 120_000); // Up to 24.0 s on SwiftShader in CI (#28): 120 s keeps it under a quarter (ADR 0010).

    // Agents that never leave their cell (step 0), half of them dead, and a brush across the wrap seam. Before,
    // the tool also moved living agents of its strain from anywhere into the brush.
    it.each([false, true])(
      'takes dead agents only: the living agents outside the brush stay where they are (collisions %s)',
      async (collisions) => {
        const [w, h] = [64, 48];
        const strains = [{ ...defaultStrain(0), stepSize: 0 }];
        const patch = { layout: 'mixed', collisions, strains, shrink: 0.5, seed: 4 } as const;
        const sim = await make(patch, w, h, 900);
        sim.run(1);
        sim.update({ ...defaultSettings(), ...patch, shrink: 0 });
        const [cx, cy, r] = [2, 24, 9];
        const near = (d: number, n: number) => Math.abs((((d % n) + 1.5 * n) % n) - n / 2);
        // A hair past the rim: a float32 position placed on the rim can read as just outside it.
        const outside = (a: { x: number; y: number }) => Math.hypot(near(a.x - cx, w), near(a.y - cy, h)) > r + 0.01;
        const where = (list: { id: number; x: number; y: number; bits: number }[]) =>
          list.filter(outside).map(({ id, x, y, bits }) => ({ id, x, y, bits }));
        const env = await sim.readEnv();
        const start = await census(sim, env);
        const before = where(start.alive);
        expect(before.length).toBeGreaterThan(300);
        expect(start.agents.length - start.alive.length).toBeGreaterThan(300);
        for (let step = 0; step < 600; step++) {
          sim.run(1, inoculate(cx, cy, r, 0, 0.05));
          const c = await census(sim, env);
          expect(where(c.alive), `step ${step}`).toEqual(before);
          if (collisions) expect(c.most, `step ${step}`).toBeLessThanOrEqual(1);
        }
        const end = await census(sim, env);
        expect(end.alive.length - start.alive.length).toBeGreaterThan(100);
      },
    );

    it('moves the agents of a cut to free cells: one agent per cell after every step', async () => {
      const [w, h, n] = [64, 48, 1843];
      const sim = await make({ layout: 'mixed', boundary: 'box', collisions: true, density: 0.6, seed: 6 }, w, h, n);
      sim.run(10);
      const env = await sim.readEnv();
      const wound = (a: { x: number; y: number }) => Math.hypot(a.x - 32, a.y - 24) < 8;
      const inside = (await census(sim, env)).alive.filter(wound).length;
      expect(inside).toBeGreaterThan(100);
      let left = inside;
      for (let step = 0; step < 300; step++) {
        sim.run(1, cut(32, 24, 8));
        const c = await census(sim, env);
        expect(c.most, `step ${step}`).toBe(1);
        expect(c.alive.length, `step ${step}`).toBe(n);
        expect(c.walled, `step ${step}`).toBe(0);
        left = c.alive.filter(wound).length;
      }
      // Agents keep walking in, and each step moves them out again.
      expect(left).toBeLessThan(inside / 4);
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
      { timeout: 1_200_000 },
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

    // 47 and 246 are sides where a float floor(c / side) was not exact on an Apple M3 Pro: the WebGL2 view drew
    // cell W from the next row and row H from outside the grid (view.glsl and render.frag, ADR 0023). Food and trail
    // across both seams of a 47 × 246 grid look the same from every side of the seams.
    it.each(['paper', 'gel', 'glow'] as const)(
      'draw food and trail across both seams of a grid of 47 × 246 cells without a seam (%s)',
      async (style) => {
        backend.forget();
        const [w, h] = [47, 246];
        const settings: Settings = { ...defaultSettings(), style, layout: 'empty', strains: [cyan], bloom: 0 };
        const sim = await make(settings, w, h, 1);
        sim.paint([{ kind: 'food', from: [0, 0], to: [2, 1], radius: 5 }]); // across x = 0 and y = 0
        const level = 1 / (0.4 / equilibrium(settings));
        sim.writeTrail(
          Float32Array.from({ length: w * h * 4 }, (_, i) => (i % 4 ? 0 : (((i >> 2) * 37) % 11) * level)),
        );
        const capture = (x: number, y: number) =>
          backend.capture(sim, settings, { center: [x, y], scale: 1 / 8 }, SIZE, SIZE);
        const seam = await capture(0, 0);
        for (const [x, y] of [
          [w, 0],
          [0, h],
          [w, h],
          [-w, -h],
        ] as const)
          expect(maxDiff(seam, await capture(x, y)), `centre (${x}, ${y})`).toBeLessThanOrEqual(2);
      },
    );

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
        // The left edge of the box (x = 0) and the left of the dish rim (x = 9.32, ADR 0027) cross pixel 94 at 4 px per
        // cell.
        const x = (boundary === 'box' ? 0 : W / 2 - dishRadius(W, H)) + 0.3;
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
      // Box: down from the top edge (y = 0). Dish: from the middle out through the left of the rim (x = 9.32).
      const box = boundary === 'box';
      sim.paint([{ kind: 'food', from: box ? [32, -2] : [32, 24], to: box ? [32, 30] : [2, 24], radius: 2.56 }]);
      const centre: [number, number] = box ? [32, 2] : [11, 24];
      const img = await backend.capture(sim, settings, { center: centre, scale: 1 / 8 }, 96, 96);
      // The first pixel of food on the line `at` cells inside the edge, counted across the stroke.
      const outlineAt = (at: number) => {
        const k = Math.floor(((box ? 0 : W / 2 - dishRadius(W, H)) + at - centre[box ? 1 : 0]) * 8 + 48);
        for (let s = 0; s < 96; s++) {
          const i = ((box ? k : s) * 96 + (box ? s : k)) * 4;
          if ((img.data[i] ?? 0) - (img.data[i + 2] ?? 0) > 30) return s;
        }
        return NaN;
      };
      expect(Math.abs(outlineAt(0.25) - outlineAt(3))).toBeLessThanOrEqual(1);
    });

    // The renderer reads a cell inside the dish for each cell outside its rim (render.wgsl shapeIndex and shapeCells,
    // view.glsl shapeAt). That rim must be the dish's own, 0.945 of the short side (ADR 0027): with the rim of before,
    // the cells between both rims read their own bytes, and the outline of food bent there by 2 to 3 pixels at 32 pixels
    // per cell (up to 187 levels). At 64 pixels per cell the food's upper edge, y = 24 − 2.56, lies on its row from 0.25
    // to 2.75 cells inside the rim.
    it('draw the outline of food straight up to the rim of the dish, zoomed in', async () => {
      const settings: Settings = {
        ...defaultSettings(),
        style: 'paper',
        boundary: 'dish',
        layout: 'empty',
        strains: [defaultStrain(0)],
      };
      const sim = await make(settings, W, H, 1);
      sim.paint([{ kind: 'food', from: [32, 24], to: [2, 24], radius: 2.56 }]);
      const rim = W / 2 - dishRadius(W, H);
      const centre: [number, number] = [rim + 1.5, 24 - 2.56];
      const img = await backend.capture(sim, settings, { center: centre, scale: 1 / 64 }, 256, 128);
      const edgeAt = (at: number) => {
        const k = Math.floor((rim + at - centre[0]) * 64 + 128);
        for (let y = 0; y < 128; y++) {
          const i = (y * 256 + k) * 4;
          if ((img.data[i] ?? 0) - (img.data[i + 2] ?? 0) > 30) return y;
        }
        return NaN;
      };
      for (const at of [0.25, 0.5, 1, 2, 2.75])
        expect(Math.abs(edgeAt(at) - 64), `${at} cells inside`).toBeLessThanOrEqual(1);
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
        sim.run(1, { kind: AgentToolKind.inoculate, x: 30, y: 22, radius: 8, strain: 1, revive: 0.5 });
        sim.run(15);
        sim.run(1, { kind: AgentToolKind.cut, x: 20, y: 20, radius: 6, strain: 0, revive: 0 });
        sim.run(35);
        return sim;
      }

      // Walls in the way of sensors up to 64 cells long (ADR 0020), on the periodic grid.
      async function walled(collisions: boolean, sortInterval: number) {
        const far = [9, 30, 64].map((sensorOffset, i) => ({ ...defaultStrain(i), sensorOffset }));
        const patch = { seed: 13, collisions, density: collisions ? 0.5 : 2, strains: far };
        const sim = (await make(patch, 64, 48, collisions ? 1536 : 6144)) as Simulation;
        sim.sortInterval = sortInterval;
        sim.paint(WALLS);
        sim.reset();
        sim.run(72);
        return sim;
      }

      const state = async (sim: Sim) => ({ agents: await sim.readAgents(), trail: Array.from(await sim.readTrail()) });
      const BUILDS = { wrap: open, 'box with tools and shrinkage': arena, 'walls in the way of sensors': walled };

      it.each([
        ['wrap', false],
        ['wrap', true],
        ['box with tools and shrinkage', false],
        ['box with tools and shrinkage', true],
        ['walls in the way of sensors', false],
        ['walls in the way of sensors', true],
      ] as const)(
        'gives the same agents and trails as unsorted runs (%s, collisions %s)',
        async (scene, collisions) => {
          const build = BUILDS[scene];
          const unsorted = await state(await build(collisions, 0));
          if (scene === 'box with tools and shrinkage') {
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
