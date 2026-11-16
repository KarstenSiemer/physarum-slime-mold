// The layout of the scene Corn maze (ADR 0051): a seeded generator. It makes a maze without loops on a grid of rooms
// (a walk that goes as deep as it can and then steps back), and then takes walls away, so that the maze gets loops.
// The scene holds the walls that this script prints for the seed CORN_SEED (CORN_MAZE in src/model/presets.ts), and
// research.test.ts checks that the two are equal.
// Usage: node --import ./research/flow/register.mjs research/flow/engine/corn-maze.ts [seed]
// Without a seed it tries the seeds from 1 on and prints the first that fits (fits() below), then the walls as the
// scene holds them.
import { fileURLToPath } from 'node:url';

/** The rooms of the maze, and the walls taken away for loops. */
export const CORN = { cols: 12, rows: 8, loops: 7 } as const;
/** The seed of the scene: the first that fits. */
export const CORN_SEED = 8;

/** A wall between the corners (x1, y1) and (x2, y2) of the rooms: room (i, j) has the corners (i, j) and (i+1, j+1). */
export type Wall = [x1: number, y1: number, x2: number, y2: number];

export interface CornMaze {
  cols: number;
  rows: number;
  /** open[a] holds the rooms that room a = j * cols + i has a door to. */
  open: number[][];
  /** The walls, each as long as it goes in one line. */
  walls: Wall[];
}

/** Mulberry32: a small random generator with a seed, the same on every machine. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function cornMaze(seed: number, { cols, rows, loops } = CORN): CornMaze {
  const rand = random(seed);
  const pick = (n: number) => Math.floor(rand() * n);
  const n = cols * rows;
  const open: number[][] = Array.from({ length: n }, () => []);
  const neighbours = (a: number) => {
    const [i, j] = [a % cols, Math.floor(a / cols)];
    const out: number[] = [];
    if (i > 0) out.push(a - 1);
    if (i < cols - 1) out.push(a + 1);
    if (j > 0) out.push(a - cols);
    if (j < rows - 1) out.push(a + cols);
    return out;
  };
  const join = (a: number, b: number) => {
    open[a]?.push(b);
    open[b]?.push(a);
  };
  // The maze without loops: from the entrance, go to a random room that no door leads to yet; step back at a dead end.
  const seen = new Uint8Array(n);
  const stack = [0];
  seen[0] = 1;
  while (stack.length > 0) {
    const a = stack[stack.length - 1] ?? 0;
    const fresh = neighbours(a).filter((b) => !seen[b]);
    if (fresh.length === 0) {
      stack.pop();
      continue;
    }
    const b = fresh[pick(fresh.length)] ?? 0;
    join(a, b);
    seen[b] = 1;
    stack.push(b);
  }
  // The loops: walls between two rooms, taken away at random.
  const closed: [number, number][] = [];
  for (let a = 0; a < n; a++) for (const b of neighbours(a)) if (b > a && !open[a]?.includes(b)) closed.push([a, b]);
  for (let k = 0; k < loops && closed.length > 0; k++) {
    const [[a, b] = [0, 0]] = closed.splice(pick(closed.length), 1);
    join(a, b);
  }
  // The walls that stay, joined along each line of the grid.
  const walls: Wall[] = [];
  const has = (a: number, b: number) => open[a]?.includes(b) ?? false;
  for (let i = 1; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      if (has(j * cols + i - 1, j * cols + i)) continue;
      const from = j;
      while (j + 1 < rows && !has((j + 1) * cols + i - 1, (j + 1) * cols + i)) j++;
      walls.push([i, from, i, j + 1]);
    }
  }
  for (let j = 1; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      if (has((j - 1) * cols + i, j * cols + i)) continue;
      const from = i;
      while (i + 1 < cols && !has((j - 1) * cols + i + 1, j * cols + i + 1)) i++;
      walls.push([from, j, i + 1, j]);
    }
  }
  return { cols, rows, open, walls };
}

/** The doors of a maze from its walls (the inverse of the last part of cornMaze()), for a list of walls of a scene. */
export function doorsOf(cols: number, rows: number, walls: readonly (readonly number[])[]): number[][] {
  const shut = new Set<string>();
  for (const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] of walls) {
    if (x1 === x2) for (let j = y1; j < y2; j++) shut.add(`${String(j * cols + x1 - 1)}-${String(j * cols + x1)}`);
    else for (let i = x1; i < x2; i++) shut.add(`${String((y1 - 1) * cols + i)}-${String(y1 * cols + i)}`);
  }
  const open: number[][] = Array.from({ length: cols * rows }, () => []);
  for (let a = 0; a < cols * rows; a++) {
    const [i, j] = [a % cols, Math.floor(a / cols)];
    for (const b of [...(i < cols - 1 ? [a + 1] : []), ...(j < rows - 1 ? [a + cols] : [])])
      if (!shut.has(`${String(a)}-${String(b)}`)) {
        open[a]?.push(b);
        open[b]?.push(a);
      }
  }
  return open;
}

