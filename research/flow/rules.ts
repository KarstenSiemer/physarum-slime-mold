// The two passes of the flow with some rules of ADR 0029 as switches, for experiments (bounded.ts). It is a copy of
// src/engine/flow-reference.ts, the CPU copy of the passes that the GPU tests hold both backends to. With every
// switch as built it gives the bits of that copy; bounded.ts checks this in every run.
//
// The switches turn single rules back to the first version of the app, which let the pressure run away (decision 6),
// and to the first rule for the reference cell (decision 3).
import { FLOW_CONSTANT_SLOTS, FLOW_ITERATIONS, flowRoles } from '../../src/engine/flow.ts';
import { flowFlux, openCell, roleSigns, type FlowFields, type FlowGrid } from '../../src/engine/flow-reference.ts';

export interface Rules {
  /** A food cell conducts only while it holds a tube. Off: every food cell conducts. */
  foodNeedsTube: boolean;
  /** Only the food sites that the colony covers give or take, and as many give as take. Off: every food site has a
   *  role, drawn among all sites, and gives or takes also while the colony does not cover it. */
  coveredSitesOnly: boolean;
  /** A site gives or takes its flux only within its pressure limit. Off: always its full flux. */
  pressureLimit: boolean;
  /** Only a cell that conducts takes the momentum of the iteration. Off: every open cell. */
  momentumOnTubesOnly: boolean;
  /** The first two iterations of a step take the pressure of the first site that gives or takes off the field. Off:
   *  the pressure of the first site of the list. */
  referenceGivesOrTakes: boolean;
}

/** The rules as the app has them. */
export const AS_BUILT: Rules = {
  foodNeedsTube: true,
  coveredSitesOnly: true,
  pressureLimit: true,
  momentumOnTubesOnly: true,
  referenceGivesOrTakes: true,
};

const edge = (a: number, b: number) => (a <= 0 || b <= 0 ? 0 : (2 * a * b) / (a + b));
const neighbours = (grid: FlowGrid, x: number, y: number) => [
  openCell(grid, x + 1, y),
  openCell(grid, x - 1, y),
  openCell(grid, x, y + 1),
  openCell(grid, x, y - 1),
];
function siteCells(u: Float32Array, w: number): number[] {
  const at = FLOW_CONSTANT_SLOTS * 4;
  return Array.from({ length: u[15] ?? 0 }, (_, i) => Math.trunc(u[at + i * 4 + 1]!) * w + Math.trunc(u[at + i * 4]!));
}

/** The pass `update` (flowUpdate() of the app's copy), with the switches of `rules`. */
export function update(
  grid: FlowGrid,
  u: Float32Array,
  fields: FlowFields,
  trail: Float32Array,
  step: number,
  seed: number,
  rules: Rules,
): Float32Array {
  const { width: w, height: h, env } = grid;
  const [gamma, rate, recover] = [u[1]!, u[2]!, u[3]!];
  const [base, foodG] = [u[4]!, u[5]!];
  const [bodyRate, bodyLow, fresh] = [u[9]!, u[10]!, u[11]!];
  const [floor, trailLow, trailScale] = [u[12]!, u[13]!, u[14]!];
  // The strain of the block: the pass reads the trail of that strain alone (ADR 0030).
  const strain = Math.trunc(u[22]!);
  const flux = flowFlux(grid, fields.memory, fields.pressure);
  const sites = siteCells(u, w);
  const fed = sites.filter((c) => fields.memory[c * 4 + 3] !== 0).length >= 2;
  const food = (c: number) => env[c * 4 + 1]! > 0;
  const covered = sites.map((c) => food(c) && fields.memory[c * 4 + 1]! >= bodyLow);
  // Off: the roles of all sites that hold food, as if the colony covered each of them.
  const acting = rules.coveredSitesOnly ? covered : sites.map((c) => food(c));
  const roles = flowRoles(acting, step, seed);
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
        const q = flux[i + k]!;
        const qg = q <= 0 ? 0 : Math.pow(q, gamma);
        mean += 0.25 * (qg / (1 + qg));
      }
      let d = fields.memory[i]!;
      const bodyOld = fields.memory[i + 1]!;
      if (bodyOld >= bodyLow) d = fed ? Math.max(floor, d + rate * (mean - d)) : d;
      else d = Math.min(fresh, Math.max(d, floor) * (1 + recover));
      const own = trail[i + strain]!;
      const presence = Math.min(1, Math.max(0, (own - trailLow) * trailScale));
      const body = bodyOld + bodyRate * (presence - bodyOld);
      const isFood = food(y * w + x);
      let g = body >= bodyLow ? body * (isFood ? foodG : base + d) : 0;
      if (!rules.foodNeedsTube && isFood) g = foodG;
      const site = sites.lastIndexOf(y * w + x);
      const code = site >= 0 && acting[site] ? roles[site]! : 0;
      out.set([d, body, g, code], i);
    }
  return out;
}

