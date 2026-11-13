// The pressure solvers of ADR 0029 on one fixed network, with the app's own rule for the local one. The network is
// the Maze after 1,000 steps of the agent model (seed 1), as the app would see it: the tube body follows the trail as
// in the pass `update`, the flow memory is that of fresh ground, the first food gives the flux I0 and the other takes
// it.
//
// 1. Exact: the method of conjugate gradients solves Kirchhoff's law of all cells at once.
// 2. Local, as the app runs it: the iteration of the pass `pressure` (flow.wgsl), 16 iterations per step, from a
//    pressure of 0. The loop of this file is a fast copy of flowPressure() in src/engine/flow-reference.ts, the CPU
//    copy that the GPU tests hold both backends to. The script first checks that the two give the same bits.
// 3. The same iteration tuned for other spectral radii, and without the momentum (a damped Jacobi iteration).
//
// The error of a solver is the sum over all cells of |its flux − the exact flux|, over the sum of the exact flux.
// Usage: node --import ./research/flow/register.mjs research/flow/solvers.ts [steps=1000] [plain=1000] [i0=8]
// `steps`: the steps of each local run (16 iterations each). `plain`: the steps of the run without the momentum.
// `network=1000`: the steps of the agent model that make the network (the test of this folder uses fewer).
import { FLOW, FLOW_ITERATIONS, packFlow } from '../../src/engine/flow.ts';
import { flowPressure, type FlowGrid } from '../../src/engine/flow-reference.ts';
import { defaultSettings } from '../../src/model/params.ts';
import { Jones, mazeParams } from './prototype/jones.ts';
import { mazeWorld } from './prototype/maze.ts';
import { geodesic } from './prototype/world.ts';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.split('=') as [string, string]));
const STEPS = Number(args.steps ?? 1000);
const PLAIN = Number(args.plain ?? 1000);
const I0 = Number(args.i0 ?? 8);
const NETWORK = Number(args.network ?? 1000);

// --- The network -----------------------------------------------------------------------------------------------
const world = mazeWorld();
const { w, h } = world;
const n = w * h;
const settings = { ...defaultSettings(), flowStrength: I0 };
const deposit = settings.strains[0]?.deposit ?? 5;
const sim = new Jones(world, mazeParams(1), 0.12);
// The tube body of each cell: the trail smoothed over time, as the pass `update` does it (flow.wgsl).
const body = new Float32Array(n);
for (let s = 0; s < NETWORK; s++) {
  sim.advance();
  for (let c = 0; c < n; c++) {
    if (!world.open[c]) continue;
    const low = FLOW.trailLow * deposit;
    const presence = Math.min(1, Math.max(0, (sim.trail[c]! - low) / (FLOW.trailFull * deposit - low)));
    body[c] = body[c]! + FLOW.bodyRate * (presence - body[c]!);
  }
}
const grid: FlowGrid = { width: w, height: h, boundary: 'box', env: new Uint8Array(n * 4) };
for (let c = 0; c < n; c++) {
  grid.env[c * 4] = world.wall[c] ? 255 : 0;
  grid.env[c * 4 + 1] = world.food[c] ? 255 : 0;
}
const sites = world.sites.map((s): [number, number] => [Math.floor(s.x), Math.floor(s.y)]);
/** The uniform block of the passes (flow.ts packFlow()): the constants as 32-bit floats, as the GPU has them. */
const u = new Float32Array(packFlow(settings, sites));
const [ghost, weight, limit, limitScale] = [u[6]!, u[8]!, u[25]!, u[26]!];
// The memory of each cell as the pass `update` leaves it: flow memory, tube body, conductivity, roles.
const memory = new Float32Array(n * 4);
let tubes = 0;
for (let c = 0; c < n; c++) {
  if (!world.open[c]) continue;
  const g = body[c]! >= FLOW.bodyLow ? body[c]! * (world.food[c] ? FLOW.food : FLOW.base + FLOW.fresh) : 0;
  if (g > 0) tubes++;
  memory.set([FLOW.fresh, body[c]!, g, 0], c * 4);
}
const cellOf = (k: number) => (sites[k]?.[1] ?? 0) * w + (sites[k]?.[0] ?? 0);
const [source, sink] = [cellOf(0), cellOf(1)];
// The roles of two covered sites (flowRoles() in flow.ts): the first gives in all four fields, the other takes.
memory[source * 4 + 3] = 1 + 3 + 9 + 27;
memory[sink * 4 + 3] = 2 * (1 + 3 + 9 + 27);
if (memory[source * 4 + 2]! <= 0 || memory[sink * 4 + 2]! <= 0) throw new Error('a food holds no tube');
const apart = geodesic(world, [source])[sink]!;
console.log(
  `network: ${w} × ${h} cells, ${tubes} cells with a tube, the two foods ${apart.toFixed(0)} cells apart along the maze, I0 ${I0}`,
);

