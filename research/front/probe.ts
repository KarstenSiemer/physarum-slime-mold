// A short look at the pressure and the flux of a run of the prototype. Prototype code.
import { dish } from './layouts';
import { Sim, noFront, params } from './sim';
const front = {
  ...noFront(),
  hold: 0.01,
  holdOn: 'body' as const,
  holdBirthsOn: 'trail' as const,
  paid: 5,
  norm: 0.5,
  young: 300,
  solver: (process.argv[2] ?? 'app') as 'app' | 'exact',
};
const sim = new Sim(dish(160, [[80, 80, 5]]), params({ foodStrength: 0, front }));
for (let k = 1; k <= 3000; k++) {
  sim.advance();
  if (k % 1000 === 0) {
    const P = sim.P[0]!;
    let [lo, hi, qmax, dmax] = [Infinity, -Infinity, 0, 0];
    const vals: number[] = [];
    for (let c = 0; c < sim.cells; c++)
      if (sim.B[c]! >= 0.05) {
        lo = Math.min(lo, P[c]!);
        hi = Math.max(hi, P[c]!);
        qmax = Math.max(qmax, sim.Q[c]!);
        dmax = Math.max(dmax, sim.D[c]!);
        vals.push(sim.Q[c]!);
      }
    vals.sort((a, b) => a - b);
    const food = sim.layout.sites[0]![0]!;
    console.log(
      k,
      'P food',
      P[food]!.toFixed(1),
      'P range',
      lo.toFixed(1),
      hi.toFixed(1),
      'Q max',
      qmax.toFixed(2),
      'Q median',
      vals[vals.length >> 1]!.toFixed(3),
      'D max',
      dmax.toFixed(2),
      'demand',
      sim.demand,
    );
  }
}
