// The slime field on both backends (ADR 0055, ADR 0057), in Chromium with real GPU APIs (ADR 0010): the pass of the
// stamps and of the amounts, the brush on the field and the film of the slime in the picture against the CPU
// reference, and the rules in plain cases.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { hexToLinear } from '../model/color';
import { BOUNDARIES, defaultSettings, defaultStrain, STYLES, type Boundary, type Settings } from '../model/params';
import { at } from './at';
import { cellIndex, dishRadius } from './brush';
import { trailLevels } from './flow';
import { openCell, type FlowGrid } from './flow-reference';
import { WebGl2Backend } from './gl/backend';
import { readTarget, type Target } from './gl/gl';
import renderFrag from './gl/glsl/render.frag?raw';
import { compile } from './gl/programs';
import { paintReference } from './paint-reference';
import { readTexture } from './readback';
import { BACKGROUND, LATTICE_COPIES, SLIME_LOOK, trailLevel } from './render';
import { levelSize } from './scent';
import renderWgsl from './shaders/render.wgsl?raw';
import { equilibrium } from './sizing';
import { FILM_HIDE, NO_STAMP, SLIME_FULL, SLIME_RIM, slimeShown, slimeSteps, stampOf, STEPS_PER_HOUR } from './slime';
import {
  amountLeft,
  amountStep,
  filmAt,
  filmCell,
  filmCells,
  paintedAmount,
  plasmLevel,
  slimeColour,
  slimed,
  slimeDown,
  slimeLook,
  slimePaint,
  slimeStep,
  slimeWaves,
  type Rgb,
  type SlimeField,
} from './slime-reference';
import { changesSlime, SHAPE_RANGE, type Backend, type EnvTool, type Sim, type Stroke, type View } from './types';
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

/** The lines of `scene` in render.wgsl that add the sheet of the growth front to the trail (ADR 0059). */
const WGSL_FAN = `  // The sheet of the growth front is more plasm on young ground (ADR 0059). It stays on the side of a wall on which
  // its plasm lies (fanOpen()).
  if (FRONT && (V.slime.z & 2u) != 0u && V.style != 3u) {
    let under = plasmCover(v);
    var fan = fanAt(p, under);
    if (ENV && V.frame.z != 0u && fan.h > 0.0 && under < 1.0) {
      let open = fanOpen(p, fan.up);
      fan.v *= open;
      fan.h *= open;
      fan.g *= open;
    }
    v += fan.v;
    lift = vec3f(fan.h, fan.g);
  }
`;
/** The lines of `scene` in render.wgsl that lay the film of the slime on the ground. */
const WGSL_FILM = `  // The film of the slime lies on the ground, and the plasm lies on the film: where the plasm covers the ground, the
  // picture shows no film. The flake of food, the trail and all else lie on it.
  if (SLIME && (V.slime.z & 1u) != 0u) {
    let hidden = plasmCover(select(v, dots, V.style == 3u));
    if (hidden < 1.0) { base = mix(slimed(base, p), base, hidden); }
  }
`;
/** The same lines of `scene` in render.frag. */
const GLSL_FAN = `#ifdef FRONT
  // The sheet of the growth front is more plasm on young ground (ADR 0059). It stays on the side of a wall on which
  // its plasm lies (fanOpen()).
  if ((V.slime.z & 2u) != 0u && V.style != 3u) {
    float under = plasmCover(v);
    Fan fan = fanAt(p, under);
#if ENV
    if (V.frame.z != 0u && fan.h > 0.0 && under < 1.0) {
      float open = fanOpen(p, fan.up);
      fan.v *= open;
      fan.h *= open;
      fan.g *= open;
    }
#endif
    v += fan.v;
    lift = vec3(fan.h, fan.g);
  }
#endif
`;
const GLSL_FILM = `#ifdef SLIME
  // The film of the slime lies on the ground, and the plasm lies on the film: where the plasm covers the ground, the
  // picture shows no film. The flake of food, the trail and all else lie on it.
  if ((V.slime.z & 1u) != 0u) {
    float hidden = plasmCover(V.style == 3u ? dots : v);
    if (hidden < 1.0) base = mix(slimed(base, p), base, hidden);
  }
#endif
`;

/**
 * The render shaders without the code of the film of the slime (ADR 0055, decision 8; ADR 0057): every line of the
 * film is cut out of the texts of today. A frame that draws no film must have the pixels of these shaders, 0 of 255
 * apart: so the code of the film changes no pixel of such a frame, whatever it adds to the uniform and the bindings.
 *
 * On 2026-11-17 the WGSL text was the file of the commit before the layer (460ea68) byte for byte. The GLSL text was
 * that file but for the place of four definitions: `SUN`, `spline`, `splineSlope` and `lattice` lie before `#if ENV`
 * now, because the film needs them without walls. A program without food, light and walls reads none of them, and a
 * program with them holds the same text in another place: both draw the pixels of that commit. view.glsl differs
 * from that commit only by the three fields of the slime at the end of its block, which no code of that commit reads.
 *
 * Since ADR 0059 the texts also hold no line of the fan of the growth front, and they differ from that commit in three
 * more ways. The gel reads its height as a smooth spline (heightSmooth), which changes its picture. The gel takes the
 * sheet of the growth front, which is none here: thick(max(y, 0) + 0) is thick(y). And `scene` reads the food before
 * the ground, in another order of the same lines.
 */
