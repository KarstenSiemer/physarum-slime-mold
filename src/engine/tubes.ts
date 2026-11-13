// The picture of the tubes (ADR 0034): while the flow in the tubes is on, the view draws every tube as wide and as
// bright as its flow memory says. Display only: no pass of the simulation reads the picture.
//
// The rule, per strain. `tubes.wgsl` and `gl/glsl/tubes.frag` run it on the GPU, and `tubes-reference.ts` on the CPU
// for the tests.
//
// 1. The strength of the tube of a cell is its tube body times its flow memory, and 0 on a cell without a tube
//    (FLOW.bodyLow). The flow memory is the conductivity of a tube in the model of Tero, Kobayashi and Nakagaki.
// 2. The strength across the tube: the sum of the strengths over the 3 × 3 cells around the cell, over the 3 cells
//    that a tube is long there (`span`), and at most 1. For a tube up to 3 cells wide that is the sum across it.
// 3. The radius of the tube is `radius` cells times the fourth root of that strength: for Poiseuille's flow the
//    conductivity of a round tube grows with the fourth power of its radius. The brightness has the same factor: a
//    tube twice as thick holds twice as much plasmodium below a point of the picture.
// 4. Every cell with a tube is a disc of that radius with an edge `edge` cells wide. The weight of a disc at a cell
//    is its factor times how much of the cell it covers. A cell of the picture takes the largest weight of the discs
//    that reach it, times the mean of the trails of their cells by weight. One disc alone gives its trail times its
//    weight; many give a smooth tube, where the largest value of the discs gave scales. The cell holds at least
//    `sheet` times its own trail: the plasmodium without a tube stays in the picture, fainter than a tube.
// 5. A disc does not pass a wall: it reaches a cell only if the distances of both cells to the outline of the walls
//    are together more than the distance between the cells. Then no wall lies on the line between them.
import type { Settings } from '../model/params';
import { flowOn } from './flow';

export const TUBES = {
  /** The radius of a tube whose strength is 1, cells. */
  radius: 3.5,
  /** The width of the edge of a disc, cells: the cover falls from 1 to 0 across it. */
  edge: 1,
  /** The brightness of the plasmodium without a tube, against a tube whose strength is 1. */
  sheet: 0.25,
  /** The cells that a tube is long in the 3 × 3 cells around a cell. */
  span: 3,
} as const;

/**
 * The farthest that a disc reaches, cells: the radius and half the edge. It is at most SHAPE_RANGE (4 cells), the
 * range in which the engine holds the distance of a cell to the outline of a wall (paint.wgsl): farther out a wall
 * could lie on the line between two cells without the distances showing it.
 */
export const TUBE_REACH = TUBES.radius + TUBES.edge / 2;

/** The window of the picture pass: the whole cells that lie nearer than TUBE_REACH. */
export const TUBE_WINDOW = Math.ceil(TUBE_REACH) - 1;

/**
 * Whether the view draws the picture of the tubes: the setting is on, the flow runs, and the style draws the trail.
 * The agents style draws the agents, and it takes the strain of an agent that stayed from the trail of its cell.
 */
export const tubesShown = (s: Pick<Settings, 'showTubes' | 'flow' | 'model' | 'style'>) =>
  s.showTubes && flowOn(s) && s.style !== 'agents';
