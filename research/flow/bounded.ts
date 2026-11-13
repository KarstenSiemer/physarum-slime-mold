// What each rule of ADR 0029 does for the pressure: two small scenes on the CPU copy of the passes, with single rules
// switched off (rules.ts).
//
// - scene=grow (decision 6): a mesh of tubes grows from one food over three more foods, as the colony of the Tokyo
//   scene does, and its margin flickers. Prints the largest pressure on the cells with a tube.
// - scene=isolated (decision 3): four foods with tubes, one of them not joined to the others, and a first food of the
//   list that no tube covers. Prints the mean pressure of the network and the flux against the run as built.
//
// Usage: node --import ./research/flow/register.mjs research/flow/bounded.ts [scene=grow] [steps=600] [i0=1]
import { FLOW, flowSites, packFlow } from '../../src/engine/flow.ts';
import { flowFlux, flowStart, flowStep, type FlowFields, type FlowGrid } from '../../src/engine/flow-reference.ts';
import { defaultSettings } from '../../src/model/params.ts';
import { AS_BUILT, step as ruleStep, type Rules } from './rules.ts';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.split('=') as [string, string]));
const scene = args.scene ?? 'grow';
const SEED = 1;

/** Stops when a run with the rules as built differs from the app's copy of the passes. */
function same(a: FlowFields, b: FlowFields, what: string) {
  for (const key of ['memory', 'pressure', 'before'] as const)
    for (let i = 0; i < a[key].length; i++)
      if (!Object.is(a[key][i], b[key][i]))
        throw new Error(`${what}: rules.ts differs from flow-reference.ts in ${key}`);
}

