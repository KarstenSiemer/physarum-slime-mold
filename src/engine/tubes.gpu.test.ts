// The picture of the tubes on both backends (ADR 0034), in Chromium with real GPU APIs (ADR 0010): the passes against
// the CPU reference, and the rule in plain cases.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { defaultSettings, defaultStrain, type Boundary, type Settings } from '../model/params';
import { FLOW } from './flow';
import { WebGl2Backend } from './gl/backend';
import { TUBES } from './tubes';
import { tubePicture, tubeRoots, type TubeGrid } from './tubes-reference';
import type { Backend, Sim, Stroke } from './types';
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

/** A value of the picture to 4 places: the mean of equal trails is the trail but for the rounding of its sums. */
const near = (v: number | undefined) => Math.round((v ?? 0) * 1e4) / 1e4;

/** The largest difference of two fields, against the size of the value. */
function worst(got: Float32Array, want: Float32Array): number {
  let w = 0;
  for (let i = 0; i < want.length; i++)
    w = Math.max(w, Math.abs((got[i] ?? 0) - (want[i] ?? 0)) / (1e-6 + Math.abs(want[i] ?? 0)));
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
      expect(worst(picture, want.picture), 'the picture').toBeLessThan(1e-5);
      // The case is not empty: tubes of every strain widen the trail, and walls stop some of them.
      const view = await sim.readView();
      const wider = [0, 1, 2, 3].map((s) => {
        let n = 0;
        for (let c = 0; c < w * h; c++) if ((picture[c * 4 + s] ?? 0) > (view[c * 4 + s] ?? 0) + 1e-3) n++;
        return n;
      });
      for (const n of wider) expect(n).toBeGreaterThan(20);
    },
    120_000,
  );

  it('draws a tube as wide and as bright as the fourth root of its strength says', async () => {
    const [w, h] = [48, 40];
    const sim = await make(flowing(), w, h);
    // Two tubes of one cell along rows 10 and 28: the first with the full flow memory, the second with a hundredth
    // of it. Three cells of a tube lie in the 3 × 3 cells around a cell of it and of the rows beside it, so those
    // three rows hold the strength of the tube, and here they hold its trail too.
    const rows = new Map([
      [10, 1],
      [28, 0.01],
    ]);
    const trail = new Float32Array(w * h * 4);
    for (const y of rows.keys())
      for (const dy of [-1, 0, 1]) for (let x = 0; x < w; x++) trail[((y + dy) * w + x) * 4] = 8;
    sim.writeTrail(trail);
    sim.writeFlow(memoryOf(w, h, (_, y) => (rows.has(y) ? [rows.get(y) ?? 0, 1] : undefined)));
    const picture = await sim.readPicture();
    const at = (x: number, y: number) => picture[(y * w + x) * 4] ?? 0;
    for (const [y, memory] of rows) {
      const root = memory ** 0.25;
      // k cells from the nearest of the three rows.
      for (let k = 0; k <= 5; k++) {
        const cover = Math.min(1, Math.max(0, (TUBES.radius * root + TUBES.edge / 2 - k) / TUBES.edge));
        expect(at(24, y + 1 + k), `row ${String(y)}, ${String(k)} cells below`).toBeCloseTo(8 * root * cover, 4);
        expect(at(24, y - 1 - k), `row ${String(y)}, ${String(k)} cells above`).toBeCloseTo(8 * root * cover, 4);
      }
    }
    // In numbers: the full tube adds 3 cells at its full brightness on each side, the weak one a part of 1 cell at a
    // third of it.
    expect([11, 12, 13, 14, 15].map((y) => at(24, y) > 7.99)).toEqual([true, true, true, true, false]);
    expect(at(24, 15)).toBe(0);
    expect(at(24, 28)).toBeCloseTo(8 * 0.01 ** 0.25, 4);
    expect(at(24, 30)).toBeGreaterThan(0.5);
    expect(at(24, 30)).toBeLessThan(at(24, 28));
    expect(at(24, 31)).toBe(0);
    // The scene holds one strain: the lanes of the other three hold no factor of a radius, on a cell of a tube too.
    const roots = await sim.readTubeRoots();
    expect([0, 1, 2, 3].map((lane) => near(roots[(10 * w + 24) * 4 + lane]))).toEqual([1, 0, 0, 0]);
  });

  it('keeps the plasmodium without a tube at a quarter of its trail, and a strain to its own lane', async () => {
    const [w, h] = [32, 24];
    const sim = await make(flowing({ strains: [defaultStrain(0), defaultStrain(1)] }), w, h);
    const trail = new Float32Array(w * h * 4);
    // Strain A has trail on row 6 and no tube. Strain B has a full tube along row 16, with trail on rows 15 to 17.
    for (let x = 0; x < w; x++) {
      trail[(6 * w + x) * 4] = 12;
      for (const y of [15, 16, 17]) trail[(y * w + x) * 4 + 1] = 4;
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
    expect(at(16, 20, 1)).toBeCloseTo(4, 5);
    expect(at(16, 21, 1)).toBe(0);
    for (let y = 12; y <= 21; y++) expect(at(16, y, 0)).toBe(0);
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
    // The trail lies on row 12 alone, and the rows beside it hold a part of the tube without trail. At a cell of row
    // 12 the discs of 7 cells of its row reach it whole, and in each row beside it 5 whole and 2 at their edge.
    const trail = new Float32Array(w * h * 4);
    for (let x = 0; x < w; x++) trail[(12 * w + x) * 4] = 8;
    sim.writeTrail(trail);
    sim.writeFlow(memoryOf(w, h, (_, y) => (y === 12 ? [1, 1] : undefined)));
    const beside = 5 + 2 * (TUBES.radius + TUBES.edge / 2 - Math.hypot(3, 1));
    expect((await sim.readPicture())[(12 * w + 16) * 4]).toBeCloseTo((8 * 7) / (7 + 2 * beside), 4);
  });

  it('draws no tube across a wall', async () => {
    const [w, h] = [48, 32];
    const sim = await make(flowing(), w, h);
    // A wall along row 16, about 2 cells thick, and a full tube along row 12 above it, with trail on rows 11 to 13.
    sim.paint([{ kind: 'wall', from: [0, 16], to: [48, 16], radius: 1 }]);
    const env = await sim.readEnv();
    const wall = (y: number) => (env[(y * w + 24) * 4] ?? 0) >= 128;
    expect([13, 14, 15, 16, 17, 18].map(wall)).toEqual([false, false, true, true, false, false]);
    const band = (from: number) => {
      const trail = new Float32Array(w * h * 4);
      for (const y of [from, from + 1, from + 2]) for (let x = 0; x < w; x++) trail[(y * w + x) * 4] = 8;
      sim.writeTrail(trail);
      sim.writeFlow(memoryOf(w, h, (_, y) => (y === from + 1 ? [1, 1] : undefined)));
    };
    band(11);
    const picture = await sim.readPicture();
    const at = (y: number) => picture[(y * w + 24) * 4] ?? 0;
    // Away from the wall the tube adds 3 cells at its full brightness. Toward the wall it fills the open cell, and
    // it reaches no cell of the wall and no cell behind the wall.
    expect([10, 9, 8, 7].map(at).map(near)).toEqual([8, 8, 8, 0]);
    expect(near(at(14))).toBe(8);
    expect([15, 16, 17, 18].map(at)).toEqual([0, 0, 0, 0]);
    // Without the wall the same tube reaches row 16, 3 cells below row 13.
    sim.clearEnvironment();
    band(11);
    const open = await sim.readPicture();
    expect([14, 15, 16, 17].map((y) => near(open[(y * w + 24) * 4]))).toEqual([8, 8, 8, 0]);
  });

  it('draws the trail of the view while the setting is off, the flow is off, or the style draws the agents', async () => {
    const [w, h] = [24, 16];
    // A full tube along row 8, with trail on rows 7 to 9.
    const trail = new Float32Array(w * h * 4);
    for (const y of [7, 8, 9]) for (let x = 0; x < w; x++) trail[(y * w + x) * 4] = 8;
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
      expect(worst(await sim.readPicture(), want.picture), what).toBeLessThan(1e-5);
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
    sim.paint([{ kind: 'wall', from: [0, 8], to: [32, 8], radius: 1 }]);
    await check('after a new wall');
    expect((await sim.readPicture())[(9 * w + 4) * 4]).toBe(0);
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
      expect(worst(await sim.readPicture(), want.picture), `${String(diffusion)} passes`).toBeLessThan(1e-5);
      sim.run(1);
      const next = await reference(sim, 'box', 1);
      expect(worst(await sim.readPicture(), next.picture), `${String(diffusion)} passes, a step later`).toBeLessThan(
        1e-5,
      );
    }
  });

  it('keeps the strand of the scent view a level of the trail of the model', async () => {
    const [w, h] = [64, 48];
    const levelsOf = async (showTubes: boolean) => {
      const sim = await make(flowing({ showTubes }), w, h);
      const trail = new Float32Array(w * h * 4);
      // A wide band of weak trail without a tube, and one row with a full tube and ten times the trail.
      for (let c = 0; c < w * h; c++) trail[c * 4] = Math.floor(c / w) < 30 ? 1 + noise(c, 3) : 0;
      for (let x = 0; x < w; x++) trail[(40 * w + x) * 4] = 15;
      sim.writeTrail(trail);
      sim.writeFlow(memoryOf(w, h, (_, y) => (y === 40 ? [1, 1] : undefined)));
      return backend.settle(sim);
    };
    const [plain, tubes] = [await levelsOf(false), await levelsOf(true)];
    // The picture of the tubes holds other levels: the band is at a quarter, and the tube is wider.
    expect(tubes.gain).not.toBeCloseTo(plain.gain, 2);
    expect(tubes.strand).toBeGreaterThan(0);
    expect(tubes.strand).toBe(plain.strand);
  });
});
