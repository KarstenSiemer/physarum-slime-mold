// The layout of the Y-maze (src/model/y-maze.ts, ADR 0066) as the paint passes of the app paint it: its own mirror
// image, cell for cell, with the sizes of Reid et al. 2012 at the scale of the Tokyo scene.
import { describe, expect, it } from 'vitest';
import { fromShape, strokeOn } from '../../../src/engine/environment';
import { paintReference, strokeCells } from '../../../src/engine/paint-reference';
import { foodStrokes } from '../../../src/engine/sites';
import { SLIME_FULL } from '../../../src/engine/slime';
import { paintedAmount } from '../../../src/engine/slime-reference';
import { RUN_RADIUS, SIDES, Y_MAZE, yMaze, type Side } from '../../../src/model/y-maze';
import { drawing } from './y-maze';

const WIDTHS = [19, 9];

/** The layout as the paint passes paint it: per cell a wall, food and slime, and how near a cell lies to a brush edge. */
function painted(width: number, slimed: readonly Side[]) {
  const maze = yMaze(width);
  const { w, h } = maze;
  const env = new Uint8Array(w * h * 4);
  const stamped = new Uint8Array(w * h);
  const margin = { min: Infinity };
  const edits = maze.shapes(slimed).map((shape) => fromShape(shape, 'box'));
  for (const edit of edits) {
    const stroke = strokeOn(edit, w, h);
    if (!stroke) throw new Error('a shape lies outside the lattice');
    paintReference(env, w, h, stroke, 'box', margin);
    if (stroke.kind === 'slime') strokeCells(w, h, stroke, 'box', (c) => (stamped[c] = 1));
  }
  const cells = Array.from({ length: w * h }, (_, c) => c);
  const wall = cells.map((c) => (env[c * 4] ?? 0) >= 128);
  return {
    maze,
    edits,
    margin: margin.min,
    wall,
    food: cells.map((c) => (env[c * 4 + 1] ?? 0) > 0),
    // The brush of the Slime tool stamps the cells of its stroke that hold no wall (docs/model.md, 6.9).
    slime: cells.map((c) => stamped[c] === 1 && !wall[c]),
  };
}

const mirrorOf = (c: number, w: number) => Math.floor(c / w) * w + (w - 1 - (c % w));
const sorted = (cells: readonly number[]) => [...cells].sort((a, b) => a - b);
const cellsOf = (mask: readonly boolean[]) => mask.flatMap((on, c) => (on ? [c] : []));