if (scene === 'grow') {
  const n = 64;
  const steps = Number(args.steps ?? 600);
  const i0 = Number(args.i0 ?? 1);
  const env = new Uint8Array(n * n * 4);
  // The first food is at the centre, where the disc starts. The disc reaches the others at about steps 115, 120 and 140.
  const foods: [number, number][] = [
    [n / 2 + 0.5, n / 2 + 0.5],
    [n / 2 - 14.5, n / 2 + 0.5],
    [n / 2 + 12.5, n / 2 + 9.5],
    [n / 2 + 3.5, n / 2 - 17.5],
  ];
  for (const [x, y] of foods)
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) env[((Math.floor(y) + dy) * n + Math.floor(x) + dx) * 4 + 1] = 255;
  const grid: FlowGrid = { width: n, height: n, boundary: 'box', env };
  const settings = { ...defaultSettings(), flowStrength: i0, seed: SEED };
  const u = new Float32Array(packFlow(settings, flowSites(foods, n, n)));
  /** The trail of each step: a disc that grows by a tenth of a cell per step, with tubes 6 cells apart; 5 % of its
   *  cells flip in each step. The same for every run. */
  const trails = (() => {
    let rng = 12345;
    return (stepNo: number) => {
      const radius = 3 + stepNo * 0.1;
      const trail = new Float32Array(n * n * 4);
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          if (Math.hypot(x + 0.5 - foods[0]![0], y + 0.5 - foods[0]![1]) > radius) continue;
          let tube = x % 6 === 2 || y % 6 === 2;
          rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
          if (rng / 2 ** 32 < 0.05) tube = !tube;
          if (tube) trail[(y * n + x) * 4] = 10;
        }
      return trail;
    };
  })();
  const all: Float32Array[] = Array.from({ length: steps }, (_, s) => trails(s));
  const runs: [string, Rules][] = [
    ['as built', AS_BUILT],
    ['food conducts without a tube', { ...AS_BUILT, foodNeedsTube: false }],
    ['every food site gives or takes', { ...AS_BUILT, coveredSitesOnly: false }],
    ['both of these (the first version of the sites)', { ...AS_BUILT, foodNeedsTube: false, coveredSitesOnly: false }],
    ['no pressure limit', { ...AS_BUILT, pressureLimit: false }],
    ['the momentum on every cell', { ...AS_BUILT, momentumOnTubesOnly: false }],
    [
      'the first version: all four rules off',
      { ...AS_BUILT, foodNeedsTube: false, coveredSitesOnly: false, pressureLimit: false, momentumOnTubesOnly: false },
    ],
  ];
  const SHOW = [50, 100, 150, 200, 300, 400, 500, 600];
  console.log(`scene grow: ${n} × ${n} cells, 4 foods, flux ${i0}; the largest pressure on the cells with a tube`);
  console.log(
    `${'rule'.padEnd(48)}${SHOW.filter((s) => s <= steps)
      .map((s) => `step ${s}`.padStart(11))
      .join('')}     top D`,
  );
  for (const [name, rules] of runs) {
    let fields = flowStart(grid, FLOW.fresh);
    let reference = flowStart(grid, FLOW.fresh);
    const row: string[] = [];
    let memoryTop = 0;
    for (let s = 0; s < steps; s++) {
      fields = ruleStep(grid, u, fields, all[s]!, s, SEED, rules);
      if (rules === AS_BUILT) {
        reference = flowStep(grid, u, reference, all[s]!, s, SEED);
        same(fields, reference, `step ${s}`);
      }
      if (!SHOW.includes(s + 1)) continue;
      let top = 0;
      for (let c = 0; c < n * n; c++) {
        if (fields.memory[c * 4 + 1]! < FLOW.bodyLow) continue;
        memoryTop = Math.max(memoryTop, fields.memory[c * 4]!);
        for (let k = 0; k < 4; k++) top = Math.max(top, Math.abs(fields.pressure[c * 4 + k]!));
      }
      row.push((top < 1e5 ? top.toFixed(0) : top.toExponential(1)).padStart(11));
    }
    console.log(`${name.padEnd(48)}${row.join('')}${memoryTop.toFixed(3).padStart(10)}`);
  }
  console.log(
    `the pressure limit of a site is ${FLOW.head * i0}; "top D" is the largest flow memory of a tube cell in the run`,
  );
} else if (scene === 'isolated') {
  const [w, h] = [32, 24];
  const steps = Number(args.steps ?? 6000);
  const i0 = Number(args.i0 ?? 8);
  // X is the first food of the list and lies under a wall. A, B and C are joined by tubes. D has a blob of tube that
  // no tube joins to the others.
  const [A, B, C, D, X]: [number, number][] = [
    [4, 12],
    [20, 12],
    [12, 20],
    [27, 4],
    [2, 2],
  ];
  const env = new Uint8Array(w * h * 4);
  const tube = new Uint8Array(w * h);
  const net = new Uint8Array(w * h);
  const line = (x0: number, y0: number, x1: number, y1: number, half: number, mark: boolean) => {
    for (let y = Math.min(y0, y1) - half; y <= Math.max(y0, y1) + half; y++)
      for (let x = Math.min(x0, x1) - half; x <= Math.max(x0, x1) + half; x++) {
        tube[y * w + x] = 1;
        if (mark) net[y * w + x] = 1;
      }
  };
  line(A![0], A![1], B![0], B![1], 1, true);
  line(C![0], 12, C![0], C![1], 1, true);
  line(D![0], D![1], D![0], D![1], 2, false);
  for (const [x, y] of [A!, B!, C!, D!])
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) env[((y + dy) * w + x + dx) * 4 + 1] = 255;
  env[(X![1] * w + X![0]) * 4] = 255;
  const grid: FlowGrid = { width: w, height: h, boundary: 'box', env };
  const settings = { ...defaultSettings(), flowStrength: i0, seed: SEED };
  const centres = [X!, A!, B!, C!, D!].map(([x, y]): [number, number] => [x + 0.5, y + 0.5]);
  const u = new Float32Array(packFlow(settings, flowSites(centres, w, h)));
  const trail = new Float32Array(w * h * 4);
  for (let c = 0; c < w * h; c++) trail[c * 4] = tube[c] ? 5 : 0;
  const start = () => {
    const fields = flowStart(grid, FLOW.fresh);
    for (let c = 0; c < w * h; c++) fields.memory[c * 4 + 1] = tube[c] ? 1 : 0;
    return fields;
  };
  const old: Rules = { ...AS_BUILT, referenceGivesOrTakes: false };
  let [built, first, reference] = [start(), start(), start()];
  console.log(`scene isolated: ${w} × ${h} cells, flux ${i0}; the first food of the list lies under a wall`);
  for (let s = 0; s < steps; s++) {
    built = ruleStep(grid, u, built, trail, s, SEED, AS_BUILT);
    first = ruleStep(grid, u, first, trail, s, SEED, old);
    reference = flowStep(grid, u, reference, trail, s, SEED);
    same(built, reference, `step ${s}`);
    // Six lines per run, and always the last step (a step count that 6 does not divide printed nothing before).
    if ((s + 1) % Math.max(1, Math.round(steps / 6)) !== 0 && s + 1 !== steps) continue;
    const flux = [flowFlux(grid, built.memory, built.pressure), flowFlux(grid, first.memory, first.pressure)];
    const line2 = [built, first].map((f, i) => {
      let [offset, cells, worst, top] = [0, 0, 0, 0];
      for (let c = 0; c < w * h; c++) {
        if (!net[c]) continue;
        for (let k = 0; k < 4; k++) {
          offset += f.pressure[c * 4 + k]!;
          cells++;
          top = Math.max(top, flux[0]![c * 4 + k]!);
          worst = Math.max(worst, Math.abs(flux[i]![c * 4 + k]! - flux[0]![c * 4 + k]!));
        }
      }
      const mean = (offset / cells).toExponential(2);
      return i === 0
        ? `as built: mean pressure of the network ${mean}`
        : `reference by the first food of the list: mean pressure ${mean}, flux off the run as built by up to ${((100 * worst) / top).toFixed(2)} % of the largest flux`;
    });
    console.log(`step ${String(s + 1).padStart(5)}: ${line2.join(' | ')}`);
  }
} else {
  console.error('Scenes: grow, isolated');
  process.exit(1);
}
