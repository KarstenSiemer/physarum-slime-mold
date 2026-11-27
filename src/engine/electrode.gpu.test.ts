// Runs in Chromium with real GPU APIs (Metal locally, SwiftShader in CI). See ADR 0010.
// The picture of the electrodes (ADR 0058) on both backends, against the CPU reference electrode-reference.ts: the
// outline of a pole, its surface and its shadow, what a pole covers, and the picture after every change of the poles.
// The bytes that the picture reads are held to their own CPU model in sim.gpu.test.ts ("of the electrode tool").
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, onTestFinished } from 'vitest';
import { hexToLinear } from '../model/color';
import { BOUNDARIES, defaultSettings, defaultStrain, STYLES, type Boundary, type Settings } from '../model/params';
import { at } from './at';
import { dishRadius } from './brush';
import { electrodesOver, POLE_COLOR, POLE_RIM, POLE_SHADE, polesAt, SUN, type Rgb } from './electrode-reference';
import { WebGl2Backend } from './gl/backend';
import renderFrag from './gl/glsl/render.frag?raw';
import { onOutline, outlineAt, outlineCell, type OutlineGrid } from './outline-reference';
import { BACKGROUND, LATTICE_COPIES } from './render';
import renderWgsl from './shaders/render.wgsl?raw';
import type { Backend, Sim, Stroke, View } from './types';
import { WebGpuBackend } from './webgpu';

const BACKENDS = {
  webgpu: (c: HTMLCanvasElement): Promise<Backend> => WebGpuBackend.create(c),
  webgl2: (c: HTMLCanvasElement): Promise<Backend> => Promise.resolve(WebGl2Backend.create(c)),
};

/** `source` with the one match of `from` replaced by `to`, for each pair of `edits` in turn. */
function rewrite(source: string, edits: readonly (readonly [from: string, to: string])[]) {
  return edits.reduce((text, [from, to]) => {
    if (text.split(from).length !== 2) throw new Error(`Not found once: ${from}`);
    return text.replace(from, to);
  }, source);
}

/** The text of `source` from the one match of `start` up to the next match of `end`. */
function span(source: string, start: string, end: string) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a);
  if (a < 0 || b < 0 || source.includes(start, a + 1)) throw new Error(`Not found once: ${start}`);
  return source.slice(a, b);
}

/**
 * The render shaders without the electrodes, and with the code of before that reads the 3 × 3 cells of `shape`. These
 * give the files of `main` before ADR 0058 (a6ffe64) without their own code of the electrodes, byte for byte, on both
 * backends: that code never ran in a frame without a pole. view.glsl differs from that commit only by shapeTexel(),
 * which shapeAt() calls now.
 */
const WITHOUT_POLES = {
  wgsl: rewrite(renderWgsl, [
    [
      '// The outline distances of the electrodes (paint.wgsl POLES, ADR 0058); read for the electrodes only.\n' +
        '@group(0) @binding(16) var<storage, read> poles: array<u32>;\n',
      '',
    ],
    [span(renderWgsl, '// ---- Electrodes (ADR 0047', '// ---- Scent view (SCENT) ---'), ''],
    ['  if (ENV && V.streamFx.w != 0.0 && V.frame.z != 0u) { c = electrodes(c, p); }\n', ''],
    [
      span(
        renderWgsl,
        '// The 3 × 3 cells around cell c, row by row, each as shapeIndex() gives it:',
        '// The food distance (cells) in a cell of `shape`.',
      ),
      `// The 3 × 3 cells of \`shape\` around cell c, row by row: the cells the spline reads at a point in c. As
// shapeIndex(), but the columns and rows are wrapped or clamped once.
fn shapeCells(c: vec2i) -> array<u32, 9> {
  let s = size();
  var w: array<u32, 9>;
  if (V.boundary == 2u) {
    let m = vec2f(c) + 0.5 - 0.5 * vec2f(s);
    let rim = DISH_FILL * 0.5 * f32(min(s.x, s.y));
    if (dot(m, m) > (rim - 1.5) * (rim - 1.5)) {
      // Near the rim: some of the 3 × 3 cells may lie outside the dish.
      for (var j = 0; j < 3; j++) {
        for (var i = 0; i < 3; i++) { w[j * 3 + i] = shape[shapeIndex(c + vec2i(i - 1, j - 1))]; }
      }
      return w;
    }
  }
  var xs = clamp(vec3i(c.x - 1, c.x, c.x + 1), vec3i(0), vec3i(s.x - 1));
  var ys = clamp(vec3i(c.y - 1, c.y, c.y + 1), vec3i(0), vec3i(s.y - 1));
  if (V.boundary == 0u) {
    let q = wrapCell(c, s);
    xs = vec3i(select(q.x - 1, s.x - 1, q.x == 0), q.x, select(q.x + 1, 0, q.x == s.x - 1));
    ys = vec3i(select(q.y - 1, s.y - 1, q.y == 0), q.y, select(q.y + 1, 0, q.y == s.y - 1));
  }
  for (var j = 0; j < 3; j++) {
    for (var i = 0; i < 3; i++) { w[j * 3 + i] = shape[ys[j] * s.x + xs[i]]; }
  }
  return w;
}

`,
    ],
  ]),
  glsl: rewrite(renderFrag, [
    [span(renderFrag, '#if ENV\n// ---- Electrodes (see render.wgsl', '#ifdef SLIME\n// ---- The slime'), ''],
    ['  if (V.streamFx.w != 0.0 && V.frame.z != 0u) c = electrodes(c, p);\n', ''],
    [
      span(
        renderFrag,
        '// The texels of the 3 × 3 cells around c, row by row, each as shapeTexel() gives it',
        '// `cells`: the 3 × 3 cells of `shape` around the cell under p, row by row (see envAt in render.wgsl).',
      ),
      `// The 3 × 3 cells of \`shape\` around c, row by row (see shapeCells in render.wgsl).
void shapeCells(ivec2 c, out vec4 cells[9]) {
  ivec2 s = gridSize();
  if (V.boundary == 2u) {
    vec2 m = vec2(c) + 0.5 - 0.5 * vec2(s);
    float rim = DISH_FILL * 0.5 * float(min(s.x, s.y));
    if (dot(m, m) > (rim - 1.5) * (rim - 1.5)) {
      for (int j = 0; j < 3; j++) {
        for (int i = 0; i < 3; i++) cells[j * 3 + i] = shapeAt(c + ivec2(i - 1, j - 1));
      }
      return;
    }
  }
  ivec3 xs;
  ivec3 ys;
  around(c, xs, ys);
  xs = clamp(xs, ivec3(0), ivec3(s.x - 1));
  ys = clamp(ys, ivec3(0), ivec3(s.y - 1));
  for (int j = 0; j < 3; j++) {
    for (int i = 0; i < 3; i++) cells[j * 3 + i] = texelFetch(shape, ivec2(xs[i], ys[j]), 0);
  }
}

`,
    ],
  ]),
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
/** The largest difference of a channel between two colours in bytes. */
const off = (a: number[], b: number[]) => Math.max(...a.map((v, k) => Math.abs(v - (b[k] ?? 0))));
/** The colour of the pixel (x, y) of a capture, as bytes. */
const pixel = (img: ImageData, x: number, y: number) => [
  ...img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 3),
];
/** The largest difference of one channel between two captures. */
function maxDiff(a: ImageData, b: ImageData) {
  let max = 0;
  for (let i = 0; i < a.data.length; i++)
    if (i % 4 !== 3) max = Math.max(max, Math.abs((a.data[i] ?? 0) - (b.data[i] ?? 0)));
  return max;
}

