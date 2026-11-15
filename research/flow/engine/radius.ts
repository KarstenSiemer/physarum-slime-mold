// The local pressure solver with several radii on a network of the real engine (ADR 0029, decision 18): the Tokyo
// scene, or another scene, from a dump of dump.gpu.test.ts with VITE_DUMP_P=1. The network stays fixed: the memory of the
// dump (conductivity and roles) and its grid. Two cases, each for every radius and every pressure field:
//
// - cold: from a pressure of 0, with the roles of the dump, as solvers.ts does it on the Maze network.
// - draw: from the exact pressure of the roles of the dump, a new draw of roles in every field (the roles of the step
//   300 steps later, flowRoles() in src/engine/flow.ts): the pressure of a warm network has to move to the new roles.
//
// The iteration is that of the pass `pressure` (flowPressure() in src/engine/flow-reference.ts), 16 iterations per
// step, with the omega of each radius in place of the app's. The script first checks that its loop gives the bits of
// flowPressure(). The exact pressure of a field is the solution of the same system by the method of conjugate
// gradients (as exact-flux.ts), every site with its full I0. The error of a field is the sum over all cells of |its
// flux − the exact flux| over the sum of the exact flux (as solvers.ts).
//
// Usage: node --import ./research/flow/register.mjs research/flow/engine/radius.ts <name> <step> <i0> [seed]
// Environment variables: SCENE (tokyo), RADII (0.99999,0.999999), COLD (the steps of the cold start; 1500), DRAW (the
// steps after the draw; 600).
import { readFileSync } from 'node:fs';
import { fromShape, strokeOn } from '../../../src/engine/environment.ts';
import { FLOW_ITERATIONS, FLOW_SITES, flowRoles, packFlow } from '../../../src/engine/flow.ts';
import { flowPorts, flowPressure, openCell, type FlowGrid } from '../../../src/engine/flow-reference.ts';
import { flowSites, foodStrokes } from '../../../src/engine/sites.ts';
import { constrain, type Boundary } from '../../../src/model/params.ts';
import { presetById } from '../../../src/model/presets.ts';
import { outDir } from '../prototype/out.ts';

const DIR = process.env.DIR ?? outDir('engine/');
const [name = '', step, i0, seed] = [
  process.argv[2],
  Number(process.argv[3]),
  Number(process.argv[4]),
  Number(process.argv[5] ?? 1),
];
const SCENE = process.env.SCENE ?? 'tokyo';
const RADII = (process.env.RADII ?? '0.99999,0.999999').split(',').map(Number);
const COLD = Number(process.env.COLD ?? 1500);
const DRAW = Number(process.env.DRAW ?? 600);
const SHOW = [1, 5, 10, 20, 50, 100, 150, 200, 300, 400, 500, 600, 800, 1000, 1500, 2000, 3000, 5000];

// --- The network of the dump --------------------------------------------------------------------------------------
const f32 = (file: string) =>
  new Float32Array(new Uint8Array(Buffer.from(readFileSync(DIR + file, 'utf8'), 'base64')).buffer);
const log = readFileSync(`${DIR}${name}.jsonl`, 'utf8')
  .trim()
  .split('\n')
  .map((l) => JSON.parse(l) as { step?: number; w?: number; h?: number; boundary?: Boundary; radius?: number });
const row = log.find((l) => l.step === step);
if (!row?.w || !row.h || !row.boundary) throw new Error(`${name}.jsonl has no line for step ${String(step)}`);
const [w, h, boundary] = [row.w, row.h, row.boundary];
const n = w * h;
const grid: FlowGrid = {
  width: w,
  height: h,
  boundary,
  env: new Uint8Array(Buffer.from(readFileSync(`${DIR}${name}-env.u8.b64`, 'utf8'), 'base64')),
};
const memory = f32(`${name}-memory-${String(step)}.f32.b64`);
const dumped = f32(`${name}-pressure-${String(step)}.f32.b64`);

// The sites of the scene, as the engine makes them (research/flow/sites.ts), and the uniform block of its passes.
const preset = presetById(SCENE);
if (!preset) throw new Error(`no scene ${SCENE}`);
const settings = constrain({ ...preset.settings(), flowStrength: i0, seed });
const strokes = foodStrokes((preset.env ?? []).map((e) => fromShape(e, settings.boundary))).map((s) =>
  s.flatMap((e) => strokeOn(e, w, h) ?? []),
);
const sites = flowSites(strokes, w, h, boundary);
const u = new Float32Array(packFlow(settings, sites));
const [ghost, weight, limit, limitScale] = [u[6]!, u[8]!, u[25]!, u[26]!];

