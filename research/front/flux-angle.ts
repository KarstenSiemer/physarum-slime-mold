// The flux of a cell against the angle of the flow to the grid (ADR 0080, part E2j; ADR 0081, part E2k). Three forms:
// 4 edges with fluxOn=sum (the app), 4 edges with fluxOn=norm, and 8 edges (stencil=8, the sum over the 8 edges).
//
// 1. The arcs of a still sheet: D the same on every cell (the fresh value, no noise), k = 2, the pressure solved
//    exactly, two steps. The flow runs from the mouth out to the ring of the sinks, about along the radius. For each arc
//    of ARCS: the mean flux of the cells within 3.75° of the angles 0°, 22.5°, 45° and 67.5° from the axis of the
//    channel (both sides), over the one at 0°. With sum it follows |cos φ| + |sin φ| (1, 1.31, 1.41, 1.31).
// 2. A broad uniform flow (ADR 0081): G = 1 on every cell, the pressure falls by F per cell along θ (set by hand, so
//    every cell reads the same). The flux that the middle cell reads, over F.
// 3. A thin straight vein (ADR 0081): only the cells of a digital line through the middle of a box conduct (G = 1, 0
//    elsewhere); a source of 1 at one end, a sink at the other, the pressure solved exactly. The line is 4-connected (a
//    step across a diagonal adds the cell beside it: a staircase) or 8-connected (Bresenham's line). The flux that its
//    cells read in the middle half of its length, over the flux 1 (mean, least and most), and its conductance per
//    unit of length, over that of the line at 0° of the same form. 4 edges do not join the cells of an 8-connected line.
// Usage:
//   node --import ./research/flow/register.mjs research/front/flux-angle.ts
import { FLOW } from '../../src/engine/flow';
import { box } from './layouts';
import { Sim, frontFrom, params } from './sim';
import { ARCS, STILL, stillSheet, stillSim } from './still';

const FORMS = [
  { name: '4 sum', fluxOn: 'sum', stencil: 4 },
  { name: '4 norm', fluxOn: 'norm', stencil: 4 },
  { name: '8', fluxOn: 'sum', stencil: 8 },
] as const;
const ANGLES = [0, 22.5, 45] as const;
/** The slope of each angle of ANGLES, exact. */
const SLOPE: Record<number, number> = { 0: 0, 22.5: Math.SQRT2 - 1, 45: 1 };

const simOf = (w: number, h: number, form: (typeof FORMS)[number]) =>
  new Sim(
    box(w, h, []),
    params({
      scentSteps: 0,
      startAgents: 0,
      front: frontFrom({ fluxOn: form.fluxOn, stencil: String(form.stencil) }),
    }),
  );

// 1. The arcs of a still sheet.
const sheet = stillSheet();
const { w } = sheet.layout;
console.log('1. The arcs of a still sheet, D uniform: the flux at 0°, 22.5°, 45° and 67.5° from the axis over 0°');
for (const form of FORMS) {
  const sim = stillSim(sheet, {
    seed: 1,
    k: 2,
    base: FLOW.base,
    shareOn: 'equal',
    noise: 0,
    fluxOn: form.fluxOn,
    stencil: form.stencil,
  });
  sim.p.front.solver = 'exact';
  sim.flowStep();
  sim.flowStep();
  for (const r of ARCS) {
    const sums = [0, 22.5, 45, 67.5].map((at) => {
      let [s, n] = [0, 0];
      for (let c = 0; c < sim.cells; c++) {
        const [x, y] = [(c % w) + 0.5 - STILL.w / 2, Math.floor(c / w) + 0.5 - STILL.long];
        if (!sheet.body[c] || y < 0 || Math.abs(sheet.dist[c]! - r) >= 1) continue;
        if (Math.abs(Math.abs((Math.atan2(x, y) * 180) / Math.PI) - at) > 3.75) continue;
        s += sim.Q[c]!;
        n++;
      }
      return s / n;
    });
    console.log(
      `  ${form.name} r ${String(r)}: ${sums.map((v) => (v / sums[0]!).toFixed(3)).join(' ')} (Q at 0°: ${sums[0]!.toPrecision(3)})`,
    );
  }
}

// 2. A broad uniform flow.
console.log('2. A broad uniform flow F: the flux of a cell over F at 0°, 22.5° and 45°');
for (const form of FORMS) {
  const F = 0.3;
  const reads = ANGLES.map((deg) => {
    const sim = simOf(9, 9, form);
    const t = (deg * Math.PI) / 180;
    for (let c = 0; c < sim.cells; c++) {
      const [x, y] = [(c % 9) - 4, Math.floor(c / 9) - 4];
      sim.G[c] = 1;
      sim.P[0]![c] = -F * (x * Math.cos(t) + y * Math.sin(t));
    }
    sim.fluxOfCells();
    return sim.Q[4 * 9 + 4]! / F;
  });
  console.log(`  ${form.name}: ${reads.map((v) => v.toFixed(3)).join(' ')}`);
}

// 3. A thin straight vein.
/** The cells of a digital line through the middle of a box of size × size cells at the angle deg, `along` cells long. */
function line(size: number, deg: number, along: number, connect: 4 | 8): [number, number][] {
  const m = SLOPE[deg]!;
  const half = Math.round((along / 2) * Math.cos(Math.atan(m)));
  const mid = Math.floor(size / 2);
  const out: [number, number][] = [];
  for (let i = -half; i <= half; i++) {
    const [x, y] = [mid + i, mid + Math.round(i * m)];
    const last = out.at(-1);
    if (connect === 4 && last && last[1] !== y) out.push([x, last[1]]);
    out.push([x, y]);
  }
  return out;
}

const SIZE = 140;
console.log(
  '3. A thin vein: the flux its cells read over its flux (mean, least, most) and its conductance per length over 0°',
);
for (const form of FORMS)
  for (const connect of [4, 8] as const) {
    if (form.stencil === 4 && connect === 8) continue;
    const parts: string[] = [];
    let axis = NaN;
    for (const deg of ANGLES) {
      const sim = simOf(SIZE, SIZE, form);
      const cells = line(SIZE, deg, 100, connect);
      sim.G.fill(0);
      for (const [x, y] of cells) sim.G[y * SIZE + x] = 1;
      const [a, b] = [cells[0]!, cells.at(-1)!];
      sim.extra.fill(0);
      sim.extra[a[1] * SIZE + a[0]] = 1;
      sim.extra[b[1] * SIZE + b[0]] = -1;
      sim.solveExact();
      const [lo, hi] = [Math.floor(cells.length / 4), Math.floor((3 * cells.length) / 4)];
      const reads = cells.slice(lo, hi).map(([x, y]) => sim.Q[y * SIZE + x]!);
      const mean = reads.reduce((s, v) => s + v, 0) / reads.length;
      // The conductance per unit of length: the flux 1 over the fall of the pressure per cell of length.
      const [p, q] = [cells[lo]!, cells[hi]!];
      const fall = Math.abs(sim.P[0]![p[1] * SIZE + p[0]]! - sim.P[0]![q[1] * SIZE + q[0]]!);
      const conduct = 1 / (fall / Math.hypot(q[0] - p[0], q[1] - p[1]));
      if (deg === 0) axis = conduct;
      parts.push(
        `${String(deg)}°: ${mean.toFixed(3)} (${Math.min(...reads).toFixed(3)} to ${Math.max(...reads).toFixed(3)}), conductance ${(conduct / axis).toFixed(3)}`,
      );
    }
    console.log(`  ${form.name}, ${String(connect)}-connected line: ${parts.join('; ')}`);
  }
