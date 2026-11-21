// Part E4 of the engine of stage 4 (ADR 0088): the scenes of Reid et al. 2012 with the rules of the growth front, in the
// real engine, for the comparison with the prototype (`research/front/start.sh`, `forms.sh`) and between the backends.
// Not a test of the app: it runs only when asked, with research/vitest.config.ts (`research/front/e4.sh` runs it).
//
// A case loads a scene as the app loads it, with its start spot, and steps it with Sim.run(), as the digests do; the
// engine draws a picture only for VITE_PICS. VITE_FRAME=1 steps it with Engine.frame(), which also draws every step,
// as the first campaign on WebGPU ran: both give the same run (ADR 0088, Checks).
//
// - `one`, `both`, `none`: the Y-maze with slime on one arm (the left one for an odd seed, the right one for an even
//   seed, as `slimedOf()` of ymaze.ts), on both arms, and on neither. After every step it reads the trail: a food is
//   touched when one of its cells holds plasm (the low level of plasmLevels(), as the prototype's `trail >= 1`). The run
//   stops when both foods are touched, or VITE_AFTER steps after the first, or at VITE_LIMIT. The record has the form
//   of YRun of ymaze.ts: the engine counts the step that places the colony as its first step, so `first` is the step
//   of the first touch less 1 (ADR 0087).
// - `dish`, `dish-blank`: the scene Slime everywhere, and the same dish without its slime. The run stops when the
//   glucose holds plasm.
// - `open`: the open dish of the prototype (`dish.ts`): 160 × 160 cells, one food of radius 5 in the middle, the
//   colony on the food, no slime. The run stops when the territory of the strain covers half of the open cells.
//
// VITE_STEPS runs every case to that step instead, without a stop: the comparison of the backends. Every VITE_EVERY
// steps a run records the live agents, the cells of the territory, the sinks (the cells whose rate has a minus sign),
// and in the Y-maze the plasm and the territory on the base and on the own part of each arm.
//
// Environment variables: VITE_CASES (a list), VITE_KINDS (webgpu, webgl2), VITE_SEEDS (a list of numbers or ranges:
// 1-40), VITE_LIMIT (20000), VITE_AFTER (2000), VITE_STEPS, VITE_EVERY (50), VITE_PICS (1: a picture at the first
// touch of a food, at the glucose, and at the half of the open dish), VITE_FRAME, VITE_REACH (steps at which a run
// counts, for each sink, the least steps of a path to ground without slime: the study of the reach), VITE_PATCH (JSON
// of settings on top of the scene's) and VITE_OUT (the folder under research/front/out/, e4). The records go to
// <VITE_OUT>/<kind>/<case>.jsonl, the pictures to <VITE_OUT>/<kind>/pics/.
import { it } from 'vitest';
import { commands } from 'vitest/browser';
import { DISH_FILL } from '../../src/engine/brush';
import { Engine } from '../../src/engine/engine';
import { WebGl2Backend } from '../../src/engine/gl/backend';
import { paths, slimeAfter } from '../../src/engine/sinks-reference';
import { SINK_WINDOW } from '../../src/engine/sinks';
import { plasmLevels, slimeSteps } from '../../src/engine/slime';
import type { Backend, Sim } from '../../src/engine/types';
import { WebGpuBackend } from '../../src/engine/webgpu';
import { constrain, type Settings } from '../../src/model/params';
import { presetById, type EnvShape } from '../../src/model/presets';
import { yMaze, type Side } from '../../src/model/y-maze';

