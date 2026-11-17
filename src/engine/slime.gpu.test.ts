// The slime field on both backends (ADR 0055), in Chromium with real GPU APIs (ADR 0010): the pass of the stamps
// against the CPU reference, and the rule in plain cases.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { defaultSettings, defaultStrain, type Settings } from '../model/params';
import { trailLevels } from './flow';
import type { FlowGrid } from './flow-reference';
import { WebGl2Backend } from './gl/backend';
import { NO_STAMP, stampOf } from './slime';
import { slimeStep } from './slime-reference';
import type { Backend, Sim } from './types';
import { WebGpuBackend } from './webgpu';

const BACKENDS = {
  webgpu: (c: HTMLCanvasElement): Promise<Backend> => WebGpuBackend.create(c),
  webgl2: (c: HTMLCanvasElement): Promise<Backend> => Promise.resolve(WebGl2Backend.create(c)),
};

const [W, H] = [24, 16];
const cell = (x: number, y: number) => y * W + x;
const f32 = Math.fround;

/** The 32-bit float next to a positive one: `by` is 1 for the one above and −1 for the one below. */
function next(v: number, by: 1 | -1): number {
  const f = new Float32Array([v]);
  const bits = new Uint32Array(f.buffer);
  bits[0] = (bits[0] ?? 0) + by;
  return f[0] ?? 0;
}

/**
 * A trail that one step without diffusion takes to exactly `to`: the step multiplies the trail by `keep`, and rounds
 * to a 32-bit float. `keep` is just below 1, so some float near to / keep gives each float.
 */
function before(to: number, keep: number): number {
  let x = f32(to / keep);
  for (let i = 0; i < 8 && f32(x * keep) !== to; i++) x = next(x, f32(x * keep) < to ? 1 : -1);
  if (f32(x * keep) !== to) throw new Error(`no trail decays to ${String(to)}`);
  return x;
}

/**
 * Two strains with levels of their own, on a grid without living agents and without diffusion: no agent leaves a
 * trail, and a step only multiplies the trail that a test writes by 0.9999 and 0.9998.
 */
const strains = [
  { ...defaultStrain(0, 2), deposit: 5, decay: 0.0001 },
  { ...defaultStrain(1, 2), deposit: 2, decay: 0.0002 },
];
const slimy = (patch: Partial<Settings> = {}): Settings => ({
  ...defaultSettings(),
  model: 'extended',
  boundary: 'dish',
  layout: 'empty',
  collisions: false,
  diffusion: 0,
  seed: 3,
  strains,
  ...patch,
});

/** A trail with the values of `at`: cell, lane, value. */
function trailOf(at: readonly (readonly [number, number, number])[], cells = W * H): Float32Array {
  const trail = new Float32Array(cells * 4);
  for (const [c, lane, v] of at) trail[c * 4 + lane] = v;
  return trail;
}

/** The cells that hold a stamp, with what they hold. */
const stamped = (field: Uint32Array) => [...field].flatMap((v, c) => (v === NO_STAMP ? [] : [[c, v] as const]));

