// The picture of the tubes on both backends (ADR 0034), in Chromium with real GPU APIs (ADR 0010): the passes against
// the CPU reference, the rule in plain cases, and the frames that the view draws from the picture.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { hexToLinear } from '../model/color';
import { defaultSettings, defaultStrain, type Boundary, type Settings } from '../model/params';
import { FLOW } from './flow';
import { WebGl2Backend } from './gl/backend';
import { instance } from './instance';
import { BACKGROUND } from './render';
import { flowSites, type FoodStroke } from './sites';
import { TUBE_MAP_BYTES_PER_CELL_GL } from './sizing';
import { STREAM, TUBE_REACH, TUBE_TILE, TUBE_WINDOW, TUBES, VEINS } from './tubes';
import {
  arenaCell,
  tubePicture,
  tubeRoots,
  tubeStream,
  veinDeep,
  veinShade,
  wallOnLine,
  type TubeGrid,
} from './tubes-reference';
import type { Backend, Levels, Sim, Stroke, View } from './types';
import { WebGpuBackend } from './webgpu';

const BACKENDS = {
  webgpu: (c: HTMLCanvasElement): Promise<Backend> => WebGpuBackend.create(c),
  webgl2: (c: HTMLCanvasElement): Promise<Backend> => Promise.resolve(WebGl2Backend.create(c)),
};

/** An extended scene with the flow on and the picture of the tubes. */
const flowing = (patch: Partial<Settings> = {}): Settings => ({
  ...defaultSettings(),
  // The frames of these tests draw the glow style unless they name another one.
  style: 'glow',
  model: 'extended',
  flow: true,
  boundary: 'box',
  collisions: true,
  seed: 5,
  strains: [defaultStrain(0)],
  ...patch,
});

/** A number in [0, 1) from a cell and a salt, the same in every run. */
function noise(c: number, salt: number): number {
  let x = (c * 0x9e3779b1 + salt * 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b) >>> 0;
  return ((x ^ (x >>> 16)) >>> 8) / 16777216;
}

/** The red value of a pixel of a drawn frame, 0 to 255. Strain A is yellow: its trail is red and green. */
const red = (img: ImageData, x: number, y: number) => img.data[(y * img.width + x) * 4] ?? 0;

/** Linear light → sRGB byte, without the dither (render.wgsl `srgb`). */
const toByte = (c: number) => {
  const x = Math.min(1, Math.max(0, c));
  return Math.round((x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055) * 255);
};

/** The largest difference of one pixel of two frames in red, green or blue. */
const pixelDiff = (a: ImageData, b: ImageData, x: number, y: number) =>
  Math.max(
    ...[0, 1, 2].map((k) =>
      Math.abs((a.data[(y * a.width + x) * 4 + k] ?? 0) - (b.data[(y * b.width + x) * 4 + k] ?? 0)),
    ),
  );

/** The largest difference of two frames in one value of a pixel. */
function frameDiff(a: ImageData, b: ImageData): number {
  let worstValue = 0;
  for (let i = 0; i < a.data.length; i++)
    worstValue = Math.max(worstValue, Math.abs((a.data[i] ?? 0) - (b.data[i] ?? 0)));
  return worstValue;
}

/** A value of the picture to 4 places: the mean of equal trails is the trail but for the rounding of its sums. */
const near = (v: number | undefined) => Math.round((v ?? 0) * 1e4) / 1e4;

/**
 * The largest difference of two fields, against the size of the value and at least against `least`. The picture has
 * `least` 1: at the edge of a disc its cover is a small difference of numbers near 4, so a GPU with 32-bit floats
 * gives the cover to about 1 part in a million of 1, not of its own size. The trails here are up to 20.
 */
/**
 * How many discs of strain A the walls stop on their line: the pairs of a cell and a cell with a disc that reaches
 * it, with a cell of a wall on the line between the two. Without such pairs a scene does not test the wall test.
 */
function stoppedDiscs(grid: TubeGrid, roots: Float32Array): number {
  let pairs = 0;
  for (let y = 0; y < grid.height; y++)
    for (let x = 0; x < grid.width; x++) {
      const p = arenaCell(grid, x, y);
      if (p < 0 || (grid.shape[p * 4] ?? 0) >= 128) continue;
      for (let dy = -TUBE_WINDOW; dy <= TUBE_WINDOW; dy++)
        for (let dx = -TUBE_WINDOW; dx <= TUBE_WINDOW; dx++) {
          const d = Math.hypot(dx, dy);
          const q = arenaCell(grid, x + dx, y + dy);
          if (d === 0 || d >= TUBE_REACH || q < 0) continue;
          const root = roots[q * 4] ?? 0;
          if (root > 0 && TUBES.radius * root + TUBES.edge / 2 > d && wallOnLine(grid, x, y, dx, dy)) pairs++;
        }
    }
  return pairs;
}

/**
 * What a scene holds for the tiles of the picture (tubes.ts TUBE_TILE), from the factors of the reference. `beside`:
 * the discs that reach a cell from another tile, where the tile of the cell holds no disc of its own. `stopped`: the
 * discs that a wall cell on their line stops, where the tile of the cell holds no wall cell of its own. `across`: the
 * discs that reach a cell across the edge of the grid, where the window of the tile of the cell (the tile and
 * TUBE_WINDOW cells around it) holds no disc inside the grid. `empty`: the tiles whose window holds no disc. A rule of
 * the tiles that leaves out the cells around a tile, or that does not wrap, gives a wrong picture in the first three;
 * the last are the tiles that the passes skip.
 */
function tileCases(grid: TubeGrid, roots: Float32Array) {
  const { width: w, height: h } = grid;
  const columns = Math.ceil(w / TUBE_TILE);
  const tileOf = (x: number, y: number) => Math.floor(y / TUBE_TILE) * columns + Math.floor(x / TUBE_TILE);
  const count = columns * Math.ceil(h / TUBE_TILE);
  const disc = (c: number) => [0, 1, 2, 3].some((s) => (roots[c * 4 + s] ?? 0) > 0);
  const [discs, walls] = [new Uint8Array(count), new Uint8Array(count)];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = arenaCell(grid, x, y);
      if (c < 0) continue;
      if (disc(c)) discs[tileOf(x, y)] = 1;
      if ((grid.shape[c * 4] ?? 0) >= 128) walls[tileOf(x, y)] = 1;
    }
  // Per tile whether its window holds a disc, with the cells across the edge of the grid and without them.
  const [any, inside] = [new Uint8Array(count), new Uint8Array(count)];
  for (let ty = 0; ty < h; ty += TUBE_TILE)
    for (let tx = 0; tx < w; tx += TUBE_TILE)
      for (let y = ty - TUBE_WINDOW; y < ty + TUBE_TILE + TUBE_WINDOW; y++)
        for (let x = tx - TUBE_WINDOW; x < tx + TUBE_TILE + TUBE_WINDOW; x++) {
          const c = arenaCell(grid, x, y);
          if (c < 0 || !disc(c)) continue;
          any[tileOf(tx, ty)] = 1;
          if (x >= 0 && y >= 0 && x < w && y < h) inside[tileOf(tx, ty)] = 1;
        }
  const cases = { beside: 0, stopped: 0, across: 0, empty: any.filter((a) => a === 0).length };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = arenaCell(grid, x, y);
      if (p < 0 || (grid.shape[p * 4] ?? 0) >= 128) continue;
      const t = tileOf(x, y);
      for (let dy = -TUBE_WINDOW; dy <= TUBE_WINDOW; dy++)
        for (let dx = -TUBE_WINDOW; dx <= TUBE_WINDOW; dx++) {
          const d = Math.hypot(dx, dy);
          const q = arenaCell(grid, x + dx, y + dy);
          if (d >= TUBE_REACH || q < 0) continue;
          const reaches = [0, 1, 2, 3].some((s) => {
            const root = roots[q * 4 + s] ?? 0;
            return root > 0 && TUBES.radius * root + TUBES.edge / 2 > d;
          });
          if (!reaches) continue;
          if (wallOnLine(grid, x, y, dx, dy)) {
            if (!walls[t]) cases.stopped++;
            continue;
          }
          if ((x + dx < 0 || y + dy < 0 || x + dx >= w || y + dy >= h) && !inside[t]) cases.across++;
          if (!discs[t]) cases.beside++;
        }
    }
  return cases;
}

function worst(got: Float32Array, want: Float32Array, least = 1e-6): number {
  let w = 0;
  for (let i = 0; i < want.length; i++)
    w = Math.max(w, Math.abs((got[i] ?? 0) - (want[i] ?? 0)) / (least + Math.abs(want[i] ?? 0)));
  return w;
}

