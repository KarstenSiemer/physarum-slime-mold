// The Maze of the app on a CPU grid, its zones (shortest route, dead ends) and its measures. Prototype code.
import { PRESETS } from '../../../src/model/presets.ts';
import { buildWorld, centreCell, geodesic, siteCells, type World } from './world.ts';

export interface Zones {
  /** Geodesic distance from food A and from food B, and the length of the shortest route. */
  dA: Float64Array;
  dB: Float64Array;
  route: number;
  /** Detour of a cell: dA + dB − route. */
  detour: Float64Array;
  /** 1 on the shortest route's corridor: detour at most PATH_DETOUR. */
  path: Uint8Array;
  /** 1 in a dead end: detour at least DEAD_DETOUR. */
  dead: Uint8Array;
  pathCells: number;
  deadCells: number;
}

/** A cell lies on the route's corridor when the way over it is at most this many cells longer than the route. */
export const PATH_DETOUR = 30;
/** A cell lies in a dead end when the way over it is at least this many cells longer: it is 60 cells off a route. */
export const DEAD_DETOUR = 120;

export function mazeWorld(w = 512, h = 320): World {
  const maze = PRESETS.find((p) => p.id === 'maze')!;
  return buildWorld(w, h, 'box', maze.env ?? []);
}

export function zones(world: World, a = 0, b = 1): Zones {
  const dA = geodesic(world, siteCells(world, a));
  const dB = geodesic(world, siteCells(world, b));
  const route = dA[centreCell(world, b)]!;
  const n = world.w * world.h;
  const detour = new Float64Array(n);
  const path = new Uint8Array(n);
  const dead = new Uint8Array(n);
  let [pathCells, deadCells] = [0, 0];
  for (let c = 0; c < n; c++) {
    if (!world.open[c]) continue;
    detour[c] = dA[c]! + dB[c]! - route;
    if (detour[c]! <= PATH_DETOUR) {
      path[c] = 1;
      pathCells++;
    } else if (detour[c]! >= DEAD_DETOUR) {
      dead[c] = 1;
      deadCells++;
    }
  }
  return { dA, dB, route, detour, path, dead, pathCells, deadCells };
}

export interface Measure {
  step: number;
  alive: number;
  /** Mean trail per cell on the route's corridor and in the dead ends, and their ratio. */
  trailPath: number;
  trailDead: number;
  ratio: number;
  /** Agents per cell on the corridor and in the dead ends. */
  agentsPath: number;
  agentsDead: number;
  /** Whether cells with trail above twice the mean trail of the open cells join the two foods. */
  joined: boolean;
  /** The shortest way from food to food through those cells, over the shortest route through the maze. */
  tube: number;
}

export function measure(
  world: World,
  z: Zones,
  step: number,
  alive: number,
  trail: Float32Array,
  occ: Uint8Array,
): Measure {
  const n = world.w * world.h;
  let [tp, td, ap, ad, sum, open] = [0, 0, 0, 0, 0, 0];
  for (let c = 0; c < n; c++) {
    if (!world.open[c]) continue;
    open++;
    sum += trail[c]!;
    if (z.path[c]) {
      tp += trail[c]!;
      ap += occ[c]!;
    } else if (z.dead[c]) {
      td += trail[c]!;
      ad += occ[c]!;
    }
  }
  const level = (2 * sum) / open;
  const strong = (c: number) => world.open[c] === 1 && (trail[c]! > level || world.food[c] === 1);
  const d = geodesic(world, siteCells(world, 0), strong);
  const reach = Math.min(...siteCells(world, 1).map((c) => d[c]!));
  const joined = Number.isFinite(reach);
  const trailPath = tp / z.pathCells;
  const trailDead = td / z.deadCells;
  return {
    step,
    alive,
    trailPath,
    trailDead,
    ratio: trailPath / Math.max(trailDead, 1e-9),
    agentsPath: ap / z.pathCells,
    agentsDead: ad / z.deadCells,
    joined,
    tube: joined ? reach / z.route : 0,
  };
}
