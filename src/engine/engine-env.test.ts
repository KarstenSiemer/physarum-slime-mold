// The engine keeps food, light and walls across new simulations (ADR 0019), checked in Node with a CPU backend
// whose painting mirrors the shaders (paint-reference.ts; sim.gpu.test.ts compares it with both GPU backends).
import { describe, expect, it } from 'vitest';
import { defaultSettings, type Settings } from '../model/params';
import { presetById } from '../model/presets';
import { BrushDrag } from '../ui/drag';
import { CpuBackend, type CpuSim, hold } from './cpu-backend';
import { Engine } from './engine';
import { fromFrame, fromShape, fromStroke, strokeOn, type EnvEdit } from './environment';
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
const edits = (e: Engine) => (e as unknown as { edits: EnvEdit[] }).edits;
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

  it('record no light stroke whose cells all round to byte 0, so it lights no other grid', async () => {
    const c = canvas();
    const { engine, sim } = await engineWith({ ...three.settings(), resolution: 512, boundary: 'box' }, [], c);
    expect([sim().width, sim().height]).toEqual([512, 320]);
    // Column 0 lies 9.9 to 10 cells from the centre, inside the radius, where the soft edge rounds to byte 0.
    engine.paint({ kind: 'light', from: [-9.4, 160.5], to: [-9.4, 160.5], radius: 10 });
    engine.frame(0, 0);
    expect(empty(sim().env)).toBe(true);
    // On a square screen the box's frame would have put 110 lit cells there (review of ADR 0019).
    [c.width, c.height] = [1000, 1000];
    await engine.apply({ ...engine.settings, density: 0.2 });
    expect(empty(sim().env)).toBe(true);
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

  // The scene card follows the list through onEdits (state.svelte.ts): a load replaces the list (mutant EN11).
  it('report a preset load to onEdits', async () => {
    const { engine } = await engineWith(maze.settings());
    let calls = 0;
    engine.onEdits = () => calls++;
    await engine.load(three.settings(), []);
    expect(calls).toBe(1);
    await engine.load(maze.settings(), mazeEnv);
    expect([calls, engine.matches(mazeEnv, 'box')]).toEqual([2, true]);
  });

  // A load starts the sweep's placement over: the list of the same length on the same grid is another list
  // (mutant EN7).
  it('are judged by the sweep as loaded, after a load of as many shapes', async () => {
    const { engine } = await engineWith({ ...three.settings(), resolution: 512, boundary: 'box' }, [
      { kind: 'food', at: [-0.5, 0], r: 0.02 },
    ]);
    await engine.load(engine.settings, [{ kind: 'food', at: [0.5, 0], r: 0.02 }]);
    // Over all of the second food (at 416, 160 on 512 × 320, radius 6.4).
    engine.paint({ kind: 'erase', from: [416, 160], to: [416, 160], radius: 10 });
    expect(edits(engine)).toEqual([]);
  });

  // Engine.matches: the scene's shapes in the scene's arena, and no stroke for a shape (mutants EN9, EN10).
  it('match a scene only with its own shapes in its own arena', async () => {
    const shape = { kind: 'food' as const, at: [0, 0] as [number, number], r: 0.75 };
    const { engine } = await engineWith({ ...three.settings(), resolution: 512, boundary: 'box' }, [shape]);
    expect([engine.matches([shape], 'box'), engine.matches([shape], 'dish')]).toEqual([true, false]);
    // A stroke with the shape's numbers, in cells: at the grid's corner with radius 0.75.
    engine.clearEnvironment();
    engine.paint({ kind: 'food', from: [0, 0], to: [0, 0], radius: 0.75 });
    expect(edits(engine)).toHaveLength(1);
    expect(engine.matches([shape], 'box')).toBe(false);
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

// A stroke that later strokes cleared completely on the grid on screen leaves the list (sweep.ts, ADR 0019), and so
// does an erase that clears nothing there any more.
describe('the sweep', () => {
  // Shrinking's food 6 at (−0.368, −0.05) of the dish's frame, radius 0.012 short sides: on 512 × 320 at
  // (138.24, 144) with a radius of 3.84 cells.
  const food6: [number, number] = [256 - 0.368 * 320, 160 - 0.05 * 320];
  const others = shrinkingEnv.filter((_, i) => i !== 6);

  it('deletes a food erased completely in a box, with its erases, so it stays gone on a square screen', async () => {
    for (const drag of [false, true]) {
      const c = canvas();
      const { engine, sim } = await engineWith(shrinking.settings(), shrinkingEnv, c);
      await engine.apply({ ...engine.settings, boundary: 'box' });
      expect(foodNear(sim(), food6, 5)).toBeGreaterThan(40);
      if (drag) {
        // Two rows of segments over it, each with a brush smaller than the food.
        for (const y of [food6[1] - 2, food6[1] + 2])
          for (let x = food6[0] - 6; x < food6[0] + 6; x += 2)
            engine.paint({ kind: 'erase', from: [x, y], to: [x + 2, y], radius: 3 });
      } else engine.paint({ kind: 'erase', from: food6, to: food6, radius: 8 });
      expect(edits(engine), drag ? 'drag' : 'dab').toEqual(others.map((e) => fromShape(e, 'dish')));
      engine.frame(0, 0);
      expect(foodNear(sim(), food6, 12)).toBe(0);
      // Strokes after the sweep reach the simulation.
      engine.paint({ kind: 'food', from: [400, 60], to: [400, 60], radius: 3 });
      engine.frame(0, 0);
      expect(foodNear(sim(), [400, 60], 4)).toBeGreaterThan(20);
      // On a square screen the dish's frame would put the food at (67.6, 230.4) and the box's frame the erases at
      // x = 138: without the sweep the food came back there.
      [c.width, c.height] = [1000, 1000];
      await engine.apply({ ...engine.settings, density: 0.2 });
      expect(foodNear(sim(), fromFrame([-0.368, -0.05], [512, 512], 'dish'), 12)).toBe(0);
      const fresh = await engineWith(shrinking.settings(), others, canvas(1000, 1000));
      fresh.engine.paint({ kind: 'food', from: [400, 96], to: [400, 96], radius: 4.8 });
      fresh.engine.frame(0, 0);
      expect(differing(sim().env, fresh.sim().env), drag ? 'drag' : 'dab').toBe(0);
    }
  });

  // The known limit of ADR 0019: strokes painted in different arenas shift against each other on another screen.
  it('keeps a food erased in part and its erase, each in its own frame on a square screen', async () => {
    const c = canvas();
    const { engine, sim } = await engineWith(shrinking.settings(), shrinkingEnv, c);
    await engine.apply({ ...engine.settings, boundary: 'box' });
    const before = foodNear(sim(), food6, 5);
    engine.paint({ kind: 'erase', from: [food6[0] - 3, food6[1]], to: [food6[0] - 3, food6[1]], radius: 2 });
    engine.frame(0, 0);
    const wide = sim().env.slice();
    expect(foodNear(sim(), food6, 5)).toBeLessThan(before);
    expect(foodNear(sim(), food6, 5)).toBeGreaterThan(0);
    expect(edits(engine)).toHaveLength(9);
    [c.width, c.height] = [1000, 1000];
    await engine.apply({ ...engine.settings, density: 0.2 });
    // The food in the dish's frame, whole; the erase in the box's frame, beside it.
    const fresh = await engineWith(shrinking.settings(), shrinkingEnv, canvas(1000, 1000));
    expect(differing(sim().env, fresh.sim().env)).toBe(0);
    [c.width, c.height] = [1600, 1000];
    await engine.apply({ ...engine.settings, density: 0.45 });
    expect(differing(sim().env, wide)).toBe(0);
  });

  it('deletes food and light that a wall covers completely, but no wall under a wall and no food under food', async () => {
    const { engine } = await engineWith({ ...three.settings(), resolution: 512, boundary: 'box' }, []);
    const dab = (kind: Stroke['kind'], at: [number, number], radius: number) => {
      engine.paint({ kind, from: at, to: at, radius });
    };
    dab('food', [100, 100], 3);
    dab('wall', [100, 100], 6); // covers the food
    dab('wall', [200, 100], 3);
    dab('wall', [200, 100], 6); // a wall does not clear walls
    dab('food', [300, 100], 3);
    dab('food', [300, 100], 6); // nor food food
    dab('light', [400, 100], 8);
    dab('wall', [400, 100], 6); // the light's soft edge reaches 7.86 cells: lit cells stay beside the wall
    const kinds = () => edits(engine).map((e) => `${e.kind} ${e.from[0]} ${e.radius}`);
    expect(kinds()).toEqual([
      'wall 100 6',
      'wall 200 3',
      'wall 200 6',
      'food 300 3',
      'food 300 6',
      'light 400 8',
      'wall 400 6',
    ]);
    // A wider wall covers every lit cell.
    dab('wall', [400, 100], 9);
    expect(kinds()).toEqual([
      'wall 100 6',
      'wall 200 3',
      'wall 200 6',
      'food 300 3',
      'food 300 6',
      'wall 400 6',
      'wall 400 9',
    ]);
  });

  // On 512 × 256 the dab over the left edge of the square box lies outside the grid (the box's frame keeps its
  // place along the long side and shrinks its radius with the short side): that grid cannot judge it.
  it('keeps an edit that lies outside the grid on screen, under an erase there', async () => {
    const c = canvas(1000, 1000);
    const { engine, sim } = await engineWith(maze.settings(), [], c);
    engine.paint({ kind: 'food', from: [-6, 256], to: [-6, 256], radius: 8 });
    engine.frame(0, 0);
    const square = sim().env.slice();
    [c.width, c.height] = [2000, 1000];
    await engine.apply({ ...engine.settings, density: 0.2 });
    expect([sim().width, sim().height]).toEqual([512, 256]);
    engine.paint({ kind: 'erase', from: [0, 128], to: [12, 128], radius: 10 });
    expect(edits(engine).map((e) => e.kind)).toEqual(['food']);
    [c.width, c.height] = [1000, 1000];
    await engine.apply({ ...engine.settings, density: 0.12 });
    expect(differing(sim().env, square)).toBe(0);
  });

  // A dab at the rim of the 512 × 512 dish lies beyond the rim of the 256 × 256 one, whose margin of one cell is a
  // larger share of the dish: on that grid it paints no cell, so that grid cannot judge it either.
  it('keeps an edit that paints no cell of the grid on screen, under an erase beside it there', async () => {
    const c = canvas(1000, 1000);
    const { engine, sim } = await engineWith({ ...three.settings(), resolution: 512, boundary: 'dish' }, [], c);
    expect([sim().width, sim().height]).toEqual([512, 512]);
    engine.paint({ kind: 'food', from: [511.186, 270.546], to: [511.186, 270.546], radius: 0.75 });
    engine.frame(0, 0);
    const fine = sim().env.slice();
    expect(count(fine, 1)).toBeGreaterThan(0);
    await engine.apply({ ...engine.settings, resolution: 256 });
    expect([sim().width, sim().height, count(sim().env, 1)]).toEqual([256, 256, 0]);
    // Just inside the rim, beside the dab at (255.6, 135.3): the erase clears nothing and goes, the dab stays.
    engine.paint({ kind: 'erase', from: [252.5, 135.3], to: [252.5, 135.3], radius: 2.5 });
    expect(edits(engine).map((e) => e.kind)).toEqual(['food']);
    await engine.apply({ ...engine.settings, resolution: 512 });
    expect(differing(sim().env, fine)).toBe(0);
  });

  // The GPU computes in float32: a cell this close to the edge of a brush may go either way there.
  it('deletes a stroke only when its cells lie inside the clearing strokes by SLACK', async () => {
    const { engine } = await engineWith({ ...three.settings(), resolution: 512, boundary: 'box' }, []);
    const dab = (kind: Stroke['kind'], radius: number, at: [number, number] = [100.5, 100.5]) => {
      engine.paint({ kind, from: at, to: at, radius });
    };
    // Four cells lie exactly 3 cells from the centre. Painted, but cleared only within the erase's last 0.005 cells.
    dab('food', 3);
    dab('erase', 3.005);
    expect(edits(engine)).toHaveLength(2);
    engine.clearEnvironment();
    // Not painted by the food on the CPU, but within SLACK of its brush, and not cleared.
    dab('food', 2.995);
    dab('erase', 2.95);
    expect(edits(engine)).toHaveLength(2);
    // Cleared well inside.
    dab('erase', 3.2);
    expect(edits(engine)).toHaveLength(0);
    // An erase along the food's middle row clears its rows 98 to 102; the cells (100, 97) and (100, 103) lie exactly 3
    // cells from the food's centre, outside every row the erase clears: both stay.
    dab('food', 3);
    engine.paint({ kind: 'erase', from: [90.5, 100.5], to: [110.5, 100.5], radius: 2.9 });
    expect(edits(engine).map((e) => e.kind)).toEqual(['food', 'erase']);
    engine.clearEnvironment();
    // An erase that reaches the food's cell (102, 100) only within SLACK of its own edge still erases it on the GPU:
    // it stays as long as the food does.
    dab('food', 2);
    dab('erase', 3.005, [105.5, 100.5]);
    expect(edits(engine).map((e) => e.kind)).toEqual(['food', 'erase']);
  });

  // Spread into Math.min, V8 throws from about 125,000 arguments: an erase over 130,000 edits threw out of
  // Engine.paint and stayed unswept (review of ADR 0019).
  it('sweeps an erase over 130,000 edits', async () => {
    const { engine } = await engineWith({ ...three.settings(), resolution: 512, boundary: 'box' }, []);
    let seed = 3;
    const rand = () => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return (seed >>> 0) / 2 ** 32;
    };
    for (let k = 0; k < 130_000; k++) {
      const p: [number, number] = [8 + rand() * 496, 8 + rand() * 304];
      engine.paint({ kind: 'food', from: p, to: p, radius: 1.5 });
    }
    expect(edits(engine)).toHaveLength(130_000);
    engine.paint({ kind: 'erase', from: [256, 160], to: [256, 160], radius: 400 });
    expect(edits(engine)).toHaveLength(0);
  }, 60_000);

  // Rule 2 looks at the erases over an edit that went, not at every erase nearby: an erase that clears nothing only on
  // this screen shape stays for the others (deviation 3 of the review of ADR 0019, mutant SW17), until an edit under it
  // goes there.
  it('keeps an erase that clears nothing only on this screen shape until an edit under it goes there', async () => {
    const c = canvas();
    const { engine, sim } = await engineWith(shrinking.settings(), shrinkingEnv, c);
    await engine.apply({ ...engine.settings, boundary: 'box' });
    // Over a part of food 6 here; on a square screen the box's frame puts it 67 cells beside the food.
    engine.paint({ kind: 'erase', from: [food6[0] - 3, food6[1]], to: [food6[0] - 3, food6[1]], radius: 2 });
    engine.frame(0, 0);
    const erased = foodNear(sim(), food6, 5);
    const whole = await engineWith(shrinking.settings(), shrinkingEnv, canvas());
    await whole.engine.apply({ ...whole.engine.settings, boundary: 'box' });
    expect(erased).toBeLessThan(foodNear(whole.sim(), food6, 5));
    const square = async () => {
      [c.width, c.height] = [1000, 1000];
      await engine.apply({ ...engine.settings, density: engine.settings.density === 0.2 ? 0.25 : 0.2 });
    };
    const wide = async () => {
      [c.width, c.height] = [1600, 1000];
      await engine.apply({ ...engine.settings, density: 0.45 });
    };
    await square();
    // There the erase lies at (135.24, 230.4) with radius 3.2: its box spans columns 131 to 139. Two dabs on both sides
    // of it, and one erase over both: their boxes span it, but neither box meets its box (the right one starts at
    // column 140). First where the erase's tile of the index holds nothing that stays, then with a food in it 20 cells
    // beside the erase.
    const y = fromFrame([-0.05, -0.05], [512, 512], 'box')[1];
    const beside = () => {
      for (const x of [food6[0] - 15, 144.5]) engine.paint({ kind: 'food', from: [x, y], to: [x, y], radius: 3 });
      engine.paint({ kind: 'erase', from: [food6[0] - 15, y], to: [144.5, y], radius: 5 });
    };
    beside();
    expect(edits(engine)).toHaveLength(9);
    engine.paint({ kind: 'food', from: [155, 250], to: [155, 250], radius: 2 });
    beside();
    expect(edits(engine)).toHaveLength(10);
    await wide();
    expect(foodNear(sim(), food6, 5)).toBe(erased);
    // A newer food over the erase there, erased completely, goes: now an edit under the erase went, and the erase,
    // which clears nothing there, goes too. Back here food 6 is whole again.
    await square();
    engine.paint({ kind: 'food', from: [food6[0] - 3, y], to: [food6[0] - 3, y], radius: 2 });
    engine.paint({ kind: 'erase', from: [food6[0] - 3, y], to: [food6[0] - 3, y], radius: 4 });
    expect(edits(engine)).toHaveLength(9);
    await wide();
    expect(foodNear(sim(), food6, 5)).toBe(foodNear(whole.sim(), food6, 5));
  });

  // Only older edits keep an erase: a newer food over it does not (mutant SW12). Kept, the erase would erase what it
  // reaches only on another screen shape, here food 6 on a square one.
  it('deletes an erase over an edit that went when only a newer edit lies under it', async () => {
    const c = canvas();
    const { engine, sim } = await engineWith(shrinking.settings(), shrinkingEnv, c);
    await engine.apply({ ...engine.settings, boundary: 'box' });
    // On a square screen x stays and y spreads by 1.6 about the centre, in the box's frame and the dish's: at x = 67.6
    // these strokes lie over food 6 there, 70 cells beside it here.
    const x = fromFrame([-0.368, 0], [512, 512], 'dish')[0];
    const dab = (kind: Stroke['kind'], y: number, radius: number) => {
      engine.paint({ kind, from: [x, y], to: [x, y], radius });
    };
    dab('food', 147, 3);
    dab('erase', 143.5, 2); // over the top of that food
    dab('food', 140, 2); // over the top of the erase
    dab('erase', 148.5, 4.6); // over all of the first food, beside the second
    const kept = edits(engine);
    expect(kept.map((e) => e.kind)).toEqual([...shrinkingEnv.map(() => 'food'), 'food']);
    [c.width, c.height] = [1000, 1000];
    await engine.apply({ ...engine.settings, density: 0.2 });
    const fresh = await engineWith(shrinking.settings(), shrinkingEnv, canvas(1000, 1000));
    await fresh.engine.apply({ ...fresh.engine.settings, boundary: 'box' });
    const newer = kept.at(-1);
    if (!newer) throw new Error('no newer food');
    const s = strokeOn(newer, 512, 512);
    if (!s) throw new Error('outside');
    fresh.engine.paint(s);
    fresh.engine.frame(0, 0);
    engine.frame(0, 0);
    expect(differing(sim().env, fresh.sim().env)).toBe(0);
  });
});
