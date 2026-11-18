// CPU mirror of the slime field (shaders/slime.wgsl, gl/glsl/slime.frag; ADR 0055, decision 3), of the brush on it
// (shaders/slime-paint.wgsl, gl/glsl/slime-paint.frag; decision 7) and of the film of the slime in the picture
// (shaders/render.wgsl, gl/glsl/slime-film.frag, slime-down.frag and render.frag; ADR 0057), for tests only:
// slime.gpu.test.ts checks both backends against it, and the engine tests in Node paint with it (cpu-backend.ts). It
// states the rule from the settings, without the code that packs them for the passes: the level of a strain is the
// low level of its trail (flow.ts trailLevels()), as a 32-bit float, because the passes compare 32-bit floats.
import { hexToLinear } from '../model/color';
import type { Settings } from '../model/params';
import { cellIndex } from './brush';
import { trailLevels } from './flow';
import { openCell, type FlowGrid } from './flow-reference';
import { strokeCells } from './paint-reference';
import { BACKGROUND, SLIME_BEAD, SLIME_LOOK, SLIME_RELIEF, trailLevel } from './render';
import { levelSize } from './scent';
import { NO_STAMP, PLASM_SPAN, SLIME_FULL, SLIME_RIM, slimeModel, slimeSteps, stampOf } from './slime';
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
 * What is left of the amount `a` of a cell that holds the stamp `held` (ADR 0057; `amountLeft` in shaders/amount.wgsl
 * and gl/glsl/amount.glsl), as the picture shows it before the step or the stroke with the number `step`: nothing
 * without slime, all of it for slime of the age 0 or 1, and else the share 1 − age / life time, rounded down. `life`:
 * the life time in steps.
 */
export function amountLeft(a: number, held: number, step: number, life: number): number {
  if (!hasSlime(held, step, life)) return 0;
  const age = (step + 1 - held) >>> 0;
  return age <= 1 ? a : Math.floor((a * (life - age)) / life);
}

/**
 * The level of the plasm of the cell `c`, 0 to SLIME_FULL (ADR 0057; `plasmLevel` in shaders/slime.wgsl): for the
 * strain with the most, the share of its trail between its low level and its full level, rounded to the nearest. In
 * 32-bit floats, as the pass computes it. `trail`: as for holdsPlasm().
 */
export function plasmLevel(s: SlimeSettings, trail: Float32Array, c: number): number {
  let level = 0;
  s.strains.slice(0, 4).forEach((strain, lane) => {
    const low = Math.fround(trailLevels(strain, s.stepOrder)[0]);
    const above = Math.fround((trail[c * 4 + lane] ?? 0) - low);
    level = Math.max(level, Math.fround(above / Math.fround(PLASM_SPAN * low)));
  });
  return Math.floor(Math.fround(Math.fround(Math.min(Math.max(level, 0), 1) * SLIME_FULL) + 0.5));
}

/**
 * The amount of slime of every cell after step `step` (ADR 0057; the pass of the stamps, shaders/slime.wgsl).
 * `stamps` and `amounts`: what the field holds before the step. `trail`: the trail after the diffusion of the step.
 * A cell that holds plasm starts from what is left of its amount (amountLeft()) and gains 1, as long as it is below
 * the level of the plasm (plasmLevel()). Every other cell keeps its amount. Without slime the pass does not run.
 */
export function amountStep(
  grid: FlowGrid,
  s: SlimeSettings,
  step: number,
  stamps: Uint32Array,
  amounts: Uint32Array,
  trail: Float32Array,
): Uint32Array {
  const out = amounts.slice();
  const life = slimeSteps(s);
  if (life === 0) return out;
  for (let y = 0; y < grid.height; y++)
    for (let x = 0; x < grid.width; x++) {
      if (!holdsPlasm(grid, s, trail, x, y)) continue;
      const c = y * grid.width + x;
      const a = amountLeft(amounts[c] ?? 0, stamps[c] ?? 0, step, life);
      out[c] = Math.max(a, Math.min(plasmLevel(s, trail, c), a + 1));
    }
  return out;
}

