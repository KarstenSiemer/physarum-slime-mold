// The growth front on both backends (ADR 0060), in Chromium with real GPU APIs (ADR 0010): the front field against
// the CPU reference, and the fan of the front in the picture. The picture has no CPU reference: the two backends must
// draw the same pixels, and the fan must be where the rules say (slime.gpu.test.ts has the frames without it).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { defaultSettings, defaultStrain, type Settings } from '../model/params';
import type { FlowGrid } from './flow-reference';
import { WebGl2Backend } from './gl/backend';
import { equilibrium } from './sizing';
import { STEPS_PER_HOUR, stampOf } from './slime';
import { frontStep, slimePaint, slimeStep } from './slime-reference';
import type { Backend, Sim, Stroke, View } from './types';
import { WebGpuBackend } from './webgpu';

const BACKENDS = {
  webgpu: (c: HTMLCanvasElement): Promise<Backend> => WebGpuBackend.create(c),
  webgl2: (c: HTMLCanvasElement): Promise<Backend> => Promise.resolve(WebGl2Backend.create(c)),
};

/** One strain on a grid without living agents and without diffusion: a step only lets the trail of a test decay. */
const still = (patch: Partial<Settings> = {}): Settings => ({
  ...defaultSettings(),
  model: 'extended',
  boundary: 'box',
  layout: 'empty',
  collisions: false,
  diffusion: 0,
  bloom: 0,
  seed: 3,
  strains: [{ ...defaultStrain(0, 1), deposit: 5, decay: 0.0001 }],
  ...patch,
});

/** A trail of the first strain with `value` in the cells of `cells`. */
function trailOf(cells: readonly number[], value: number, count: number): Float32Array {
  const trail = new Float32Array(count * 4);
  for (const c of cells) trail[c * 4] = value;
  return trail;
}

/** By how much the darkest channel of a pixel of `a` lies below that of `b`, at most over the picture. */
function darker(a: ImageData, b: ImageData) {
  let max = 0;
  for (let i = 0; i < a.data.length; i++) if (i % 4 !== 3) max = Math.max(max, (b.data[i] ?? 0) - (a.data[i] ?? 0));
  return max;
}

/** The largest difference of one channel between two captures, over the pixels that `where` keeps. */
function maxDiff(a: ImageData, b: ImageData, where: (x: number, y: number) => boolean = () => true) {
  let max = 0;
  for (let i = 0; i < a.width * a.height; i++) {
    if (!where(i % a.width, Math.floor(i / a.width))) continue;
    for (let k = 0; k < 3; k++) max = Math.max(max, Math.abs((a.data[i * 4 + k] ?? 0) - (b.data[i * 4 + k] ?? 0)));
  }
  return max;
}

