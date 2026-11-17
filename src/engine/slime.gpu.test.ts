// The slime field on both backends (ADR 0055), in Chromium with real GPU APIs (ADR 0010): the pass of the stamps, the
// brush on the field and the picture of the slime against the CPU reference, and the rules in plain cases.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { hexToLinear } from '../model/color';
import { BOUNDARIES, defaultSettings, defaultStrain, STYLES, type Boundary, type Settings } from '../model/params';
import { at } from './at';
import { cellIndex, dishRadius } from './brush';
import { trailLevels } from './flow';
import { openCell, type FlowGrid } from './flow-reference';
import { WebGl2Backend } from './gl/backend';
import renderFrag from './gl/glsl/render.frag?raw';
import { compile } from './gl/programs';
import { paintReference } from './paint-reference';
import { BACKGROUND, LATTICE_COPIES, SLIME_LOOK, trailLevel } from './render';
import renderWgsl from './shaders/render.wgsl?raw';
import { equilibrium } from './sizing';
import { NO_STAMP, slimeShown, slimeSteps, stampOf, STEPS_PER_HOUR } from './slime';
import { slimeLayer, slimePaint, slimeStep, slimeStrength } from './slime-reference';
import { changesSlime, type Backend, type EnvTool, type Sim, type Stroke, type View } from './types';
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

/** `source` with the one match of `from` replaced by `to`, for each pair of `edits` in turn. */
function rewrite(source: string, edits: readonly (readonly [from: string, to: string])[]) {
  return edits.reduce((text, [from, to]) => {
    if (text.split(from).length !== 2) throw new Error(`Not found once: ${from}`);
    return text.replace(from, to);
  }, source);
}

/** `source` without the text from the one match of `start` up to the next match of `end`. */
function cutSpan(source: string, start: string, end: string) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a);
  if (a < 0 || b < 0 || source.includes(start, a + 1)) throw new Error(`Not found once: ${start}`);
  return source.slice(0, a) + source.slice(b);
}

/**
 * The render shaders without the layer of the slime (ADR 0055, decision 8). These give the files of the commit before
 * the layer (460ea68) byte for byte, on both backends; view.glsl differs from that commit only by the two fields of
 * the slime at the end of its block, which no code of that commit reads.
 */
const WITHOUT_SLIME = {
  wgsl: cutSpan(
    rewrite(renderWgsl, [
      [
        '// The layer of the slime (ADR 0055, decision 8), compiled in only while a frame draws it (render.ts).\noverride SLIME: bool = false;\n',
        '',
      ],
      [
        '  slime: vec4u,       // the slime: the steps that ran so far, the life time of the slime in steps, 2 unused\n' +
          '  slimeFx: vec4f,     // the slime: the colour of its layer, linear RGB, and the full strength of the layer\n',
        '',
      ],
      [
        '@group(0) @binding(14) var<storage, read> stamps: array<u32>; // the slime field (slime.wgsl); read for the slime only\n',
        '',
      ],
      [
        '// What lies below the trail: the ground `bg`, or the flake on it. The trail and the agents lie on top.\nfn substrate(f: Flake, bg: vec3f) -> vec3f {\n',
        '// What lies below the trail: the background, or the flake on it. The trail and the agents lie on top.\nfn substrate(f: Flake) -> vec3f {\n  let bg = V.background.rgb;\n',
      ],
      [
        '  // The slime tints the ground: the flake of food, the trail and all else lie on it.\n' +
          '  if (SLIME) {\n    var open = vec4f(1.0);\n    if (ENV && near) { open = unwalled(p, cells); }\n' +
          '    base = slimed(base, p, open);\n  }\n',
        '',
      ],
      ['    base = substrate(f, base);\n', '    base = substrate(f);\n'],
    ]),
    '// ---- The slime (SLIME) ---',
    '// The arena at grid position p:',
  ),
  glsl: cutSpan(
    rewrite(renderFrag, [
      ['vec3 substrate(Flake f, vec3 bg) {\n', 'vec3 substrate(Flake f) {\n  vec3 bg = V.background.rgb;\n'],
      [
        '#ifdef SLIME\n  // The slime tints the ground: the flake of food, the trail and all else lie on it (see scene in render.wgsl).\n' +
          '  vec4 open = vec4(1.0);\n#if ENV\n  if (near) open = unwalled(p, cells);\n#endif\n' +
          '  base = slimed(base, p, open);\n#endif\n',
        '',
      ],
      ['    base = substrate(f, base);\n', '    base = substrate(f);\n'],
    ]),
    '#ifdef SLIME\n// ---- The slime',
    '#ifdef SCENT\n// ---- Scent view',
  ),
};

/** sRGB byte → linear light. */
const fromByte = (b: number) => {
  const x = b / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
};
/** Linear light → sRGB byte, without the dither (render.wgsl `srgb`). */
const toByte = (c: number) => {
  const x = Math.min(1, Math.max(0, c));
  return Math.round((x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055) * 255);
};
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
type Rgb = [number, number, number];
const mix = (a: Rgb, b: Rgb, t: number) => a.map((v, k) => v + ((b[k] ?? 0) - v) * t) as Rgb;

/**
 * The ground of a style with slime of the strength `share` on it, linear RGB (render.wgsl `slimed`): the colour of the
 * layer over the background, with the share `share` of the full strength of the style.
 */
function slimedGround(style: Settings['style'], share: number): Rgb {
  const look = SLIME_LOOK[style];
  return mix(hexToLinear(BACKGROUND[style]), hexToLinear(look.color), look.strength * share);
}