/** The pass `pressure` (flowPressure() of the app's copy), with the switches of `rules`. */
export function pressure(
  grid: FlowGrid,
  u: Float32Array,
  memory: Float32Array,
  now: Float32Array,
  before: Float32Array,
  recentre: 0 | 1 | 2,
  rules: Rules,
): Float32Array {
  const { width: w, height: h } = grid;
  const [i0, ghost, omega, weight] = [u[0]!, u[6]!, u[7]!, u[8]!];
  const [limit, limitScale] = [u[25]!, u[26]!];
  const acting = siteCells(u, w).filter((c) => memory[c * 4 + 3] !== 0);
  const first = Math.trunc(u[21]!) * w + Math.trunc(u[20]!);
  const ref = (rules.referenceGivesOrTakes ? (acting[0] ?? first) : first) * 4;
  const level = [0, 1, 2, 3].map((k) =>
    acting.length > 0 ? acting.reduce((a, c) => a + now[c * 4 + k]!, 0) / acting.length : 0,
  );
  const out = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = openCell(grid, x, y);
      if (c < 0) continue;
      const i = c * 4;
      const gc = memory[i + 2]!;
      const nbs = neighbours(grid, x, y);
      const edges = nbs.map((nb) => (nb < 0 ? 0 : edge(gc + ghost, memory[nb * 4 + 2]! + ghost)));
      const sum = edges.reduce((a, b) => a + b, 0);
      const signs = roleSigns(memory[i + 3]!);
      for (let k = 0; k < 4; k++) {
        const pc = now[i + k]!;
        let next = pc;
        if (sum > 0) {
          let acc = 0;
          nbs.forEach((nb, e) => {
            if (edges[e]! > 0) acc += edges[e]! * now[nb * 4 + k]!;
          });
          const sign = signs[k]!;
          const room = rules.pressureLimit
            ? Math.min(1, Math.max(0, (limit - sign * (pc - level[k]!)) * limitScale))
            : 1;
          const balanced = (acc + sign * i0 * room) / sum;
          const jacobi = pc + weight * (balanced - pc);
          const past = before[i + k]! - (recentre === 2 ? before[ref + k]! : 0);
          const om = gc > 0 || !rules.momentumOnTubesOnly ? omega : 1;
          next = om * jacobi + (1 - om) * past;
        }
        if (recentre === 1) next -= now[ref + k]!;
        out[i + k] = next;
      }
    }
  return out;
}

/** One step of the flow: the update, then the pressure iterations (flowStep() of the app's copy). */
export function step(
  grid: FlowGrid,
  u: Float32Array,
  fields: FlowFields,
  trail: Float32Array,
  stepNo: number,
  seed: number,
  rules: Rules,
): FlowFields {
  const memory = update(grid, u, fields, trail, stepNo, seed, rules);
  let [now, before] = [fields.pressure, fields.before];
  for (let i = 0; i < FLOW_ITERATIONS; i++)
    [before, now] = [now, pressure(grid, u, memory, now, before, i === 0 ? 1 : i === 1 ? 2 : 0, rules)];
  return { memory, pressure: now, before };
}
