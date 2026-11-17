// CPU mirror of the outlines that the renderer reads, for tests and for the measurements of research/electrode/ only:
// the outline pass of a stroke (shaders/paint.wgsl `outline`, gl/glsl/shape.frag), the pass that holds the bytes to
// the environment (`refresh`, shape.frag op 3), and the spline that rebuilds an outline from the bytes (render.wgsl
// and render.frag `envAt`). sim.gpu.test.ts checks both backends against the passes, for the outlines of walls and
// food and for those of the electrodes (ADR 0058); electrode.gpu.test.ts checks the picture against the spline.
import type { Boundary } from '../model/params';
import { dishRadius, outlineBox, paintBox, segmentDistance } from './brush';
import { SHAPE_RANGE, type EnvTool, type Stroke } from './types';

/** What a stroke of one kind does with the two layers of an outline buffer. */
export interface OutlineRule {
  /** The layer that the stroke unites with, and the slope in cells that the renderer lights there (`rounded`). */
  unite?: { layer: 0 | 1; slope: number };
  /** The layers that lose the cells of the stroke. */
  subtract: readonly (0 | 1)[];
  /**
   * The slope in cells by which the subtraction is rounded off, as a union is: the layer below then ends where a
   * union of that slope begins. Without it the subtraction takes the plain distance of the stroke.
   */
  cut?: number;
}
/** The rule of each kind of stroke for one buffer. A kind without a rule changes no byte of it. */
export type OutlineScheme = Partial<Record<EnvTool, OutlineRule>>;

/** The outlines of walls (layer 0) and food (layer 1): a wall replaces food, and an erase clears both (ADR 0009). */
export const SHAPE_SCHEME: OutlineScheme = {
  wall: { unite: { layer: 0, slope: 1.5 }, subtract: [1] },
  food: { unite: { layer: 1, slope: 2 }, subtract: [] },
  erase: { subtract: [0, 1] },
};

/**
 * The outlines of the electrodes (ADR 0058): the cathodes (layer 0) and the anodes (layer 1). A cell holds one pole,
 * the one painted last, so a pole takes its cells from the other pole. An erase and a wall clear both. Food and light
 * leave the poles. A pole and a wall fill the cells that they take, and the view draws them from the rounded bytes of
 * their union: their subtraction is rounded off by the same slope, so the pole below ends where the stroke begins.
 */
export const POLE_SCHEME: OutlineScheme = {
  cathode: { unite: { layer: 0, slope: 1.5 }, subtract: [1], cut: 1.5 },
  anode: { unite: { layer: 1, slope: 1.5 }, subtract: [0], cut: 1.5 },
  erase: { subtract: [0, 1] },
  wall: { subtract: [0, 1], cut: 1.5 },
};

/** A signed distance in cells as a byte (paint.wgsl `distanceByte`): the outline lies at 127.5. */
export const distanceByte = (sd: number) => Math.round((Math.min(1, Math.max(-1, sd / SHAPE_RANGE)) * 0.5 + 0.5) * 255);

/** Whether the cell (x, y) of the grid is a cell of the arena: the dish counts (common.wgsl `cellAt`). */
const inArena = (boundary: Boundary, w: number, h: number, x: number, y: number) =>
  boundary !== 'dish' || Math.hypot(x + 0.5 - w / 2, y + 0.5 - h / 2) <= dishRadius(w, h);

/**
 * The byte of k − 1.5 cells outside, with k the rings (Chebyshev, up to 5) from the cell (x, y) to the nearest cell
 * for which `is` holds; none: 0 (paint.wgsl `holdByte`). The cells of the grid count, wrapped on the periodic one; the
 * dish does not count here.
 */
function ringHold(boundary: Boundary, w: number, h: number, x: number, y: number, is: (cell: number) => boolean) {
  for (let k = 1; k <= 5; k++)
    for (let dy = -k; dy <= k; dy++)
      for (let dx = -k; dx <= k; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== k) continue;
        let [cx, cy] = [x + dx, y + dy];
        if (boundary === 'wrap') [cx, cy] = [((cx % w) + w) % w, ((cy % h) + h) % h];
        else if (cx < 0 || cy < 0 || cx >= w || cy >= h) continue;
        if (is(cy * w + cx)) return distanceByte(1.5 - k);
      }
  return 0;
}