// The ports: the pass reads the cell of each site that holds its role (the memory of the dump has the roles of the
// step at the ports of the step). A covered site without a role in any field has no cell with a code; its port is
// the covered cell nearest its centre (flowPorts()), which a new draw needs.
const nearest = flowPorts(grid, u, sites.cells, {
  memory,
  pressure: dumped,
  before: dumped,
  ports: new Int32Array(FLOW_SITES * 2),
});
const ports = new Int32Array(FLOW_SITES * 2).fill(-1);
let [coded, moved] = [0, 0];
sites.list.forEach((site, i) => {
  let port = -1;
  for (let k = site.offset; k < site.offset + site.count; k++) {
    const c = sites.cells[k]!;
    if (memory[c * 4 + 3] !== 0) port = c;
  }
  if (port >= 0) coded++;
  else port = nearest[i * 2]!;
  if (port >= 0 && port !== nearest[i * 2]) moved++;
  ports[i * 2] = port;
  ports[i * 2 + 1] = port;
});
const covered = sites.list.map((_, i) => ports[i * 2]! >= 0);

// The open cells, their neighbours (east, west, south, north) and the conductances of their edges: `iter` with the
// ghost conductivity, as the iteration uses it, and `real` as the flux counts it (flowFlux()).
const edge = (a: number, b: number) => (a <= 0 || b <= 0 ? 0 : (2 * a * b) / (a + b));
const cells: number[] = [];
const nb = new Int32Array(n * 4).fill(-1);
const iter = new Float64Array(n * 4);
const real = new Float64Array(n * 4);
const sum = new Float64Array(n);
let tubes = 0;
for (let y = 0; y < h; y++)
  for (let x = 0; x < w; x++) {
    const c = openCell(grid, x, y);
    if (c < 0) continue;
    cells.push(c);
    const gc = memory[c * 4 + 2]!;
    if (gc > 0) tubes++;
    [openCell(grid, x + 1, y), openCell(grid, x - 1, y), openCell(grid, x, y + 1), openCell(grid, x, y - 1)].forEach(
      (q, e) => {
        if (q < 0) return;
        nb[c * 4 + e] = q;
        iter[c * 4 + e] = edge(gc + ghost, memory[q * 4 + 2]! + ghost);
        real[c * 4 + e] = edge(gc, memory[q * 4 + 2]!);
        sum[c] = sum[c]! + iter[c * 4 + e]!;
      },
    );
  }

/** The flux through each cell in each field, as the pass `update` counts it: half the sum over its edges. */
function fluxOf(p: ArrayLike<number>): Float64Array {
  const q = new Float64Array(n * 4);
  for (const c of cells)
    for (let e = 0; e < 4; e++) {
      const g = real[c * 4 + e]!;
      if (g <= 0) continue;
      const d = nb[c * 4 + e]! * 4;
      for (let k = 0; k < 4; k++) q[c * 4 + k] = q[c * 4 + k]! + 0.5 * Math.abs(g * (p[c * 4 + k]! - p[d + k]!));
    }
  return q;
}

/** The sign of the role of each cell in each field: +1 gives, −1 takes, 0 none (roleSigns() of the app). */
function signsOf(codes: Float32Array): Int8Array {
  const s = new Int8Array(n * 4);
  for (let c = 0; c < n; c++) {
    const code = codes[c * 4 + 3]!;
    if (code === 0) continue;
    for (let k = 0; k < 4; k++) {
      const digit = Math.floor(code / 3 ** k) % 3;
      s[c * 4 + k] = digit === 1 ? 1 : digit === 2 ? -1 : 0;
    }
  }
  return s;
}

/** The exact pressure of each field for the roles of `signs`: conjugate gradients to a residual of 10⁻⁸. */
function exact(signs: Int8Array): { pressure: Float64Array; its: number[] } {
  const pressure = new Float64Array(n * 4);
  const its: number[] = [];
  const x = new Float64Array(n);
  const [r, z, d, q] = [new Float64Array(n), new Float64Array(n), new Float64Array(n), new Float64Array(n)];
  const apply = (v: Float64Array, out: Float64Array) => {
    for (const c of cells) {
      let a = sum[c]! * v[c]!;
      for (let e = 0; e < 4; e++) if (iter[c * 4 + e]! > 0) a -= iter[c * 4 + e]! * v[nb[c * 4 + e]!]!;
      out[c] = a;
    }
  };
  for (let k = 0; k < 4; k++) {
    x.fill(0);
    let [rz, norm0] = [0, 0];
    for (const c of cells) {
      const s = signs[c * 4 + k]! * i0;
      r[c] = s;
      z[c] = sum[c]! > 0 ? s / sum[c]! : 0;
      d[c] = z[c]!;
      rz += r[c] * z[c];
      norm0 += s * s;
    }
    let it = 0;
    for (; it < 100000 && norm0 > 0; it++) {
      apply(d, q);
      let dq = 0;
      for (const c of cells) dq += d[c]! * q[c]!;
      const alpha = rz / dq;
      let [rr, rzNew] = [0, 0];
      for (const c of cells) {
        x[c] = x[c]! + alpha * d[c]!;
        const rc = r[c]! - alpha * q[c]!;
        r[c] = rc;
        z[c] = sum[c]! > 0 ? rc / sum[c]! : 0;
        rr += rc * rc;
        rzNew += rc * z[c];
      }
      if (rr < 1e-16 * norm0) break;
      const beta = rzNew / rz;
      rz = rzNew;
      for (const c of cells) d[c] = z[c]! + beta * d[c]!;
    }
    its.push(it);
    for (const c of cells) pressure[c * 4 + k] = x[c]!;
  }
  return { pressure, its };
}

