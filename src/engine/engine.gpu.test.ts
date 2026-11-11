// Engine behavior in a real browser (ADR 0010).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultSettings, type Settings } from '../model/params';
import { presetById } from '../model/presets';
import { dishRadius } from './brush';
import { Engine, type HeldTool } from './engine';
import { strokeOn, type EnvEdit } from './environment';
import { WebGl2Backend } from './gl/backend';
import type { GlSim } from './gl/sim';
import { OutOfMemoryError } from './gpu';
import { AgentToolKind, stepChance } from './pack';
import { paintReference } from './paint-reference';
import type { Simulation } from './sim';
import type { Backend, Stroke } from './types';
import { WebGpuBackend } from './webgpu';

const BACKENDS = {
  webgpu: (c: HTMLCanvasElement): Promise<Backend> => WebGpuBackend.create(c),
  webgl2: (c: HTMLCanvasElement): Promise<Backend> => Promise.resolve(WebGl2Backend.create(c)),
};
type Kind = keyof typeof BACKENDS;
const shared: Partial<Record<Kind, Backend>> = {};

// One backend per API for every engine here. In the CI image a new WebGPU device on SwiftShader took 14 to 16 s to
// build its pipelines (2026-11-10), and with one device per test, two tests here took 56 and 59 s of their 60 s.
beforeAll(async () => {
  for (const [kind, create] of Object.entries(BACKENDS)) {
    const backend = await create(document.createElement('canvas'));
    // The first simulation builds the pipelines: here, under a long timeout, and not in the first test.
    (await backend.createSim(defaultSettings(), 16, 16, 1)).destroy();
    shared[kind as Kind] = backend;
  }
}, 360_000);
afterAll(() => {
  for (const backend of Object.values(shared)) backend.destroy();
});

/**
 * A shared backend for one engine. Destroying the engine keeps it. A test may replace a member (createSim,
 * supportsCollisions) for this engine only, and the next `failures.next` allocations fail as out of memory.
 */
function lend(kind: Kind = 'webgpu') {
  const backend = shared[kind];
  if (!backend) throw new Error(`no ${kind} backend`);
  const own = new Map<PropertyKey, unknown>();
  const failures = { next: 0 };
  const lent = new Proxy(backend, {
    get(t, key) {
      if (own.has(key)) return own.get(key);
      if (key === 'destroy') return () => undefined;
      if (key === 'createSim')
        return (...args: Parameters<Backend['createSim']>) =>
          failures.next-- > 0 ? Promise.reject(new OutOfMemoryError('test')) : t.createSim(...args);
      return Reflect.get(t, key, t) as unknown;
    },
    set(_, key, value) {
      own.set(key, value);
      return true;
    },
  });
  return { lent, failures };
}

it('frees the old simulation before it allocates the new one (peak memory: one simulation)', async () => {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 180;
  const engine = await Engine.create(
    canvas,
    { ...defaultSettings(), resolution: 256, density: 0.2 },
    undefined,
    lend().lent,
  );
  const old = engine.sim;
  let freed = false;
  const destroy = old.destroy.bind(old);
  old.destroy = () => {
    freed = true;
    destroy();
  };
  const createSim = engine.backend.createSim.bind(engine.backend);
  let freedFirst: boolean | undefined;
  engine.backend.createSim = (...args) => {
    freedFirst = freed;
    return createSim(...args);
  };
  await engine.apply({ ...engine.settings, resolution: 512 });
  expect(freedFirst).toBe(true);
  expect(engine.sim.width).toBe(512);
  engine.frame(performance.now(), 2);
  expect(engine.sim.step).toBe(2);
  engine.destroy();
});

it('steps the grid down after an out-of-memory error, also back to the old size', async () => {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 180;
  const engine = await Engine.create(
    canvas,
    { ...defaultSettings(), resolution: 512, density: 0.2 },
    undefined,
    lend().lent,
  );
  const old = engine.sim;
  const createSim = engine.backend.createSim.bind(engine.backend);
  const sizes: number[] = [];
  engine.backend.createSim = (settings, ...rest) => {
    sizes.push(settings.resolution);
    if (sizes.length === 1) return Promise.reject(new OutOfMemoryError('test'));
    return createSim(settings, ...rest);
  };
  const adjusted: number[] = [];
  engine.onAdjust = (_, resolution) => adjusted.push(resolution);
  await engine.apply({ ...engine.settings, resolution: 768 });
  // 768 fails, 512 is the next lower grid: the old one was freed, so a new one must be built.
  expect(sizes).toEqual([768, 512]);
  expect(adjusted).toEqual([512]);
  expect(engine.sim).not.toBe(old);
  expect(engine.sim.width).toBe(512);
  engine.destroy();
});

/** The largest number of living agents in one cell. */
async function crowding(engine: Engine): Promise<number> {
  const { width } = engine.sim;
  const cells = new Map<number, number>();
  for (const a of await engine.sim.readAgents()) {
    if ((a.bits & 4) === 0) continue;
    const c = Math.floor(a.y) * width + Math.floor(a.x);
    cells.set(c, (cells.get(c) ?? 0) + 1);
  }
  return Math.max(...cells.values());
}

