// Pictures of the tubes from saved states of the real engine (engine/dump.gpu.test.ts with VITE_DUMP_P=1), on the
// CPU: the trail as the view draws it without the picture of the tubes, the strength of the tubes, and the picture of
// the tubes (ADR 0034). This script was used to choose the rule before the shaders were written, and it keeps the
// rules that were rejected, so that their pictures can be made again.
//
// Usage: node --import ./research/flow/register.mjs research/flow/view/tubes.ts <name> <step>
//
// Environment:
// - RULE: `app` (default) is the rule of the app, from src/engine/tubes-reference.ts. `largest`: the largest value
//   of the discs, trail times weight, in place of the mean of the trails by weight. `fresh`: fresh ground as the
//   zero point. `bright`: the factor on the brightness alone, no radius.
// - WINDOW (1): with RULE=largest, the strength across a tube is the sum over a square of 2 WINDOW + 1 cells, over
//   2 WINDOW + 1 cells of length; REF (1): the strength that gets the largest radius.
// - PANELS: which pictures, side by side: trail, strength, view (default: all three). CROP: the part of the grid
//   that a picture shows, as x,y,width,height in cells (default: the whole grid). SCALE: pixels per cell (2).
// - BOUNDARY: wrap, box or dish, for a state whose dump does not name the boundary of its grid.
//
// The size of the grid and its boundary come from the file <name>.jsonl that the dump writes, so a state needs no
// other setting. The strain is the first one. The walls are the cells of a wall in the environment bytes of the dump:
// the rule of the app asks only which cells are walls (tubes-reference.ts).
import { existsSync, readFileSync } from 'node:fs';
import { FLOW } from '../../../src/engine/flow.ts';
import { TUBES, TUBE_REACH, TUBE_WINDOW } from '../../../src/engine/tubes.ts';
import { tubePicture, tubeRoots, type TubeGrid } from '../../../src/engine/tubes-reference.ts';
import type { Boundary } from '../../../src/model/params.ts';
import { outDir } from '../prototype/out.ts';
import { writePng } from '../prototype/world.ts';

const DIR = process.env.DIR ?? outDir('engine/');
const OUT = outDir('view/');
const name = process.argv[2] ?? 'g-tk-i1.4-s1';
const step = Number(process.argv[3] ?? 8000);
const RULE = process.env.RULE ?? 'app';
const WINDOW = Number(process.env.WINDOW ?? 1);
const REF = Number(process.env.REF ?? 1);
const SCALE = Number(process.env.SCALE ?? 2);

const floats = (file: string) =>
  new Float32Array(new Uint8Array(Buffer.from(readFileSync(DIR + file, 'utf8'), 'base64')).buffer);
/** The grid of the state: the dump writes a line for each step, with the size of the grid and its boundary. */
function gridOf(): { w: number; h: number; boundary: Boundary } {
  const file = `${DIR}${name}.jsonl`;
  if (!existsSync(file)) throw new Error(`no file ${file}: the dump of a state writes it`);
  const line = readFileSync(file, 'utf8')
    .split('\n')
    .filter((text) => text.trim() !== '')
    .map((text) => JSON.parse(text) as { step?: number; w?: number; h?: number; boundary?: string })
    .find((row) => row.step === step);
  if (!line?.w || !line.h) throw new Error(`${file} has no line for step ${String(step)}`);
  const boundary = process.env.BOUNDARY ?? line.boundary;
  if (boundary !== 'wrap' && boundary !== 'box' && boundary !== 'dish')
    throw new Error(`${file} does not name the boundary of the grid: make the state again, or set BOUNDARY`);
  return { w: line.w, h: line.h, boundary };
}
const { w: W, h: H, boundary: BOUNDARY } = gridOf();
const trail = floats(`${name}-trail-${String(step)}.f32.b64`);
const memory = floats(`${name}-memory-${String(step)}.f32.b64`);
const n = W * H;
if (trail.length !== n || memory.length !== n * 4)
  throw new Error(`the state ${name} at step ${String(step)} does not have ${String(W)} × ${String(H)} cells`);
const D = Float32Array.from({ length: n }, (_, i) => memory[i * 4] ?? 0);
const B = Float32Array.from({ length: n }, (_, i) => memory[i * 4 + 1] ?? 0);
/** The strength of the tube of a cell: its body times its flow memory, and 0 on a cell without a tube. */
const S = Float32Array.from({ length: n }, (_, i) => ((B[i] ?? 0) >= FLOW.bodyLow ? (B[i] ?? 0) * (D[i] ?? 0) : 0));

