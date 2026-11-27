// The measures of the scenes Snail maze and Corn maze (ADR 0051) on the dumps of the real engine (dump.gpu.test.ts):
// one line per dumped step and one line for the whole run, and pictures of the trail.
// Usage: node --import ./research/flow/register.mjs research/flow/engine/measure-mazes.ts <scene> <name> [<name> ...]
//
// The measures of the Maze (prototype/maze.ts), on the grid of the scene: `ratio` is the mean trail on the shortest
// route over the mean trail in the dead ends, `joined` says whether cells with a trail above twice the mean join the
// two foods, and `tube` is the length of the way through those cells over the shortest route. Here a dead end is every
// cell from which the way from food to food is 120 cells or more longer than the shortest route: in the Corn maze
// that also holds the longer routes.
//
// `onRoute` is the share of the cells with such a trail that lie on the shortest route.
//
// Snail maze: `blind` lists the mean trail of each blind branch over the mean trail on the route (a branch is empty
// below 0.10, as the Maze measures it), and `blindFlow` the same for the flow memory.
// Corn maze: `routes` lists the routes that hold a tube from end to end, each by its number of rooms; a route holds a
// tube when the tube crosses every door between its rooms. `doors` counts the doors that a tube crosses. `flowRoutes`
// and `flowDoors` are the same for the flow memory above 0.5.
// The line of a run holds means over the dumps of its last 10,000 steps: the colony keeps growing short branches
// into empty corridors, so one dump alone says little.
//
// UNTIL=<step>: only the dumps up to that step count, so that a long run gives the lines of a run of that length.
// WINDOW=<steps>: after the line of a run, one line per window of that many steps, for a long run (ADR 0054): the
// share of its dumps in which the tube joins the foods and the share of the tube cells on the route; for the Snail
// maze the mean of the blind branches and the share of the pairs of a dump and a branch with 0.10 or more; for the Corn
// maze the shares of the dumps with a tube on another route than the shortest, and with flow on the shortest alone.
// GROUND=1: the line of a dump also holds `offClosed`: of the cells with such a trail that do not lie on the
// shortest route, the share on closed ground (a flow memory below 0.01). No child is born onto closed ground (ADR
// 0054), so these cells hold agents that walked there. For the Corn maze it holds `detours` too: for each longer
// route with a tube in this dump, the share of closed ground in the rooms of that route that the shortest route
// does not cross. The line of the run holds the mean of `offClosed` and the least share of the detours.
import { readdirSync, readFileSync } from 'node:fs';
import { FLOW } from '../../../src/engine/flow.ts';
import { CORN_MAZE, PRESETS } from '../../../src/model/presets.ts';
import { measure, zones } from '../prototype/maze.ts';
import { outDir } from '../prototype/out.ts';
import { buildWorld, geodesic, picture, siteCells, writePng } from '../prototype/world.ts';
import { doorsOf, routes } from './corn-maze.ts';

const DIR = process.env.DIR ?? outDir('engine/');
const [scene = 'snail-maze', ...names] = process.argv.slice(2);
const preset = PRESETS.find((p) => p.id === scene);
const lattice = preset?.settings().lattice;
if (!preset || !lattice) throw new Error(`no scene with a lattice: ${scene}`);
const world = buildWorld(lattice[0], lattice[1], 'box', preset.env ?? []);
const { w, h } = world;
const n = w * h;
// The cells that no way from the first food reaches hold no colony (the corners outside the Snail maze): they do not
// count as open, so they are no dead end and do not lower the mean trail.
{
  const reach = geodesic(world, siteCells(world, 0));
  for (let c = 0; c < n; c++) if (!Number.isFinite(reach[c]!)) world.open[c] = 0;
}
const z = zones(world);

const read = (file: string) =>
  new Float32Array(new Uint8Array(Buffer.from(readFileSync(DIR + file, 'utf8'), 'base64')).buffer);

/** The blind branches of the Snail maze: the groups of dead-end cells that touch each other. */
function branches(): number[][] {
  const group = new Int32Array(n).fill(-1);
  const out: number[][] = [];
  for (let c = 0; c < n; c++) {
    if (!z.dead[c] || group[c]! >= 0) continue;
    const cells = [c];
    group[c] = out.length;
    // The list grows while the loop reads it.
    for (const at of cells) {
      for (const next of [at - 1, at + 1, at - w, at + w])
        if (next >= 0 && next < n && z.dead[next] && group[next]! < 0) {
          group[next] = out.length;
          cells.push(next);
        }
    }
    out.push(cells);
  }
  // A group of a few cells is the tip of a zone at a wall, or what the zone holds of a short branch.
  return out.filter((cells) => cells.length >= 500);
}