/**
 * The bytes of an outline buffer after the strokes of `list`, 2 per cell (layer 0, layer 1), on a new buffer of zeros.
 * Per stroke: the clamped signed distance as a byte, a union by the maximum, a subtraction by the minimum with the
 * complement. Every byte is then held to the cells that hold its layer after the stroke: at least 128 where the cell
 * holds the layer, else at most 127 and at most the byte of k − 1.5 cells outside, with the nearest cell of the layer
 * k cells away (Chebyshev, up to 5 cells; none: 0), after subtractions at every cell of the stroke's outline box
 * (brush.ts outlineBox). The stroke's own byte, of a union and of a subtraction, is held in the same way to the cells
 * the stroke paints itself, at every cell it does not paint: the shaders skip that search where it cannot lower the
 * byte (paint.wgsl `ownHeld`), and this model never does. A cell is painted when its centre lies within the radius;
 * cells outside the arena keep their bytes, and a stroke outside a closed arena changes nothing.
 */
export function outlineModel(
  list: readonly Stroke[],
  boundary: Boundary,
  w: number,
  h: number,
  scheme: OutlineScheme = SHAPE_SCHEME,
): Uint8Array {
  const bytes = new Uint8Array(w * h * 2);
  const painted = new Uint8Array(w * h * 2);
  const own = new Uint8Array(w * h);
  const images = boundary === 'wrap' ? [-1, 0, 1] : [0];
  const holds = (x: number, y: number, layer: number) => painted[(y * w + x) * 2 + layer] === 1;
  const held = (b: number, x: number, y: number, layer: number) => {
    if (holds(x, y, layer)) return Math.max(b, 128);
    const v = Math.min(b, 127);
    return v === 0
      ? 0
      : Math.min(
          v,
          ringHold(boundary, w, h, x, y, (i) => painted[i * 2 + layer] === 1),
        );
  };
  const united = (old: number, s: number, x: number, y: number, layer: number) => {
    if (holds(x, y, layer)) return Math.max(old, s, 128);
    const u = Math.min(s, 127);
    return u <= old
      ? old
      : Math.max(
          old,
          Math.min(
            u,
            ringHold(boundary, w, h, x, y, (i) => own[i] === 1),
          ),
        );
  };
  for (const stroke of list) {
    const rule = scheme[stroke.kind];
    if (!rule) continue;
    const { from, to, radius } = stroke;
    // A stroke outside a closed arena paints no cell and gets no outline (sim.ts and gl/sim.ts paint()).
    if (!paintBox(stroke, w, h, boundary === 'wrap')) continue;
    // The cells the outline pass visits (brush.ts outlineBox), wrapped on the periodic grid.
    const [bx, by, bw, bh] = outlineBox(stroke, w, h, boundary === 'wrap') ?? [0, 0, 0, 0];
    const inBox = (x: number, y: number) =>
      boundary === 'wrap'
        ? (((x - bx) % w) + w) % w < bw && (((y - by) % h) + h) % h < bh
        : x >= bx && x < bx + bw && y >= by && y < by + bh;
    const distances = new Float64Array(w * h);
    own.fill(0);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let d = Infinity;
        for (const ox of images)
          for (const oy of images) d = Math.min(d, segmentDistance(x + 0.5 + ox * w, y + 0.5 + oy * h, from, to));
        distances[y * w + x] = d;
        if (!inArena(boundary, w, h, x, y) || d > radius) continue;
        const i = (y * w + x) * 2;
        if (rule.unite) painted[i + rule.unite.layer] = 1;
        for (const layer of rule.subtract) painted[i + layer] = 0;
        own[y * w + x] = 1;
      }
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (!inArena(boundary, w, h, x, y)) continue;
        const d = distances[y * w + x] ?? Infinity;
        const s = distanceByte(radius - d);
        // Unions round the distance off near the middle line of the stroke (paint.wgsl `rounded`).
        const rounded = (slope: number) => {
          const rho = Math.min(radius, Math.max(2 * slope - radius, 0));
          return distanceByte(radius - (d >= rho ? d : (d * d + rho * rho) / (2 * rho)));
        };
        const i = (y * w + x) * 2;
        // A subtraction's byte, held to the cells the stroke paints where it does not paint this one.
        const plain = rule.cut === undefined ? s : rounded(rule.cut);
        const t =
          own[y * w + x] === 1
            ? plain
            : Math.min(
                plain,
                ringHold(boundary, w, h, x, y, (c) => own[c] === 1),
              );
        if (rule.unite) {
          const { layer, slope } = rule.unite;
          bytes[i + layer] = united(bytes[i + layer] ?? 0, rounded(slope), x, y, layer);
        }
        if (inBox(x, y))
          for (const layer of rule.subtract)
            bytes[i + layer] = held(Math.min(bytes[i + layer] ?? 0, 255 - t), x, y, layer);
      }
  }
  return bytes;
}

