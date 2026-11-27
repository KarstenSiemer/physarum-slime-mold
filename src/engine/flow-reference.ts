// CPU mirror of the flow passes (shaders/flow.wgsl, gl/glsl/flow.frag), for tests only: flow.gpu.test.ts checks both
// backends against it. It reads the uniform block as the shaders do (flow.ts packFlow()): the block names the strain
// whose flow this is (ADR 0031), and the fields are those of that strain. The cells of the sites are those of the
// list that the simulation holds (sites.ts FlowSites). With the rules of stage 4 the update and the pressure take the
// sinks (ADR 0070; `//#if TERRITORY` in the shaders): sinks.gpu.test.ts checks both backends against that. So do the
// sensors, by what the sinks take (ADR 0075): flow-sinks.gpu.test.ts. With the flow over 8 neighbours (ADR 0086;
// `//#if EIGHT` in the shaders), which the block names, the update and the pressure take the diagonal edges too.
import type { Boundary } from '../model/params';
import { dishRadius } from './brush';
import { FLOW_CONSTANT_SLOTS, FLOW_EIGHT, FLOW_ITERATIONS, FLOW_SITES, FLOW_TAKE_SLOT, flowRoles } from './flow';
import { RATE_ONE, SINK_STATE_LANES, SUM_ONE } from './sinks';
import { sumOf } from './sinks-reference';

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
  /**
   * Per site (FLOW_SITES of them) the port of this step and the port of the step before, as cell indices, −1 for
   * none: `ports` of flow.wgsl for the strain of the block.
   */
  ports: Int32Array;
}

/**
 * What the flow of a strain reads of its sinks in a step while the rules of stage 4 run (ADR 0070): whether its front
 * took flux in the step before (the state before the step, Sim.readSinkState()), and the sink rates and the state of
 * the step (Sim.readSinks() and Sim.readSinkState() after it), SINK_STATE_LANES values of the strain.
 */
export interface FlowSinks {
  took: boolean;
  rates: Float32Array;
  state: ArrayLike<number>;
}

/** The start of a simulation: fresh ground, no pressure, no port. */
export function flowStart(grid: FlowGrid, fresh: number): FlowFields {
  const n = grid.width * grid.height;
  const memory = new Float32Array(n * 4);
  for (let c = 0; c < n; c++) memory[c * 4] = fresh;
  return {
    memory,
    pressure: new Float32Array(n * 4),
    before: new Float32Array(n * 4),
    ports: new Int32Array(FLOW_SITES * 2).fill(-1),
  };
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

/**
 * The four diagonal neighbours of a cell over 8 neighbours (ADR 0086): south-east, north-west, south-west, north-east,
 * from its four neighbours `nbs` (neighbours()). A diagonal neighbour is one only if both cells beside the edge are
 * open, so no edge passes the corner of a wall (diagonalXY() in flow.wgsl); −1 for none.
 */
const diagonals = (grid: FlowGrid, x: number, y: number, nbs: readonly number[]) => {
  const [e = -1, w = -1, s = -1, n = -1] = nbs;
  return [
    e >= 0 && s >= 0 ? openCell(grid, x + 1, y + 1) : -1,
    w >= 0 && n >= 0 ? openCell(grid, x - 1, y - 1) : -1,
    w >= 0 && s >= 0 ? openCell(grid, x - 1, y + 1) : -1,
    e >= 0 && n >= 0 ? openCell(grid, x + 1, y - 1) : -1,
  ];
};

/** Whether the uniform block `u` names the flow over 8 neighbours (ADR 0086): the last lane of its slot g. */
export const eightOf = (u: Float32Array) => (u[27] ?? 0) !== 0;

/** The weights of the edges over 8 neighbours as the passes hold them, float32 (AXIS and DIAG in flow.wgsl). */
const [AXIS, DIAG] = [Math.fround(FLOW_EIGHT.axis), Math.fround(FLOW_EIGHT.diag)];

/**
 * The flux through each open cell per lane, from a pressure and the conductivities of a memory (4 values per cell): half
 * the sum of the sizes of the fluxes over its edges. `eight`: over 8 neighbours (ADR 0086), the 4 axis edges with the
 * weight AXIS and the 4 diagonal edges with DIAG, as `update` of flow.wgsl sums them.
 */
export function flowFlux(grid: FlowGrid, memory: Float32Array, pressure: Float32Array, eight = false): Float32Array {
  const { width: w, height: h } = grid;
  const flux = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = openCell(grid, x, y);
      if (c < 0) continue;
      const nbs = neighbours(grid, x, y);
      if (eight) {
        // The sizes of the fluxes over the edges of each kind, per lane, then the weights.
        const sizes = (cells: readonly number[], k: number) =>
          cells.reduce((sum, nb) => {
            if (nb < 0) return sum;
            const g = edge(memory[c * 4 + 2] ?? 0, memory[nb * 4 + 2] ?? 0);
            return g > 0 ? sum + Math.abs(g * ((pressure[c * 4 + k] ?? 0) - (pressure[nb * 4 + k] ?? 0))) : sum;
          }, 0);
        const across = diagonals(grid, x, y, nbs);
        for (let k = 0; k < 4; k++) flux[c * 4 + k] = 0.5 * (AXIS * sizes(nbs, k) + DIAG * sizes(across, k));
        continue;
      }
      for (const nb of nbs) {
        if (nb < 0) continue;
        const g = edge(memory[c * 4 + 2] ?? 0, memory[nb * 4 + 2] ?? 0);
        for (let k = 0; k < 4; k++)
          flux[c * 4 + k] =
            (flux[c * 4 + k] ?? 0) + 0.5 * Math.abs(g * ((pressure[c * 4 + k] ?? 0) - (pressure[nb * 4 + k] ?? 0)));
      }
    }
  return flux;
}