const WITHOUT_SLIME = {
  wgsl: cutSpan(
    rewrite(renderWgsl, [
      [
        '// The film of the slime (ADR 0055, decision 8; ADR 0057), compiled in only while a frame draws it (render.ts).\noverride SLIME: bool = false;\n',
        '',
      ],
      [
        '  // The slime: the steps that ran so far, the life time of the slime in steps, what the frame draws (1 the film of\n' +
          '  // the slime, 2 the fan of the growth front), unused.\n' +
          '  slime: vec4u,\n' +
          '  slimeFx: vec4f,     // the slime: the colour of its body, linear RGB, and how much of it full slime shows\n' +
          '  slimeLight: vec4f,  // the slime: its highlight, its wide light, the height of its relief, the height of its beads\n',
        '',
      ],
      [
        '@group(0) @binding(14) var<storage, read> stamps: array<u32>; // the stamps of the slime field (slime.wgsl); read by `slimeFilm` only\n' +
          '@group(0) @binding(18) var<storage, read> amounts: array<u32>; // the amounts of slime (amount.wgsl); read by `slimeFilm` only\n' +
          '@group(0) @binding(15) var film: texture_2d<f32>; // the film of the slime, one texel per cell (written by `slimeFilm`)\n' +
          '@group(0) @binding(17) var filmLevels: texture_2d<f32>; // the film on a coarser map (slimeDown), zoomed out\n' +
          '@group(0) @binding(19) var<storage, read> fronts: array<u32>; // the front field (slime.wgsl); read by `frontMap` only\n' +
          '@group(0) @binding(20) var fanMap: texture_2d<f32>; // the map of the growth front (written by `frontMap`)\n',
        '',
      ],
      [
        '// What lies below the trail: the ground `bg`, or the flake on it. The trail and the agents lie on top.\nfn substrate(f: Flake, bg: vec3f) -> vec3f {\n',
        '// What lies below the trail: the background, or the flake on it. The trail and the agents lie on top.\nfn substrate(f: Flake) -> vec3f {\n  let bg = V.background.rgb;\n',
      ],
      [
        '// The fan of the growth front (ADR 0059), compiled in only while a frame draws it, together with SLIME (render.ts).\noverride FRONT: bool = false;\n',
        '',
      ],
      [WGSL_FAN, ''],
      [WGSL_FILM, ''],
      ['  if (ENV && near) { base = substrate(f, base); }\n', '  if (ENV && near) { base = substrate(f); }\n'],
    ]),
    '// ---- The slime (SLIME) ---',
    '// The arena at grid position p:',
  ),
  glsl: cutSpan(
    rewrite(renderFrag, [
      ['vec3 substrate(Flake f, vec3 bg) {\n', 'vec3 substrate(Flake f) {\n  vec3 bg = V.background.rgb;\n'],
      [GLSL_FAN, ''],
      [GLSL_FILM, ''],
      ['  if (near) base = substrate(f, base);\n', '  if (near) base = substrate(f);\n'],
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
const mix = (a: Rgb, b: Rgb, t: number) => a.map((v, k) => v + ((b[k] ?? 0) - v) * t) as Rgb;
const bytes = (c: Rgb) => c.map(toByte);
/** The ground of a style without slime, linear RGB. */
const groundOf = (style: Settings['style']): Rgb => hexToLinear(BACKGROUND[style]);
/**
 * The picture of a simulation without trail, food, light and walls on the CPU, as render.wgsl `fs` draws it, 3 bytes
 * per pixel: inside the arena the ground with the film of the slime on it (slimeColour() in slime-reference.ts), or
 * the bare ground without a map, and outside it the free space, with a ramp one pixel wide between them. Around a
 * periodic lattice the copies of the grid show dimmed (ADR 0026). `grid`: the grid of the simulation; `map`: the map
 * of its film of the level that the view reads.
 */
function groundPicture(
  grid: FlowGrid,
  map: Float32Array | undefined,
  settings: Settings,
  view: View,
  [cw, ch]: readonly [number, number],
): Uint8Array {
  const { width: w, height: h } = grid;
  const out = new Uint8Array(cw * ch * 3);
  const bg = groundOf(settings.style);
  const space = bg.map((v) => v * (settings.style === 'paper' ? 0.92 : 0.55)) as Rgb;
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
        const inner = map ? slimeColour(settings.style, grid, map, p, view.scale) : bg;
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

  // ADR 0057: the amount of slime of each cell, for the picture alone. A cell under plasm gains 1 of SLIME_FULL per
  // step up to the level of its plasm, a cell without plasm keeps its amount, and the brush paints a stroke with a rim.
  describe('the amount of slime (ADR 0057)', () => {
    /** The largest difference between two fields of amounts, and the cells where they differ. */
    const apart = (a: Uint32Array, b: Uint32Array) => {
      let [worst, cells] = [0, 0];
      a.forEach((v, c) => {
        const d = Math.abs(v - (b[c] ?? 0));
        worst = Math.max(worst, d);
        if (d > 0) cells++;
      });
      return { worst, cells };
    };

    it('starts without slime, one amount per cell', async () => {
      const sim = await make(slimy());
      const amounts = await sim.readSlimeAmount();
      expect(amounts.length).toBe(W * H);
      expect(amounts.some((v) => v !== 0)).toBe(false);
    });

    it('gains one of 4,095 per step under plasm, up to the level of the plasm, and keeps what it has without plasm', async () => {
      const s = slimy({ boundary: 'box' });
      const sim = await make(s);
      const grid = await gridOf(sim, s);
      const [lowA, lowB] = strains.map((strain) => f32(trailLevels(strain, s.stepOrder)[0])) as [number, number];
      // The trail of a strain at the share `level` of the way from its low level to its full level, which is 5 low
      // levels: the share that the level of the plasm takes.
      const share = (low: number, level: number) => low * (1 + 4 * level);
      const cells = {
        // Far above the full level: the level of the plasm is full.
        full: cell(3, 3),
        // The second strain alone, at its full level and more.
        fullB: cell(5, 3),
        // A level of about 3 and of about 40 of 4,095: the amount ends there.
        three: cell(7, 3),
        forty: cell(9, 3),
        // At the low level: plasm, at the level 0.
        low: cell(11, 3),
        // Just below the low level: no plasm.
        none: cell(13, 3),
        // Both strains: the level of the one with the most.
        both: cell(15, 3),
      };
      sim.writeTrail(
        trailOf([
          [cells.full, 0, 9000],
          [cells.fullB, 1, 9000],
          [cells.three, 0, share(lowA, 3.4 / SLIME_FULL)],
          [cells.forty, 0, share(lowA, 40.4 / SLIME_FULL)],
          [cells.low, 0, lowA * 1.00015],
          [cells.none, 0, lowA * 0.99],
          [cells.both, 0, share(lowA, 0.5)],
          [cells.both, 1, share(lowB, 0.001)],
        ]),
      );
      let stamps: Uint32Array = new Uint32Array(W * H);
      let amounts: Uint32Array = new Uint32Array(W * H);
      const of = (field: Uint32Array, name: keyof typeof cells) => field[cells[name]];
      for (let step = 0; step < 60; step++) {
        sim.run(1);
        const trail = await sim.readTrail();
        amounts = amountStep(grid, s, step, stamps, amounts, trail);
        stamps = slimeStep(grid, s, step, stamps, trail);
        if (![0, 1, 2, 3, 4, 39, 40, 41, 59].includes(step)) continue;
        const got = await sim.readSlimeAmount();
        // The level of a cell rounds to a whole number: a backend may round the last bit of a float the other way.
        expect(apart(got, amounts).worst, `step ${String(step)}`).toBeLessThanOrEqual(1);
        // A full cell gains 1 per step, exactly.
        expect([of(got, 'full'), of(got, 'fullB')], `step ${String(step)}`).toEqual([step + 1, step + 1]);
        expect(of(got, 'none')).toBe(0);
      }
      const got = await sim.readSlimeAmount();
      expect(plasmLevel(s, await sim.readTrail(), cells.full)).toBe(SLIME_FULL);
      // The amount of a thin tube ends at the level of its plasm, and it never falls. The trail of these cells decays
      // by 0.0001 in every step, so their level falls by 0.1 of 4,095 per step: the amount of the second cell ends
      // where it met the level, at about the step 36.
      expect(of(got, 'three')).toBeGreaterThanOrEqual(2);
      expect(of(got, 'three')).toBeLessThanOrEqual(3);
      expect(of(got, 'forty')).toBeGreaterThanOrEqual(35);
      expect(of(got, 'forty')).toBeLessThanOrEqual(37);
      expect(plasmLevel(s, await sim.readTrail(), cells.forty)).toBeLessThan(of(got, 'forty') ?? 0);
      // Plasm at the low level has a stamp, and no amount. This cell held plasm in the first step only: its trail
      // fell below the low level then.
      expect(of(await sim.readSlime(), 'low')).toBe(stampOf(0));
      expect(of(got, 'low')).toBe(0);
      // Two strains: the level of the first, far above that of the second.
      expect(of(got, 'both')).toBe(60);
      // Only the cells with plasm above the low level hold an amount.
      expect([...got].filter((v) => v > 0).length).toBe(5);

      // Without plasm no amount changes, and none falls: the picture lets it fade by the age of the stamp.
      sim.writeTrail(trailOf([]));
      sim.run(5);
      expect(await sim.readSlimeAmount()).toEqual(got);
    });

    it('starts from nothing on ground without slime, and from what the picture showed where plasm comes back', async () => {
      // A life time of 12 steps.
      const s = slimy({ boundary: 'box', slimeLife: 12 / STEPS_PER_HOUR });
      expect(slimeSteps(s)).toBe(12);
      const sim = await make(s);
      const grid = await gridOf(sim, s);
      const [back, late, stay, gone] = [cell(4, 4), cell(8, 4), cell(12, 4), cell(16, 4)];
      const plasm = (on: readonly number[]) => trailOf(on.map((c) => [c, 0, 9000] as const));
      let stamps: Uint32Array = new Uint32Array(W * H);
      let amounts: Uint32Array = new Uint32Array(W * H);
      const run = async (steps: number) => {
        for (let k = 0; k < steps; k++) {
          const step = sim.step;
          sim.run(1);
          const trail = await sim.readTrail();
          amounts = amountStep(grid, s, step, stamps, amounts, trail);
          stamps = slimeStep(grid, s, step, stamps, trail);
        }
      };
      // Six steps of plasm: an amount of 6 on each cell.
      sim.writeTrail(plasm([back, late, stay, gone]));
      await run(6);
      expect([back, late, stay, gone].map((c) => amounts[c])).toEqual([6, 6, 6, 6]);
      expect(await sim.readSlimeAmount()).toEqual(amounts);
      // The plasm stays on one cell and leaves the others for four steps.
      sim.writeTrail(plasm([stay]));
      await run(4);
      expect(await sim.readSlimeAmount()).toEqual(amounts);
      expect([back, late, stay].map((c) => amounts[c])).toEqual([6, 6, 10]);
      // It comes back to one cell in the step 10: the slime there has the age 5, so 7 twelfths of its amount are
      // left, 3 of 6 rounded down, and the cell gains 1.
      expect(amountLeft(6, stampOf(5), 10, 12)).toBe(3);
      sim.writeTrail(plasm([back, stay]));
      await run(1);
      expect([back, late, stay].map((c) => amounts[c])).toEqual([4, 6, 11]);
      expect(await sim.readSlimeAmount()).toEqual(amounts);
      // Plasm that stays has the age 1 in every step, and loses nothing.
      await run(3);
      expect([back, stay].map((c) => amounts[c])).toEqual([7, 14]);
      // The slime of the last cell is 12 steps old at the step 17: its life time is over. Plasm starts from nothing.
      expect(sim.step).toBe(14);
      await run(3);
      expect(amounts[late]).toBe(6);
      expect(amountLeft(6, stampOf(5), 17, 12)).toBe(0);
      sim.writeTrail(plasm([back, late, stay]));
      await run(1);
      expect([back, late, stay].map((c) => amounts[c])).toEqual([11, 1, 18]);
      expect(await sim.readSlimeAmount()).toEqual(amounts);
      // The fourth cell has been without plasm since the step 5. Plasm comes to it in the step 20: its slime is 15
      // steps old, 3 more than the life time, and the cell starts from nothing too.
      await run(2);
      expect(sim.step).toBe(20);
      expect(amounts[gone]).toBe(6);
      sim.writeTrail(plasm([back, late, stay, gone]));
      await run(1);
      expect(amounts[gone]).toBe(1);
      expect(await sim.readSlimeAmount()).toEqual(amounts);
    });

    it.each([
      ['one diffusion pass, sensing first, in a dish', [48, 40], { diffusion: 1, stepOrder: 'sense-first' }],
      ['two diffusion passes, moving first, on a periodic grid', [50, 37], { diffusion: 2, boundary: 'wrap' }],
    ] as const)('follows the CPU reference step by step under living agents, with %s', async (_what, [w, h], patch) => {
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
      const grid = await gridOf(sim, s);
      let stamps: Uint32Array = new Uint32Array(w * h);
      let amounts: Uint32Array = new Uint32Array(w * h);
      let held = 0;
      for (let step = 0; step < 12; step++) {
        sim.run(1);
        const trail = await sim.readTrail();
        amounts = amountStep(grid, s, step, stamps, amounts, trail);
        stamps = slimeStep(grid, s, step, stamps, trail);
        const got = await sim.readSlimeAmount();
        const { worst, cells } = apart(got, amounts);
        expect(worst, `step ${String(step)}`).toBeLessThanOrEqual(1);
        // Almost every cell holds the amount of the reference to the last unit.
        expect(cells, `step ${String(step)}`).toBeLessThanOrEqual(3);
        held = [...got].filter((v) => v > 0).length;
        // No amount without a stamp, and none in a wall or outside the arena.
        const field = await sim.readSlime();
        expect([...got.keys()].filter((c) => (got[c] ?? 0) > 0 && field[c] === NO_STAMP)).toEqual([]);
      }
      expect(held).toBeGreaterThan(20);
      expect(Math.max(...amounts)).toBeGreaterThan(6);
    });

    it('paints a stroke of the Slime tool with a rim of 4 cells, and keeps what is left of thicker slime', async () => {
      const s = slimy({ boundary: 'box', slimeLife: 12 / STEPS_PER_HOUR });
      const sim = await make(s, 64, 48);
      const grid = await gridOf(sim, s);
      const at = (x: number, y: number) => y * 64 + x;
      // A dab of 10 cells around the centre of a cell: full in its middle, and a rim of SLIME_RIM cells.
      const dab: Stroke = { kind: 'slime', from: [20.5, 20.5], to: [20.5, 20.5], radius: 10 };
      sim.paint([dab]);
      const [stamps, amounts] = [new Uint32Array(64 * 48), new Uint32Array(64 * 48)];
      slimePaint(grid, s, 0, stamps, dab, undefined, { amounts, life: 12 });
      let got = await sim.readSlimeAmount();
      expect(apart(got, amounts).worst).toBeLessThanOrEqual(1);
      expect(await sim.readSlime()).toEqual(stamps);
      expect(SLIME_RIM).toBe(4);
      // Along the row of the centre: full up to 6.5 cells from it, then the rim, and nothing outside the stroke.
      expect([20, 23, 26].map((x) => got[at(x, 20)])).toEqual([SLIME_FULL, SLIME_FULL, SLIME_FULL]);
      expect(paintedAmount(6.5, 10)).toBe(SLIME_FULL);
      for (const x of [27, 28, 29, 30]) {
        const want = paintedAmount(x - 20, 10);
        expect(Math.abs((got[at(x, 20)] ?? 0) - want), `column ${String(x)}`).toBeLessThanOrEqual(1);
        expect(want).toBeGreaterThan(0);
        expect(want).toBeLessThan(SLIME_FULL);
      }
      // The last cell of the stroke holds little, and the cell beside it nothing.
      expect(paintedAmount(10, 10)).toBe(Math.floor(0.125 ** 3 * (0.125 * (0.125 * 6 - 15) + 10) * SLIME_FULL + 0.5));
      expect(got[at(30, 20)]).toBeLessThan(0.02 * SLIME_FULL);
      expect([got[at(31, 20)], (await sim.readSlime())[at(31, 20)]]).toEqual([0, NO_STAMP]);
      // The amount falls from the middle to the edge without a rise.
      const row = Array.from({ length: 11 }, (_, k) => got[at(20 + k, 20)] ?? 0);
      expect(row.every((v, k) => k === 0 || v <= (row[k - 1] ?? 0))).toBe(true);

      // A thin line through the dab, six steps later: the dab has the age 6, so half of its amount is left. The line
      // keeps that where it is more than its own amount, and brings its own elsewhere.
      sim.run(6);
      const line: Stroke = { kind: 'slime', from: [4.5, 20.5], to: [40.5, 20.5], radius: 1 };
      sim.paint([line]);
      slimePaint(grid, s, 6, stamps, line, undefined, { amounts, life: 12 });
      got = await sim.readSlimeAmount();
      expect(apart(got, amounts).worst).toBeLessThanOrEqual(1);
      expect(await sim.readSlime()).toEqual(stamps);
      const thin = paintedAmount(0, 1);
      expect(thin).toBeLessThan(0.3 * SLIME_FULL);
      expect(got[at(6, 20)]).toBe(thin);
      expect(got[at(20, 20)]).toBe(Math.floor(SLIME_FULL / 2));
      expect(amountLeft(SLIME_FULL, stampOf(0), 6, 12)).toBe(Math.floor(SLIME_FULL / 2));
      // Beside the line the dab keeps its full amount and its old stamp.
      expect([got[at(20, 24)], (await sim.readSlime())[at(20, 24)]]).toEqual([SLIME_FULL, stampOf(0)]);

      // Two strokes in one call, with no step between them: a dab, and a thin line through it. The line keeps the
      // amount of the dab where it is more than its own: the brush reads what the stroke before it painted.
      const pair: Stroke[] = [
        { kind: 'slime', from: [48.5, 36.5], to: [48.5, 36.5], radius: 8 },
        { kind: 'slime', from: [40.5, 36.5], to: [56.5, 36.5], radius: 1 },
      ];
      sim.paint(pair);
      for (const stroke of pair) slimePaint(grid, s, 6, stamps, stroke, undefined, { amounts, life: 12 });
      got = await sim.readSlimeAmount();
      expect(apart(got, amounts).worst).toBeLessThanOrEqual(1);
      expect([got[at(48, 36)], got[at(44, 36)]]).toEqual([SLIME_FULL, SLIME_FULL]);
      expect(got[at(48, 36)]).toBeGreaterThan(3 * thin);

      // An erase and a wall clear the amount of their cells, and Clear and a reset clear every amount.
      sim.paint([
        { kind: 'erase', from: [20.5, 14.5], to: [20.5, 14.5], radius: 2 },
        { kind: 'wall', from: [14.5, 20.5], to: [14.5, 20.5], radius: 2 },
      ]);
      got = await sim.readSlimeAmount();
      expect([got[at(20, 14)], got[at(14, 20)], got[at(20, 24)]]).toEqual([0, 0, SLIME_FULL]);
      sim.clearEnvironment();
      expect((await sim.readSlimeAmount()).some((v) => v !== 0)).toBe(false);
      sim.paint([dab]);
      expect((await sim.readSlimeAmount())[at(20, 20)]).toBe(SLIME_FULL);
      sim.reset();
      expect((await sim.readSlimeAmount()).some((v) => v !== 0)).toBe(false);
    });

    it('holds no amount in the Jones model, and keeps the amounts while the life time is 0', async () => {
      const s = slimy({ boundary: 'box' });
      const sim = await make(s);
      sim.writeTrail(trailOf([[cell(4, 4), 0, 9000]]));
      sim.run(3);
      expect((await sim.readSlimeAmount())[cell(4, 4)]).toBe(3);
      // Without slime the pass does not run, and the field keeps what it holds.
      sim.update({ ...s, slimeLife: 0 });
      sim.run(3);
      expect((await sim.readSlimeAmount())[cell(4, 4)]).toBe(3);
      // The Jones model has no slime field.
      sim.update({ ...s, model: 'jones' });
      expect((await sim.readSlimeAmount()).some((v) => v !== 0)).toBe(false);
      sim.update(s);
      expect((await sim.readSlimeAmount()).some((v) => v !== 0)).toBe(false);
    });
  });

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

  // ADR 0055, decision 8, and ADR 0057: the picture draws the slime as a wet film on the ground (`slimed` in
  // render.wgsl and render.frag). A pass writes the film of every cell into a map, a second pass the coarse map of a
  // view that is zoomed out, and the render pass reads the map of its level around a pixel and lights the film. The
  // film is as thick as the amount of slime times the strength of its age, and it is gone at the life time. The food,
  // the trail, the light, the walls and the electrodes lie on it. Without the film every pixel is the one of the
  // code before.
  //
  // A frame is compared in two parts, so that each part has a tolerance with a reason.
  //  - The maps that the backend holds after the frame against the maps of the reference: one step of a 16-bit float
  //    apart at most. A GPU rounds a 32-bit float to a 16-bit float as it likes (the reference takes the nearest; the
  //    GPU of an Apple M-series rounds toward 0), and its 32-bit arithmetic may be one unit in the last place off.
  //  - Every pixel against the picture of the reference on the map that the backend holds: 2 of 255 apart at most,
  //    1 for the dither and 1 for the rounding to a byte.
  describe('the picture', () => {
    beforeEach(() => {
      // No levels of an earlier test: a frame without them draws the trail with the same gain on every run. And no
      // map of the film of an earlier simulation.
      backend.forget();
    });
    const [PW, PH] = [64, 48];
    /** The life time of the slime in these tests, in steps: a part of an hour, past sanitize(). */
    const LIFE = 12;
    const pictured = (patch: Partial<Settings> = {}): Settings =>
      slimy({ boundary: 'box', bloom: 0, slimeLife: LIFE / STEPS_PER_HOUR, ...patch });
    const dab = (x: number, y: number, radius: number): Stroke => ({ kind: 'slime', from: [x, y], to: [x, y], radius });
    /** Slime of the full amount in every open cell: one stroke that is wider than the grid. */
    const everywhere = (sim: Sim): Stroke => ({
      kind: 'slime',
      from: [0, sim.height / 2],
      to: [sim.width, sim.height / 2],
      radius: sim.width + sim.height,
    });
    /** 8 pixels per cell on a canvas of 512 × 384 pixels: the pixel (8 c, 8 r) has its centre on that of cell (c, r). */
    const CLOSE: View = { center: [32.4375, 24.4375], scale: 1 / 8 };
    const BIG = [512, 384] as const;
    const SIZE = [96, 72] as const;
    /** The grid position of the middle of the pixel (x, y) of a canvas of `size` under `view`. */
    const pointOf = (view: View, [cw, ch]: readonly [number, number], x: number, y: number) =>
      [(x + 0.5 - cw / 2) * view.scale + view.center[0], (y + 0.5 - ch / 2) * view.scale + view.center[1]] as const;
    /** The largest difference of a channel between two colours in bytes. */
    const off = (a: number[], b: number[]) => Math.max(...a.map((v, k) => Math.abs(v - (b[k] ?? 0))));

    /** The slime field of a simulation as the picture reads it under `settings`. */
    const fieldOf = async (sim: Sim, settings: Settings): Promise<SlimeField> => ({
      stamps: await sim.readSlime(),
      amounts: await sim.readSlimeAmount(),
      step: sim.step,
      life: slimeSteps(settings),
    });

    /** The step between two 16-bit floats at `v`: 1 / 2048 from 0.5 to 1. */
    const stepAt = (v: number) => 2 ** (Math.max(Math.floor(Math.log2(v)), -14) - 10);
    /** How far two maps lie apart at their worst texel, in steps of a 16-bit float at the larger of the two values. */
    function stepsApart(a: Float32Array, b: Float32Array) {
      let top = a.length === b.length ? 0 : Infinity;
      for (const [i, v] of a.entries()) {
        const w = b[i] ?? 0;
        if (v !== w) top = Math.max(top, Math.abs(v - w) / stepAt(Math.max(v, w)));
      }
      return top;
    }

    // A pass that copies a texture into one that can be read back: the maps of the film on WebGPU cannot.
    const COPY = `
@group(0) @binding(0) var source: texture_2d<f32>;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}
@fragment fn fs(@builtin(position) frag: vec4f) -> @location(0) vec4f {
  return textureLoad(source, vec2i(floor(frag.xy)), 0);
}`;
    let copier: GPURenderPipeline | undefined;

    /**
     * A map of the film as the backend holds it after its last frame with the film, one value per texel, rows from
     * y = 0: the map of the cells (level 0), or the coarse map of `level`, which the last frame of that level filled.
     * The maps are private to the renderer of each backend (render.ts `film` and `filmCoarse`, gl/backend.ts the
     * same): this reads them where they lie.
     */
    async function heldMap(sim: Sim, level: number): Promise<Float32Array> {
      const [nx, ny] = [levelSize(sim.width, level), levelSize(sim.height, level)];
      const name = level === 0 ? 'film' : 'filmCoarse';
      let texels: Float32Array;
      let width: number;
      if (kind === 'webgpu') {
        const device = (backend as WebGpuBackend).gpu.device;
        const held = (backend as unknown as { renderer: Record<string, { texture: GPUTexture } | undefined> }).renderer;
        const source = held[name]?.texture;
        if (!source) throw new Error(`The renderer holds no ${name}`);
        if (!copier) {
          const module = device.createShaderModule({ code: COPY });
          copier = device.createRenderPipeline({
            layout: 'auto',
            vertex: { module, entryPoint: 'vs' },
            fragment: { module, entryPoint: 'fs', targets: [{ format: 'r32float' }] },
          });
        }
        const copy = device.createTexture({
          size: [source.width, source.height],
          format: 'r32float',
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
        });
        const enc = device.createCommandEncoder();
        const pass = enc.beginRenderPass({
          colorAttachments: [{ view: copy.createView(), loadOp: 'clear', storeOp: 'store' }],
        });
        pass.setPipeline(copier);
        pass.setBindGroup(
          0,
          device.createBindGroup({
            layout: copier.getBindGroupLayout(0),
            entries: [{ binding: 0, resource: source.createView() }],
          }),
        );
        pass.draw(3);
        pass.end();
        device.queue.submit([enc.finish()]);
        texels = await readTexture(device, copy, 1);
        width = copy.width;
        copy.destroy();
      } else {
        const held = backend as unknown as Record<string, Target | undefined> & { gl: WebGL2RenderingContext };
        const source = held[name];
        if (!source) throw new Error(`The backend holds no ${name}`);
        // 4 values per texel, the film in the first.
        texels = (readTarget(held.gl, source) as Float32Array).filter((_, i) => i % 4 === 0);
        width = source.width;
      }
      // A coarse map has the size of the level 1, and a frame of a higher level fills its first texels.
      const out = new Float32Array(nx * ny);
      for (let y = 0; y < ny; y++) out.set(texels.subarray(y * width, y * width + nx), y * nx);
      return out;
    }

    /** A capture with the maps of the film that the backend holds after it. */
    interface Held {
      img: ImageData;
      /** The map of the cells. */
      cells: Float32Array;
      /** The map of the level that the view reads: the map of the cells up to 2 cells per pixel. */
      map: Float32Array;
      level: number;
    }
    async function frame(sim: Sim, settings: Settings, view: View, size: readonly [number, number] = SIZE) {
      const img = await backend.capture(sim, settings, view, size[0], size[1]);
      const level = trailLevel(view.scale);
      const cells = await heldMap(sim, 0);
      return { img, cells, map: level === 0 ? cells : await heldMap(sim, level), level } satisfies Held;
    }

    /**
     * How far the maps of a frame lie from the maps of the reference, in steps of a 16-bit float: the map of the
     * cells from filmCells() of the slime field of the simulation, and a coarse map from slimeDown() of the held map
     * of the cells. `walls`: as for filmCells().
     */
    async function mapsApart(sim: Sim, settings: Settings, held: Held, walls = true) {
      const want = filmCells(await gridOf(sim, settings), await fieldOf(sim, settings), walls);
      const coarse = held.level === 0 ? held.cells : slimeDown(held.cells, sim.width, sim.height, held.level);
      return Math.max(stepsApart(held.cells, want), stepsApart(held.map, coarse));
    }

    /**
     * A frame of a simulation without trail, food, light and walls against the CPU reference: its maps (mapsApart()),
     * and every pixel against groundPicture() on the held map. `apart`: the largest difference of a channel; `steps`:
     * the steps between the maps; `changed`: the pixels that the film changes by more than the dither.
     */
    async function follows(
      sim: Sim,
      settings: Settings,
      view: View,
      size: readonly [number, number] = SIZE,
      walls = true,
    ) {
      const held = await frame(sim, settings, view, size);
      const grid = await gridOf(sim, settings);
      const want = groundPicture(grid, held.map, settings, view, size);
      const plain = groundPicture(grid, undefined, settings, view, size);
      let changed = 0;
      for (let i = 0; i < want.length; i += 3)
        if ([0, 1, 2].some((k) => Math.abs((want[i + k] ?? 0) - (plain[i + k] ?? 0)) > 2)) changed++;
      const steps = await mapsApart(sim, settings, held, walls);
      return { ...held, grid, plain, apart: worst(held.img, want), steps, changed };
    }

    it('has a life time of 12 steps here, and no living agent leaves a trail', async () => {
      const s = pictured();
      expect(slimeSteps(s)).toBe(LIFE);
      const sim = await make(s, PW, PH);
      sim.run(3);
      expect((await sim.readTrail()).some((v) => v !== 0)).toBe(false);
      expect(stamped(await sim.readSlime())).toEqual([]);
      expect((await sim.readSlimeAmount()).some((v) => v !== 0)).toBe(false);
    });

    // Four dabs with a radius of 9 cells, painted 9, 6, 3 and 0 steps before the picture. The cells in the middle of
    // a dab hold the full amount, so the film there is as thick as the strength of the age: 0.25, 0.5, 0.75 and 1.
    it.each(STYLES)(
      'draws a film as thick as the amount of slime times the strength of its age (%s)',
      async (style) => {
        const s = pictured({ style });
        const sim = await make(s, PW, PH);
        const spots = [
          [12, 12],
          [36, 12],
          [12, 35],
          [36, 35],
        ] as const;
        const shares = [0.25, 0.5, 0.75, 1];
        const bare = [56, 24] as const;
        for (const [i, [x, y]] of spots.entries()) {
          sim.paint([dab(x + 0.5, y + 0.5, 9)]);
          if (i < 3) sim.run(3);
        }
        expect(sim.step).toBe(9);
        const field = await fieldOf(sim, s);
        const cellOf = ([x, y]: readonly [number, number]) => y * PW + x;
        expect([...spots, bare].map((c) => field.stamps[cellOf(c)])).toEqual([1, 4, 7, 10, NO_STAMP]);
        expect([...spots, bare].map((c) => field.amounts[cellOf(c)])).toEqual([...shares.map(() => SLIME_FULL), 0]);
        expect(spots.map((c) => filmCell(field.stamps[cellOf(c)] ?? 0, SLIME_FULL, sim.step, LIFE))).toEqual(shares);
        // Thin slime: a cell 8 cells from the middle of a dab is in its rim, and holds 1,127 of 4,095.
        expect(field.amounts[cellOf([44, 35])]).toBe(1127);

        const seen = await follows(sim, s, CLOSE, BIG);
        expect(seen.steps).toBeLessThanOrEqual(1);
        expect(seen.apart).toBeLessThanOrEqual(2);
        expect(seen.changed).toBeGreaterThan(20_000);
        const at = (c: readonly [number, number]) => pixel(seen.img, 8 * c[0], 8 * c[1]);
        const [bg, look] = [groundOf(style), slimeLook(style)];
        // Without slime: the bare ground. The dither moves a channel by 1 at most.
        expect(off(at(bare), bytes(bg))).toBeLessThanOrEqual(1);
        for (const [i, c] of spots.entries()) {
          const share = shares[i] ?? 0;
          const p = [c[0] + 0.5, c[1] + 0.5] as const;
          // The middle of a dab is flat: the film is as thick as the share, to a step of a 16-bit float, with no slope.
          const film = filmAt(seen.cells, seen.grid, 0, p);
          expect(Math.abs(film.h - share), `the film of the share ${String(share)}`).toBeLessThanOrEqual(1 / 2048);
          expect(Math.hypot(...film.g)).toBeLessThanOrEqual(1 / 1024);
          // So the pixel on it shows the ground with a flat film of that thickness: its body, and its waves.
          const flat = slimed(bg, look, { h: share, g: [0, 0] }, p, [PW, PH], CLOSE.scale);
          expect(off(at(c), bytes(flat)), `${style}: the share ${String(share)}`).toBeLessThanOrEqual(2);
        }
        // The film in the rim of a dab is thinner than in its middle.
        const rim = filmAt(seen.cells, seen.grid, 0, [44.5, 35.5]).h;
        expect(rim).toBeGreaterThan(0.15);
        expect(rim).toBeLessThan(0.45);
        // New slime is clear on plain ground, slime at half its life time is still there, and the two differ.
        const [half, fresh] = [at(spots[1]), at(spots[3])];
        expect(off(fresh, bytes(bg)), `${style}: new slime`).toBeGreaterThanOrEqual(12);
        expect(off(half, bytes(bg)), `${style}: slime at half its life time`).toBeGreaterThanOrEqual(3);
        expect(off(fresh, half)).toBeGreaterThanOrEqual(4);

        // Zoomed out to 1.6 cells per pixel the slope of the waves and the beads are gone, and a flat film shows its
        // body alone: the share `body` of the colour of the style, times the thickness with its waves to the power
        // 1.6. The waves change the thickness by 16 % at most, and the thickness counts up to 1.
        const far: View = { center: [32, 24], scale: 1.6 };
        const small = [40, 30] as const;
        const out = await follows(sim, s, far, small);
        expect(out.steps).toBeLessThanOrEqual(1);
        expect(out.apart).toBeLessThanOrEqual(2);
        const body = (depth: number): Rgb =>
          style === 'paper'
            ? mix(bg, [...look.color], look.body * depth)
            : (bg.map((v, k) => v + (look.color[k] ?? 0) * look.body * depth) as Rgb);
        let [flatPixels, whole] = [0, 0];
        for (const [i, c] of spots.entries())
          for (let y = 0; y < small[1]; y++)
            for (let x = 0; x < small[0]; x++) {
              const p = pointOf(far, small, x, y);
              // The film is flat where the 5 × 5 cells around a point hold the full amount.
              if (Math.hypot(p[0] - c[0] - 0.5, p[1] - c[1] - 0.5) > 1.9) continue;
              flatPixels++;
              const share = shares[i] ?? 0;
              const [thin, thick] = [body((0.84 * share) ** 1.6), body(Math.min(1.16 * share, 1) ** 1.6)];
              pixel(out.img, x, y).forEach((v, k) => {
                const [a, b] = [toByte(thin[k] ?? 0), toByte(thick[k] ?? 0)];
                expect(v, `${style}: the share ${String(share)}`).toBeGreaterThanOrEqual(Math.min(a, b) - 1);
                expect(v, `${style}: the share ${String(share)}`).toBeLessThanOrEqual(Math.max(a, b) + 1);
              });
              // Where the waves do not thin a film of the full thickness, it shows the whole body of the style.
              if (share < 1 || slimeWaves(PW, PH, p)[0] < 0.5) continue;
              whole++;
              expect(off(pixel(out.img, x, y), bytes(body(1))), `${style}: the whole body`).toBeLessThanOrEqual(2);
            }
        expect(flatPixels).toBeGreaterThanOrEqual(12);
        expect(whole).toBeGreaterThanOrEqual(1);
      },
    );

    it('shows no film at the life time and after it, and all slime follows a new life time at once', async () => {
      const s = pictured({ slimeLife: 4 / STEPS_PER_HOUR });
      expect(slimeSteps(s)).toBe(4);
      const sim = await make(s, PW, PH);
      sim.paint([dab(10.5, 10.5, 9)]);
      const middle = [10.5, 10.5] as const;
      const bg = bytes(groundOf(s.style));
      // The last step with slime: the age life − 1, and a film of a quarter of the full thickness.
      sim.run(3);
      let seen = await follows(sim, s, CLOSE, BIG);
      expect([seen.steps <= 1, seen.apart <= 2]).toEqual([true, true]);
      expect(filmAt(seen.cells, seen.grid, 0, middle).h).toBeCloseTo(0.25, 3);
      expect(off(pixel(seen.img, 80, 80), bg)).toBeGreaterThanOrEqual(8);
      for (const more of [1, 1, 30]) {
        sim.run(more);
        seen = await follows(sim, s, CLOSE, BIG);
        // The stamp and the amount stay, and the picture draws none of them: the map holds no film, and no pixel
        // differs from the bare ground.
        expect(seen.cells.some((v) => v !== 0)).toBe(false);
        expect(worst(seen.img, seen.plain)).toBeLessThanOrEqual(1);
        expect([seen.steps, seen.changed]).toEqual([0, 0]);
      }
      const field = await fieldOf(sim, s);
      expect([field.stamps[10 * PW + 10], field.amounts[10 * PW + 10]]).toEqual([1, SLIME_FULL]);
      // A life time of 4 times the age: the same slime shows again, at three quarters of its thickness. No step and
      // no stroke lies between the two frames: the new life time alone fills the map of the film again.
      const longer = { ...s, slimeLife: (4 * sim.step) / STEPS_PER_HOUR };
      seen = await follows(sim, longer, CLOSE, BIG);
      expect([seen.steps <= 1, seen.apart <= 2]).toEqual([true, true]);
      expect(filmAt(seen.cells, seen.grid, 0, middle).h).toBeCloseTo(0.75, 3);
      expect(off(pixel(seen.img, 80, 80), bg)).toBeGreaterThanOrEqual(12);
      // And with the life time of before it is gone again.
      seen = await follows(sim, s, CLOSE, BIG);
      expect(seen.cells.some((v) => v !== 0)).toBe(false);
      expect(worst(seen.img, seen.plain)).toBeLessThanOrEqual(1);
    });

    // The map blends the thickness of the 9 cells around a cell, and the spline of the render pass blends 9 texels of
    // the map. Both blend the thickness of the film: the amount of a cell times the strength of its age. Neither
    // blends a stamp or an amount. Slime that is over still has its stamp and its amount in the field, and a blend of
    // them with those of new slime beside it would draw a film where none is.
    it('blends the thickness of the film, never the stamps or the amounts of cells with other ages', async () => {
      const s = pictured();
      const sim = await make(s, PW, PH);
      // A dab that is over after 12 steps, and then new thin slime in the one cell in its middle.
      sim.paint([dab(20.5, 20.5, 6)]);
      sim.run(LIFE);
      sim.paint([dab(20.5, 20.5, 0.6)]);
      const field = await fieldOf(sim, s);
      const c = 20 * PW + 20;
      const around = [-PW - 1, -PW, -PW + 1, -1, 1, PW - 1, PW, PW + 1];
      // The stroke gives its one cell 539 of 4,095. The 8 cells around it hold the full amount of slime that is over.
      expect([field.stamps[c], field.amounts[c]]).toEqual([stampOf(LIFE), 539]);
      expect(around.map((d) => field.stamps[c + d])).toEqual(around.map(() => 1));
      expect(around.map((d) => field.amounts[c + d])).toEqual(around.map(() => SLIME_FULL));
      const t = 539 / SLIME_FULL;

      const seen = await follows(sim, s, CLOSE, BIG);
      expect([seen.steps <= 1, seen.apart <= 2]).toEqual([true, true]);
      // The map: the thickness t of the one cell with slime, by the weights 1, 2, 1 along each axis, over 16. No
      // other cell adds to it.
      const want = new Float32Array(PW * PH);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) want[c + dy * PW + dx] = (t * (2 - Math.abs(dx)) * (2 - Math.abs(dy))) / 16;
      expect(stepsApart(seen.cells, want)).toBeLessThanOrEqual(1);
      // The spline at the middle of the cell: the weights 1/8, 3/4, 1/8 along each axis over those texels, 1.75 of
      // 4 per axis. Half way to the cell beside it: the mean of two columns of texels, 1.5 of 4.
      expect(filmAt(seen.cells, seen.grid, 0, [20.5, 20.5]).h).toBeCloseTo((t * 1.75 * 1.75) / 16, 4);
      expect(filmAt(seen.cells, seen.grid, 0, [21, 20.5]).h).toBeCloseTo((t * 1.5 * 1.75) / 16, 4);
      // A blend of the amounts apart from the strengths would give the texel of the middle cell the mean amount of
      // its 9 cells, (4 · 539 + 12 · 4,095) / 16, times their mean strength, 4 / 16: a film of 0.196, 6 times as
      // thick. A blend of the stamps would give the cells around it slime of an age between.
      const apart = ((4 * 539 + 12 * SLIME_FULL) / 16 / SLIME_FULL) * (4 / 16);
      expect(apart).toBeCloseTo(0.196, 3);
      expect(seen.cells[c]).toBeLessThan(apart / 5);
      // The pixel on the middle of the cell: a film of 0.025 on its top, where it has no slope. Almost bare ground.
      const [bg, look] = [groundOf(s.style), slimeLook(s.style)];
      const middle = pixel(seen.img, 8 * 20, 8 * 20);
      const top = slimed(bg, look, { h: (t * 1.75 * 1.75) / 16, g: [0, 0] }, [20.5, 20.5], [PW, PH], CLOSE.scale);
      expect(off(middle, bytes(top))).toBeLessThanOrEqual(2);
      const wrong = slimed(bg, look, { h: apart, g: [0, 0] }, [20.5, 20.5], [PW, PH], CLOSE.scale);
      expect(off(middle, bytes(wrong))).toBeGreaterThanOrEqual(5);
      // Three cells from the middle, on slime that is over and holds the full amount: the bare ground.
      expect(field.amounts[c + 3]).toBeGreaterThan(3000);
      expect(off(pixel(seen.img, 8 * 23, 8 * 20), bytes(bg))).toBeLessThanOrEqual(1);

      // The coarse maps: a texel holds the mean of the cells that it covers. On this grid a texel of the level 1 covers
      // 2 × 2 cells and one of the level 2 covers 4 × 4. The cell (20, 20) is the first cell of the texel (10, 10)
      // and of the texel (5, 5): the texel holds the weights 4, 2, 2, 1 of 16, and the texels before it the rest.
      for (const [level, scale, first] of [
        [1, 2.5, 10],
        [2, 5, 5],
      ] as const) {
        const coarse = await frame(sim, s, { center: [32, 24], scale });
        expect(coarse.level).toBe(level);
        const n = levelSize(PW, level);
        const cells = 4 ** level;
        const mean = new Float32Array(n * levelSize(PH, level));
        mean[first * n + first] = (t * 9) / 16 / cells;
        mean[first * n + first - 1] = (t * 3) / 16 / cells;
        mean[(first - 1) * n + first] = (t * 3) / 16 / cells;
        mean[(first - 1) * n + first - 1] = t / 16 / cells;
        // Three steps: the texels of the map of the cells under it are a step off, and the mean is rounded again.
        expect(stepsApart(coarse.map, mean), `level ${String(level)}`).toBeLessThanOrEqual(3);
        // From the map of the cells as the backend holds it: one step.
        expect(await mapsApart(sim, s, coarse)).toBeLessThanOrEqual(1);
      }
    });

    /**
     * Slime of four ages on a grid of 64 × 48 cells, painted between steps: after its 9 steps the strokes are 9, 6, 3
     * and 0 steps old. Dabs and lines across the edges of the grid and into a corner, wide strokes with the full
     * amount in their middle, and a line one cell wide and single cells with thin slime: what a view zoomed out can
     * lose.
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
     * rim) and at the bottom edge, at 1 cell per pixel, up to 2 cells per pixel, where the picture reads the map of
     * the cells, and zoomed out onto the levels 1 to 4 of the coarse map.
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

    // The whole picture against the CPU reference: the spline over the map of the cells, the coarse maps, the waves,
    // the beads and the light, and the copies of the periodic grid. Each view in another style, and with two life
    // times: at 12 steps every stroke shows, and at 8 steps the oldest is gone.
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
        let [shown, outside] = [0, 0];
        for (const [i, view] of views(boundary).entries())
          for (const life of [LIFE, 8]) {
            const style = STYLES[(i + (life === LIFE ? 0 : 2)) % STYLES.length] ?? 'glow';
            const settings = { ...s, style, slimeLife: life / STEPS_PER_HOUR };
            const { img, apart, steps, changed } = await follows(sim, settings, view);
            const name = `${style} at ${String(view.scale)} cells per pixel, a life time of ${String(life)} steps`;
            if (apart > 2) failed.push(`${name}: ${String(apart)} apart`);
            if (steps > 1) failed.push(`${name}: the maps are ${String(steps)} steps apart`);
            // The film shows in every view. Zoomed far out, a closed arena is a few pixels wide.
            if (changed === 0 && view.scale <= 6) failed.push(`${name}: the film changes no pixel`);
            shown += changed;
            seen.add(trailLevel(view.scale));
            // Nothing of the film lies outside a closed arena: a pixel that lies a pixel or more outside it has the
            // colour of the free space, 0.55 of the ground, and 0.92 of it on paper.
            if (boundary === 'wrap') continue;
            const space = bytes(groundOf(style).map((v) => v * (style === 'paper' ? 0.92 : 0.55)) as Rgb);
            for (let y = 0; y < SIZE[1]; y++)
              for (let x = 0; x < SIZE[0]; x++) {
                const p = pointOf(view, SIZE, x, y);
                const inside =
                  boundary === 'box'
                    ? Math.min(p[0], p[1], PW - p[0], PH - p[1])
                    : dishRadius(PW, PH) - Math.hypot(p[0] - PW / 2, p[1] - PH / 2);
                if (inside > -view.scale) continue;
                outside++;
                if (off(pixel(img, x, y), space) > 1) failed.push(`${name}: a film outside the arena`);
              }
          }
        expect(failed).toEqual([]);
        expect(shown).toBeGreaterThan(6000);
        if (boundary !== 'wrap') expect(outside).toBeGreaterThan(20_000);
        expect([...seen].sort()).toEqual([0, 1, 2, 3, 4]);
      },
      120_000,
    );

    // A grid whose sides no power of 2 divides: the texels of a coarse map have a part of a cell at their ends. As a
    // periodic lattice: its copies show dimmed.
    it('follows the CPU reference on a grid of 26 × 17 cells and on the copies of a periodic lattice', async () => {
      const s = pictured({ boundary: 'wrap', lattice: [W, H] });
      const sim = await make(s);
      sim.paint([dab(3.3, 4.2, 3.4), dab(25.6, 16.7, 2.3)]);
      sim.run(4);
      sim.paint([{ kind: 'slime', from: [7.5, 12.5], to: [20.5, 9.5], radius: 0.5 }, dab(15.5, 2.5, 0.6)]);
      sim.run(3);
      sim.paint([dab(13, 8.5, 4.6)]);
      const zooms: View[] = [0.25, 0.8, 1.3, 2, 3.1, 5.2, 9, 17].map((scale) => ({ center: [13.3, 8.6], scale }));
      const failed: string[] = [];
      for (const [i, view] of zooms.entries())
        for (const lattice of [s.lattice, null]) {
          const settings = { ...s, lattice, style: STYLES[i % STYLES.length] ?? 'glow' };
          const { apart, steps, changed } = await follows(sim, settings, view);
          // The copies around a lattice show at 15 % (ADR 0026), and zoomed out the lattice is a few pixels wide.
          // Without the lattice the copies are as bright as the grid, and the film shows on every one of them.
          const few = lattice ? view.scale <= 2 && changed < 100 : changed < 400;
          if (apart > 2 || steps > 1 || few)
            failed.push(`${String(view.scale)}: ${String(apart)} apart, ${String(steps)} steps, ${String(changed)}`);
        }
      expect(failed).toEqual([]);
    });

    // The highlight is white light on the film, and on a dark ground it stops at 0.8 of white. No look of today gets
    // there: the strongest highlight is 0.7. So this test makes the highlight of the glow style 3 times white for its
    // frames, in the numbers of the renderer that both the uniform and the reference read.
    it('stops the highlight on a dark ground at 0.8 of white, however strong a look makes it', async () => {
      const kept = SLIME_LOOK.glow;
      onTestFinished(() => {
        SLIME_LOOK.glow = kept;
      });
      SLIME_LOOK.glow = { ...kept, gloss: 3 };
      const s = pictured({ slimeLife: 144 });
      const sim = await make(s, PW, PH);
      sim.paint([dab(20.5, 20.5, 9)]);
      const seen = await follows(sim, s, CLOSE, BIG);
      expect([seen.steps <= 1, seen.apart <= 2]).toEqual([true, true]);
      // On the rim of the dab that faces the lamp the highlight is at its top. The brightest pixel there has the
      // ground, at most the whole body and half of the wide light in the colour of the film, and 0.8 of white: never
      // white itself.
      const [bg, look] = [groundOf(s.style), slimeLook(s.style)];
      expect(look.gloss).toBe(3);
      const top = bg.map((v, k) => v + (look.color[k] ?? 0) * (look.body + look.wide * 0.5) + 0.8) as Rgb;
      const brightest = [0, 0, 0];
      seen.img.data.forEach((v, i) => {
        if (i % 4 < 3) brightest[i % 4] = Math.max(brightest[i % 4] ?? 0, v);
      });
      brightest.forEach((v, k) => {
        expect(v).toBeGreaterThanOrEqual(toByte(0.8));
        expect(v).toBeLessThanOrEqual(toByte(top[k] ?? 0) + 1);
        expect(v).toBeLessThan(250);
      });
    });

    // The waves and the beads are a pattern that is fixed in the grid: a pan moves them with the ground, so nothing
    // shimmers when the view moves.
    it('keeps the waves and the beads fixed in the grid when the view moves', async () => {
      const s = pictured({ slimeLife: 144 });
      const sim = await make(s, PW, PH);
      sim.paint([everywhere(sim)]);
      // 4 pixels per cell, and a pan by 7 cells to the right and 5 cells down: 28 and 20 whole pixels.
      const size = [128, 96] as const;
      const [dx, dy] = [28, 20];
      const here: View = { center: [22, 19], scale: 0.25 };
      const there: View = { center: [29, 24], scale: 0.25 };
      const [first, second] = [await follows(sim, s, here, size), await follows(sim, s, there, size)];
      expect([first.steps <= 1, first.apart <= 2, second.steps <= 1, second.apart <= 2]).toEqual([
        true,
        true,
        true,
        true,
      ]);
      // The film is flat and full, so all that a frame shows is the pattern: more than one colour.
      const reds = new Set([...first.img.data].filter((_, i) => i % 4 === 0));
      expect(Math.max(...reds) - Math.min(...reds)).toBeGreaterThanOrEqual(8);
      // The grid point under the pixel (x, y) of the first frame lies under the pixel (x − 28, y − 20) of the second.
      let [moved, stayed] = [0, 0];
      for (let y = dy; y < size[1]; y++)
        for (let x = dx; x < size[0]; x++) {
          const before = pixel(first.img, x, y);
          moved = Math.max(moved, off(before, pixel(second.img, x - dx, y - dy)));
          if (off(before, pixel(second.img, x, y)) <= 2) stayed++;
        }
      // Two frames dither apart by 2 at most.
      expect(moved).toBeLessThanOrEqual(2);
      // A pattern that stood still on the screen would leave every pixel as it was. This one leaves less than two
      // thirds of them: the waves are wide, and many pixels have the colour of a pixel 7 cells away.
      expect(stayed).toBeLessThan(((size[0] - dx) * (size[1] - dy) * 2) / 3);
    });

    // The lattices of the waves and of the beads have a whole number of steps along each side of the grid, so the
    // pattern repeats with a periodic grid. 26 × 29 cells: 2 × 2 steps for the waves, and 4 × 4 for the beads.
    it('repeats the waves and the beads with a periodic grid, with no seam at its edge', async () => {
      const [w, h] = [26, 29];
      const s = pictured({ boundary: 'wrap', slimeLife: 144 });
      const sim = await make(s, w, h);
      sim.paint([everywhere(sim)]);
      // 8 pixels per cell, one whole grid, around the corner where four copies of the grid meet: the edges of the
      // grid lie between the columns 103 and 104 and between the rows 115 and 116.
      const size = [8 * w, 8 * h] as const;
      const corner: View = { center: [0, 0], scale: 1 / 8 };
      const seen = await follows(sim, s, corner, size);
      expect([seen.steps <= 1, seen.apart <= 2]).toEqual([true, true]);
      expect(seen.changed).toBe(size[0] * size[1]);
      // A pan by a whole grid shows the same picture: two frames dither apart by 2 at most.
      for (const center of [
        [w, 0],
        [0, h],
        [-w, -2 * h],
      ] as [number, number][]) {
        const copy = await backend.capture(sim, s, { center, scale: 1 / 8 }, size[0], size[1]);
        expect(maxDiff(copy, seen.img)).toBeLessThanOrEqual(2);
      }
      // No seam. How much two columns of pixels differ, in the mean over their rows, and so for two rows.
      const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;
      const columnsApart = (a: number, b: number) =>
        mean(Array.from({ length: size[1] }, (_, y) => off(pixel(seen.img, a, y), pixel(seen.img, b, y))));
      const rowsApart = (a: number, b: number) =>
        mean(Array.from({ length: size[0] }, (_, x) => off(pixel(seen.img, x, a), pixel(seen.img, x, b))));
      const columns = Array.from({ length: size[0] - 1 }, (_, x) => columnsApart(x, x + 1));
      const rows = Array.from({ length: size[1] - 1 }, (_, y) => rowsApart(y, y + 1));
      // Across an edge of the grid two columns side by side differ no more than the two that differ most elsewhere,
      // give or take half a byte for the dither. And so for the rows.
      expect(at(columns, 103)).toBeLessThanOrEqual(Math.max(...columns.filter((_, x) => x !== 103)) + 0.5);
      expect(at(rows, 115)).toBeLessThanOrEqual(Math.max(...rows.filter((_, y) => y !== 115)) + 0.5);
      // A pattern that did not repeat would meet another step of its lattice at the edge. Two columns one step of
      // the lattice of the waves apart, 13 cells, differ by far more than any two side by side. And so do two rows
      // 14.5 cells apart.
      expect(columnsApart(0, 104)).toBeGreaterThan(Math.max(...columns) + 1);
      expect(rowsApart(0, 116)).toBeGreaterThan(Math.max(...rows) + 1);
    });

    // 30 and 18 cells over the 12 cells of a step of the waves are 2.5 and 1.5: half way between two whole numbers.
    // The passes count the steps in whole numbers, 3 and 2. With `round` the two backends drew other waves here:
    // WGSL takes the even number at a half, and GLSL takes either.
    it('draws the waves of the reference on a grid whose sides lie half way between two steps of their lattice', async () => {
      const s = pictured({ boundary: 'wrap', slimeLife: 144 });
      const sim = await make(s, 30, 18);
      sim.paint([everywhere(sim)]);
      for (const [scale, size] of [
        [0.25, [160, 96]],
        [1, [40, 24]],
      ] as const) {
        const seen = await follows(sim, s, { center: [15, 9], scale }, size);
        expect([seen.steps <= 1, seen.apart <= 2], `${String(scale)} cells per pixel`).toEqual([true, true]);
        expect(seen.changed).toBe(size[0] * size[1]);
      }
    });

    // The map of the film is made once for a state of the slime, and every frame of that state reads it: a paused
    // simulation draws its film without the pass of the map. A state is over after a step, a stroke, Clear and a
    // reset, and with another life time.
    it('fills the map of the film again after a step, a stroke, Clear and a reset, and not for a second frame of the same state', async () => {
      // Without the fan of the growth front, which has a map of its own (front.gpu.test.ts).
      const s = pictured({ showFront: false });
      const sim = await make(s, PW, PH);
      // The passes of a frame: the render passes of WebGPU, and the draws of WebGL2, which has one per pass.
      const passes: { mock: { calls: unknown[] } } =
        kind === 'webgpu'
          ? vi.spyOn(GPUCommandEncoder.prototype, 'beginRenderPass')
          : vi.spyOn((backend as unknown as { gl: WebGL2RenderingContext }).gl, 'drawArrays');
      onTestFinished(() => {
        vi.restoreAllMocks();
      });
      const whole: View = { center: [32, 24], scale: 1 };
      /** A frame: how many passes it has, and the map of the cells after it. */
      const draw = async (settings = s, view = whole) => {
        const before = passes.mock.calls.length;
        await backend.capture(sim, settings, view, PW, PH);
        const count = passes.mock.calls.length - before;
        return { count, cells: await heldMap(sim, 0) };
      };
      const [middle, other] = [20 * PW + 20, 30 * PW + 44];
      /** Whether a texel holds the full thickness, to a step of a 16-bit float. */
      const full = (v = 0) => Math.abs(v - 1) <= 1 / 2048;
      sim.paint([dab(20.5, 20.5, 9)]);
      const first = await draw();
      const again = await draw();
      // The first frame of a state has one pass more than the next one: the pass of the map.
      expect(first.count - again.count).toBe(1);
      expect([full(first.cells[middle]), full(again.cells[middle]), first.cells[other]]).toEqual([true, true, 0]);
      // Another part of the grid, another zoom below 2 cells per pixel and another style read the same map.
      expect((await draw(s, { center: [10, 10], scale: 1 })).count).toBe(again.count);
      expect((await draw(s, { center: [32, 24], scale: 0.3 })).count).toBe(again.count);
      expect((await draw({ ...s, style: 'paper' })).count).toBe(again.count);
      // A step: the slime is one step of 12 older.
      sim.run(1);
      const stepped = await draw();
      expect(stepped.count).toBe(first.count);
      expect(stepped.cells[middle]).toBeCloseTo(11 / 12, 3);
      expect((await draw()).count).toBe(again.count);
      // A stroke: new slime where none was.
      sim.paint([dab(44.5, 30.5, 9)]);
      const painted = await draw();
      expect(painted.count).toBe(first.count);
      expect(full(painted.cells[other])).toBe(true);
      expect((await draw()).count).toBe(again.count);
      // Another life time, and the one of before again.
      const longer = { ...s, slimeLife: 24 / STEPS_PER_HOUR };
      const aged = await draw(longer);
      expect(aged.count).toBe(first.count);
      expect(aged.cells[middle]).toBeCloseTo(23 / 24, 3);
      expect((await draw(longer)).count).toBe(again.count);
      expect((await draw()).count).toBe(first.count);
      // Clear takes all slime away.
      sim.clearEnvironment();
      const cleared = await draw();
      expect(cleared.count).toBe(first.count);
      expect(cleared.cells.some((v) => v !== 0)).toBe(false);
      expect((await draw()).count).toBe(again.count);
      // New slime, and a reset, which takes it away again.
      sim.paint([dab(20.5, 20.5, 9)]);
      expect(full((await draw()).cells[middle])).toBe(true);
      sim.reset();
      const reset = await draw();
      expect(reset.count).toBe(first.count);
      expect(reset.cells.some((v) => v !== 0)).toBe(false);
      expect((await draw()).count).toBe(again.count);
      // Zoomed out, a frame reads the coarse map of its level, made from the map of the cells. A frame without the
      // film fills the coarse map of the trail of that level first. Then the first frame with the film has one pass
      // more than the next one: the pass of the coarse map of the film.
      sim.paint([dab(20.5, 20.5, 9)]);
      await draw();
      for (const scale of [2.5, 5]) {
        const out: View = { center: [32, 24], scale };
        await backend.capture(sim, { ...s, showSlime: false }, out, PW, PH);
        const [once, twice] = [await draw(s, out), await draw(s, out)];
        expect(once.count - twice.count, `${String(scale)} cells per pixel`).toBe(1);
        expect(twice.count).toBe(again.count);
      }
      // The map of the cells is still the one of the state.
      expect((await draw()).count).toBe(again.count);
    });

    // The pass of the coarse map of the film reads a texture of the simulation for the size of the grid alone: the
    // trail that the frame draws. A simulation frees such a texture while it lives: the picture of the tubes, when
    // the settings no longer show it. On WebGPU a pass with a freed texture is an error of the device, and the frame
    // is lost.
    it('fills the coarse map of the film after the simulation freed the picture of the tubes', async () => {
      const tubes = pictured({ slimeLife: 144, flow: true, showTubes: true });
      const sim = await make(tubes, PW, PH);
      sim.paint([dab(20.5, 20.5, 9)]);
      sim.run(1);
      // The frames draw the picture of the tubes, a texture of its own.
      expect((await sim.readTubeRoots()).length).toBe(PW * PH * 4);
      const device = kind === 'webgpu' ? (backend as WebGpuBackend).gpu.device : undefined;
      device?.pushErrorScope('validation');
      const out: View = { center: [32, 24], scale: 2.5 };
      const before = await follows(sim, tubes, out);
      // Without the picture of the tubes the simulation frees its textures. A step makes a new state of the slime,
      // so the next frame fills both maps of the film again.
      const plain = { ...tubes, showTubes: false };
      sim.update(plain);
      sim.run(1);
      const after = await follows(sim, plain, out);
      expect((await device?.popErrorScope())?.message).toBeUndefined();
      expect((await sim.readTubeRoots()).length).toBe(0);
      expect([before.steps <= 1, before.apart <= 2]).toEqual([true, true]);
      expect([after.steps <= 1, after.apart <= 2]).toEqual([true, true]);
      expect(after.changed).toBeGreaterThan(50);
    });

    /**
     * The distance from `p` to the outline of the walls as the picture draws it, in cells, above 0 inside a wall
     * (`wallCover` of render.wgsl `envAt`): the spline over the 3 × 3 cells of `shape` around `p`, and where the
     * spline puts the centre of the cell under `p` on the other side of the outline than the cell itself, the step
     * that sets it right. A wall covers a pixel from half a pixel outside its outline on. `shape`: as
     * Sim.readShape() returns it. For a point whose 3 × 3 cells lie in the arena.
     */
    function wallCover(shape: Uint8Array, width: number, [px, py]: readonly [number, number]) {
      const [cx, cy] = [Math.floor(px), Math.floor(py)];
      const [ux, uy] = [px - cx - 0.5, py - cy - 0.5];
      const weights = (u: number) => [0.5 * (0.5 - u) ** 2, 0.75 - u * u, 0.5 * (0.5 + u) ** 2];
      const [wx, wy, middle] = [weights(ux), weights(uy), weights(0)];
      const byte = (i: number, j: number) => (shape[((cy + j - 1) * width + cx + i - 1) * 4] ?? 0) / 255;
      let [v, centre] = [0, 0];
      for (let j = 0; j < 3; j++)
        for (let i = 0; i < 3; i++) {
          v += (wx[i] ?? 0) * (wy[j] ?? 0) * byte(i, j);
          centre += (middle[i] ?? 0) * (middle[j] ?? 0) * byte(i, j);
        }
      const distance = (share: number) => (share - 0.5) * 2 * SHAPE_RANGE;
      const [own, spline] = [distance(byte(1, 1)), distance(centre)];
      const side = (1 - 4 * ux * ux) * (1 - 4 * uy * uy);
      return distance(v) + (own > 0 === spline > 0 ? 0 : (own - spline) * side * side);
    }

    // No wall and no cell outside the arena holds slime. In the map they take the film of the open cells beside them,
    // so the film does not fall toward a wall or toward the rim of the dish: it goes on up to them, and they are
    // drawn over it. With the cells of a wall in the mean the film had a tooth for each cell along a slanted wall.
    it.each(['box', 'dish'] as const)(
      'lets the film go on up to a wall and to the edge of the arena, with no tooth along a slanted wall (%s)',
      async (boundary) => {
        // On paper, where the bytes of the ground without the film tell the shade of the shadow of a wall. The
        // default life time: new slime is at its full strength.
        const s = pictured({ boundary, style: 'paper', slimeLife: 144 });
        const sim = await make(s, PW, PH);
        // Slime everywhere. Then a straight wall, 5 cells wide, and two slanted walls: a wall clears the slime of
        // its cells.
        sim.paint([
          everywhere(sim),
          { kind: 'wall', from: [20.5, 14], to: [20.5, 34], radius: 2.5 },
          { kind: 'wall', from: [30, 30], to: [40, 34], radius: 1.5 },
          { kind: 'wall', from: [36, 8], to: [44, 20], radius: 2.2 },
        ]);
        const grid = await gridOf(sim, s);
        const field = await fieldOf(sim, s);
        const open = (x: number, y: number) => openCell(grid, x, y) >= 0;
        const cells = [...field.stamps.keys()];
        expect(cells.every((c) => field.amounts[c] === (open(c % PW, Math.floor(c / PW)) ? SLIME_FULL : 0))).toBe(true);
        const held = await frame(sim, s, CLOSE, BIG);
        expect(await mapsApart(sim, s, held)).toBeLessThanOrEqual(1);
        // The map by hand: the full thickness where an open cell lies among the 5 × 5 cells around a cell (among the
        // 3 × 3, or else among the 5 × 5), and no film elsewhere: in the middle of the straight wall, and far outside
        // the dish.
        const want = Float32Array.from(cells, (c) => {
          for (let dy = -2; dy <= 2; dy++)
            for (let dx = -2; dx <= 2; dx++) if (open((c % PW) + dx, Math.floor(c / PW) + dy)) return 1;
          return 0;
        });
        expect(stepsApart(held.cells, want)).toBeLessThanOrEqual(1);
        // The straight wall holds the cells 18 to 22 of the row 24: its outer cells touch an open cell, the next ones
        // lie two cells from one, and its middle cell lies three cells from one.
        expect([17, 18, 19, 20, 21, 22, 23].map((x) => open(x, 24))).toEqual([
          true,
          false,
          false,
          false,
          false,
          false,
          true,
        ]);
        expect([17, 18, 19, 20, 21, 22, 23].map((x) => want[24 * PW + x])).toEqual([1, 1, 1, 0, 1, 1, 1]);
        if (boundary === 'dish') expect([want[0], want[24 * PW + 8], want[24 * PW + 9]]).toEqual([0, 1, 1]);

        // The film at the pixels beside the walls: ground that no wall covers, within 2 cells of an outline. In the
        // dish, also a cell and a half inside its rim: beside the rim `shape` holds what the box left there.
        const shape = await sim.readShape();
        const wrong = filmCells(grid, field, false);
        const plain = await backend.capture(sim, { ...s, showSlime: false }, CLOSE, BIG[0], BIG[1]);
        const [bg, look] = [groundOf(s.style), slimeLook(s.style)];
        let [beside, thinnest, teeth, apart, compared] = [0, 1, 1, 0, 0];
        let [atRim, thinnestAtRim, inOpen, thinnestInOpen] = [0, 1, 0, 1];
        for (let y = 0; y < BIG[1]; y++)
          for (let x = 0; x < BIG[0]; x++) {
            const p = pointOf(CLOSE, BIG, x, y);
            const rim =
              boundary === 'dish'
                ? dishRadius(PW, PH) - Math.hypot(p[0] - PW / 2, p[1] - PH / 2)
                : Math.min(p[0], p[1], PW - p[0], PH - p[1]);
            if (rim < CLOSE.scale / 2) continue;
            const h = filmAt(held.cells, grid, 0, p).h;
            if (open(Math.floor(p[0]), Math.floor(p[1]))) {
              inOpen++;
              thinnestInOpen = Math.min(thinnestInOpen, h);
            }
            if (rim < 1.5) {
              // The last cell and a half before the edge of the arena, where the frame draws the arena alone.
              atRim++;
              thinnestAtRim = Math.min(thinnestAtRim, h);
              continue;
            }
            const sd = wallCover(shape, PW, p);
            if (sd > -0.07 || sd < -2) continue;
            beside++;
            thinnest = Math.min(thinnest, h);
            teeth = Math.min(teeth, filmAt(wrong, grid, 0, p).h);
            // The picture there: the shadow of a wall darkens the ground with the film as much as the ground
            // without it. So the pixel is the ground with the film of the map on it, by the shade that the picture
            // without the film shows there.
            compared++;
            const ground = slimed(bg, look, filmAt(held.cells, grid, 0, p), p, [PW, PH], CLOSE.scale);
            const shade = pixel(plain, x, y).map(fromByte);
            const shaded = ground.map((v, k) => (v * (shade[k] ?? 0)) / (bg[k] ?? 1)) as Rgb;
            apart = Math.max(apart, off(pixel(held.img, x, y), bytes(shaded)));
          }
        // At every point of an open cell the film has its full thickness, to 2 steps of a 16-bit float: all 9 texels
        // around the point are those of open cells or of cells that touch one.
        expect(inOpen).toBeGreaterThan(80_000);
        expect(thinnestInOpen).toBeGreaterThanOrEqual(1 - 1 / 1024);
        // No tooth: beside every wall the film is flat, to 1 of 1,000 of its thickness. The outline of a wall is
        // smooth and runs through cells of the wall, so some ground lies in such a cell, and the spline reads the
        // cell behind it: that cell takes the film of the open cells two cells away.
        expect(beside).toBeGreaterThan(8000);
        expect(thinnest).toBeGreaterThanOrEqual(0.999);
        // With the cells of the walls in the mean, the film would fall to less than three quarters there.
        expect(teeth).toBeLessThan(0.75);
        // Two captures, each with a dither of 1 and its rounding: 3 apart at most.
        expect(compared).toBeGreaterThan(8000);
        expect(apart).toBeLessThanOrEqual(3);
        // Up to the edge of the arena the film keeps its thickness, to 1 of 1,000: in the dish a cell outside the rim
        // takes the film of the cells of the dish up to two cells away, and the spline reads no cell farther out.
        expect(atRim).toBeGreaterThan(10_000);
        expect(thinnestAtRim).toBeGreaterThanOrEqual(0.999);

        // A frame that draws no walls counts their cells with the thickness 0 that they have: the film falls toward
        // them, and nothing covers that. Only the renderer of WebGPU has the switch for it.
        if (kind !== 'webgpu') return;
        const renderer = (backend as unknown as { renderer: { overlays: boolean } }).renderer;
        onTestFinished(() => {
          renderer.overlays = true;
        });
        renderer.overlays = false;
        const bare = await follows(sim, s, CLOSE, BIG, false);
        expect([bare.steps <= 1, bare.apart <= 2]).toEqual([true, true]);
        expect(stepsApart(bare.cells, wrong)).toBeLessThanOrEqual(1);
        renderer.overlays = true;
        // And with the walls again the map is the one of before.
        expect(stepsApart((await frame(sim, s, CLOSE, BIG)).cells, want)).toBeLessThanOrEqual(1);
      },
    );

    // Decision 8: the film lies on the ground. A flake of food covers 95 % of its ground, a wall, an electrode and a
    // thick trail all of it, and the light lies on the ground with the film. A thin trail hides a share of the film.
    it.each(['glow', 'gel', 'paper'] as const)(
      'draws the food, the walls, the light, the electrodes and the trail on the film (%s)',
      async (style) => {
        // The default life time: slime of the age 0 and 1 is at the full strength.
        const s = pictured({ style, slimeLife: 144 });
        const sim = await make(s, PW, PH);
        // Slime everywhere; then a wall, which clears the slime of its cells, and food, light and an electrode.
        sim.paint([
          everywhere(sim),
          { kind: 'wall', from: [10.5, 6], to: [10.5, 30], radius: 2.5 },
          { kind: 'food', from: [24.5, 12.5], to: [24.5, 12.5], radius: 6 },
          { kind: 'light', from: [40.5, 12.5], to: [40.5, 12.5], radius: 6 },
          { kind: 'cathode', from: [54.5, 12.5], to: [54.5, 12.5], radius: 4 },
        ]);
        const field = await fieldOf(sim, s);
        const env = await sim.readEnv();
        const cells = [...field.stamps.keys()];
        const walled = (c: number) => (env[c * 4] ?? 0) >= 128;
        // Every open cell has slime of the full amount, also below the food, the light and the electrode. No cell of
        // the wall has.
        expect(cells.every((c) => (field.stamps[c] !== NO_STAMP) === !walled(c))).toBe(true);
        expect(cells.every((c) => field.amounts[c] === (walled(c) ? 0 : SLIME_FULL))).toBe(true);
        expect(cells.filter(walled).length).toBeGreaterThan(100);
        // A trail in a block of cells, without a step: thin in its left half, thick in its right half.
        const exposure = 0.4 / equilibrium(s);
        const trail = new Float32Array(PW * PH * 4);
        for (let y = 30; y < 44; y++)
          for (let x = 20; x < 48; x++) trail[(y * PW + x) * 4] = (x < 34 ? 0.5 : 40) / exposure;
        sim.writeTrail(trail);
        const held = await frame(sim, s, CLOSE, BIG);
        expect(await mapsApart(sim, s, held)).toBeLessThanOrEqual(1);
        const plain = await backend.capture(sim, { ...s, showSlime: false }, CLOSE, BIG[0], BIG[1]);
        const [bg, look] = [groundOf(style), slimeLook(style)];
        /**
         * The pixel on the centre of cell (x, y) with the film, what it is without the film, in bytes and in linear
         * light, and the ground there with the film on it: flat, of the full thickness, with its waves.
         */
        const both = (x: number, y: number) => {
          const [a, b] = [pixel(held.img, 8 * x, 8 * y), pixel(plain, 8 * x, 8 * y)];
          const ground = slimed(bg, look, { h: 1, g: [0, 0] }, [x + 0.5, y + 0.5], [PW, PH], CLOSE.scale);
          return { on: a, plain: b, linear: b.map(fromByte) as Rgb, ground };
        };
        // A relation between two captures, each with a dither of 1 and its rounding: 3 apart at most.
        const TWO = 3;
        // Plain ground far from all of them: the film alone.
        const bare = both(58, 40);
        expect(off(bare.plain, bytes(bg))).toBeLessThanOrEqual(1);
        expect(off(bare.on, bytes(bare.ground))).toBeLessThanOrEqual(2);
        expect(off(bare.on, bare.plain)).toBeGreaterThanOrEqual(12);
        // The middle of the flake: 5 % of the ground shows through it.
        const food = both(24, 12);
        const through = food.linear.map((v, k) => v + 0.05 * ((food.ground[k] ?? 0) - (bg[k] ?? 0))) as Rgb;
        expect(off(food.on, bytes(through)), 'food').toBeLessThanOrEqual(TWO);
        expect(off(food.on, food.plain), 'food').toBeLessThanOrEqual(TWO);
        expect(off(food.plain, bytes(bg))).toBeGreaterThan(40);
        // The wall: its middle, and its outer cells, whose neighbours have slime. Two frames dither apart by 2.
        for (const x of [8, 10, 12]) expect(off(both(x, 18).on, both(x, 18).plain), 'wall').toBeLessThanOrEqual(2);
        expect(off(both(10, 18).plain, bytes(bg))).toBeGreaterThan(20);
        // The light adds to the ground below it, with the film or without it.
        const lit = both(40, 12);
        const added = lit.linear.map((v, k) => v + (lit.ground[k] ?? 0) - (bg[k] ?? 0)) as Rgb;
        expect(off(lit.plain, bytes(bg)), 'light').toBeGreaterThan(10);
        expect(off(lit.on, bytes(added)), 'light').toBeLessThanOrEqual(TWO);
        // The electrode covers all of what lies below it (ADR 0058): the film does not show through.
        const pole = both(54, 12);
        expect(off(pole.plain, bytes(bg)), 'electrode').toBeGreaterThan(40);
        expect(off(pole.on, pole.plain), 'electrode').toBeLessThanOrEqual(TWO);
        // The trail lies on the film (ADR 0059): the plasm hides the film below it, by the share 1 − e^(−3 x) for the
        // light x of the plasm, 0.5 here. On the ground that is left, glow adds light to what the ground leaves dark,
        // and the ink of paper takes a share of the ground away.
        const thin = both(26, 37);
        expect(off(thin.plain, bytes(bg)), 'thin trail').toBeGreaterThan(20);
        const hidden = 1 - Math.exp(-FILM_HIDE * 0.5);
        const under = thin.ground.map((g, k) => g + ((bg[k] ?? 0) - g) * hidden) as Rgb;
        if (style === 'glow') {
          const lightOf = (k: number) => ((thin.linear[k] ?? 0) - (bg[k] ?? 0)) / (1 - (bg[k] ?? 0));
          const want = under.map((g, k) => g + (1 - g) * lightOf(k)) as Rgb;
          expect(off(thin.on, bytes(want)), 'thin trail').toBeLessThanOrEqual(TWO);
        }
        if (style === 'paper') {
          const want = under.map((g, k) => (g * (thin.linear[k] ?? 0)) / (bg[k] ?? 1)) as Rgb;
          expect(off(thin.on, bytes(want)), 'thin trail').toBeLessThanOrEqual(TWO);
        }
        // A thick trail hides the ground in every style: the glow is white, the gel is opaque, the ink is black.
        const thick = both(41, 37);
        expect(off(thick.on, thick.plain), 'thick trail').toBeLessThanOrEqual(2);
      },
    );

    // Decision 8 and the three ways without the film: Show slime off, a life time of 0, and the Jones model. Against
    // the shaders without the code of the film (WITHOUT_SLIME), with the same state, uniforms and dither: 0 of 255
    // apart. The field holds slime in every case but the Jones model, which has no field. 3 × 168 captures of 64 × 48
    // pixels.
    it('draws the pixels of the shaders without the film while the film is off, in every style', async () => {
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
            ['the switches', { ...base, showSlime: false, showFront: false }],
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
      // The same frames with the film on differ where the field holds slime and the model has slime. Not in the gel
      // style: these scenes are full of trail, and the gel over a trail hides its ground.
      hook.renderFrom();
      const shown = await captures({ showSlime: true, showFront: false, slimeLife: 144 });
      const differs = shown.map((img, i) => maxDiff(img, before[i] ?? img));
      const slimed = cases.flatMap((c, i) =>
        c.slime && c.settings.model === 'extended' && c.settings.style !== 'gel'
          ? [[c.name, differs[i] ?? 0] as const]
          : [],
      );
      expect(slimed.length).toBeGreaterThan(cases.length / 3);
      // Both runs dither alike, so every difference is one of the picture. The plasm hides the film below it (ADR
      // 0059): a close view below a strong trail shows little of the film, 1 of 255 in 8 of the 84 frames.
      expect(slimed.filter(([, d]) => d < 1)).toEqual([]);
      expect(slimed.filter(([, d]) => d < 2).length).toBeLessThan(slimed.length / 5);
      const jonesFrames = cases.flatMap((c, i) => (c.settings.model === 'jones' ? [differs[i] ?? 0] : []));
      expect(Math.max(0, ...jonesFrames)).toBe(0);
    }, 240_000);

    // The scent view draws no slime (decision 8): its picture is the one without the film, with slime in the field.
    it('draws no film below the scent view', async () => {
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
      // The same frame without the scent view shows the film.
      const film = await backend.capture(sim, s, view, 128, 96);
      expect(maxDiff(film, await backend.capture(sim, { ...s, showSlime: false }, view, 128, 96))).toBeGreaterThan(8);
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
      const size = [128, 96] as const;
      /** The pixel in the middle of the picture, which lies in the middle of the dab. */
      const shot = async (settings: Settings) =>
        pixel(await backend.capture(sim, settings, view, size[0], size[1]), 64, 48);
      const bg = groundOf(extended.style);
      // The middle of a dab of 10 cells: a flat film of the full thickness.
      const film = { h: 1, g: [0, 0] as [number, number] };
      const full = slimed(bg, slimeLook(extended.style), film, pointOf(view, size, 64, 48), [PW, PH], view.scale);
      expect(off(bytes(full), bytes(bg))).toBeGreaterThanOrEqual(12);
      sim.paint([dab(32, 24, 10)]);
      expect(off(await shot(extended), bytes(full))).toBeLessThanOrEqual(2);
      sim.update(jones);
      expect(off(await shot(jones), bytes(bg))).toBeLessThanOrEqual(1);
      // Back in the extended model: no field until a stroke or a step writes a stamp, and no film.
      sim.update(extended);
      expect(off(await shot(extended), bytes(bg))).toBeLessThanOrEqual(1);
      sim.paint([dab(32, 24, 10)]);
      expect(off(await shot(extended), bytes(full))).toBeLessThanOrEqual(2);
      expect(
        stepsApart(await heldMap(sim, 0), filmCells(await gridOf(sim, extended), await fieldOf(sim, extended))),
      ).toBeLessThanOrEqual(1);
      expect((await device?.popErrorScope())?.message).toBeUndefined();
    });

    // The film is a part of the picture alone. Two simulations from one seed, one drawn with the film after every
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
        amounts: Array.from(await sim.readSlimeAmount()),
        step: sim.step,
      });
      const [a, b] = [await state(viewed), await state(plain)];
      expect(a.slime.filter((v) => v !== NO_STAMP).length).toBeGreaterThan(400);
      expect(a.amounts.filter((v) => v !== 0).length).toBeGreaterThan(400);
      expect(a).toEqual(b);
    }, 120_000);

    // The pipelines (WebGPU) and programs (WebGL2) of the film are built once, from the first frame that draws the
    // film and without blocking it, as those of the scent view: a frame of a scene without slime builds none.
    it('builds the pipelines or programs of the film once, and none for a frame without the film', async () => {
      const s = pictured({ slimeLife: 144 });
      const sim = await make(s, PW, PH);
      sim.paint([dab(32, 24, 10)]);
      const view: View = { center: [32, 24], scale: 0.5 };
      let builds: { mock: { calls: unknown[] } };
      let ready: () => Promise<unknown>;
      let frameOf: (settings: Settings) => void;
      if (kind === 'webgpu') {
        const gpu = backend as WebGpuBackend;
        onTestFinished(() => {
          vi.restoreAllMocks();
          gpu.renderFrom();
        });
        gpu.renderFrom(); // a new renderer: nothing of the film is built yet
        builds = vi.spyOn(gpu.gpu.device, 'createRenderPipelineAsync');
        ready = () => backend.capture(sim, s, view, 8, 8);
        frameOf = (settings) => {
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
        frameOf = (settings) => {
          if (slimeShown(settings)) programs.slimed();
        };
      }
      for (const settings of [
        { ...s, showSlime: false, showFront: false },
        { ...s, slimeLife: 0 },
      ])
        for (let k = 0; k < 3; k++) frameOf(settings);
      expect(builds.mock.calls.length).toBe(0);
      for (let k = 0; k < 3; k++) frameOf(s);
      await ready();
      const first = builds.mock.calls.length;
      for (let k = 0; k < 5; k++) {
        frameOf(s);
        await ready();
      }
      // The render pass with the film and the pass of its map, each without and with food, light and walls, and the
      // pass of its coarse map. The fan of the growth front has pipelines of its own (ADR 0059), which a scene
      // without growth never builds.
      expect(first).toBe(5);
      expect(builds.mock.calls.length).toBe(first);
    });
  });
});