/** The wall bytes of `shape` from the environment of the dump, if it has one: 128 on every cell of a wall. */
function shapeOf(): Uint8Array {
  const shape = new Uint8Array(n * 4);
  const file = `${DIR}${name}-env.u8.b64`;
  if (!existsSync(file)) return shape;
  const env = new Uint8Array(Buffer.from(readFileSync(file, 'utf8'), 'base64'));
  for (let c = 0; c < n; c++) if ((env[c * 4] ?? 0) >= 128) shape[c * 4] = 128;
  return shape;
}

/** The first lane of a field of 4 lanes per cell, and a field of 4 lanes with `lane0` as its first. */
const first = (f: Float32Array) => Float32Array.from({ length: n }, (_, i) => f[i * 4] ?? 0);
const lanes = (lane0: Float32Array) => {
  const f = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) f[i * 4] = lane0[i] ?? 0;
  return f;
};

const GRID: TubeGrid = { width: W, height: H, boundary: BOUNDARY, shape: shapeOf() };
/** The factor of the radius of every cell by the rule of the app: the first lane of the pass `roots`. */
const FACTOR = first(tubeRoots(GRID, [memory]));

/** The rule of the app (ADR 0034, decisions 2 and 3). */
function app(): Float32Array {
  return first(tubePicture(GRID, lanes(trail), tubeRoots(GRID, [memory])));
}

/** The mean of a field over a square of 2 k + 1 cells. */
function mean(f: Float32Array, k: number): Float32Array {
  const out = new Float32Array(n);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let sum = 0;
      for (let dy = -k; dy <= k; dy++)
        for (let dx = -k; dx <= k; dx++) {
          const [qx, qy] = [x + dx, y + dy];
          if (qx >= 0 && qy >= 0 && qx < W && qy < H) sum += f[qy * W + qx] ?? 0;
        }
      out[y * W + x] = sum / (2 * k + 1) ** 2;
    }
  return out;
}

/** The factor of every cell: the fourth root of the strength across the tube, with a window and a reference. */
const rootsOf = () => mean(S, WINDOW).map((v) => Math.min(1, ((2 * WINDOW + 1) * v) / REF) ** 0.25);

/**
 * Rejected: the largest value of the discs, trail times weight. `radius` false: the factor on the brightness of the
 * cell alone (RULE=bright).
 */
function largest(radius: boolean): Float32Array {
  const root = rootsOf();
  const out = new Float32Array(n);
  const window = radius ? TUBE_WINDOW : 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let best = TUBES.sheet * (trail[y * W + x] ?? 0);
      for (let dy = -window; dy <= window; dy++)
        for (let dx = -window; dx <= window; dx++) {
          const [qx, qy] = [x + dx, y + dy];
          const d = Math.hypot(dx, dy);
          if (qx < 0 || qy < 0 || qx >= W || qy >= H || d >= TUBE_REACH) continue;
          const q = qy * W + qx;
          const rho = root[q] ?? 0;
          const cover = radius ? Math.min(1, Math.max(0, (TUBES.radius * rho + TUBES.edge / 2 - d) / TUBES.edge)) : 1;
          best = Math.max(best, (trail[q] ?? 0) * rho * cover);
        }
      out[y * W + x] = best;
    }
  return out;
}

/**
 * Rejected: fresh ground as the zero point. A tube with the flow memory of fresh ground looks as the trail alone.
 * With less it is fainter, by the fourth root of the ratio and down to the sheet. With more it is wider, by up to 3
 * cells at a flow memory of 1. The flow memory of a cell is the largest over the 3 × 3 cells with a tube around it.
 */
function fresh(): Float32Array {
  const top = (1 / FLOW.fresh) ** 0.25;
  const root = new Float32Array(n).fill(1);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const c = y * W + x;
      if ((B[c] ?? 0) < FLOW.bodyLow) continue;
      let best = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const [qx, qy] = [x + dx, y + dy];
          if (qx < 0 || qy < 0 || qx >= W || qy >= H) continue;
          if ((B[qy * W + qx] ?? 0) >= FLOW.bodyLow) best = Math.max(best, D[qy * W + qx] ?? 0);
        }
      root[c] = (best / FLOW.fresh) ** 0.25;
    }
  const out = new Float32Array(n);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let best = 0;
      for (let dy = -3; dy <= 3; dy++)
        for (let dx = -3; dx <= 3; dx++) {
          const [qx, qy] = [x + dx, y + dy];
          if (qx < 0 || qy < 0 || qx >= W || qy >= H) continue;
          const q = qy * W + qx;
          const rho = root[q] ?? 1;
          const extra = (3 * Math.max(0, rho - 1)) / (top - 1);
          const cover = Math.min(1, Math.max(0, extra + 1 - Math.hypot(dx, dy)));
          best = Math.max(best, (trail[q] ?? 0) * Math.min(1, Math.max(TUBES.sheet, rho)) * cover);
        }
      out[y * W + x] = best;
    }
  return out;
}