/**
 * The front field after step `step` (ADR 0060; the pass of the stamps, shaders/slime.wgsl): the step, plus 1, at
 * which the growth front reached each cell. `stamps` and `fronts`: what the fields hold before the step. `trail`: the
 * trail after the diffusion of the step. A cell that holds plasm and has no slime before the step gets the front
 * stamp of the step: the front reaches ground without slime. Every other cell keeps what it holds, so a cell keeps
 * its front stamp while it has slime, and plasm that comes back onto slime is no front. Without slime the pass does
 * not run.
 */
export function frontStep(
  grid: FlowGrid,
  s: SlimeSettings,
  step: number,
  stamps: Uint32Array,
  fronts: Uint32Array,
  trail: Float32Array,
): Uint32Array {
  const out = fronts.slice();
  const life = slimeSteps(s);
  if (life === 0) return out;
  for (let y = 0; y < grid.height; y++)
    for (let x = 0; x < grid.width; x++) {
      const c = y * grid.width + x;
      if (holdsPlasm(grid, s, trail, x, y) && !hasSlime(stamps[c] ?? 0, step, life)) out[c] = stampOf(step);
    }
  return out;
}

/**
 * The amount that a stroke of the Slime tool with the radius `radius` gives a cell whose centre lies `d` cells from
 * the middle line of the stroke (ADR 0057; `paintedAmount` in shaders/slime-paint.wgsl): 0 half a cell outside the
 * radius, SLIME_FULL from SLIME_RIM cells inside that on, and between them the curve t³ (t (6 t − 15) + 10).
 */
export function paintedAmount(d: number, radius: number): number {
  const t = Math.min(Math.max((radius - d + 0.5) / SLIME_RIM, 0), 1);
  return Math.floor(t * t * t * (t * (t * 6 - 15) + 10) * SLIME_FULL + 0.5);
}

/**
 * The strength of the slime of a cell that holds `held`, as the picture draws it (ADR 0055, decision 8; `slimeOf` in
 * render.wgsl and slime-film.frag): a share of the full strength, 0 to 1. `step`: the steps that ran so far, as
 * Sim.step. `life`: the life time in steps. The age of the slime is step + 1 − held, in unsigned 32-bit integers as
 * in hasSlime(): 0 for a stamp that the Slime tool wrote after the last step, and 1 for a cell that held plasm in the
 * last step. The strength is 1 at the age 0 and falls in a straight line to 0 at the life time. A cell without slime
 * has none: no stamp, or an age at or above the life time.
 */
