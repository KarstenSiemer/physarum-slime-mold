// CPU mirror of the slime field (shaders/slime.wgsl, gl/glsl/slime.frag; ADR 0055, decision 3), for tests only:
// slime.gpu.test.ts checks both backends against it. It states the rule from the settings, without the code that packs
// them for the passes: the level of a strain is the low level of its trail (flow.ts trailLevels()), as a 32-bit float,
// because the passes compare 32-bit floats.
import type { Settings } from '../model/params';
import { trailLevels } from './flow';
import { openCell, type FlowGrid } from './flow-reference';
import { slimeSteps } from './slime';

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