/**
 * One iteration of the pass for all four fields: the operations of flowPressure() in its order, on 64-bit numbers
 * that are stored as 32-bit floats. `acting`: the ports of the sites that give or take in at least one field, in the
 * order of the list of sites.
 */
function iterate(
  p: Float32Array,
  before: Float32Array,
  signs: Int8Array,
  acting: number[],
  omega: number,
  recentre: 0 | 1 | 2,
): Float32Array {
  const out = new Float32Array(n * 4);
  const ref = (acting[0] ?? Math.trunc(u[21]!) * w + Math.trunc(u[20]!)) * 4;
  const level = [0, 1, 2, 3].map((k) =>
    acting.length > 0 ? acting.reduce((a, c) => a + p[c * 4 + k]!, 0) / acting.length : 0,
  );
  for (const c of cells) {
    const i = c * 4;
    const om = memory[i + 2]! > 0 ? omega : 1;
    for (let k = 0; k < 4; k++) {
      const pc = p[i + k]!;
      let next = pc;
      if (sum[c]! > 0) {
        let acc = 0;
        for (let e = 0; e < 4; e++) if (iter[i + e]! > 0) acc += iter[i + e]! * p[nb[i + e]! * 4 + k]!;
        const sign = signs[i + k]!;
        const room = Math.min(1, Math.max(0, (limit - sign * (pc - level[k]!)) * limitScale));
        const balanced = (acc + sign * u[0]! * room) / sum[c]!;
        const jacobi = pc + weight * (balanced - pc);
        const past = before[i + k]! - (recentre === 2 ? before[ref + k]! : 0);
        next = om * jacobi + (1 - om) * past;
      }
      if (recentre === 1) next -= p[ref + k]!;
      out[i + k] = next;
    }
  }
  return out;
}
const recentreOf = (i: number): 0 | 1 | 2 => (i === 0 ? 1 : i === 1 ? 2 : 0);
const actingOf = (codes: Float32Array) =>
  sites.list.flatMap((_, i) => {
    const c = ports[i * 2]!;
    return c >= 0 && codes[c * 4 + 3] !== 0 ? [c] : [];
  });

const omegaOf = (radius: number) => Math.fround(2 / (1 + Math.sqrt(1 - radius * radius)));
console.log(
  `${name} step ${String(step)} (run with the radius ${String(row.radius ?? 'of the app')}): ${String(w)} × ${String(h)} cells, ${String(cells.length)} open, ${String(tubes)} with a tube; ${String(sites.list.length)} sites, ${String(covered.filter(Boolean).length)} covered, ${String(coded)} with a role (${String(moved)} of their cells not the covered cell nearest the centre); I0 ${String(i0)}`,
);

// The check: two steps of the loop of this script against flowPressure().
{
  const signs = signsOf(memory);
  const acting = actingOf(memory);
  let [p1, b1]: [Float32Array, Float32Array] = [new Float32Array(n * 4), new Float32Array(n * 4)];
  let [p2, b2]: [Float32Array, Float32Array] = [new Float32Array(n * 4), new Float32Array(n * 4)];
  let differ = 0;
  for (let i = 0; i < 2 * FLOW_ITERATIONS; i++) {
    const r = recentreOf(i % FLOW_ITERATIONS);
    [b1, p1] = [p1, iterate(p1, b1, signs, acting, u[7]!, r)];
    [b2, p2] = [p2, flowPressure(grid, u, memory, p2, b2, r, ports)];
    for (let c = 0; c < n * 4; c++) if (!Object.is(p1[c], p2[c])) differ++;
  }
  if (differ > 0) throw new Error(`the loop of this script differs from flowPressure() in ${String(differ)} values`);
  console.log(
    `check: the loop of this script gives the bits of flowPressure() over ${String(2 * FLOW_ITERATIONS)} iterations`,
  );
}

