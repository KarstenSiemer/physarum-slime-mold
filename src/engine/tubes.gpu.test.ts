// The picture of the tubes on both backends (ADR 0034), in Chromium with real GPU APIs (ADR 0010): the passes against
// the CPU reference, the rule in plain cases, and the frames that the view draws from the picture.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { defaultSettings, defaultStrain, type Boundary, type Settings } from '../model/params';
import { FLOW } from './flow';
import { WebGl2Backend } from './gl/backend';
import { TUBES } from './tubes';
import { tubePicture, tubeRoots, type TubeGrid } from './tubes-reference';
import type { Backend, Levels, Sim, Stroke, View } from './types';
import { WebGpuBackend } from './webgpu';

const BACKENDS = {
  webgpu: (c: HTMLCanvasElement): Promise<Backend> => WebGpuBackend.create(c),
  webgl2: (c: HTMLCanvasElement): Promise<Backend> => Promise.resolve(WebGl2Backend.create(c)),
};

/** An extended scene with the flow on and the picture of the tubes. */
const flowing = (patch: Partial<Settings> = {}): Settings => ({
  ...defaultSettings(),
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
    // The first picture compiles its pipelines: here, under a long timeout (flow.gpu.test.ts has the times).
    const sim = await backend.createSim(flowing(), 16, 16, 8);
    sim.writeFlow(new Float32Array(16 * 16 * 4));
    await sim.readPicture();
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
      // The same state without a wall test: every byte of `shape` says that no wall is near.
      const open = tubePicture({ width: w, height: h, boundary, shape: new Uint8Array(w * h * 4) }, view, want.roots);
      let stopped = 0;
      for (let i = 0; i < picture.length; i++) if (Math.abs((open[i] ?? 0) - (picture[i] ?? 0)) > 0.01) stopped++;
      expect(stopped).toBeGreaterThan(200);
    },
    120_000,
  );

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
    sim.paint([{ kind: 'food', from: [8.5, 12.5], to: [8.5, 12.5], radius: 2.5 }]);
    sim.foodSites([[8.5, 12.5]]);
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
      // WebGPU go a quarter of the way from the levels of before to a measurement.
      expect(Math.abs(tubes[place].gain / plain[place].gain - 1), place).toBeGreaterThan(0.05);
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
      // the flat styles are compared there.
      if (style !== 'gel') expect(pixelDiff(on, off, 260, 196), `${style}, on the trail`).toBeLessThan(40);
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
        sim.paint([{ kind: 'food', from: [24.5, 16.5], to: [24.5, 16.5], radius: 3 }]);
        sim.foodSites([[24.5, 16.5]]);
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
    const device = kind === 'webgpu' ? (backend as WebGpuBackend).gpu.device : undefined;
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
    await check(moving({}), 'with the picture again');
    expect((await device?.popErrorScope())?.message).toBeUndefined();
  }, 120_000);

  it('stops a disc at a wall across the edge of the periodic grid, right after the boundary changed', async () => {
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
    // The walls stop many discs: without a wall test the picture differs on the cells around them.
    const open = tubePicture(
      { width: w, height: h, boundary: 'box', shape: new Uint8Array(w * h * 4) },
      trail,
      want.roots,
    );
    let stopped = 0;
    for (let c = 0; c < w * h; c++) if (Math.abs((open[c * 4] ?? 0) - (picture[c * 4] ?? 0)) > 0.01) stopped++;
    expect(stopped).toBeGreaterThan(100);
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
    const device = kind === 'webgpu' ? (backend as WebGpuBackend).gpu.device : undefined;
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

  it('asks a simulation for nothing once it is destroyed, when a measurement waited for another one', async () => {
    const [w, h] = [32, 24];
    // A step that moves first, with two diffusion passes: the view of this simulation is in textures that it makes
    // when it is asked for them. It is destroyed below, so afterEach() must not do it again.
    const sim = await backend.createSim(flowing({ stepOrder: 'move-first', diffusion: 2 }), w, h, 8);
    const trail = new Float32Array(w * h * 4);
    for (let c = 0; c < w * h; c++) trail[c * 4] = 1 + noise(c, 7);
    sim.writeTrail(trail);
    sim.writeFlow(memoryOf(w, h, (_, y) => (y === 12 ? [1, 1] : undefined)));
    const device = kind === 'webgpu' ? (backend as WebGpuBackend).gpu.device : undefined;
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
  it.runIf(kind === 'webgl2')('frees the first target of the picture when the second cannot be made', async () => {
    const [w, h] = [32, 24];
    const sim = await make(flowing(), w, h);
    const trail = new Float32Array(w * h * 4);
    for (let x = 0; x < w; x++) trail[(12 * w + x) * 4] = 8;
    sim.writeTrail(trail);
    sim.writeFlow(memoryOf(w, h, (_, y) => (y === 12 ? [1, 1] : undefined)));
    const gl = (backend as unknown as { gl: WebGL2RenderingContext }).gl;
    // The picture needs two targets. The framebuffer of the second one is not complete, as when the GPU is short
    // of memory: the target frees its own texture, and the simulation must free the texture of the first target.
    const [check, drop] = [gl.checkFramebufferStatus.bind(gl), gl.deleteTexture.bind(gl)];
    let [checks, freed] = [0, 0];
    gl.checkFramebufferStatus = (target) => (++checks === 2 ? gl.FRAMEBUFFER_UNSUPPORTED : check(target));
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
    expect([checks, freed]).toEqual([2, 2]);
    // The next picture makes both targets anew.
    const want = await reference(sim, 'box', 1);
    expect(worst(await sim.readPicture(), want.picture, 1)).toBeLessThan(1e-5);
  });
});
