// The diagnosis of part E2c of the engine of stage 4 (ADR 0072; E2c-NOTES.md), prototype code: the pressure of the
// prototype of stage 4 (sim.ts) in the dish and in the Y-maze. Per seed the least mean pressure of the first `early`
// steps, the worst net source of a component of the network without a port (the sinks on an island), and at a few steps
// the level of the network against the ground beside it. Usage:
//   node --import ./research/flow/register.mjs research/front/e2c-proto.ts layout=dish seeds=1-6 steps=1500 drift=1.5
// `layout`: dish (160 × 160 cells, one food in the middle: research/front/dish.ts) or ymaze (the Y-maze of ADR 0056,
// case none). Other keys set the rules of `front` (sim.ts frontFrom()), on top of the rule set of step 6.
import { dish, yMazeLayout } from './layouts';
import { Sim, frontFrom, params } from './sim';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.split('=') as [string, string]));
// The rule set of step 6 with the forms of a GPU of step 9 (README.md), as the engine has them.
const RULE =
  'speed=0.004 speedOn=push paid=20 norm=2 reach=6 rim=1 colony=1 slimeWeight=0.025 paidOn=sinks sinkAt=edge solver=app drift=1.5 paidBy=rank fresh=box sums=fixed';
const own = ['layout', 'seeds', 'steps', 'early', 'marks', 'shift', 'side', 'start', 'rules', 'scent'];
const rule = Object.fromEntries(RULE.split(' ').map((a) => a.split('=') as [string, string]));
// `rules=0`: none of the rules of stage 4, the app's rules alone.
const front =
  args.rules === '0'
    ? frontFrom({}, [])
    : frontFrom({ ...rule, ...Object.fromEntries(Object.entries(args).filter(([k]) => !own.includes(k))) }, []);
const [from = 1, to = from] = (args.seeds ?? '1-6').split('-').map(Number);
const steps = Number(args.steps ?? 1500);
const early = Number(args.early ?? 60);
const marks = (args.marks ?? '30,100,300,1000,1500').split(',').map(Number);
const layoutName = args.layout ?? 'dish';
// A shift of the pressure of every conducting cell at step `shift.split(':')[0]` by `[1]`, for the test of the level.
const [shiftAt, shiftBy] = (args.shift ?? '-1:0').split(':').map(Number) as [number, number];

// The foods of the start scene three-networks in cells: x, y of the centre, the radius (sites.ts FlowSites).
const SCENE_FOODS: [number, number, number][] = [
  [192, 242, 5.293],
  [148.826, 167.028, 5.323],
  [235.174, 167.028, 5.323],
  [301.608, 255.392, 5.441],
  [235.365, 311.107, 5.323],
  [148.635, 311.107, 5.323],
  [82.392, 255.392, 5.441],
  [67.122, 170, 5.352],
  [110.578, 94.911, 5.352],
  [192, 65.227, 5.293],
  [273.422, 94.911, 5.352],
  [316.878, 170, 5.352],
];

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length > 0 ? s[Math.floor((s.length - 1) / 2)]! : NaN;
};