export function slimeStrength(held: number, step: number, life: number): number {
  if (!hasSlime(held, step, life)) return 0;
  return 1 - ((step + 1 - held) >>> 0) / life;
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
 *
 * `slime` (optional): the amount of slime of every cell (ADR 0057), which the stroke changes with the stamps, and the
 * life time in steps. The Slime tool gives a cell the larger of what is left of its amount (amountLeft()) and the
 * amount of the stroke at the cell (paintedAmount()). An erase and a wall clear the amount. With `fronts`, the front
 * field (ADR 0060): no front reached painted slime, so the Slime tool clears the front stamp of a cell that had no
 * slime. An erase and a wall leave the front stamps: they have no meaning in a cell without slime.
 */
export function slimePaint(
  grid: FlowGrid,
  model: Pick<Settings, 'model'>,
  step: number,
  stamps: Uint32Array,
  stroke: Stroke,
  margin?: { min: number },
  slime?: { amounts: Uint32Array; life: number; fronts?: Uint32Array },
) {
  if (!slimeModel(model)) return;
  const { width: w, height: h } = grid;
  const visit = (c: number, d: number) => {
    if (stroke.kind === 'erase' || stroke.kind === 'wall') {
      stamps[c] = NO_STAMP;
      if (slime) slime.amounts[c] = 0;
    } else if (stroke.kind === 'slime' && openCell(grid, c % w, Math.floor(c / w)) >= 0) {
      if (slime) {
        const left = amountLeft(slime.amounts[c] ?? 0, stamps[c] ?? 0, step, slime.life);
        slime.amounts[c] = Math.max(left, paintedAmount(d, stroke.radius));
        if (slime.fronts && !hasSlime(stamps[c] ?? 0, step, slime.life)) slime.fronts[c] = NO_STAMP;
      }
      stamps[c] = stampOf(step);
    }
  };
  strokeCells(w, h, stroke, grid.boundary, visit, margin);
}

// ---- The film of the slime in the picture (ADR 0055, decision 8; ADR 0057) ---------------------------------------
// The picture draws the slime as a wet film on the ground. Three steps, as in render.wgsl: a pass writes the film of
// every cell into a map (`slimeFilm`), a second pass the mean of that map for a view that is zoomed out (`slimeDown`),
// and the render pass reads the 3 × 3 texels of its map around a pixel as a smooth surface and lights it (`slimed`).
// Each rule of the shaders has a function here, with the name of the shader where one fits.
//
// The two passes of the maps compute in 32-bit floats and write 16-bit floats. filmCell(), filmOf() and slimeDown()
// follow them operation by operation, and half() rounds to a 16-bit float as IEEE 754 does. A GPU may round a texel
// the other way (the GPU of an Apple M-series rounds toward 0), and its arithmetic may be one unit in the last place
// off: a texel of a backend lies within one step of a 16-bit float of the texel here. The light reads the slope of the
// map, so a test of the picture takes the map that the backend holds (slime.gpu.test.ts). The render pass writes 8
// bits per channel: its rules are in 64-bit floats here.

const f32 = Math.fround;
type Vec2 = readonly [number, number];
type Vec3 = readonly [number, number, number];
/** A colour, linear RGB. */
export type Rgb = [number, number, number];

/** Cells per step of the lattice of the waves of the film (`SLIME_WAVES` in render.wgsl and render.frag). */
export const SLIME_WAVES = 12;
/** Cells per step of the lattice of the beads (`SLIME_BEADS`). */
export const SLIME_BEADS = 7;
/** How much the waves change the thickness of the film, as a share of it (`SLIME_RIPPLE`). */
export const SLIME_RIPPLE = 0.16;

/** What the picture reads of the slime field of a simulation. */
export interface SlimeField {
  /** The stamps, as Sim.readSlime() returns them. */
  stamps: Uint32Array;
  /** The amounts, as Sim.readSlimeAmount() returns them. */
  amounts: Uint32Array;
  /** The steps that ran so far, as Sim.step. */
  step: number;
  /** The life time of the slime in steps (slime.ts slimeSteps()). */
  life: number;
}

/**
 * The 16-bit float nearest to `v`, and the even one of two that are as near: what a texel of a map of the film holds
 * (r16float on WebGPU, R16F on WebGL2). A 16-bit float has 11 bits: from 0.5 to 1 its values lie 1 / 2048 apart, and
 * below 2^-14 they lie 2^-24 apart. 0 for a `v` at or below 0: the film is never thinner than nothing.
 */
export function half(v: number): number {
  if (!(v > 0)) return 0;
  // The power of 2 at or below v. The logarithm can be off by one at a power of 2.
  let e = Math.floor(Math.log2(v));
  if (2 ** e > v) e--;
  else if (2 ** (e + 1) <= v) e++;
  const step = 2 ** (Math.max(e, -14) - 10);
  const n = v / step;
  const down = Math.floor(n);
  const up = n - down > 0.5 || (n - down === 0.5 && down % 2 === 1);
  return (down + (up ? 1 : 0)) * step;
}

/**
 * The thickness of the slime of a cell, 0 to 1 (`filmCell` in render.wgsl and slime-film.frag): its amount `amount`
 * as a share of the full amount, times the strength of the age of its stamp `held` (slimeStrength()). In 32-bit
 * floats, as the pass computes it. `step` and `life`: as for slimeStrength().
 */
export function filmCell(held: number, amount: number, step: number, life: number): number {
  if (!hasSlime(held, step, life)) return 0;
  const strength = f32(1 - f32(((step + 1 - held) >>> 0) / life));
  return f32(f32(strength * amount) / SLIME_FULL);
}

/**
 * The film of the cell (x, y) of the grid, 0 to 1 (`filmOf`): the mean of the thickness of the open cells among the
 * 3 × 3 cells around it, with the weights 1, 2, 1 along each axis. A cell is open when it lies in the arena and holds
 * no wall (flow-reference.ts openCell()). So a wall and a cell outside the arena take the film of the open cells
 * beside them, and the film goes on up to a wall and to the rim of the dish. A cell with no open cell among its 3 × 3
 * takes the mean over the open cells of the 5 × 5 around it, with the weights 1, 2, 3, 2, 1: the smooth outline of a
 * wall runs through the cells of the wall, and a pixel beside it reads the cells two deep. 0 without an open cell
 * among the 5 × 5. On the periodic grid the cells wrap. In 32-bit floats, in the order of the pass: row by row.
 *
 * `walls`: false for a frame that draws no walls (a simulation without food, light and walls, or a renderer with its
 * overlays off). Then a cell with a wall counts as an open cell, with the thickness 0 that it has.
 */
export function filmOf(grid: FlowGrid, field: SlimeField, x: number, y: number, walls = true): number {
  const { width: w, height: h } = grid;
  // The 3 × 3 cells, and the 5 × 5 where the 3 × 3 hold no open cell.
  for (const r of [1, 2]) {
    let [sum, total] = [0, 0];
    for (let j = -r; j <= r; j++)
      for (let i = -r; i <= r; i++) {
        const c = walls ? openCell(grid, x + i, y + j) : cellIndex(x + i, y + j, w, h, grid.boundary);
        if (c < 0) continue;
        const weight = (r + 1 - Math.abs(i)) * (r + 1 - Math.abs(j));
        const cell = filmCell(field.stamps[c] ?? 0, field.amounts[c] ?? 0, field.step, field.life);
        sum = f32(sum + f32(weight * cell));
        total += weight;
      }
    if (total > 0) return f32(sum / total);
  }
  return 0;
}

/**
 * The map of the film (`slimeFilm`): the film of every cell of the grid (filmOf()), one value per cell, rows from
 * y = 0, each as the 16-bit float that the map holds. `walls`: as for filmOf().
 */
export function filmCells(grid: FlowGrid, field: SlimeField, walls = true): Float32Array {
  const { width: w, height: h } = grid;
  return Float32Array.from({ length: w * h }, (_, c) => half(filmOf(grid, field, c % w, Math.floor(c / w), walls)));
}

/**
 * The coarse map of the film of level `level`, 1 and up (`slimeDown`): levelSize() texels per side, rows from y = 0.
 * A texel is width / n cells wide for n texels per side, and holds the mean of the map of the film `film`
 * (filmCells()) over the cells that it covers, each by the share that it covers. On a side that 2^level divides that
 * is the mean of 2^level cells; on another side the texels have a part of a cell at their ends. In 32-bit floats, in
 * the order of the pass, and each texel as the 16-bit float that the map holds.
 */
export function slimeDown(film: Float32Array, width: number, height: number, level: number): Float32Array {
  const [nx, ny] = [levelSize(width, level), levelSize(height, level)];
  const [spanX, spanY] = [f32(width / nx), f32(height / ny)]; // cells per texel
  const out = new Float32Array(nx * ny);
  for (let ty = 0; ty < ny; ty++)
    for (let tx = 0; tx < nx; tx++) {
      const [loX, loY] = [f32(tx * spanX), f32(ty * spanY)];
      const [hiX, hiY] = [f32(loX + spanX), f32(loY + spanY)];
      let sum = 0;
      for (let y = Math.floor(loY); y < hiY && y < height; y++) {
        const wy = f32(Math.min(hiY, y + 1) - Math.max(loY, y));
        for (let x = Math.floor(loX); x < hiX && x < width; x++) {
          const weight = f32(f32(Math.min(hiX, x + 1) - Math.max(loX, x)) * wy);
          sum = f32(sum + f32(weight * (film[y * width + x] ?? 0)));
        }
      }
      out[ty * nx + tx] = half(f32(sum / f32(spanX * spanY)));
    }
  return out;
}

/** The film at a point: its thickness `h`, 0 to 1, and its gradient `g`, the change of the thickness per cell. */
export interface Film {
  h: number;
  g: [number, number];
}

/**
 * The weights of a quadratic B-spline for the three texels around a point that lies `u` texels (−0.5 to 0.5) from the
 * centre of the middle one (`spline` in render.wgsl). They sum to 1, and they give a straight line exactly.
 */
export const spline = (u: number): Vec3 => [0.5 * (0.5 - u) ** 2, 0.75 - u * u, 0.5 * (0.5 + u) ** 2];
/** The change of the weights of spline() with `u` (`splineSlope`). They sum to 0. */
export const splineSlope = (u: number): Vec3 => [u - 0.5, -2 * u, u + 0.5];

/**
 * The film at the grid position `p`, in cells (`filmAt`): a quadratic B-spline over the 3 × 3 texels around `p` of
 * the map `map` of the level `level`, with its gradient from the same texels. `level`: 0 for the map of the cells
 * (filmCells()), which a frame reads up to 2 cells per pixel, or the level of a coarse map (slimeDown()); a frame
 * reads the level trailLevel(scale) of render.ts. A texel of the level is width / n cells wide for n texels per side.
 * On the periodic grid the map wraps, so the film repeats with the grid. In a closed arena the texels at the edge of
 * the map go on beyond it.
 */
export function filmAt(
  map: Float32Array,
  grid: Pick<FlowGrid, 'width' | 'height' | 'boundary'>,
  level: number,
  [px, py]: Vec2,
): Film {
  const [nx, ny] = [levelSize(grid.width, level), levelSize(grid.height, level)];
  const [ratioX, ratioY] = [nx / grid.width, ny / grid.height]; // texels per cell
  const [qx, qy] = [px * ratioX - 0.5, py * ratioY - 0.5];
  const [cx, cy] = [Math.floor(qx + 0.5), Math.floor(qy + 0.5)];
  const [ux, uy] = [qx - cx, qy - cy];
  const [wx, wy, sx, sy] = [spline(ux), spline(uy), splineSlope(ux), splineSlope(uy)];
  const periodic = grid.boundary === 'wrap';
  /** The texel t of an axis with n texels: wrapped, or the texel at the edge. */
  const texel = (t: number, n: number) => (periodic ? ((t % n) + n) % n : Math.min(Math.max(t, 0), n - 1));
  const film: Film = { h: 0, g: [0, 0] };
  for (let j = 0; j < 3; j++)
    for (let i = 0; i < 3; i++) {
      const h = map[texel(cy + j - 1, ny) * nx + texel(cx + i - 1, nx)] ?? 0;
      film.h += (wx[i] ?? 0) * (wy[j] ?? 0) * h;
      film.g[0] += (sx[i] ?? 0) * (wy[j] ?? 0) * h;
      film.g[1] += (wx[i] ?? 0) * (sy[j] ?? 0) * h;
    }
  film.g = [film.g[0] * ratioX, film.g[1] * ratioY];
  return film;
}

/**
 * A number from 0 to 1 for the point (x, y) of a lattice, the same in every frame (`lattice` in render.wgsl and
 * render.frag): a hash in unsigned 32-bit integers, bit for bit as the shaders compute it. Its top 24 bits are the
 * number, so a 32-bit float holds it exactly.
 */
export function lattice(x: number, y: number): number {
  let v = (Math.imul(x, 1664525) + Math.imul(y, 1013904223)) >>> 0;
  v = Math.imul(v ^ (v >>> 16), 0x7feb352d) >>> 0;
  v = Math.imul(v ^ (v >>> 15), 0x846ca68b) >>> 0;
  return ((v ^ (v >>> 16)) >>> 8) / 16777216;
}

/** `v` wrapped into 0 to n − 1. */
const wrap = (v: number, n: number) => ((v % n) + n) % n;

/**
 * The steps of the lattice of a pattern along each side of a grid of `width` × `height` cells, about one per `step`
 * cells (`patternSteps`): the side over `step`, rounded to the nearest whole number, and up for a side half way
 * between two; 1 at least. Whole numbers, so the pattern repeats with a periodic grid. The passes compute it in whole
 * numbers: (2 · side + step) / (2 · step), rounded down.
 */
export function patternSteps(width: number, height: number, step: number): [number, number] {
  const steps = (side: number) => Math.max(Math.floor((2 * side + step) / (2 * step)), 1);
  return [steps(width), steps(height)];
}

/**
 * Value noise at the lattice position (x, y) that repeats every `period` steps of the lattice, with its gradient
 * (`noiseSlope`): the value, 0 to 1, and its change per step of the lattice along x and along y. At a point of the
 * lattice the value is lattice() of that point. The curve between two points, t³ (t (6 t − 15) + 10), starts and ends
 * flat, so the gradient is 0 at every point of the lattice and has no crease.
 */
export function noiseSlope([x, y]: Vec2, [periodX, periodY]: Vec2): [number, number, number] {
  const [stepX, stepY] = [Math.floor(x), Math.floor(y)];
  const [fx, fy] = [x - stepX, y - stepY];
  const curve = (f: number) => f * f * f * (f * (f * 6 - 15) + 10);
  const slope = (f: number) => 30 * f * f * (f * (f - 2) + 1);
  const [u, v] = [curve(fx), curve(fy)];
  const [x0, y0, x1, y1] = [
    wrap(stepX, periodX),
    wrap(stepY, periodY),
    wrap(stepX + 1, periodX),
    wrap(stepY + 1, periodY),
  ];
  const [a, b, c, d] = [lattice(x0, y0), lattice(x1, y0), lattice(x0, y1), lattice(x1, y1)];
  const [k1, k2, k3] = [b - a, c - a, a - b - c + d];
  return [a + k1 * u + k2 * v + k3 * u * v, slope(fx) * (k1 + k3 * v), slope(fy) * (k2 + k3 * u)];
}

/**
 * The waves of the film at the grid position `p` on a grid of `width` × `height` cells (`slimeWaves`): the value, 0
 * to 1, and its gradient per cell. A pattern that is fixed in the grid: noise with one step of its lattice per
 * SLIME_WAVES cells, and a quarter of a noise of twice the frequency.
 */
export function slimeWaves(width: number, height: number, [px, py]: Vec2): [number, number, number] {
  const [nx, ny] = patternSteps(width, height, SLIME_WAVES);
  const [scaleX, scaleY] = [nx / width, ny / height]; // steps of the lattice per cell
  const [x, y] = [px * scaleX, py * scaleY];
  const a = noiseSlope([x, y], [nx, ny]);
  const b = noiseSlope([2 * x + 19.7, 2 * y + 7.3], [2 * nx, 2 * ny]);
  return [(a[0] + 0.25 * b[0]) / 1.25, ((a[1] + 0.5 * b[1]) * scaleX) / 1.25, ((a[2] + 0.5 * b[2]) * scaleY) / 1.25];
}

/**
 * The beads on the film at the grid position `p` (`slimeBeads`): the height of the bead there, 0 to 1, and its
 * gradient per cell; zeros where no bead lies. The lattice of the beads has one step per SLIME_BEADS cells. A quarter
 * of its steps hold a bead: a round drop at a place of its own in the step, with a radius of 0.1 to 0.32 steps. Its
 * height is (1 − d² / r²)² at the distance d from its middle. Where two beads overlap, the higher one counts.
 */
export function slimeBeads(width: number, height: number, [px, py]: Vec2): [number, number, number] {
  const [nx, ny] = patternSteps(width, height, SLIME_BEADS);
  const [scaleX, scaleY] = [nx / width, ny / height]; // steps of the lattice per cell
  const [x, y] = [px * scaleX, py * scaleY];
  const [stepX, stepY] = [Math.floor(x), Math.floor(y)];
  let best: Vec3 = [0, 0, 0];
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const [kx, ky] = [stepX + dx, stepY + dy];
      const [wx, wy] = [wrap(kx, nx), wrap(ky, ny)];
      if (lattice(wx + 7, wy + 211) > 0.25) continue;
      const r = 0.1 + 0.22 * lattice(wx + 191, wy + 31);
      const [ex, ey] = [x - (kx + lattice(wx, wy)), y - (ky + lattice(wx + 57, wy + 113))];
      const m = 1 - (ex * ex + ey * ey) / (r * r);
      if (m > best[0]) best = [m, (-2 * ex * scaleX) / (r * r), (-2 * ey * scaleY) / (r * r)];
    }
  if (best[0] <= 0) return [0, 0, 0];
  return [best[0] * best[0], 2 * best[0] * best[1], 2 * best[0] * best[2]];
}