describe.each(Object.entries(BACKENDS))('the slime field on %s', (_kind, create) => {
  let backend: Backend;
  const live: Sim[] = [];

  beforeAll(async () => {
    backend = await create(document.createElement('canvas'));
    // The first step with slime compiles the pass of the stamps: here, under a long timeout (ADR 0010).
    const sim = await backend.createSim(slimy(), 16, 16, 8);
    sim.run(1);
    await sim.finish();
    sim.destroy();
  }, 600_000);
  afterEach(() => {
    for (const s of live.splice(0)) s.destroy();
  });
  afterAll(() => {
    backend.destroy();
  });

  async function make(settings: Settings, w = W, h = H, agents = 8) {
    const sim = await backend.createSim(settings, w, h, agents);
    live.push(sim);
    return sim;
  }

  /** The grid of a simulation as the CPU reference reads it. */
  const gridOf = async (sim: Sim, s: Settings): Promise<FlowGrid> => ({
    width: sim.width,
    height: sim.height,
    boundary: s.boundary,
    env: await sim.readEnv(),
  });

  it('starts without a stamp, one value per cell', async () => {
    const sim = await make(slimy());
    const field = await sim.readSlime();
    expect(field.length).toBe(W * H);
    expect(stamped(field)).toEqual([]);
  });

  it.each([
    ['a step that senses first', { stepOrder: 'sense-first' }],
    ['a step that moves first', { stepOrder: 'move-first' }],
    ['the flow in the tubes', { flow: true }],
  ] as const)(
    'gives a cell at the level of a strain the stamp of the step and follows the CPU reference, with %s',
    async (_what, patch) => {
      const s = slimy(patch);
      const sim = await make(s);
      // A wall along row 4, inside the dish of 24 × 16 cells: its radius is 0.945 · 8 cells around (12, 8).
      sim.paint([{ kind: 'wall', from: [9.5, 4.5], to: [14.5, 4.5], radius: 0.75 }]);
      const grid = await gridOf(sim, s);
      const [lowA, lowB] = strains.map((strain) => f32(trailLevels(strain, s.stepOrder)[0])) as [number, number];
      const [keepA, keepB] = strains.map((strain) => f32(1 - strain.decay)) as [number, number];
      // The level of the second strain lies far below that of the first: 0.2 of a deposit of 2 against 5, at a decay of
      // 0.0002 against 0.0001.
      expect(lowB * 4).toBeLessThan(lowA);
      const mid = 600;
      expect(mid).toBeGreaterThan(lowB);
      expect(mid * 1.5).toBeLessThan(lowA);
      const cells = {
        // After the step exactly at the level of the first strain, and the float just below it.
        atA: cell(6, 8),
        belowA: cell(7, 8),
        // The same for the second strain: only its trail holds plasm there.
        atB: cell(8, 8),
        belowB: cell(9, 8),
        // Between the two levels: no plasm of the first strain, and plasm of the second.
        midA: cell(10, 8),
        midB: cell(11, 8),
        // Far above the level: the plasm stays for every step of the test.
        both: cell(12, 8),
        highA: cell(13, 8),
        // A wall, and two cells outside the dish.
        wall: cell(12, 4),
        outside: cell(2, 8),
        corner: cell(0, 0),
      };
      sim.writeTrail(
        trailOf([
          [cells.atA, 0, before(lowA, keepA)],
          [cells.belowA, 0, before(next(lowA, -1), keepA)],
          [cells.atB, 1, before(lowB, keepB)],
          [cells.belowB, 1, before(next(lowB, -1), keepB)],
          [cells.midA, 0, mid],
          [cells.midB, 1, mid],
          [cells.both, 0, 5000],
          [cells.both, 1, 5000],
          [cells.highA, 0, 9000],
          [cells.wall, 0, 9000],
          [cells.outside, 0, 9000],
          [cells.outside, 1, 9000],
          [cells.corner, 1, 9000],
        ]),
      );
      const at = (field: Uint32Array | Float32Array, name: keyof typeof cells, lane = 0, lanes = 1) =>
        field[cells[name] * lanes + lane];

      // The first step of the run has the number 0.
      sim.run(1);
      let trail = await sim.readTrail();
      // The trail after the diffusion of the step: at the levels and just below them, and none in the wall and outside
      // the dish, where the test wrote one.
      expect([at(trail, 'atA', 0, 4), at(trail, 'belowA', 0, 4)]).toEqual([lowA, next(lowA, -1)]);
      expect([at(trail, 'atB', 1, 4), at(trail, 'belowB', 1, 4)]).toEqual([lowB, next(lowB, -1)]);
      expect([at(trail, 'wall', 0, 4), at(trail, 'outside', 0, 4), at(trail, 'corner', 1, 4)]).toEqual([0, 0, 0]);
      expect((await sim.readEnv())[cells.wall * 4] ?? 0).toBeGreaterThanOrEqual(128);
      let field = await sim.readSlime();
      const first = [cells.atA, cells.atB, cells.midB, cells.both, cells.highA];
      expect(stamped(field)).toEqual(first.map((c) => [c, stampOf(0)]));
      expect(stampOf(0)).toBe(1);
      let expected = slimeStep(grid, s, 0, new Uint32Array(W * H), trail);
      expect(field).toEqual(expected);

      // The second step. The cells at their level fall below it: the plasm left them, and their stamp stays. A cell
      // that still holds plasm gets the stamp of this step.
      sim.run(1);
      trail = await sim.readTrail();
      expect(at(trail, 'atA', 0, 4)).toBeLessThan(lowA);
      expect(at(trail, 'atB', 1, 4)).toBeLessThan(lowB);
      field = await sim.readSlime();
      expect([at(field, 'atA'), at(field, 'atB')]).toEqual([stampOf(0), stampOf(0)]);
      expect([at(field, 'midB'), at(field, 'both'), at(field, 'highA')]).toEqual([stampOf(1), stampOf(1), stampOf(1)]);
      expect(stamped(field).length).toBe(first.length);
      expected = slimeStep(grid, s, 1, expected, trail);
      expect(field).toEqual(expected);

      // The plasm leaves every cell: three steps write no stamp, and every stamp stays.
      sim.writeTrail(trailOf([]));
      sim.run(3);
      expect(await sim.readSlime()).toEqual(expected);
      expect(sim.step).toBe(5);

      // New plasm on a cell with an old stamp, on a cell without one, on the wall and outside the dish.
      sim.writeTrail(
        trailOf([
          [cells.atA, 0, 9000],
          [cells.belowA, 0, 9000],
          [cells.wall, 1, 9000],
          [cells.corner, 0, 9000],
        ]),
      );
      sim.run(1);
      trail = await sim.readTrail();
      field = await sim.readSlime();
      expect([at(field, 'atA'), at(field, 'belowA'), at(field, 'atB'), at(field, 'both')]).toEqual([
        stampOf(5),
        stampOf(5),
        stampOf(0),
        stampOf(1),
      ]);
      expect([at(field, 'wall'), at(field, 'outside'), at(field, 'corner')]).toEqual([NO_STAMP, NO_STAMP, NO_STAMP]);
      expect(field).toEqual(slimeStep(grid, s, 5, expected, trail));
    },
  );

  it('writes no stamp while the life time is 0, keeps the stamps over a new setting, and clears them at a reset', async () => {
    const s = slimy({ boundary: 'box' });
    const sim = await make(s);
    const block = [cell(4, 4), cell(5, 4), cell(4, 5), cell(5, 5)];
    const plasm = (cells: readonly number[]) => trailOf(cells.map((c) => [c, 0, 9000] as const));
    const stamps = (of: (c: number) => number) => block.map((c) => [c, of(c)]);
    sim.writeTrail(plasm(block));
    sim.run(2);
    expect(stamped(await sim.readSlime())).toEqual(stamps(() => stampOf(1)));

    // Without slime the pass does not run: the plasm is still there, and no stamp changes.
    sim.update({ ...s, slimeLife: 0 });
    sim.run(3);
    expect(stamped(await sim.readSlime())).toEqual(stamps(() => stampOf(1)));

    // A new life time keeps the stamps, and the next step writes again: the sixth step has the number 5.
    sim.update({ ...s, slimeLife: 18 });
    expect(stamped(await sim.readSlime())).toEqual(stamps(() => stampOf(1)));
    sim.writeTrail(plasm(block.slice(0, 2)));
    sim.run(1);
    expect(stamped(await sim.readSlime())).toEqual(stamps((c) => (block.indexOf(c) < 2 ? stampOf(5) : stampOf(1))));

    // A reset clears every stamp, and the steps count from 0 again.
    sim.reset();
    expect(stamped(await sim.readSlime())).toEqual([]);
    sim.writeTrail(plasm(block.slice(2)));
    sim.run(1);
    expect(stamped(await sim.readSlime())).toEqual(block.slice(2).map((c) => [c, stampOf(0)]));

    // A run without slime from its start holds no stamp.
    const off = await make(slimy({ boundary: 'box', slimeLife: 0 }));
    off.writeTrail(plasm(block));
    off.run(3);
    expect(stamped(await off.readSlime())).toEqual([]);
  });

  it('has no slime in the Jones model, and starts without a stamp after a switch of the model', async () => {
    const jones: Settings = {
      ...defaultSettings(),
      model: 'jones',
      boundary: 'box',
      layout: 'empty',
      collisions: true,
      density: 0.1,
      seed: 3,
      strains: [defaultStrain(0)],
    };
    expect(jones.slimeLife).toBe(144);
    const extended: Settings = { ...jones, model: 'extended' };
    const everywhere = new Float32Array(W * H * 4).fill(1000);
    const sim = await make(jones, W, H, 40);
    sim.writeTrail(everywhere);
    sim.run(3);
    // The trail of every cell is far above the level, 0.2 of a deposit of 5, and stays there for the steps below.
    expect(Math.min(...(await sim.readTrail()).filter((_, i) => i % 4 === 0))).toBeGreaterThan(100);
    let field = await sim.readSlime();
    expect(field.length).toBe(W * H);
    expect(stamped(field)).toEqual([]);

    // The extended model on the same simulation: the fourth step has the number 3, and stamps every cell of the box.
    sim.update(extended);
    sim.run(1);
    field = await sim.readSlime();
    expect([...field].every((v) => v === stampOf(3))).toBe(true);

    // Back in the Jones model the field is gone, and a new one starts without a stamp.
    sim.update(jones);
    expect(stamped(await sim.readSlime())).toEqual([]);
    sim.run(1);
    expect(stamped(await sim.readSlime())).toEqual([]);
    sim.update(extended);
    expect(stamped(await sim.readSlime())).toEqual([]);
    sim.run(1);
    expect([...(await sim.readSlime())].every((v) => v === stampOf(5))).toBe(true);
  });

  it.each([
    ['one diffusion pass, sensing first', { diffusion: 1, stepOrder: 'sense-first' }],
    ['two diffusion passes, moving first', { diffusion: 2, stepOrder: 'move-first' }],
  ] as const)(
    'follows the CPU reference step by step under living agents that leave a trail, with %s',
    async (_what, patch) => {
      // Few agents of two strains in a dish with a wall. One deposit of the first strain spreads to less than its
      // level, so only a cell that agents pass again holds its plasm; one deposit of the second strain is enough.
      const [w, h] = [48, 40];
      const s: Settings = {
        ...defaultSettings(),
        model: 'extended',
        boundary: 'dish',
        collisions: false,
        seed: 9,
        strains: [
          { ...defaultStrain(0, 2), sensorOffset: 5 },
          { ...defaultStrain(1, 2), sensorOffset: 5, deposit: 2, decay: 0.3 },
        ],
        ...patch,
      };
      const sim = await make(s, w, h, 24);
      sim.paint([{ kind: 'wall', from: [24, 6], to: [24, 30], radius: 1 }]);
      sim.reset();
      const grid = await gridOf(sim, s);
      let expected: Uint32Array = new Uint32Array(w * h);
      const counts: number[] = [];
      for (let step = 0; step < 8; step++) {
        sim.run(1);
        expected = slimeStep(grid, s, step, expected, await sim.readTrail());
        const field = await sim.readSlime();
        expect(field, `step ${String(step)}`).toEqual(expected);
        counts.push(stamped(field).length);
      }
      // The colony leaves slime behind: more cells hold a stamp at the end, and by far not all.
      expect(counts[0]).toBeGreaterThan(0);
      expect(counts[7]).toBeGreaterThan(counts[0] ?? 0);
      expect(counts[7]).toBeLessThan((w * h) / 2);
      // Stamps of several steps: where the plasm left, the stamp of an earlier step stays.
      const field = await sim.readSlime();
      expect(new Set(field).size).toBeGreaterThan(3);
      // No stamp in the wall and outside the dish.
      const env = await sim.readEnv();
      const closed = (c: number) =>
        (env[c * 4] ?? 0) >= 128 || Math.hypot((c % w) + 0.5 - w / 2, Math.floor(c / w) + 0.5 - h / 2) > 0.945 * 20;
      expect(stamped(field).filter(([c]) => closed(c))).toEqual([]);
      expect([...field.keys()].filter(closed).length).toBeGreaterThan(400);
    },
  );
});