/** The port of this step of every site of the uniform block `u`, from the ports of a step (FlowFields.ports). */
const portsOf = (u: Float32Array, ports: Int32Array) =>
  Array.from({ length: u[15] ?? 0 }, (_, i) => ports[i * 2] ?? -1);

/**
 * `sites`: the ports of a step, from the memory before it and the ports of the step before. The port of a site is the
 * first cell of its list in `cells` that is open (no wall) and holds food and a tube of the strain (flow.wgsl
 * `sites`); its port of the step before moves to the second place.
 */
export function flowPorts(grid: FlowGrid, u: Float32Array, cells: Uint32Array, fields: FlowFields): Int32Array {
  const bodyLow = u[10] ?? 0;
  const n = u[15] ?? 0;
  const out = new Int32Array(FLOW_SITES * 2);
  for (let i = 0; i < FLOW_SITES; i++) {
    let found = -1;
    if (i < n) {
      const at = FLOW_CONSTANT_SLOTS * 4 + i * 4;
      const [from, count] = [u[at + 2] ?? 0, u[at + 3] ?? 0];
      for (let k = from; k < from + count; k++) {
        const c = cells[k] ?? 0;
        const open = (grid.env[c * 4] ?? 0) < 128;
        if (open && (grid.env[c * 4 + 1] ?? 0) > 0 && (fields.memory[c * 4 + 1] ?? 0) >= bodyLow) {
          found = c;
          break;
        }
      }
    }
    out[i * 2] = found;
    out[i * 2 + 1] = fields.ports[i * 2] ?? -1;
  }
  return out;
}

/**
 * `update`: the memory after a step, from the memory and the pressure before it, the trail after it and the ports of
 * the step (flowPorts()). `step` and `seed` are those of the simulation's parameters: the roles of the sites depend
 * on them (flowRoles()). `took`: with the rules of stage 4, whether the front of the strain took flux in the step
 * before (FlowSinks); a tube then adapts also without two sites with a role (ADR 0070).
 */
