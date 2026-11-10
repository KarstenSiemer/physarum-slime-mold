// The engine keeps food, light and walls across new simulations (ADR 0019), checked in Node with a CPU backend
// whose painting mirrors the shaders (paint-reference.ts; sim.gpu.test.ts compares it with both GPU backends).
import { describe, expect, it } from 'vitest';
import { defaultSettings, type Settings } from '../model/params';
import { presetById } from '../model/presets';
import { Engine } from './engine';
import { fromStroke, strokeOn } from './environment';
import { OutOfMemoryError } from './gpu';
import { paintReference } from './paint-reference';
import type { Backend, Sim, Stroke } from './types';

class CpuSim implements Sim {
  step = 0;
  readonly env: Uint8Array;
  /** Calls in order, to check that the environment is painted before the agents are placed. */
  readonly calls: string[] = [];

  constructor(
    private settings: Settings,
    readonly width: number,
    readonly height: number,
    readonly agents: number,
  ) {
    this.env = new Uint8Array(width * height * 4);
  }
  update(s: Settings) {
    this.settings = s;
  }
  reset() {
    this.calls.push('reset');
  }
  run(steps: number) {
    this.step += steps;
  }
  paint(strokes: readonly Stroke[]) {
    for (const s of strokes) {
      this.calls.push('paint');
      paintReference(this.env, this.width, this.height, s, this.settings.boundary);
    }
  }
  clearEnvironment() {
    this.calls.push('clear');
    this.env.fill(0);
  }
  destroy() {
    this.calls.push('destroy');
  }
  finish() {
    return Promise.resolve();
  }
  alive() {
    return Promise.resolve([]);
  }
  readAgents() {
    return Promise.resolve([]);
  }
  readTrail() {
    return Promise.resolve(new Float32Array(0));
  }
  readCounts() {
    return Promise.resolve(new Float32Array(0));
  }
  readEnv() {
    return Promise.resolve(this.env.slice());
  }
  writeAgent() {
    // agents are not simulated here
  }
  writeTrail() {
    // trails are not simulated here
  }
  writeEnv(data: Uint8Array) {
    this.env.set(data);
  }
}

class CpuBackend implements Backend<CpuSim> {
  readonly kind = 'webgpu';
  readonly description = 'CPU test backend';
  readonly maxAgents = 2 ** 24;
  readonly maxBufferBytes = 2 ** 30;
  readonly maxGridSide = 8192;
  bytesPerCell = 86;
  readonly supportsCollisions = true;
  readonly lost = new Promise<string>(() => undefined);
  /** Runs before the next allocation only: a test can hold it or make it fail. */
  before: (() => Promise<void>) | undefined;
  /** Every simulation built, in order. */
  readonly built: CpuSim[] = [];

  async createSim(settings: Settings, width: number, height: number, agents: number) {
    const hook = this.before;
    this.before = undefined;
    await hook?.();
    const sim = new CpuSim(settings, width, height, agents);
    sim.reset(); // like Simulation.create and the GlSim constructor
    this.built.push(sim);
    return sim;
  }
  draw() {
    // nothing to show
  }
  capture(): Promise<ImageData> {
    return Promise.reject(new Error('not available in Node'));
  }
  settle() {
    return Promise.resolve({ gain: 0, black: 0 });
  }
  forget() {
    // no caches
  }
  destroy() {
    // nothing to free
  }
}

/** Holds the backend's next allocation until the returned function is called. */
function hold(backend: CpuBackend) {
  let release: () => void = () => {
    throw new Error('not held');
  };
  backend.before = () =>
    new Promise<void>((r) => {
      release = r;
    });
  return () => {
    release();
  };
}

// 16:10, like a laptop window: a 512 grid has 512 × 320 cells.
const canvas = (width = 1600, height = 1000) => ({ width, height }) as HTMLCanvasElement;
const maze = presetById('maze');
const three = presetById('three-strains');
const shrinking = presetById('shrinking');
if (!maze?.env || !three || !shrinking?.env) throw new Error('presets missing');
const mazeEnv = maze.env;

async function engineWith(settings: Settings, env = mazeEnv, c = canvas(), backend = new CpuBackend()) {
  const engine = await Engine.create(c, settings, undefined, backend);
  await engine.load(settings, env);
  return { engine, backend, sim: () => engine.sim as CpuSim };
}

