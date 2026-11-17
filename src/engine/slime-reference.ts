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