/** The level that `fraction` of all cells exceed. */
function levelAbove(field: Float32Array, fraction: number): number {
  const sorted = Float32Array.from(field).sort();
  return sorted[Math.min(n - 1, Math.floor(n * (1 - fraction)))] ?? 0;
}

/** The glow style of the app without its bloom: the levels of exposure.ts, 1 − e^(−radiance) per channel, sRGB. */
function glow(field: Float32Array): Uint8Array {
  const white = levelAbove(field, 0.01);
  const black = Math.min(levelAbove(field, 0.35), 0.8 * white);
  const gain = 1.3 / Math.max(white - black, 1e-20);
  const colour = [1.0, 0.72, 0.12];
  const back = [0.012, 0.014, 0.02];
  const rgb = new Uint8Array(n * 3);
  for (let c = 0; c < n; c++) {
    const v = Math.max((field[c] ?? 0) - black, 0) * gain;
    for (let k = 0; k < 3; k++) {
      const l = 1 - Math.exp(-v * (colour[k] ?? 0));
      const lin = (back[k] ?? 0) + (1 - (back[k] ?? 0)) * l;
      const s = lin <= 0.0031308 ? 12.92 * lin : 1.055 * lin ** (1 / 2.4) - 0.055;
      rgb[c * 3 + k] = Math.round(255 * Math.min(1, Math.max(0, s)));
    }
  }
  return rgb;
}

/** The strength of the tubes on a log scale from 0.0001 (blue) to 1 (yellow), on the cells that hold trail. */
function strengthMap(): Uint8Array {
  const rgb = new Uint8Array(n * 3);
  for (let c = 0; c < n; c++) {
    if ((trail[c] ?? 0) < 0.05) continue;
    const v = Math.min(1, Math.max(0, (Math.log10(Math.max(S[c] ?? 0, 1e-4)) + 4) / 4));
    rgb[c * 3] = Math.round(255 * Math.min(1, 2 * v));
    rgb[c * 3 + 1] = Math.round(255 * v * v);
    rgb[c * 3 + 2] = Math.round(255 * Math.max(0, 1 - 3 * v) * 0.6 + 40 * (1 - v));
  }
  return rgb;
}

const crop = (process.env.CROP ?? `0,0,${String(W)},${String(H)}`).split(',').map(Number) as [
  number,
  number,
  number,
  number,
];
/** The pictures side by side, cropped. */
function panels(pictures: Uint8Array[]): { w: number; h: number; rgb: Uint8Array } {
  const [cx, cy, cw, ch] = crop;
  const gap = 4;
  const w = pictures.length * cw + (pictures.length - 1) * gap;
  const rgb = new Uint8Array(w * ch * 3).fill(60);
  pictures.forEach((p, k) => {
    for (let y = 0; y < ch; y++)
      for (let x = 0; x < cw; x++)
        for (let j = 0; j < 3; j++) rgb[(y * w + k * (cw + gap) + x) * 3 + j] = p[((cy + y) * W + cx + x) * 3 + j] ?? 0;
  });
  return { w, h: ch, rgb };
}

/** The picture `scale` times as large, with the bilinear filter that the app uses when it is zoomed in. */
function enlarge(p: { w: number; h: number; rgb: Uint8Array }, scale: number) {
  const [w, h] = [p.w * scale, p.h * scale];
  const rgb = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [fx, fy] = [(x + 0.5) / scale - 0.5, (y + 0.5) / scale - 0.5];
      const [x0, y0] = [Math.max(0, Math.floor(fx)), Math.max(0, Math.floor(fy))];
      const [x1, y1] = [Math.min(p.w - 1, x0 + 1), Math.min(p.h - 1, y0 + 1)];
      const [tx, ty] = [Math.min(1, Math.max(0, fx - x0)), Math.min(1, Math.max(0, fy - y0))];
      for (let j = 0; j < 3; j++) {
        const at = (qx: number, qy: number) => p.rgb[(qy * p.w + qx) * 3 + j] ?? 0;
        const top = at(x0, y0) * (1 - tx) + at(x1, y0) * tx;
        const low = at(x0, y1) * (1 - tx) + at(x1, y1) * tx;
        rgb[(y * w + x) * 3 + j] = Math.round(top * (1 - ty) + low * ty);
      }
    }
  return { w, h, rgb };
}

