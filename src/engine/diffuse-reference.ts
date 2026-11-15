// CPU reference of the mean of the diffusion (shaders/diffuse.wgsl, gl/glsl/diffuse.frag) over a window of any odd
// side, for tests only (ADR 0046). It holds the mean twice: over the window as Jones' papers state it, and as the two
// dispatches of a window above 3 × 3 compute it. sim.gpu.test.ts checks both backends against the first, and
// diffuse-reference.test.ts checks that the two agree.
import type { Boundary, StepOrder } from '../model/params';
import { cellIndex } from './brush';

/** What a cell is to the mean (diffuse.wgsl): a sink holds 0 and counts 0; a wall diffuses but takes no source. */
export const CellKind = { sink: 0, open: 1, wall: 2 } as const;

/** A grid with the kind of each of its cells. */
export interface MeanGrid {
  w: number;
  h: number;
  boundary: Boundary;
  /** The CellKind of every cell of the rectangle; a cell outside a closed arena is a sink. */
  kinds: Uint8Array;
}

/**
 * The kinds of the cells of a grid. `env`: 4 bytes per cell as Sim.readEnv() returns them, the first the wall byte.
 * `wallsDiffuse`: a wall is part of the lattice, as in the Jones model; else it is a sink, as in the extended model.
 */
export function meanGrid(env: Uint8Array, w: number, h: number, boundary: Boundary, wallsDiffuse: boolean): MeanGrid {
  const kinds = Uint8Array.from({ length: w * h }, (_, c) => {
    if (cellIndex(c % w, Math.floor(c / w), w, h, boundary) < 0) return CellKind.sink;
    if ((env[c * 4] ?? 0) < 128) return CellKind.open;
    return wallsDiffuse ? CellKind.wall : CellKind.sink;
  });
  return { w, h, boundary, kinds };
}

/** The index of the cell (x, y) of the rectangle: wrapped on the periodic grid, −1 outside the rectangle otherwise. */
function rectIndex(g: MeanGrid, x: number, y: number): number {
  return cellIndex(x, y, g.w, g.h, g.boundary === 'wrap' ? 'wrap' : 'box');
}

/** The value of cell c as the mean reads it: 0 in a sink and outside the rectangle. */
const read = (map: Float64Array, g: MeanGrid, c: number) => (c < 0 || g.kinds[c] === CellKind.sink ? 0 : (map[c] ?? 0));

/**
 * The mean over the window of `window` × `window` cells around every cell, as the papers state it (Tsuda, Jones et
 * al. 2011, p. 10: "the mean of a 15x15 pixel window"), with the rules of the 3 × 3 mean of this app (ADR 0027): a
 * sink counts 0, the divisor is the number of cells of the window at every site, and a sink holds 0.
 */
export function windowMean(map: Float64Array, g: MeanGrid, window: number): Float64Array {
  const r = (window - 1) / 2;
  return map.map((_, c) => {
    if (g.kinds[c] === CellKind.sink) return 0;
    const [x, y] = [c % g.w, Math.floor(c / g.w)];
    let sum = 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) sum += read(map, g, rectIndex(g, x + dx, y + dy));
    return sum / (window * window);
  });
}

/**
 * The same mean as the two dispatches of a window above 3 × 3 compute it (diffuse.wgsl `box`): the sum along the row
 * of the window at every cell of the rectangle, a sink too; then the sum of those sums along the column of the
 * window, over the cells of the window, and 0 in a sink.
 */
export function separableMean(map: Float64Array, g: MeanGrid, window: number): Float64Array {
  const r = (window - 1) / 2;
  const rows = map.map((_, c) => {
    const [x, y] = [c % g.w, Math.floor(c / g.w)];
    let sum = 0;
    for (let dx = -r; dx <= r; dx++) sum += read(map, g, rectIndex(g, x + dx, y));
    return sum;
  });
  return map.map((_, c) => {
    if (g.kinds[c] === CellKind.sink) return 0;
    const [x, y] = [c % g.w, Math.floor(c / g.w)];
    let sum = 0;
    for (let dy = -r; dy <= r; dy++) {
      const q = rectIndex(g, x, y + dy);
      if (q >= 0) sum += rows[q] ?? 0;
    }
    return sum / (window * window);
  });
}

/**
 * One step of one lane of the map with one diffusion pass, after the moves (docs/model.md, section 6.2): the mean
 * over the window, then the decay (`keep` = 1 − decay). `source`: the deposits and the food or light of the step at a
 * cell; only open cells take it, after the decay moving first and before the mean sensing first.
 */
export function meanStep(
  map: Float64Array,
  g: MeanGrid,
  window: number,
  keep: number,
  source: (c: number) => number,
  stepOrder: StepOrder,
  mean: typeof windowMean = windowMean,
): Float64Array {
  const sources = map.map((_, c) => (g.kinds[c] === CellKind.open ? source(c) : 0));
  if (stepOrder === 'sense-first') {
    const withSources = map.map((v, c) => v + (sources[c] ?? 0));
    return mean(withSources, g, window).map((v) => keep * v);
  }
  return mean(map, g, window).map((v, c) => keep * v + (sources[c] ?? 0));
}