const count = (env: Uint8Array, channel: number) => env.filter((v, i) => i % 4 === channel && v !== 0).length;
/** Bytes that differ (a readable failure instead of a diff of millions of bytes). */
const differing = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length ? a.reduce((n, v, i) => n + (v === b[i] ? 0 : 1), 0) : Infinity;
const empty = (env: Uint8Array) => count(env, 0) + count(env, 1) + count(env, 2) === 0;

describe('food, light and walls on a new simulation', () => {
  it('survive a grid change and come back byte for byte on the old grid', async () => {
    const { engine, sim } = await engineWith(maze.settings());
    expect([sim().width, sim().height]).toEqual([512, 320]);
    const before = sim().env.slice();
    expect(count(before, 0)).toBeGreaterThan(1000);
    expect(count(before, 1)).toBeGreaterThan(100);
    // The grid select in the panel, and the startup check, which lowers the grid the same way (App.svelte).
    await engine.apply({ ...engine.settings, resolution: 1024 });
    expect(sim().width).toBe(1024);
    // The same as loading the maze on this grid.
    const fresh = await engineWith({ ...maze.settings(), resolution: 1024 });
    expect(differing(sim().env, fresh.sim().env)).toBe(0);
    await engine.apply({ ...engine.settings, resolution: 512 });
    expect(differing(sim().env, before)).toBe(0);
  });

  it('survive density changes and the density cap of collision mode', async () => {
    const { engine, sim } = await engineWith(maze.settings());
    const before = sim().env.slice();
    const first = sim();
    await engine.apply({ ...engine.settings, density: 0.3 });
    expect(sim()).not.toBe(first); // a new simulation
    expect(differing(sim().env, before)).toBe(0);

    // Three strains: 3 agents per cell; collisions cap that at 1, which needs a new simulation.
    const t = await engineWith(three.settings(), []);
    t.engine.paint({ kind: 'food', from: [700, 400], to: [800, 450], radius: 9 });
    t.engine.frame(0, 0);
    const painted = t.sim().env.slice();
    expect(count(painted, 1)).toBeGreaterThan(100);
    const old = t.sim();
    await t.engine.apply({ ...t.engine.settings, collisions: true });
    expect(t.engine.settings.density).toBe(1);
    expect(t.sim()).not.toBe(old);
    expect(differing(t.sim().env, painted)).toBe(0);
  });

  it('survive the step-down after an out-of-memory error', async () => {
    const { engine, backend, sim } = await engineWith(maze.settings());
    backend.before = () => Promise.reject(new OutOfMemoryError('test'));
    await engine.apply({ ...engine.settings, resolution: 1024 });
    expect(engine.settings.resolution).toBe(768);
    const fresh = await engineWith({ ...maze.settings(), resolution: 768 });
    expect(differing(sim().env, fresh.sim().env)).toBe(0);
  });

  it('survive the memory fit, also when the canvas changed shape before a later setting change', async () => {
    // 1000 bytes per cell: the 512 MiB budget holds 768 × 480 but not 1024 × 640, nor 768 × 768.
    const backend = new CpuBackend();
    backend.bytesPerCell = 1000;
    const c = canvas();
    const { engine, sim } = await engineWith(maze.settings(), mazeEnv, c, backend);
    await engine.apply({ ...engine.settings, resolution: 1024 });
    expect([sim().width, sim().height]).toEqual([768, 480]);
    const fresh = await engineWith({ ...maze.settings(), resolution: 768 });
    expect(differing(sim().env, fresh.sim().env)).toBe(0);
    // The window turns square. Nothing is rebuilt until a setting changes; then the fit lowers the grid to 512.
    [c.width, c.height] = [1000, 1000];
    await engine.apply({ ...engine.settings, speed: 60 });
    expect([sim().width, sim().height]).toEqual([512, 512]);
    const square = await engineWith(maze.settings(), mazeEnv, canvas(1000, 1000));
    expect(differing(sim().env, square.sim().env)).toBe(0);
  });

  it('survive a switch between the dish and another arena, which changes the agent count', async () => {
    const { engine, sim } = await engineWith(shrinking.settings(), shrinking.env);
    const before = sim().env.slice();
    const agents = sim().agents;
    expect(agents).toBe(Math.round(0.5 * 320 * 320)); // the dish counts the square of the short side
    await engine.apply({ ...engine.settings, boundary: 'box' });
    expect(sim().agents).toBe(Math.round(0.5 * 512 * 320));
    // Painted under the dish's boundary, the food stays as it was.
    expect(differing(sim().env, before)).toBe(0);
    await engine.apply({ ...engine.settings, boundary: 'dish' });
    expect(sim().agents).toBe(agents);
    expect(differing(sim().env, before)).toBe(0);
  });

  it('move painted strokes with the grid, by the ratio of the short sides', async () => {
    const { engine, sim } = await engineWith(maze.settings(), []);
    const stroke: Stroke = { kind: 'wall', from: [100.25, 40.5], to: [300.75, 200.25], radius: 3 };
    engine.paint(stroke);
    engine.frame(0, 0);
    await engine.apply({ ...engine.settings, resolution: 1024 });
    const expected = new Uint8Array(1024 * 640 * 4);
    paintReference(expected, 1024, 640, { ...stroke, from: [200.5, 81], to: [601.5, 400.5], radius: 6 }, 'box');
    expect(differing(sim().env, expected)).toBe(0);
  });

  it('turn painted strokes and preset shapes with the screen, and back', async () => {
    const c = canvas();
    const { engine, sim } = await engineWith(maze.settings(), mazeEnv, c);
    engine.paint({ kind: 'food', from: [60, 250], to: [90, 260], radius: 5 });
    engine.frame(0, 0);
    const wide = sim().env.slice();
    [c.width, c.height] = [1000, 1600]; // a phone turned upright: the next grid is 320 × 512
    await engine.apply({ ...engine.settings, density: 0.2 });
    expect([sim().width, sim().height]).toEqual([320, 512]);
    const expected = new Uint8Array(320 * 512 * 4);
    for (const e of mazeEnv) {
      const s = strokeOn({ kind: e.kind, from: e.at, to: e.to ?? e.at, radius: e.r, boundary: 'box' }, 320, 512);
      if (s) paintReference(expected, 320, 512, s, 'box');
    }
    const food = strokeOn(
      fromStroke({ kind: 'food', from: [60, 250], to: [90, 260], radius: 5 }, [512, 320], 'box'),
      320,
      512,
    );
    if (food) paintReference(expected, 320, 512, food, 'box');
    expect(differing(sim().env, expected)).toBe(0);
    [c.width, c.height] = [1600, 1000];
    await engine.apply({ ...engine.settings, density: 0.12 });
    expect(differing(sim().env, wide)).toBe(0);
  });

  it('skip an edit outside the new grid and paint it again where it fits', async () => {
    const c = canvas();
    const { engine, sim } = await engineWith(maze.settings(), [], c);
    engine.paint({ kind: 'food', from: [6, 100], to: [6, 100], radius: 4 }); // near the left edge of 512 × 320
    engine.frame(0, 0);
    const wide = sim().env.slice();
    [c.width, c.height] = [1000, 1000];
    await engine.apply({ ...engine.settings, density: 0.2 });
    expect(empty(sim().env)).toBe(true);
    [c.width, c.height] = [1600, 1000];
    await engine.apply({ ...engine.settings, density: 0.12 });
    expect(differing(sim().env, wide)).toBe(0);
  });

  it('put a stroke drawn while the new grid is allocated where it was drawn', async () => {
    const { engine, backend, sim } = await engineWith(maze.settings(), []);
    const release = hold(backend);
    const rebuilt = engine.apply({ ...engine.settings, resolution: 1024 });
    // The view still shows the 512 × 320 grid: this is its centre.
    engine.paint({ kind: 'food', from: [256, 160], to: [256, 160], radius: 4 });
    release();
    await rebuilt;
    const expected = new Uint8Array(1024 * 640 * 4);
    paintReference(expected, 1024, 640, { kind: 'food', from: [512, 320], to: [512, 320], radius: 8 }, 'box');
    expect(differing(sim().env, expected)).toBe(0);
  });

  it('stay cleared when they are cleared during a rebuild', async () => {
    const { engine, backend, sim } = await engineWith(maze.settings());
    const release = hold(backend);
    const rebuilt = engine.apply({ ...engine.settings, resolution: 1024 });
    engine.clearEnvironment();
    release();
    await rebuilt;
    expect(empty(sim().env)).toBe(true);
    await engine.apply({ ...engine.settings, resolution: 512 });
    expect(empty(sim().env)).toBe(true);
  });

  it('are not painted after Clear when the stroke came in the same frame before it', async () => {
    const { engine, sim } = await engineWith(maze.settings(), []);
    engine.paint({ kind: 'wall', from: [100, 100], to: [300, 100], radius: 3 });
    engine.clearEnvironment();
    engine.frame(0, 0);
    expect(empty(sim().env)).toBe(true);
  });

  it('keep the boundary they were painted under', async () => {
    // The maze is a closed box: its walls end at the top and bottom edge instead of wrapping around.
    const { engine, sim } = await engineWith(maze.settings());
    const before = sim().env.slice();
    await engine.apply({ ...engine.settings, boundary: 'wrap' });
    await engine.apply({ ...engine.settings, resolution: 1024 });
    await engine.apply({ ...engine.settings, resolution: 512 });
    expect(differing(sim().env, before)).toBe(0);
  });

  it('are painted before the agents are placed when a preset loads', async () => {
    const paintedFirst = (calls: string[]) =>
      calls.lastIndexOf('paint') >= 0 && calls.lastIndexOf('paint') < calls.lastIndexOf('reset');
    // From the 1536 grid of the start scene: a new simulation.
    const { engine, sim } = await engineWith(three.settings(), []);
    await engine.load(maze.settings(), mazeEnv);
    expect(paintedFirst(sim().calls)).toBe(true);
    // Same grid and density: the simulation is reused.
    const reused = sim();
    await engine.load(maze.settings(), mazeEnv);
    expect(sim()).toBe(reused);
    expect(paintedFirst(sim().calls)).toBe(true);
  });

  it('are replaced by a preset load, also one chosen during a rebuild', async () => {
    const { engine, backend, sim } = await engineWith(three.settings(), []);
    engine.paint({ kind: 'wall', from: [10, 10], to: [500, 10], radius: 4 });
    engine.frame(0, 0);
    const release = hold(backend);
    const rebuilt = engine.apply({ ...engine.settings, resolution: 1024 });
    const loaded = engine.load(maze.settings(), mazeEnv);
    release();
    await Promise.all([rebuilt, loaded]);
    const fresh = await engineWith(maze.settings());
    expect(differing(sim().env, fresh.sim().env)).toBe(0);
  });

  it('are kept by reset, seed, layout, boundary and collision changes, which reuse the simulation', async () => {
    const { engine, sim } = await engineWith(maze.settings());
    const first = sim();
    const before = first.env.slice();
    engine.reset();
    await engine.apply({ ...engine.settings, seed: engine.settings.seed + 1 });
    await engine.apply({ ...engine.settings, layout: 'center' });
    await engine.apply({ ...engine.settings, boundary: 'wrap' });
    await engine.apply({ ...engine.settings, collisions: false });
    expect(sim()).toBe(first);
    expect(differing(sim().env, before)).toBe(0);
  });

  it('keep every stroke drawn on several grids, each exact on its own grid', async () => {
    const { engine, sim } = await engineWith(maze.settings(), []);
    engine.paint({ kind: 'food', from: [100.3, 100.7], to: [130.1, 90.2], radius: 2.5 });
    engine.frame(0, 0);
    await engine.apply({ ...engine.settings, resolution: 256 });
    engine.paint({ kind: 'wall', from: [20.6, 30.1], to: [200.4, 30.9], radius: 1.1 });
    engine.frame(0, 0);
    const coarse = sim().env.slice();
    await engine.apply({ ...engine.settings, resolution: 1024 });
    await engine.apply({ ...engine.settings, resolution: 256 });
    expect(differing(sim().env, coarse)).toBe(0);
  });

  it('do not throw when a stroke comes before the first simulation, which has nothing to paint on', async () => {
    const backend = new CpuBackend();
    // No grid is on screen yet: the engine as Engine.create makes it, before the first allocation.
    const engine = new (Engine as unknown as new (b: Backend, c: HTMLCanvasElement, s: Settings) => Engine)(
      backend,
      canvas(),
      defaultSettings(),
    );
    expect(() => {
      engine.paint({ kind: 'wall', from: [10, 10], to: [20, 20], radius: 2 });
    }).not.toThrow();
    await engine.rebuild();
    expect(empty((engine.sim as CpuSim).env)).toBe(true);
  });
});
