// CPU mirror of the flow passes (shaders/flow.wgsl, gl/glsl/flow.frag), for tests only: flow.gpu.test.ts checks both
// backends against it. It reads the uniform block as the shaders do (flow.ts packFlow()).
import type { Boundary } from '../model/params';
import { dishRadius } from './brush';
import { FLOW_CONSTANT_SLOTS, FLOW_ITERATIONS, flowRoles } from './flow';

/** The grid as the passes see it: 4 bytes per cell as Sim.readEnv() returns them (wall, food, light, unused). */
export interface FlowGrid {
  width: number;
  height: number;
  boundary: Boundary;
  env: Uint8Array;
}

/** The state of the flow: per cell 4 values each, as Sim.readFlow() and Sim.readPressure() return them. */
export interface FlowFields {
  /** Flow memory, tube body, conductivity, roles. */
  memory: Float32Array;
  pressure: Float32Array;
  /** The pressure one iteration before: the momentum of the iteration. */
  before: Float32Array;
}

/** The start of a simulation: fresh ground, no pressure. */
export function flowStart(grid: FlowGrid, fresh: number): FlowFields {
  const n = grid.width * grid.height;
  const memory = new Float32Array(n * 4);
  for (let c = 0; c < n; c++) memory[c * 4] = fresh;
  return { memory, pressure: new Float32Array(n * 4), before: new Float32Array(n * 4) };
}

/** The index of the cell at (x, y) if it is open (inside the arena, no wall), wrapped on the periodic grid; else −1. */
export function openCell(grid: FlowGrid, x: number, y: number): number {
  const { width: w, height: h, boundary, env } = grid;
  if (boundary === 'wrap') [x, y] = [((x % w) + w) % w, ((y % h) + h) % h];
  else if (x < 0 || y < 0 || x >= w || y >= h) return -1;
  if (boundary === 'dish' && Math.hypot(x + 0.5 - w / 2, y + 0.5 - h / 2) > dishRadius(w, h)) return -1;
  const c = y * w + x;
  return (env[c * 4] ?? 0) >= 128 ? -1 : c;
}

const edge = (a: number, b: number) => (a <= 0 || b <= 0 ? 0 : (2 * a * b) / (a + b));

/** The four neighbours of a cell: east, west, south, north (−1 for none). */
const neighbours = (grid: FlowGrid, x: number, y: number) => [
  openCell(grid, x + 1, y),
  openCell(grid, x - 1, y),
  openCell(grid, x, y + 1),
  openCell(grid, x, y - 1),
];

/** The flux through each open cell per lane, from a pressure and the conductivities of a memory (4 values per cell). */
export function flowFlux(grid: FlowGrid, memory: Float32Array, pressure: Float32Array): Float32Array {
  const { width: w, height: h } = grid;
  const flux = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = openCell(grid, x, y);
      if (c < 0) continue;
      for (const nb of neighbours(grid, x, y)) {
        if (nb < 0) continue;
        const g = edge(memory[c * 4 + 2] ?? 0, memory[nb * 4 + 2] ?? 0);
        for (let k = 0; k < 4; k++)
          flux[c * 4 + k] =
            (flux[c * 4 + k] ?? 0) + 0.5 * Math.abs(g * ((pressure[c * 4 + k] ?? 0) - (pressure[nb * 4 + k] ?? 0)));
      }
    }
  return flux;
}

/** The centre cell of each food site of the uniform block `u`, as an index. */
function siteCells(u: Float32Array, w: number): number[] {
  const count = u[15] ?? 0;
  const at = FLOW_CONSTANT_SLOTS * 4;
  return Array.from(
    { length: count },
    (_, i) => Math.trunc(u[at + i * 4 + 1] ?? 0) * w + Math.trunc(u[at + i * 4] ?? 0),
  );
}

/**
 * `update`: the memory after a step, from the memory and the pressure before it and the trail after it. `step` and
 * `seed` are those of the simulation's parameters: the roles of the sites depend on them (flowRoles()).
 */