/** The rooms of the Corn maze, its doors, and its routes from the entrance to the exit. */
function corn() {
  const { cols, rows, room, walls } = CORN_MAZE;
  const open = doorsOf(cols, rows, walls);
  const all = routes(open, 0, cols * rows - 1);
  const roomOf = (c: number) => Math.floor(Math.floor(c / w) / room) * cols + Math.floor((c % w) / room);
  // The cells of the door between two rooms: the two lines of cells on both sides of the border.
  const door = (a: number, b: number): number[] => {
    const [lo, hi] = [Math.min(a, b), Math.max(a, b)];
    const [i, j] = [hi % cols, Math.floor(hi / cols)];
    const out: number[] = [];
    for (let k = 0; k < room; k++)
      for (const side of [-1, 0])
        out.push(hi - lo === 1 ? (j * room + k) * w + i * room + side : (j * room + side) * w + i * room + k);
    return out.filter((c) => world.open[c]);
  };
  // The length of a route in cells: the shortest way from food to food through its rooms and its doors.
  const cellsOf = all.map((route) => {
    const on = new Set(route);
    const shut = new Set<number>();
    for (const a of route)
      for (const b of open[a] ?? [])
        if (b > a && on.has(b) && Math.abs(route.indexOf(a) - route.indexOf(b)) !== 1)
          for (const c of door(a, b)) shut.add(c);
    const d = geodesic(world, siteCells(world, 0), (c) => !!world.open[c] && on.has(roomOf(c)) && !shut.has(c));
    return Math.min(...siteCells(world, 1).map((c) => d[c]!));
  });
  return { open, all, cellsOf, door, roomOf };
}

const blind = scene === 'snail-maze' ? branches() : [];
const maze = scene === 'corn-maze' ? corn() : undefined;
console.log(
  `${scene} ${String(w)}x${String(h)} route ${z.route.toFixed(0)} cells, on the route ${String(z.pathCells)} cells, dead ends ${String(z.deadCells)} cells` +
    (maze
      ? `, routes in rooms ${maze.all.map((r) => r.length - 1).join(',')}, in cells over the shortest ${maze.cellsOf.map((c) => (c / (maze.cellsOf[0] ?? 1)).toFixed(2)).join(',')}`
      : `, blind branches of ${blind.map((b) => b.length).join(',')} cells`),
);

// Without the name of a run: a picture of the maze, its route in yellow and its dead ends in red.
if (names.length === 0) {
  const zonesOf = Float32Array.from({ length: n }, (_, c) => (z.path[c] ? 1 : 0));
  const overlay = [{ cells: z.dead, colour: [200, 60, 60] as [number, number, number] }];
  writePng(`${DIR}${scene}-zones.png`, w, h, picture(world, zonesOf, 2, [255, 220, 90], overlay), 2);
}

/** The last steps of a run that the line of the run is a mean over. */
const TAIL = 10_000;
/** The steps of a window of a long run; 0 prints no windows. */
const WINDOW = Number(process.env.WINDOW ?? 0);
/** Only the dumps up to this step: a long run then gives the lines of a run that ended there. */
const UNTIL = Number(process.env.UNTIL ?? Infinity);
/** GROUND=1: also the trail on closed ground, and the closed ground under the tubes of the longer routes. */
const GROUND = process.env.GROUND === '1';
const mean = (list: number[]) => list.reduce((a, b) => a + b, 0) / Math.max(list.length, 1);
const share = (list: boolean[]) => mean(list.map(Number)).toFixed(2);