const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;
const CASES = (env.VITE_CASES ?? 'one').split(',');
const KINDS = (env.VITE_KINDS ?? 'webgpu').split(',');
const LIMIT = Number(env.VITE_LIMIT ?? 20000);
const AFTER = Number(env.VITE_AFTER ?? 2000);
const STEPS = env.VITE_STEPS ? Number(env.VITE_STEPS) : undefined;
const EVERY = Number(env.VITE_EVERY ?? 50);
const PICS = env.VITE_PICS === '1';
const FRAME = env.VITE_FRAME === '1';
const REACH = (env.VITE_REACH ?? '').split(',').filter(Boolean).map(Number);
const PATCH = JSON.parse(env.VITE_PATCH ?? '{}') as Partial<Settings>;
const OUT = `research/front/out/${env.VITE_OUT ?? 'e4'}`;
const SEEDS = (env.VITE_SEEDS ?? '1').split(',').flatMap((part) => {
  const [from = 0, to = from] = part.split('-').map(Number);
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
});

const Y = yMaze();
/** The open dish of the prototype (dish.ts): its side, and the food of radius 5 in the middle. */
const OPEN = { side: 160, food: 5 } as const;

/** The slime of a case of the Y-maze for a seed (slimedOf() of ymaze.ts). */
const slimedOf = (kind: string, seed: number): Side[] =>
  kind === 'one' ? [seed % 2 === 1 ? 'left' : 'right'] : kind === 'both' ? ['left', 'right'] : [];

/** The settings and the shapes of a case. */
function caseOf(name: string, seed: number): { settings: Settings; shapes: EnvShape[]; slimed: Side[] } {
  if (name === 'one' || name === 'both' || name === 'none') {
    const slimed = slimedOf(name, seed);
    const settings = presetById('y-maze')?.settings();
    if (!settings) throw new Error('no Y-maze');
    return { settings, shapes: [Y.startShape, ...Y.shapes(slimed), ...Y.film(slimed)], slimed };
  }
  if (name === 'dish' || name === 'dish-blank') {
    const p = presetById('slime-everywhere');
    if (!p?.env) throw new Error('no dish');
    const shapes = name === 'dish' ? p.env : p.env.filter((e) => e.kind !== 'slime');
    return { settings: p.settings(), shapes, slimed: [] };
  }
  if (name === 'open') {
    // The settings of the dish of Slime everywhere on the lattice of the prototype's dish; the colony on the food.
    const base = presetById('slime-everywhere')?.settings();
    if (!base) throw new Error('no dish');
    const settings = { ...base, lattice: [OPEN.side, OPEN.side] as [number, number] };
    return { settings, shapes: [{ kind: 'food', at: [0, 0], r: OPEN.food / OPEN.side }], slimed: [] };
  }
  throw new Error(`no case ${name}`);
}

function b64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** The sites of connected food cells of `env` (4 neighbours), each with its cells and its middle (reid.gpu.test.ts). */
function foodSites(bytes: Uint8Array, w: number, h: number) {
  const site = new Int32Array(w * h).fill(-1);
  const sites: { cells: number[]; middle: [number, number] }[] = [];
  for (let c = 0; c < w * h; c++) {
    if ((bytes[c * 4 + 1] ?? 0) < 128 || site[c] !== -1) continue;
    const cells: number[] = [];
    const stack = [c];
    site[c] = sites.length;
    for (let k = stack.pop(); k !== undefined; k = stack.pop()) {
      cells.push(k);
      for (const m of [k + 1, k - 1, k + w, k - w]) {
        const beside = m >= 0 && m < w * h && Math.abs((m % w) - (k % w)) <= 1;
        if (beside && (bytes[m * 4 + 1] ?? 0) >= 128 && site[m] === -1) {
          site[m] = sites.length;
          stack.push(m);
        }
      }
    }
    const mean = (f: (cell: number) => number) => cells.reduce((s, cell) => s + f(cell), 0) / cells.length;
    sites.push({ cells, middle: [mean((cell) => (cell % w) + 0.5), mean((cell) => Math.floor(cell / w) + 0.5)] });
  }
  return sites;
}

/**
 * The study of the reach: for every sink of strain 0 (a rate with a minus sign), the least steps of a path to ground
 * without slime (sinks-reference.ts paths(), the slime after the stamps of the step), up to SINK_WINDOW, else
 * SINK_WINDOW + 1; counted per part of the Y-maze (`slimed` and `blank`: the own parts of the arms; `base`: the rest),
 * or `all` in a dish.
 */