it('switching one agent per cell restarts the population, so agents stacked without the rule do not carry over (ADR 0008)', async () => {
  const canvas = document.createElement('canvas');
  canvas.width = 160;
  canvas.height = 100;
  const settings = { ...defaultSettings(), resolution: 256, density: 0.5, seed: 3 };
  const engine = await Engine.create(canvas, settings, undefined, lend().lent);
  engine.frame(performance.now(), 30);
  expect(engine.sim.step).toBe(30);
  expect(await crowding(engine)).toBeGreaterThan(1); // without the rule agents share cells
  await engine.apply({ ...engine.settings, collisions: true });
  expect(engine.sim.step).toBe(0);
  expect(await crowding(engine)).toBe(1);
  engine.frame(performance.now(), 30);
  expect(await crowding(engine)).toBe(1);
  await engine.apply({ ...engine.settings, collisions: false });
  expect(engine.sim.step).toBe(0);
  engine.destroy();
}, 120_000);

it('does not restart when a backend without the rule keeps it off', async () => {
  const canvas = document.createElement('canvas');
  canvas.width = 160;
  canvas.height = 100;
  const engine = await Engine.create(
    canvas,
    { ...defaultSettings(), resolution: 256, density: 0.5 },
    undefined,
    lend().lent,
  );
  // WebGL2 without EXT_float_blend (ADR 0003): the engine runs every scene without the rule.
  (engine.backend as { supportsCollisions: boolean }).supportsCollisions = false;
  engine.frame(performance.now(), 10);
  await engine.apply({ ...engine.settings, collisions: true });
  await engine.apply({ ...engine.settings, collisions: true, foodStrength: 0.1 });
  expect(engine.settings.collisions).toBe(false);
  expect(engine.sim.step).toBe(10);
  engine.destroy();
});

// The inoculate tool places the same amount per second of holding on a 60 Hz and a 120 Hz display (ADR 0023). Before,
// it acted once per frame with the chance of one frame at 60 Hz, so a 120 Hz display placed twice as many.
describe.each(Object.keys(BACKENDS) as Kind[])('%s: the inoculate tool', (kind) => {
  // 12,288 dead agents on 256 × 192 cells. The rate places 1 − e^(−0.1) of them in a second: about 1,169.
  const RATE = 0.1;
  const expected = 12_288 * stepChance(RATE, 1);

  async function start(collisions: boolean, paused: boolean) {
    const canvas = document.createElement('canvas');
    [canvas.width, canvas.height] = [160, 120];
    const patch = { resolution: 256, density: 0.25, layout: 'empty', boundary: 'box', collisions, seed: 8 } as const;
    const engine = await Engine.create(canvas, { ...defaultSettings(), ...patch }, undefined, lend(kind).lent);
    expect([engine.sim.width, engine.sim.height, engine.sim.agents]).toEqual([256, 192, 12_288]);
    engine.paused = paused;
    return engine;
  }

  /** Holds the tool at the centre for one second of frames at `fps`, each with `steps` steps or as the engine runs. */
  async function hold(engine: Engine, fps: number, steps?: number) {
    const tool: HeldTool = { kind: AgentToolKind.inoculate, x: 128, y: 96, radius: 30, strain: 0, rate: RATE };
    engine.frame(0, 0); // the frame before the press
    for (let k = 1; k <= fps; k++) {
      engine.agentTool(tool);
      engine.frame((k * 1000) / fps, steps);
    }
    const agents = await engine.sim.readAgents();
    const state = { agents, trail: Array.from(await engine.sim.readTrail()), step: engine.sim.step };
    engine.destroy();
    return { ...state, alive: agents.filter((a) => a.bits & 4).length };
  }

  /** Without the rule the amount is the rate's; with it, the free cells of the brush hold it back. */
  const amount = (alive: number, collisions: boolean) =>
    collisions ? alive > 0.6 * expected && alive < expected : Math.abs(alive / expected - 1) < 0.05;

  // At 120 steps per second, a frame at 60 Hz runs 2 steps and one at 120 Hz runs 1: each step gets the same chance.
  // Running, the budget gives these steps (budget.ts); here the frames ask for them.
  it.each([false, true])(
    'places the same agents at 60 and 120 frames per second at the same steps per second (collisions %s)',
    async (collisions) => {
      const slow = await hold(await start(collisions, false), 60, 2);
      const fast = await hold(await start(collisions, false), 120, 1);
      expect([slow.step, fast.step]).toEqual([120, 120]);
      expect(amount(slow.alive, collisions), `${slow.alive} of ${expected}`).toBe(true);
      expect(fast.agents).toEqual(slow.agents);
      expect(fast.trail).toEqual(slow.trail);
    },
    // Up to 82.0 s on SwiftShader in CI (#28): 360 s keeps it under a quarter (ADR 0010).
    360_000,
  );

  // Paused, a held tool runs 60 steps per second: one per frame at 60 Hz, one every other frame at 120 Hz.
  it.each([false, true])(
    'places the same agents at 60 and 120 frames per second while paused (collisions %s)',
    async (collisions) => {
      const slow = await hold(await start(collisions, true), 60);
      const fast = await hold(await start(collisions, true), 120);
      expect([slow.step, fast.step]).toEqual([60, 60]);
      expect(amount(slow.alive, collisions), `${slow.alive} of ${expected}`).toBe(true);
      expect(fast.agents).toEqual(slow.agents);
      expect(fast.trail).toEqual(slow.trail);
    },
    // Up to 56.8 s on SwiftShader in CI (#28): 300 s keeps it under a quarter (ADR 0010).
    300_000,
  );
});