/** Runs the iteration from `start` for `steps` steps; prints the error of each field against `goal`. */
function run(
  label: string,
  codes: Float32Array,
  start: Float32Array,
  goal: Float64Array,
  omega: number,
  steps: number,
) {
  const signs = signsOf(codes);
  const acting = actingOf(codes);
  const exactQ = fluxOf(goal);
  const total = [0, 1, 2, 3].map((k) => cells.reduce((a, c) => a + exactQ[c * 4 + k]!, 0));
  let p: Float32Array = Float32Array.from(start);
  let before: Float32Array = Float32Array.from(start);
  const first = [0, 1, 2, 3].map(() => new Map<string, number>());
  const lines: string[] = [];
  let top = 0;
  for (let s = 1; s <= steps; s++) {
    for (let i = 0; i < FLOW_ITERATIONS; i++)
      [before, p] = [p, iterate(p, before, signs, acting, omega, recentreOf(i))];
    for (const c of cells)
      if (memory[c * 4 + 2]! > 0) for (let k = 0; k < 4; k++) top = Math.max(top, Math.abs(p[c * 4 + k]!));
    if (!SHOW.includes(s) && s !== steps && s % 50 !== 0) continue;
    const q = fluxOf(p);
    const e = [0, 1, 2, 3].map(
      (k) => cells.reduce((a, c) => a + Math.abs(q[c * 4 + k]! - exactQ[c * 4 + k]!), 0) / total[k]!,
    );
    e.forEach((v, k) => {
      for (const [mark, level] of [
        ['20 %', 0.2],
        ['5 %', 0.05],
        ['1 %', 0.01],
      ] as const)
        if (v < level && !first[k]!.has(mark)) first[k]!.set(mark, s);
    });
    if (SHOW.includes(s) || s === steps)
      lines.push(
        `  step ${String(s).padStart(5)}: error ${e.map((v) => `${(100 * v).toFixed(1)} %`.padStart(9)).join('')}`,
      );
  }
  console.log(
    `${label}, radius ${String(RADII.find((r) => omegaOf(r) === omega))} (omega ${omega.toFixed(5)}): error per field 0 to 3`,
  );
  console.log(lines.join('\n'));
  first.forEach((m, k) => {
    console.log(
      `  field ${String(k)}: ${['20 %', '5 %', '1 %'].map((mark) => `below ${mark} from step ${String(m.get(mark) ?? `> ${String(steps)}`)}`).join(', ')}`,
    );
  });
  console.log(`  the largest |pressure| on a cell with a tube: ${top.toFixed(0)}`);
}

const old = exact(signsOf(memory));
let exactTop = 0;
for (const c of cells)
  if (memory[c * 4 + 2]! > 0)
    for (let k = 0; k < 4; k++) exactTop = Math.max(exactTop, Math.abs(old.pressure[c * 4 + k]!));
console.log(
  `exact for the roles of the dump: ${old.its.join(', ')} iterations; the largest |pressure| on a tube ${exactTop.toFixed(0)}`,
);

// The roles of a new draw: those of the step 300 steps later, at the same ports, in every field.
const drawn = Float32Array.from(memory);
const roles = flowRoles(covered, step + 300, seed);
for (let c = 0; c < n; c++) drawn[c * 4 + 3] = 0;
sites.list.forEach((_, i) => {
  const c = ports[i * 2]!;
  if (c >= 0) drawn[c * 4 + 3] = roles[i] ?? 0;
});
const fresh = exact(signsOf(drawn));
// The share of the flux that changes with the draw: the flux of the old roles against the flux of the new.
{
  const [a, b] = [fluxOf(old.pressure), fluxOf(fresh.pressure)];
  const change = [0, 1, 2, 3].map((k) => {
    let [d, t] = [0, 0];
    for (const c of cells) {
      d += Math.abs(a[c * 4 + k]! - b[c * 4 + k]!);
      t += b[c * 4 + k]!;
    }
    return `${((100 * d) / t).toFixed(0)} %`;
  });
  console.log(
    `exact for the roles of step ${String(step + 300)}: ${fresh.its.join(', ')} iterations; the error of the old exact flux against the new: ${change.join(', ')}`,
  );
}

const zero = new Float32Array(n * 4);
const warm = Float32Array.from(old.pressure);
for (const radius of RADII) {
  const omega = omegaOf(radius);
  run('cold start, the roles of the dump', memory, zero, old.pressure, omega, COLD);
  run(
    `a new draw on the warm network, the roles of step ${String(step + 300)}`,
    drawn,
    warm,
    fresh.pressure,
    omega,
    DRAW,
  );
}