// The neighbours of each cell (east, west, south, north; −1 for a wall or the edge) and the conductance of each edge:
// `real` as the flux counts it, `iter` with the ghost conductivity as the iteration uses it.
const edge = (a: number, b: number) => (a <= 0 || b <= 0 ? 0 : (2 * a * b) / (a + b));
const nb = new Int32Array(n * 4).fill(-1);
const real = new Float64Array(n * 4);
const iter = new Float64Array(n * 4);
const sum = new Float64Array(n);
for (let c = 0; c < n; c++) {
  if (!world.open[c]) continue;
  const [x, y] = [c % w, Math.floor(c / w)];
  const around = [x + 1 < w ? c + 1 : -1, x > 0 ? c - 1 : -1, y + 1 < h ? c + w : -1, y > 0 ? c - w : -1];
  const gc = memory[c * 4 + 2]!;
  around.forEach((q, e) => {
    if (q < 0 || !world.open[q]) return;
    nb[c * 4 + e] = q;
    real[c * 4 + e] = edge(gc, memory[q * 4 + 2]!);
    iter[c * 4 + e] = edge(gc + ghost, memory[q * 4 + 2]! + ghost);
    sum[c] = sum[c]! + iter[c * 4 + e]!;
  });
}
/** The flux through every cell for a pressure, as the pass `update` counts it: half the sum over its edges. */
function fluxOf(pressure: ArrayLike<number>): Float64Array {
  const q = new Float64Array(n);
  for (let c = 0; c < n; c++)
    for (let e = 0; e < 4; e++) {
      const g = real[c * 4 + e]!;
      if (g > 0) q[c] = q[c]! + 0.5 * Math.abs(g * (pressure[c]! - pressure[nb[c * 4 + e]!]!));
    }
  return q;
}

// --- 1. Exact: conjugate gradients on Kirchhoff's law of all cells, with the diagonal as preconditioner, to a
// residual of 10⁻⁸ of the right-hand side. `cond` holds the conductance of the four edges of each cell: `iter` is
// the system of the pass, with the ghost conductivity; `real` is the network of tubes alone. --------------------------
function conjugateGradients(cond: Float64Array): { pressure: Float64Array; iterations: number } {
  const diagonal = new Float64Array(n);
  for (let c = 0; c < n; c++) for (let e = 0; e < 4; e++) diagonal[c] = diagonal[c]! + cond[c * 4 + e]!;
  const apply = (x: Float64Array, out: Float64Array) => {
    for (let c = 0; c < n; c++) {
      let v = diagonal[c]! * x[c]!;
      for (let e = 0; e < 4; e++) if (cond[c * 4 + e]! > 0) v -= cond[c * 4 + e]! * x[nb[c * 4 + e]!]!;
      out[c] = v;
    }
  };
  const pressure = new Float64Array(n);
  const [r, z, d, q] = [new Float64Array(n), new Float64Array(n), new Float64Array(n), new Float64Array(n)];
  r[source] = I0;
  r[sink] = -I0;
  let rz = 0;
  for (let c = 0; c < n; c++) {
    z[c] = diagonal[c]! > 0 ? r[c]! / diagonal[c]! : 0;
    d[c] = z[c]!;
    rz += r[c]! * z[c]!;
  }
  const norm0 = 2 * I0 * I0;
  let iterations = 0;
  for (; iterations < 200000; iterations++) {
    apply(d, q);
    let dq = 0;
    for (let c = 0; c < n; c++) dq += d[c]! * q[c]!;
    const alpha = rz / dq;
    let [rr, rzNew] = [0, 0];
    for (let c = 0; c < n; c++) {
      pressure[c] = pressure[c]! + alpha * d[c]!;
      const rc = r[c]! - alpha * q[c]!;
      const zc = diagonal[c]! > 0 ? rc / diagonal[c]! : 0;
      r[c] = rc;
      z[c] = zc;
      rr += rc * rc;
      rzNew += rc * zc;
    }
    if (rr < 1e-16 * norm0) break;
    const beta = rzNew / rz;
    rz = rzNew;
    for (let c = 0; c < n; c++) d[c] = z[c]! + beta * d[c]!;
  }
  return { pressure, iterations };
}
const { pressure: exactP, iterations: cgIterations } = conjugateGradients(iter);
const exactQ = fluxOf(exactP);
const total = exactQ.reduce((a, b) => a + b, 0);
const error = (pressure: ArrayLike<number>) =>
  fluxOf(pressure).reduce((e, q, c) => e + Math.abs(q - exactQ[c]!), 0) / total;
