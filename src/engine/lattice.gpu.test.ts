// Lattices in a real browser, on both backends (ADR 0026): a scene of Jones keeps the lattice of its figure on every
// screen, the view fits it with free space beside it, and a tool paints the cell under the pointer.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hexToLinear } from '../model/color';
import { defaultSettings, type Settings } from '../model/params';
import { presetById, type Preset } from '../model/presets';
import { BrushDrag } from '../ui/drag';
import { Engine } from './engine';
import { WebGl2Backend } from './gl/backend';
import { AgentToolKind, type AgentTool } from './pack';
import { BACKGROUND, LATTICE_COPIES } from './render';
import type { Backend } from './types';
import { WebGpuBackend } from './webgpu';

const BACKENDS = {
  webgpu: (c: HTMLCanvasElement): Promise<Backend> => WebGpuBackend.create(c),
  webgl2: (c: HTMLCanvasElement): Promise<Backend> => Promise.resolve(WebGl2Backend.create(c)),
};
type Kind = keyof typeof BACKENDS;
const shared: Partial<Record<Kind, Backend>> = {};

// One backend per API: a new WebGPU device on SwiftShader (CI) takes 14 to 16 s to build its pipelines (ADR 0010).
beforeAll(async () => {
  for (const [kind, create] of Object.entries(BACKENDS)) {
    const backend = await create(document.createElement('canvas'));
    (await backend.createSim(defaultSettings(), 16, 16, 1)).destroy();
    shared[kind as Kind] = backend;
  }
}, 360_000);
afterAll(() => {
  for (const backend of Object.values(shared)) backend.destroy();
});

/** The shared backend of `kind`; destroying an engine keeps it. */
function lent(kind: Kind): Backend {
  const backend = shared[kind];
  if (!backend) throw new Error(`no ${kind} backend`);
  return new Proxy(backend, {
    get: (t, key) => (key === 'destroy' ? () => undefined : (Reflect.get(t, key, t) as unknown)),
  });
}

const preset = (id: string): Preset => {
  const p = presetById(id);
  if (!p) throw new Error(id);
  return p;
};

/** An engine with a preset loaded, paused, on a canvas of `w` × `h` pixels; `patch` changes the preset's settings. */
async function scene(kind: Kind, id: string, w: number, h: number, patch: Partial<Settings> = {}) {
  const p = preset(id);
  const canvas = document.createElement('canvas');
  [canvas.width, canvas.height] = [w, h];
  const s = { ...p.settings(), seed: 7, ...patch };
  const engine = await Engine.create(canvas, s, undefined, lent(kind));
  await engine.load(s, p.env ?? []);
  engine.paused = true;
  return engine;
}

// Small canvases of each shape keep the captures cheap on SwiftShader: 16:9, a square, a phone held upright.
const SCREENS = [
  [640, 360],
  [400, 400],
  [195, 422],
] as const;

/** The lattice fills the canvas's short side, centred (an independent reading of the letterbox). */
function letterbox([cw, ch]: readonly [number, number], [w, h]: readonly [number, number]) {
  const px = Math.min(cw / w, ch / h); // pixels per cell
  return { px, left: (cw - w * px) / 2, top: (ch - h * px) / 2 };
}

/** 8-bit sRGB to linear light, and back. */
const linear = (v: number) => hexToLinear(`#${v.toString(16).padStart(2, '0').repeat(3)}`)[0];
const srgb8 = (c: number) => Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055));

/** The 8-bit RGB sum of a pixel. */
const rgb = (img: ImageData, x: number, y: number) => {
  const i = (Math.floor(y) * img.width + Math.floor(x)) * 4;
  return (img.data[i] ?? 0) + (img.data[i + 1] ?? 0) + (img.data[i + 2] ?? 0);
};

// On SwiftShader on an M3 Pro, beside other work, each test took at most 26.8 s (ADR 0010): 240 s keeps every one
// under a quarter of its limit.
const LIMIT = 240_000;

