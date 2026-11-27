// The layout of the Y-maze of Reid et al. 2012, for the measurement of the avoidance of slime (ADR 0056, stage 2b).
// The layout lives in src/model/y-maze.ts since the scene Y-maze with slime runs it (ADR 0066). This file keeps the
// path of the research code: y-maze.gpu.test.ts runs the layout in the real engine, y-maze.test.ts checks it, and the
// prototype of stage 4 builds on it (research/front/layouts.ts). It adds the layout as text. This file runs in the
// browser too, so it imports nothing of Node.
import { SIDES, type YMaze } from '../../../src/model/y-maze';

export * from '../../../src/model/y-maze';

/** The layout as text: `#` a wall, `.` open ground, `b` the base, `l` and `r` the own parts of the arms, `F` food. */
export function drawing(maze: YMaze): string {
  const { w, h } = maze;
  const mark = new Map<number, string>();
  for (const c of maze.base) mark.set(c, 'b');
  for (const c of maze.arm.left) mark.set(c, 'l');
  for (const c of maze.arm.right) mark.set(c, 'r');
  for (const side of SIDES) for (const c of maze.food[side]) mark.set(c, 'F');
  const lines: string[] = [];
  for (let y = 0; y < h; y++) {
    let line = '';
    for (let x = 0; x < w; x++) line += maze.open[y * w + x] ? (mark.get(y * w + x) ?? '.') : '#';
    lines.push(line);
  }
  return lines.join('\n');
}
