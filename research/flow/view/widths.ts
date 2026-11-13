// How wide and how bright the picture of the tubes draws a straight tube (ADR 0034, decision 2), with the rule of the
// app on the CPU (src/engine/tubes-reference.ts). A tube here is a band of cells along a periodic grid without a wall.
// Every cell of the band has a tube body of 1, a trail of 1 and the same flow memory, and no other cell holds trail.
//
// Usage: node --import ./research/flow/register.mjs research/flow/view/widths.ts
//
// One line for each width of the band and each flow memory:
// - `cells`: the width of the band, cells. `memory`: the flow memory of its cells.
// - `factor`: the factor of the radius on the middle line of the band, and `radius`: the radius of its disc, cells.
// - `middle`: the picture on the middle line. The trail is 1, so this is the brightness against the trail alone.
// - `half`: the cells across the tube that the picture draws at half of `middle` or more.
// - `drawn`: the cells across the tube that the picture draws at all.
import { FLOW } from '../../../src/engine/flow.ts';
import { TUBES } from '../../../src/engine/tubes.ts';
import { tubePicture, tubeRoots, type TubeGrid } from '../../../src/engine/tubes-reference.ts';

/** The widths of the band: one cell, the three cells of the window of the rule, and a band as wide as in the scenes. */
const BANDS = [1, 3, 7];
/** The flow memories: three that are 16 times apart, fresh ground, and the largest. */
const MEMORIES = [0.0025, 0.04, 0.64, FLOW.fresh, 1];
const [W, H] = [16, 41];
const MIDDLE = (H - 1) / 2;

for (const cells of BANDS)
  for (const d of MEMORIES) {
    const memory = new Float32Array(W * H * 4);
    const trail = new Float32Array(W * H * 4);
    const first = MIDDLE - (cells - 1) / 2;
    for (let y = first; y < first + cells; y++)
      for (let x = 0; x < W; x++) {
        const c = y * W + x;
        [memory[c * 4], memory[c * 4 + 1], trail[c * 4]] = [d, 1, 1];
      }
    const grid: TubeGrid = { width: W, height: H, boundary: 'wrap', shape: new Uint8Array(W * H * 4) };
    const roots = tubeRoots(grid, [memory]);
    const picture = tubePicture(grid, trail, roots);
    /** The values of the strain across the tube, on the column in the middle of the grid. */
    const across = (field: Float32Array) => Array.from({ length: H }, (_, y) => field[(y * W + W / 2) * 4] ?? 0);
    const factor = across(roots)[MIDDLE] ?? 0;
    const column = across(picture);
    const middle = column[MIDDLE] ?? 0;
    console.log(
      JSON.stringify({
        cells,
        memory: d,
        factor: +factor.toFixed(3),
        radius: +(TUBES.radius * factor).toFixed(2),
        middle: +middle.toFixed(3),
        half: column.filter((v) => v >= 0.5 * middle).length,
        drawn: column.filter((v) => v > 0).length,
      }),
    );
  }