export function flowUpdate(
  grid: FlowGrid,
  u: Float32Array,
  fields: FlowFields,
  trail: Float32Array,
  step: number,
  seed: number,
  ports: Int32Array,
  took = false,
): Float32Array {
  const { width: w, height: h, env } = grid;
  const [gamma, rate, recover] = [u[1] ?? 0, u[2] ?? 0, u[3] ?? 0];
  const [base, foodG] = [u[4] ?? 0, u[5] ?? 0];
  const [bodyRate, bodyLow, fresh] = [u[9] ?? 0, u[10] ?? 0, u[11] ?? 0];
  const [floor, trailLow, trailScale] = [u[12] ?? 0, u[13] ?? 0, u[14] ?? 0];
  /** The square of the flow memory below which a cell is starved (FLOW.half). */
  const half2 = u[17] ?? 0;
  const strain = Math.trunc(u[22] ?? 0);
  const flux = flowFlux(grid, fields.memory, fields.pressure, eightOf(u));
  // A flux runs between foods while at least two food sites gave or took in the step before, at their ports of that
  // step (fed in flow.wgsl).
  let roled = 0;
  for (let i = 0; i < FLOW_SITES; i++) {
    const c = ports[i * 2 + 1] ?? -1;
    if (c >= 0 && (fields.memory[c * 4 + 3] ?? 0) !== 0) roled++;
  }
  const fed = roled >= 2 || took;
  // The sites that the plasmodium covers: those with a port; and their roles.
  const sites = portsOf(u, ports);
  const covered = sites.map((c) => c >= 0);
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
      // The trail of the strain of the block alone.
      const own = trail[i + strain] ?? 0;
      const presence = Math.min(1, Math.max(0, (own - trailLow) * trailScale));
      const body = bodyOld + bodyRate * (presence - bodyOld);
      // A starved tube that vanishes leaves starved ground: its flow memory falls to the floor in this step (ADR 0054).
      if (bodyOld >= bodyLow && body < bodyLow && d * d < half2) d = floor;
      // Only a cell with a tube conducts; a food cell then with the conductivity of food.
      const food = (env[i + 1] ?? 0) > 0;
      const g = body >= bodyLow ? body * (food ? foodG : base + d) : 0;
      // The site whose port this cell is has its role: a food cell with a tube asks for it in the shader (roleCode()).
      // No two sites share a cell (sites.ts), so no two share a port.
      const site = food && bodyOld >= bodyLow ? sites.lastIndexOf(y * w + x) : -1;
      const code = site >= 0 ? (roles[site] ?? 0) : 0;
      out.set([d, body, g, code], i);
    }
  return out;
}

/** The roles of a site's cell as a sign per lane: +1 gives, −1 takes, 0 none. */
export function roleSigns(code: number): number[] {
  return [0, 1, 2, 3].map((k) => {
    const digit = Math.floor(code / 3 ** k) % 3;
    return digit === 1 ? 1 : digit === 2 ? -1 : 0;
  });
}

/**
 * What the sinks of a strain take and what its sources give at every cell in a step, while the rules of stage 4 run
 * (flow.wgsl sinksAndSources(), ADR 0070), in float32 as the passes compute it: nothing while the front of the strain
 * takes no flux (the fifth lane of the state). Else the sinks take S together (frontTotal()), each tube cell (a conductivity above 0 in `memory`, after the update) the share S · r / R with its rate r as
 * R counted it, in steps of 2^-16 rounded to the nearest (ADR 0067, decision 3). The covered ports of the step give S in
 * equal shares, and without one every tube cell gives S / C. `rates`: those of the step, with a minus sign for a sink;
 * `state`: the state of the step, SINK_STATE_LANES values (R, C, N, the covered ports, whether the front takes flux).
 */
export function sinksAndSources(
  u: Float32Array,
  memory: Float32Array,
  ports: Int32Array,
  rates: Float32Array,
  state: ArrayLike<number>,
): Float32Array {
  const f = Math.fround;
  const n = rates.length;
  const out = new Float32Array(n);
  if (state.length < SINK_STATE_LANES || (state[4] ?? 0) === 0) return out;
  const [R = 0, C = 0, , P = 0] = Array.from(state).slice(0, 4);
  const total = frontTotal(u, state);
  for (let c = 0; c < n; c++) {
    if (!((memory[c * 4 + 2] ?? 0) > 0)) continue;
    let q = -taken(total, rates[c] ?? 0, R);
    if (P === 0) q = f(q + f(total / C));
    out[c] = q;
  }
  if (P > 0) for (const c of portsOf(u, ports)) if (c >= 0) out[c] = f((out[c] ?? 0) + f(total / P));
  return out;
}

/**
 * What the sinks of a strain take together while its front takes flux (flow.wgsl frontTotal()): S = 2 k · I0 (the slot
 * FLOW_TAKE_SLOT of the block) for each covered port of the state, at least one (ADR 0100; ADR 0093, `feed=flux`), in
 * float32.
 */
function frontTotal(u: Float32Array, state: ArrayLike<number>): number {
  const f = Math.fround;
  return f(f((u[FLOW_TAKE_SLOT * 4] ?? 0) * (u[0] ?? 0)) * Math.max(1, state[3] ?? 0));
}