/** Toward the lamp of the picture: top left, as for the gel and the walls (`SUN` in render.wgsl). */
export const SUN: Vec3 = [-0.45 / Math.sqrt(0.985), -0.6 / Math.sqrt(0.985), 0.65 / Math.sqrt(0.985)];

/**
 * The light of the lamp on a wet surface with the normal `n` of the length 1 (`wetShine`): a small bright highlight,
 * the power 110 of the cosine between the normal and the direction half way between the lamp and the eye, and a wide
 * weak light, the power 10 of it less what a flat film shows. The wide light is below 0 on a slope that faces away
 * from the lamp, and 0 on a flat film.
 */
export function wetShine([nx, ny, nz]: Vec3): [number, number] {
  const length = Math.hypot(SUN[0], SUN[1], SUN[2] + 1);
  const mid: Vec3 = [SUN[0] / length, SUN[1] / length, (SUN[2] + 1) / length];
  const shine = Math.max(nx * mid[0] + ny * mid[1] + nz * mid[2], 0);
  return [shine ** 110, shine ** 10 - mid[2] ** 10];
}

/** The numbers of the film of a style, as the uniform of the view holds them (render.ts packView()). */
export interface SlimeLook {
  /** The colour of the body of the film, linear RGB. */
  color: Vec3;
  /** How much of that colour slime of the full thickness shows. */
  body: number;
  /** The strength of the small highlight. */
  gloss: number;
  /** The strength of the wide weak light. */
  wide: number;
  /** The height of the relief: cells of height for slime of the full thickness. */
  relief: number;
  /** The height of a bead, as a share of the full thickness. */
  bead: number;
  /** The film is a wet stain: the paper style. */
  stain: boolean;
}