for (let seed = from; seed <= to; seed++) {
  const side = Number(args.side ?? 160);
  // `scene`: the dish of the start scene of the engine, 384 × 384 cells with its 12 foods (research/front/out of
  // e2c-foods.gpu.test.ts), and the colony on the food `start`: 0 as strain A, 1 as strain B.
  const layout =
    layoutName === 'dish'
      ? dish(side, [[side / 2, side / 2, 5]])
      : layoutName === 'scene'
        ? dish(384, SCENE_FOODS)
        : yMazeLayout([], 19, false).layout;
  if (layoutName === 'scene') {
    const k = Number(args.start ?? 0);
    layout.start = [SCENE_FOODS[k]![0], SCENE_FOODS[k]![1]];
  }
  const sim = new Sim(layout, params({ seed, startStep: 18000, front, scentSteps: Number(args.scent ?? 300) }));
  const inside = sim as unknown as {
    P: Float32Array[];
    Pb: Float32Array[];
    G: Float32Array;
    extra: Float32Array;
    lanes: number;
  };
  const { w, h } = sim;
  const open = layout.open;
  const food = layout.food;
  let least = 0;
  let worstIsland = 0;
  let firstFlux = -1;
  const lines: string[] = [];
  for (let k = 1; k <= steps; k++) {
    // The shift moves the pressure and the momentum of the iteration alike, so it changes no difference of pressures.
    if (k === shiftAt)
      for (const P of [...inside.P, ...inside.Pb])
        for (let c = 0; c < P.length; c++) if (inside.G[c]! > 0) P[c]! += shiftBy;
    sim.advance();
    const G = inside.G;
    // The mean of the lanes that ran, as the drift reads it.
    const mean = (c: number) => {
      let p = 0;
      for (let l = 0; l < inside.lanes; l++) p += inside.P[l]![c]!;
      return p / inside.lanes;
    };
    if (k <= early) for (let c = 0; c < sim.cells; c++) if (open[c]) least = Math.min(least, mean(c));
    if (sim.frontTotal > 0 && firstFlux < 0) firstFlux = k;
    // The components of the network (4 neighbours, G > 0) and the net source of each without a food cell.
    if (k <= early && sim.frontTotal > 0) {
      const label = new Int32Array(sim.cells).fill(-1);
      for (let c0 = 0; c0 < sim.cells; c0++) {
        if (!(G[c0]! > 0) || label[c0]! >= 0) continue;
        let [net, hasFood] = [0, false];
        const stack = [c0];
        label[c0] = c0;
        while (stack.length > 0) {
          const c = stack.pop()!;
          net += inside.extra[c]!;
          if (food[c]) hasFood = true;
          const [x, y] = [c % w, Math.floor(c / w)];
          for (const [a, b] of [
            [x + 1, y],
            [x - 1, y],
            [x, y + 1],
            [x, y - 1],
          ] as const) {
            if (a < 0 || b < 0 || a >= w || b >= h) continue;
            const n = b * w + a;
            if (G[n]! > 0 && label[n]! < 0) {
              label[n] = c0;
              stack.push(n);
            }
          }
        }
        if (!hasFood) worstIsland = Math.min(worstIsland, net / sim.frontTotal);
      }
    }
    if (marks.includes(k)) {
      const dist = new Uint8Array(sim.cells).fill(255);
      let ring: number[] = [];
      for (let c = 0; c < sim.cells; c++)
        if (G[c]! > 0) {
          dist[c] = 0;
          ring.push(c);
        }
      for (let d = 1; d <= 7; d++) {
        const next: number[] = [];
        for (const c of ring) {
          const [x, y] = [c % w, Math.floor(c / w)];
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const [a, b] = [x + dx, y + dy];
              if (a < 0 || b < 0 || a >= w || b >= h) continue;
              const n = b * w + a;
              if (dist[n] !== 255 || !open[n]) continue;
              dist[n] = d;
              next.push(n);
            }
        }
        ring = next;
      }
      const [net, sinks, near, far]: [number[], number[], number[], number[]] = [[], [], [], []];
      for (let c = 0; c < sim.cells; c++) {
        if (!open[c]) continue;
        const v = mean(c);
        if (G[c]! > 0) {
          net.push(v);
          if (inside.extra[c]! < 0) sinks.push(v);
        } else if (dist[c]! <= 7) near.push(v);
        else far.push(v);
      }
      const f = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : '-');
      const lo = (v: number[]) => v.reduce((a, b) => Math.min(a, b), Infinity);
      const hi = (v: number[]) => v.reduce((a, b) => Math.max(a, b), -Infinity);
      lines.push(
        `  step ${String(k)} alive ${String(sim.aliveCount)} sinks ${f(median(sinks))} net [${f(lo(net))} ${f(median(net))} ${f(hi(net))}] near [${f(lo(near))} ${f(median(near))} ${f(hi(near))}] far ${f(median(far))}`,
      );
    }
  }
  console.log(
    `${layoutName} seed ${String(seed)}: first flux ${String(firstFlux)}, least mean pressure in ${String(early)} steps ${least.toFixed(0)}, worst net source of an island ${worstIsland.toFixed(3)} of S`,
  );
  for (const l of lines) console.log(l);
}