/**
 * The picture of a simulation without trail, food, light and walls on the CPU, as render.wgsl `fs` draws it, 3 bytes
 * per pixel: inside the arena the ground, with the layer of the slime on it while `layer` is true (slimeLayer() in
 * slime-reference.ts), and outside it the free space, with a ramp one pixel wide between them. Around a periodic
 * lattice the copies of the grid show dimmed (ADR 0026). `stamps`: the slime field of the simulation; `env`: its
 * environment, which holds no wall, or no walls at all; `step`: the steps that ran so far.
 */
function groundPicture(
  stamps: Uint32Array,
  env: Uint8Array | undefined,
  [w, h]: readonly [number, number],
  settings: Settings,
  step: number,
  view: View,
  [cw, ch]: readonly [number, number],
  layer = true,
): Uint8Array {
  const out = new Uint8Array(cw * ch * 3);
  const bg = hexToLinear(BACKGROUND[settings.style]);
  const space = bg.map((v) => v * (settings.style === 'paper' ? 0.92 : 0.55)) as Rgb;
  const life = slimeSteps(settings);
  const level = trailLevel(view.scale);
  const grid: FlowGrid = { width: w, height: h, boundary: settings.boundary, env: env ?? new Uint8Array(w * h * 4) };
  const ramp = (sd: number) => smoothstep(-0.5 * view.scale, 0.5 * view.scale, sd);
  const copies = settings.lattice && settings.boundary === 'wrap' ? LATTICE_COPIES : 1;
  for (let y = 0; y < ch; y++)
    for (let x = 0; x < cw; x++) {
      const p = [
        (x + 0.5 - cw / 2) * view.scale + view.center[0],
        (y + 0.5 - ch / 2) * view.scale + view.center[1],
      ] as const;
      const box = ramp(Math.min(p[0], p[1], w - p[0], h - p[1]));
      const inside =
        settings.boundary === 'wrap'
          ? 1
          : settings.boundary === 'box'
            ? box
            : ramp(dishRadius(w, h) - Math.hypot(p[0] - w / 2, p[1] - h / 2));
      let c = space;
      if (inside > 0) {
        const share = layer ? slimeLayer(stamps, grid, step, life, p, view.scale, level) : 0;
        const inner = slimedGround(settings.style, share);
        c = inside >= 1 ? inner : mix(space, inner, inside);
      }
      if (copies < 1) c = mix(mix(space, c, copies), c, box);
      for (let k = 0; k < 3; k++) out[(y * cw + x) * 3 + k] = toByte(c[k] ?? 0);
    }
  return out;
}

/** The largest difference of a channel between a capture and a picture of 3 bytes per pixel. */
function worst(img: ImageData, want: Uint8Array) {
  let max = 0;
  for (let i = 0; i < img.width * img.height; i++)
    for (let k = 0; k < 3; k++) max = Math.max(max, Math.abs((img.data[i * 4 + k] ?? 0) - (want[i * 3 + k] ?? 0)));
  return max;
}

/** The largest difference of one channel between two captures. */
function maxDiff(a: ImageData, b: ImageData) {
  let max = 0;
  for (let i = 0; i < a.data.length; i++)
    if (i % 4 !== 3) max = Math.max(max, Math.abs((a.data[i] ?? 0) - (b.data[i] ?? 0)));
  return max;
}

/** The colour of the pixel (x, y) of a capture, as bytes. */
const pixel = (img: ImageData, x: number, y: number) => [
  ...img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 3),
];