/** The numbers of the film of `style`: SLIME_LOOK, SLIME_RELIEF and SLIME_BEAD of render.ts. */
export function slimeLook(style: Settings['style']): SlimeLook {
  const { color, body, gloss, wide } = SLIME_LOOK[style];
  return {
    color: hexToLinear(color),
    body,
    gloss,
    wide,
    relief: SLIME_RELIEF,
    bead: SLIME_BEAD,
    stain: style === 'paper',
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** The normal of the length 1 of a surface with the gradient (gx, gy) that is `relief` high. */
function normal(relief: number, gx: number, gy: number): Vec3 {
  const length = Math.hypot(relief * gx, relief * gy, 1);
  return [(-relief * gx) / length, (-relief * gy) / length, 1 / length];
}

/**
 * The ground `bg` at the grid position `p` with the film `film` on it, linear RGB (`slimed`). `size`: the cells of
 * the grid along x and y, for the patterns. `scale`: the cells per pixel of the view. Without a film (a thickness of
 * 0 or less) the ground is as it is.
 *
 *  - The waves change the thickness by up to SLIME_RIPPLE of it, to both sides, and tilt the surface.
 *  - The body: the share `body` of the colour of the film, times the thickness to the power 1.6: thin slime is clear
 *    and thick slime is milky. The thickness with its waves counts up to 1.
 *  - The light of the lamp on the surface with its relief (wetShine()): a highlight of the strength `gloss` and a wide
 *    light of the strength `wide`. Both fade in over the thinnest twentieth of the film.
 *  - Beads sit on slime that is thicker than 0.15, at their full height from 0.45 on. A bead only catches light: the
 *    highlight of its slope where that is brighter, and a quarter of what its wide light has more.
 *  - The slope of the waves and the beads are detail that is smaller than a pixel when the view is zoomed out: they
 *    fade out from 1 cell per pixel on and are gone at 1.5.
 *  - On the dark grounds the film adds its light to the ground: the body and the wide light (from −0.15 to 0.5) in
 *    the colour of the film, never below black, and the highlight in white, 0.8 at most.
 *  - On paper the film is a wet stain: the colour of the film mixed into the paper, darker on the side away from the
 *    lamp (the wide light from −0.4 to 0.1), with a tide line 4 % darker where the film is 0.04 to 0.05 thick, and
 *    the highlight as white over it.
 */
export function slimed(bg: Vec3, look: SlimeLook, film: Film, p: Vec2, [width, height]: Vec2, scale: number): Rgb {
  if (film.h <= 0) return [...bg];
  const fine = clamp(3 - 2 * scale, 0, 1);
  const cov = smoothstep(0, 0.05, film.h);
  const waves = slimeWaves(width, height, p);
  const wave = 1 + SLIME_RIPPLE * (2 * waves[0] - 1);
  const h = film.h * wave;
  const gx = film.g[0] * wave + film.h * SLIME_RIPPLE * 2 * waves[1] * fine;
  const gy = film.g[1] * wave + film.h * SLIME_RIPPLE * 2 * waves[2] * fine;
  const shine = wetShine(normal(look.relief, gx, gy));
  let spark = shine[0];
  const bead = look.bead * fine * smoothstep(0.15, 0.45, film.h);
  if (bead > 0) {
    const beads = slimeBeads(width, height, p);
    const glint = wetShine(normal(look.relief, gx + bead * beads[1], gy + bead * beads[2]));
    spark = Math.max(shine[0], glint[0]) + 0.25 * Math.max(glint[1] - shine[1], 0);
  }
  const depth = clamp(h, 0, 1) ** 1.6;
  if (look.stain) {
    const edge = smoothstep(0, 0.04, film.h) * (1 - smoothstep(0.05, 0.2, film.h));
    const shade = 1 - 0.04 * edge + look.wide * cov * clamp(shine[1], -0.4, 0.1);
    const white = Math.min(look.gloss * spark * cov, 1);
    return bg.map((v, k) => {
      const stain = (v + ((look.color[k] ?? 0) - v) * look.body * depth) * shade;
      return stain + (1 - stain) * white;
    }) as Rgb;
  }
  const wide = look.wide * cov * clamp(shine[1], -0.15, 0.5);
  const white = Math.min(look.gloss * spark * cov, 0.8);
  return bg.map((v, k) => Math.max(v + (look.color[k] ?? 0) * (look.body * depth + wide), 0) + white) as Rgb;
}

/**
 * The colour of the ground of `style` at the grid position `p` with the film of the slime on it, linear RGB: slimed()
 * with the ground and the numbers of the style, on the film at `p` (filmAt()). `grid`: the grid of the simulation.
 * `scale`: the cells per pixel of the view. `map`: the map of the film of the level that such a view reads
 * (render.ts trailLevel()): the map of the cells up to 2 cells per pixel (filmCells()), and a coarse map above
 * (slimeDown()).
 */
export function slimeColour(
  style: Settings['style'],
  grid: Pick<FlowGrid, 'width' | 'height' | 'boundary'>,
  map: Float32Array,
  p: Vec2,
  scale: number,
): Rgb {
  const film = filmAt(map, grid, trailLevel(scale), p);
  return slimed(hexToLinear(BACKGROUND[style]), slimeLook(style), film, p, [grid.width, grid.height], scale);
}
