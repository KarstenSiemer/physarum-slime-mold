// CPU mirror of the slime field (shaders/slime.wgsl, gl/glsl/slime.frag; ADR 0055, decision 3) and of the brush on it
// (shaders/slime-paint.wgsl, gl/glsl/slime-paint.frag; decision 7), for tests only: slime.gpu.test.ts checks both
// backends against it, and the engine tests in Node paint with it (cpu-backend.ts). It states the rule from the
// settings, without the code that packs them for the passes: the level of a strain is the low level of its trail
// (flow.ts trailLevels()), as a 32-bit float, because the passes compare 32-bit floats.
import type { Settings } from '../model/params';
import { trailLevels } from './flow';
import { openCell, type FlowGrid } from './flow-reference';
import { strokeCells } from './paint-reference';
import { NO_STAMP, slimeModel, slimeSteps, stampOf } from './slime';
import type { Stroke } from './types';

/** The settings that the rule reads. */
export type SlimeSettings = Pick<Settings, 'model' | 'slimeLife' | 'strains' | 'stepOrder'>;

/**
 * Whether the cell (x, y) holds plasm: it is open (inside the arena, no wall), and the trail of at least one strain of
 * the settings there is at or above the low level of that strain. `trail`: 4 lanes per cell, as Sim.readTrail()
 * returns them, after the diffusion of the step.
 */
export function holdsPlasm(grid: FlowGrid, s: SlimeSettings, trail: Float32Array, x: number, y: number): boolean {
  const c = openCell(grid, x, y);
  if (c < 0) return false;
  return s.strains.slice(0, 4).some((strain, lane) => {
    const low = Math.fround(trailLevels(strain, s.stepOrder)[0]);
    return (trail[c * 4 + lane] ?? 0) >= low;
  });
}

/**
 * The slime field after step `step`; the first step of a run has the number 0. `stamps`: what every cell holds before
 * the step, as Sim.readSlime() returns it: 0 for a cell without a stamp, else the number of a step plus 1. `trail`: the
 * trail after the diffusion of the step. A cell that holds plasm gets the stamp of the step, and every other cell keeps
 * what it holds. Without slime (the Jones model, or a life time of 0) the pass does not run: every cell keeps what it
 * holds.
 */
export function slimeStep(
  grid: FlowGrid,
  s: SlimeSettings,
  step: number,
  stamps: Uint32Array,
  trail: Float32Array,
): Uint32Array {
  const out = stamps.slice();
  if (slimeSteps(s) === 0) return out;
  for (let y = 0; y < grid.height; y++)
    for (let x = 0; x < grid.width; x++) if (holdsPlasm(grid, s, trail, x, y)) out[y * grid.width + x] = step + 1;
  return out;
}

/**
 * Whether a cell that holds `held` has slime at step `step` (ADR 0055, decision 3): it has a stamp S, and step − S is
 * below the life time `life` in steps. `step` is the number of the step that reads the field, or of the next step
 * for a reader between two steps, as `P.grid.w` is. In the unsigned 32-bit integers of a pass:
 * held != 0u && P.grid.w + 1u − held < life. A cell that held plasm in the step before has slime of the age 1.
 */
export function hasSlime(held: number, step: number, life: number): boolean {
  return held !== 0 && (step + 1 - held) >>> 0 < life;
}

/**
 * The strength of the slime of a cell that holds `held`, as the picture draws it (ADR 0055, decision 8; `slimeCell` in
 * render.wgsl and render.frag): a share of the full strength of the layer, 0 to 1. `step`: the steps that ran so far,
 * as Sim.step. `life`: the life time in steps. The age of the slime is step + 1 − held, in unsigned 32-bit integers as
 * in hasSlime(): 0 for a stamp that the Slime tool wrote after the last step, and 1 for a cell that held plasm in the
 * last step. The strength is 1 at the age 0 and falls in a straight line to 0 at the life time. A cell without slime
 * has none: no stamp, or an age at or above the life time.
 */
export function slimeStrength(held: number, step: number, life: number): number {
  if (!hasSlime(held, step, life)) return 0;
  return 1 - ((step + 1 - held) >>> 0) / life;
}

/**
 * The strength of the layer of the slime at the grid position (px, py), in cells, as the picture reads it (ADR 0055,
 * decision 8; `slimed` in render.wgsl and render.frag): 0 to 1, a share of the full strength of the layer. `stamps`:
 * the field, as Sim.readSlime() returns it. `grid`: the grid of the simulation with its boundary and its environment.
 * `step` and `life`: as for slimeStrength(). `scale`: the cells per pixel of the view. `level`: the level of the
 * trail's map that the frame reads (render.ts trailLevel()). On the periodic grid the field repeats.
 *
 *  - Up to 1 cell per pixel: the strengths of the 4 cells around the position, bilinear over the open ones, with
 *    their weights scaled up to 1. A cell is open when it lies inside the arena and holds no wall
 *    (flow-reference.ts openCell()): the cells that can hold slime. So the layer goes on up to a wall and to the edge
 *    of the arena. Without an open cell the strength is 0. The strengths are blended, never the stamps.
 *  - Zoomed out: the mean of the strength over the square of the pixel, `scale` cells wide, over the 3 × 3 texels of
 *    the map of that level under the pixel, each by the share that lies under it. At level 0 a texel is a cell, and
 *    the mean is exact. At a level above 0 a texel is width / n cells wide, with n = ceil(width / 2^level) texels per
 *    side, and the cell in the middle of the texel stands for it: the cell floor((2 t + 1) · width / (2 n)) of the
 *    texel t, and so for the rows. A wall and a cell outside a closed arena count with a strength of 0.
 */