export function flowUpdate(
  grid: FlowGrid,
  u: Float32Array,
  fields: FlowFields,
  trail: Float32Array,
  step: number,
  seed: number,
): Float32Array {
  const { width: w, height: h, env } = grid;
  const [gamma, rate, recover] = [u[1] ?? 0, u[2] ?? 0, u[3] ?? 0];
  const [base, foodG] = [u[4] ?? 0, u[5] ?? 0];
  const [bodyRate, bodyLow, fresh] = [u[9] ?? 0, u[10] ?? 0, u[11] ?? 0];
  const [floor, trailLow, trailScale] = [u[12] ?? 0, u[13] ?? 0, u[14] ?? 0];
  const flux = flowFlux(grid, fields.memory, fields.pressure);
  const sites = siteCells(u, w);
  // A flux runs between foods while at least two food sites give or take (fed in flow.wgsl).
  const fed = sites.filter((c) => (fields.memory[c * 4 + 3] ?? 0) !== 0).length >= 2;
  // The sites that the plasmodium covers: food and a tube at their centre cell in the step before; and their roles.
  const covered = sites.map((c) => (env[c * 4 + 1] ?? 0) > 0 && (fields.memory[c * 4 + 1] ?? 0) >= bodyLow);
  const roles = flowRoles(covered, step, seed);
  const out = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (openCell(grid, x, y) < 0) {
        out[i] = fresh;
        continue;
      }
      let mean = 0;
      for (let k = 0; k < 4; k++) {
        const q = flux[i + k] ?? 0;
        const qg = q <= 0 ? 0 : Math.pow(q, gamma);
        mean += 0.25 * (qg / (1 + qg));
      }
      let d = fields.memory[i] ?? 0;
      const bodyOld = fields.memory[i + 1] ?? 0;
      if (bodyOld >= bodyLow) d = fed ? Math.max(floor, d + rate * (mean - d)) : d;
      else d = Math.min(fresh, Math.max(d, floor) * (1 + recover));
      const total = (trail[i] ?? 0) + (trail[i + 1] ?? 0) + (trail[i + 2] ?? 0) + (trail[i + 3] ?? 0);
      const presence = Math.min(1, Math.max(0, (total - trailLow) * trailScale));
      const body = bodyOld + bodyRate * (presence - bodyOld);
      // Only a cell with a tube conducts; a food cell then with the conductivity of food.
      const food = (env[i + 1] ?? 0) > 0;
      const g = body >= bodyLow ? body * (food ? foodG : base + d) : 0;
      // The last site at this cell has its role, as the loop of the shader finds it.
      const site = sites.lastIndexOf(y * w + x);
      const code = site >= 0 && covered[site] ? (roles[site] ?? 0) : 0;
      out.set([d, body, g, code], i);
    }
  return out;
}

/** The roles of a site's centre cell as a sign per lane: +1 gives, −1 takes, 0 none. */
export function roleSigns(code: number): number[] {
  return [0, 1, 2, 3].map((k) => {
    const digit = Math.floor(code / 3 ** k) % 3;
    return digit === 1 ? 1 : digit === 2 ? -1 : 0;
  });
}

/** `pressure`: one iteration. `recentre`: 1 and 2 in the first two iterations of a step (flow.wgsl RECENTRE). */
export function flowPressure(
  grid: FlowGrid,
  u: Float32Array,
  memory: Float32Array,
  pressure: Float32Array,
  before: Float32Array,
  recentre: 0 | 1 | 2,
): Float32Array {
  const { width: w, height: h } = grid;
  const [i0, ghost, omega, weight] = [u[0] ?? 0, u[6] ?? 0, u[7] ?? 0, u[8] ?? 0];
  const [limit, limitScale] = [u[25] ?? 0, u[26] ?? 0];
  const ref = (Math.trunc(u[21] ?? 0) * w + Math.trunc(u[20] ?? 0)) * 4;
  // The mean pressure of the sites that give or take, per lane (headroom in flow.wgsl).
  const acting = siteCells(u, w).filter((c) => (memory[c * 4 + 3] ?? 0) !== 0);
  const level = [0, 1, 2, 3].map((k) =>
    acting.length > 0 ? acting.reduce((a, c) => a + (pressure[c * 4 + k] ?? 0), 0) / acting.length : 0,
  );
  const out = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = openCell(grid, x, y);
      if (c < 0) continue;
      const i = c * 4;
      const gc = memory[i + 2] ?? 0;
      const nbs = neighbours(grid, x, y);
      const edges = nbs.map((nb) => (nb < 0 ? 0 : edge(gc + ghost, (memory[nb * 4 + 2] ?? 0) + ghost)));
      const sum = edges.reduce((a, b) => a + b, 0);
      const signs = roleSigns(memory[i + 3] ?? 0);
      for (let k = 0; k < 4; k++) {
        const pc = pressure[i + k] ?? 0;
        let next = pc;
        if (sum > 0) {
          let acc = 0;
          nbs.forEach((nb, e) => {
            if ((edges[e] ?? 0) > 0) acc += (edges[e] ?? 0) * (pressure[nb * 4 + k] ?? 0);
          });
          // A site gives or takes its flux only within its pressure limit.
          const sign = signs[k] ?? 0;
          const room = Math.min(1, Math.max(0, (limit - sign * (pc - (level[k] ?? 0))) * limitScale));
          const balanced = (acc + sign * i0 * room) / sum;
          const jacobi = pc + weight * (balanced - pc);
          const past = (before[i + k] ?? 0) - (recentre === 2 ? (before[ref + k] ?? 0) : 0);
          // Only a cell that conducts takes the momentum of the iteration.
          const om = gc > 0 ? omega : 1;
          next = om * jacobi + (1 - om) * past;
        }
        if (recentre === 1) next -= pressure[ref + k] ?? 0;
        out[i + k] = next;
      }
    }
  return out;
}

/**
 * One step of the flow: the update, then the pressure iterations. `u`: the uniform block; `step` and `seed`: those of
 * the simulation.
 */
export function flowStep(
  grid: FlowGrid,
  u: Float32Array,
  fields: FlowFields,
  trail: Float32Array,
  step: number,
  seed: number,
): FlowFields {
  const memory = flowUpdate(grid, u, fields, trail, step, seed);
  let [pressure, before] = [fields.pressure, fields.before];
  for (let i = 0; i < FLOW_ITERATIONS; i++) {
    const next = flowPressure(grid, u, memory, pressure, before, i === 0 ? 1 : i === 1 ? 2 : 0);
    [before, pressure] = [pressure, next];
  }
  return { memory, pressure, before };
}