describe.each(Object.entries(BACKENDS))('the front field on %s', (_kind, create) => {
  let backend: Backend;
  const live: Sim[] = [];
  const [W, H] = [26, 17];
  const cell = (x: number, y: number) => y * W + x;
  /** A life time of 12 steps: a part of an hour. */
  const LIFE = 12;

  beforeAll(async () => {
    backend = await create(document.createElement('canvas'));
  }, 600_000);
  afterEach(() => {
    for (const s of live.splice(0)) s.destroy();
  });
  afterAll(() => {
    backend.destroy();
  });

  it('stamps a cell when plasm comes onto ground without slime, and keeps the stamp while the cell has slime', async () => {
    const s = still({ slimeLife: LIFE / STEPS_PER_HOUR });
    const sim = await backend.createSim(s, W, H, 8);
    live.push(sim);
    const grid: FlowGrid = { width: W, height: H, boundary: s.boundary, env: await sim.readEnv() };
    const [a, b, c, d] = [cell(3, 3), cell(8, 3), cell(13, 3), cell(18, 9)];
    let stamps: Uint32Array = new Uint32Array(W * H);
    let fronts: Uint32Array = new Uint32Array(W * H);
    /** `steps` steps with plasm in `cells` alone; the field must follow the CPU reference. */
    const run = async (cells: number[], steps = 1) => {
      sim.writeTrail(trailOf(cells, 9000, W * H));
      for (let k = 0; k < steps; k++) {
        const step = sim.step;
        sim.run(1);
        const trail = await sim.readTrail();
        fronts = frontStep(grid, s, step, stamps, fronts, trail);
        stamps = slimeStep(grid, s, step, stamps, trail);
      }
      expect(await sim.readSlimeFront()).toEqual(fronts);
    };
    const held = () => [a, b, c, d].map((k) => fronts[k]);

    expect((await sim.readSlimeFront()).some((v) => v !== 0)).toBe(false);
    // Step 0: plasm comes onto three fresh cells.
    await run([a, b, c]);
    expect(held()).toEqual([stampOf(0), stampOf(0), stampOf(0), 0]);
    // The plasm leaves b and c, and comes back to b at step 4, onto its slime: that is no front.
    await run([a], 3);
    await run([a, b]);
    expect(held()).toEqual([stampOf(0), stampOf(0), stampOf(0), 0]);
    // The slime of b is over 12 steps after its last plasm, at step 16, and that of c long before. Plasm at step 17
    // is a front again there. The cell a held plasm all the time: it keeps its first stamp.
    await run([a], LIFE);
    expect(sim.step).toBe(17);
    await run([a, b, c]);
    expect(held()).toEqual([stampOf(0), stampOf(17), stampOf(17), 0]);

    // The Slime tool: no front reached painted slime. It clears the front stamp of a cell that had no slime (c, after
    // its slime is over), and keeps that of a cell with slime (a). A cell that no stroke reaches keeps a stamp
    // without a meaning (b).
    await run([a], LIFE);
    const dab = (k: number): Stroke => {
      const at: [number, number] = [(k % W) + 0.5, Math.floor(k / W) + 0.5];
      return { kind: 'slime', from: at, to: at, radius: 1 };
    };
    for (const stroke of [dab(c), dab(a), dab(d)]) {
      slimePaint(grid, s, sim.step, stamps, stroke, undefined, {
        amounts: new Uint32Array(W * H),
        life: LIFE,
        fronts,
      });
      sim.paint([stroke]);
    }
    expect(held()).toEqual([stampOf(0), stampOf(17), 0, 0]);
    expect(await sim.readSlimeFront()).toEqual(fronts);
    expect(await sim.readSlime()).toEqual(stamps);
    // Plasm onto painted slime is no front.
    await run([a, d]);
    expect(held()[3]).toBe(0);

    // A reset clears the field, and the Jones model has none.
    sim.reset();
    expect((await sim.readSlimeFront()).some((v) => v !== 0)).toBe(false);
    const jones = await backend.createSim({ ...s, model: 'jones' }, W, H, 8);
    live.push(jones);
    jones.writeTrail(trailOf([a], 9000, W * H));
    jones.run(2);
    expect((await jones.readSlimeFront()).some((v) => v !== 0)).toBe(false);
  });
});

