// The slime field (ADR 0055): where the colony was, and when it was there last. One field for all strains. The pass of
// the stamps is shaders/slime.wgsl and gl/glsl/slime.frag; slime-reference.ts mirrors it on the CPU for the tests.
//
// A cell holds plasm in a step when the trail of at least one strain of the settings, after the diffusion of that
// step, is at or above the low level of that strain (plasmLevels()). The stamp of a cell is the number of the step in
// which it last held plasm; the first step of a run has the number 0. A cell has slime at step t while it has a stamp
// S and t − S is below the life time in steps (slimeSteps()).
//
// Beside the stamp the field holds the amount of slime of each cell, for the picture alone (ADR 0057): how thick the
// slime is that the plasm built there. It grows while the cell holds plasm, and the picture lets it fade with the age
// of the stamp (amountLeft() in slime-reference.ts). No rule of the model reads the amount.
import { MAX_STRAINS, type Settings } from '../model/params';
import { FLOW, STEPS_PER_MINUTE, trailLevels } from './flow';

/** The steps of an hour of model time: 1,800 (ADR 0029, decision 10), with the flow and without it. */
export const STEPS_PER_HOUR = 60 * STEPS_PER_MINUTE;

/**
 * What the field holds for a cell without a stamp. A new field holds it in every cell, and so does a field after a
 * reset.
 */
export const NO_STAMP = 0;

/**
 * The full amount of slime of a cell (ADR 0057): the field holds a whole number from 0 to this. A cell under a full
 * tube gains one of them per step, so it holds the full amount after 4,095 steps: 2.3 hours of model time. The
 * passes hold the number as `FULL` (shaders/amount.wgsl, gl/glsl/amount.glsl).
 */
export const SLIME_FULL = 4095;

/**
 * The cells over which painted slime rises from the edge of its stroke to the full amount (ADR 0057): the rim of a
 * stroke of the Slime tool. `RIM` in shaders/slime-paint.wgsl and gl/glsl/slime-paint.frag.
 */
export const SLIME_RIM = 4;

/**
 * How fast the plasm hides the film of the slime below it (ADR 0060): a trail with the light x, its sum above the
 * black level times the exposure, hides the share 1 − e^(−FILM_HIDE · x) of the film in the glow, paper and agents
 * styles. In the gel style the film ends where the gel begins. `FILM_HIDE` in render.wgsl and render.frag.
 */
export const FILM_HIDE = 3;

/**
 * The trail above the low level of a strain, in low levels, at which the plasm of a cell is full (ADR 0057): the full
 * level of the tube body less its low level, over the low level (flow.ts FLOW, docs/model.md 8.1). The passes hold it
 * as `SPAN`.
 */
export const PLASM_SPAN = (FLOW.trailFull - FLOW.trailLow) / FLOW.trailLow;

/**
 * What the field holds for a cell with the stamp of step `step`: the number of the step plus 1, so that 0 stays free
 * for a cell without a stamp. The passes write `P.grid.w + 1u`.
 */
export const stampOf = (step: number) => (step + 1) >>> 0;

/**
 * Whether the model of the settings has the slime field: the extended model, with a life time above 0 or with 0
 * (ADR 0055, decisions 9 and 10). The Jones model has no slime. A simulation holds the field while this is true, and
 * the fit of the grid counts its bytes then (sizing.ts slimeBytesPerCell()).
 */
export const slimeModel = (s: Pick<Settings, 'model'>) => s.model === 'extended';

/**
 * The life time of the slime in steps (ADR 0055, decision 4): the setting Slime life time in hours times
 * STEPS_PER_HOUR, as a whole number. 0 in the Jones model, and for a life time of 0: then the model has no slime, and
 * the pass of the stamps does not run.
 */
export function slimeSteps(s: Pick<Settings, 'model' | 'slimeLife'>): number {
  return slimeModel(s) && s.slimeLife > 0 ? Math.round(s.slimeLife * STEPS_PER_HOUR) : 0;
}

/**
 * Whether the view draws the slime as a film on the ground (ADR 0055, decision 8; ADR 0057): the switch Show slime is
 * on, the
 * model has slime with a life time above 0, and the scent view is off. Every style draws the film. The scent view
 * draws none, so that its picture is the same with slime and without it. Display only: no pass of the simulation
 * reads the switch.
 */
export const slimeShown = (s: Pick<Settings, 'showSlime' | 'showScent' | 'model' | 'slimeLife'>) =>
  s.showSlime && !s.showScent && slimeSteps(s) > 0;

/**
 * Whether the view draws young ground as the fan of a growth front (ADR 0060): the switch Show growth front is on,
 * the colony grows (growth is on, with its rule of one agent per cell: pack.ts growthOn()), the model has slime with
 * a life time above 0 (the front field is a part of the slime field), and the view is neither the scent view nor the
 * agents style, which draws the agents and not the plasm. A scene without growth has no growth front: its agents
 * start all over the ground, and a fan would lie on all of it in the first steps. Display only: no pass of the
 * simulation reads the switch.
 */
export const frontShown = (
  s: Pick<Settings, 'showFront' | 'showScent' | 'style' | 'model' | 'slimeLife' | 'growth' | 'collisions'>,
) => s.showFront && s.growth && s.collisions && !s.showScent && s.style !== 'agents' && slimeSteps(s) > 0;

/**
 * The trail of each strain from which a cell holds plasm (ADR 0055, decision 3): the low level of the strain, the
 * level from which its tube body grows (flow.ts trailLevels()). One value per strain of the settings, at most four.
 * Every level is above 0.
 */
export function plasmLevels(s: Pick<Settings, 'strains' | 'stepOrder'>): number[] {
  return s.strains.slice(0, MAX_STRAINS).map((strain) => trailLevels(strain, s.stepOrder)[0]);
}