describe.each(Object.entries(BACKENDS))('the picture of the tubes on %s', (kind, create) => {
  let backend: Backend;
  const live: Sim[] = [];

  beforeAll(async () => {
    backend = await create(document.createElement('canvas'));
    // The first picture and the first stream compile their pipelines: here, under a long timeout (flow.gpu.test.ts has
    // the times).
    const sim = await backend.createSim(flowing(), 16, 16, 8);
    sim.writeFlow(new Float32Array(16 * 16 * 4));
    await sim.readPicture();
    await sim.readStream();
    sim.destroy();
  }, 600_000);
  afterEach(() => {
    for (const s of live.splice(0)) s.destroy();
  });
  afterAll(() => {
    backend.destroy();
  });

  async function make(settings: Settings, w: number, h: number) {
    const sim = await backend.createSim(settings, w, h, 8);
    live.push(sim);
    return sim;
  }

  /** The memory of a flow, 4 values per cell: fresh ground without a tube, and what `of` gives for a cell. */
  function memoryOf(w: number, h: number, of: (x: number, y: number) => [memory: number, body: number] | undefined) {
    const m = new Float32Array(w * h * 4);
    for (let c = 0; c < w * h; c++) {
      const [d, body] = of(c % w, Math.floor(c / w)) ?? [FLOW.fresh, 0];
      m[c * 4] = d;
      m[c * 4 + 1] = body;
    }
    return m;
  }

  /** The picture and the factors of the radius that the reference gives for the state of a simulation. */
  async function reference(sim: Sim, boundary: Boundary, strains: number) {
    const grid: TubeGrid = { width: sim.width, height: sim.height, boundary, shape: await sim.readShape() };
    const memories = await Promise.all(Array.from({ length: strains }, (_, s) => sim.readFlow(s)));
    const roots = tubeRoots(grid, memories);
    return { roots, picture: tubePicture(grid, await sim.readView(), roots) };
  }

  it.each(['box', 'wrap', 'dish'] as const)(
    'follows the CPU reference on a %s grid with walls and four strains',
    async (boundary) => {
      const [w, h] = [40, 32];
      const strains = [0, 1, 2, 3].map((i) => defaultStrain(i));
      const sim = await make(flowing({ boundary, strains }), w, h);
      const strokes: Stroke[] = [
        { kind: 'wall', from: [20, 4], to: [20, 22], radius: 1 },
        { kind: 'wall', from: [6, 26], to: [30, 23], radius: 1.5 },
        // A thin wall along a diagonal: one cell thick, so that many discs reach across it.
        { kind: 'wall', from: [26, 4], to: [37, 15], radius: 0.6 },
        { kind: 'food', from: [10.5, 10.5], to: [10.5, 10.5], radius: 2.5 },
      ];
      sim.paint(strokes);
      // Trail and tubes of every strength on most cells, also at the edges of the grid, beside the walls and in them.
      const trail = new Float32Array(w * h * 4);
      for (let i = 0; i < trail.length; i++) trail[i] = noise(i, 1) < 0.6 ? 20 * noise(i, 2) : 0;
      sim.writeTrail(trail);
      for (let s = 0; s < 4; s++)
        sim.writeFlow(
          memoryOf(w, h, (x, y) => {
            const c = y * w + x;
            if (noise(c, 10 + s) < 0.3) return undefined;
            // The flow memory over its whole range, 0.0001 to 1, and bodies on both sides of the least body.
            return [10 ** (-4 * noise(c, 20 + s)), noise(c, 30 + s) < 0.2 ? 0.04 * noise(c, 40 + s) : noise(c, 50 + s)];
          }),
          s,
        );
      const want = await reference(sim, boundary, 4);
      const [roots, picture] = [await sim.readTubeRoots(), await sim.readPicture()];
      expect(roots.length).toBe(w * h * 4);
      expect(picture.length).toBe(w * h * 4);
      expect(worst(roots, want.roots), 'the factors of the radius').toBeLessThan(1e-5);
      expect(worst(picture, want.picture, 1), 'the picture').toBeLessThan(1e-5);
      // The case is not empty: tubes of every strain widen the trail, and the walls stop some of their discs.
      const view = await sim.readView();
      const wider = [0, 1, 2, 3].map((s) => {
        let n = 0;
        for (let c = 0; c < w * h; c++) if ((picture[c * 4 + s] ?? 0) > (view[c * 4 + s] ?? 0) + 1e-3) n++;
        return n;
      });
      for (const n of wider) expect(n).toBeGreaterThan(20);
      // And the walls stop discs of strain A on their line.
      const grid: TubeGrid = { width: w, height: h, boundary, shape: await sim.readShape() };
      expect(stoppedDiscs(grid, want.roots)).toBeGreaterThan(100);
    },
    120_000,
  );

  it.each(['box', 'wrap', 'dish'] as const)(
    'follows the CPU reference tile by tile on a %s grid: discs and walls around a tile, and tiles without a disc',
    async (boundary) => {
      // A grid of no whole number of tiles, with a few short tubes: many tiles hold no disc in their window, and many
      // cells take a tube only from a disc of another tile, also across the edge of the periodic grid, or lose it at
      // a wall of another tile.
      const [w, h] = [45, 37];
      const sim = await make(flowing({ boundary, strains: [0, 1].map((i) => defaultStrain(i)) }), w, h);
      // Walls one cell thick: along column 16 and along row 24, each the first of a tile.
      sim.paint([
        { kind: 'wall', from: [16.5, 3], to: [16.5, 20], radius: 0.6 },
        { kind: 'wall', from: [26, 24.5], to: [40, 24.5], radius: 0.6 },
      ]);
      const trail = new Float32Array(w * h * 4);
      for (let i = 0; i < trail.length; i++) trail[i] = 20 * noise(i, 3);
      sim.writeTrail(trail);
      // Per strain its tubes along a row: the first cell, the row, the cells, and the flow memory.
      const tubes = [
        [
          [17, 10, 3, 1],
          [4, 1, 3, 1],
          [35, 12, 1, 0.3],
          [13, 28, 2, 0.6],
        ],
        [
          [42, 33, 3, 0.5],
          [29, 26, 3, 1],
          [7, 20, 1, 0.8],
          [22, 4, 3, 0.05],
        ],
      ];
      tubes.forEach((list, s) => {
        const memory = memoryOf(w, h, (x, y) => {
          const tube = list.find(([x0 = 0, y0, n = 0]) => y === y0 && x >= x0 && x < x0 + n);
          return tube ? [tube[3] ?? 0, 1] : undefined;
        });
        sim.writeFlow(memory, s);
      });
      const want = await reference(sim, boundary, 2);
      expect(worst(await sim.readTubeRoots(), want.roots), 'the factors of the radius').toBeLessThan(1e-5);
      expect(worst(await sim.readPicture(), want.picture, 1), 'the picture').toBeLessThan(1e-5);
      // The case is not empty.
      const cases = tileCases({ width: w, height: h, boundary, shape: await sim.readShape() }, want.roots);
      expect(cases.beside, 'discs from another tile into a tile without a disc').toBeGreaterThan(20);
      expect(cases.stopped, 'discs stopped by a wall of another tile').toBeGreaterThan(5);
      expect(cases.empty, 'tiles without a disc in their window').toBeGreaterThan(3);
      if (boundary === 'wrap') expect(cases.across, 'discs across the edge into a tile without one').toBeGreaterThan(5);
    },
  );

  it('counts the memory of a map of the tiles only on the backend that holds one', () => {
    // WebGL2 holds the map of the tiles and its rows in targets (gl/sim.ts `tubes`); WebGPU holds the window of a tile
    // in the memory of a workgroup.
    expect(backend.tubeMapBytesPerCell).toBe(kind === 'webgl2' ? TUBE_MAP_BYTES_PER_CELL_GL : 0);
  });

  it('draws a tube as wide and as bright as the fourth root of its strength says', async () => {
    const [w, h] = [48, 40];
    const sim = await make(flowing(), w, h);
    // Two tubes of one cell along rows 10 and 28, with the same trail: the first with the full flow memory, the
    // second with a hundredth of it. Three cells of a tube lie in the 3 × 3 cells around a cell of it, so the strength
    // across the tube is its flow memory.
    const rows = new Map([
      [10, 1],
      [28, 0.01],
    ]);
    const trail = new Float32Array(w * h * 4);
    for (const y of rows.keys()) for (let x = 0; x < w; x++) trail[(y * w + x) * 4] = 8;
    sim.writeTrail(trail);
    sim.writeFlow(memoryOf(w, h, (_, y) => (rows.has(y) ? [rows.get(y) ?? 0, 1] : undefined)));
    const picture = await sim.readPicture();
    const at = (x: number, y: number) => picture[(y * w + x) * 4] ?? 0;
    for (const [y, memory] of rows) {
      const root = memory ** 0.25;
      for (let k = 0; k <= 5; k++) {
        const cover = Math.min(1, Math.max(0, (TUBES.radius * root + TUBES.edge / 2 - k) / TUBES.edge));
        expect(at(24, y + k), `row ${String(y)}, ${String(k)} cells below`).toBeCloseTo(8 * root * cover, 4);
        expect(at(24, y - k), `row ${String(y)}, ${String(k)} cells above`).toBeCloseTo(8 * root * cover, 4);
      }
    }
    // In numbers: the full tube is 7 cells wide at its full brightness. The weak one has a third of the brightness,
    // and a part of one cell on each side.
    expect([10, 11, 12, 13, 14].map((y) => at(24, y) > 7.99)).toEqual([true, true, true, true, false]);
    expect(at(24, 14)).toBe(0);
    expect(at(24, 28)).toBeCloseTo(8 * 0.01 ** 0.25, 4);
    expect(at(24, 29)).toBeGreaterThan(0.5);
    expect(at(24, 29)).toBeLessThan(at(24, 28));
    expect(at(24, 30)).toBe(0);
    // Only a cell with a tube holds a factor of a radius, and only in the lane of its strain: the scene holds one.
    const roots = await sim.readTubeRoots();
    expect([0, 1, 2, 3].map((lane) => near(roots[(10 * w + 24) * 4 + lane]))).toEqual([1, 0, 0, 0]);
    expect([9, 11].map((y) => roots[(y * w + 24) * 4])).toEqual([0, 0]);
  });

  it('keeps the plasmodium without a tube at a quarter of its trail, and a strain to its own lane', async () => {
    const [w, h] = [32, 24];
    const sim = await make(flowing({ strains: [defaultStrain(0), defaultStrain(1)] }), w, h);
    const trail = new Float32Array(w * h * 4);
    // Strain A has trail on row 6 and no tube. Strain B has trail and a full tube on row 16.
    for (let x = 0; x < w; x++) {
      trail[(6 * w + x) * 4] = 12;
      trail[(16 * w + x) * 4 + 1] = 4;
    }
    sim.writeTrail(trail);
    sim.writeFlow(
      memoryOf(w, h, () => undefined),
      0,
    );
    sim.writeFlow(
      memoryOf(w, h, (_, y) => (y === 16 ? [1, 1] : undefined)),
      1,
    );
    const picture = await sim.readPicture();
    const at = (x: number, y: number, s: number) => picture[(y * w + x) * 4 + s] ?? 0;
    expect(at(16, 6, 0)).toBeCloseTo(TUBES.sheet * 12, 5);
    expect(at(16, 5, 0)).toBe(0);
    expect(at(16, 7, 0)).toBe(0);
    // The tube of strain B is wide in the lane of strain B, and it adds nothing to the lane of strain A.
    expect(at(16, 16, 1)).toBeCloseTo(4, 5);
    expect(at(16, 19, 1)).toBeCloseTo(4, 5);
    expect(at(16, 20, 1)).toBe(0);
    for (let y = 12; y <= 20; y++) expect(at(16, y, 0)).toBe(0);
    // The lanes of the strains that the scene does not hold are empty, in the factors of the radius too.
    const roots = await sim.readTubeRoots();
    expect([0, 1, 2, 3].map((lane) => roots[(16 * w + 16) * 4 + lane])).toEqual([0, 1, 0, 0]);
    // A body below the least body is no tube, whatever its flow memory.
    sim.writeFlow(
      memoryOf(w, h, (_, y) => (y === 16 ? [1, 0.9 * FLOW.bodyLow] : undefined)),
      1,
    );
    const bare = await sim.readPicture();
    expect(bare[(16 * w + 16) * 4 + 1]).toBeCloseTo(TUBES.sheet * 4, 5);
    expect(bare[(18 * w + 16) * 4 + 1]).toBe(0);
  });

  it('gives a tube the mean trail of the cells whose discs reach a cell, each by its weight', async () => {
    const [w, h] = [32, 24];
    const sim = await make(flowing(), w, h);
    // A full tube of two rows, with a trail of 8 on row 12 and of 2 on row 13. At a cell of row 12 the discs of 7
    // cells of its row reach it whole, and of row 13 the discs of 5 cells whole and of 2 at their edge.
    const trail = new Float32Array(w * h * 4);
    for (let x = 0; x < w; x++) {
      trail[(12 * w + x) * 4] = 8;
      trail[(13 * w + x) * 4] = 2;
    }
    sim.writeTrail(trail);
    sim.writeFlow(memoryOf(w, h, (_, y) => (y === 12 || y === 13 ? [1, 1] : undefined)));
    const beside = 5 + 2 * (TUBES.radius + TUBES.edge / 2 - Math.hypot(3, 1));
    const picture = await sim.readPicture();
    expect(picture[(12 * w + 16) * 4]).toBeCloseTo((7 * 8 + beside * 2) / (7 + beside), 4);
    expect(picture[(13 * w + 16) * 4]).toBeCloseTo((beside * 8 + 7 * 2) / (7 + beside), 4);
  });

  it('draws no tube across a wall', async () => {
    const [w, h] = [48, 32];
    const sim = await make(flowing(), w, h);
    // A wall along row 16, about 2 cells thick.
    sim.paint([{ kind: 'wall', from: [0, 16], to: [48, 16], radius: 1 }]);
    const env = await sim.readEnv();
    const wall = (y: number) => (env[(y * w + 24) * 4] ?? 0) >= 128;
    expect([13, 14, 15, 16, 17, 18].map(wall)).toEqual([false, false, true, true, false, false]);
    /** A full tube of one cell along a row, and the picture of the cells of column 24. */
    const tube = async (row: number) => {
      const trail = new Float32Array(w * h * 4);
      for (let x = 0; x < w; x++) trail[(row * w + x) * 4] = 8;
      sim.writeTrail(trail);
      sim.writeFlow(memoryOf(w, h, (_, y) => (y === row ? [1, 1] : undefined)));
      const picture = await sim.readPicture();
      return (y: number) => near(picture[(y * w + 24) * 4]);
    };
    // A tube on row 13: away from the wall it adds 3 cells at its full brightness. Toward the wall it fills the open
    // cell, and it reaches no cell of the wall.
    const far = await tube(13);
    expect([12, 11, 10, 9].map(far)).toEqual([8, 8, 8, 0]);
    expect(far(14)).toBe(8);
    expect([15, 16].map(far)).toEqual([0, 0]);
    // A tube on row 14, beside the wall: row 17 lies 3 cells from it, behind the wall, and holds nothing.
    const beside = await tube(14);
    expect([13, 12, 11].map(beside)).toEqual([8, 8, 8]);
    expect([15, 16, 17, 18].map(beside)).toEqual([0, 0, 0, 0]);
    // Without the wall the same tube reaches row 17.
    sim.clearEnvironment();
    const open = await tube(14);
    expect([15, 16, 17, 18].map(open)).toEqual([8, 8, 8, 0]);
  });

  it('draws the trail of the view while the setting is off, the flow is off, or the style draws the agents', async () => {
    const [w, h] = [24, 16];
    const trail = new Float32Array(w * h * 4);
    for (let x = 0; x < w; x++) trail[(8 * w + x) * 4] = 8;
    const tube = memoryOf(w, h, (_, y) => (y === 8 ? [1, 1] : undefined));
    const off: Partial<Settings>[] = [{ showTubes: false }, { flow: false }, { style: 'agents' }];
    for (const patch of off) {
      const sim = await make(flowing(patch), w, h);
      sim.writeTrail(trail);
      sim.writeFlow(tube);
      expect([...(await sim.readPicture())], JSON.stringify(patch)).toEqual([...(await sim.readView())]);
      expect((await sim.readTubeRoots()).length).toBe(0);
    }
    // The picture follows the setting on a running simulation, in both directions.
    const sim = await make(flowing(), w, h);
    sim.writeTrail(trail);
    sim.writeFlow(tube);
    expect(near((await sim.readPicture())[(11 * w + 12) * 4])).toBe(8);
    sim.update(flowing({ showTubes: false }));
    expect([...(await sim.readPicture())]).toEqual([...(await sim.readView())]);
    sim.update(flowing());
    expect(near((await sim.readPicture())[(11 * w + 12) * 4])).toBe(8);
  });

  it('follows every change of the state: a step, a new trail, a new memory and a new wall', async () => {
    const [w, h] = [32, 24];
    const settings = flowing({ strains: [{ ...defaultStrain(0), sensorOffset: 5 }] });
    const sim = await backend.createSim(settings, w, h, 200);
    live.push(sim);
    const check = async (what: string) => {
      const want = await reference(sim, 'box', 1);
      expect(worst(await sim.readPicture(), want.picture, 1), what).toBeLessThan(1e-5);
    };
    const food: FoodStroke = [{ kind: 'food', from: [8.5, 12.5], to: [8.5, 12.5], radius: 2.5 }];
    sim.paint(food);
    sim.foodSites(flowSites([food], w, h, 'box'));
    sim.reset();
    // Every cell holds a tube, so the picture shows the trail of the agents wider than it is.
    sim.writeFlow(memoryOf(w, h, (x) => [x < 16 ? 0.5 : 0.002, 1]));
    await check('at the start');
    const start = await sim.readPicture();
    sim.run(3);
    await check('after three steps');
    expect([...(await sim.readPicture())]).not.toEqual([...start]);
    const trail = new Float32Array(w * h * 4);
    for (let x = 0; x < w; x++) trail[(6 * w + x) * 4] = 3;
    sim.writeTrail(trail);
    await check('after a new trail');
    sim.writeFlow(memoryOf(w, h, (x) => [x < 16 ? 0.002 : 0.5, 1]));
    await check('after a new memory');
    // The trail is on row 6. With a flow memory of 0.5 its discs reach row 9, and with 0.002 they do not.
    const row9 = async () => {
      const picture = await sim.readPicture();
      return [20, 4].map((x) => picture[(9 * w + x) * 4] ?? 0);
    };
    const [strong, weak] = await row9();
    expect(strong).toBeGreaterThan(0.1);
    expect(weak).toBe(0);
    // A wall on rows 7 and 8 lies between: no disc of row 6 reaches row 9.
    sim.paint([{ kind: 'wall', from: [0, 8], to: [32, 8], radius: 1 }]);
    await check('after a new wall');
    expect(await row9()).toEqual([0, 0]);
  });

  it('is made from the trail that the view draws when a step moves first', async () => {
    const [w, h] = [32, 24];
    // Two diffusion passes: the view of a step that moves first is then in a texture of its own (ADR 0027).
    for (const diffusion of [1, 2]) {
      const settings = flowing({
        stepOrder: 'move-first',
        diffusion,
        strains: [{ ...defaultStrain(0), sensorOffset: 5 }],
      });
      const sim = await backend.createSim(settings, w, h, 200);
      live.push(sim);
      sim.run(2);
      sim.writeFlow(memoryOf(w, h, () => [0.3, 1]));
      const [view, trail] = [await sim.readView(), await sim.readTrail()];
      expect([...view]).not.toEqual([...trail]);
      const want = await reference(sim, 'box', 1);
      expect(worst(await sim.readPicture(), want.picture, 1), `${String(diffusion)} passes`).toBeLessThan(1e-5);
      sim.run(1);
      const next = await reference(sim, 'box', 1);
      expect(worst(await sim.readPicture(), next.picture, 1), `${String(diffusion)} passes, a step later`).toBeLessThan(
        1e-5,
      );
    }
  });

  // The levels are measured in three places: for the frames, at every sixth one on WebGPU and at every fifteenth on
  // WebGL2 (draw() with `measure`); for a PNG, which is drawn with levels of its own (measured()); and at once, for
  // tests (settle()).
  it('keeps the strand of the scent view a level of the trail of the model, in a frame and for a PNG', async () => {
    const [w, h] = [64, 48];
    const view: View = { center: [w / 2, h / 2], scale: 1 / 4 };
    const levelsOf = async (showTubes: boolean) => {
      const settings = flowing({ showTubes });
      const sim = await make(settings, w, h);
      const trail = new Float32Array(w * h * 4);
      // A wide band of weak trail without a tube, and one row with a full tube and ten times the trail.
      for (let c = 0; c < w * h; c++) trail[c * 4] = Math.floor(c / w) < 30 ? 1 + noise(c, 3) : 0;
      for (let x = 0; x < w; x++) trail[(40 * w + x) * 4] = 15;
      sim.writeTrail(trail);
      sim.writeFlow(memoryOf(w, h, (_, y) => (y === 40 ? [1, 1] : undefined)));
      const png = await backend.measured(sim);
      // The frames start from no levels. No measurement is on its way after a turn of the event loop, so one of
      // fifteen frames in a row starts one. Another measurement waits for it: after that the frames hold its levels.
      backend.forget();
      await new Promise((resolve) => setTimeout(resolve, 0));
      for (let i = 0; i < 15; i++) backend.draw(sim, settings, view, true);
      await backend.measured(sim);
      const frames = backend.levels();
      return { png, frames, settled: await backend.settle(sim) };
    };
    const [plain, tubes] = [await levelsOf(false), await levelsOf(true)];
    for (const place of ['png', 'frames', 'settled'] as const) {
      // The picture of the tubes holds other levels: the band is at a quarter, and the tube is wider. The frames of
      // WebGPU go a quarter of the way from the levels of before to a measurement. Every cell of this scene holds an
      // agent, so the black level is half the median trail of the picture (ADR 0062): with the tubes a quarter of the
      // one without them. Both black levels lie lower than the 65th percentile did, so the gains differ less.
      expect(Math.abs(tubes[place].gain / plain[place].gain - 1), place).toBeGreaterThan(0.02);
      expect(tubes[place].black, place).toBeGreaterThan(0);
      expect(tubes[place].black / plain[place].black, place).toBeLessThan(0.5);
      expect(tubes[place].strand, place).toBeGreaterThan(0);
      expect(tubes[place].strand, place).toBe(plain[place].strand);
    }
    // A measurement by itself and the one for a PNG give the same levels. The first one goes all the way from the
    // levels of the frames to its result, which can cost the last digits.
    for (const level of ['gain', 'black', 'strand'] as const)
      expect(tubes.png[level], level).toBeCloseTo(tubes.settled[level], 6);
  });

  // The frames. The tests above read the picture; these read what the view draws from it. Fixed levels and no bloom,
  // so that a pixel shows its own cells alone.
  const LEVELS: Levels = { gain: 0.2, black: 0, strand: 1 };

  it('draws a frame from the picture: zoomed in, zoomed out, and in every style that draws the trail', async () => {
    const [w, h] = [64, 48];
    // A full tube of one cell along row 24: the picture holds rows 21 to 27, the trail of the view row 24 alone.
    const trail = new Float32Array(w * h * 4);
    for (let x = 0; x < w; x++) trail[(24 * w + x) * 4] = 8;
    const tube = memoryOf(w, h, (_, y) => (y === 24 ? [1, 1] : undefined));
    const sim = await make(flowing({ bloom: 0 }), w, h);
    sim.writeTrail(trail);
    sim.writeFlow(tube);
    // 8 pixels per cell: the pixel (260, 196) is the centre of cell (32, 24), and (260, 220) of cell (32, 27).
    const near8: View = { center: [32, 24], scale: 1 / 8 };
    // 4 cells per pixel, where the view reads the coarse map of the trail: the pixel (8, 5) holds rows 20 to 23, and
    // the pixel (8, 6) rows 24 to 27.
    const far4: View = { center: [32, 24], scale: 4 };
    const frame = async (patch: Partial<Settings>, view: View) => {
      const settings = flowing({ bloom: 0, ...patch });
      sim.update(settings);
      const [cw, ch] = view === near8 ? [512, 384] : [16, 12];
      return backend.capture(sim, settings, view, cw, ch, LEVELS);
    };
    for (const style of ['glow', 'gel', 'paper'] as const) {
      const [on, off] = [await frame({ style }, near8), await frame({ style, showTubes: false }, near8)];
      // Three cells beside the trail: the tube with the switch, the ground without it.
      expect(pixelDiff(on, off, 260, 220), `${style}, beside the trail`).toBeGreaterThan(40);
      // On the trail both frames hold plasmodium. The gel style lights a ridge and a plateau in other ways, so only
      // the flat styles are compared there, and only in red: the tube is a whole vein, whose deeper shade has less
      // green and blue (ADR 0099).
      if (style !== 'gel')
        expect(Math.abs(red(on, 260, 196) - red(off, 260, 196)), `${style}, on the trail`).toBeLessThan(40);
    }
    const [on, off] = [await frame({}, near8), await frame({ showTubes: false }, near8)];
    expect([red(on, 260, 220), red(off, 260, 220)].map((v) => v > 120)).toEqual([true, false]);
    expect(red(off, 260, 220)).toBeLessThan(60);
    expect(red(on, 260, 228)).toBeLessThan(60); // 4 cells beside the trail: no tube
    // Zoomed out the pixel beside the trail holds three rows of the tube, or nothing.
    const [farOn, farOff] = [await frame({}, far4), await frame({ showTubes: false }, far4)];
    expect([red(farOn, 8, 5), red(farOff, 8, 5)].map((v) => v > 120)).toEqual([true, false]);
    expect(red(farOff, 8, 6)).toBeGreaterThan(60);
    // A new memory at the same step: the next frame shows it, zoomed in and from the coarse map.
    await frame({}, far4);
    sim.writeFlow(memoryOf(w, h, () => undefined));
    expect(red(await frame({}, far4), 8, 5)).toBeLessThan(60);
    expect(red(await frame({}, near8), 260, 220)).toBeLessThan(60);
    sim.writeFlow(tube);
    expect(red(await frame({}, far4), 8, 5)).toBeGreaterThan(120);
    expect(red(await frame({}, near8), 260, 220)).toBeGreaterThan(120);
  });

  it('takes the glow of a frame from the picture', async () => {
    const [w, h] = [64, 48];
    const trail = new Float32Array(w * h * 4);
    for (let x = 0; x < w; x++) trail[(24 * w + x) * 4] = 8;
    const sim = await make(flowing({ bloom: 1 }), w, h);
    sim.writeTrail(trail);
    sim.writeFlow(memoryOf(w, h, (_, y) => (y === 24 ? [1, 1] : undefined)));
    const view: View = { center: [32, 24], scale: 1 / 8 };
    const frame = async (patch: Partial<Settings>) => {
      const settings = flowing({ bloom: 1, ...patch });
      sim.update(settings);
      return backend.capture(sim, settings, view, 512, 384, LEVELS);
    };
    // Five cells beside the trail no cell holds a part of the picture. The glow of the tube, whose edge lies 2 cells
    // away, reaches it more than the glow of the trail alone, 5 cells away. Without the glow both pixels are ground.
    const y = 196 + 5 * 8;
    const [on, off] = [await frame({}), await frame({ showTubes: false })];
    expect(red(on, 260, y)).toBeGreaterThan(red(off, 260, y) + 10);
    const [dark, darkOff] = [await frame({ bloom: 0 }), await frame({ bloom: 0, showTubes: false })];
    expect(Math.abs(red(dark, 260, y) - red(darkOff, 260, y))).toBeLessThanOrEqual(2);
    expect(red(on, 260, y)).toBeGreaterThan(red(dark, 260, y) + 10);
  });

  it('draws the veins in the deep shade of their strain as the CPU reference says, and none without the picture', async () => {
    const [w, h] = [64, 48];
    // A band of tubes along rows 15 to 33 whose flow memory falls away from row 24: veins of every strength, from none
    // at the edges of the band to whole ones in its middle (VEINS.low to VEINS.high).
    const trail = new Float32Array(w * h * 4);
    for (let c = 0; c < w * h; c++) trail[c * 4] = 6;
    const memory = memoryOf(w, h, (_, y) => (Math.abs(y - 24) <= 9 ? [0.55 ** Math.abs(y - 24), 1] : undefined));
    const sim = await make(flowing({ bloom: 0 }), w, h);
    sim.writeTrail(trail);
    sim.writeFlow(memory);
    const grid: TubeGrid = { width: w, height: h, boundary: 'box', shape: await sim.readShape() };
    const view: View = { center: [32, 24], scale: 1 / 8 };
    const [cw, ch] = [512, 384];
    const color = hexToLinear(defaultStrain(0).color);
    const ground = hexToLinear(BACKGROUND.glow);
    /** The glow of strain A at a pixel (render.wgsl glow(), bloom 0, black level 0), as sRGB bytes without the dither. */
    const glowAt = (picture: Float32Array, roots: Float32Array | undefined, px: number, py: number) => {
      const [x, y] = [(px + 0.5 - cw / 2) * view.scale + 32, (py + 0.5 - ch / 2) * view.scale + 24];
      const [i, j] = [Math.floor(x - 0.5), Math.floor(y - 0.5)];
      const [fx, fy] = [x - 0.5 - i, y - 0.5 - j];
      const at = (a: number, b: number) => picture[(b * w + a) * 4] ?? 0;
      const v =
        (at(i, j) * (1 - fx) + at(i + 1, j) * fx) * (1 - fy) + (at(i, j + 1) * (1 - fx) + at(i + 1, j + 1) * fx) * fy;
      const deep = roots ? (veinDeep(grid, roots, x, y)[0] ?? 0) : 0;
      return {
        deep,
        bytes: veinShade(color, deep).map((c, k) =>
          toByte((ground[k] ?? 0) + (1 - (ground[k] ?? 0)) * (1 - Math.exp(-v * c * LEVELS.gain))),
        ),
      };
    };
    const frame = async (patch: Partial<Settings>) => {
      const settings = flowing({ bloom: 0, ...patch });
      sim.update(settings);
      return backend.capture(sim, settings, view, cw, ch, LEVELS);
    };
    // Every 3rd pixel of a column across the band, and of a row along its middle.
    const pixels: [number, number][] = [];
    for (let py = 96; py < 288; py += 3) pixels.push([260, py]);
    for (let px = 40; px < 480; px += 11) pixels.push([px, 196]);
    for (const patch of [{}, { showTubes: false }, { flow: false }]) {
      const img = await frame(patch);
      const picture = await sim.readPicture();
      const roots = patch.showTubes === false || patch.flow === false ? undefined : await sim.readTubeRoots();
      let [worstOff, whole, part, apart] = [0, 0, 0, 0];
      for (const [px, py] of pixels) {
        const want = glowAt(picture, roots, px, py);
        const got = [0, 1, 2].map((k) => img.data[(py * cw + px) * 4 + k] ?? 0);
        // The dither adds up to 1 byte.
        worstOff = Math.max(worstOff, ...got.map((g, k) => Math.abs(g - (want.bytes[k] ?? 0))));
        if (want.deep >= 0.95 * VEINS.deep) whole++;
        else if (want.deep > 0.05) part++;
        const plain = glowAt(picture, undefined, px, py).bytes;
        if (Math.max(...plain.map((b, k) => Math.abs(b - (want.bytes[k] ?? 0)))) > 20) apart++;
      }
      expect(worstOff, JSON.stringify(patch)).toBeLessThanOrEqual(2);
      if (roots) {
        // The case is not empty: whole veins, veins in part, and both far from the colour of the strain.
        expect([whole, part].map((n) => n > 10)).toEqual([true, true]);
        expect(apart).toBeGreaterThan(40);
      } else {
        expect(whole + part).toBe(0);
      }
    }
  });

  it('draws the scent of the state of each frame under the picture', async () => {
    const [w, h] = [48, 32];
    // No agent lives, so no cell holds trail, and the picture of the tubes is empty with the switch on and off. A
    // food gives scent, which grows from step to step. Two simulations run the same steps: one draws with the
    // picture, the other without it. Their frames must show the same scent.
    const scene = (showTubes: boolean) =>
      flowing({ showTubes, showScent: true, bloom: 0, collisions: false, strains: [defaultStrain(0)] });
    const sims = await Promise.all(
      [true, false].map(async (showTubes) => {
        const sim = await backend.createSim(scene(showTubes), w, h, 8, 0);
        live.push(sim);
        const food: FoodStroke = [{ kind: 'food', from: [24.5, 16.5], to: [24.5, 16.5], radius: 3 }];
        sim.paint(food);
        sim.foodSites(flowSites([food], w, h, 'box'));
        sim.reset();
        return sim;
      }),
    );
    const view: View = { center: [24, 16], scale: 1 / 8 };
    const frames = (step: number) =>
      Promise.all(
        sims.map((sim, i) => {
          if (sim.step < step) sim.run(step - sim.step);
          return backend.capture(sim, scene(i === 0), view, 384, 256, LEVELS);
        }),
      );
    let before: ImageData | undefined;
    for (const step of [1, 2, 3, 4, 5]) {
      const [withTubes, plain] = await frames(step);
      if (!withTubes || !plain) throw new Error('no frame');
      // The dither of a frame differs by its count: 2 of 255 at most.
      expect(frameDiff(withTubes, plain), `step ${String(step)}`).toBeLessThanOrEqual(2);
      // The scent of this step is not that of the step before: a frame with the scent of another state would show.
      if (before) expect(frameDiff(plain, before), `step ${String(step)} against the step before`).toBeGreaterThan(8);
      before = plain;
    }
  });

  it('keeps drawing when settings free and make the textures that the picture reads', async () => {
    const [w, h] = [40, 32];
    const strain = { ...defaultStrain(0), sensorOffset: 5 };
    const moving = (patch: Partial<Settings>) =>
      flowing({ stepOrder: 'move-first', diffusion: 2, strains: [strain], ...patch });
    const sim = await backend.createSim(moving({}), w, h, 300);
    live.push(sim);
    const device = kind === 'webgpu' ? instance(backend, WebGpuBackend).gpu.device : undefined;
    const view: View = { center: [20, 16], scale: 1 / 4 };
    /**
     * New settings, then twice: a step, a memory with a tube on every cell, the picture against the rule and a frame.
     * Twice, because the memory of the flow is in one of two textures, in turns, and the picture reads the one of
     * the step.
     */
    const check = async (settings: Settings, what: string) => {
      sim.update(settings);
      for (const step of ['first', 'second']) {
        sim.run(1);
        for (let s = 0; s < settings.strains.length; s++)
          sim.writeFlow(
            memoryOf(w, h, () => [0.3, 1]),
            s,
          );
        // Without the switch the picture is the trail of the view.
        const want = settings.showTubes
          ? (await reference(sim, 'box', settings.strains.length)).picture
          : await sim.readView();
        expect(worst(await sim.readPicture(), want, 1), `${what}, ${step} step`).toBeLessThan(1e-5);
        const img = await backend.capture(sim, settings, view, 160, 128, LEVELS);
        let lit = 0;
        for (let i = 0; i < img.data.length; i += 4) if ((img.data[i] ?? 0) > 80) lit++;
        expect(lit, `${what}, ${step} step: pixels of the frame that show plasmodium`).toBeGreaterThan(50);
      }
    };
    device?.pushErrorScope('validation');
    // Two diffusion passes: the view of a step that moves first is in a third pair of textures. One pass: that pair
    // is freed, and the view is in the free pair. Then back, then a step that senses first, then a second strain,
    // whose flow needs textures with one more layer.
    await check(moving({}), 'two passes');
    await check(moving({ diffusion: 1 }), 'one pass');
    await check(moving({}), 'two passes again');
    await check(moving({ stepOrder: 'sense-first' }), 'sensing first');
    await check(moving({ strains: [strain, { ...defaultStrain(1), sensorOffset: 5 }] }), 'two strains');
    await check(moving({ showTubes: false }), 'without the picture');
    // Without the picture the frames draw the grains from a stream of their own (ADR 0095). The flow frees the stream
    // and makes it again, and a frame must not keep the stream of a frame before.
    await check(moving({ showTubes: false, flow: false }), 'without the picture and the flow');
    await check(moving({ showTubes: false }), 'without the picture, with the flow again');
    await check(moving({}), 'with the picture again');
    expect((await device?.popErrorScope())?.message).toBeUndefined();
  }, 120_000);

  it('stops a disc at a wall across the edge of the periodic grid', async () => {
    const [w, h] = [40, 24];
    const sim = await make(flowing(), w, h);
    // A wall of one column at the left edge of a box, and a full tube along the column at the right edge.
    sim.paint([{ kind: 'wall', from: [0.5, 0], to: [0.5, h], radius: 0.75 }]);
    const env = await sim.readEnv();
    expect([0, 1].map((x) => (env[(12 * w + x) * 4] ?? 0) >= 128)).toEqual([true, false]);
    const trail = new Float32Array(w * h * 4);
    for (let y = 0; y < h; y++) trail[(y * w + w - 1) * 4] = 8;
    const tube = memoryOf(w, h, (x) => (x === w - 1 ? [1, 1] : undefined));
    sim.writeTrail(trail);
    sim.writeFlow(tube);
    const at = (picture: Float32Array, x: number) => near(picture[(12 * w + x) * 4]);
    // In the box the tube is far from the columns 1 and 2. On the periodic grid it lies beside the wall, and the
    // columns 1 and 2 lie behind the wall, 2 and 3 cells from the tube.
    const boxed = await sim.readPicture();
    expect([w - 2, 1, 2].map((x) => at(boxed, x))).toEqual([8, 0, 0]);
    sim.update(flowing({ boundary: 'wrap' }));
    const wrapped = await sim.readPicture();
    expect([w - 2, w - 1, 0, 1, 2].map((x) => at(wrapped, x))).toEqual([8, 8, 0, 0, 0]);
    const want = await reference(sim, 'wrap', 1);
    expect(worst(wrapped, want.picture, 1)).toBeLessThan(1e-5);
    // Without the wall the tube reaches 3 columns across the edge.
    sim.clearEnvironment();
    sim.writeTrail(trail);
    sim.writeFlow(tube);
    const open = await sim.readPicture();
    expect([w - 1, 0, 1, 2, 3].map((x) => at(open, x))).toEqual([8, 8, 8, 8, 0]);
  });

  it('keeps the rule of a corner across the edge of the periodic grid and at the rim of a dish', async () => {
    const [w, h] = [32, 24];
    const [weak, both] = [(0.0025 / 3) ** 0.25, ((0.0025 + 1) / 3) ** 0.25];
    /** A weak tube on the cell p and a strong one on the cell q, and no other tube. */
    const pair = (p: readonly [number, number], q: readonly [number, number]) =>
      memoryOf(w, h, (x, y) =>
        x === p[0] && y === p[1] ? [0.0025, 1] : x === q[0] && y === q[1] ? [1, 1] : undefined,
      );
    const walls = (cells: (readonly [number, number])[]) => {
      const env = new Uint8Array(w * h * 4);
      for (const [x, y] of cells) env[(y * w + x) * 4] = 255;
      return env;
    };
    // On the periodic grid the cells (0, 10) and (31, 11) touch at a corner across the edge. The two cells beside
    // that corner are (31, 10) and (0, 11). Without walls the weak cell takes the strong one, and with a wall on
    // both it does not.
    const torus = await make(flowing({ boundary: 'wrap' }), w, h);
    torus.writeFlow(pair([0, 10], [31, 11]));
    expect((await torus.readTubeRoots())[10 * w * 4]).toBeCloseTo(both, 5);
    torus.writeEnv(
      walls([
        [31, 10],
        [0, 11],
      ]),
    );
    torus.writeFlow(pair([0, 10], [31, 11]));
    const across = await torus.readTubeRoots();
    expect(across[10 * w * 4]).toBeCloseTo(weak, 5);
    expect(worst(across, (await reference(torus, 'wrap', 1)).roots)).toBeLessThan(1e-5);

    // In a dish: two cells inside that touch at a corner, with one cell beside that corner outside the rim and the
    // other inside. Both are walls in a box. In the dish the cell outside keeps the byte of a wall, but it is no
    // wall of the dish, as for a move and for a child of growth: the two cells are not parted.
    const rim: TubeGrid = { width: w, height: h, boundary: 'dish', shape: new Uint8Array(w * h * 4) };
    const inside = (x: number, y: number) => arenaCell(rim, x, y) >= 0;
    let found: [number, number] | undefined;
    for (let y = 0; y < h - 1 && !found; y++)
      for (let x = 0; x < w - 1 && !found; x++)
        if (inside(x, y) && inside(x + 1, y + 1) && inside(x, y + 1) && !inside(x + 1, y)) found = [x, y];
    expect(found).toBeDefined();
    const [x, y] = found ?? [0, 0];
    const dish = await make(flowing({ boundary: 'box' }), w, h);
    dish.writeEnv(
      walls([
        [x + 1, y],
        [x, y + 1],
      ]),
    );
    expect(((await dish.readShape())[(y * w + x + 1) * 4] ?? 0) >= 128).toBe(true);
    dish.update(flowing({ boundary: 'dish' }));
    dish.writeFlow(pair([x, y], [x + 1, y + 1]));
    const atRim = await dish.readTubeRoots();
    expect(((await dish.readShape())[(y * w + x + 1) * 4] ?? 0) >= 128).toBe(true);
    expect(atRim[(y * w + x) * 4]).toBeCloseTo(both, 5);
    expect(worst(atRim, (await reference(dish, 'dish', 1)).roots)).toBeLessThan(1e-5);
  });

  it('stops a disc at a wall cell beside its line, and at wall cells that touch at a corner', async () => {
    const [w, h] = [32, 24];
    const sim = await make(flowing(), w, h);
    // Walls written as cells: one wall cell alone at (16, 12), and a wall along a diagonal whose cells touch at
    // their corners only.
    const env = new Uint8Array(w * h * 4);
    env[(12 * w + 16) * 4] = 255;
    for (let k = 0; k < 9; k++) env[((12 + k) * w + 3 + k) * 4] = 255;
    sim.writeEnv(env);
    // A full tube on every open cell, and a trail that differs from cell to cell: every disc reaches as far as the
    // walls let it, so one disc too many or too few changes the picture.
    const trail = new Float32Array(w * h * 4);
    for (let c = 0; c < w * h; c++) trail[c * 4] = (env[c * 4] ?? 0) >= 128 ? 0 : 1 + 19 * noise(c, 3);
    sim.writeTrail(trail);
    sim.writeFlow(memoryOf(w, h, (x, y) => ((env[(y * w + x) * 4] ?? 0) >= 128 ? undefined : [1, 1])));
    // The picture is read first: nothing else has asked the simulation for the wall bytes of the new cells yet.
    const picture = await sim.readPicture();
    const want = await reference(sim, 'box', 1);
    expect(worst(picture, want.picture, 1)).toBeLessThan(1e-5);
    // The walls stop many discs on their line.
    const grid: TubeGrid = { width: w, height: h, boundary: 'box', shape: await sim.readShape() };
    expect(stoppedDiscs(grid, want.roots)).toBeGreaterThan(500);
    expect(picture[(12 * w + 16) * 4]).toBe(0);
    // The cell (4, 12) lies beside the diagonal wall and (3, 13) across it, where two wall cells touch at a corner.
    // A trail on (4, 12) alone shows in no cell across the wall.
    const corner = new Float32Array(w * h * 4);
    corner[(12 * w + 4) * 4] = 8;
    sim.writeTrail(corner);
    const across = await sim.readPicture();
    expect(across[(12 * w + 4) * 4]).toBeGreaterThan(0);
    for (const [x, y] of [
      [3, 13],
      [2, 13],
      [3, 14],
      [4, 14],
      [2, 12],
    ] as const)
      expect(across[(y * w + x) * 4], `(${String(x)}, ${String(y)})`).toBe(0);
    // The strength across a tube stays on its side of the diagonal wall. A weak tube runs along one side of it and a
    // strong tube along the other side: a cell of the weak one touches a cell of the strong one at a corner, between
    // two wall cells. It takes only the three cells of its own tube: 3 × 0.0025 over 3.
    sim.writeFlow(memoryOf(w, h, (x, y) => (y === x + 8 ? [0.0025, 1] : y === x + 10 ? [1, 1] : undefined)));
    const [factors, sides] = [await sim.readTubeRoots(), await reference(sim, 'box', 1)];
    expect(worst(factors, sides.roots)).toBeLessThan(1e-5);
    expect(factors[(16 * w + 8) * 4]).toBeCloseTo(0.0025 ** 0.25, 5);
    expect(factors[(17 * w + 7) * 4]).toBeCloseTo(1, 5);

    // One tube cell alone, diagonally beside the wall cell: its disc reaches neither the wall cell nor the cell
    // behind it, 2.83 cells away on the line through the wall cell. Away from the wall cell it reaches as far.
    const lone = new Float32Array(w * h * 4);
    lone[(11 * w + 15) * 4] = 8;
    const dot = memoryOf(w, h, (x, y) => (x === 15 && y === 11 ? [1, 1] : undefined));
    sim.writeTrail(lone);
    sim.writeFlow(dot);
    const walled = await sim.readPicture();
    expect([walled[(12 * w + 16) * 4], walled[(13 * w + 17) * 4]]).toEqual([0, 0]);
    expect(walled[(9 * w + 13) * 4]).toBeGreaterThan(1);
    // Without the wall cell the disc reaches both cells.
    sim.clearEnvironment();
    sim.writeTrail(lone);
    sim.writeFlow(dot);
    const free = await sim.readPicture();
    expect(free[(12 * w + 16) * 4]).toBeGreaterThan(4);
    expect(free[(13 * w + 17) * 4]).toBeGreaterThan(1);
  });

  it('measures the levels with the textures of the moment, also when settings free the picture meanwhile', async () => {
    const [w, h] = [32, 24];
    const sim = await make(flowing(), w, h);
    const trail = new Float32Array(w * h * 4);
    for (let c = 0; c < w * h; c++) trail[c * 4] = 1 + noise(c, 7);
    sim.writeTrail(trail);
    sim.writeFlow(memoryOf(w, h, (_, y) => (y === 12 ? [1, 1] : undefined)));
    const device = kind === 'webgpu' ? instance(backend, WebGpuBackend).gpu.device : undefined;
    device?.pushErrorScope('validation');
    // The second measurement and the one for a PNG wait for the first. Meanwhile the switch goes off, and the
    // simulation frees the picture: they must measure the trail that is drawn then, not a texture that is gone.
    const first = backend.settle(sim);
    const second = backend.settle(sim);
    const png = backend.measured(sim);
    sim.update(flowing({ showTubes: false }));
    const [withTubes, plain, forPng] = [await first, await second, await png];
    expect((await device?.popErrorScope())?.message).toBeUndefined();
    expect(withTubes.gain).toBeGreaterThan(0);
    // The levels of the trail alone: those that a new measurement gives.
    const fresh = await backend.settle(sim);
    expect(plain.gain).toBeCloseTo(fresh.gain, 6);
    expect(forPng.gain).toBeCloseTo(fresh.gain, 6);
    expect(fresh.gain).not.toBeCloseTo(withTubes.gain, 2);
  });

  it('measures for a PNG that waited while the levels of the frames started anew', async () => {
    const [w, h] = [32, 24];
    const sim = await make(flowing(), w, h);
    const trail = new Float32Array(w * h * 4);
    for (let c = 0; c < w * h; c++) trail[c * 4] = 1 + noise(c, 7);
    sim.writeTrail(trail);
    sim.writeFlow(memoryOf(w, h, (_, y) => (y === 12 ? [1, 1] : undefined)));
    // The measurement for a PNG waits for the first one. A restart of the run starts the levels of the frames anew
    // in that time (Engine.reset()): the first measurement is one of the old run and is dropped, and the one for
    // the PNG still measures the simulation.
    const first = backend.settle(sim);
    const png = backend.measured(sim);
    backend.forget();
    const [dropped, forPng] = [await first, await png];
    expect(dropped.gain).toBe(0);
    const fresh = await backend.settle(sim);
    expect(fresh.gain).toBeGreaterThan(0);
    expect(forPng.gain).toBeCloseTo(fresh.gain, 6);
    expect(forPng.strand).toBeCloseTo(fresh.strand, 6);
  });

  it('asks a simulation for nothing once it is destroyed, when a measurement waited for another one', async () => {
    const [w, h] = [32, 24];
    // A step that moves first, with two diffusion passes: the view of this simulation is in textures that it makes
    // when it is asked for them. It is destroyed below, so afterEach() must not do it again.
    const sim = await backend.createSim(flowing({ stepOrder: 'move-first', diffusion: 2 }), w, h, 8);
    const trail = new Float32Array(w * h * 4);
    for (let c = 0; c < w * h; c++) trail[c * 4] = 1 + noise(c, 7);
    sim.writeTrail(trail);
    sim.writeFlow(memoryOf(w, h, (_, y) => (y === 12 ? [1, 1] : undefined)));
    const device = kind === 'webgpu' ? instance(backend, WebGpuBackend).gpu.device : undefined;
    const gl = kind === 'webgl2' ? (backend as unknown as { gl: WebGL2RenderingContext }).gl : undefined;
    device?.pushErrorScope('validation');
    gl?.getError();
    // The measurement for a PNG and a second one wait for the first. A rebuild of the engine destroys the simulation
    // in that time (Engine.rebuild()).
    const first = backend.settle(sim);
    const png = backend.measured(sim);
    const second = backend.settle(sim);
    sim.destroy();
    const [before, forPng, after] = [await first, await png, await second];
    expect((await device?.popErrorScope())?.message).toBeUndefined();
    if (gl) expect(gl.getError()).toBe(gl.NO_ERROR);
    // The first measurement was on its way. The two others measure nothing: they give the levels of the frames.
    expect(before.gain).toBeGreaterThan(0);
    expect([forPng, after]).toEqual([before, before]);
  });

  it('draws nothing of a simulation that is destroyed while a picture waits for the scent view', async () => {
    const [w, h] = [32, 24];
    const view: View = { center: [w / 2, h / 2], scale: 1 / 4 };
    // A backend of its own: it has not built the programs of the scent view yet, so its first picture with the scent
    // view waits for them. A rebuild of the engine destroys the simulation in that time (Engine.rebuild()).
    const fresh = await create(document.createElement('canvas'));
    // On WebGL2 a machine without parallel shader compiling has the programs at once, as the image of CI. The test
    // holds them back until the simulation is destroyed, so that the picture waits on every machine. On WebGPU a
    // picture always waits for its pipelines.
    let release: (() => void) | undefined;
    if (kind === 'webgl2') {
      const prog = (fresh as unknown as { prog: { scent: () => unknown } }).prog;
      const scent = prog.scent.bind(prog);
      let held = true;
      prog.scent = () => (held ? undefined : scent());
      release = () => {
        held = false;
      };
    }
    const settings = flowing({ showScent: true });
    const sim = await fresh.createSim(settings, w, h, 8);
    const trail = new Float32Array(w * h * 4);
    for (let c = 0; c < w * h; c++) trail[c * 4] = 1 + noise(c, 7);
    sim.writeTrail(trail);
    sim.writeFlow(memoryOf(w, h, (_, y) => (y === 12 ? [1, 1] : undefined)));
    const device = kind === 'webgpu' ? instance(fresh, WebGpuBackend).gpu.device : undefined;
    const gl = kind === 'webgl2' ? (fresh as unknown as { gl: WebGL2RenderingContext }).gl : undefined;
    device?.pushErrorScope('validation');
    gl?.getError();
    const waiting = fresh.capture(sim, settings, view, 32, 24);
    sim.destroy();
    release?.();
    const image = await waiting;
    expect((await device?.popErrorScope())?.message).toBeUndefined();
    if (gl) expect(gl.getError()).toBe(gl.NO_ERROR);
    // Nothing is left to draw: the picture is empty, and the engine asks again for its new simulation.
    expect([image.width, image.height, Math.max(...image.data)]).toEqual([32, 24, 0]);
    // The same for a picture that is asked of a simulation that is gone already.
    device?.pushErrorScope('validation');
    const late = await fresh.capture(sim, settings, view, 32, 24);
    expect((await device?.popErrorScope())?.message).toBeUndefined();
    if (gl) expect(gl.getError()).toBe(gl.NO_ERROR);
    expect(Math.max(...late.data)).toBe(0);
    fresh.destroy();
  }, 120_000);
  // The stream of the plasm (tubes.ts, point 6): the pass against the CPU reference, plain cases, and the grains that
  // the view draws from it.
  /** A memory with a tube of the conductivity that `of` gives for a cell (body 1), and none where it gives 0. */
  function conducting(w: number, h: number, of: (x: number, y: number) => number) {
    const m = new Float32Array(w * h * 4);
    for (let c = 0; c < w * h; c++) {
      const g = of(c % w, Math.floor(c / w));
      m.set(g > 0 ? [1, 1, g, 0] : [FLOW.fresh, 0, 0, 0], c * 4);
    }
    return m;
  }

  /** A pressure with what `of` gives for a cell in each of the 4 lanes. */
  function pressing(w: number, h: number, of: (x: number, y: number) => [number, number, number, number]) {
    const p = new Float32Array(w * h * 4);
    for (let c = 0; c < w * h; c++) p.set(of(c % w, Math.floor(c / w)), c * 4);
    return p;
  }

  /** The stream that the reference gives for the state of a simulation. */
  async function streamReference(sim: Sim, boundary: Boundary, strains: number) {
    const grid: TubeGrid = { width: sim.width, height: sim.height, boundary, shape: await sim.readShape() };
    const each = <T>(of: (s: number) => Promise<T>) => Promise.all(Array.from({ length: strains }, (_, s) => of(s)));
    return tubeStream(grid, await each((s) => sim.readFlow(s)), await each((s) => sim.readPressure(s)));
  }

  it.each(['box', 'wrap', 'dish'] as const)(
    'gives the stream of the CPU reference on a %s grid with four strains',
    async (boundary) => {
      const [w, h] = [40, 32];
      const sim = await make(flowing({ boundary, strains: [0, 1, 2, 3].map((i) => defaultStrain(i)) }), w, h);
      for (let s = 0; s < 4; s++) {
        const memory = new Float32Array(w * h * 4);
        const pressure = new Float32Array(w * h * 4);
        for (let c = 0; c < w * h; c++) {
          // Half the cells hold a tube. A body on both sides of the least one, and some tubes that conduct nothing.
          const body = noise(c, 10 + s) < 0.5 ? 0.08 * noise(c, 20 + s) : noise(c, 30 + s);
          const d = 10 ** (-4 * noise(c, 40 + s));
          // The conductivity as the model gives it to a tube (model.md, 8.1).
          memory.set([d, body, noise(c, 50 + s) < 0.1 ? 0 : body * (0.02 + d), 0], c * 4);
          // Pressures that give speeds below 1 and above it.
          for (let lane = 0; lane < 4; lane++) pressure[c * 4 + lane] = 25 * noise(c, 60 + 4 * s + lane) ** 2;
        }
        sim.writeFlow(memory, s);
        sim.writePressure(pressure, s);
      }
      const want = await streamReference(sim, boundary, 4);
      const got = await sim.readStream();
      expect(got.length).toBe(w * h * 4);
      expect(worst(got, want, 1)).toBeLessThan(1e-4);
      // The case is not empty: cells without a stream, cells at the largest speed, and cells between the two.
      const speeds = Array.from({ length: w * h }, (_, c) => Math.hypot(want[c * 4] ?? 0, want[c * 4 + 1] ?? 0));
      const share = (of: (v: number) => boolean) => speeds.filter(of).length / speeds.length;
      const shares = [share((v) => v === 0), share((v) => v > 0.05 && v < 0.95), share((v) => v > 0.999)];
      for (const part of shares) expect(part, shares.join(' ')).toBeGreaterThan(0.03);
    },
  );

  // ADR 0086: over 8 neighbours the stream follows the 8 edges of the flow. A thin diagonal wall, whose cells touch
  // only at their corners, bars every diagonal edge across it, and a wall along a column has two ends.
  it.each(['box', 'wrap', 'dish'] as const)(
    'gives the stream of the CPU reference over 8 neighbours on a %s grid with walls',
    async (boundary) => {
      const [w, h] = [40, 32];
      const sim = await make(flowing({ boundary, flowEdges: 8, strains: [0, 1].map((i) => defaultStrain(i)) }), w, h);
      sim.paint([
        { kind: 'wall', from: [6, 4], to: [20, 18], radius: 0.5 },
        { kind: 'wall', from: [30.5, 2], to: [30.5, 28], radius: 0.5 },
      ]);
      const grid: TubeGrid = { width: w, height: h, boundary, shape: await sim.readShape() };
      const wall = (c: number) => (grid.shape[c * 4] ?? 0) >= 128;
      // The thin wall: (10, 8) and (11, 9) are walls, the cells beside them at the corner, (11, 8) and (10, 9), are not.
      expect([wall(8 * w + 10), wall(9 * w + 11), wall(8 * w + 11), wall(9 * w + 10)]).toEqual([
        true,
        true,
        false,
        false,
      ]);
      const [memories, pressures] = [
        [0, 1].map(() => new Float32Array(w * h * 4)),
        [0, 1].map(() => new Float32Array(w * h * 4)),
      ];
      for (let s = 0; s < 2; s++) {
        const [memory, pressure] = [memories[s] ?? new Float32Array(0), pressures[s] ?? new Float32Array(0)];
        for (let c = 0; c < w * h; c++) {
          // A tube on most cells, none on a wall, and pressures that give speeds below 1 and above it.
          const body = wall(c) || noise(c, 70 + s) < 0.2 ? 0 : noise(c, 80 + s);
          const d = 10 ** (-4 * noise(c, 90 + s));
          memory.set([d, body, body > 0 ? body * (0.02 + d) : 0, 0], c * 4);
          for (let lane = 0; lane < 4; lane++) pressure[c * 4 + lane] = 25 * noise(c, 100 + 4 * s + lane) ** 2;
        }
        sim.writeFlow(memory, s);
        sim.writePressure(pressure, s);
      }
      const want = tubeStream(grid, memories, pressures, true);
      const got = await sim.readStream();
      expect(worst(got, want, 1)).toBeLessThan(1e-4);
      // The stream over 4 neighbours is another one: the test sees the diagonal edges.
      expect(worst(tubeStream(grid, memories, pressures), want, 1)).toBeGreaterThan(0.05);
    },
  );

  it('gives a stream from high to low pressure, as fast as the flux over the root of the conductivity', async () => {
    const [w, h] = [24, 12];
    const sim = await make(flowing({ strains: [defaultStrain(0), defaultStrain(1)] }), w, h);
    const at = (stream: Float32Array, x: number, y: number) =>
      [stream[(y * w + x) * 4], stream[(y * w + x) * 4 + 1]].map((v) => near(v));
    // A tube along a row with a conductivity of 0.25. The pressure of one lane falls by 2 per cell to the east: the
    // flux is 0.5, and over the root of 0.25 and over STREAM.fast that is a speed of 0.5 (tubes.test.ts has the sum).
    const row = conducting(w, h, (x, y) => (y === 6 && x >= 4 && x <= 19 ? 0.25 : 0));
    expect(STREAM.fast).toBe(2);
    sim.writeFlow(row, 0);
    sim.writePressure(
      pressing(w, h, (x) => [0, 0, -2 * x, 0]),
      0,
    );
    const east = await sim.readStream();
    expect(at(east, 10, 6)).toEqual([0.5, 0]);
    expect(at(east, 4, 6)).toEqual([0.25, 0]);
    expect(at(east, 10, 5)).toEqual([0, 0]);
    // The other way round, and a lane with a larger flux the first way: the largest counts, cut to a speed of 1.
    sim.writePressure(
      pressing(w, h, (x) => [0, 0, 2 * x, 0]),
      0,
    );
    expect(at(await sim.readStream(), 10, 6)).toEqual([-0.5, 0]);
    sim.writePressure(
      pressing(w, h, (x) => [0, -5 * x, 2 * x, 0]),
      0,
    );
    expect(at(await sim.readStream(), 10, 6)).toEqual([1, 0]);
    // A tube down the grid, where y grows.
    sim.writeFlow(
      conducting(w, h, (x, y) => (x === 12 && y >= 2 && y <= 9 ? 0.25 : 0)),
      0,
    );
    sim.writePressure(
      pressing(w, h, (_, y) => [-2 * y, 0, 0, 0]),
      0,
    );
    expect(at(await sim.readStream(), 12, 5)).toEqual([0, 0.5]);
    // Two strains in the same tube: the faster flow counts.
    sim.writeFlow(row, 0);
    sim.writeFlow(row, 1);
    sim.writePressure(
      pressing(w, h, (x) => [-x, 0, 0, 0]),
      0,
    );
    sim.writePressure(
      pressing(w, h, (x) => [2 * x, 0, 0, 0]),
      1,
    );
    expect(at(await sim.readStream(), 10, 6)).toEqual([-0.5, 0]);
    expect(worst(await sim.readStream(), await streamReference(sim, 'box', 2), 1)).toBeLessThan(1e-5);
  });

  it('gives the stream with the switch of the picture on or off, and none in the agents style or without the flow', async () => {
    // ADR 0095: the switch changes only the tubes, and the grains follow the stream without the picture too.
    const [w, h] = [24, 12];
    const sim = await make(flowing(), w, h);
    const at = (stream: Float32Array) => near(stream[(6 * w + 10) * 4]);
    const east = pressing(w, h, (x) => [0, 0, -2 * x, 0]);
    sim.writeFlow(conducting(w, h, (x, y) => (y === 6 && x >= 4 && x <= 19 ? 0.25 : 0)));
    sim.writePressure(east);
    const on = await sim.readStream();
    expect(at(on)).toBe(0.5);
    sim.update(flowing({ showTubes: false }));
    expect([...(await sim.readStream())]).toEqual([...on]);
    // No picture of the tubes: the picture is the trail of the view.
    expect((await sim.readTubeRoots()).length).toBe(0);
    expect([...(await sim.readPicture())]).toEqual([...(await sim.readView())]);
    // The stream follows a new pressure without the picture.
    sim.writePressure(pressing(w, h, (x) => [0, 0, 2 * x, 0]));
    expect(at(await sim.readStream())).toBe(-0.5);
    sim.writePressure(east);
    // The agents style draws no grains, with the switch on or off, and the stream comes back with a style of the trail.
    for (const showTubes of [true, false]) {
      sim.update(flowing({ showTubes, style: 'agents' }));
      expect((await sim.readStream()).length, `agents, switch ${String(showTubes)}`).toBe(0);
      sim.update(flowing({ showTubes }));
      expect([...(await sim.readStream())], `glow, switch ${String(showTubes)}`).toEqual([...on]);
    }
    sim.update(flowing({ showTubes: false, flow: false }));
    expect((await sim.readStream()).length).toBe(0);
  });

  it('moves grains along the stream in every style that draws the trail, and draws none without a flow', async () => {
    const [w, h] = [64, 48];
    const sim = await make(flowing({ bloom: 0 }), w, h);
    // A band of trail with a tube in every cell. The pressure falls to the east, so the stream is (0.5, 0) in the band.
    const trail = new Float32Array(w * h * 4);
    for (let y = 18; y <= 30; y++) for (let x = 0; x < w; x++) trail[(y * w + x) * 4] = 8;
    sim.writeTrail(trail);
    sim.writeFlow(conducting(w, h, (_, y) => (y >= 18 && y <= 30 ? 0.25 : 0)));
    const flowing8 = pressing(w, h, (x) => [-2 * x, 0, 0, 0]);
    sim.writePressure(flowing8);
    expect(near((await sim.readStream())[(24 * w + 32) * 4])).toBe(0.5);
    // 8 pixels per cell around the cell (32, 24).
    const view: View = { center: [32, 24], scale: 1 / 8 };
    const frame = async (step: number, style: Settings['style'] = 'glow', showTubes = true) => {
      // The pattern of the grains follows the step of the state (render.ts packView()).
      (sim as unknown as { step: number }).step = step;
      const settings = flowing({ bloom: 0, style, showTubes });
      sim.update(settings);
      return backend.capture(sim, settings, view, 512, 384, LEVELS);
    };
    /** The brightness of the rows of pixels well inside the band, as one list. */
    const band = (img: ImageData) => {
      const rows: number[][] = [];
      for (let y = 140; y < 244; y += 4)
        rows.push(Array.from({ length: 512 }, (_, x) => red(img, x, y) + (img.data[(y * 512 + x) * 4 + 1] ?? 0)));
      return rows;
    };
    /** The shift in pixels to the east at which the grains of `b` lie best on the grains of `a`. */
    const shift = (a: number[][], b: number[][]) => {
      const centred = (rows: number[][]) => rows.map((r) => r.map((v) => v - r.reduce((x, y) => x + y, 0) / r.length));
      const [ca, cb] = [centred(a), centred(b)];
      let best = [0, -Infinity];
      for (let s = -24; s <= 24; s++) {
        let sum = 0;
        ca.forEach((r, j) => {
          for (let x = 32; x < 480; x++) sum += (r[x] ?? 0) * (cb[j]?.[x + s] ?? 0);
        });
        if (sum > (best[1] ?? 0)) best = [s, sum];
      }
      return best[0];
    };
    // A grain goes on with the stream, 10 cells in a period of 32 steps where the speed is 1, and it goes back and
    // forth, 12 cells to each side in a swing of 60 steps. The speed is 0.5 here. From step 4 to step 6 the grains go
    // on by 0.31 cells, and the swing takes them 12 × 0.5 × (sin 36° − sin 24°) = 1.09 cells on: 1.40 cells, 11
    // pixels, to the east.
    expect([STREAM.period, STREAM.swing]).toEqual([32, 60]);
    const [early, late] = [band(await frame(4)), band(await frame(6))];
    const moved = shift(early, late);
    expect(moved).toBeGreaterThanOrEqual(10);
    expect(moved).toBeLessThanOrEqual(12);
    // Later in the swing the grains come back. From step 22 to step 26 they go on by 0.63 cells, and the swing takes
    // them 12 × 0.5 × (sin 156° − sin 132°) = −2.02 cells: 1.39 cells, 11 pixels, back to the west.
    const back = shift(band(await frame(22)), band(await frame(26)));
    expect(back).toBeGreaterThanOrEqual(-12);
    expect(back).toBeLessThanOrEqual(-10);
    // The grains are there: the band is not flat along a row.
    const spread = (rows: number[][]) => Math.max(...rows.map((r) => Math.max(...r) - Math.min(...r)));
    expect(spread(early)).toBeGreaterThan(40);
    // With the pressure the other way the grains move to the west first.
    sim.writePressure(pressing(w, h, (x) => [2 * x, 0, 0, 0]));
    expect(shift(band(await frame(4)), band(await frame(6)))).toBeLessThanOrEqual(-10);
    // The gel and the paper show grains too.
    sim.writePressure(flowing8);
    for (const style of ['gel', 'paper'] as const) {
      const [on, off] = [await frame(4, style), await frame(8, style)];
      let differ = 0;
      for (let x = 32; x < 480; x++) if (pixelDiff(on, off, x, 192) > 12) differ++;
      expect(differ, style).toBeGreaterThan(40);
    }
    // Without the picture of the tubes the grains move over the trail of the view, as far as with it (ADR 0095).
    const plain = [band(await frame(4, 'glow', false)), band(await frame(6, 'glow', false))] as const;
    expect([...(await sim.readPicture())]).toEqual([...(await sim.readView())]);
    expect(shift(...plain)).toBeGreaterThanOrEqual(10);
    expect(shift(...plain)).toBeLessThanOrEqual(12);
    expect(spread(plain[0])).toBeGreaterThan(40);
    // Without a fall of the pressure nothing flows: the frames of two steps are the same but for the dither.
    sim.writePressure(pressing(w, h, () => [0, 0, 0, 0]));
    for (const style of ['glow', 'gel', 'paper'] as const)
      expect(frameDiff(await frame(4, style), await frame(8, style)), style).toBeLessThanOrEqual(2);
  });

  it.runIf(kind === 'webgl2').each([2, 3, 4])(
    'frees the targets of the picture that are made when target %i cannot be made',
    async (failing) => {
      const [w, h] = [32, 24];
      const sim = await make(flowing(), w, h);
      const trail = new Float32Array(w * h * 4);
      for (let x = 0; x < w; x++) trail[(12 * w + x) * 4] = 8;
      sim.writeTrail(trail);
      sim.writeFlow(memoryOf(w, h, (_, y) => (y === 12 ? [1, 1] : undefined)));
      const gl = (backend as unknown as { gl: WebGL2RenderingContext }).gl;
      // The picture needs four targets: two of the cells, and the map of its tiles and the rows of that map. The stream
      // of the grains has a target of its own (ADR 0095). The framebuffer of one is not complete, as when the GPU is
      // short of memory: the target frees its own texture, and the simulation must free the textures of the targets
      // before it.
      const [check, drop] = [gl.checkFramebufferStatus.bind(gl), gl.deleteTexture.bind(gl)];
      let [checks, freed] = [0, 0];
      gl.checkFramebufferStatus = (target) => (++checks === failing ? gl.FRAMEBUFFER_UNSUPPORTED : check(target));
      gl.deleteTexture = (texture) => {
        freed++;
        drop(texture);
      };
      try {
        await expect((async () => sim.readPicture())()).rejects.toThrow(/incomplete/);
      } finally {
        gl.checkFramebufferStatus = check;
        gl.deleteTexture = drop;
      }
      expect([checks, freed]).toEqual([failing, failing]);
      // The next picture makes the targets anew.
      const want = await reference(sim, 'box', 1);
      expect(worst(await sim.readPicture(), want.picture, 1)).toBeLessThan(1e-5);
    },
  );
});