/**
 * Every route from room `from` to room `to` that enters no room twice, over the doors that `holds` allows; the
 * shortest first. At most `limit` routes (a maze with many loops has very many).
 */
export function routes(
  open: readonly (readonly number[])[],
  from: number,
  to: number,
  holds: (a: number, b: number) => boolean = () => true,
  limit = 2000,
): number[][] {
  const out: number[][] = [];
  const on = new Uint8Array(open.length);
  const path: number[] = [];
  const walk = (a: number) => {
    if (out.length >= limit) return;
    path.push(a);
    on[a] = 1;
    if (a === to) out.push([...path]);
    else for (const b of open[a] ?? []) if (!on[b] && holds(a, b)) walk(b);
    on[a] = 0;
    path.pop();
  };
  walk(from);
  return out.sort((p, q) => p.length - q.length);
}

/** The rooms with one door. */
export const deadEnds = (open: readonly (readonly number[])[]) =>
  open.flatMap((doors, a) => (doors.length === 1 ? [a] : []));

/**
 * Whether a layout fits the scene: 3 to 8 routes from the entrance (the first room) to the exit (the last room), one
 * shortest route, and 3 or more dead ends beside the entrance and the exit.
 */
export function fits(maze: CornMaze): boolean {
  const last = maze.cols * maze.rows - 1;
  const all = routes(maze.open, 0, last);
  const blind = deadEnds(maze.open).filter((a) => a !== 0 && a !== last).length;
  return all.length >= 3 && all.length <= 8 && (all[1]?.length ?? 0) > (all[0]?.length ?? 0) && blind >= 3;
}

/** The maze as text: `#` a wall, a letter per room for the shortest route (`*`), any other route (`+`) or none. */
export function drawing(maze: CornMaze): string {
  const { cols, rows, open } = maze;
  const all = routes(open, 0, cols * rows - 1);
  const mark = new Map<number, string>();
  for (const route of all.slice(1)) for (const a of route) mark.set(a, '+');
  for (const a of all[0] ?? []) mark.set(a, '*');
  const lines: string[] = [];
  for (let j = 0; j < rows; j++) {
    let [top, mid] = ['#', '#'];
    for (let i = 0; i < cols; i++) {
      const a = j * cols + i;
      top += (j > 0 && open[a]?.includes(a - cols) ? '   ' : '###') + '#';
      mid += ` ${mark.get(a) ?? ' '} ` + (i < cols - 1 && open[a]?.includes(a + 1) ? ' ' : '#');
    }
    lines.push(top, mid);
  }
  lines.push('#'.repeat(cols * 4 + 1));
  return lines.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let seed = Number(process.argv[2] ?? 0);
  if (!seed) for (seed = 1; !fits(cornMaze(seed)); seed++);
  const maze = cornMaze(seed);
  const all = routes(maze.open, 0, maze.cols * maze.rows - 1);
  console.log(`seed ${String(seed)}, fits ${String(fits(maze))}`);
  console.log(drawing(maze));
  console.log(`routes in rooms: ${all.map((r) => r.length - 1).join(', ')}`);
  console.log(`dead ends: ${deadEnds(maze.open).join(', ')}`);
  console.log(`walls (${String(maze.walls.length)}):`);
  console.log(JSON.stringify(maze.walls));
}