async function reachOf(sim: Sim, settings: Settings, slimed: Side[], maze: boolean) {
  const [rates, stamps, envBytes] = [await sim.readSinks(0), await sim.readSlime(), await sim.readEnv()];
  const { width: w, height: h } = sim;
  const g = { w, h, boundary: settings.boundary, env: envBytes };
  const life = slimeSteps(settings);
  const step = sim.step - 1;
  const part = new Uint8Array(w * h); // 0 base or all, 1 slimed arm, 2 blank arm
  if (maze)
    for (const side of ['left', 'right'] as const) for (const c of Y.arm[side]) part[c] = slimed.includes(side) ? 1 : 2;
  const names = maze ? ['base', 'slimed', 'blank'] : ['all'];
  const counts = names.map(() => new Array<number>(SINK_WINDOW + 2).fill(0));
  for (let c = 0; c < w * h; c++) {
    if (!((rates[c] ?? 0) < 0)) continue;
    let least = SINK_WINDOW + 1;
    for (const [t, k] of paths(g, c, SINK_WINDOW)) if (k < least && !slimeAfter(stamps[t] ?? 0, step, life)) least = k;
    const row = counts[part[c] ?? 0];
    if (row) row[least] = (row[least] ?? 0) + 1;
  }
  return Object.fromEntries(names.map((n, i) => [n, counts[i]]));
}