/** What a pixel of a picture with electrodes shows, by the CPU reference. */
const PART = {
  /** Outside the arena, at its edge, or on a dimmed copy of a periodic lattice. */
  space: 0,
  /** No pole within the reach of the outline distances: the picture without the electrodes. */
  far: 1,
  /** Beside a pole, with no shadow to speak of (below 0.02). */
  beside: 2,
  /** In the shadow of a pole. */
  shadow: 3,
  /** On the outline of one pole: the pole covers a part of the pixel, and the ground the rest. */
  edge: 4,
  /** On the seam of two poles: each covers a part of the pixel. */
  seam: 5,
  /** On a pole, on the dark line along its outline. */
  line: 6,
  /** On the slope of a pole, inside the line. */
  slope: 7,
  /** On the flat top of a pole. */
  top: 8,
  /** Not compared: the picture below the electrodes is not known there. */
  skip: 9,
} as const;
type Part = keyof typeof PART;
const PARTS = Object.keys(PART) as Part[];

/** The picture of the CPU, 3 bytes per pixel, and what each pixel shows. */
interface Picture {
  want: Uint8Array;
  part: Uint8Array;
  /** The share of each pixel that the two poles cover together. */
  cover: Float32Array;
}

/**
 * The picture of a simulation with electrodes on the CPU, as render.wgsl `fs` draws it. Inside the arena: what lies
 * below the electrodes, with the electrodes over it (electrode-reference.ts). Outside it the free space, with a ramp
 * one pixel wide between them. Around a periodic lattice the copies of the grid show dimmed (ADR 0026).
 *
 * `poles`: the outline distances of the electrodes, as Sim.readPoles() returns them. `below`: a capture of the same
 * state, settings and view without the electrodes. Without it the simulation holds no trail, food, light or wall, and
 * the ground of the style lies below the electrodes. With it two kinds of pixels do not compare (PART.skip). A pixel
 * at the edge of the arena: the capture holds the ramp there already. And a pixel in the shadow or on the outline of
 * a pole where a channel of the capture is at an end of its range (0 or 255, or one beside it with the dither): the
 * pass cut the colour there, so what the pole mixes with is not known. `ties`: cells whose pixels do not compare
 * either (onOutline() in outline-reference.ts), wherever the view reads such a cell as the cell under a pixel.
 */
function pictureOf(
  poles: Uint8Array,
  [w, h]: readonly [number, number],
  settings: Settings,
  view: View,
  [cw, ch]: readonly [number, number],
  below?: ImageData,
  ties?: ReadonlySet<number>,
): Picture {
  const want = new Uint8Array(cw * ch * 3);
  const part = new Uint8Array(cw * ch);
  const cover = new Float32Array(cw * ch);
  const { style, boundary } = settings;
  const grid: OutlineGrid = { width: w, height: h, boundary };
  const bg = hexToLinear(BACKGROUND[style]);
  const space = bg.map((v) => v * (style === 'paper' ? 0.92 : 0.55)) as Rgb;
  const ramp = (sd: number) => smoothstep(-0.5 * view.scale, 0.5 * view.scale, sd);
  const copies = settings.lattice && boundary === 'wrap' ? LATTICE_COPIES : 1;
  const line = Math.min(0.75, Math.max(0.35, 1.5 * view.scale));
  for (let y = 0; y < ch; y++)
    for (let x = 0; x < cw; x++) {
      const i = y * cw + x;
      const [px, py] = [
        (x + 0.5 - cw / 2) * view.scale + view.center[0],
        (y + 0.5 - ch / 2) * view.scale + view.center[1],
      ];
      const box = ramp(Math.min(px, py, w - px, h - py));
      const inside =
        boundary === 'wrap'
          ? 1
          : boundary === 'box'
            ? box
            : ramp(dishRadius(w, h) - Math.hypot(px - w / 2, py - h / 2));
      const whole = inside >= 1 && (copies >= 1 || box >= 1);
      let c = space;
      const under = below ? pixel(below, x, y) : undefined;
      if (under && !whole) part[i] = PART.skip;
      else if (inside > 0) {
        const inner = electrodesOver(under ? (under.map(fromByte) as Rgb) : bg, poles, grid, px, py, view.scale, style);
        c = inside >= 1 ? inner : mix(space, inner, inside);
        if (whole) {
          const s = polesAt(poles, grid, px, py, view.scale, style);
          const { cathode, anode } = s;
          const { layers } = outlineAt(poles, grid, px, py);
          const sd = cathode.cover >= anode.cover ? layers[0].sd : layers[1].sd;
          cover[i] = s.cover;
          part[i] = !s.near
            ? PART.far
            : cathode.cover > 0 && anode.cover > 0
              ? PART.seam
              : s.cover >= 1
                ? sd >= POLE_RIM
                  ? PART.top
                  : sd >= line
                    ? PART.slope
                    : PART.line
                : s.cover > 0
                  ? PART.edge
                  : Math.max(cathode.shadow, anode.shadow) > 0.02
                    ? PART.shadow
                    : PART.beside;
          if (under?.some((v) => v <= 1 || v >= 254) && s.near && s.cover < 1) part[i] = PART.skip;
        }
        // The cell whose bytes the view reads as the cell under the pixel.
        if (ties?.has(outlineCell(grid, Math.floor(px), Math.floor(py)))) part[i] = PART.skip;
      }
      // A copy dims the light that the screen shows: the light ends at 1 first.
      if (copies < 1) c = mix(mix(space, c.map((v) => Math.min(Math.max(v, 0), 1)) as Rgb, copies), c, box);
      for (let k = 0; k < 3; k++) want[i * 3 + k] = toByte(c[k] ?? 0);
    }
  return { want, part, cover };
}

