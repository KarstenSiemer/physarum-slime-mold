// The picture of the tubes (ADR 0034): while the flow in the tubes is on, the view draws every tube as wide and as
// bright as its tube body and its flow memory say. Display only: no pass of the simulation reads the picture.
//
// The rule, per strain. `tubes.wgsl` and `gl/glsl/tubes.frag` run it on the GPU, and `tubes-reference.ts` on the CPU
// for the tests.
//
// 1. The strength of the tube of a cell is its tube body times its flow memory, and 0 on a cell without a tube
//    (FLOW.bodyLow) and on a cell of a wall. The flow memory is the conductivity of a tube in the model of Tero,
//    Kobayashi and Nakagaki.
// 2. The strength across the tube, on a cell with a tube: the sum of the strengths over the 3 × 3 cells around the
//    cell, over the 3 cells that a tube is long there (`span`), and at most 1. A cell at a corner of the cell adds
//    nothing if the two cells beside that corner are both walls: no plasmodium goes from one to the other, as growth
//    puts no child there (growth.wgsl). On the middle line of a tube up to
//    3 cells wide that is the sum across it. At the edge of a tube and in a wider band of cells it is the sum of the
//    2 or 3 cells across that the 3 × 3 cells hold. A cell without a tube has none: it is no disc.
// 3. The radius of the disc of a cell is `radius` cells times the fourth root of that strength: for Poiseuille's flow
//    the conductivity of a round tube grows with the fourth power of its radius. The brightness has the same factor:
//    a tube twice as thick holds twice as much plasmodium below a point of the picture.
// 4. Every cell with a tube is a disc of that radius with an edge `edge` cells wide. The weight of a disc at a cell
//    is its factor times how much of the cell it covers. A cell of the picture takes the largest weight of the discs
//    that reach it, times the mean of the trails of their cells by weight. One disc alone gives its trail times its
//    weight; many give a smooth tube, where the largest value of the discs gave scales. The cell holds at least
//    `sheet` times its own trail: the plasmodium without a tube stays in the picture, fainter than a tube.
// 5. A disc does not pass a wall: it reaches another cell only if neither cell is a wall cell and no wall cell lies
//    on the line between the centres of the two cells. A line through the corner of a cell is on that cell, so no
//    disc passes between two wall cells that touch at a corner. That is the rule of a move of the model, which
//    takes no line that touches a wall cell (clearPath in agents.wgsl). A cell that is no wall is always reached by
//    its own disc.
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

/** The farthest that a disc reaches, cells: the radius and half the edge. */
export const TUBE_REACH = TUBES.radius + TUBES.edge / 2;

/** The window of the picture pass: the whole cells that lie nearer than TUBE_REACH. */
export const TUBE_WINDOW = Math.ceil(TUBE_REACH) - 1;

/**
 * Whether the view draws the picture of the tubes: the setting is on, the flow runs, and the style draws the trail.
 * The agents style draws the agents, and it takes the strain of an agent that stayed from the trail of its cell.
 */
export const tubesShown = (s: Pick<Settings, 'showTubes' | 'flow' | 'model' | 'style'>) =>
  s.showTubes && flowOn(s) && s.style !== 'agents';