describe('the fan of the growth front in the picture', () => {
  const backends: Backend[] = [];
  const live: Sim[] = [];
  const [PW, PH] = [64, 48];
  /** A tube of 6 cells across the middle of the grid, 4 cells below a place for a wall. */
  const tube: number[] = [];
  for (let y = 22; y < 28; y++) for (let x = 14; x < 44; x++) tube.push(y * PW + x);
  const s = still({ slimeLife: 144 });
  /** 4 pixels per cell around the right end of the tube, and the whole grid at 2 pixels per cell. */
  const CLOSE: View = { center: [40.3, 23.7], scale: 1 / 4 };
  const WHOLE: View = { center: [32, 24], scale: 1 / 2 };
  const SIZE = [128, 96] as const;
  /** The grid position of the pixel (x, y) of a capture under CLOSE. */
  const cellOf = (x: number, y: number) => [
    (x + 0.5 - SIZE[0] / 2) * CLOSE.scale + CLOSE.center[0],
    (y + 0.5 - SIZE[1] / 2) * CLOSE.scale + CLOSE.center[1],
  ];

  beforeAll(async () => {
    for (const create of Object.values(BACKENDS)) backends.push(await create(document.createElement('canvas')));
  }, 600_000);
  beforeEach(() => {
    // No levels of an earlier test: a frame without them draws the trail with the same gain on every run.
    for (const b of backends) b.forget();
  });
  afterEach(() => {
    for (const sim of live.splice(0)) sim.destroy();
  });
  afterAll(() => {
    for (const b of backends) b.destroy();
  });

  /** A simulation with the tube as plasm, `steps` steps after the front reached its cells. */
  async function grown(backend: Backend, steps: number): Promise<Sim> {
    const sim = await backend.createSim(s, PW, PH, 8);
    live.push(sim);
    // The light of the plasm is 2 in a frame without levels: a tube that hides its ground.
    sim.writeTrail(trailOf(tube, (2 * equilibrium(s)) / 0.4, PW * PH));
    sim.run(steps);
    return sim;
  }
  // The view draws the fan only while growth is on. The simulation of a test has no living agent, so its growth is
  // off, and the frame gets the two settings of growth alone.
  const shot = (backend: Backend, sim: Sim, patch: Partial<Settings>, view = CLOSE) =>
    backend.capture(sim, { ...s, growth: true, collisions: true, ...patch }, view, SIZE[0], SIZE[1]);

  it('is the same on both backends in the glow, gel and paper styles, and shows young ground', async () => {
    const sims: Sim[] = [];
    for (const b of backends) sims.push(await grown(b, 40));
    const [gpu, gl] = backends as [Backend, Backend];
    const [a, b] = sims as [Sim, Sim];
    expect(await a.readSlimeFront()).toEqual(await b.readSlimeFront());
    expect((await a.readSlimeFront()).filter((v) => v === stampOf(0)).length).toBe(tube.length);
    for (const style of ['glow', 'gel', 'paper'] as const)
      for (const view of [CLOSE, WHOLE]) {
        const name = `${style} at ${String(view.scale)}`;
        const on = [await shot(gpu, a, { style }, view), await shot(gl, b, { style }, view)] as const;
        // Each backend dithers by 1 of 255 in its own way, and rounds a byte.
        expect(maxDiff(on[0], on[1]), name).toBeLessThanOrEqual(3);
        // The fan is there: the sheet and its veins beside the tube.
        const off = [
          await shot(gpu, a, { style, showFront: false }, view),
          await shot(gl, b, { style, showFront: false }, view),
        ] as const;
        expect(maxDiff(on[0], off[0]), name).toBeGreaterThan(25);
        // The sheet is more plasm: in the glow it only adds light, on both backends. A map of the front that holds
        // no number gave a black tube on SwiftShader, and the same black on both backends.
        if (style === 'glow') {
          expect(darker(on[0], off[0]), name).toBeLessThanOrEqual(3);
          expect(darker(on[1], off[1]), name).toBeLessThanOrEqual(3);
        }
      }
    // The agents style, the scent view and a scene without growth draw no fan.
    for (const patch of [{ style: 'agents' }, { showScent: true }, { growth: false }] as Partial<Settings>[])
      expect(
        maxDiff(await shot(gpu, a, patch), await shot(gpu, a, { ...patch, showFront: false })),
      ).toBeLessThanOrEqual(2);
  });

  it.each(Object.keys(BACKENDS))(
    'ends 1,500 steps after the front, and does not show behind a wall (%s)',
    async (kind) => {
      const backend = backends[Object.keys(BACKENDS).indexOf(kind)];
      if (!backend) throw new Error(`no backend ${kind}`);
      const sim = await grown(backend, 40);
      /** The pixels of the ground above the place of the wall: 6 to 9 cells above the tube. */
      const beyond = (x: number, y: number) => {
        const [cx, cy] = cellOf(x, y) as [number, number];
        return cx > 30 && cx < 43 && cy > 13 && cy < 16;
      };
      for (const style of ['glow', 'gel'] as const) {
        // Two frames of one backend dither apart by 2 at most.
        const [on, off] = [await shot(backend, sim, { style }), await shot(backend, sim, { style, showFront: false })];
        expect(maxDiff(on, off, beyond), style).toBeGreaterThan(6);
      }
      // A wall 4 to 6 cells above the tube: the sheet stays on the side of its plasm.
      sim.paint([{ kind: 'wall', from: [10, 17], to: [50, 17], radius: 1 }]);
      for (const style of ['glow', 'gel'] as const) {
        const [on, off] = [await shot(backend, sim, { style }), await shot(backend, sim, { style, showFront: false })];
        expect(maxDiff(on, off, beyond), style).toBeLessThanOrEqual(2);
        expect(maxDiff(on, off), style).toBeGreaterThan(25);
      }
      // 1,500 steps after the front the tube of the model stays alone.
      sim.run(1500);
      expect((await sim.readSlime()).filter((v) => v === stampOf(sim.step - 1)).length).toBe(tube.length);
      for (const style of ['glow', 'gel', 'paper'] as const) {
        const [on, off] = [await shot(backend, sim, { style }), await shot(backend, sim, { style, showFront: false })];
        expect(maxDiff(on, off), style).toBeLessThanOrEqual(2);
      }
    },
    120_000,
  );
});