let [onRoute, most] = [0, 0];
for (let c = 0; c < n; c++) {
  if (exactQ[c]! > 0.05 * I0) onRoute++;
  most = Math.max(most, exactQ[c]!);
}
console.log(
  `exact (conjugate gradients, diagonal preconditioner): ${cgIterations} iterations; pressure of the source over the sink ${(exactP[source]! - exactP[sink]!).toFixed(1)}; ${onRoute} cells carry more than 5 % of I0, the most in one cell is ${most.toFixed(2)}`,
);
// What the ghost conductivity costs: the exact flux of the network of tubes alone against the exact flux above.
{
  const tubesOnly = conjugateGradients(real);
  console.log(
    `exact without the ghost conductivity: ${tubesOnly.iterations} iterations; its flux differs from the flux above by ${(100 * error(tubesOnly.pressure)).toFixed(3)} %`,
  );
}

// --- 2 and 3. Local: the iteration of the pass `pressure` for one field, from a pressure of 0. -----------------------
/**
 * One iteration of the pass for field 0: the same operations in the same order as flowPressure(), on 64-bit numbers
 * that are stored as 32-bit floats. `recentre`: 1 and 2 in the first two iterations of a step (flow.wgsl RECENTRE).
 */
function iterate(pressure: Float32Array, before: Float32Array, omega: number, recentre: 0 | 1 | 2): Float32Array {
  const out = new Float32Array(n);
  // The sites that give or take: here the two foods. Their mean pressure is the level of the pressure limit, and
  // the first of them is the cell that the first two iterations of a step recentre by.
  const level = (pressure[source]! + pressure[sink]!) / 2;
  for (let c = 0; c < n; c++) {
    if (!world.open[c]) continue;
    const pc = pressure[c]!;
    let next = pc;
    if (sum[c]! > 0) {
      let acc = 0;
      for (let e = 0; e < 4; e++) if (iter[c * 4 + e]! > 0) acc += iter[c * 4 + e]! * pressure[nb[c * 4 + e]!]!;
      const sign = c === source ? 1 : c === sink ? -1 : 0;
      const room = Math.min(1, Math.max(0, (limit - sign * (pc - level)) * limitScale));
      const balanced = (acc + sign * u[0]! * room) / sum[c]!;
      const jacobi = pc + weight * (balanced - pc);
      const past = before[c]! - (recentre === 2 ? before[source]! : 0);
      // Only a cell that conducts takes the momentum of the iteration.
      const om = memory[c * 4 + 2]! > 0 ? omega : 1;
      next = om * jacobi + (1 - om) * past;
    }
    if (recentre === 1) next -= pressure[source]!;
    out[c] = next;
  }
  return out;
}
const recentreOf = (i: number): 0 | 1 | 2 => (i === 0 ? 1 : i === 1 ? 2 : 0);