/**
 * The bytes of an outline buffer after the pass that holds them to the environment under `boundary` (paint.wgsl
 * `refresh`, shape.frag op 3): it runs after a change of boundary, after strokes under another boundary, and after
 * bytes written into the environment. `old`: the bytes before, 2 per cell (layer 0, layer 1). `holds`: whether a
 * cell of the grid holds a layer in the environment.
 *
 * A cell outside the arena keeps its bytes. A cell that holds a layer gets at least 128. Any other byte gets at most
 * 127 and at most the byte of k − 1.5 cells outside, with the nearest cell of the layer k rings away on the grid (up
 * to 5; none: 0). And it gets at least the byte of d cells outside, with the nearest cell of the layer in the arena d
 * cells away between the cell centres, up to 3 rings (none: 0): the outline runs between the two cells.
 */
export function refreshModel(
  old: Uint8Array,
  holds: (cell: number, layer: number) => boolean,
  boundary: Boundary,
  w: number,
  h: number,
): Uint8Array {
  const out = old.slice();
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!inArena(boundary, w, h, x, y)) continue;
      const i = (y * w + x) * 2;
      for (const layer of [0, 1]) {
        const b = old[i + layer] ?? 0;
        if (holds(y * w + x, layer)) {
          out[i + layer] = Math.max(b, 128);
          continue;
        }
        const v = Math.min(b, 127);
        const kept =
          v === 0
            ? 0
            : Math.min(
                v,
                ringHold(boundary, w, h, x, y, (c) => holds(c, layer)),
              );
        // The nearest cell of the layer in the arena, up to 3 rings away.
        let near = Infinity;
        for (let dy = -3; dy <= 3; dy++)
          for (let dx = -3; dx <= 3; dx++) {
            if (dx === 0 && dy === 0) continue;
            let [cx, cy] = [x + dx, y + dy];
            if (boundary === 'wrap') [cx, cy] = [((cx % w) + w) % w, ((cy % h) + h) % h];
            else if (cx < 0 || cy < 0 || cx >= w || cy >= h || !inArena(boundary, w, h, cx, cy)) continue;
            if (holds(cy * w + cx, layer)) near = Math.min(near, Math.hypot(dx, dy));
          }
        out[i + layer] = Math.max(kept, near === Infinity ? 0 : distanceByte(-near));
      }
    }
  return out;
}

/** The grid of an outline buffer as the view reads it. */
export interface OutlineGrid {
  width: number;
  height: number;
  boundary: Boundary;
}

/**
 * The cell of an outline buffer that stands for the grid cell (x, y) in the view (render.wgsl `shapeIndex`): wrapped
 * on the periodic grid, else clamped to the grid, so an outline that touches the edge of a closed arena stays whole up
 * to it. A cell outside the dish reads the cell inside the rim on the way to the centre.
 */
export function outlineCell({ width: w, height: h, boundary }: OutlineGrid, x: number, y: number): number {
  if (boundary === 'wrap') return (((y % h) + h) % h) * w + (((x % w) + w) % w);
  let [qx, qy] = [Math.min(w - 1, Math.max(0, x)), Math.min(h - 1, Math.max(0, y))];
  if (boundary === 'dish') {
    const [mx, my] = [x + 0.5 - w / 2, y + 0.5 - h / 2];
    const [rim, far] = [dishRadius(w, h), Math.hypot(mx, my)];
    if (far > rim)
      [qx, qy] = [Math.floor(w / 2 + (mx * (rim - 0.75)) / far), Math.floor(h / 2 + (my * (rim - 0.75)) / far)];
  }
  return qy * w + qx;
}

/** One layer of an outline buffer at a point, as the view rebuilds it. */
export interface OutlineSample {
  /** The signed distance to the outline in cells, positive inside: the spline, which the light of a surface reads. */
  sd: number;
  /** The same for the coverage: set right at the centre of the cell under the point (`wallCover` in render.wgsl). */
  coverSd: number;
  /** The gradient of `sd`, about 1 long beside an outline. */
  grad: [number, number];
}