describe.each(['webgpu', 'webgl2'] as const)('lattices on %s', (kind) => {
  it(
    'keep a scene of Jones on the lattice of its figure on 16:9, 1:1 and a phone, and the app’s scenes on the screen’s grid',
    async () => {
      for (const [id, lattice] of [
        ['shrinking', [300, 300]],
        ['spots', [200, 200]],
      ] as const) {
        let env: Uint8Array | undefined;
        for (const [w, h] of SCREENS) {
          const engine = await scene(kind, id, w, h);
          expect([engine.sim.width, engine.sim.height], `${id} on ${w} × ${h}`).toEqual(lattice);
          const now = await engine.sim.readEnv();
          env ??= now;
          expect(now, `${id} on ${w} × ${h}`).toEqual(env);
          engine.destroy();
        }
      }
      // A lattice that is not square keeps its width and height on every screen: it never turns (ADR 0026).
      for (const [lattice, [w, h]] of [
        ...SCREENS.map((screen) => [[240, 120], screen] as const),
        [[120, 240], SCREENS[2]] as const,
      ]) {
        const engine = await scene(kind, 'spots', w, h, { lattice: [...lattice] });
        expect([engine.sim.width, engine.sim.height], `${lattice.join(' × ')} on ${w} × ${h}`).toEqual(lattice);
        engine.destroy();
      }
      for (const [w, h] of SCREENS) {
        const engine = await scene(kind, 'maze', w, h);
        const expected = w >= h ? [512, Math.round((512 * h) / w)] : [Math.round((512 * w) / h), 512];
        expect([engine.sim.width, engine.sim.height], `maze on ${w} × ${h}`).toEqual(expected);
        engine.destroy();
      }
    },
    LIMIT,
  );

  it(
    'paint the cell under the pointer, on the lattice and on a copy of a periodic one, and nothing beside a dish',
    async () => {
      for (const [w, h] of SCREENS) {
        // A dish: a dab under the pointer paints there, one in the free space beside the lattice paints nothing.
        const engine = await scene(kind, 'steiner', w, h);
        const box = letterbox([w, h], [200, 200]);
        const before = await engine.capture();
        const pointer: [number, number] = [box.left + 70 * box.px, box.top + 120 * box.px];
        const drag = new BrushDrag();
        drag.to(engine, pointer, 'food', 2);
        drag.end();
        if (w !== h) drag.to(engine, w > h ? [box.left / 2, h / 2] : [w / 2, box.top / 2], 'food', 2);
        engine.frame(performance.now(), 0);
        expect(engine.envList().length, `${w} × ${h}`).toBe(5); // the four foods of the scene and the dab
        const env = await engine.sim.readEnv();
        expect(env[(120 * 200 + 70) * 4 + 1], `food byte under the pointer on ${w} × ${h}`).toBeGreaterThan(0);
        const after = await engine.capture();
        expect(Math.abs(rgb(after, ...pointer) - rgb(before, ...pointer)), `${w} × ${h}`).toBeGreaterThan(60);
        engine.destroy();
      }
      // A periodic lattice on 16:9: a dab on the copy right of the lattice paints the cell the copy shows, and the
      // picture shows it in the lattice and, dimmed, on the copy.
      const [w, h] = [640, 360];
      const engine = await scene(kind, 'spots', w, h);
      const box = letterbox([w, h], [200, 200]);
      const before = await engine.capture();
      const copy: [number, number] = [box.left + 230 * box.px, box.top + 90 * box.px];
      const inside: [number, number] = [box.left + 30 * box.px, box.top + 90 * box.px];
      new BrushDrag().to(engine, copy, 'food', 3);
      engine.frame(performance.now(), 0);
      const env = await engine.sim.readEnv();
      expect(env[(90 * 200 + 30) * 4 + 1]).toBeGreaterThan(0);
      const after = await engine.capture();
      const shown = (p: [number, number]) => rgb(after, ...p) - rgb(before, ...p);
      expect(shown(inside)).toBeGreaterThan(60);
      expect(shown(copy)).toBeGreaterThan(10);
      expect(shown(copy)).toBeLessThan(shown(inside));
      engine.destroy();
      // A lattice that is not square, on 16:9 and on a phone: a dab paints the cell under the pointer.
      for (const [lattice, [cw, ch]] of [
        [[240, 120], SCREENS[2]],
        [[120, 240], SCREENS[0]],
      ] as const) {
        const e = await scene(kind, 'spots', cw, ch, { lattice: [...lattice] });
        const b = letterbox([cw, ch], lattice);
        const [cx, cy] = [Math.round(lattice[0] * 0.3), Math.round(lattice[1] * 0.7)];
        new BrushDrag().to(e, [b.left + (cx + 0.5) * b.px, b.top + (cy + 0.5) * b.px], 'food', 1);
        e.frame(performance.now(), 0);
        const bytes = await e.sim.readEnv();
        expect(bytes[(cy * lattice[0] + cx) * 4 + 1], `${lattice.join(' × ')} on ${cw} × ${ch}`).toBeGreaterThan(0);
        e.destroy();
      }
    },
    LIMIT,
  );

  // ADR 0026: beside a closed lattice the view shows the free space, and nothing of the arena. A copy of the dish there
  // would show trail.
  it(
    'draw only the free space beside a closed lattice and in its corners outside the dish',
    async () => {
      const space = hexToLinear(BACKGROUND.glow).map((v) => srgb8(v * 0.55));
      // Two dishes with few agents keep this cheap on SwiftShader (CI).
      for (const [id, [w, h]] of [
        ['steiner', SCREENS[0]],
        ['shortest-path', SCREENS[2]],
      ] as const) {
        const engine = await scene(kind, id, w, h);
        engine.frame(performance.now(), 60);
        await engine.settle();
        const img = await engine.capture();
        const side = engine.sim.width;
        const box = letterbox([w, h], [side, side]);
        let [worst, inside] = [0, 0];
        for (let y = 1; y < h - 1; y += 2)
          for (let x = 1; x < w - 1; x += 2) {
            const [gx, gy] = [(x + 0.5 - box.left) / box.px, (y + 0.5 - box.top) / box.px];
            // The free space beside the lattice, and the lattice's corners: farther than 2 pixels from the dish.
            const r = Math.hypot(gx - side / 2, gy - side / 2) - (side / 2 - 1);
            if (r * box.px < 2) {
              inside++;
              continue;
            }
            const i = (y * w + x) * 4;
            for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs((img.data[i + c] ?? 0) - (space[c] ?? 0)));
          }
        expect(inside, `${id} on ${w} × ${h}`).toBeGreaterThan(100);
        expect(worst, `${id} on ${w} × ${h}`).toBeLessThanOrEqual(2); // dither
        engine.destroy();
      }
    },
    LIMIT,
  );

  // ADR 0026: on a periodic grid the agent tools measure the distance to the nearest copy of the brush, so a tool held
  // on a copy acts on the cells the copy shows, and one across an edge acts on both sides.
  it(
    'cut and inoculate on a copy of a periodic lattice and across its edge, as on the cells they show',
    async () => {
      /** Living agents within `r` cells of `at` on the periodic 300 × 300 grid. */
      const near = async (engine: Engine, [x, y]: readonly [number, number], r: number) => {
        let n = 0;
        for (const a of await engine.sim.readAgents()) {
          if ((a.bits & 4) === 0) continue;
          const dx = Math.abs(a.x - x) % 300;
          const dy = Math.abs(a.y - y) % 300;
          if (Math.hypot(Math.min(dx, 300 - dx), Math.min(dy, 300 - dy)) < r) n++;
        }
        return n;
      };
      let now = performance.now();
      /** Holds the tool for 5 frames of 2 steps each. */
      const hold = (engine: Engine, tool: Omit<AgentTool, 'revive'>) => {
        for (let k = 0; k < 5; k++) {
          engine.agentTool({ ...tool, rate: 100 });
          now += 50;
          engine.frame(now, 2);
        }
      };
      const cut = (x: number, y: number) => ({ kind: AgentToolKind.cut, x, y, radius: 20, strain: 0 });
      // One run, five wounds apart from each other: each count looks at the cells the tool shows.
      const engine = await scene(kind, 'wound', 640, 360);
      engine.frame(now, 50);
      for (const [label, tool, at] of [
        ['inside', cut(100.5, 50), [100.5, 50]],
        ['on the copy right of the lattice', cut(350.5, 150), [50.5, 150]],
        ['on the copy above it', cut(200, -49.5), [200, 250.5]],
        ['across the right edge', cut(299.5, 100), [0.5, 100]],
        ['across the left edge', cut(0.5, 220), [299.5, 220]],
      ] as const) {
        expect(await near(engine, at, 15), `${label}: agents before`).toBeGreaterThan(20);
        hold(engine, tool);
        expect(await near(engine, at, 15), `${label}: agents after the cut`).toBe(0);
      }
      engine.destroy();
      // Inoculate takes dead agents to the cells under the brush: on a copy, and on both sides of an edge.
      const inoculate = (x: number, y: number) => ({ kind: AgentToolKind.inoculate, x, y, radius: 10, strain: 0 });
      // In the extended model the Cut also clears the trail of the wound: on a copy, the cells the copy shows.
      const ext = await scene(kind, 'wound', 640, 360, { model: 'extended' });
      ext.frame(now, 50);
      const trailNear = async ([x, y]: readonly [number, number], r: number) => {
        const t = await ext.sim.readTrail();
        let sum = 0;
        for (let j = 0; j < 300; j++)
          for (let i = 0; i < 300; i++) {
            const dx = Math.abs(i + 0.5 - x) % 300;
            const dy = Math.abs(j + 0.5 - y) % 300;
            if (Math.hypot(Math.min(dx, 300 - dx), Math.min(dy, 300 - dy)) < r) sum += t[(j * 300 + i) * 4] ?? 0;
          }
        return sum;
      };
      expect(await trailNear([50.5, 150], 10)).toBeGreaterThan(1);
      for (let k = 0; k < 3; k++) {
        ext.agentTool({ ...cut(350.5, 150), rate: 0 });
        now += 50;
        ext.frame(now, 1);
      }
      expect(await trailNear([50.5, 150], 10)).toBe(0);
      ext.destroy();
      const empty = await scene(kind, 'wound', 640, 360, { layout: 'empty' });
      empty.frame(now, 1);
      for (const [label, tool, sides] of [
        ['on the copy left of the lattice', inoculate(-249.5, 60), [[50.5, 60]]],
        [
          'across the bottom edge',
          inoculate(200, 299.5),
          [
            [200, 295],
            [200, 4],
          ],
        ],
      ] as const) {
        hold(empty, tool);
        for (const at of sides) expect(await near(empty, at, 6), `${label} at ${at.join(', ')}`).toBeGreaterThan(5);
      }
      // Nowhere else: the brushes and the cells their agents walked to in 20 steps lie more than 60 cells away.
      expect(await near(empty, [150, 150], 60), 'none far away').toBe(0);
      empty.destroy();
    },
    LIMIT,
  );

  it(
    'dim the copies around a periodic lattice, and not those of a periodic grid shaped like the screen',
    async () => {
      /**
       * Pixels on the grid and the pixels one period to the right, on a copy of the grid: the copy's picture in linear
       * light, against `k` times the grid's above the free space (the background, 0.55 of it outside the arena). The
       * largest error in 8-bit sRGB; dither moves each pixel by up to 1.
       */
      const worst = async (engine: Engine, k: number) => {
        engine.frame(performance.now(), 60);
        await engine.settle();
        const img = await engine.capture();
        const period = Math.round(engine.sim.width / engine.view.scale);
        expect(Math.abs(period - engine.sim.width / engine.view.scale)).toBeLessThan(1e-6);
        const space = hexToLinear(BACKGROUND.glow).map((v) => v * 0.55);
        const dark = Math.max(...space.map(srgb8));
        let [error, lit] = [0, 0];
        for (let y = 4; y < img.height - 4; y += 3)
          for (let x = 4; x + period < img.width - 4; x += 3) {
            const [gx, gy] = engine.toGrid(x + 0.5, y + 0.5);
            if (gx < 1 || gy < 1 || gx > engine.sim.width - 1 || gy > engine.sim.height - 1) continue;
            const i = (y * img.width + x) * 4;
            const j = i + period * 4;
            for (let c = 0; c < 3; c++) {
              const [inside, bg] = [linear(img.data[i + c] ?? 0), space[c] ?? 0];
              error = Math.max(error, Math.abs((img.data[j + c] ?? 0) - srgb8(bg + k * (inside - bg))));
              if ((img.data[i + c] ?? 0) > dark + 40) lit++;
            }
          }
        expect(lit, 'pixels with trail').toBeGreaterThan(100);
        return error;
      };
      const spots = await scene(kind, 'spots', 640, 360);
      expect(await worst(spots, LATTICE_COPIES)).toBeLessThanOrEqual(3);
      spots.destroy();
      // A periodic grid shaped like the screen, zoomed out to show a copy: the copy is the grid's picture.
      const canvas = document.createElement('canvas');
      [canvas.width, canvas.height] = [640, 360];
      const s = { ...preset('two-strains').settings(), resolution: 256, seed: 7 };
      const engine = await Engine.create(canvas, s, undefined, lent(kind));
      engine.paused = true;
      engine.zoomAt(320, 180, 0.5);
      expect(await worst(engine, 1)).toBeLessThanOrEqual(3);
      engine.destroy();
    },
    LIMIT,
  );
});
