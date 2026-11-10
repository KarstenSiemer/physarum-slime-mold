// The engine keeps food, light and walls across new simulations (ADR 0019), checked in Node with a CPU backend
// whose painting mirrors the shaders (paint-reference.ts; sim.gpu.test.ts compares it with both GPU backends).
import { describe, expect, it } from 'vitest';
import { defaultSettings, type Settings } from '../model/params';
import { presetById } from '../model/presets';
import { BrushDrag } from '../ui/drag';
import { CpuBackend, type CpuSim, hold } from './cpu-backend';
import { Engine } from './engine';
import { fromFrame, fromShape, fromStroke, strokeOn } from './environment';
import { OutOfMemoryError } from './gpu';
import { paintReference } from './paint-reference';
import type { Backend, Stroke } from './types';

// 16:10, like a laptop window: a 512 grid has 512 × 320 cells.
const canvas = (width = 1600, height = 1000) => ({ width, height }) as HTMLCanvasElement;
const maze = presetById('maze');
const three = presetById('three-strains');
const shrinking = presetById('shrinking');
if (!maze?.env || !three || !shrinking?.env) throw new Error('presets missing');
const mazeEnv = maze.env;
const shrinkingEnv = shrinking.env;

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
/** Food cells whose centre lies within `r` cells of `at`. */
const foodNear = (sim: CpuSim, [x, y]: [number, number], r: number) => {
  let n = 0;
  for (let j = 0; j < sim.height; j++)
    for (let i = 0; i < sim.width; i++)
      if ((sim.env[(j * sim.width + i) * 4 + 1] ?? 0) > 0 && Math.hypot(i + 0.5 - x, j + 0.5 - y) <= r) n++;
  return n;
};

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
      const s = strokeOn(fromShape(e, 'box'), 320, 512);
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
    const c = canvas(1000, 1000);
    const { engine, sim } = await engineWith(maze.settings(), [], c);
    expect([sim().width, sim().height]).toEqual([512, 512]);
    // A dab over the left edge of a square box. On a 2:1 grid its centre keeps its place along the long side while
    // its radius shrinks with the short side, so it no longer reaches into the grid.
    engine.paint({ kind: 'food', from: [-6, 256], to: [-6, 256], radius: 8 });
    engine.frame(0, 0);
    const square = sim().env.slice();
    expect(count(square, 1)).toBeGreaterThan(0);
    [c.width, c.height] = [2000, 1000];
    await engine.apply({ ...engine.settings, density: 0.2 });
    expect([sim().width, sim().height]).toEqual([512, 256]);
    expect(empty(sim().env)).toBe(true);
    [c.width, c.height] = [1000, 1000];
    await engine.apply({ ...engine.settings, density: 0.12 });
    expect(differing(sim().env, square)).toBe(0);
  });

  it('keep an edit near the edge of a box at that edge on a square screen, and back', async () => {
    const c = canvas();
    const { engine, sim } = await engineWith(maze.settings(), [], c);
    engine.paint({ kind: 'food', from: [6, 100], to: [6, 100], radius: 4 }); // near the left edge of 512 × 320
    engine.frame(0, 0);
    const wide = sim().env.slice();
    [c.width, c.height] = [1000, 1000];
    await engine.apply({ ...engine.settings, density: 0.2 });
    expect([sim().width, sim().height]).toEqual([512, 512]);
    // The box stretches with the grid: x keeps its 6 cells of 512, y its fraction of the height, the radius grows
    // with the short side from 320 to 512 cells.
    const expected = new Uint8Array(512 * 512 * 4);
    paintReference(expected, 512, 512, { kind: 'food', from: [6, 160], to: [6, 160], radius: 6.4 }, 'box');
    expect(count(expected, 1)).toBeGreaterThan(0);
    expect(differing(sim().env, expected)).toBe(0);
    [c.width, c.height] = [1600, 1000];
    await engine.apply({ ...engine.settings, density: 0.12 });
    expect(differing(sim().env, wide)).toBe(0);
  });

  it('keep a wall drawn edge to edge in a box at both edges on a wider screen, also after a dish preset', async () => {
    const c = canvas();
    const { engine, sim } = await engineWith(shrinking.settings(), shrinking.env, c);
    await engine.apply({ ...engine.settings, boundary: 'box' });
    engine.paint({ kind: 'wall', from: [-1, 100], to: [513, 100], radius: 3 });
    engine.frame(0, 0);
    [c.width, c.height] = [1280, 600];
    await engine.apply({ ...engine.settings, density: 0.4 });
    expect([sim().width, sim().height]).toEqual([512, 240]);
    // The wall still splits the box: a wall cell in the first and in the last column of its row, 100/320 down.
    const row = Math.floor((100 / 320) * 240);
    const wall = (x: number) => (sim().env[(row * 512 + x) * 4] ?? 0) >= 128;
    expect([wall(0), wall(511)]).toEqual([true, true]);
  });

  it('keep the bytes when the arena switches back and forth on the same grid', async () => {
    const c = canvas(1280, 720);
    const { engine, sim } = await engineWith(maze.settings(), mazeEnv, c);
    engine.paint({ kind: 'food', from: [300, 100], to: [330, 120], radius: 5 });
    engine.frame(0, 0);
    const before = sim().env.slice();
    await engine.apply({ ...engine.settings, boundary: 'dish' });
    await engine.apply({ ...engine.settings, boundary: 'box' });
    expect(differing(sim().env, before)).toBe(0);
  });

  it('record no stroke that paints no cell, so it cannot appear later on another grid or arena', async () => {
    const c = canvas();
    const { engine, sim } = await engineWith(maze.settings(), mazeEnv, c);
    await engine.apply({ ...engine.settings, boundary: 'dish' });
    // Left of the dish, which has a radius of 159 cells around (256, 160): nothing is painted.
    const before = sim().env.slice();
    engine.paint({ kind: 'food', from: [40, 160], to: [40, 160], radius: 6 });
    engine.frame(0, 0);
    expect(differing(sim().env, before)).toBe(0);
    await engine.apply({ ...engine.settings, boundary: 'box' });
    // A square box, where the dab would lie inside the dish's circle, under whose boundary it was painted.
    [c.width, c.height] = [1000, 1000];
    await engine.apply({ ...engine.settings, density: 0.1 });
    const fresh = await engineWith(maze.settings(), mazeEnv, canvas(1000, 1000));
    expect(differing(sim().env, fresh.sim().env)).toBe(0);
  });

  it('get back a thin stroke exactly after an arena switch on a coarse grid', async () => {
    const { engine, sim } = await engineWith(three.settings(), []);
    await engine.apply({ ...engine.settings, resolution: 1024 });
    engine.paint({ kind: 'food', from: [400, 300], to: [420, 300], radius: 1 });
    engine.frame(0, 0);
    const fine = sim().env.slice();
    await engine.apply({ ...engine.settings, resolution: 256 });
    // Painted with MIN_RADIUS on 256 × 160. The edit keeps its own grid and radius, so 1024 gets it back exactly.
    await engine.apply({ ...engine.settings, boundary: 'dish' });
    await engine.apply({ ...engine.settings, resolution: 1024, boundary: 'wrap' });
    expect(differing(sim().env, fine)).toBe(0);
  });

  // Moved or zoomed out, the view shows copies of a periodic grid around it, and the brush paints on them.
  it('keep a stroke painted on a copy of a periodic grid, also on other grids', async () => {
    const { engine, sim } = await engineWith(three.settings(), []);
    await engine.apply({ ...engine.settings, resolution: 512 });
    expect([sim().width, sim().height, engine.settings.boundary]).toEqual([512, 320, 'wrap']);
    // Left of the grid: the copy shows the grid's right edge there.
    const copy: Stroke = { kind: 'food', from: [-30.25, 100.5], to: [-20.75, 104.5], radius: 4 };
    engine.paint(copy);
    engine.frame(0, 0);
    const own = sim().env.slice();
    const expected = new Uint8Array(512 * 320 * 4);
    paintReference(expected, 512, 320, copy, 'wrap');
    expect(differing(own, expected)).toBe(0);
    await engine.apply({ ...engine.settings, resolution: 1024 });
    const fine = new Uint8Array(1024 * 640 * 4);
    const moved = { ...copy, from: [2 * 481.75, 201], to: [2 * 491.25, 209], radius: 8 } satisfies Stroke;
    paintReference(fine, 1024, 640, moved, 'wrap');
    expect(count(fine, 1)).toBeGreaterThan(3.5 * count(own, 1));
    expect(differing(sim().env, fine)).toBe(0);
    await engine.apply({ ...engine.settings, resolution: 512 });
    expect(differing(sim().env, own)).toBe(0);
  });

  // The startup check lowers the grid in the first seconds, maybe while the user drags a brush (App.svelte).
  it('follow a drag across a rebuild: no segment from cells of the old grid to cells of the new one', async () => {
    const { engine, backend, sim } = await engineWith(maze.settings(), []);
    expect([sim().width, sim().height]).toEqual([512, 320]);
    const drag = new BrushDrag();
    // Along canvas row 500, the middle row of the 1600 × 1000 canvas. The brush is 18.75 pixels, as App.svelte
    // brushCells() makes it: 6 cells on 512 × 320, 12 on 1024 × 640.
    const move = (x: number) => {
      drag.to(engine, [x, 500], 'food', 18.75 * engine.view.scale);
    };
    for (let x = 300; x <= 700; x += 10) move(x);
    const release = hold(backend);
    const rebuilt = engine.apply({ ...engine.settings, resolution: 1024 });
    for (let x = 710; x <= 800; x += 10) move(x); // still the old grid on screen
    release();
    await rebuilt;
    for (let x = 810; x <= 1300; x += 10) move(x); // the new grid
    drag.end();
    engine.frame(0, 0);
    const { width: w, height: h, env } = sim();
    expect([w, h]).toEqual([1024, 640]);
    // Row 500 is grid row 320 of 1024 × 640, and the drag 640 cells long there, with 12 cells on each side.
    let [on, off] = [0, 0];
    for (let c = 0; c < w * h; c++) {
      if (!env[c * 4 + 1]) continue;
      if (Math.abs(Math.floor(c / w) + 0.5 - h / 2) <= 13) on++;
      else off++;
    }
    expect(on).toBeGreaterThan(640 * 22);
    expect(off).toBe(0);
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

// Every edit maps through the canonical frame of the arena it was painted in, whatever arena the simulation runs in
// (ADR 0019). The screens here are not 16:10: there every frame is the same, and a test could not tell them apart.
describe('food, light and walls after an arena switch', () => {
  it("keep a dish scene's foods where the dish puts them, as if the arena had never switched", async () => {
    const c = canvas(1000, 1000);
    const { engine, sim } = await engineWith(shrinking.settings(), shrinkingEnv, c);
    expect([sim().width, sim().height, engine.settings.boundary]).toEqual([512, 512, 'dish']);
    await engine.apply({ ...engine.settings, boundary: 'box' });
    for (const [w, h, density] of [
      [1280, 720, 0.4],
      [1600, 1000, 0.45],
    ] as const) {
      [c.width, c.height] = [w, h];
      await engine.apply({ ...engine.settings, density });
      const fresh = await engineWith(shrinking.settings(), shrinkingEnv, canvas(w, h));
      expect(differing(sim().env, fresh.sim().env), `${w} × ${h}`).toBe(0);
      // Each of the eight foods at the place of the dish's frame, with all its cells.
      const short = Math.min(sim().width, sim().height);
      shrinkingEnv.forEach((e, i) => {
        const at = fromFrame(e.at, [sim().width, sim().height], 'dish');
        const cells = foodNear(sim(), at, 2 + e.r * short);
        expect(cells, `food ${i} on ${w} × ${h}`).toBe(foodNear(fresh.sim(), at, 2 + e.r * short));
        expect(cells, `food ${i} on ${w} × ${h}`).toBeGreaterThan(20);
      });
    }
  });

  it('give the Maze back byte for byte after the dish, a square screen, the box and 16:10 again', async () => {
    const c = canvas();
    const { engine, sim } = await engineWith(maze.settings(), mazeEnv, c);
    const wide = sim().env.slice();
    await engine.apply({ ...engine.settings, boundary: 'dish' });
    [c.width, c.height] = [1000, 1000];
    await engine.apply({ ...engine.settings, density: 0.1 });
    expect([sim().width, sim().height]).toEqual([512, 512]);
    await engine.apply({ ...engine.settings, boundary: 'box' });
    // The Maze of a square screen: its long walls at a quarter and three quarters of the width, both foods.
    const square = await engineWith(maze.settings(), mazeEnv, canvas(1000, 1000));
    expect(differing(sim().env, square.sim().env)).toBe(0);
    [c.width, c.height] = [1600, 1000];
    await engine.apply({ ...engine.settings, density: 0.12 });
    expect(differing(sim().env, wide)).toBe(0);
  });

  it('keep a periodic stroke at its place on the grid in a dish on a squarer screen', async () => {
    const c = canvas();
    const { engine, sim } = await engineWith({ ...three.settings(), resolution: 512 }, [], c);
    expect([sim().width, sim().height, engine.settings.boundary]).toEqual([512, 320, 'wrap']);
    engine.paint({ kind: 'food', from: [20, 160], to: [20, 160], radius: 6 });
    engine.frame(0, 0);
    await engine.apply({ ...engine.settings, boundary: 'dish' });
    [c.width, c.height] = [1000, 1000];
    await engine.apply({ ...engine.settings, density: 0.1 });
    expect([sim().width, sim().height]).toEqual([512, 512]);
    // The periodic grid's frame keeps 20 of 512 cells of the width: the dab stays at the left edge, where it was
    // painted, instead of on the other side of the dish.
    const all = count(sim().env, 1);
    expect(all).toBeGreaterThan(100);
    expect(foodNear(sim(), [20, 256], 11)).toBe(all);
  });

  // The known limit of ADR 0019: strokes on top of each other that were painted in different arenas map through
  // different frames on another screen shape. Nothing changes for good: on the shape of the switch they meet again.
  it('keep two dabs painted in different arenas in their own frames, apart on a square screen and together on 16:9', async () => {
    const c = canvas(1280, 720);
    const { engine, sim } = await engineWith({ ...three.settings(), resolution: 512 }, [], c);
    expect([sim().width, sim().height, engine.settings.boundary]).toEqual([512, 288, 'wrap']);
    engine.paint({ kind: 'food', from: [150, 90], to: [150, 90], radius: 3.6 });
    engine.frame(0, 0);
    await engine.apply({ ...engine.settings, boundary: 'dish' });
    // The same dab once more, painted in the dish where the first one is on screen.
    engine.paint({ kind: 'food', from: [150, 90], to: [150, 90], radius: 3.6 });
    engine.frame(0, 0);
    const together = sim().env.slice();
    [c.width, c.height] = [1000, 1000];
    await engine.apply({ ...engine.settings, density: 0.1 });
    expect([sim().width, sim().height]).toEqual([512, 512]);
    // The periodic grid stretches: (150, 160). The dish scales both axes by the short sides: (256 − 106 · 512/288, 160).
    expect(foodNear(sim(), [150, 160], 7)).toBeGreaterThan(100);
    expect(foodNear(sim(), [256 - (106 * 512) / 288, 160], 7)).toBeGreaterThan(100);
    [c.width, c.height] = [1280, 720];
    await engine.apply({ ...engine.settings, density: 0.2 });
    expect(differing(sim().env, together)).toBe(0);
  });

  // App.svelte's startScene() loads a scene under the panel's boundary: the shapes keep the scene's own arena.
  it("load a scene's shapes in the scene's own arena under another boundary, as a load and a switch would", async () => {
    const steiner = presetById('steiner');
    if (!steiner?.env) throw new Error('no Steiner tree');
    for (const [p, other] of [
      [steiner, 'box'],
      [maze, 'dish'],
    ] as const)
      for (const [w, h] of [
        [1280, 720],
        [1000, 1000],
      ] as const) {
        const env = p.env ?? [];
        const switched = await engineWith(p.settings(), env, canvas(w, h));
        await switched.engine.apply({ ...switched.engine.settings, boundary: other });
        const settings = { ...p.settings(), boundary: other };
        const started = await Engine.create(canvas(w, h), settings, undefined, new CpuBackend());
        await started.load(settings, env, p.settings().boundary);
        expect(started.settings.boundary).toBe(other);
        expect(differing((started.sim as CpuSim).env, switched.sim().env), `${p.id} on ${w} × ${h}`).toBe(0);
        expect(count(switched.sim().env, 1), `${p.id} on ${w} × ${h}`).toBeGreaterThan(50);
      }
  });

  it("place a preset's shapes as on screen when the boundary changes after the load", async () => {
    const steiner = presetById('steiner');
    if (!steiner?.env) throw new Error('no Steiner tree');
    const own = await engineWith(steiner.settings(), steiner.env, canvas(1000, 1000));
    expect([own.sim().width, own.sim().height]).toEqual([256, 256]);
    const { engine, sim } = await engineWith(steiner.settings(), steiner.env, canvas(1000, 1000));
    await engine.apply({ ...steiner.settings(), boundary: 'box' });
    // The four foods lie inside the dish, so painting them in a box gives the same bytes: a square.
    expect(differing(sim().env, own.sim().env)).toBe(0);
  });
});