it('runs the scenes of Reid et al. 2012 with the rules of the growth front (ADR 0088)', async () => {
  for (const kind of KINDS)
    for (const name of CASES) {
      const lines: string[] = [];
      for (const seed of SEEDS) {
        const t0 = performance.now();
        const made = caseOf(name, seed);
        const settings = constrain({ ...made.settings, ...PATCH, seed });
        const [lw = 1, lh = 1] = settings.lattice ?? [];
        const canvas = document.createElement('canvas');
        [canvas.width, canvas.height] = [1000, Math.round((1000 * lh) / lw)];
        const backend: Backend = kind === 'webgpu' ? await WebGpuBackend.create(canvas) : WebGl2Backend.create(canvas);
        const engine = await Engine.create(canvas, settings, undefined, backend);
        await engine.load(settings, made.shapes);
        const sim = engine.sim;
        const { width: w, height: h } = sim;
        const sites = foodSites(await sim.readEnv(), w, h);
        const low = plasmLevels(settings)[0] ?? 1;
        const maze = name === 'one' || name === 'both' || name === 'none';
        // The left food is the first site of the maze: its middle lies left of the middle of the lattice.
        const sideOf = (k: number): Side => ((sites[k]?.middle[0] ?? 0) < w / 2 ? 'left' : 'right');
        const touched: (number | null)[] = sites.map(() => null);
        // The open cells of the open dish, as dish() of layouts.ts takes them.
        const radius = DISH_FILL * 0.5 * w;
        let open = 0;
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++) if (Math.hypot(x + 0.5 - w / 2, y + 0.5 - h / 2) <= radius) open++;
        let half = -1;
        const rows: Record<string, unknown>[] = [];
        const reach: Record<string, unknown>[] = [];
        let agents = 0;
        const snap = async (what: string) => {
          if (!PICS) return;
          const blob = await engine.snapshot();
          const file = `${OUT}/${kind}/pics/${name}-s${String(seed)}-${what}-${String(sim.step)}.png.b64`;
          await commands.writeFile(file, b64(new Uint8Array(await blob.arrayBuffer())));
        };
        const look = async () => {
          const trail = await sim.readTrail();
          const plasm = (c: number) => (trail[c * 4] ?? 0) >= low;
          const before = touched.some((t) => t !== null);
          sites.forEach((site, k) => {
            if (touched[k] === null && site.cells.some(plasm)) touched[k] = sim.step;
          });
          if (!before && touched.some((t) => t !== null)) {
            agents = (await sim.alive())[0] ?? 0;
            await snap('touch');
          }
          let territory: Uint8Array | undefined;
          if (name === 'open' && half < 0) {
            territory = await sim.readTerritory();
            let cells = 0;
            for (let c = 0; c < w * h; c++) if ((territory[c] ?? 0) & 1) cells++;
            if (cells >= 0.5 * open) {
              half = sim.step;
              await snap('half');
            }
          }
          if (REACH.includes(sim.step))
            reach.push({ step: sim.step, ...(await reachOf(sim, settings, made.slimed, maze)) });
          if (sim.step % EVERY !== 0) return;
          territory ??= await sim.readTerritory();
          const sinks = await sim.readSinks(0);
          const count = (list: number[], f: (c: number) => boolean) => list.filter(f).length;
          const all = Array.from({ length: w * h }, (_, c) => c);
          const mine = (c: number) => ((territory[c] ?? 0) & 1) !== 0;
          const row: Record<string, unknown> = {
            step: sim.step,
            alive: (await sim.alive())[0] ?? 0,
            territory: count(all, mine),
            sinks: count(all, (c) => (sinks[c] ?? 0) < 0),
            plasm: count(all, plasm),
          };
          if (maze)
            for (const [part, cells] of [
              ['base', Y.base],
              ['left', Y.arm.left],
              ['right', Y.arm.right],
            ] as const)
              row[part] = { plasm: count(cells, plasm), territory: count(cells, mine) };
          rows.push(row);
        };
        const stepTo = async (target: number) => {
          while (sim.step < target) {
            const n = Math.min(100, target - sim.step);
            if (FRAME) engine.frame(performance.now(), n);
            else sim.run(n);
            await sim.finish();
          }
        };
        await look();
        const last = STEPS ?? LIMIT;
        for (;;) {
          if (sim.step >= last) break;
          const first = touched.reduce<number | null>(
            (a, t) => (t === null ? a : a === null ? t : Math.min(a, t)),
            null,
          );
          if (STEPS === undefined) {
            if (maze && touched.every((t) => t !== null)) break;
            if (maze && first !== null && sim.step - first >= AFTER) break;
            if ((name === 'dish' || name === 'dish-blank') && first !== null) break;
            if (name === 'open' && half >= 0) break;
          }
          // The comparison of the backends reads every VITE_EVERY steps; the other runs read every step.
          await stepTo(STEPS === undefined ? sim.step + 1 : Math.min(last, (Math.floor(sim.step / EVERY) + 1) * EVERY));
          await look();
        }
        // The record of the Y-maze in the form of YRun of ymaze.ts: steps from the start of the colony.
        const at: Record<Side, number> = { left: -1, right: -1 };
        sites.forEach((_, k) => {
          const t = touched[k];
          if (t !== null && t !== undefined) at[sideOf(k)] = t - 1;
        });
        const [l, r] = [at.left, at.right];
        const chosen = l < 0 && r < 0 ? 'none' : l === r ? 'split' : r < 0 || (l >= 0 && l < r) ? 'left' : 'right';
        const firstFood = Math.min(...[l, r].filter((v) => v >= 0), Infinity);
        const line = {
          kind,
          case: name,
          seed,
          slimed: made.slimed,
          chosen,
          first: Number.isFinite(firstFood) ? firstFood : null,
          other: l >= 0 && r >= 0 ? Math.max(l, r) - firstFood : -1,
          agents,
          touched: sites.map((s, k) => ({ middle: s.middle.map((v) => Math.round(v * 10) / 10), step: touched[k] })),
          half: half >= 0 ? half - 1 : -1,
          open,
          step: sim.step,
          drift: settings.drift,
          patch: PATCH,
          rows,
          reach,
          ms: Math.round(performance.now() - t0),
        };
        lines.push(JSON.stringify(line));
        await commands.writeFile(`${OUT}/${kind}/${name}.jsonl`, lines.join('\n') + '\n');
        engine.destroy();
        backend.destroy();
      }
    }
}, 86_400_000);