/** Per part of a picture: its pixels, and the largest difference of a channel between the capture and the picture. */
function compare(img: ImageData, { want, part }: Picture) {
  const found = Object.fromEntries(PARTS.map((p) => [p, { pixels: 0, apart: 0 }])) as Record<
    Part,
    { pixels: number; apart: number }
  >;
  let apart = 0;
  for (let i = 0; i < img.width * img.height; i++) {
    const of = found[at(PARTS, part[i] ?? 0)];
    of.pixels++;
    if (part[i] === PART.skip) continue;
    for (let k = 0; k < 3; k++) {
      const d = Math.abs((img.data[i * 4 + k] ?? 0) - (want[i * 3 + k] ?? 0));
      of.apart = Math.max(of.apart, d);
      apart = Math.max(apart, d);
    }
  }
  return { ...found, apart };
}

describe.each(Object.entries(BACKENDS))('the picture of the electrodes on %s', (kind, create) => {
  let backend: Backend;
  const live: Sim[] = [];
  const [W, H] = [64, 48];

  /** Plain ground: no living agent, so no trail, and no bloom. */
  const plain = (patch: Partial<Settings> = {}): Settings => ({
    ...defaultSettings(),
    layout: 'empty',
    boundary: 'box',
    strains: [defaultStrain(0)],
    bloom: 0,
    ...patch,
  });

  beforeAll(async () => {
    backend = await create(document.createElement('canvas'));
    // The first pole builds the outline pass of the poles: here, under a long timeout (ADR 0010).
    const sim = await backend.createSim(plain(), 16, 16, 1);
    sim.paint([{ kind: 'cathode', from: [8, 8], to: [8, 8], radius: 2 }]);
    await sim.finish();
    sim.destroy();
  }, 600_000);
  beforeEach(() => {
    // No levels of an earlier test: a frame without them draws the trail with the same gain on every run.
    backend.forget();
  });
  afterEach(() => {
    for (const s of live.splice(0)) s.destroy();
  });
  afterAll(() => {
    backend.destroy();
  });

  async function make(settings: Settings, agents = 1, w = W, h = H) {
    const sim = await backend.createSim(settings, w, h, agents);
    live.push(sim);
    return sim;
  }

  const dab = (kind: Stroke['kind'], x: number, y: number, radius: number): Stroke => ({
    kind,
    from: [x, y],
    to: [x, y],
    radius,
  });
  const line = (kind: Stroke['kind'], from: [number, number], to: [number, number], radius: number): Stroke => ({
    kind,
    from,
    to,
    radius,
  });

  /** 8 pixels per cell on a canvas of 512 × 384 pixels: the pixel (8 c, 8 r) has its centre on that of cell (c, r). */
  const CLOSE: View = { center: [32.4375, 24.4375], scale: 1 / 8 };
  const CLOSE_SIZE = [512, 384] as const;
  /** The index of the pixel of CLOSE whose centre lies on the centre of cell (x, y). */
  const centre = (x: number, y: number) => 8 * y * 512 + 8 * x;
  /** The pixel of CLOSE that holds the grid position g of one axis, in cells. */
  const near = (g: number) => Math.round(8 * g - 4);

  /**
   * A capture against the picture of the CPU, from the bytes that the simulation holds. Where the spline at the
   * centre of a cell lies exactly on an outline, float32 can decide the side of that centre otherwise than the CPU
   * (onOutline()): the pixels of such a cell do not compare. A scene has few of them.
   */
  async function shot(
    sim: Sim,
    settings: Settings,
    view: View = CLOSE,
    size: readonly [number, number] = CLOSE_SIZE,
    below?: ImageData,
  ) {
    const poles = await sim.readPoles();
    const grid: OutlineGrid = { width: sim.width, height: sim.height, boundary: settings.boundary };
    const ties = new Set<number>();
    for (let y = 0; y < sim.height; y++)
      for (let x = 0; x < sim.width; x++)
        for (const layer of [0, 1]) if (onOutline(poles, grid, x, y, layer)) ties.add(y * sim.width + x);
    expect(ties.size, 'cells with the spline exactly on an outline').toBeLessThan(16);
    const img = await backend.capture(sim, settings, view, size[0], size[1]);
    const picture = pictureOf(poles, [sim.width, sim.height], settings, view, size, below, ties);
    const found = compare(img, picture);
    const report = PARTS.map((p) => `${p} ${String(found[p].pixels)} pixels, ${String(found[p].apart)} apart`).join(
      '; ',
    );
    return { img, picture, poles, grid, report, ...found };
  }

  /** The cells whose centre the picture draws on another side of an outline than `env` holds, by the CPU reference. */
  async function offSide(sim: Sim, boundary: Boundary) {
    const [env, poles] = [await sim.readEnv(), await sim.readPoles()];
    const grid: OutlineGrid = { width: sim.width, height: sim.height, boundary };
    const wrong: string[] = [];
    /** Per pole: the cells that hold it, and those of them that the spline alone would leave outside. */
    const cells = { cathode: 0, anode: 0, bumped: 0 };
    for (let y = 0; y < sim.height; y++)
      for (let x = 0; x < sim.width; x++) {
        if (
          boundary === 'dish' &&
          Math.hypot(x + 0.5 - sim.width / 2, y + 0.5 - sim.height / 2) > dishRadius(sim.width, sim.height)
        )
          continue;
        const b = env[(y * sim.width + x) * 4 + 3] ?? 0;
        const holds = [b > 191, b > 0 && b <= 191];
        const { layers } = outlineAt(poles, grid, x + 0.5, y + 0.5);
        layers.forEach((layer, l) => {
          const held = holds[l] ?? false;
          if (held) cells[l === 0 ? 'cathode' : 'anode']++;
          if (held && layer.sd <= 0) cells.bumped++;
          if (held !== layer.coverSd > 0)
            wrong.push(
              `${l === 0 ? 'cathode' : 'anode'} at ${String(x)},${String(y)}: env ${String(b)}, ${layer.coverSd.toFixed(4)}`,
            );
        });
      }
    return { wrong, ...cells };
  }

  // The flat top of a stud, in closed form (studAt() in render.wgsl): the light from above on the colour of the pole,
  // and what is left of the highlight there.
  const flatTop = (base: readonly number[]) => {
    const half = Math.hypot(SUN[0], SUN[1], SUN[2] + 1);
    return base.map((v) => v * (0.5 + 0.7 * SUN[2]) + 0.6 * ((SUN[2] + 1) / half) ** 60) as Rgb;
  };

  // A wide dab of each pole, a line with a flat top, the dabs of the scene Electrotaxis (1.5 cells) on a corner of
  // four cells and on the centre of a cell, a thin line and a dab of 2.5 cells. 8 pixels per cell: the line along an
  // outline is 0.35 cells wide there.
  it.each(STYLES)(
    'draws the flat top, the slope, the line and the shadow of a pole as the CPU reference does (%s)',
    async (style) => {
      const settings = plain({ style });
      const sim = await make(settings);
      sim.paint([
        dab('cathode', 14.3, 14.2, 6),
        line('anode', [30, 8], [52, 16], 3),
        dab('anode', 12, 36, 1.5),
        dab('cathode', 20.5, 36.5, 1.5),
        line('cathode', [28, 30], [44, 40], 0.75),
        dab('anode', 52, 34, 2.5),
      ]);
      const found = await shot(sim, settings);
      // The dither moves a channel by 1, and float32 rounds the last digit otherwise.
      expect(found.apart, found.report).toBeLessThanOrEqual(2);
      // Every part of a pole is in the picture.
      expect(found.top.pixels, 'top').toBeGreaterThan(4000);
      expect(found.slope.pixels, 'slope').toBeGreaterThan(4000);
      expect(found.line.pixels, 'line').toBeGreaterThan(1500);
      expect(found.edge.pixels, 'edge').toBeGreaterThan(400);
      expect(found.shadow.pixels, 'shadow').toBeGreaterThan(3000);
      expect(found.far.pixels, 'far').toBeGreaterThan(40000);
      expect(found.seam.pixels, 'no pole meets the other one here').toBe(0);
      // Chosen points, in closed form. The middle of the wide cathode: its flat top.
      const { img } = found;
      const ground = bytes(hexToLinear(BACKGROUND[style]));
      expect(
        off(pixel(img, 8 * 14, 8 * 14), bytes(flatTop(POLE_COLOR.cathode))),
        'the top of the cathode',
      ).toBeLessThanOrEqual(1);
      // The middle line of the anode, 3 cells inside its outline.
      expect(
        off(pixel(img, 8 * 41, 8 * 12), bytes(flatTop(POLE_COLOR.anode))),
        'the top of the anode',
      ).toBeLessThanOrEqual(1);
      // The ground far from every pole.
      expect(off(pixel(img, 8 * 58, 8 * 44), ground), 'the ground').toBeLessThanOrEqual(1);
      // The rim: on the diagonal of the light, 0.75 cells inside the outline of the wide cathode, the side toward the
      // light (top left) is brighter than the flat top, and the side away from it is darker.
      const lumaAt = (cells: number) => {
        const [r = 0, g = 0, b = 0] = pixel(img, near(14.3 - 0.6 * cells), near(14.2 - 0.8 * cells));
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      expect(lumaAt(5.25) - lumaAt(0), 'the lit side').toBeGreaterThan(8);
      expect(lumaAt(0) - lumaAt(-5.25), 'the shaded side').toBeGreaterThan(10);
      // The shadow, 1 cell outside the outline on the side away from the light: half of the full shadow of the style,
      // which is as dark as the shadow of a wall. On paper it shows well; the dark grounds get a few levels darker.
      const shaded = pixel(img, near(14.3 + 0.6 * 7), near(14.2 + 0.8 * 7));
      const half = bytes(hexToLinear(BACKGROUND[style]).map((v) => v * (1 - 0.5 * POLE_SHADE[style])) as Rgb);
      expect(off(shaded, half), 'the shadow').toBeLessThanOrEqual(3);
      if (style === 'paper') expect(off(shaded, ground)).toBeGreaterThan(12);
      // No shadow on the side toward the light.
      const lit = pixel(img, near(14.3 - 0.6 * 7), near(14.2 - 0.8 * 7));
      expect(off(lit, ground), 'no shadow toward the light').toBeLessThanOrEqual(1);
    },
  );

  /**
   * Poles in the middle of a grid of 64 × 48 cells, across its left edge, across its bottom edge and in a corner: on
   * the periodic grid they go on across the seam. One lies across the rim of the dish.
   */
  const EDGES: Stroke[] = [
    dab('cathode', 0.4, 20.3, 4),
    line('anode', [30, 46.5], [36, 49.5], 2.5),
    dab('cathode', 63.2, 0.6, 3),
    dab('anode', 30.2, 22.3, 5),
    dab('cathode', 40, 26, 1.5),
    dab('anode', 11.5, 27.5, 3),
    line('cathode', [44, 8], [56, 14], 1),
  ];

  /**
   * Views of a grid of 64 × 48 cells on a canvas of 96 × 72 pixels: zoomed in at the left edge (in the dish at its
   * rim) and at the bottom edge, at 1 cell per pixel, and zoomed out, where the line along an outline is 0.75 cells
   * wide and a dab of 1.5 cells is smaller than a pixel.
   */
  const views = (boundary: Boundary): View[] => [
    { center: boundary === 'dish' ? [10.37, 24.21] : [1.37, 21.21], scale: 1 / 8 },
    { center: [32.3, 45.7], scale: 0.3 },
    { center: [32.3, 45.7], scale: 0.6 },
    { center: [32, 24], scale: 1 },
    { center: [32.21, 24.13], scale: 1.5 },
    { center: [30.9, 23.3], scale: 2.5 },
    { center: [33.1, 22.9], scale: 6 },
  ];
  const SIZE = [96, 72] as const;

  // The outline of a pole is a ramp one pixel wide at every zoom, and the cells that the view reads go on across the
  // seam of the periodic grid, stay inside a box, and lie inside the rim of the dish. Each view in two styles.
  it.each(BOUNDARIES)(
    'follows the CPU reference at every zoom, in every style and up to the edge of the arena (%s)',
    async (boundary) => {
      const base = plain({ boundary });
      const sim = await make(base);
      sim.paint(EDGES);
      const failed: string[] = [];
      let shown = 0;
      for (const [i, view] of views(boundary).entries())
        for (const turn of [0, 2]) {
          const style = at(STYLES, (i + turn) % STYLES.length);
          const settings = { ...base, style };
          const found = await shot(sim, settings, view, SIZE);
          const name = `${style} at ${String(view.scale)} cells per pixel`;
          if (found.apart > 2) failed.push(`${name}: ${String(found.apart)} apart`);
          const poled = found.top.pixels + found.slope.pixels + found.line.pixels + found.edge.pixels;
          if (poled === 0) failed.push(`${name}: no pixel of a pole`);
          shown += poled;
        }
      expect(failed).toEqual([]);
      expect(shown).toBeGreaterThan(3000);
    },
    120_000,
  );

  // Around a periodic lattice the copies of the grid show dimmed (ADR 0026), and the poles on them with the grid.
  it('draws the poles on the copies of a periodic lattice, dimmed with them', async () => {
    const base = plain({ boundary: 'wrap', lattice: [W, H] });
    const sim = await make(base);
    sim.paint(EDGES);
    const failed: string[] = [];
    for (const [i, scale] of [0.8, 1.6, 2.5, 4].entries())
      for (const lattice of [base.lattice, null]) {
        const settings = { ...base, lattice, style: at(STYLES, i % STYLES.length) };
        const view: View = { center: [33.3, 23.6], scale };
        const found = await shot(sim, settings, view, SIZE);
        // The copies lie beside the grid: they fill a part of the canvas from 1 cell per pixel on.
        const copies = lattice ? found.space.pixels : found.far.pixels;
        if (found.apart > 2 || (scale > 1 && copies < 1000))
          failed.push(`${String(scale)}, lattice ${String(lattice !== null)}: ${String(found.apart)} apart`);
      }
    expect(failed).toEqual([]);
  });

  // The spline of the view weighs the cell under a point only 0.5625 at its centre: a stroke thinner than a cell, or a
  // dab on a corner of four cells, would lose cells. The cover adds a bump there, as for walls and food (ADR 0009):
  // every cell centre is drawn on the side of the outline that `env` holds.
  it('draws every cell centre on the side of the outline that the environment holds', async () => {
    const settings = plain();
    const sim = await make(settings);
    const strokes: Stroke[] = [];
    // Lines of the thinnest brush at 12 angles, of both poles, and dabs of it on corners and on centres of cells.
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI;
      const [cx, cy] = [8.3 + 9.5 * (k % 6), k < 6 ? 10.2 : 26.7];
      const [dx, dy] = [3.6 * Math.cos(a), 3.6 * Math.sin(a)];
      strokes.push(line(k % 2 ? 'anode' : 'cathode', [cx - dx, cy - dy], [cx + dx, cy + dy], 0.75));
    }
    for (let k = 0; k < 10; k++)
      strokes.push(
        dab(k % 2 ? 'cathode' : 'anode', 6 + 5.5 * k + (k % 3 === 0 ? 0.5 : 0), 40 + (k % 3 === 1 ? 0.5 : 0), 0.75),
      );
    sim.paint(strokes);
    const found = await shot(sim, settings);
    expect(found.apart).toBeLessThanOrEqual(2);
    const side = await offSide(sim, 'box');
    expect(side.wrong).toEqual([]);
    expect(side.cathode).toBeGreaterThan(60);
    expect(side.anode).toBeGreaterThan(60);
    // The cells that the spline alone leaves outside their pole: the bump is at work.
    expect(side.bumped).toBeGreaterThan(20);
    // In the capture: the pixel on the centre of a cell of a pole shows the pole, far from the ground of the style.
    const env = await sim.readEnv();
    const ground = bytes(hexToLinear(BACKGROUND[settings.style]));
    const dull: string[] = [];
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        if ((env[(y * W + x) * 4 + 3] ?? 0) === 0) continue;
        const i = centre(x, y);
        if (off([...found.img.data.slice(i * 4, i * 4 + 3)], ground) < 60) dull.push(`${String(x)},${String(y)}`);
      }
    expect(dull).toEqual([]);
  });

  // A pole lies over everything, and it covers all of it (ADR 0058: an opacity of 1). Agents with their trail, food,
  // light and a wall below a wide cathode and a thick anode. The picture is the picture without the poles with the
  // poles over it, and where a pole covers a pixel, the pixel has the colour of the pole alone. The Slime tool coats
  // all ground first: the bare ground of the agents style is black, and a pixel with a channel at 0 does not compare
  // in the shadow of a pole (PART.skip). The slime of 40 steps has no film yet (ADR 0057).
  it.each(STYLES)(
    'covers all of what lies below it: the trail, the agents, the food, the light and a wall (%s)',
    async (style) => {
      const settings: Settings = {
        ...defaultSettings(),
        style,
        layout: 'mixed',
        density: 0.5,
        diffusion: 1,
        boundary: 'box',
        bloom: 0,
        seed: 7,
        strains: [defaultStrain(0), defaultStrain(1)],
      };
      const sim = await make(settings, (W * H) / 2);
      // The wall crosses the place of the cathode, and the anode lies on a part of the light.
      sim.paint([
        dab('slime', W / 2, H / 2, W),
        dab('food', 18, 16, 5),
        dab('light', 44, 30, 7),
        line('wall', [6, 24], [30, 30], 1.5),
      ]);
      sim.run(40);
      const below = await backend.capture(sim, settings, CLOSE, ...CLOSE_SIZE);
      sim.paint([dab('cathode', 20, 22, 9), line('anode', [36, 28], [56, 34], 4)]);
      const found = await shot(sim, settings, CLOSE, CLOSE_SIZE, below);
      // Two captures dither apart, and the picture below is known to a byte.
      expect(found.apart, found.report).toBeLessThanOrEqual(4);
      expect(found.skip.pixels).toBeLessThan(found.shadow.pixels + found.edge.pixels);
      // Where a pole covers the pixel, the pixel is the surface of the pole: nothing of the picture below.
      const { img, picture, grid, poles } = found;
      let [covered, other, worst] = [0, 0, 0];
      for (let y = 0; y < CLOSE_SIZE[1]; y++)
        for (let x = 0; x < CLOSE_SIZE[0]; x++) {
          const i = y * CLOSE_SIZE[0] + x;
          if ((picture.cover[i] ?? 0) < 1) continue;
          const [px, py] = [(x + 0.5 - 256) / 8 + CLOSE.center[0], (y + 0.5 - 192) / 8 + CLOSE.center[1]];
          const surface = bytes(polesAt(poles, grid, px, py, CLOSE.scale, style).surface);
          covered++;
          worst = Math.max(worst, off(pixel(img, x, y), surface));
          if (off(pixel(below, x, y), surface) > 40) other++;
        }
      expect(worst).toBeLessThanOrEqual(2);
      expect(covered).toBeGreaterThan(20000);
      // Most of what lay below the poles had another colour: the trail, the flake of food, the light and the wall.
      expect(other).toBeGreaterThan(covered / 2);
    },
    120_000,
  );

  // The scent view lies below the walls, and the electrodes lie over everything.
  it('covers the scent view', async () => {
    const settings: Settings = { ...plain({ foodStrength: 0.5 }), showScent: true };
    const sim = await make(settings);
    sim.paint([dab('food', 20, 22, 4), dab('food', 40, 30, 3)]);
    sim.run(30);
    const below = await backend.capture(sim, settings, CLOSE, ...CLOSE_SIZE);
    // The scent glows where the poles will lie.
    expect(off(pixel(below, 8 * 27, 8 * 22), bytes(hexToLinear(BACKGROUND[settings.style])))).toBeGreaterThan(20);
    sim.paint([dab('cathode', 27, 22, 5), dab('anode', 36, 26, 3)]);
    const found = await shot(sim, settings, CLOSE, CLOSE_SIZE, below);
    expect(found.apart).toBeLessThanOrEqual(4);
    expect(off(pixel(found.img, 8 * 27, 8 * 22), bytes(flatTop(POLE_COLOR.cathode)))).toBeLessThanOrEqual(1);
    expect(found.top.pixels).toBeGreaterThan(2000);
  });

  // A cell holds one pole, the one painted last. Where a pole meets the other one, each covers its share of a pixel
  // and no ground shows between them: the pole below ends where the stroke that took its cells begins (paint.wgsl
  // POLES). Small dabs and thin lines of one pole over a wide dab of the other, and the same with the poles swapped.
  // The surface of a pole is the same in every style, and the ground is not: a pixel that shows no ground has the
  // same colour on the light paper and on the dark ground of the glow style.
  it('shows no ground on the seam between a pole and the other pole painted over it', async () => {
    const [paper, glow] = [plain({ style: 'paper' }), plain({ style: 'glow' })];
    const sim = await make(paper);
    const over = (wide: 'cathode' | 'anode', thin: 'cathode' | 'anode', x: number): Stroke[] => [
      dab(wide, x, 24, 13),
      dab(thin, x - 4, 15, 1.5),
      dab(thin, x + 4.3, 14.2, 1),
      dab(thin, x + 0.5, 19.5, 0.75),
      dab(thin, x - 5.4, 20.7, 2),
      line(thin, [x - 8, 25], [x + 8, 28], 0.75),
      line(thin, [x - 7, 30.5], [x + 7, 33], 1.5),
      dab(thin, x, 37, 2.5),
    ];
    sim.paint([...over('cathode', 'anode', 16.2), ...over('anode', 'cathode', 47.3)]);
    const [found, dark] = [await shot(sim, paper), await shot(sim, glow)];
    expect(found.apart, found.report).toBeLessThanOrEqual(2);
    expect(dark.apart, dark.report).toBeLessThanOrEqual(2);
    // The pixels within 10 cells of the middle of a wide dab: every one lies on the wide dab or on a stroke over it.
    const { picture } = found;
    const bare: string[] = [];
    let [inner, seams] = [0, 0];
    for (let y = 0; y < CLOSE_SIZE[1]; y++)
      for (let x = 0; x < CLOSE_SIZE[0]; x++) {
        const i = y * CLOSE_SIZE[0] + x;
        const [px, py] = [(x + 0.5 - 256) / 8 + CLOSE.center[0], (y + 0.5 - 192) / 8 + CLOSE.center[1]];
        if (Math.min(Math.hypot(px - 16.2, py - 24), Math.hypot(px - 47.3, py - 24)) > 10) continue;
        inner++;
        if (picture.part[i] === PART.seam) seams++;
        const at = `${String(x)},${String(y)}`;
        // The cover of the CPU is not that of the GPU in a cell with the spline exactly on an outline (shot()).
        if (picture.part[i] !== PART.skip && (picture.cover[i] ?? 0) < 0.995)
          bare.push(`${at}: the poles cover ${String(picture.cover[i])}`);
        const apart = off(pixel(found.img, x, y), pixel(dark.img, x, y));
        if (apart > 2) bare.push(`${at}: ${String(apart)} apart on paper and on the dark ground`);
      }
    expect(inner).toBeGreaterThan(38000);
    expect(seams).toBeGreaterThan(1000);
    expect(bare.slice(0, 20)).toEqual([]);
    // The paper and the dark ground differ by far more than that where the ground shows.
    expect(off(pixel(found.img, 4, 4), pixel(dark.img, 4, 4))).toBeGreaterThan(200);
  });

  // An erase and a wall take their cells from a pole, and a pole takes its cells from the other pole. The picture
  // follows after every stroke. A second simulation gets the strokes that are no poles: its picture lies below.
  it('follows an erase, a wall and the other pole through a pole', async () => {
    const settings = plain({ style: 'paper' });
    const [sim, twin] = [await make(settings), await make(settings)];
    const steps: [string, Stroke][] = [
      ['two poles', dab('cathode', 20, 24, 9)],
      ['two poles', dab('anode', 46, 24, 9)],
      ['an erase', line('erase', [10, 18], [32, 31], 1.5)],
      ['a wall', line('wall', [36, 31], [58, 18], 1.5)],
      ['the other pole', dab('anode', 24, 30, 4)],
      ['the other pole', dab('cathode', 50, 16, 3)],
    ];
    for (const [name, stroke] of steps) {
      sim.paint([stroke]);
      if (stroke.kind !== 'cathode' && stroke.kind !== 'anode') twin.paint([stroke]);
      const below = await backend.capture(twin, settings, CLOSE, ...CLOSE_SIZE);
      const found = await shot(sim, settings, CLOSE, CLOSE_SIZE, below);
      expect(found.apart, name).toBeLessThanOrEqual(4);
      expect((await offSide(sim, 'box')).wrong, name).toEqual([]);
    }
    const img = await backend.capture(sim, settings, CLOSE, ...CLOSE_SIZE);
    const blank = await backend.capture(twin, settings, CLOSE, ...CLOSE_SIZE);
    const [blue, red] = [bytes(flatTop(POLE_COLOR.cathode)), bytes(flatTop(POLE_COLOR.anode))];
    // The cathode beside the erased line is whole, and the erased line shows the paper.
    expect(off(pixel(img, 8 * 14, 8 * 28), blue), 'the cathode').toBeLessThanOrEqual(1);
    expect(off(pixel(img, 8 * 21, 8 * 24) /* on the erased line */, blue), 'the erased line').toBeGreaterThan(60);
    expect(Math.min(...pixel(img, 8 * 21, 8 * 24)), 'the erased line').toBeGreaterThan(150);
    // The wall through the anode is the wall of the picture below, in the faint shadow of the anode beside it.
    expect(off(pixel(img, 8 * 47, 8 * 24), pixel(blank, 8 * 47, 8 * 24)), 'the wall').toBeLessThanOrEqual(10);
    expect(off(pixel(img, 8 * 47, 8 * 24), red), 'the wall').toBeGreaterThan(60);
    // Each pole over a part of the other one.
    expect(off(pixel(img, 8 * 24, 8 * 30), red), 'the anode on the cathode').toBeLessThanOrEqual(1);
    expect(off(pixel(img, 8 * 50, 8 * 16), blue), 'the cathode on the anode').toBeLessThanOrEqual(1);
  }, 120_000);

  // Clear frees the outline distances, and the next pole makes them again (ADR 0058): the picture reads the buffer
  // that the simulation holds now. On WebGPU a bind group with a freed buffer is an error of the device.
  it('draws no pole after Clear, and the next pole from the buffer that the simulation holds then', async () => {
    const settings = plain({ style: 'gel' });
    const sim = await make(settings);
    const device = kind === 'webgpu' ? (backend as WebGpuBackend).gpu.device : undefined;
    device?.pushErrorScope('validation');
    const none = new Uint8Array(W * H * 4);
    const bare = pictureOf(none, [W, H], settings, CLOSE, CLOSE_SIZE);
    expect(compare(await backend.capture(sim, settings, CLOSE, ...CLOSE_SIZE), bare).apart).toBeLessThanOrEqual(1);
    sim.paint([dab('cathode', 20, 24, 8), dab('anode', 44, 24, 6)]);
    const first = await shot(sim, settings);
    expect(first.apart).toBeLessThanOrEqual(2);
    expect(first.top.pixels).toBeGreaterThan(8000);
    sim.clearEnvironment();
    expect(sim.hasElectrodes).toBe(false);
    expect((await sim.readPoles()).some((v) => v !== 0)).toBe(false);
    expect(compare(await backend.capture(sim, settings, CLOSE, ...CLOSE_SIZE), bare).apart).toBeLessThanOrEqual(1);
    // A new pole at another place: the picture shows it, and nothing of the poles before the Clear.
    sim.paint([dab('anode', 32, 30, 5)]);
    const second = await shot(sim, settings);
    expect(second.apart).toBeLessThanOrEqual(2);
    expect(second.top.pixels).toBeGreaterThan(1500);
    const ground = bytes(hexToLinear(BACKGROUND[settings.style]));
    expect(off(pixel(second.img, 8 * 20, 8 * 20), ground), 'the place of the first cathode').toBeLessThanOrEqual(1);
    expect(off(pixel(second.img, 8 * 32, 8 * 30), bytes(flatTop(POLE_COLOR.anode)))).toBeLessThanOrEqual(1);
    // Twice more: every Clear frees a buffer, and every first pole makes one.
    for (const x of [14, 50]) {
      sim.clearEnvironment();
      sim.paint([dab('cathode', x, 14, 4)]);
      expect((await shot(sim, settings)).apart).toBeLessThanOrEqual(2);
    }
    expect((await device?.popErrorScope())?.message).toBeUndefined();
  }, 120_000);

  // A reset and a switch of the model leave `env`, and both models have the electrodes: the poles stay in the picture.
  it('keeps the poles in the picture over a reset and over a switch of the model', async () => {
    const extended = plain();
    const jones: Settings = { ...extended, model: 'jones', collisions: true };
    const sim = await make(extended);
    sim.paint([dab('cathode', 20, 24, 8), line('anode', [36, 14], [52, 34], 2)]);
    const before = await shot(sim, extended);
    expect(before.apart).toBeLessThanOrEqual(2);
    expect(before.top.pixels).toBeGreaterThan(5000);
    sim.reset();
    const reset = await shot(sim, extended);
    expect(reset.apart).toBeLessThanOrEqual(2);
    expect(maxDiff(reset.img, before.img)).toBeLessThanOrEqual(2);
    if (!backend.supportsCollisions) return; // the Jones model needs one agent per cell
    sim.update(jones);
    sim.reset();
    const switched = await shot(sim, jones);
    expect(switched.apart).toBeLessThanOrEqual(2);
    expect(maxDiff(switched.img, before.img)).toBeLessThanOrEqual(2);
    sim.update(extended);
    sim.reset();
    expect(maxDiff((await shot(sim, extended)).img, before.img)).toBeLessThanOrEqual(2);
  }, 120_000);

  // The boundary can change while `env` stays. The outline distances are then held to `env` under the new boundary,
  // and the picture reads them: a dish cuts the poles at its rim, and the periodic grid joins them across its seam.
  it('follows the outlines after a change of boundary', async () => {
    const base = plain({ style: 'paper' });
    const sim = await make(base);
    sim.paint(EDGES);
    let last: ImageData | undefined;
    for (const boundary of ['box', 'dish', 'wrap', 'box'] as const) {
      const settings = { ...base, boundary };
      sim.update(settings);
      sim.reset();
      for (const view of [CLOSE, at(views(boundary), 0)]) {
        const found = await shot(sim, settings, view, view === CLOSE ? CLOSE_SIZE : SIZE);
        expect(found.apart, `${boundary} at ${String(view.center)}`).toBeLessThanOrEqual(2);
        expect(found.top.pixels + found.slope.pixels, boundary).toBeGreaterThan(300);
        if (view === CLOSE) {
          // Another arena shows another picture.
          if (last) expect(maxDiff(found.img, last), boundary).toBeGreaterThan(40);
          last = found.img;
        }
      }
      expect((await offSide(sim, boundary)).wrong, boundary).toEqual([]);
    }
  }, 120_000);

  // Sim.writeEnv (tests only) writes bytes. The outline distances are held to them, and the picture draws every cell
  // of a pole: the bytes up to 191 as an anode, above it as a cathode.
  it('follows an environment written as bytes', async () => {
    const settings = plain();
    const sim = await make(settings);
    sim.paint([dab('cathode', 30, 20, 6)]);
    const env = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        if (x >= 8 && x < 40 && y >= 10 && y < 13) env[i + 3] = 255;
        if (x >= 8 && x < 40 && y === 20) env[i + 3] = [1, 128, 191, 192][x % 4] ?? 0;
        if (Math.hypot(x - 50.3, y - 30.2) < 5.7) env[i + 3] = 128;
      }
    sim.writeEnv(env);
    const found = await shot(sim, settings);
    expect(found.apart).toBeLessThanOrEqual(2);
    const side = await offSide(sim, 'box');
    expect(side.wrong).toEqual([]);
    const held = (is: (b: number) => boolean) => env.filter((b, i) => i % 4 === 3 && is(b)).length;
    expect([side.cathode, side.anode]).toEqual([held((b) => b > 191), held((b) => b > 0 && b <= 191)]);
    expect(side.cathode).toBe(32 * 3 + 8);
    expect(side.anode).toBeGreaterThan(24 + 90);
    // The row of single cells: three red cells, then a blue one. And nothing of the dab from before the write.
    const hue = (x: number, y: number) => {
      const [r = 0, , b = 0] = pixel(found.img, 8 * x, 8 * y);
      return b - r;
    };
    expect([hue(12, 20), hue(13, 20), hue(14, 20), hue(15, 20)].map((v) => Math.sign(Math.round(v / 40)))).toEqual([
      -1, -1, -1, 1,
    ]);
    expect(off(pixel(found.img, 8 * 30, 8 * 24), bytes(hexToLinear(BACKGROUND[settings.style])))).toBeLessThanOrEqual(
      1,
    );
  });

  // ADR 0058: a frame of a simulation without a pole reads no outline distances of the electrodes. Against the shaders
  // of before, with the same state, uniforms and dither: 0 of 255 apart. With agents and their trail, and with food,
  // light and walls or without them, in every arena and style, zoomed in at the rim and zoomed out.
  it('draws the pixels of the shaders of before for a frame without a pole, in every style', async () => {
    const looks = (boundary: Boundary): View[] => [at(views(boundary), 0), { center: [32.4, 24.6], scale: 2.5 }];
    const cases: { sim: Sim; settings: Settings; view: View; name: string }[] = [];
    for (const boundary of BOUNDARIES)
      for (const painted of [false, true]) {
        const base: Settings = {
          ...defaultSettings(),
          boundary,
          layout: 'mixed',
          density: 0.5,
          diffusion: 1,
          bloom: 0,
          seed: 5,
          strains: [defaultStrain(0), defaultStrain(1)],
          // The renderer of a test draws no layer of the slime and no skirt of the growth front (render.ts `fixed`).
          showSlime: false,
          showFront: false,
        };
        const sim = await make(base, (W * H) / 2);
        if (painted)
          sim.paint([
            dab('food', 4, 22, 5),
            dab('light', 44, 30, 6),
            line('wall', [20, 30], [30, 34], 1.5),
            line('wall', [1, 12], [1, 30], 1),
            dab('food', 30, 46.5, 3),
          ]);
        sim.run(20);
        expect([sim.hasEnvironment, sim.hasElectrodes]).toEqual([painted, false]);
        const lattices = boundary === 'wrap' && painted ? [null, [W, H] as [number, number]] : [null];
        for (const lattice of lattices)
          for (const style of STYLES)
            for (const view of looks(boundary))
              cases.push({
                sim,
                settings: { ...base, lattice, style },
                view,
                name: `${boundary}, ${style} at ${String(view.scale)}${painted ? ', painted' : ''}`,
              });
      }
    const captures = async () => {
      const out: ImageData[] = [];
      for (const c of cases) out.push(await backend.capture(c.sim, c.settings, c.view, 64, 48));
      return out;
    };
    const hook = backend as WebGpuBackend | WebGl2Backend;
    onTestFinished(() => {
      hook.renderFrom();
    });
    // A new WebGPU renderer counts frames from 0, so both runs dither alike; WebGL2 captures keep the frame.
    const device = kind === 'webgpu' ? (backend as WebGpuBackend).gpu.device : undefined;
    device?.pushErrorScope('validation');
    hook.renderFrom(kind === 'webgpu' ? WITHOUT_POLES.wgsl : WITHOUT_POLES.glsl);
    const before = await captures();
    hook.renderFrom();
    const now = await captures();
    expect((await device?.popErrorScope())?.message).toBeUndefined();
    const apart = now.map((img, i) => maxDiff(img, before[i] ?? img));
    expect(cases.length).toBe(56);
    expect(
      Math.max(...apart),
      cases
        .filter((_, i) => (apart[i] ?? 0) > 0)
        .map((c) => c.name)
        .join('; '),
    ).toBe(0);
    // The same frames after a pole in every simulation differ: both runs dither alike.
    for (const sim of new Set(cases.map((c) => c.sim)))
      sim.paint([dab('cathode', 2.5, 21.5, 2.5), dab('cathode', 12, 24, 4), dab('anode', 34, 26, 5)]);
    hook.renderFrom();
    const poled = await captures();
    expect(poled.map((img, i) => maxDiff(img, before[i] ?? img)).filter((d) => d < 30)).toEqual([]);
  }, 240_000);

  // The electrodes of the picture are a part of the picture alone. Two simulations from one seed with the same poles,
  // one drawn in every style after every few steps and one never drawn: the same bytes everywhere.
  it('changes no byte of the simulation', async () => {
    const settings: Settings = {
      ...defaultSettings(),
      layout: 'mixed',
      density: 0.5,
      diffusion: 1,
      boundary: 'box',
      bloom: 0,
      seed: 11,
      strains: [defaultStrain(0), defaultStrain(1)],
    };
    const [viewed, never] = [await make(settings, 800), await make(settings, 800)];
    const strokes = [dab('cathode', 20, 20, 6), line('anode', [40, 10], [44, 30], 1.5), dab('wall', 30, 40, 3)];
    for (const sim of [viewed, never]) sim.paint(strokes);
    for (let k = 0; k < 6; k++) {
      viewed.run(5);
      never.run(5);
      backend.draw(viewed, settings, { center: [32, 24], scale: 0.5 }, true);
      for (const style of STYLES) await backend.capture(viewed, { ...settings, style }, at(views('box'), k), 32, 24);
    }
    const state = async (sim: Sim) => ({
      agents: await sim.readAgents(),
      trail: Array.from(await sim.readTrail()),
      scent: Array.from(await sim.readScent()),
      env: Array.from(await sim.readEnv()),
      shape: Array.from(await sim.readShape()),
      poles: Array.from(await sim.readPoles()),
      slime: Array.from(await sim.readSlime()),
      step: sim.step,
    });
    const [a, b] = [await state(viewed), await state(never)];
    expect(a.poles.filter((v) => v >= 128).length).toBeGreaterThan(150);
    expect(a.scent.some((v) => v > 0)).toBe(true);
    expect(a).toEqual(b);
  }, 120_000);
});