export function slimeLayer(
  stamps: Uint32Array,
  grid: FlowGrid,
  step: number,
  life: number,
  [px, py]: readonly [number, number],
  scale: number,
  level: number,
): number {
  const { width: w, height: h } = grid;
  const periodic = grid.boundary === 'wrap';
  const mod = (v: number, n: number) => ((v % n) + n) % n;
  /** The strength of the cell (x, y), which lies inside the grid. */
  const held = (x: number, y: number) => slimeStrength(stamps[y * w + x] ?? 0, step, life);
  if (scale <= 1) {
    const [qx, qy] = [px - 0.5, py - 0.5];
    const [i, j] = [Math.floor(qx), Math.floor(qy)];
    const [fx, fy] = [qx - i, qy - j];
    let [sum, total] = [0, 0];
    for (const [dx, dy] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ] as const) {
      const c = openCell(grid, i + dx, j + dy);
      if (c < 0) continue;
      const weight = (dx === 1 ? fx : 1 - fx) * (dy === 1 ? fy : 1 - fy);
      sum += weight * slimeStrength(stamps[c] ?? 0, step, life);
      total += weight;
    }
    return total > 0 ? sum / total : 0;
  }
  const n = [Math.ceil(w / 2 ** level), Math.ceil(h / 2 ** level)] as const;
  const ratio = [n[0] / w, n[1] / h] as const; // texels per cell
  const lo = [px * ratio[0] - 0.5 * scale * ratio[0], py * ratio[1] - 0.5 * scale * ratio[1]] as const;
  const hi = [px * ratio[0] + 0.5 * scale * ratio[0], py * ratio[1] + 0.5 * scale * ratio[1]] as const;
  const [i, j] = [Math.floor(lo[0]), Math.floor(lo[1])];
  /** The cell in the middle of the texel t of one axis with `side` cells and `count` texels. */
  const middle = (t: number, side: number, count: number) => Math.floor(((2 * t + 1) * side) / (2 * count));
  let [sum, areaX, areaY] = [0, 0, 0];
  for (let dy = 0; dy < 3; dy++) {
    const wy = Math.max(Math.min(hi[1], j + dy + 1) - Math.max(lo[1], j + dy), 0);
    areaY += wy;
    for (let dx = 0; dx < 3; dx++) {
      const wx = Math.max(Math.min(hi[0], i + dx + 1) - Math.max(lo[0], i + dx), 0);
      if (dy === 0) areaX += wx;
      let [tx, ty] = [i + dx, j + dy];
      if (periodic) [tx, ty] = [mod(tx, n[0]), mod(ty, n[1])];
      else if (tx < 0 || ty < 0 || tx >= n[0] || ty >= n[1]) continue;
      sum += wx * wy * held(middle(tx, w, n[0]), middle(ty, h, n[1]));
    }
  }
  return sum / (areaX * areaY);
}

/**
 * What a brush stroke does with the slime field (ADR 0055, decision 7), in place in `stamps`. `grid`: the grid of the
 * simulation with its boundary and its environment as they are when the stroke comes. `step`: the steps that ran so
 * far, as Sim.step; the next step has this number, and a stamp of it has the age 0 (hasSlime()). `model`: the model of
 * the settings. The Jones model has no slime, and a stroke does nothing there.
 *
 * The footprint of the stroke is the one of a food stroke with the same numbers (paint-reference.ts strokeCells()):
 * the cells inside the arena of the stroke's own boundary whose centre lies within the radius, with a hard edge.
 *  - A stroke of the Slime tool gives each open cell of its footprint the stamp of `step`. A cell is open when it lies
 *    inside the arena of the simulation and holds no wall (flow-reference.ts openCell()).
 *  - An erase and a wall clear the stamp of every cell of their footprint: no wall ever holds a stamp.
 *  - Every other kind leaves the field as it is.
 * `margin`: as for strokeCells().
 */
export function slimePaint(
  grid: FlowGrid,
  model: Pick<Settings, 'model'>,
  step: number,
  stamps: Uint32Array,
  stroke: Stroke,
  margin?: { min: number },
) {
  if (!slimeModel(model)) return;
  const { width: w, height: h } = grid;
  const visit = (c: number) => {
    if (stroke.kind === 'erase' || stroke.kind === 'wall') stamps[c] = NO_STAMP;
    else if (stroke.kind === 'slime' && openCell(grid, c % w, Math.floor(c / w)) >= 0) stamps[c] = stampOf(step);
  };
  strokeCells(w, h, stroke, grid.boundary, visit, margin);
}