const RULES: Record<string, () => Float32Array> = {
  app,
  largest: () => largest(true),
  bright: () => largest(false),
  fresh,
};
const rule = RULES[RULE];
if (!rule) throw new Error(`no rule ${RULE}`);
const view = rule();

/** Some levels of the values of a field on the cells that `pick` takes. */
const levels = (f: Float32Array, pick: (c: number) => boolean) => {
  const v = [...f.keys()].filter(pick).map((c) => f[c] ?? 0);
  v.sort((a, b) => a - b);
  const at = (p: number) => +(v[Math.min(v.length - 1, Math.floor(p * v.length))] ?? 0).toPrecision(3);
  return { cells: v.length, p10: at(0.1), p50: at(0.5), p90: at(0.9), p99: at(0.99), max: at(1) };
};
/** The cells of a field above half its white level: the area of what the picture shows at more than half. */
const bright = (f: Float32Array) => {
  const half = 0.5 * levelAbove(f, 0.01);
  return f.reduce((count, v) => count + (v >= half ? 1 : 0), 0);
};
const tube = (c: number) => (B[c] ?? 0) >= FLOW.bodyLow;
/** The share of the cells with a tube whose flow memory is below that of fresh ground. */
const belowFresh = () => {
  const cells = [...D.keys()].filter(tube);
  return +(cells.filter((c) => (D[c] ?? 0) < FLOW.fresh).length / Math.max(cells.length, 1)).toFixed(3);
};
/**
 * How many cells wide a band of cells with a tube is. For every cell with a tube: the distance to the nearest cell
 * without one. Where that distance is a local maximum the cell lies on the middle line of a band, and the band is
 * about twice the distance less one cell wide.
 */
function bandWidth() {
  const RANGE = 14;
  const has = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && tube(y * W + x);
  const far = new Float32Array(n);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (!has(x, y)) continue;
      let best = RANGE + 1;
      for (let dy = -RANGE; dy <= RANGE; dy++)
        for (let dx = -RANGE; dx <= RANGE; dx++) if (!has(x + dx, y + dy)) best = Math.min(best, Math.hypot(dx, dy));
      far[y * W + x] = best;
    }
  const widths: number[] = [];
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const d = far[y * W + x] ?? 0;
      if (d === 0) continue;
      let ridge = true;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) if ((far[(y + dy) * W + x + dx] ?? 0) > d) ridge = false;
      if (ridge) widths.push(2 * d - 1);
    }
  widths.sort((a, b) => a - b);
  const at = (p: number) => +(widths[Math.min(widths.length - 1, Math.floor(p * widths.length))] ?? 0).toFixed(1);
  return { p10: at(0.1), p50: at(0.5), p90: at(0.9) };
}
console.log(
  JSON.stringify({
    name,
    step,
    rule: RULE,
    w: W,
    h: H,
    boundary: BOUNDARY,
    memoryOnTubes: levels(D, tube),
    belowFresh: belowFresh(),
    strengthOnTubes: levels(S, tube),
    factorOnTubes: levels(FACTOR, tube),
    bandWidth: bandWidth(),
    cellsAboveHalf: { trail: bright(trail), view: bright(view) },
  }),
);
const which = (process.env.PANELS ?? 'trail,strength,view').split(',');
const all: Record<string, () => Uint8Array> = {
  trail: () => glow(trail),
  strength: strengthMap,
  view: () => glow(view),
};
const out = enlarge(
  panels(
    which.map((k) => {
      const make = all[k];
      if (!make) throw new Error(`no panel ${k}`);
      return make();
    }),
  ),
  SCALE,
);
const variant = RULE === 'app' ? '' : `-w${String(WINDOW)}-ref${String(REF)}`;
const file = `${OUT}${name}-${String(step)}-${RULE}${variant}.png`;
writePng(file, out.w, out.h, out.rgb, 1);
console.log(file);
