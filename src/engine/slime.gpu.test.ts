// The slime field on both backends (ADR 0055), in Chromium with real GPU APIs (ADR 0010): the pass of the stamps and
// the brush on the field against the CPU reference, and the rules in plain cases.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { BOUNDARIES, defaultSettings, defaultStrain, type Boundary, type Settings } from '../model/params';
import { cellIndex, dishRadius } from './brush';
import { trailLevels } from './flow';
import { openCell, type FlowGrid } from './flow-reference';
import { WebGl2Backend } from './gl/backend';
import { paintReference } from './paint-reference';
import { NO_STAMP, stampOf } from './slime';
import { slimePaint, slimeStep } from './slime-reference';
import type { Backend, EnvTool, Sim, Stroke } from './types';
import { WebGpuBackend } from './webgpu';

const BACKENDS = {
  webgpu: (c: HTMLCanvasElement): Promise<Backend> => WebGpuBackend.create(c),
  webgl2: (c: HTMLCanvasElement): Promise<Backend> => Promise.resolve(WebGl2Backend.create(c)),
};

// No side is a multiple of 8 cells, the side of a workgroup of the pass on WebGPU: the last workgroups of a row and of
// a column reach past the grid.
const [W, H] = [26, 17];
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
    // The first step with slime compiles the pass of the stamps, and the first stroke of the Slime tool the brush on
    // the field: here, under a long timeout (ADR 0010).
    const sim = await backend.createSim(slimy(), 16, 16, 8);
    sim.run(1);
    sim.paint([{ kind: 'slime', from: [8, 8], to: [8, 8], radius: 2 }]);
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
      // A wall along row 4, inside the dish of 26 × 17 cells: its radius is 0.945 · 8.5 cells around (13, 8.5).
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
    // A block of four cells, and three corners of the box: the last cell of the first row, the first cell of the last
    // row, and the last cell of the grid.
    const block = [cell(W - 1, 0), cell(4, 4), cell(5, 4), cell(4, 5), cell(5, 5), cell(0, H - 1), cell(W - 1, H - 1)];
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
    expect(block.length).toBe(7);

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
    ['one diffusion pass, sensing first, in a dish', [48, 40], { diffusion: 1, stepOrder: 'sense-first' }],
    // A periodic grid whose sides are no multiples of 8 cells: the trail crosses its edges.
    ['two diffusion passes, moving first, on a periodic grid', [50, 37], { diffusion: 2, boundary: 'wrap' }],
  ] as const)(
    'follows the CPU reference step by step under living agents that leave a trail, with %s',
    async (_what, [w, h], patch) => {
      // Few agents of two strains on a grid with a wall. One deposit of the first strain spreads to less than its
      // level, so only a cell that agents pass again holds its plasm; one deposit of the second strain is enough.
      const s: Settings = {
        ...defaultSettings(),
        model: 'extended',
        boundary: 'dish',
        stepOrder: 'move-first',
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
      // On the periodic grid two agents of the second strain walk along the last column and along the last row: their
      // first move leaves a trail there.
      if (s.boundary === 'wrap') {
        sim.writeAgent(12, { x: w - 0.5, y: 10.5, heading: Math.PI / 2, bits: 5 });
        sim.writeAgent(13, { x: 10.5, y: h - 0.5, heading: 0, bits: 5 });
      }
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
      // No stamp in the wall and outside the arena.
      const closed = (c: number) => openCell(grid, c % w, Math.floor(c / w)) < 0;
      expect(stamped(field).filter(([c]) => closed(c))).toEqual([]);
      expect([...field.keys()].filter(closed).length).toBeGreaterThan(40);
      // On the periodic grid cells of the last column and of the last row hold stamps: the two agents went there.
      if (s.boundary !== 'wrap') return;
      expect(field[11 * w + w - 1]).toBeGreaterThan(NO_STAMP);
      expect(field[(h - 1) * w + 11]).toBeGreaterThan(NO_STAMP);
    },
  );

  // ADR 0055, decision 7: the brush on the slime field (slime-paint.wgsl, slime-paint.frag). The Slime tool gives the
  // open cells of its stroke the stamp of the current step, with the footprint of a food stroke. An erase and a wall
  // clear the stamp of their cells. Clear clears every stamp. Sim.paintSlime() paints only that, after a reset.
  describe('the brush', () => {
    // No side is a multiple of 16 cells, the side of a workgroup of the brush on WebGPU.
    const [BW, BH] = [50, 37];

    /**
     * Stroke after stroke on the CPU: each stroke changes the environment first (paint-reference.ts), then the field
     * (slime-reference.ts slimePaint()). `step`: the steps that ran so far. `margin`: the smallest distance of a cell
     * centre from the edge of a brush.
     */
    function reference(
      s: Settings,
      [w, h]: readonly [number, number],
      strokes: readonly Stroke[],
      step = 0,
      from?: { env: Uint8Array; stamps: Uint32Array },
    ) {
      const env = from?.env.slice() ?? new Uint8Array(w * h * 4);
      const stamps = from?.stamps.slice() ?? new Uint32Array(w * h);
      const margin = { min: Infinity };
      for (const stroke of strokes) {
        paintReference(env, w, h, stroke, s.boundary, margin);
        slimePaint({ width: w, height: h, boundary: s.boundary, env }, s, step, stamps, stroke);
      }
      return { env, stamps, margin: margin.min };
    }

    /** The smallest distance of a cell centre from the rim of the dish: float32 may put a cell that close outside. */
    function rimMargin(w: number, h: number) {
      let min = Infinity;
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++)
          min = Math.min(min, Math.abs(Math.hypot(x + 0.5 - w / 2, y + 0.5 - h / 2) - dishRadius(w, h)));
      return min;
    }

    const wallAt = (env: Uint8Array, c: number) => (env[c * 4] ?? 0) >= 128;
    const foodAt = (env: Uint8Array, c: number) => (env[c * 4 + 1] ?? 0) === 255;
    const inside = (c: number, w: number, h: number, boundary: Boundary) =>
      cellIndex(c % w, Math.floor(c / w), w, h, boundary) >= 0;
    const as = (kind: EnvTool, strokes: readonly Stroke[]): Stroke[] => strokes.map((stroke) => ({ ...stroke, kind }));

    /** A wall down the middle, and strokes beside it, across it, across two edges of the grid and into a corner. */
    const WALL: Stroke = { kind: 'wall', from: [24.3, 6.2], to: [24.3, 30.4], radius: 1.1 };
    const COAT: Stroke[] = [
      { kind: 'slime', from: [12.37, 18.21], to: [12.37, 18.21], radius: 4.33 },
      { kind: 'slime', from: [18.23, 12.41], to: [31.61, 14.17], radius: 2.27 }, // across the wall
      { kind: 'slime', from: [47.63, 20.31], to: [53.17, 22.43], radius: 3.21 }, // across the right edge
      { kind: 'slime', from: [30.29, 35.61], to: [30.29, 35.61], radius: 3.77 }, // across the bottom edge
      { kind: 'slime', from: [0.37, 0.41], to: [0.37, 0.41], radius: 2.83 }, // into the four corners of a periodic grid
    ];

    it.each(BOUNDARIES)(
      'gives the open cells in the footprint of a food stroke the stamp of the current step, in the arena %s',
      async (boundary) => {
        const s = slimy({ boundary });
        const size = [BW, BH] as const;
        const ref = reference(s, size, [WALL, ...COAT]);
        expect(ref.margin).toBeGreaterThan(1e-3);
        expect(rimMargin(BW, BH)).toBeGreaterThan(1e-3);
        const sim = await make(s, BW, BH);
        sim.paint([WALL]);
        const [env, shape, revision] = [await sim.readEnv(), await sim.readShape(), sim.revision];
        sim.paint(COAT);
        const field = await sim.readSlime();
        expect(field).toEqual(ref.stamps);
        // The first stroke of the run: every stamp is the one of step 0.
        expect(new Set(field)).toEqual(new Set([NO_STAMP, stampOf(0)]));
        expect(sim.step).toBe(0);
        // The picture will show the slime: the stroke counts as a change of the state.
        expect(sim.revision).toBeGreaterThan(revision);
        // The stroke changes no byte of the environment and of its outlines.
        expect(await sim.readEnv()).toEqual(env);
        expect(await sim.readShape()).toEqual(shape);
        expect(env).toEqual(ref.env);

        // The cells that food strokes with the same numbers paint, less the walls.
        const other = await make(s, BW, BH);
        other.paint([WALL, ...as('food', COAT)]);
        const food = await other.readEnv();
        const cells = [...field.keys()];
        const expected = cells.filter((c) => foodAt(food, c) && !wallAt(food, c));
        expect(stamped(field).map(([c]) => c)).toEqual(expected);
        // Food lies on cells of the wall, and no stamp does. No stamp lies outside the arena.
        expect(cells.filter((c) => foodAt(food, c) && wallAt(food, c)).length).toBeGreaterThan(5);
        expect(stamped(field).filter(([c]) => wallAt(env, c) || !inside(c, BW, BH, boundary))).toEqual([]);
        // The strokes across the edges: on the periodic grid they come back on the other side, in a box they end at the
        // edge, and in the dish every one of these cells lies outside.
        const at = (x: number, y: number) => field[y * BW + x];
        const edges = [at(49, 21), at(1, 22), at(30, BH - 1), at(30, 1), at(0, 0), at(BW - 1, BH - 1)];
        const none = NO_STAMP;
        const one = stampOf(0);
        if (boundary === 'wrap') expect(edges).toEqual([one, one, one, one, one, one]);
        if (boundary === 'box') expect(edges).toEqual([one, none, one, none, one, none]);
        if (boundary === 'dish') expect(edges).toEqual([none, none, none, none, none, none]);
        // In every arena the dab beside the wall is whole, and the drag across the wall has a gap of the wall's cells.
        expect([at(12, 18), at(20, 12), at(24, 13), at(29, 14)]).toEqual([one, one, none, one]);

        // Three steps later a stroke gives its cells the stamp of the fourth step, and the others keep theirs. The
        // run has no agent and no trail, so no step writes a stamp.
        sim.run(3);
        expect(await sim.readSlime()).toEqual(ref.stamps);
        const later: Stroke = { kind: 'slime', from: [14.21, 20.33], to: [22.47, 24.19], radius: 2.41 };
        const next = reference(s, size, [later], 3, ref);
        expect(next.margin).toBeGreaterThan(1e-3);
        sim.paint([later]);
        const after = await sim.readSlime();
        expect(after).toEqual(next.stamps);
        expect([after[18 * BW + 12], after[20 * BW + 14], after[24 * BW + 22]]).toEqual([one, stampOf(3), stampOf(3)]);
        expect(stampOf(3)).toBe(4);
      },
    );

    it('lets an erase and a wall clear the stamps of their cells, and no other kind of stroke', async () => {
      const s = slimy({ boundary: 'box' });
      const size = [BW, BH] as const;
      const sim = await make(s, BW, BH);
      // The slime of a colony: plasm on a block of cells in the first step.
      const block: number[] = [];
      for (let y = 22; y < 32; y++) for (let x = 30; x < 44; x++) block.push(y * BW + x);
      sim.writeTrail(
        trailOf(
          block.map((c) => [c, 0, 9000] as const),
          BW * BH,
        ),
      );
      sim.run(1);
      const colony = await sim.readSlime();
      expect(stamped(colony)).toEqual(block.map((c) => [c, stampOf(0)]));
      // Painted slime beside it, one step later, and a stroke of every other kind over both.
      const strokes: Stroke[] = [
        { kind: 'slime', from: [6.31, 9.43], to: [44.67, 9.43], radius: 5.61 },
        { kind: 'erase', from: [10.23, 9.37], to: [10.23, 9.37], radius: 2.87 },
        { kind: 'wall', from: [17.41, 3.23], to: [17.41, 15.61], radius: 0.93 },
        { kind: 'food', from: [23.37, 9.29], to: [23.37, 9.29], radius: 2.21 },
        { kind: 'light', from: [29.43, 9.31], to: [29.43, 9.31], radius: 2.63 },
        { kind: 'cathode', from: [35.29, 9.47], to: [35.29, 9.47], radius: 2.17 },
        { kind: 'anode', from: [41.37, 9.23], to: [41.37, 9.23], radius: 2.31 },
        { kind: 'erase', from: [32.31, 24.43], to: [32.31, 24.43], radius: 2.21 },
        { kind: 'wall', from: [36.43, 20.37], to: [36.43, 33.29], radius: 0.87 },
        { kind: 'food', from: [40.31, 24.37], to: [40.31, 24.37], radius: 1.83 },
        { kind: 'light', from: [40.29, 29.41], to: [40.29, 29.41], radius: 1.91 },
        { kind: 'cathode', from: [32.37, 29.43], to: [32.37, 29.43], radius: 1.37 },
        { kind: 'anode', from: [43.21, 27.31], to: [43.21, 27.31], radius: 1.29 },
      ];
      const ref = reference(s, size, strokes, 1, { env: new Uint8Array(BW * BH * 4), stamps: colony });
      expect(ref.margin).toBeGreaterThan(1e-3);
      sim.paint(strokes);
      const field = await sim.readSlime();
      expect(field).toEqual(ref.stamps);
      const env = await sim.readEnv();
      const at = (x: number, y: number) => field[y * BW + x];
      const [brush, plasm, none] = [stampOf(1), stampOf(0), NO_STAMP];
      // The painted strip: erased, under the wall, and under food, light and the two poles.
      expect([at(10, 9), at(17, 9), at(23, 9), at(29, 9), at(35, 9), at(41, 9)]).toEqual([
        none,
        none,
        brush,
        brush,
        brush,
        brush,
      ]);
      // The slime of the colony: erased, under the wall, and under food, light and the two poles.
      expect([at(32, 24), at(36, 26), at(40, 24), at(40, 29), at(32, 29), at(43, 27)]).toEqual([
        none,
        none,
        plasm,
        plasm,
        plasm,
        plasm,
      ]);
      // No wall holds a stamp, and the other kinds lie on cells with a stamp.
      const cells = [...field.keys()];
      expect(cells.filter((c) => wallAt(env, c)).length).toBeGreaterThan(20);
      expect(cells.filter((c) => wallAt(env, c) && field[c] !== NO_STAMP)).toEqual([]);
      for (const byte of [1, 2, 3])
        expect(cells.filter((c) => (env[c * 4 + byte] ?? 0) > 0 && field[c] !== NO_STAMP).length).toBeGreaterThan(8);
    });

    it('clears every stamp with Clear, of the brush and of the colony, and stamps again after it', async () => {
      const s = slimy({ boundary: 'wrap' });
      const size = [BW, BH] as const;
      const sim = await make(s, BW, BH);
      const block = [5 * BW + 5, 5 * BW + 6, 30 * BW + 44];
      const plasm = trailOf(
        block.map((c) => [c, 0, 9000] as const),
        BW * BH,
      );
      sim.writeTrail(plasm);
      sim.run(2);
      sim.paint([WALL, ...COAT]);
      expect(stamped(await sim.readSlime()).length).toBeGreaterThan(100);
      sim.clearEnvironment();
      expect(stamped(await sim.readSlime())).toEqual([]);
      expect((await sim.readEnv()).every((v) => v === 0)).toBe(true);
      // An erase and a wall on the empty field, then slime: the stamp of the third step.
      const strokes: Stroke[] = [
        { kind: 'erase', from: [12.31, 18.27], to: [12.31, 18.27], radius: 2.13 },
        WALL,
        ...COAT,
      ];
      const ref = reference(s, size, strokes, 2);
      sim.paint(strokes);
      expect(await sim.readSlime()).toEqual(ref.stamps);
      expect(new Set(ref.stamps)).toEqual(new Set([NO_STAMP, stampOf(2)]));
      // Clear again, and the colony stamps its cells in the next step: an erase over one of them clears it.
      sim.clearEnvironment();
      sim.writeTrail(plasm);
      sim.run(1);
      expect(stamped(await sim.readSlime())).toEqual(block.map((c) => [c, stampOf(2)]));
      sim.paint([{ kind: 'erase', from: [5.41, 5.37], to: [5.41, 5.37], radius: 0.75 }]);
      expect(stamped(await sim.readSlime())).toEqual(block.slice(1).map((c) => [c, stampOf(2)]));
    });

    // A stroke keeps the arena that it was painted in (Stroke.boundary), and the simulation can run in another one.
    it.each([
      ['dish', 'wrap'],
      ['dish', 'box'],
      ['box', 'dish'],
      ['box', 'wrap'],
      ['wrap', 'dish'],
      ['wrap', 'box'],
    ] as const)(
      'stamps no cell outside the arena %s of the simulation, with strokes painted in the arena %s',
      async (boundary, painted) => {
        const s = slimy({ boundary });
        const size = [BW, BH] as const;
        const strokes = [WALL, ...COAT, { ...WALL, kind: 'slime' as const, radius: 9.37 }].map((stroke): Stroke => ({
          ...stroke,
          boundary: painted,
        }));
        const ref = reference(s, size, strokes);
        expect(ref.margin).toBeGreaterThan(1e-3);
        const sim = await make(s, BW, BH);
        sim.paint(strokes);
        const field = await sim.readSlime();
        expect(field).toEqual(ref.stamps);
        // The cells that food strokes with the same numbers paint in their arena, less the walls and the cells outside
        // the arena of the simulation.
        const other = await make(s, BW, BH);
        other.paint(strokes.map((stroke) => (stroke.kind === 'slime' ? { ...stroke, kind: 'food' as const } : stroke)));
        const food = await other.readEnv();
        const cells = [...field.keys()];
        const open = (c: number) => !wallAt(food, c) && inside(c, BW, BH, boundary);
        expect(stamped(field).map(([c]) => c)).toEqual(cells.filter((c) => foodAt(food, c) && open(c)));
        const lost = cells.filter((c) => foodAt(food, c) && !inside(c, BW, BH, boundary)).length;
        const cut = cells.filter((c) => !inside(c, BW, BH, painted) && inside(c, BW, BH, boundary));
        // A dish is the only arena that is smaller than the grid: food lies outside it, and no stamp does.
        if (boundary === 'dish') expect(lost).toBeGreaterThan(30);
        else expect(lost).toBe(0);
        // A stroke of a dish ends at the rim of its dish, also in a larger arena.
        if (painted === 'dish') expect(cut.length).toBeGreaterThan(300);
        expect(cut.filter((c) => field[c] !== NO_STAMP)).toEqual([]);
        expect(stamped(field).length).toBeGreaterThan(150);
      },
    );

    it('paints strokes that are longer than a periodic grid, and a brush that is larger than it', async () => {
      const s = slimy({ boundary: 'wrap' });
      const size = [BW, BH] as const;
      const sim = await make(s, BW, BH);
      const strokes: Stroke[] = [
        WALL,
        { kind: 'slime', from: [-70.31, 10.63], to: [140.77, -60.41], radius: 0.98 }, // over four periods
        { kind: 'slime', from: [2 * BW + 40.23, 3 * BH + 5.43], to: [2 * BW + 40.23, 3 * BH + 5.43], radius: 2.71 },
        { kind: 'erase', from: [-20.17, 30.29], to: [100.43, 31.61], radius: 1.21 }, // longer than the grid
      ];
      const ref = reference(s, size, strokes);
      expect(ref.margin).toBeGreaterThan(1e-3);
      sim.paint(strokes);
      expect(await sim.readSlime()).toEqual(ref.stamps);
      const some = stamped(ref.stamps).length;
      expect(some).toBeGreaterThan(150);
      expect(some).toBeLessThan((BW * BH) / 2);
      // A brush wider than the grid stamps every cell but those of the wall.
      const wide: Stroke = { kind: 'slime', from: [5.31, 30.37], to: [5.31, 30.37], radius: 41.22 };
      const all = reference(s, size, [wide], 0, ref);
      expect(all.margin).toBeGreaterThan(1e-3);
      sim.paint([wide]);
      const field = await sim.readSlime();
      expect(field).toEqual(all.stamps);
      const walls = [...field.keys()].filter((c) => wallAt(ref.env, c));
      expect(walls.length).toBeGreaterThan(40);
      expect(stamped(field).length).toBe(BW * BH - walls.length);
    });

    /** mulberry32: a seeded random source, so a failure repeats. */
    const random = (seed: number) => () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
    };

    /**
     * `count` random strokes on the grid of the brush and beside it: slime, walls and erases most of all, and the
     * other kinds between them. No cell centre lies within 0.001 cells of the edge of a brush.
     */
    function randomStrokes(seed: number, count: number, boundary: Boundary): Stroke[] {
      const r = random(seed);
      const kinds: EnvTool[] = ['slime', 'slime', 'slime', 'wall', 'wall', 'erase', 'erase', 'food', 'light', 'anode'];
      const strokes: Stroke[] = [];
      while (strokes.length < count) {
        const from: [number, number] = [r() * (BW + 8) - 4, r() * (BH + 8) - 4];
        const to: [number, number] = r() < 0.4 ? from : [from[0] + (r() - 0.5) * 16, from[1] + (r() - 0.5) * 16];
        const kind = kinds[Math.floor(r() * kinds.length)] ?? 'slime';
        const stroke: Stroke = { kind, from, to, radius: 0.75 + r() * (kind === 'wall' ? 1.5 : 4) };
        const margin = { min: Infinity };
        paintReference(new Uint8Array(BW * BH * 4), BW, BH, stroke, boundary, margin);
        if (margin.min >= 1e-3) strokes.push(stroke);
      }
      return strokes;
    }

    // Decision 7: after a reset the engine paints the slime of its edit list again, against the walls of now
    // (Sim.paintSlime()). That gives the field of the strokes in their order. paint() itself changes the environment of
    // all its strokes first, and then the field.
    it.each(BOUNDARIES)(
      'paints the field of one stroke after another, in one call and after a reset, in the arena %s',
      async (boundary) => {
        const s = slimy({ boundary });
        const size = [BW, BH] as const;
        const strokes = randomStrokes(17 + BOUNDARIES.indexOf(boundary), 160, boundary);
        const ref = reference(s, size, strokes);
        // The strokes leave slime, walls, and cells whose slime a later stroke cleared.
        const walls = [...ref.stamps.keys()].filter((c) => wallAt(ref.env, c));
        expect(stamped(ref.stamps).length).toBeGreaterThan(100);
        expect(walls.length).toBeGreaterThan(30);
        expect(walls.filter((c) => ref.stamps[c] !== NO_STAMP)).toEqual([]);
        // One call per stroke.
        const one = await make(s, BW, BH);
        for (const stroke of strokes) one.paint([stroke]);
        expect(await one.readSlime()).toEqual(ref.stamps);
        // One call with every stroke.
        const all = await make(s, BW, BH);
        all.paint(strokes);
        expect(await all.readSlime()).toEqual(ref.stamps);
        expect(await all.readEnv()).toEqual(await one.readEnv());

        // A reset clears every stamp and keeps the environment. The slime of the strokes from the first slime stroke
        // on, painted against the walls of now, is the field of before.
        const first = strokes.findIndex((stroke) => stroke.kind === 'slime');
        for (const sim of [one, all]) {
          const [env, revision] = [await sim.readEnv(), sim.revision];
          sim.reset();
          expect(stamped(await sim.readSlime())).toEqual([]);
          sim.paintSlime(strokes.slice(first));
          expect(await sim.readSlime()).toEqual(ref.stamps);
          expect(await sim.readEnv()).toEqual(env);
          expect(sim.revision).toBeGreaterThan(revision + 1);
        }
        // Painted again two steps later, every stamp is the one of the third step.
        all.run(2);
        all.paintSlime(strokes);
        expect(await all.readSlime()).toEqual(ref.stamps.map((v) => (v === NO_STAMP ? NO_STAMP : stampOf(2))));
        // Strokes that hold no slime, no erase and no wall paint nothing, and count as no change.
        const revision = all.revision;
        all.paintSlime(strokes.filter((stroke) => ['food', 'light', 'anode'].includes(stroke.kind)));
        all.paintSlime([]);
        expect(all.revision).toBe(revision);
      },
    );

    // WebGPU paints 4096 segments per submission: 5000 strokes cross that edge.
    it('paints 5000 strokes in one call as the CPU reference does', async () => {
      const s = slimy({ boundary: 'wrap' });
      const strokes = randomStrokes(5, 5000, 'wrap');
      const ref = reference(s, [BW, BH], strokes);
      const sim = await make(s, BW, BH);
      sim.paint(strokes);
      expect(await sim.readSlime()).toEqual(ref.stamps);
      expect(stamped(ref.stamps).length).toBeGreaterThan(100);
    }, 120_000);

    it('paints with a life time of 0 too: the field keeps the stamp for a later life time', async () => {
      const s = slimy({ boundary: 'box', slimeLife: 0 });
      const sim = await make(s, BW, BH);
      const ref = reference(s, [BW, BH], [WALL, ...COAT]);
      sim.paint([WALL, ...COAT]);
      expect(await sim.readSlime()).toEqual(ref.stamps);
      expect(stamped(ref.stamps).length).toBeGreaterThan(100);
      sim.update({ ...s, slimeLife: 144 });
      sim.run(1);
      expect(await sim.readSlime()).toEqual(ref.stamps);
    });

    it('paints no slime in the Jones model, and paints it when the model has its field again', async () => {
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
      const extended: Settings = { ...jones, model: 'extended' };
      const size = [BW, BH] as const;
      const strokes: Stroke[] = [
        WALL,
        ...COAT,
        { kind: 'erase', from: [12.43, 16.31], to: [12.43, 16.31], radius: 1.87 },
        { kind: 'food', from: [30.31, 20.43], to: [30.31, 20.43], radius: 2.37 },
      ];
      const sim = await make(jones, BW, BH, 40);
      sim.paint(strokes);
      // The environment of the strokes, as in the extended model, and no stamp.
      const ref = reference(extended, size, strokes);
      expect(await sim.readEnv()).toEqual(ref.env);
      expect(stamped(await sim.readSlime())).toEqual([]);
      const revision = sim.revision;
      sim.paintSlime(strokes);
      sim.paint(COAT);
      expect(sim.revision).toBe(revision);
      expect(stamped(await sim.readSlime())).toEqual([]);
      expect(sim.hasEnvironment).toBe(true);
      // The extended model on the same simulation starts without a stamp. The engine then paints the slime of its
      // list again.
      sim.update(extended);
      expect(stamped(await sim.readSlime())).toEqual([]);
      sim.paintSlime(strokes);
      expect(await sim.readSlime()).toEqual(ref.stamps);
      expect(await sim.readEnv()).toEqual(ref.env);
      // Back in the Jones model the field is gone, with the painted slime.
      sim.update(jones);
      expect(stamped(await sim.readSlime())).toEqual([]);
      // Slime alone is no environment: the picture has no food, light or wall to draw.
      const bare = await make(extended, BW, BH, 40);
      bare.paint(COAT);
      expect(bare.hasEnvironment).toBe(false);
      expect(stamped(await bare.readSlime()).length).toBeGreaterThan(100);
    });
  });
});