describe('the layout of the Y-maze', () => {
  it.each(WIDTHS)('is its own mirror image on the grid, with arms of %i cells', (width) => {
    const { maze, wall, food, slime } = painted(width, SIDES);
    const { w } = maze;
    expect(w % 2).toBe(1);
    for (const mask of [wall, food, slime]) expect(mask.map((_, c) => mask[mirrorOf(c, w)])).toEqual(mask);
    expect(sorted(maze.arm.left.map((c) => mirrorOf(c, w)))).toEqual(maze.arm.right);
    expect(sorted(maze.food.left.map((c) => mirrorOf(c, w)))).toEqual(sorted(maze.food.right));
    expect(sorted(maze.base.map((c) => mirrorOf(c, w)))).toEqual(maze.base);
    // The colony starts on the axis.
    expect(maze.start[0]).toBe(w / 2);
    for (const c of maze.arm.left) expect(maze.along[c]).toBe(maze.along[mirrorOf(c, w)]);
  });

  it.each(WIDTHS)('paints the cells that the layout names, and none near the edge of a brush (%i cells)', (width) => {
    for (const slimed of [[], ['left'], ['right'], SIDES] as const) {
      const { maze, wall, food, slime, margin } = painted(width, slimed);
      expect(wall).toEqual(Array.from(maze.open, (o) => o === 0));
      expect(cellsOf(food)).toEqual(sorted([...maze.food.left, ...maze.food.right]));
      expect(cellsOf(slime)).toEqual(sorted(slimed.flatMap((side) => maze.arm[side])));
      // Float32 on the GPU rounds a cell that lies this near to the edge of a brush either way.
      expect(margin).toBeGreaterThan(0.05);
    }
  });

  it.each(WIDTHS)('keeps the base, the two arms and the foods apart (%i cells)', (width) => {
    const { maze, edits } = painted(width, SIDES);
    const { w, h, open, base, arm, food } = maze;
    const parts = [base, arm.left, arm.right];
    expect(new Set(parts.flat()).size).toBe(parts.flat().length);
    for (const c of parts.flat()) expect(open[c]).toBe(1);
    for (const side of SIDES) for (const c of food[side]) expect(arm[side]).toContain(c);
    // Two strokes of food are two food sites of the flow, the left one first.
    expect(foodStrokes(edits).length).toBe(2);
    // A wall of at least `margin` cells lies around the Y.
    for (let c = 0; c < w * h; c++) {
      const [x, y] = [c % w, Math.floor(c / w)];
      const inside = Math.min(x, y, w - 1 - x, h - 1 - y) >= Y_MAZE.margin;
      if (!inside) expect(open[c]).toBe(0);
    }
    // Every open cell is joined to the start by steps to the 4 neighbours.
    const seen = new Uint8Array(w * h);
    const stack = [Math.floor(maze.start[1]) * w + Math.floor(maze.start[0])];
    seen[stack[0] ?? 0] = 1;
    for (let c = stack.pop(); c !== undefined; c = stack.pop())
      for (const next of [c - 1, c + 1, c - w, c + w])
        if (open[next] && !seen[next]) {
          seen[next] = 1;
          stack.push(next);
        }
    expect([...seen]).toEqual([...open]);
  });

  it('has the sizes of Reid et al. 2012 at 0.537 mm per cell', () => {
    const mm = (cells: number) => cells * Y_MAZE.mmPerCell;
    const maze = yMaze(19);
    // A base of 1 cm², arms of 4 cm.
    expect(maze.base.length).toBe(19 * 19);
    expect(mm(19) ** 2 / 100).toBeCloseTo(1, 1);
    expect(mm(maze.size.length) / 10).toBeCloseTo(4, 1);
    expect(maze.size.width).toBeCloseTo(19, 0);
    expect(yMaze(9).size.width).toBeCloseTo(9, 0);
    expect(yMaze(9).size.length).toBe(maze.size.length);
    // The food of an arm lies at its far end: its last cells are on the last diagonal of the arm.
    for (const width of WIDTHS) {
      const narrow = yMaze(width);
      const far = Math.max(...narrow.arm.right.map((c) => narrow.along[c] ?? 0));
      expect(Math.max(...narrow.food.right.map((c) => narrow.along[c] ?? 0))).toBeGreaterThan(far - 1);
    }
    // The own part of an arm of 19 cells: 91 of its 105 diagonals, 64.3 cells long and 19.09 cells wide.
    expect(maze.arm.right.length).toBe(1228);
    expect(drawing(maze).split('\n').length).toBe(maze.h);
  });

  // ADR 0066: the scene Y-maze with slime paints the slime of its arm with the runs, which stamp its cells but give
  // them a fifth of the full amount of slime, and with a film that gives the amount for the picture.
  it.each(WIDTHS)('gives a slimed arm a film of the full amount, and no other cell slime (%i cells)', (width) => {
    const maze = yMaze(width);
    const { w, h, open } = maze;
    for (const side of SIDES) {
      const amount = new Float64Array(w * h);
      const stamped = new Uint8Array(w * h);
      const runs = maze.shapes([side]).filter((shape) => shape.kind === 'slime');
      const film = maze.film([side]);
      expect(film).toHaveLength(1);
      /** The distance of the nearest open cell to the edge of a stroke, over all strokes: for float32 on the GPU. */
      let margin = Infinity;
      for (const shape of [...runs, ...film]) {
        const stroke = strokeOn(fromShape(shape, 'box'), w, h);
        if (!stroke) throw new Error('a film lies outside the lattice');
        strokeCells(w, h, { ...stroke, radius: stroke.radius + 1 }, 'box', (c, d) => {
          if (open[c]) margin = Math.min(margin, Math.abs(d - stroke.radius));
        });
        strokeCells(w, h, stroke, 'box', (c, d) => {
          if (!open[c]) return;
          stamped[c] = 1;
          amount[c] = Math.max(amount[c] ?? 0, paintedAmount(d, stroke.radius));
        });
      }
      // The slime stamps the own part of the arm and no other cell, as the runs alone do.
      expect(cellsOf(Array.from(stamped, (v) => v === 1))).toEqual(sorted(maze.arm[side]));
      expect(margin).toBeGreaterThan(0.05);
      // A run alone gives 737 of 4,095. The film gives the full amount to every cell of the own part that lies more
      // than 21 cells from the apex along the arm: 1,126 of the 1,228 cells of an arm of 19 cells.
      const own = maze.arm[side];
      expect(paintedAmount(0, RUN_RADIUS)).toBe(737);
      expect(Math.min(...own.map((c) => amount[c] ?? 0))).toBe(737);
      for (const c of own) if ((maze.along[c] ?? 0) > 21) expect(amount[c], `cell ${String(c)}`).toBe(SLIME_FULL);
      if (width === 19) expect(own.filter((c) => amount[c] === SLIME_FULL)).toHaveLength(1126);
    }
  });
});
