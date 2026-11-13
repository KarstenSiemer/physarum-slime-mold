// CPU mirror of the passes of the picture of the tubes (shaders/tubes.wgsl, gl/glsl/tubes.frag), for tests only:
// tubes.gpu.test.ts checks both backends against it. tubes.ts states the rule.
import type { Boundary } from '../model/params';
import { dishRadius } from './brush';
import { FLOW } from './flow';
import { TUBES, TUBE_REACH, TUBE_WINDOW } from './tubes';
import { SHAPE_RANGE } from './types';

/** The grid as the passes see it: 4 bytes per cell as Sim.readShape() returns them (the first is the wall byte). */
export interface TubeGrid {
  width: number;
  height: number;
  boundary: Boundary;
  shape: Uint8Array;
}

/** The index of the cell at (x, y) if it lies in the arena, wrapped on the periodic grid; else −1 (cellXY()). */
export function arenaCell(grid: TubeGrid, x: number, y: number): number {
  const { width: w, height: h, boundary } = grid;
  if (boundary === 'wrap') [x, y] = [((x % w) + w) % w, ((y % h) + h) % h];
  else if (x < 0 || y < 0 || x >= w || y >= h) return -1;
  if (boundary === 'dish' && Math.hypot(x + 0.5 - w / 2, y + 0.5 - h / 2) > dishRadius(w, h)) return -1;
  return y * w + x;
}

/** The distance of a cell to the outline of the walls, cells: 0 in a wall, at most SHAPE_RANGE (clearOf()). */
export const clearOf = (grid: TubeGrid, c: number) =>
  Math.max(0, (1 - (2 * (grid.shape[c * 4] ?? 0)) / 255) * SHAPE_RANGE);

/**
 * The pass `roots`: per cell and strain (4 values per cell) the fourth root of the strength across the tube.
 * `memories`: the memory of the flow of each strain, 4 values per cell as Sim.readFlow() returns them.
 */
export function tubeRoots(grid: TubeGrid, memories: readonly Float32Array[]): Float32Array {
  const { width: w, height: h } = grid;
  const out = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = arenaCell(grid, x, y);
      if (p < 0) continue;
      memories.slice(0, 4).forEach((memory, s) => {
        let sum = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const q = arenaCell(grid, x + dx, y + dy);
            if (q < 0) continue;
            const [d, body] = [memory[q * 4] ?? 0, memory[q * 4 + 1] ?? 0];
            if (body >= FLOW.bodyLow) sum += d * body;
          }
        out[p * 4 + s] = Math.sqrt(Math.sqrt(Math.min(sum / TUBES.span, 1)));
      });
    }
  return out;
}

/**
 * The pass `picture`: the trail that the view draws, 4 lanes per cell. `trail`: the trail of the view without the
 * tubes (Sim.readView()); `roots`: the result of tubeRoots().
 */
export function tubePicture(grid: TubeGrid, trail: Float32Array, roots: Float32Array): Float32Array {
  const { width: w, height: h } = grid;
  const out = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = arenaCell(grid, x, y);
      if (p < 0) continue;
      const here = clearOf(grid, p);
      // Per strain, of the discs that reach the cell: the largest weight, the sum of the weights, and the sum of the
      // trails by weight.
      const [top, sum, lit] = [
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ];
      for (let dy = -TUBE_WINDOW; dy <= TUBE_WINDOW; dy++)
        for (let dx = -TUBE_WINDOW; dx <= TUBE_WINDOW; dx++) {
          const d = Math.hypot(dx, dy);
          if (d >= TUBE_REACH) continue;
          const q = arenaCell(grid, x + dx, y + dy);
          if (q < 0) continue;
          // A wall lies on the line between the cells, or one of them is a wall.
          if (here + clearOf(grid, q) <= d) continue;
          for (let s = 0; s < 4; s++) {
            const root = roots[q * 4 + s] ?? 0;
            const cover = Math.min(1, Math.max(0, (TUBES.radius * root + TUBES.edge / 2 - d) / TUBES.edge));
            const weight = root * cover;
            top[s] = Math.max(top[s] ?? 0, weight);
            sum[s] = (sum[s] ?? 0) + weight;
            lit[s] = (lit[s] ?? 0) + (trail[q * 4 + s] ?? 0) * weight;
          }
        }
      for (let s = 0; s < 4; s++) {
        // The tube: the strongest disc, with the mean trail of the cells whose discs reach the cell.
        const tube = ((top[s] ?? 0) * (lit[s] ?? 0)) / Math.max(sum[s] ?? 0, 1e-20);
        out[p * 4 + s] = Math.max(TUBES.sheet * (trail[p * 4 + s] ?? 0), tube);
      }
    }
  return out;
}