describe.each(Object.entries(BACKENDS))('the slime field on %s', (kind, create) => {
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

    // The brush on the field and the brush on the environment take one copy of the segment of a stroke (brush.wgsl,
    // brush.glsl). So they reach the same cells, also where a cell centre lies at the edge of a brush and float32
    // decides. The CPU reference cannot tell such a cell, so the two brushes are compared with each other: food and
    // slime of the same strokes lie on the same cells, and an erase and a wall clear both on the same cells.
    it.each(BOUNDARIES)(
      'reaches the cells that the brush on the environment reaches, at the edge of a brush too, in the arena %s',
      async (boundary) => {
        const s = slimy({ boundary });
        const sim = await make(s, BW, BH);
        const r = random(41 + BOUNDARIES.indexOf(boundary));
        /** Strokes between cell centres and cell corners, with radii of whole and half cells, on the grid and beside it. */
        const strokesOf = (kind: EnvTool, count: number): Stroke[] =>
          Array.from({ length: count }, () => {
            const at = (n: number) => Math.floor(r() * (n + 4)) - 2 + (r() < 0.5 ? 0.5 : 0);
            const from: [number, number] = [at(BW), at(BH)];
            const step = () => Math.floor(r() * 13) - 6;
            const to: [number, number] = r() < 0.4 ? from : [from[0] + step(), from[1] + step()];
            return { kind, from, to, radius: 1 + Math.floor(r() * 8) / 2 };
          });
        /** The cells with food, which must be the cells with a stamp. */
        const both = async (what: string) => {
          const [env, field] = [await sim.readEnv(), await sim.readSlime()];
          const food = [...field.keys()].filter((c) => foodAt(env, c));
          expect(
            stamped(field).map(([c]) => c),
            what,
          ).toEqual(food);
          return food.length;
        };
        const coats = strokesOf('slime', 40);
        const erases = strokesOf('erase', 12);
        const walls = strokesOf('wall', 12);
        // Of the 64 strokes, more than 10 have a cell centre of the arena at the edge of their brush, by the CPU reference
        // in float64.
        const atEdge = [...coats, ...erases, ...walls].filter((stroke) => {
          const margin = { min: Infinity };
          paintReference(new Uint8Array(BW * BH * 4), BW, BH, stroke, boundary, margin);
          return margin.min < 1e-9;
        });
        expect(atEdge.length).toBeGreaterThan(10);
        sim.paint([...as('food', coats), ...coats]);
        const painted = await both('food and slime of the same strokes');
        expect(painted).toBeGreaterThan(300);
        sim.paint(erases);
        const erased = await both('after the erases');
        expect(erased).toBeLessThan(painted - 50);
        sim.paint(walls);
        const walled = await both('after the walls');
        expect(walled).toBeLessThan(erased - 20);
        expect(walled).toBeGreaterThan(50);
      },
    );

    // WebGPU paints 4096 segments per submission. Of 6400 strokes, more than 4096 change the field: the brush on the
    // field crosses that edge, as the brush on the environment does.
    it('paints 6400 strokes in one call as the CPU reference does', async () => {
      const s = slimy({ boundary: 'wrap' });
      const strokes = randomStrokes(5, 6400, 'wrap');
      expect(strokes.filter((stroke) => changesSlime(stroke.kind)).length).toBeGreaterThan(4096);
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

  // ADR 0055, decision 8: the picture draws the slime as a pale layer on the ground (`slimed` in render.wgsl and
  // render.frag). The layer is as strong as the slime is young, and it is gone at the life time. The food, the trail,
  // the light, the walls and the electrodes lie on it. Without the layer every pixel is the one of the code before.
  describe('the picture', () => {
    beforeEach(() => {
      // No levels of an earlier test: a frame without them draws the trail with the same gain on every run.
      backend.forget();
    });
    const [PW, PH] = [64, 48];
    /** The life time of the slime in these tests, in steps: a part of an hour, past sanitize(). */
    const LIFE = 12;
    const pictured = (patch: Partial<Settings> = {}): Settings =>
      slimy({ boundary: 'box', bloom: 0, slimeLife: LIFE / STEPS_PER_HOUR, ...patch });
    const dab = (x: number, y: number, radius: number): Stroke => ({ kind: 'slime', from: [x, y], to: [x, y], radius });
    /** 8 pixels per cell on a canvas of 512 × 384 pixels: the pixel (8 c, 8 r) has its centre on that of cell (c, r). */
    const CLOSE: View = { center: [32.4375, 24.4375], scale: 1 / 8 };
    const close = (sim: Sim, settings: Settings) => backend.capture(sim, settings, CLOSE, 512, 384);
    const bytes = (c: Rgb) => c.map(toByte);
    /** The largest difference of a channel between two colours in bytes. */
    const off = (a: number[], b: number[]) => Math.max(...a.map((v, k) => Math.abs(v - (b[k] ?? 0))));

    it('has a life time of 12 steps here, and no living agent leaves a trail', async () => {
      const s = pictured();
      expect(slimeSteps(s)).toBe(LIFE);
      const sim = await make(s, PW, PH);
      sim.run(3);
      expect((await sim.readTrail()).some((v) => v !== 0)).toBe(false);
      expect(stamped(await sim.readSlime())).toEqual([]);
    });

    // Four dabs, painted 9, 6, 3 and 0 steps before the picture. The pixel on the centre of a cell shows the strength
    // of that cell alone: A · (1 − age / life time) of the colour of the style over the ground.
    it.each(STYLES)(
      'draws slime of the age 0 at the full strength of the style, older slime weaker in a straight line (%s)',
      async (style) => {
        const s = pictured({ style });
        const sim = await make(s, PW, PH);
        const [old, mid, young, fresh, bare] = [10, 20, 30, 40, 52];
        for (const x of [old, mid, young, fresh]) {
          sim.paint([dab(x + 0.5, 10.5, 2.2)]);
          if (x !== fresh) sim.run(3);
        }
        expect(sim.step).toBe(9);
        const field = await sim.readSlime();
        expect([old, mid, young, fresh, bare].map((x) => field[10 * PW + x])).toEqual([1, 4, 7, 10, NO_STAMP]);
        const img = await close(sim, s);
        const at = (x: number) => pixel(img, 8 * x, 80);
        const ground = bytes(slimedGround(style, 0));
        expect(ground).toEqual(bytes(hexToLinear(BACKGROUND[style])));
        // The dither moves a channel by 1 at most.
        expect(off(at(bare), ground)).toBeLessThanOrEqual(1);
        [1, 0.75, 0.5, 0.25].forEach((share, i) => {
          const x = [fresh, young, mid, old][i] ?? 0;
          expect(slimeStrength(field[10 * PW + x] ?? 0, sim.step, LIFE)).toBe(share);
          expect(
            off(at(x), bytes(slimedGround(style, share))),
            `${style}: the share ${String(share)}`,
          ).toBeLessThanOrEqual(1);
        });
        // The layer is clear on plain ground at the age 0, and still there at half the life time.
        expect(off(at(fresh), ground), `${style}: new slime`).toBeGreaterThanOrEqual(12);
        expect(off(at(mid), ground), `${style}: slime at half its life time`).toBeGreaterThanOrEqual(6);
        expect(off(at(fresh), at(mid))).toBeGreaterThanOrEqual(4);
        // Every cell of a dab has the stamp of the dab: its middle is flat, between the cell centres too.
        expect(off(pixel(img, 8 * fresh + 4, 84), at(fresh))).toBeLessThanOrEqual(2);
      },
    );

    it('shows no slime at the life time and after it, and all slime follows a new life time at once', async () => {
      const s = pictured();
      const sim = await make(s, PW, PH);
      sim.paint([dab(10.5, 10.5, 2.2)]);
      const ground = bytes(slimedGround(s.style, 0));
      const shown = async (settings: Settings) => pixel(await close(sim, settings), 80, 80);
      // The last step with slime: the age life − 1.
      sim.run(LIFE - 1);
      expect(off(await shown(s), bytes(slimedGround(s.style, 1 / LIFE)))).toBeLessThanOrEqual(1);
      expect(slimeStrength(1, sim.step, LIFE)).toBeCloseTo(1 / LIFE, 12);
      for (const more of [1, 1, 30]) {
        sim.run(more);
        expect(slimeStrength(1, sim.step, LIFE)).toBe(0);
        const img = await close(sim, s);
        // No pixel of the picture differs from the bare ground: the stamp stays, and the picture draws none of it.
        expect(
          worst(img, groundPicture(new Uint32Array(PW * PH), undefined, [PW, PH], s, sim.step, CLOSE, [512, 384])),
        ).toBeLessThanOrEqual(1);
      }
      expect((await sim.readSlime())[10 * PW + 10]).toBe(1);
      // A life time of 4 times the age: the same stamp shows again, at three quarters of the full strength.
      const longer = { ...s, slimeLife: (4 * sim.step) / STEPS_PER_HOUR };
      expect(off(await shown(longer), bytes(slimedGround(s.style, 0.75)))).toBeLessThanOrEqual(1);
      expect(off(await shown(longer), ground)).toBeGreaterThanOrEqual(8);
    });

    // Between two cell centres the picture blends the strengths of the cells. A blend of the stamps would give the
    // ground beside new slime a stamp of half the step count: after many steps that is old slime, and after few
    // steps slime that is almost new.
    it('blends the strengths of the cells and never their stamps', async () => {
      // The default life time, 259,200 steps: slime of 40 steps is almost new.
      const s = pictured({ slimeLife: 144 });
      const sim = await make(s, PW, PH);
      sim.run(40);
      sim.paint([dab(40.5, 10.5, 2.2)]);
      const field = await sim.readSlime();
      // The last cell of the dab in its row, and the cell beside it.
      expect([field[10 * PW + 42], field[10 * PW + 43]]).toEqual([stampOf(40), NO_STAMP]);
      const img = await close(sim, s);
      const [full, none] = [bytes(slimedGround(s.style, 1)), bytes(slimedGround(s.style, 0))];
      expect(off(pixel(img, 8 * 42, 80), full)).toBeLessThanOrEqual(1);
      expect(off(pixel(img, 8 * 43, 80), none)).toBeLessThanOrEqual(1);
      // Half way between the two cell centres: half the strength, and a quarter and three quarters beside it.
      expect(off(pixel(img, 8 * 42 + 4, 80), bytes(slimedGround(s.style, 0.5)))).toBeLessThanOrEqual(1);
      expect(off(pixel(img, 8 * 42 + 2, 80), bytes(slimedGround(s.style, 0.75)))).toBeLessThanOrEqual(1);
      expect(off(pixel(img, 8 * 42 + 6, 80), bytes(slimedGround(s.style, 0.25)))).toBeLessThanOrEqual(1);
      expect(off(bytes(slimedGround(s.style, 0.5)), full)).toBeGreaterThanOrEqual(6);
    });

    /**
     * Slime of four ages on a grid of 64 × 48 cells, painted between steps: after its 9 steps the strokes are 9, 6, 3
     * and 0 steps old. Dabs and lines across the edges of the grid and into a corner, a line one cell wide, and single
     * cells: what a view zoomed out can lose.
     */
    function coat(sim: Sim) {
      const line = (from: [number, number], to: [number, number], radius: number): Stroke => ({
        kind: 'slime',
        from,
        to,
        radius,
      });
      sim.paint([line([3.3, 11.2], [-5.4, 14.6], 5.3), line([22, 20], [30, 20], 6.5)]);
      sim.run(3);
      sim.paint([line([31.5, 45.2], [33.1, 51.7], 4.2), dab(63.2, 0.4, 3.1), line([30, 22], [38, 26], 4.5)]);
      sim.run(3);
      sim.paint([line([8.5, 30.5], [56.5, 37.5], 0.5), dab(50.5, 10.5, 0.6), dab(52.5, 12.5, 0.6), dab(44, 20, 5)]);
      sim.run(3);
      sim.paint([dab(12, 24, 4), line([40, 40], [60, 44], 2.2), dab(46, 21, 2.5), dab(2.5, 8.5, 1.6)]);
    }

    /**
     * Views of a grid of 64 × 48 cells on a canvas of 96 × 72 pixels: zoomed in at the left edge (in the dish at its
     * rim) and at the bottom edge, at 1 cell per pixel, up to 2 cells per pixel, where the picture takes the exact
     * mean over a pixel, and zoomed out onto the levels 1 to 4 of the trail's map, where one cell stands for a texel.
     */
    const views = (boundary: Boundary): View[] => [
      { center: boundary === 'dish' ? [10.37, 24.21] : [1.37, 11.21], scale: 1 / 8 },
      { center: [32.3, 45.7], scale: 0.6 },
      { center: [32, 24], scale: 1 },
      { center: [32.21, 24.13], scale: 1.5 },
      { center: [32, 24], scale: 2 },
      { center: [30.9, 23.3], scale: 2.5 },
      { center: [33.1, 22.9], scale: 6 },
      { center: [32.4, 24.6], scale: 11 },
      { center: [31.2, 25.1], scale: 20 },
    ];
    const SIZE = [96, 72] as const;

    /**
     * Every pixel of a capture against the picture of the CPU, with the layer and without it. Returns the largest
     * difference of a channel, and the pixels that the layer changes by more than the dither.
     */
    async function follows(sim: Sim, settings: Settings, view: View) {
      const img = await backend.capture(sim, settings, view, SIZE[0], SIZE[1]);
      const size = [sim.width, sim.height] as const;
      const stamps = await sim.readSlime();
      const want = groundPicture(stamps, undefined, size, settings, sim.step, view, SIZE);
      const plain = groundPicture(stamps, undefined, size, settings, sim.step, view, SIZE, false);
      let changed = 0;
      for (let i = 0; i < want.length; i += 3)
        if ([0, 1, 2].some((k) => Math.abs((want[i + k] ?? 0) - (plain[i + k] ?? 0)) > 2)) changed++;
      return { apart: worst(img, want), changed };
    }

    // The whole picture against the CPU reference: bilinear between the cells, the mean over a pixel zoomed out, and
    // the copies of the periodic grid. Each view in another style, and with two life times: at 12 steps every stroke
    // shows, and at 8 steps the oldest is gone.
    it.each(BOUNDARIES)(
      'follows the CPU reference at every zoom, in every style and up to the edge of the arena (%s)',
      async (boundary) => {
        const s = pictured({ boundary });
        const sim = await make(s, PW, PH);
        coat(sim);
        expect(sim.step).toBe(9);
        expect(new Set(await sim.readSlime())).toEqual(new Set([NO_STAMP, 1, 4, 7, 10]));
        const failed: string[] = [];
        const seen = new Set<number>();
        let shown = 0;
        for (const [i, view] of views(boundary).entries())
          for (const life of [LIFE, 8]) {
            const style = STYLES[(i + (life === LIFE ? 0 : 2)) % STYLES.length] ?? 'glow';
            const settings = { ...s, style, slimeLife: life / STEPS_PER_HOUR };
            const { apart, changed } = await follows(sim, settings, view);
            const name = `${style} at ${String(view.scale)} cells per pixel, a life time of ${String(life)} steps`;
            if (apart > 2) failed.push(`${name}: ${String(apart)} apart`);
            // The layer shows in every view. Zoomed far out, a closed arena is a few pixels wide.
            if (changed === 0 && view.scale <= 6) failed.push(`${name}: the layer changes no pixel`);
            shown += changed;
            seen.add(trailLevel(view.scale));
          }
        expect(failed).toEqual([]);
        expect(shown).toBeGreaterThan(8000);
        expect([...seen].sort()).toEqual([0, 1, 2, 3, 4]);
      },
      120_000,
    );

    // A grid whose sides no power of 2 divides: the texels of a level have a part of a cell at their end, and the
    // cell in the middle of a texel is a whole number all the same. As a periodic lattice: its copies show dimmed.
    it('follows the CPU reference on a grid of 26 × 17 cells and on the copies of a periodic lattice', async () => {
      const s = pictured({ boundary: 'wrap', lattice: [W, H] });
      const sim = await make(s);
      sim.paint([dab(3.3, 4.2, 3.4), dab(25.6, 16.7, 2.3)]);
      sim.run(4);
      sim.paint([{ kind: 'slime', from: [7.5, 12.5], to: [20.5, 9.5], radius: 0.5 }, dab(15.5, 2.5, 0.6)]);
      sim.run(3);
      sim.paint([dab(13, 8.5, 2.6)]);
      const zooms: View[] = [0.25, 0.8, 1.3, 2, 3.1, 5.2, 9, 17].map((scale) => ({ center: [13.3, 8.6], scale }));
      const failed: string[] = [];
      for (const [i, view] of zooms.entries())
        for (const lattice of [s.lattice, null]) {
          const settings = { ...s, lattice, style: STYLES[i % STYLES.length] ?? 'glow' };
          const { apart, changed } = await follows(sim, settings, view);
          // The copies around a lattice show at 15 % (ADR 0026), and zoomed out the lattice is a few pixels wide.
          // Without the lattice the copies are as bright as the grid, and the layer shows on every one of them.
          const few = lattice ? view.scale <= 2 && changed < 100 : changed < 400;
          if (apart > 2 || few) failed.push(`${String(view.scale)}: ${String(apart)} apart, ${String(changed)}`);
        }
      expect(failed).toEqual([]);
    });

    // Decision 8: the layer tints the ground. A flake of food covers 95 % of its ground, a wall and a thick trail all
    // of it, and the light and the trail of the glow lie on the ground with the layer.
    it.each(['glow', 'gel', 'paper'] as const)(
      'draws the food, the walls, the light, the electrodes and the trail on the layer (%s)',
      async (style) => {
        // The default life time: slime of the age 0 and 1 is at the full strength.
        const s = pictured({ style, slimeLife: 144 });
        const sim = await make(s, PW, PH);
        // Slime everywhere; then a wall, which clears the stamps of its cells, and food, light and an electrode.
        sim.paint([
          { kind: 'slime', from: [0, 24], to: [64, 24], radius: 40 },
          { kind: 'wall', from: [10.5, 6], to: [10.5, 30], radius: 2.5 },
          { kind: 'food', from: [24.5, 12.5], to: [24.5, 12.5], radius: 6 },
          { kind: 'light', from: [40.5, 12.5], to: [40.5, 12.5], radius: 6 },
          { kind: 'cathode', from: [54.5, 12.5], to: [54.5, 12.5], radius: 4 },
        ]);
        const field = await sim.readSlime();
        const env = await sim.readEnv();
        const cells = [...field.keys()];
        // Every open cell has slime, also below the food, the light and the electrode. No cell of the wall has.
        expect(cells.every((c) => (field[c] !== NO_STAMP) === (env[c * 4] ?? 0) < 128)).toBe(true);
        expect(cells.filter((c) => (env[c * 4] ?? 0) >= 128).length).toBeGreaterThan(100);
        // A trail in a block of cells, without a step: thin in its left half, thick in its right half.
        const exposure = 0.4 / equilibrium(s);
        const trail = new Float32Array(PW * PH * 4);
        for (let y = 30; y < 44; y++)
          for (let x = 20; x < 48; x++) trail[(y * PW + x) * 4] = (x < 34 ? 0.5 : 40) / exposure;
        sim.writeTrail(trail);
        const [on, plain] = [await close(sim, s), await close(sim, { ...s, showSlime: false })];
        const [bg, ground] = [slimedGround(style, 0), slimedGround(style, 1)];
        /** The pixel on the centre of cell (x, y) with the layer, and what it is without the layer, in linear light. */
        const both = (x: number, y: number) => {
          const [a, b] = [pixel(on, 8 * x, 8 * y), pixel(plain, 8 * x, 8 * y)];
          return { on: a, plain: b, linear: b.map(fromByte) as Rgb };
        };
        // Plain ground far from all of them: the full strength of the layer.
        const bare = both(58, 40);
        expect(off(bare.plain, bytes(bg))).toBeLessThanOrEqual(1);
        expect(off(bare.on, bytes(ground))).toBeLessThanOrEqual(1);
        expect(off(bare.on, bare.plain)).toBeGreaterThanOrEqual(12);
        // The middle of the flake: 5 % of the ground shows through it.
        const food = both(24, 12);
        const through = food.linear.map((v, k) => v + 0.05 * ((ground[k] ?? 0) - (bg[k] ?? 0))) as Rgb;
        expect(off(food.on, bytes(through)), 'food').toBeLessThanOrEqual(2);
        expect(off(food.on, food.plain), 'food').toBeLessThanOrEqual(3);
        expect(off(food.plain, bytes(bg))).toBeGreaterThan(40);
        // The wall: its middle, and its outer cells, whose neighbours have slime.
        for (const x of [8, 10, 12]) expect(off(both(x, 18).on, both(x, 18).plain), 'wall').toBeLessThanOrEqual(2);
        expect(off(both(10, 18).plain, bytes(bg))).toBeGreaterThan(20);
        // The layer goes on up to the wall. The wall holds the cells 8 to 12 of this row, and its outline lies on
        // their outer edges. One pixel outside the outline the blend holds three eighths of the wall's cell, which
        // has no slime: the layer is at its full strength there all the same. The shadow of the wall darkens the
        // ground with the layer as much as the ground without it. In the paper style, where the bytes of the ground
        // without the layer tell its shade.
        if (style === 'paper')
          for (const x of [59, 101]) {
            const [a, b] = [pixel(on, x, 144), pixel(plain, x, 144)];
            const shade = (share: number) =>
              bytes(slimedGround(style, share).map((g, k) => (g * fromByte(b[k] ?? 0)) / (bg[k] ?? 1)) as Rgb);
            expect(off(a, shade(1)), `beside the wall at pixel ${String(x)}`).toBeLessThanOrEqual(2);
            // A blend with the wall's cell in it would draw five eighths of the strength.
            expect(off(a, shade(0.625)), `beside the wall at pixel ${String(x)}`).toBeGreaterThanOrEqual(4);
          }
        // The light adds to the ground below it, with the layer or without it.
        const lit = both(40, 12);
        const added = lit.linear.map((v, k) => v + (ground[k] ?? 0) - (bg[k] ?? 0)) as Rgb;
        expect(off(lit.plain, bytes(bg)), 'light').toBeGreaterThan(10);
        expect(off(lit.on, bytes(added)), 'light').toBeLessThanOrEqual(2);
        // The electrode covers nine tenths of what lies below it.
        const pole = both(54, 12);
        const below = pole.linear.map((v, k) => v + 0.1 * ((ground[k] ?? 0) - (bg[k] ?? 0))) as Rgb;
        expect(off(pole.plain, bytes(bg)), 'electrode').toBeGreaterThan(40);
        expect(off(pole.on, bytes(below)), 'electrode').toBeLessThanOrEqual(2);
        // The trail lies on the ground. Glow adds light to what the ground leaves dark, and the ink of paper takes a
        // share of the ground away, so the thin trail shows the layer through it by the rule of its style.
        const thin = both(26, 37);
        expect(off(thin.plain, bytes(bg)), 'thin trail').toBeGreaterThan(20);
        if (style === 'glow') {
          const lightOf = (k: number) => ((thin.linear[k] ?? 0) - (bg[k] ?? 0)) / (1 - (bg[k] ?? 0));
          const want = ground.map((g, k) => g + (1 - g) * lightOf(k)) as Rgb;
          expect(off(thin.on, bytes(want)), 'thin trail').toBeLessThanOrEqual(2);
        }
        if (style === 'paper') {
          const want = ground.map((g, k) => (g * (thin.linear[k] ?? 0)) / (bg[k] ?? 1)) as Rgb;
          expect(off(thin.on, bytes(want)), 'thin trail').toBeLessThanOrEqual(2);
        }
        // A thick trail hides the ground in every style: the glow is white, the gel is opaque, the ink is black.
        const thick = both(41, 37);
        expect(off(thick.on, thick.plain), 'thick trail').toBeLessThanOrEqual(2);
      },
    );

    // Decision 8 and the three ways without the layer: Show slime off, a life time of 0, and the Jones model. Against
    // the shaders without the code of the layer, with the same state, uniforms and dither: 0 of 255 apart. The field
    // holds slime in every case but the Jones model, which has no field. 3 × 168 captures of 64 × 48 pixels.
    it('draws the pixels of the shaders without the layer while the layer is off, in every style', async () => {
      const jones: Settings = {
        ...defaultSettings(),
        model: 'jones',
        collisions: true,
        density: 0.2,
        seed: 5,
        bloom: 0,
        strains: [defaultStrain(0)],
      };
      // Zoomed in and zoomed out. The first view lies on the painted slime, inside every arena.
      const looks: View[] = [
        { center: [21.37, 19.21], scale: 1 / 8 },
        { center: [32.4, 24.6], scale: 2.5 },
      ];
      const cases: { sim: Sim; settings: Settings; view: View; slime: boolean; name: string }[] = [];
      for (const boundary of BOUNDARIES)
        for (const painted of [false, true]) {
          // The default strains and a density of 0.5: agents that leave a trail, and slime where they are.
          const base = pictured({
            boundary,
            layout: 'mixed',
            density: 0.5,
            diffusion: 1,
            slimeLife: 144,
            strains: [defaultStrain(0), defaultStrain(1)],
          });
          const off: [string, Settings][] = [
            ['the switch', { ...base, showSlime: false }],
            ['a life time of 0', { ...base, slimeLife: 0 }],
            ['the Jones model', { ...jones, boundary }],
          ];
          for (const [name, settings] of off) {
            if (settings.model === 'jones' && !backend.supportsCollisions) continue;
            const sim = await make(settings, PW, PH, (PW * PH) / 2);
            if (painted)
              sim.paint([
                { kind: 'food', from: [20, 12], to: [20, 12], radius: 4 },
                { kind: 'light', from: [44, 30], to: [44, 30], radius: 5 },
                { kind: 'wall', from: [20, 30], to: [30, 34], radius: 1.5 },
              ]);
            sim.paint([{ kind: 'slime', from: [6, 6], to: [50, 40], radius: 9 }]);
            sim.run(20);
            expect(sim.hasEnvironment, name).toBe(painted);
            // The field holds slime under the switch, and none in the Jones model and at a life time of 0, where no
            // step writes a stamp: there it holds the painted slime alone.
            const stamps = stamped(await sim.readSlime());
            expect(stamps.length > 400, name).toBe(settings.model === 'extended');
            const lattices = boundary === 'wrap' && painted ? [null, [PW, PH] as [number, number]] : [null];
            for (const lattice of lattices)
              for (const style of STYLES)
                for (const view of looks)
                  cases.push({
                    sim,
                    settings: { ...settings, lattice, style },
                    view,
                    slime: stamps.length > 0,
                    name: `${name}, ${boundary}, ${style} at ${String(view.scale)}${painted ? ', painted' : ''}`,
                  });
          }
        }
      const captures = async (patch: Partial<Settings> = {}) => {
        const out: ImageData[] = [];
        for (const c of cases) out.push(await backend.capture(c.sim, { ...c.settings, ...patch }, c.view, 64, 48));
        return out;
      };
      const hook = backend as WebGpuBackend | WebGl2Backend;
      onTestFinished(() => {
        hook.renderFrom();
      });
      // A new WebGPU renderer counts frames from 0, so both runs dither alike; WebGL2 captures keep the frame.
      const device = kind === 'webgpu' ? (backend as WebGpuBackend).gpu.device : undefined;
      device?.pushErrorScope('validation');
      hook.renderFrom(kind === 'webgpu' ? WITHOUT_SLIME.wgsl : WITHOUT_SLIME.glsl);
      const before = await captures();
      hook.renderFrom();
      const now = await captures();
      expect((await device?.popErrorScope())?.message).toBeUndefined();
      const apart = now.map((img, i) => maxDiff(img, before[i] ?? img));
      expect(Math.max(...apart), apart.join(' ')).toBe(0);
      // The same frames with the layer on differ where the field holds slime and the model has slime. Not in the gel
      // style: these scenes are full of trail, and the gel over a trail hides its ground.
      hook.renderFrom();
      const shown = await captures({ showSlime: true, slimeLife: 144 });
      const differs = shown.map((img, i) => maxDiff(img, before[i] ?? img));
      const slimed = cases.flatMap((c, i) =>
        c.slime && c.settings.model === 'extended' && c.settings.style !== 'gel'
          ? [[c.name, differs[i] ?? 0] as const]
          : [],
      );
      expect(slimed.length).toBeGreaterThan(cases.length / 3);
      // Both runs dither alike, so every difference is one of the picture. Below a bright trail it is small.
      expect(slimed.filter(([, d]) => d < 2)).toEqual([]);
      const jonesFrames = cases.flatMap((c, i) => (c.settings.model === 'jones' ? [differs[i] ?? 0] : []));
      expect(Math.max(0, ...jonesFrames)).toBe(0);
    }, 240_000);

    // The scent view draws no slime (decision 8): its picture is the one without the layer, with slime in the field.
    it('draws no slime below the scent view', async () => {
      const s = pictured({ slimeLife: 144 });
      const sim = await make(s, PW, PH);
      sim.paint([dab(32, 24, 12), { kind: 'food', from: [50, 24], to: [50, 24], radius: 3 }]);
      sim.run(5);
      const view: View = { center: [32, 24], scale: 0.5 };
      const scent = { ...s, showScent: true };
      const [withSlime, without] = [
        await backend.capture(sim, scent, view, 128, 96),
        await backend.capture(sim, { ...scent, showSlime: false }, view, 128, 96),
      ];
      // Two captures dither apart by 2 at most.
      expect(maxDiff(withSlime, without)).toBeLessThanOrEqual(2);
      // The same frame without the scent view shows the layer.
      const layer = await backend.capture(sim, s, view, 128, 96);
      expect(maxDiff(layer, await backend.capture(sim, { ...s, showSlime: false }, view, 128, 96))).toBeGreaterThan(8);
    });

    // The Jones model frees the field, and a switch back makes a new one at the first stamp: the picture reads the
    // field that the simulation holds now. On WebGPU a bind group with a freed buffer is an error of the device.
    it('reads the field that the simulation holds after a switch of the model and back', async () => {
      if (!backend.supportsCollisions) return; // the Jones model needs one agent per cell
      const extended = pictured({
        slimeLife: 144,
        collisions: true,
        diffusion: 1,
        density: 0.1,
        strains: [defaultStrain(0)],
      });
      const jones: Settings = { ...extended, model: 'jones' };
      const sim = await make(extended, PW, PH, 40);
      const device = kind === 'webgpu' ? (backend as WebGpuBackend).gpu.device : undefined;
      device?.pushErrorScope('validation');
      const view: View = { center: [32, 24], scale: 0.5 };
      const shot = (settings: Settings) => backend.capture(sim, settings, view, 128, 96);
      const ground = bytes(slimedGround(extended.style, 0));
      const slimed = bytes(slimedGround(extended.style, 1));
      sim.paint([dab(32, 24, 10)]);
      expect(off(pixel(await shot(extended), 64, 48), slimed)).toBeLessThanOrEqual(1);
      sim.update(jones);
      expect(off(pixel(await shot(jones), 64, 48), ground)).toBeLessThanOrEqual(1);
      // Back in the extended model: no field until a stroke or a step writes a stamp, and no layer.
      sim.update(extended);
      expect(off(pixel(await shot(extended), 64, 48), ground)).toBeLessThanOrEqual(1);
      sim.paint([dab(32, 24, 10)]);
      expect(off(pixel(await shot(extended), 64, 48), slimed)).toBeLessThanOrEqual(1);
      expect((await device?.popErrorScope())?.message).toBeUndefined();
    });

    // The layer is a part of the picture alone. Two simulations from one seed, one drawn with the layer after every
    // few steps and one never drawn: the same bytes everywhere.
    it('changes no byte of the simulation', async () => {
      const s = pictured({
        layout: 'mixed',
        density: 0.5,
        diffusion: 1,
        slimeLife: 144,
        seed: 11,
        strains: [defaultStrain(0), defaultStrain(1)],
      });
      const [viewed, plain] = [await make(s, PW, PH, 800), await make(s, PW, PH, 800)];
      for (const sim of [viewed, plain])
        sim.paint([dab(20, 20, 6), { kind: 'wall', from: [40, 10], to: [44, 30], radius: 1.5 }]);
      for (let k = 0; k < 6; k++) {
        viewed.run(5);
        plain.run(5);
        backend.draw(viewed, s, { center: [32, 24], scale: 0.5 }, true);
        for (const style of STYLES) await backend.capture(viewed, { ...s, style }, at(views('box'), k), 32, 24);
      }
      const state = async (sim: Sim) => ({
        agents: await sim.readAgents(),
        trail: Array.from(await sim.readTrail()),
        scent: Array.from(await sim.readScent()),
        env: Array.from(await sim.readEnv()),
        slime: Array.from(await sim.readSlime()),
        step: sim.step,
      });
      const [a, b] = [await state(viewed), await state(plain)];
      expect(a.slime.filter((v) => v !== NO_STAMP).length).toBeGreaterThan(400);
      expect(a).toEqual(b);
    }, 120_000);

    // The pipelines (WebGPU) and programs (WebGL2) of the layer are built once, from the first frame that draws the
    // layer and without blocking it, as those of the scent view: a frame of a scene without slime builds none.
    it('builds the pipelines or programs of the layer once, and none for a frame without the layer', async () => {
      const s = pictured({ slimeLife: 144 });
      const sim = await make(s, PW, PH);
      sim.paint([dab(32, 24, 10)]);
      const view: View = { center: [32, 24], scale: 0.5 };
      let builds: { mock: { calls: unknown[] } };
      let ready: () => Promise<unknown>;
      let frame: (settings: Settings) => void;
      if (kind === 'webgpu') {
        const gpu = backend as WebGpuBackend;
        onTestFinished(() => {
          vi.restoreAllMocks();
          gpu.renderFrom();
        });
        gpu.renderFrom(); // a new renderer: nothing of the layer is built yet
        builds = vi.spyOn(gpu.gpu.device, 'createRenderPipelineAsync');
        ready = () => backend.capture(sim, s, view, 8, 8);
        frame = (settings) => {
          backend.draw(sim, settings, view, false);
        };
      } else {
        // Programs of their own, on the backend's context: the backend may have built its own in earlier tests.
        const gl = (backend as unknown as { gl: WebGL2RenderingContext }).gl;
        const programs = compile(gl);
        onTestFinished(() => {
          vi.restoreAllMocks();
        });
        builds = vi.spyOn(gl, 'createProgram');
        ready = async () => {
          while (!programs.slimed()) await new Promise((r) => setTimeout(r, 1));
        };
        // A frame asks for the programs as the backend's frames do (gl/backend.ts encode()).
        frame = (settings) => {
          if (slimeShown(settings)) programs.slimed();
        };
      }
      for (const settings of [
        { ...s, showSlime: false },
        { ...s, slimeLife: 0 },
      ])
        for (let k = 0; k < 3; k++) frame(settings);
      expect(builds.mock.calls.length).toBe(0);
      for (let k = 0; k < 3; k++) frame(s);
      await ready();
      const first = builds.mock.calls.length;
      for (let k = 0; k < 5; k++) {
        frame(s);
        await ready();
      }
      // The layer without and with food, light and walls.
      expect(first).toBe(2);
      expect(builds.mock.calls.length).toBe(first);
    });
  });
});