// The check: two steps of the fast loop against flowPressure(), which runs four fields at once.
{
  let p4: Float32Array = new Float32Array(n * 4);
  let b4: Float32Array = new Float32Array(n * 4);
  let p1: Float32Array = new Float32Array(n);
  let b1: Float32Array = new Float32Array(n);
  let differ = 0;
  for (let i = 0; i < 2 * FLOW_ITERATIONS; i++) {
    const r = recentreOf(i % FLOW_ITERATIONS);
    [b4, p4] = [p4, flowPressure(grid, u, memory, p4, b4, r)];
    [b1, p1] = [p1, iterate(p1, b1, u[7]!, r)];
    for (let c = 0; c < n; c++) if (!Object.is(p1[c], p4[c * 4])) differ++;
  }
  if (differ > 0) throw new Error(`the fast loop differs from flowPressure() in ${differ} values`);
  console.log(`check: the loop of this script gives the bits of flowPressure() over ${2 * FLOW_ITERATIONS} iterations`);
}

const SHOW = [1, 2, 5, 10, 20, 50, 100, 150, 200, 260, 300, 400, 500, 750, 1000, 1500, 2000, 5000, 10000, 25000];
function local(name: string, omega: number, steps: number) {
  let pressure: Float32Array = new Float32Array(n);
  let before: Float32Array = new Float32Array(n);
  const first = new Map<string, number>();
  const lines: string[] = [];
  const t0 = performance.now();
  for (let step = 1; step <= steps; step++) {
    for (let i = 0; i < FLOW_ITERATIONS; i++) {
      [before, pressure] = [pressure, iterate(pressure, before, omega, recentreOf(i))];
      // How far the pressure has spread: one iteration moves it by one cell. A cell that it has not reached yet has
      // the value of most cells.
      if (step === 1 && [0, 3, 15].includes(i)) {
        const far = pressure[geodesicFar]!;
        let reached = 0;
        for (let c = 0; c < n; c++) if (world.open[c] && pressure[c] !== far) reached++;
        lines.push(`  after ${String(i + 1).padStart(2)} iterations the pressure has reached ${reached} cells`);
      }
    }
    const e = error(pressure);
    for (const [label, level] of [
      ['20 %', 0.2],
      ['5 %', 0.05],
      ['1 %', 0.01],
    ] as const)
      if (e < level && !first.has(label)) first.set(label, step);
    if (SHOW.includes(step) || step === steps)
      lines.push(
        `  step ${String(step).padStart(5)} (${String(step * FLOW_ITERATIONS).padStart(6)} iterations): error ${(100 * e).toFixed(1)} %`,
      );
  }
  console.log(`${name} (omega ${omega.toFixed(5)}), ${Math.round((performance.now() - t0) / 1000)} s:`);
  console.log(lines.join('\n'));
  const hit = [...first].map(
    ([label, step]) => `first below ${label} at step ${step} (${step * FLOW_ITERATIONS} iterations)`,
  );
  console.log(`  ${hit.length > 0 ? hit.join(', ') : `not below 20 % in ${steps} steps`}`);
}
// A cell far from both foods: the one with the longest way from the source that also lies far from the sink.
const fromSource = geodesic(world, [source]);
const fromSink = geodesic(world, [sink]);
let geodesicFar = 0;
for (let c = 0; c < n; c++) {
  const d = Math.min(fromSource[c]!, fromSink[c]!);
  if (Number.isFinite(d) && d > Math.min(fromSource[geodesicFar]!, fromSink[geodesicFar]!)) geodesicFar = c;
}
const omegaOf = (radius: number) => Math.fround(2 / (1 + Math.sqrt(1 - radius * radius)));
local(`local, as the app runs it: radius ${FLOW.radius}`, u[7]!, STEPS);
local('local, tuned for the radius 0.9999', omegaOf(0.9999), STEPS);
local('local, tuned for the radius 0.999999', omegaOf(0.999999), STEPS);
local('local without the momentum', 1, PLAIN);
