// The flux of a cell along the arcs of a still sheet against the angle (ADR 0080, part E2j): D the same on every cell
// (the fresh value, no noise), k = 2, the pressure solved exactly, two steps. The flow runs from the mouth out to the
// ring of the sinks, about along the radius. For each arc of ARCS: the mean flux of the cells within 3.75° of the
// angles 0°, 22.5°, 45° and 67.5° from the axis of the channel (both sides), over the one at 0°. With fluxOn=sum it
// follows |cos φ| + |sin φ| (1, 1.31, 1.41, 1.31) and stands highest on the diagonals; with norm it is flat. Usage:
//   node --import ./research/flow/register.mjs research/front/flux-angle.ts
import { FLOW } from '../../src/engine/flow';
import { ARCS, STILL, stillSheet, stillSim } from './still';

const sheet = stillSheet();
const { w } = sheet.layout;
for (const fluxOn of ['sum', 'norm'] as const) {
  const sim = stillSim(sheet, { seed: 1, k: 2, base: FLOW.base, shareOn: 'equal', noise: 0, fluxOn });
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
      `${fluxOn} r ${String(r)}: ${sums.map((v) => (v / sums[0]!).toFixed(3)).join(' ')} (Q at 0°: ${sums[0]!.toPrecision(3)})`,
    );
  }
}