/** Bytes that differ (a readable failure instead of a diff of half a million bytes). */
const differing = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length ? a.reduce((n, v, i) => n + (v === b[i] ? 0 : 1), 0) : Infinity;
const cells = (env: Uint8Array, channel: number) => env.filter((v, i) => i % 4 === channel && v !== 0).length;

// Owner report: load the Maze, change the grid, and the walls and the food were gone (ADR 0019).
describe.each(Object.keys(BACKENDS) as Kind[])('%s: food, light and walls', (kind) => {
  // 320 × 180 gives the 16:9 grids of ADR 0010 (512 × 288 at grid 512); 180 × 390 a 9:19.5 phone.
  /**
   * A preset on a canvas of `size`. A scene of Jones keeps the lattice of its figure on every screen (ADR 0026): the
   * patch `lattice: null` puts it on a grid shaped like the screen, as a pick in the panel does.
   */
  async function load(id: string, patch: Partial<Settings> = {}, size: [number, number] = [320, 180]) {
    const p = presetById(id);
    if (!p) throw new Error(`no preset ${id}`);
    const canvas = document.createElement('canvas');
    [canvas.width, canvas.height] = size;
    const s = { ...p.settings(), seed: 5, ...patch };
    const { lent, failures } = lend(kind);
    const engine = await Engine.create(canvas, s, undefined, lent);
    await engine.load(s, p.env ?? []);
    return { engine, failures };
  }

  it('survive grid, density and out-of-memory rebuilds, and come back byte for byte on the old grid', async () => {
    const { engine, failures } = await load('maze');
    expect([engine.sim.width, engine.sim.height]).toEqual([512, 288]);
    const before = await engine.sim.readEnv();
    expect(cells(before, 0)).toBeGreaterThan(1000);
    expect(cells(before, 1)).toBeGreaterThan(100);
    await engine.apply({ ...engine.settings, resolution: 256 });
    expect(engine.sim.width).toBe(256);
    const fresh = await load('maze', { resolution: 256 });
    const coarse = await fresh.engine.sim.readEnv();
    fresh.engine.destroy();
    expect(differing(await engine.sim.readEnv(), coarse)).toBe(0);
    await engine.apply({ ...engine.settings, density: 0.3 });
    expect(differing(await engine.sim.readEnv(), coarse)).toBe(0);
    // Grid 512 runs out of memory once: the engine steps down to 256 and paints the maze there.
    failures.next = 1;
    await engine.apply({ ...engine.settings, resolution: 512 });
    expect(engine.settings.resolution).toBe(256);
    expect(differing(await engine.sim.readEnv(), coarse)).toBe(0);
    await engine.apply({ ...engine.settings, resolution: 512 });
    expect(differing(await engine.sim.readEnv(), before)).toBe(0);
    engine.destroy();
  });

  // Zoomed out or moved, the view shows copies of a periodic grid around it, and a stroke there paints the grid
  // where the copy shows it (fromStroke in environment.ts). Other grids must find it there too.
  it('keep food painted on copies of a periodic grid, near and far, also on another grid', async () => {
    const { engine } = await load('network', { lattice: null, resolution: 256 });
    expect([engine.sim.width, engine.sim.height, engine.settings.boundary]).toEqual([256, 144, 'wrap']);
    // One period left of the grid, and two periods right and up.
    const strokes: Stroke[] = [
      { kind: 'food', from: [-80.37, 50.21], to: [-70.13, 52.29], radius: 4.31 },
      { kind: 'food', from: [612.43, -257.83], to: [612.43, -257.83], radius: 6.13 },
    ];
    for (const s of strokes) engine.paint(s);
    engine.frame(performance.now(), 0);
    const coarse = await engine.sim.readEnv();
    const expected = new Uint8Array(256 * 144 * 4);
    const margin = { min: Infinity };
    for (const s of strokes) paintReference(expected, 256, 144, s, 'wrap', margin);
    expect(margin.min).toBeGreaterThan(1e-3);
    expect(differing(coarse, expected)).toBe(0);
    // Twice the short side: four times the cells.
    await engine.apply({ ...engine.settings, resolution: 512 });
    const ratio = cells(await engine.sim.readEnv(), 1) / cells(coarse, 1);
    expect(ratio).toBeGreaterThan(3.6);
    expect(ratio).toBeLessThan(4.4);
    await engine.apply({ ...engine.settings, resolution: 256 });
    expect(differing(await engine.sim.readEnv(), coarse)).toBe(0);
    engine.destroy();
  });

  // The sweep deletes strokes that later strokes cleared completely on the grid on screen (sweep.ts). The simulation
  // keeps every stroke it painted and a new one paints the list: both must hold the list's bytes.
  it('match the CPU replay of the list after sweeps, and after a rebuild on another grid', async () => {
    const { engine } = await load('network', { lattice: null, resolution: 256 });
    expect([engine.sim.width, engine.sim.height, engine.settings.boundary]).toEqual([256, 144, 'wrap']);
    const list = () => (engine as unknown as { edits: EnvEdit[] }).edits;
    const paint = (kind: Stroke['kind'], from: [number, number], to: [number, number], radius: number) => {
      engine.paint({ kind, from, to, radius });
    };
    // Positions and radii on whole steps of 1/16 cell, as Engine.paint() records them (STEP).
    // Food across the periodic seam, erased completely: both go.
    paint('food', [254.375, 70.1875], [258.625, 72.4375], 3.25);
    paint('erase', [256.3125, 71.1875], [256.3125, 71.1875], 9.5);
    // A wall erased in part by a drag: all stay. (Radii chosen so that no cell lies within 1e-3 of a brush's edge on
    // either grid, where float32 may decide it otherwise.)
    paint('wall', [40.3125, 30.25], [120.6875, 34.1875], 2);
    for (let x = 30.125; x < 80; x += 6) paint('erase', [x, 31.375], [x + 6, 32.375], 3.9375);
    // Light under a wall that covers every lit cell: the light goes.
    paint('light', [180.375, 100.3125], [180.375, 100.3125], 5.25);
    paint('wall', [180.4375, 100.3125], [181.3125, 100.6875], 7.3125);
    paint('food', [60.3125, 110.375], [70.4375, 112.1875], 4.0625);
    engine.frame(performance.now(), 0);
    expect(list().map((e) => e.kind)).toEqual(['wall', ...Array<string>(9).fill('erase'), 'wall', 'food']);
    const check = async () => {
      const { width: w, height: h } = engine.sim;
      const expected = new Uint8Array(w * h * 4);
      const margin = { min: Infinity };
      for (const e of list()) {
        const s = strokeOn(e, w, h);
        if (s) paintReference(expected, w, h, s, e.boundary, margin);
      }
      expect(margin.min).toBeGreaterThan(1e-3);
      expect(cells(expected, 0)).toBeGreaterThan(100);
      expect(differing(await engine.sim.readEnv(), expected)).toBe(0);
    };
    await check();
    await engine.apply({ ...engine.settings, resolution: 512 });
    expect(engine.sim.width).toBe(512);
    await check();
    engine.destroy();
  });

  // A later erase or wall with an edit's own segment and at least its radius clears every cell the edit paints, by
  // the same distance and comparison in both passes (sweep.ts coversExactly): the sweep deletes the edit without
  // SLACK. Each edit is painted before the stroke over it, and brush edges lie exactly on cell centres.
  it('lose a stroke under a later one with its segment, with brush edges on cell centres', async () => {
    const { engine } = await load('three-strains', { resolution: 512, boundary: 'box' }, [320, 200]);
    expect([engine.sim.width, engine.sim.height]).toEqual([512, 320]);
    const list = () => (engine as unknown as { edits: EnvEdit[] }).edits;
    const twice = (
      s: Stroke['kind'],
      c: Stroke['kind'],
      from: [number, number],
      to: [number, number],
      r: number,
      rc = r,
    ) => {
      engine.paint({ kind: s, from, to, radius: r });
      engine.frame(performance.now(), 0);
      engine.paint({ kind: c, from, to, radius: rc });
      engine.frame(performance.now(), 0);
    };
    // 12 cells lie exactly 5 cells from a cell centre, and two rows exactly 3 cells from a segment along a row.
    twice('food', 'erase', [100.5, 100.5], [100.5, 100.5], 5);
    twice('wall', 'erase', [130.5, 100.5], [130.5, 100.5], 5);
    twice('light', 'erase', [160.5, 100.5], [160.5, 100.5], 5);
    twice('food', 'erase', [180.5, 140.5], [220.5, 140.5], 3);
    // A wall clears food and light; the wall stays (its radius has no cell within 1e-3 cells of its edge).
    twice('food', 'wall', [190.5, 100.5], [190.5, 100.5], 5, 5.3);
    twice('light', 'wall', [220.5, 100.5], [220.5, 100.5], 5, 5.3);
    // A box erase over a dish food, a periodic erase over a box food.
    await engine.apply({ ...engine.settings, boundary: 'dish' });
    engine.paint({ kind: 'food', from: [300.5, 160.5], to: [300.5, 160.5], radius: 5 });
    engine.frame(performance.now(), 0);
    await engine.apply({ ...engine.settings, boundary: 'box' });
    twice('food', 'erase', [340.5, 160.5], [340.5, 160.5], 5);
    engine.paint({ kind: 'erase', from: [300.5, 160.5], to: [300.5, 160.5], radius: 5 });
    engine.frame(performance.now(), 0);
    engine.paint({ kind: 'food', from: [380.5, 160.5], to: [380.5, 160.5], radius: 5 });
    engine.frame(performance.now(), 0);
    await engine.apply({ ...engine.settings, boundary: 'wrap' });
    engine.paint({ kind: 'erase', from: [380.5, 160.5], to: [380.5, 160.5], radius: 5 });
    engine.frame(performance.now(), 0);
    expect(list().map((e) => e.kind)).toEqual(['wall', 'wall']);
    const check = async () => {
      const { width: w, height: h } = engine.sim;
      const expected = new Uint8Array(w * h * 4);
      const margin = { min: Infinity };
      for (const e of list()) {
        const s = strokeOn(e, w, h);
        if (s) paintReference(expected, w, h, s, e.boundary, margin);
      }
      expect(margin.min).toBeGreaterThan(1e-3);
      expect(cells(expected, 0)).toBeGreaterThan(30);
      expect(differing(await engine.sim.readEnv(), expected)).toBe(0);
    };
    await check();
    await engine.apply({ ...engine.settings, resolution: 256 });
    await check();
    engine.destroy();
  });

  /**
   * Cells of the arena where the renderer's outlines (ADR 0009) disagree with `env`: wall or food on the other side
   * of the outline, an outline farther than the nearest cell of its layer (paint.wgsl `floorByte`), another light,
   * or a drop shadow more than 1 off the share of wall cells under its cone (paint.wgsl `shadowByte`).
   */
  async function disagreements(engine: Engine) {
    const { sim, settings } = engine;
    const [env, shape] = [await sim.readEnv(), await sim.readShape()];
    const { width: w, height: h } = sim;
    const { boundary } = settings;
    const inDish = (x: number, y: number) => Math.hypot(x + 0.5 - w / 2, y + 0.5 - h / 2) <= dishRadius(w, h);
    const holds = (x: number, y: number, ch: number) => {
      if (boundary === 'wrap') [x, y] = [((x % w) + w) % w, ((y % h) + h) % h];
      else if (x < 0 || y < 0 || x >= w || y >= h || (boundary === 'dish' && !inDish(x, y))) return false;
      return (env[(y * w + x) * 4 + ch] ?? 0) >= 128;
    };
    const isWall = (x: number, y: number) => holds(x, y, 0);
    // The byte of d cells outside, with the nearest cell of the layer d cells away.
    const floor = (x: number, y: number, ch: number) => {
      let near = Infinity;
      for (let dy = -3; dy <= 3; dy++)
        for (let dx = -3; dx <= 3; dx++)
          if ((dx || dy) && holds(x + dx, y + dy, ch)) near = Math.min(near, Math.hypot(dx, dy));
      return Math.round((Math.min(1, Math.max(-1, -near / 4)) * 0.5 + 0.5) * 255);
    };
    const wrong: string[] = [];
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (boundary === 'dish' && !inDish(x, y)) continue;
        const i = (y * w + x) * 4;
        for (const ch of [0, 1]) {
          const [e, s] = [env[i + ch] ?? 0, shape[i + ch] ?? 0];
          if (e >= 128 !== s >= 128) wrong.push(`layer ${ch} at ${x},${y}`);
          else if (e < 128 && s < floor(x, y, ch))
            wrong.push(`layer ${ch} at ${x},${y}: ${s} below ${floor(x, y, ch)}`);
        }
        if (shape[i + 2] !== env[i + 2]) wrong.push(`light at ${x},${y}`);
        const [sx, sy] = [x + 0.5 - 1.08, y + 0.5 - 1.44];
        let [sum, all] = [0, 0];
        for (let dy = -2; dy <= 2; dy++)
          for (let dx = -2; dx <= 2; dx++) {
            const [kx, ky] = [Math.floor(sx) + dx, Math.floor(sy) + dy];
            const weight = Math.max(1 - Math.hypot(kx + 0.5 - sx, ky + 0.5 - sy) / 1.5, 0);
            all += weight;
            if (isWall(kx, ky)) sum += weight;
          }
        if (Math.abs((shape[i + 3] ?? 0) - Math.round((sum / all) * 255)) > 1) wrong.push(`shadow at ${x},${y}`);
      }
    return wrong;
  }

  /** The engine's edit list (ADR 0019). */
  const editsOf = (engine: Engine) => (engine as unknown as { edits: EnvEdit[] }).edits;

  /**
   * Expects the simulation's `env` and outlines to be the bytes of the edit list painted one call per edit on a new
   * simulation of the same grid and settings: a replay paints the list in one call of Sim.paint (Engine.flushEnv()).
   */
  async function expectPerStroke(engine: Engine) {
    const { width: w, height: h } = engine.sim;
    const sim = await engine.backend.createSim(engine.settings, w, h, 1);
    for (const e of editsOf(engine)) {
      const s = strokeOn(e, w, h);
      if (s) sim.paint([s]);
    }
    const [env, shape] = [await sim.readEnv(), await sim.readShape()];
    sim.destroy();
    expect(differing(await engine.sim.readEnv(), env)).toBe(0);
    expect(differing(await engine.sim.readShape(), shape)).toBe(0);
  }

  /** Runs `fn` while `proto[key]` also records its first argument in `used`, and restores it after. */
  async function recording(proto: object, key: string, used: Set<unknown>, fn: () => Promise<unknown>) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, key);
    const original = descriptor?.value as ((this: unknown, ...args: unknown[]) => unknown) | undefined;
    if (!descriptor || !original) throw new Error(`no ${key}`);
    Object.defineProperty(proto, key, {
      ...descriptor,
      value(this: unknown, ...args: unknown[]) {
        used.add(args[0]);
        return original.apply(this, args);
      },
    });
    try {
      await fn();
    } finally {
      Object.defineProperty(proto, key, descriptor);
    }
  }

  /** Whether a capture draws with the variant of the render pass that has the environment code (ADR 0009, item 9). */
  async function drawsEnv(engine: Engine): Promise<boolean> {
    const used = new Set<unknown>();
    let variants: readonly unknown[];
    if (kind === 'webgpu') {
      await recording(GPURenderPassEncoder.prototype, 'setPipeline', used, () => engine.capture());
      variants = (engine.backend as unknown as { renderer: { pipelines: readonly unknown[] } }).renderer.pipelines;
    } else {
      await recording(WebGL2RenderingContext.prototype, 'useProgram', used, () => engine.capture());
      const { render } = (engine.backend as unknown as { prog: { render: readonly { program: WebGLProgram }[] } }).prog;
      variants = render.map((p) => p.program);
    }
    const [without, withEnv] = [used.has(variants[0]), used.has(variants[1])];
    expect(without !== withEnv).toBe(true);
    return withEnv;
  }

  /** Overwrites the renderer's outlines with zeros: far outside every outline, no light, no shadow. */
  function blankOutlines(engine: Engine) {
    const sim = engine.sim;
    const zeros = new Uint8Array(sim.width * sim.height * 4);
    if (kind === 'webgpu') {
      const s = sim as Simulation;
      s.device.queue.writeBuffer(s.shape, 0, zeros);
    } else {
      const gl = (engine.backend as unknown as { gl: WebGL2RenderingContext }).gl;
      gl.bindTexture(gl.TEXTURE_2D, (sim as GlSim).shapeTexture);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, sim.width, sim.height, gl.RGBA, gl.UNSIGNED_BYTE, zeros);
    }
  }

  /** The largest difference of one channel between two captures. */
  const maxDiff = (a: ImageData, b: ImageData) =>
    a.data.reduce((m, v, i) => (i % 4 === 3 ? m : Math.max(m, Math.abs(v - (b.data[i] ?? 0)))), 0);

  // Every new simulation replays the edits through Sim.paint, which writes `env` and the outlines together.
  it('replay the outlines with env on another grid, and draw them with the environment pass', async () => {
    const { engine } = await load('maze');
    expect(engine.sim.hasEnvironment).toBe(true);
    expect(await disagreements(engine)).toEqual([]);
    await engine.apply({ ...engine.settings, resolution: 768 });
    expect(engine.sim.width).toBe(768);
    expect(engine.sim.hasEnvironment).toBe(true);
    expect(await disagreements(engine)).toEqual([]);
    // The renderer of the rebuilt simulation reads the outlines: without them the walls and the food are gone.
    const drawn = await engine.capture();
    blankOutlines(engine);
    expect(maxDiff(drawn, await engine.capture())).toBeGreaterThan(40);
    engine.clearEnvironment();
    expect(engine.sim.hasEnvironment).toBe(false);
    expect((await engine.sim.readShape()).every((v) => v === 0)).toBe(true);
    engine.destroy();
  });

  // A switch between the dish and a box builds a new simulation, which paints every edit through the frame of the
  // arena it was painted in (ADR 0019); edits painted under the dish keep its clip, and the outlines follow `env` under
  // the arena on screen. A switch between a box and the periodic grid keeps the simulation and its `env`.
  it('keep the outlines on the side of env across arena switches from the dish to a box and back', async () => {
    const { engine } = await load('shrinking');
    const [w, h] = [engine.sim.width, engine.sim.height];
    const rim = dishRadius(w, h);
    const strokes: Stroke[] = [
      // Across the rim: the dish clips it, and its shadow falls on cells outside the dish, which a box shows.
      { kind: 'wall', from: [w * 0.5 + rim - 20, h * 0.5 - 4], to: [w * 0.5 + rim + 20, h * 0.5 - 4], radius: 2.2 },
      { kind: 'wall', from: [w * 0.5 - 30, h * 0.5], to: [w * 0.5 + 30, h * 0.5 + 12], radius: 2.2 },
      { kind: 'food', from: [w * 0.5 + 60, h * 0.5 - 70], to: [w * 0.5 + 140, h * 0.5 - 90], radius: 9 },
      { kind: 'erase', from: [w * 0.5, h * 0.5 + 4], to: [w * 0.5 + 4, h * 0.5 + 6], radius: 5 },
      { kind: 'light', from: [w * 0.5 - 60, h * 0.5 + 50], to: [w * 0.5 - 60, h * 0.5 + 50], radius: 7 },
    ];
    for (const s of strokes) engine.paint(s);
    engine.frame(performance.now(), 0);
    expect(await disagreements(engine)).toEqual([]);
    for (const boundary of ['box', 'wrap', 'box', 'dish'] as const) {
      const before = engine.sim;
      const rebuilt = (boundary === 'dish') !== (engine.settings.boundary === 'dish');
      await engine.apply({ ...engine.settings, boundary });
      expect(engine.sim !== before).toBe(rebuilt);
      expect(engine.sim.hasEnvironment).toBe(true);
      expect(await disagreements(engine), boundary).toEqual([]);
      // Under the box: food across the corner of the grid, which the dish later leaves outside, and a wall along the
      // right edge, whose shadow falls across that edge onto the left one on the periodic grid (paint.wgsl
      // `shadowByte`: the cone lies up and to the left of a cell).
      if (boundary === 'box' && rebuilt) {
        engine.paint({ kind: 'food', from: [6, 6], to: [30, 12], radius: 6 });
        engine.paint({ kind: 'wall', from: [w - 1.5, 40], to: [w - 1.5, h - 40], radius: 2.2 });
        engine.frame(performance.now(), 0);
        expect(await disagreements(engine)).toEqual([]);
      }
    }
    // The last switch replayed edits of the dish and of the box in one call: the bytes of one call per edit.
    expect(new Set(editsOf(engine).map((e) => e.boundary))).toEqual(new Set(['dish', 'box']));
    await expectPerStroke(engine);
    engine.destroy();
  }, 120_000);

  // The sweep deletes edits that later strokes cleared on the grid on screen and changes no byte there, also when it
  // completes over frames (Engine.sweepFor()); a new grid replays what is left in one call (ADR 0019).
  it('keep the outlines on the side of env after sweeps, also over frames, and on a new grid', async () => {
    const { engine } = await load('three-strains', { resolution: 512, boundary: 'box' }, [320, 200]);
    expect([engine.sim.width, engine.sim.height]).toEqual([512, 320]);
    const paint = (kind: Stroke['kind'], from: [number, number], to: [number, number], radius: number) => {
      engine.paint({ kind, from, to, radius });
      engine.frame(performance.now(), 0);
    };
    // Food erased completely: both go. A wall erased in part: all stay. Light under a wall that covers every lit
    // cell: the light goes.
    paint('food', [60.31, 60.73], [80.17, 64.29], 4.37);
    paint('erase', [70.23, 62.41], [70.23, 62.41], 16.13);
    paint('wall', [120.41, 40.27], [220.71, 52.93], 2.61);
    paint('erase', [150.33, 44.17], [170.29, 47.31], 5.23);
    paint('light', [300.43, 80.37], [300.43, 80.37], 6.11);
    paint('wall', [300.29, 80.13], [301.17, 80.63], 8.31);
    paint('food', [400.37, 200.23], [420.61, 210.47], 5.41);
    expect(engine.swept).toBe(true);
    expect(editsOf(engine).map((e) => e.kind)).toEqual(['wall', 'erase', 'wall', 'food']);
    expect(await disagreements(engine)).toEqual([]);
    // Food dabs in one frame, then an eraser over most of them: its sweep waits for the frames after the stroke.
    let seed = 7;
    const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    for (let k = 0; k < 400; k++) {
      const at: [number, number] = [20 + rand() * 200, 120 + rand() * 180];
      engine.paint({ kind: 'food', from: at, to: at, radius: 2 + rand() * 4 });
    }
    engine.frame(performance.now(), 0);
    engine.paint({ kind: 'erase', from: [120.3, 210.7], to: [120.3, 210.7], radius: 80.3 });
    expect(engine.swept).toBe(false);
    const waiting = editsOf(engine).length;
    engine.frame(performance.now(), 0);
    expect(await disagreements(engine)).toEqual([]);
    while (!engine.swept) engine.frame(performance.now(), 0);
    expect(editsOf(engine).length).toBeLessThan(waiting - 100);
    expect(await disagreements(engine)).toEqual([]);
    await engine.apply({ ...engine.settings, resolution: 256 });
    expect(engine.sim.width).toBe(256);
    expect(await disagreements(engine)).toEqual([]);
    await expectPerStroke(engine);
    engine.destroy();
  });

  // A preset load puts the scene's shapes in place of every edit: on the same grid the simulation clears its
  // environment and paints them in one call, on another grid or under the dish a new simulation paints them.
  it('keep the outlines on the side of env after a preset load, on the same grid and on a new one', async () => {
    const { engine } = await load('network', { lattice: null, resolution: 512, density: 0.12 });
    engine.paint({ kind: 'food', from: [100.3, 100.7], to: [160.1, 120.4], radius: 9.3 });
    engine.paint({ kind: 'wall', from: [300.2, 40.6], to: [310.4, 240.3], radius: 3.1 });
    engine.frame(performance.now(), 0);
    for (const id of ['maze', 'light', 'shrinking']) {
      const p = presetById(id);
      if (!p) throw new Error(`no preset ${id}`);
      const before = engine.sim;
      await engine.load({ ...p.settings(), seed: 5, resolution: 512 }, p.env ?? []);
      // The Maze runs on the grid and the density of before (512, 0.12): no new simulation.
      expect(engine.sim === before, id).toBe(id === 'maze');
      expect(engine.sim.hasEnvironment).toBe(true);
      expect(await disagreements(engine), id).toEqual([]);
      await expectPerStroke(engine);
    }
    engine.destroy();
  });

  // The renderer draws food, light and walls only with the pass that has the environment code (ADR 0009, item 9).
  it('count every new simulation that replays food, light or walls as painted and draw it with the environment pass', async () => {
    const { engine } = await load('network', { lattice: null, resolution: 256 });
    expect([engine.sim.hasEnvironment, await drawsEnv(engine)]).toEqual([false, false]);
    for (const k of ['food', 'light', 'wall'] as const) {
      engine.paint({ kind: k, from: [100.3, 70.2], to: [110.4, 72.1], radius: 4.2 });
      engine.frame(performance.now(), 0);
      const before = engine.sim;
      await engine.apply({ ...engine.settings, resolution: engine.settings.resolution === 256 ? 512 : 256 });
      expect(engine.sim).not.toBe(before);
      expect(engine.sim.hasEnvironment, k).toBe(true);
      expect(await drawsEnv(engine), k).toBe(true);
      expect(await disagreements(engine), k).toEqual([]);
      engine.clearEnvironment();
      expect(engine.sim.hasEnvironment, k).toBe(false);
      expect(await drawsEnv(engine), k).toBe(false);
      expect((await engine.sim.readShape()).every((v) => v === 0)).toBe(true);
    }
    // An eraser alone leaves nothing to draw, also on a new simulation.
    engine.paint({ kind: 'erase', from: [100.3, 70.2], to: [110.4, 72.1], radius: 4.2 });
    engine.frame(performance.now(), 0);
    await engine.apply({ ...engine.settings, resolution: 512 });
    expect([engine.sim.hasEnvironment, await drawsEnv(engine)]).toEqual([false, false]);
    engine.destroy();
  });

  // Every alive agent on its own free cell from the first step (ADR 0008), in the scenes with walls or a dish. An
  // agent that finds no free cell in the claim rounds starts dead: in the full dish of Shrinking plasmodium one in
  // a few runs out of a hundred (ADR 0019).
  it.each([
    ['maze', 320, 180],
    ['maze', 180, 390],
    ['shortest-path', 320, 180],
    ['shortest-path', 180, 390],
    ['steiner', 320, 180],
    ['steiner', 180, 390],
    ['shrinking', 320, 180],
    ['shrinking', 180, 390],
  ] as const)('start %s (%i × %i canvas) with every alive agent on a free cell of its own', async (id, w, h) => {
    const { engine } = await load(id, {}, [w, h]);
    const { width, height } = engine.sim;
    const env = await engine.sim.readEnv();
    const dish = engine.settings.boundary === 'dish';
    const per = new Map<number, number>();
    let [dead, blocked] = [0, 0];
    for (const a of await engine.sim.readAgents()) {
      if (!(a.bits & 4)) {
        dead++;
        continue;
      }
      const [x, y] = [Math.floor(a.x), Math.floor(a.y)];
      const c = y * width + x;
      const outside = dish && Math.hypot(x + 0.5 - width / 2, y + 0.5 - height / 2) > dishRadius(width, height);
      if (outside || (env[c * 4] ?? 0) >= 128) blocked++;
      per.set(c, (per.get(c) ?? 0) + 1);
    }
    const shared = [...per.values()].filter((k) => k > 1).length;
    expect(blocked).toBe(0);
    expect(dead).toBeLessThanOrEqual(Math.floor(1e-4 * engine.sim.agents));
    // A backend without the rule (WebGL2 without EXT_float_blend) runs the scene with shared cells.
    if (engine.settings.collisions) expect(shared).toBe(0);
    engine.destroy();
  });
});