/**
 * What the sink of a tube cell with the rate `rate` takes while the front of its strain takes flux (flow.wgsl
 * taken()), in float32: total · r / R, with r the rate as R counted it, in steps of 2^-24, a whole number, then in steps
 * of 2^-16.
 */
function taken(total: number, rate: number, R: number): number {
  const f = Math.fround;
  const r = sumOf(Math.trunc(Math.abs(rate) * RATE_ONE)) / SUM_ONE;
  return f(f(total * r) / R);
}

/**
 * `takes` of flow.wgsl and PASS 5 of flow.frag (ADR 0075): what the sink of every cell of a strain takes over the
 * conductivity G of the cell, take / G, as the sensors of the next step read it, in float32 as the passes compute it:
 * 0 at a cell without a tube (G of `memory` not above 0) and while the front of the strain takes no flux (the fifth
 * lane of the state). `memory`, `rates` and `state`: those of the step, as sinksAndSources() takes them.
 */
export function takesOf(
  u: Float32Array,
  memory: Float32Array,
  rates: Float32Array,
  state: ArrayLike<number>,
): Float32Array {
  const f = Math.fround;
  const n = rates.length;
  const out = new Float32Array(n);
  if (state.length < SINK_STATE_LANES || (state[4] ?? 0) === 0) return out;
  const total = frontTotal(u, state);
  for (let c = 0; c < n; c++) {
    const g = memory[c * 4 + 2] ?? 0;
    if (g > 0) out[c] = f(taken(total, rates[c] ?? 0, state[0] ?? 0) / g);
  }
  return out;
}

/**
 * `pressure`: one iteration. `recentre`: 1 and 2 in the first two iterations of a step (flow.wgsl RECENTRE). `ports`:
 * those of the step (flowPorts()). `extra`: with the rules of stage 4, what the sinks take and the sources give at
 * each cell (sinksAndSources()), in every lane. Over 8 neighbours (ADR 0086, the block names it) the sums take the 4
 * axis edges with the weight AXIS and the 4 diagonal edges with DIAG, as `pressure` of flow.wgsl sums them.
 */
