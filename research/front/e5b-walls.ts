// Part E5b of stage 4 (ADR 0087, decision 2): the walls and the food of the scene Crown of veins against neck() of the
// prototype, cell for cell, and the depth that the picture lights inside the walls against the depth inside the two
// blocks of the neck. The picture lights a wall by the signed distance to the outline of its strokes, the largest over
// the strokes (paint.wgsl), clamped to SHAPE_RANGE (4 cells); inside a block of the neck the depth is the distance to
// its lower edge or to the channel, whichever is less. Usage:
//   node --import ./research/flow/register.mjs research/front/e5b-walls.ts
import { segmentDistance } from '../../src/engine/brush';
import { fromShape, strokeOn } from '../../src/engine/environment';
import { paintReference } from '../../src/engine/paint-reference';
import { SHAPE_RANGE } from '../../src/engine/types';
import { CROWN, presetById } from '../../src/model/presets';
import { neck } from './layouts';

const p = presetById('crown');
if (!p) throw new Error('no scene crown');
const [w, h] = CROWN.lattice;
const env = new Uint8Array(w * h * 4);
const margin = { min: Infinity };
const strokes = (p.env ?? []).map((e) => {
  const s = strokeOn(fromShape(e, 'box'), w, h);
  if (!s) throw new Error('a shape lies outside the grid');
  paintReference(env, w, h, s, 'box', margin);
  return s;
});
const L = neck(w, h, CROWN.wide, CROWN.long, [[w / 2, CROWN.foodY, CROWN.foodR]]);
const [a, b] = [Math.round((w - CROWN.wide) / 2), Math.round((w + CROWN.wide) / 2)];
let [wallDiff, foodDiff, walls, foods] = [0, 0, 0, 0];
for (let c = 0; c < w * h; c++) {
  const wall = (env[c * 4] ?? 0) >= 128 ? 1 : 0;
  const food = (env[c * 4 + 1] ?? 0) >= 128 && !wall ? 1 : 0;
  walls += wall;
  foods += food;
  if (wall !== L.wall[c]) wallDiff++;
  if (food !== L.food[c]) foodDiff++;
}
const clamp = (v: number) => Math.max(-SHAPE_RANGE, Math.min(SHAPE_RANGE, v));
// The largest shortfall of the lit depth, outside the two corners of 8 × 8 cells at the mouth and in them.
let [outside, at, corner] = [0, '', 0];
for (let y = 0; y < CROWN.long; y++)
  for (let x = 0; x < w; x++) {
    if (!L.wall[y * w + x]) continue;
    const [cx, cy] = [x + 0.5, y + 0.5];
    let union = -Infinity;
    for (const s of strokes)
      if (s.kind === 'wall') union = Math.max(union, s.radius - segmentDistance(cx, cy, s.from, s.to));
    const edge = cx < w / 2 ? a - cx : cx - b;
    const short = clamp(Math.min(CROWN.long - cy, edge)) - clamp(union);
    if (CROWN.long - cy < 8 && edge < 8) corner = Math.max(corner, short);
    else if (short > outside) [outside, at] = [short, `${String(x)}, ${String(y)}`];
  }
console.log(`${String(p.env?.length)} shapes`);
console.log(`walls: ${String(walls)} cells, ${String(wallDiff)} differ from neck()`);
console.log(`food: ${String(foods)} cells, ${String(foodDiff)} differ from neck()`);
console.log(`the least distance of a cell centre to the edge of a stroke: ${margin.min.toFixed(3)} cells`);
console.log(`the lit depth falls short by at most ${outside.toFixed(4)} cells outside the corners (at ${at})`);
console.log(`and by at most ${corner.toFixed(2)} cells in the two corners of 8 × 8 cells at the mouth`);