/**
 * The two layers of an outline buffer at the grid position (px, py), in cells, as the view rebuilds them (render.wgsl
 * `envAt`), and whether any of the 3 × 3 cells that it reads holds a byte above 0 (`near`). `bytes`: the buffer, with
 * `stride` bytes per cell, the two layers first (4 as Sim.readShape() and Sim.readPoles() return them, 2 as
 * outlineModel() does).
 *
 * The distance is a quadratic B-spline over the 3 × 3 cells around the cell under the point, each as outlineCell()
 * gives it. Along a straight outline the distance is linear, and the spline gives it exactly. The spline weighs the
 * cell under the point only 0.5625 at its centre. So where the cell's own byte lies on the other side of the outline
 * than the spline at the centre of the cell, `coverSd` adds a bump: the cell's own distance at its centre, fading to
 * nothing at the edges of the cell. Every cell centre is then drawn on the side of the outline that the buffer holds.
 */
export function outlineAt(
  bytes: Uint8Array,
  grid: OutlineGrid,
  px: number,
  py: number,
  stride = 4,
): { layers: [OutlineSample, OutlineSample]; near: boolean } {
  const [cx, cy] = [Math.floor(px), Math.floor(py)];
  const [ux, uy] = [px - 0.5 - cx, py - 0.5 - cy];
  const spline = (u: number) => [0.5 * (0.5 - u) * (0.5 - u), 0.75 - u * u, 0.5 * (0.5 + u) * (0.5 + u)];
  const slope = (u: number) => [u - 0.5, -2 * u, u + 0.5];
  const CENTRE = [0.125, 0.75, 0.125];
  const [wx, wy, sx, sy] = [spline(ux), spline(uy), slope(ux), slope(uy)];
  const side = (1 - 4 * ux * ux) * (1 - 4 * uy * uy);
  const k = 2 * SHAPE_RANGE;
  let near = false;
  const cells: number[] = [];
  for (let j = 0; j < 3; j++)
    for (let i = 0; i < 3; i++) {
      const c = outlineCell(grid, cx + i - 1, cy + j - 1) * stride;
      cells.push(c);
      for (let b = 0; b < stride; b++) near ||= (bytes[c + b] ?? 0) !== 0;
    }
  const layer = (l: number): OutlineSample => {
    let [v, gx, gy, centre] = [0, 0, 0, 0];
    for (let j = 0; j < 3; j++)
      for (let i = 0; i < 3; i++) {
        const s = (bytes[(cells[j * 3 + i] ?? 0) + l] ?? 0) / 255;
        v += (wx[i] ?? 0) * (wy[j] ?? 0) * s;
        gx += (sx[i] ?? 0) * (wy[j] ?? 0) * s;
        gy += (wx[i] ?? 0) * (sy[j] ?? 0) * s;
        centre += (CENTRE[i] ?? 0) * (CENTRE[j] ?? 0) * s;
      }
    const sd = (v - 0.5) * k;
    const own = ((bytes[(cells[4] ?? 0) + l] ?? 0) / 255 - 0.5) * k;
    const mid = (centre - 0.5) * k;
    const fix = own > 0 !== mid > 0 ? (own - mid) * side * side : 0;
    return { sd, coverSd: sd + fix, grad: [gx * k, gy * k] };
  };
  return { layers: [layer(0), layer(1)], near };
}

/** The share of a pixel that a shape covers, from its signed distance in cells: a ramp one pixel wide (`cover`). */
export function coverOf(sd: number, scale: number): number {
  const t = Math.min(1, Math.max(0, (sd + 0.5 * scale) / scale));
  return t * t * (3 - 2 * t);
}

/**
 * Whether the spline at the centre of the cell (x, y) lies exactly on the outline of `layer`: the sum of the 3 × 3
 * bytes with the weights of the centre is 127.5. Float32 on the GPU can then decide the side of the centre otherwise
 * than the CPU, and with it the bump of outlineAt(). A picture test asks that no cell of its scene is such a cell.
 */
export function onOutline(bytes: Uint8Array, grid: OutlineGrid, x: number, y: number, layer: number, stride = 4) {
  const weight = [1, 6, 1];
  let sum = 0;
  for (let j = 0; j < 3; j++)
    for (let i = 0; i < 3; i++)
      sum +=
        (weight[i] ?? 0) * (weight[j] ?? 0) * (bytes[outlineCell(grid, x + i - 1, y + j - 1) * stride + layer] ?? 0);
  // The weights are 1, 6 and 36 parts of 64: 127.5 · 64 = 8160.
  return sum === 8160;
}