export function flowPressure(
  grid: FlowGrid,
  u: Float32Array,
  memory: Float32Array,
  pressure: Float32Array,
  before: Float32Array,
  recentre: 0 | 1 | 2,
  ports: Int32Array,
  extra?: Float32Array,
): Float32Array {
  const { width: w, height: h } = grid;
  const [i0, ghost, omega, weight] = [u[0] ?? 0, u[6] ?? 0, u[7] ?? 0, u[8] ?? 0];
  const [limit, limitScale] = [u[25] ?? 0, u[26] ?? 0];
  const acting = portsOf(u, ports).filter((c) => c >= 0 && (memory[c * 4 + 3] ?? 0) !== 0);
  // The cell that the first two iterations recentre by: the port of the first site that gives or takes, else the
  // cell of the uniform block (referenceCell in flow.wgsl).
  const ref = (acting[0] ?? Math.trunc(u[21] ?? 0) * w + Math.trunc(u[20] ?? 0)) * 4;
  // The mean pressure, per lane, of the sites that give or take in at least one lane (headroom in flow.wgsl).
  const level = [0, 1, 2, 3].map((k) =>
    acting.length > 0 ? acting.reduce((a, c) => a + (pressure[c * 4 + k] ?? 0), 0) / acting.length : 0,
  );
  const eight = eightOf(u);
  const out = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = openCell(grid, x, y);
      if (c < 0) continue;
      const i = c * 4;
      const gc = memory[i + 2] ?? 0;
      const nbs = neighbours(grid, x, y);
      const ghostEdge = (nb: number) => (nb < 0 ? 0 : edge(gc + ghost, (memory[nb * 4 + 2] ?? 0) + ghost));
      const edges = nbs.map(ghostEdge);
      const across = eight ? diagonals(grid, x, y, nbs) : [];
      const diagonal = across.map(ghostEdge);
      const axisSum = edges.reduce((a, b) => a + b, 0);
      const sum = eight ? AXIS * axisSum + DIAG * diagonal.reduce((a, b) => a + b, 0) : axisSum;
      const signs = roleSigns(memory[i + 3] ?? 0);
      for (let k = 0; k < 4; k++) {
        const pc = pressure[i + k] ?? 0;
        let next = pc;
        if (sum > 0) {
          let acc = 0;
          nbs.forEach((nb, e) => {
            if ((edges[e] ?? 0) > 0) acc += (edges[e] ?? 0) * (pressure[nb * 4 + k] ?? 0);
          });
          if (eight) {
            let diagonalAcc = 0;
            across.forEach((nb, e) => {
              if ((diagonal[e] ?? 0) > 0) diagonalAcc += (diagonal[e] ?? 0) * (pressure[nb * 4 + k] ?? 0);
            });
            acc = AXIS * acc + DIAG * diagonalAcc;
          }
          // A site gives or takes its flux only within its pressure limit. With the rules of stage 4 the sinks take
          // and the sources give in every lane (ADR 0070).
          const sign = signs[k] ?? 0;
          const room = Math.min(1, Math.max(0, (limit - sign * (pc - (level[k] ?? 0))) * limitScale));
          const given = sign * i0 * room;
          const balanced = (acc + (extra ? given + (extra[c] ?? 0) : given)) / sum;
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
 * One step of the flow: the ports, the update, then the pressure iterations. `u`: the uniform block; `step` and
 * `seed`: those of the simulation; `cells`: the cells of the sites (sites.ts FlowSites). `sinks`: with the rules of
 * stage 4, what the flow of the strain reads of its sinks (ADR 0070).
 */
export function flowStep(
  grid: FlowGrid,
  u: Float32Array,
  fields: FlowFields,
  trail: Float32Array,
  step: number,
  seed: number,
  cells: Uint32Array,
  sinks?: FlowSinks,
): FlowFields {
  const ports = flowPorts(grid, u, cells, fields);
  const memory = flowUpdate(grid, u, fields, trail, step, seed, ports, sinks?.took);
  const extra = sinks ? sinksAndSources(u, memory, ports, sinks.rates, sinks.state) : undefined;
  let [pressure, before] = [fields.pressure, fields.before];
  for (let i = 0; i < FLOW_ITERATIONS; i++) {
    const next = flowPressure(grid, u, memory, pressure, before, i === 0 ? 1 : i === 1 ? 2 : 0, ports, extra);
    [before, pressure] = [pressure, next];
  }
  return { memory, pressure, before, ports };
}

/** The mean pressure of the four lanes of a cell (`lanes`, Sim.readPressure()), in float32 as the passes compute it. */
export function meanPressure(lanes: ArrayLike<number>): number {
  const f = Math.fround;
  return f(f(f(f((lanes[0] ?? 0) + (lanes[1] ?? 0)) + (lanes[2] ?? 0)) + (lanes[3] ?? 0)) * 0.25);
}

/**
 * What the cell of an agent gives its sensors while the rules of stage 4 run (agents.wgsl driftOf(), ADR 0075), in
 * float32: undefined if it holds no tube of the agent's strain, else the ground, what a sensor on a cell without a tube
 * reads: the mean pressure of the cell (`lanes`) less the sensor offset `so` times take / G there (`take`, takesOf()).
 */
export function groundOf(tube: boolean, lanes: ArrayLike<number>, take: number, so: number): number | undefined {
  const f = Math.fround;
  return tube ? f(meanPressure(lanes) - f(so * take)) : undefined;
}

/**
 * The drift of one food (agents.wgsl driftOf(), ADR 0100, part B): the drift of a strain over the foods that its last
 * flow pass covered (`covered`, lane w of the first vec4 of its state), at least one, in float32.
 */
export const driftOfFoods = (drift: number, covered: number): number =>
  Math.fround(Math.fround(drift) / Math.max(1, covered));

/**
 * The value that a sensor of an agent reads while the rules of stage 4 run (agents.wgsl sense(), ADR 0070, ADR 0075),
 * in float32 as the passes compute it: `read`, what it reads without the rules (not blocked), minus the drift of one
 * food (driftOfFoods()) times the
 * mean pressure of the cell of the sensor (`lanes`) if that cell holds a tube of the strain (`tube`), else times the
 * ground of the agent's cell (groundOf()). An agent on a cell without a tube of its strain (`ground` undefined) reads
 * no drift.
 */
export function drifted(
  read: number,
  drift: number,
  ground: number | undefined,
  tube: boolean,
  lanes: ArrayLike<number>,
): number {
  if (ground === undefined) return read;
  const f = Math.fround;
  return f(read - f(drift * (tube ? meanPressure(lanes) : ground)));
}
