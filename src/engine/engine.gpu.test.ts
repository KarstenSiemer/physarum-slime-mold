// Engine behavior in a real browser (ADR 0010).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultSettings, type Settings } from '../model/params';
import { presetById } from '../model/presets';
import { Engine } from './engine';
import { WebGl2Backend } from './gl/backend';
import { OutOfMemoryError } from './gpu';
import { paintReference } from './paint-reference';
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
}, 180_000);
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
});

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

/** Bytes that differ (a readable failure instead of a diff of half a million bytes). */
const differing = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length ? a.reduce((n, v, i) => n + (v === b[i] ? 0 : 1), 0) : Infinity;
const cells = (env: Uint8Array, channel: number) => env.filter((v, i) => i % 4 === channel && v !== 0).length;

// Owner report: load the Maze, change the grid, and the walls and the food were gone (ADR 0019).
describe.each(Object.keys(BACKENDS) as Kind[])('%s: food, light and walls', (kind) => {
  // 320 × 180 gives the 16:9 grids of ADR 0010 (512 × 288 at grid 512); 180 × 390 a 9:19.5 phone.
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
    const { engine } = await load('network', { resolution: 256 });
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

  // Every agent on its own free cell from the first step (ADR 0008), in the scenes with walls or a dish.
  it.each([
    ['maze', 320, 180],
    ['maze', 180, 390],
    ['shortest-path', 320, 180],
    ['shortest-path', 180, 390],
    ['steiner', 320, 180],
    ['steiner', 180, 390],
    ['shrinking', 320, 180],
    ['shrinking', 180, 390],
  ] as const)('start %s (%i × %i canvas) with every agent alive on a free cell of its own', async (id, w, h) => {
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
      const outside = dish && Math.hypot(x + 0.5 - width / 2, y + 0.5 - height / 2) > Math.min(width, height) / 2 - 1;
      if (outside || (env[c * 4] ?? 0) >= 128) blocked++;
      per.set(c, (per.get(c) ?? 0) + 1);
    }
    const shared = [...per.values()].filter((k) => k > 1).length;
    expect({ dead, blocked }).toEqual({ dead: 0, blocked: 0 });
    // A backend without the rule (WebGL2 without EXT_float_blend) runs the scene with shared cells.
    if (engine.settings.collisions) expect(shared).toBe(0);
    engine.destroy();
  });
});