for (const name of names) {
  const steps = readdirSync(DIR)
    .filter((f) => f.startsWith(name + '-trail-') && f.endsWith('.f32.b64'))
    .map((f) => Number(/-trail-(\d+)\.f32\.b64$/.exec(f)?.[1]))
    .filter((step) => step <= UNTIL)
    .sort((a, b) => a - b);
  const log = readFileSync(DIR + name + '.jsonl', 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as { step?: number; alive?: number[]; ms?: number });
  const rows: {
    step: number;
    joined: boolean;
    tube: number;
    ratio: number;
    onRoute: number;
    /** Snail maze: the trail and the flow memory of each blind branch over those of the route. */
    blind: number[];
    blindFlow: number[];
    /** Corn maze: the routes with a tube and the routes that carry flow, each by its number of rooms. */
    routes: number[];
    flowRoutes: number[];
    /** GROUND: of the cells with a tube off the route, the share on closed ground; the closed share of each detour. */
    offClosed: number;
    detours: number[];
  }[] = [];
  for (const step of steps) {
    const trail = read(`${name}-trail-${String(step)}.f32.b64`);
    const d = read(`${name}-D-${String(step)}.f32.b64`);
    const row = log.find((l) => l.step === step);
    const m = measure(world, z, step, row?.alive?.[0] ?? 0, trail, new Uint8Array(n));
    let [sum, open, all, on, flowOnRoute] = [0, 0, 0, 0, 0];
    for (let c = 0; c < n; c++)
      if (world.open[c]) {
        sum += trail[c]!;
        open++;
        if (z.path[c]) flowOnRoute += d[c]!;
      }
    const level = (2 * sum) / open;
    const strong = (c: number) => world.open[c] === 1 && trail[c]! > level;
    let closedOff = 0;
    for (let c = 0; c < n; c++)
      if (strong(c)) {
        all++;
        if (z.path[c]) on++;
        else if (d[c]! < FLOW.half) closedOff++;
      }
    const onRoute = on / Math.max(all, 1);
    const offClosed = closedOff / Math.max(all - on, 1);
    const detours: number[] = [];
    const per = (field: Float32Array, cells: number[], route: number) =>
      cells.reduce((s, c) => s + field[c]!, 0) / cells.length / Math.max(route, 1e-9);
    const shares = blind.map((cells) => per(trail, cells, m.trailPath));
    const flowShares = blind.map((cells) => per(d, cells, flowOnRoute / z.pathCells));
    let [routesNow, flowNow] = [[] as number[], [] as number[]];
    let extra: string;
    if (maze) {
      // A door holds a tube when a cell of it has a trail above the level, and it carries flow when a cell of it has
      // a flow memory above 0.5: there a dead agent comes back to life (docs/model.md).
      const tube = (a: number, b: number) => maze.door(a, b).some(strong);
      const flows = (a: number, b: number) => maze.door(a, b).some((c) => d[c]! > 0.5);
      const count = (holds: (a: number, b: number) => boolean) =>
        maze.open.reduce((total, list, a) => total + list.filter((b) => b > a && holds(a, b)).length, 0);
      const through = (holds: (a: number, b: number) => boolean) =>
        maze.all.filter((r) => r.every((a, k) => k === 0 || holds(r[k - 1]!, a))).map((r) => r.length - 1);
      [routesNow, flowNow] = [through(tube), through(flows)];
      extra = `routes ${routesNow.join(',') || '-'} doors ${String(count(tube))} flowRoutes ${flowNow.join(',') || '-'} flowDoors ${String(count(flows))}`;
      if (GROUND) {
        const first = new Set(maze.all[0]);
        for (const r of maze.all.slice(1).filter((list) => routesNow.includes(list.length - 1))) {
          const off = new Set(r.filter((a) => !first.has(a)));
          let [cells, closed] = [0, 0];
          for (let c = 0; c < n; c++)
            if (world.open[c] && off.has(maze.roomOf(c))) {
              cells++;
              if (d[c]! < FLOW.half) closed++;
            }
          detours.push(closed / Math.max(cells, 1));
        }
        const list = routesNow.filter((l) => l !== (maze.all[0]?.length ?? 0) - 1);
        extra += ` detours ${list.map((l, k) => `${String(l)}:${(detours[k] ?? 0).toFixed(2)}`).join(',') || '-'}`;
      }
    } else {
      extra = `blind ${shares.map((s) => s.toFixed(2)).join(',')} blindFlow ${flowShares.map((s) => s.toFixed(2)).join(',')}`;
    }
    if (GROUND) extra += ` offClosed ${offClosed.toFixed(2)}`;
    rows.push({
      step,
      joined: m.joined,
      tube: m.tube,
      ratio: m.ratio,
      onRoute,
      blind: shares,
      blindFlow: flowShares,
      routes: routesNow,
      flowRoutes: flowNow,
      offClosed,
      detours,
    });
    writePng(`${DIR}${name}-trail-${String(step)}.png`, w, h, picture(world, trail, 12), 2);
    console.log(
      `${name} ${String(step)} alive ${String(m.alive)} ratio ${m.ratio.toFixed(2)} joined ${String(m.joined)} tube ${m.tube.toFixed(2)} onRoute ${onRoute.toFixed(2)} ${extra} tP ${m.trailPath.toFixed(3)} tD ${m.trailDead.toFixed(4)} ms ${String(row?.ms)}`,
    );
  }
  // The line of the run: the first joined step, and means over the dumps of the last TAIL steps.
  const end = rows[rows.length - 1]?.step ?? 0;
  const tail = rows.filter((r) => r.step > end - TAIL);
  const joinedTail = tail.filter((r) => r.joined);
  // The first step from which `test` holds at every later dump; 0 when it does not hold at the last one.
  const from = (test: (r: (typeof rows)[number]) => boolean) => {
    let step = 0;
    for (const r of rows) step = test(r) ? step || r.step : 0;
    return step;
  };
  const alone = (list: number[]) => list.length === 1 && list[0] === (maze?.all[0]?.length ?? 0) - 1;
  const lines = [
    `joined at ${String(rows.find((r) => r.joined)?.step ?? 0)}`,
    `joined in the tail ${share(tail.map((r) => r.joined))}`,
    `tube ${mean(joinedTail.map((r) => r.tube)).toFixed(2)}`,
    `ratio ${mean(tail.map((r) => Math.min(r.ratio, 1000))).toFixed(1)}`,
    `onRoute ${mean(tail.map((r) => r.onRoute)).toFixed(2)}`,
  ];
  if (maze) {
    const lengths = maze.all.map((r) => r.length - 1);
    lines.push(
      `tube on each route ${lengths.map((l) => share(tail.map((r) => r.routes.includes(l)))).join(',')}`,
      `flow on each route ${lengths.map((l) => share(tail.map((r) => r.flowRoutes.includes(l)))).join(',')}`,
      `only the shortest holds a tube ${share(tail.map((r) => alone(r.routes)))}`,
      `only the shortest carries flow from ${String(from((r) => alone(r.flowRoutes)))}`,
      `no tube on another route from ${String(from((r) => r.routes.every((l) => l === lengths[0])))}`,
    );
  } else {
    const means = blind.map((_, k) => mean(tail.map((r) => r.blind[k] ?? 0)));
    const flowMeans = blind.map((_, k) => mean(tail.map((r) => r.blindFlow[k] ?? 0)));
    lines.push(
      `blind ${means.map((v) => v.toFixed(2)).join(',')}`,
      `blind branches below 0.10: ${String(means.filter((v) => v < 0.1).length)} of ${String(blind.length)}`,
      `dumps with every blind branch below 0.10: ${share(tail.map((r) => r.blind.every((v) => v < 0.1)))}`,
      `blindFlow ${flowMeans.map((v) => v.toFixed(3)).join(',')}`,
      `no flow in a blind branch from ${String(from((r) => r.blindFlow.every((v) => v < 0.1)))}`,
    );
  }
  if (GROUND) {
    lines.push(`offClosed ${mean(tail.map((r) => r.offClosed)).toFixed(2)}`);
    const shares = tail.flatMap((r) => r.detours);
    if (maze)
      lines.push(
        `closed ground of ${String(shares.length)} detours with a tube: at least ${Math.min(1, ...shares).toFixed(2)}`,
      );
  }
  console.log(`${name} run: ${lines.join('; ')}`);
  for (let from = 0; WINDOW > 0 && from < end; from += WINDOW) {
    const part = rows.filter((r) => r.step > from && r.step <= from + WINDOW);
    if (part.length === 0) continue;
    const blindAll = part.flatMap((r) => r.blind);
    const shortest = (maze?.all[0]?.length ?? 0) - 1;
    const scene = maze
      ? `tube on another route ${share(part.map((r) => r.routes.some((l) => l !== shortest)))}; ` +
        `flow on the shortest alone ${share(part.map((r) => alone(r.flowRoutes)))}`
      : `blind ${mean(blindAll).toFixed(3)}; blind 0.10 or more ${share(blindAll.map((v) => v >= 0.1))}`;
    console.log(
      `${name} window ${String(from + WINDOW)}: joined ${share(part.map((r) => r.joined))}; ` +
        `onRoute ${mean(part.map((r) => r.onRoute)).toFixed(2)}; ${scene}`,
    );
  }
}
