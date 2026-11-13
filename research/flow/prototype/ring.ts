// Checks the three solvers against the ring of Tero 2007, Sec. 5.2: two tubes of lengths L1 and L2 between a source
// and a sink, f(Q) = Q^mu. Closed forms: mu < 1: D_i = Q_i^mu, Q_1 = 1 / (1 + (L1/L2)^(1/(1 − mu))); mu = 1: the
// shorter tube alone, D = 1.
import { defaultFlow, Flow, type Solver } from './flow.ts';
import type { World } from './world.ts';

function ring(n1: number, n2: number): { world: World; s: number; t: number; a: number; b: number } {
  // Row 1 holds the source, n1 cells and the sink. The longer tube leaves the source downward, runs along row 3
  // and comes back up: n2 = n1 + 2 * depth cells.
  const depth = (n2 - n1) / 2;
  const w = n1 + 4;
  const h = depth + 4;
  const open = new Uint8Array(w * h);
  const s = 1 * w + 1;
  const t = 1 * w + (n1 + 2);
  for (let x = 1; x <= n1 + 2; x++) open[1 * w + x] = 1;
  for (let y = 2; y <= depth + 1; y++) {
    open[y * w + 1] = 1;
    open[y * w + n1 + 2] = 1;
  }
  for (let x = 1; x <= n1 + 2; x++) open[(depth + 2) * w + x] = 1;
  // The lower tube: depth cells down, n1 + 2 cells across, depth cells up, minus nothing: count its cells.
  const food = new Uint8Array(w * h);
  food[s] = 1;
  food[t] = 1;
  const world: World = {
    w,
    h,
    boundary: 'box',
    open,
    wall: new Uint8Array(w * h),
    food,
    light: new Uint8Array(w * h),
    clear: new Uint8Array(w * h),
    sites: [],
  };
  return { world, s, t, a: 1 * w + 3, b: (depth + 2) * w + 3 };
}

const trailFull = (world: World) => new Float32Array(world.w * world.h).fill(100);

for (const solver of ['exact', 'lag', 'ma'] as Solver[]) {
  for (const mu of [0.8, 1.0]) {
    const n1 = 10;
    const depth = 2;
    const { world, s, t, a, b } = ring(n1, n1 + 2 * depth);
    // Lengths in cells between the terminals: upper n1, lower depth + (n1 + 2) + depth.
    const [L1, L2] = [n1, n1 + 2 + 2 * depth];
    const fp = {
      ...defaultFlow(),
      solver,
      law: 'power' as const,
      gamma: mu,
      i0: 1,
      base: 0,
      foodG: 1e6,
      rate: 0.02,
      dFloor: 0,
      iterations: 40,
      radius: 0.999,
      walkers: 20000,
      dt: 0.5,
      tolerance: 1e-10,
    };
    const flow = new Flow(world, fp);
    flow.D.fill(0.75);
    const trail = trailFull(world);
    const steps = mu === 1 ? 6000 : 3000;
    for (let k = 0; k < steps; k++) flow.advance(trail, s, t);
    const q1 = mu < 1 ? 1 / (1 + (L1 / L2) ** (1 / (1 - mu))) : 1;
    const expect = [q1 ** mu, mu < 1 ? (1 - q1) ** mu : 0];
    console.log(
      JSON.stringify({
        solver,
        mu,
        L1,
        L2,
        D1: +flow.D[a]!.toFixed(4),
        D2: +flow.D[b]!.toFixed(4),
        expect: expect.map((v) => +v.toFixed(4)),
        Q1: +flow.Q[a]!.toFixed(4),
        Q2: +flow.Q[b]!.toFixed(4),
        stats: flow.stats,
      }),
    );
  }
}
