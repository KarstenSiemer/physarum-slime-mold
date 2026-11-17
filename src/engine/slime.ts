// The slime field (ADR 0055): where the colony was, and when it was there last. One field for all strains. The pass of
// the stamps is shaders/slime.wgsl and gl/glsl/slime.frag; slime-reference.ts mirrors it on the CPU for the tests.
//
// A cell holds plasm in a step when the trail of at least one strain of the settings, after the diffusion of that
// step, is at or above the low level of that strain (plasmLevels()). The stamp of a cell is the number of the step in
// which it last held plasm; the first step of a run has the number 0. A cell has slime at step t while it has a stamp
// S and t − S is below the life time in steps (slimeSteps()).
import { MAX_STRAINS, type Settings } from '../model/params';
import { STEPS_PER_MINUTE, trailLevels } from './flow';

/** The steps of an hour of model time: 1,800 (ADR 0029, decision 10), with the flow and without it. */
export const STEPS_PER_HOUR = 60 * STEPS_PER_MINUTE;

/**
 * What the field holds for a cell without a stamp. A new field holds it in every cell, and so does a field after a
 * reset.
 */
export const NO_STAMP = 0;

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
 * Whether the view draws the slime as a layer on the ground (ADR 0055, decision 8): the switch Show slime is on, the
 * model has slime with a life time above 0, and the scent view is off. Every style draws the layer. The scent view
 * draws none, so that its picture is the same with slime and without it. Display only: no pass of the simulation
 * reads the switch.
 */
export const slimeShown = (s: Pick<Settings, 'showSlime' | 'showScent' | 'model' | 'slimeLife'>) =>
  s.showSlime && !s.showScent && slimeSteps(s) > 0;

/**
 * The trail of each strain from which a cell holds plasm (ADR 0055, decision 3): the low level of the strain, the
 * level from which its tube body grows (flow.ts trailLevels()). One value per strain of the settings, at most four.
 * Every level is above 0.
 */
export function plasmLevels(s: Pick<Settings, 'strains' | 'stepOrder'>): number[] {
  return s.strains.slice(0, MAX_STRAINS).map((strain) => trailLevels(strain, s.stepOrder)[0]);
}
