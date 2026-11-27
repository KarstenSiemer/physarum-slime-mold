// The survey of the growth (phase 0b of the plan of 2026-11-22, option 1 of its section 3.3): what stops the growth in
// each scene with growth. Each scene runs twice: as it is, and with the rules of the growth front switched by a patch
// of its settings (`territory`). The scenes keep their settings (ADR 0089). A scene in which the patch does not
// switch the rules runs once: the rules need the flow, and the Jones model has none (territoryOn()). WebGPU, the
// scene's own seed and lattice, 20,000 steps of sim.run() without frames. Every 50 steps the alive agents of each
// strain (`trace`); every 500 steps a record of each strain (measure()); pictures of the app at the steps of PICS.
// The records and the pictures go to research/front/out/survey/, one file of records per run. Not a test of the app.
//
// Usage: npx vitest run --config research/vitest.config.ts research/front/growth-survey.gpu.test.ts
// Variables: VITE_ONLY (scene ids), VITE_CASES (as-is,switched), VITE_STEPS (20000), VITE_EVERY (500),
// VITE_PICS (5000,10000,20000), VITE_OUT (research/front/out/survey). A lever: VITE_PATCH (settings as JSON) changes
// every run on top of its case, and VITE_TAG names it at the end of the name of the run.
import { it } from 'vitest';
import { commands } from 'vitest/browser';
import { Engine } from '../../src/engine/engine';
import { FLOW, flowOn } from '../../src/engine/flow';
import { grid, occupancy, windowCounts } from '../../src/engine/growth-reference';
import { strainAgents } from '../../src/engine/pack';
import { paidIncrement } from '../../src/engine/paid';
import { SINK_STATE_LANES } from '../../src/engine/sinks';
import type { FlowSites } from '../../src/engine/sites';
import { plasmLevels } from '../../src/engine/slime';
import { territoryOn } from '../../src/engine/territory';
import type { AgentState, Sim } from '../../src/engine/types';
import { WebGpuBackend } from '../../src/engine/webgpu';
import { constrain, type Settings } from '../../src/model/params';
import { PRESETS, type Preset } from '../../src/model/presets';

const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;
const ONLY = (env.VITE_ONLY ?? '').split(',').filter(Boolean);
const CASES = (env.VITE_CASES ?? 'as-is,switched').split(',');
const STEPS = Number(env.VITE_STEPS ?? 20000);
const EVERY = Number(env.VITE_EVERY ?? 500);
const PICS = new Set((env.VITE_PICS ?? '5000,10000,20000').split(',').filter(Boolean).map(Number));
const OUT = env.VITE_OUT ?? 'research/front/out/survey';
const PATCH = JSON.parse(env.VITE_PATCH ?? '{}') as Partial<Settings>;
const TAG = env.VITE_TAG ?? '';
/** The steps between two reads of the alive agents: the peak and its step to this precision. */
const TRACE = 50;
const ALIVE = 4;
/** The names of the lanes of the state of the sinks of a strain (sinks.ts SINK_STATE_LANES, paid.ts). */
const LANES = ['rate', 'tubeCells', 'sinks', 'ports', 'takes', 'budget', 'front', 'claims'] as const;

interface Run {
  preset: Preset;
  name: string;
  patch: Partial<Settings>;
}

const runs: Run[] = PRESETS.filter((p) => p.settings().growth && (ONLY.length === 0 || ONLY.includes(p.id))).flatMap(
  (p) => {
    const s = constrain(p.settings());
    const patch = { territory: !s.territory };
    const switches = territoryOn(constrain({ ...s, ...patch })) !== territoryOn(s);
    const out: Run[] = [];
    const tag = TAG ? `-${TAG}` : '';
    if (CASES.includes('as-is')) out.push({ preset: p, name: `${p.id}-as-is${tag}`, patch: { ...PATCH } });
    if (CASES.includes('switched') && switches)
      out.push({
        preset: p,
        name: `${p.id}-rules-${patch.territory ? 'on' : 'off'}${tag}`,
        patch: { ...patch, ...PATCH },
      });
    return out;
  },
);

const b64 = (u: Uint8Array) => {
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};

/** The cells within `r` cells of a cell of `mask` in x and in y, on the rectangle of the grid (no wrap). */
function dilate(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const sums = new Int32Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += mask[y * w + x] ?? 0;
      sums[(y + 1) * (w + 1) + x + 1] = (sums[y * (w + 1) + x + 1] ?? 0) + row;
    }
  }
  const at = (x: number, y: number) => sums[y * (w + 1) + x] ?? 0;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const [y0, y1] = [Math.max(0, y - r), Math.min(h, y + r + 1)];
    for (let x = 0; x < w; x++) {
      const [x0, x1] = [Math.max(0, x - r), Math.min(w, x + r + 1)];
      if (at(x1, y1) - at(x0, y1) - at(x1, y0) + at(x0, y0) > 0) out[y * w + x] = 1;
    }
  }
  return out;
}

/**
 * What keeps each alive agent from dividing now, by the first test of Jones' rule that it fails (docs/model.md,
 * section 9; divideInto() in growth-reference.ts), per strain: `dying`, it dies in the shrinkage test; `dense` and
 * `sparse`, its window of growth holds more than growthMax or fewer than growthMin agents; `starved`, its cell has
 * D < 0.01; `boxed`, no neighbour is free (open and empty); `closed`, each free neighbour has D < 0.01; `outside`,
 * each free neighbour that is left lies outside the territory of its strain. An agent that passes every test can
 * divide (`can`); `dark` of them have such a neighbour without light, where light cannot stop the birth. The census
 * leaves out that a parent must have moved in the step.
 */
function census(
  agents: readonly AgentState[],
  s: Settings,
  w: number,
  h: number,
  envBytes: Uint8Array,
  flows: readonly Float32Array[],
  terr: Uint8Array | undefined,
) {
  const { cellAt, cellOf } = grid(w, h, s.boundary);
  const occ = occupancy(agents, w, h, s.boundary);
  const windows = windowCounts(occ, w, h, s.boundary, s.growthWindow, s.shrinkWindow);
  const habitable = (c: number) => c >= 0 && (envBytes[c * 4] ?? 0) < 128;
  const wall = (c: number) => c >= 0 && (envBytes[c * 4] ?? 0) >= 128;
  const starved = (strain: number, c: number) => {
    const d = flows[strain]?.[c * 4];
    return d !== undefined && d < FLOW.half;
  };
  const counts = s.strains.map(() => ({
    dying: 0,
    dense: 0,
    sparse: 0,
    starved: 0,
    boxed: 0,
    closed: 0,
    outside: 0,
    can: 0,
    dark: 0,
  }));
  for (const a of agents) {
    const c = cellOf(a);
    const k = counts[a.bits & 3];
    if (!(a.bits & ALIVE) || c < 0 || !k) continue;
    const strain = a.bits & 3;
    const [nG, nS] = [windows[c * 2] ?? 0, windows[c * 2 + 1] ?? 0];
    if (s.shrinkEvery > 0 && (nS < s.shrinkMin || nS > s.shrinkMax)) k.dying++;
    else if (nG > s.growthMax) k.dense++;
    else if (nG < s.growthMin) k.sparse++;
    else if (starved(strain, c)) k.starved++;
    else {
      const [x, y] = [c % w, Math.floor(c / w)];
      const free: number[] = [];
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const t = cellAt(x + dx, y + dy);
          if ((dx === 0 && dy === 0) || !habitable(t) || (occ[t] ?? 0) !== 0) continue;
          if (dx !== 0 && dy !== 0 && wall(cellAt(x + dx, y)) && wall(cellAt(x, y + dy))) continue;
          free.push(t);
        }
      const fed = free.filter((t) => !starved(strain, t));
      const own = terr ? fed.filter((t) => (((terr[t] ?? 0) >> strain) & 1) === 1) : fed;
      if (free.length === 0) k.boxed++;
      else if (fed.length === 0) k.closed++;
      else if (own.length === 0) k.outside++;
      else {
        k.can++;
        if (own.some((t) => (envBytes[t * 4 + 2] ?? 0) === 0)) k.dark++;
      }
    }
  }
  return counts;
}

/**
 * The record of a step, per strain: the alive agents and their share of the capacity; `plasm`, the cells with a trail
 * at the plasm level; `reached`, the open cells within half a window of growth of plasm; `fresh`, the open cells that
 * the colony has not reached and that are open for births (D ≥ 0.01): the room it has left; `tubes`, the cells with a
 * tube body (B ≥ 0.05), `tubesStarved` of them with D < 0.01; `closed`, the open cells with D < 0.01, closed for
 * births, `closedReached` of them within the reach of the plasm; `covered`, the food sites that the strain covers
 * (docs/model.md, 8.2); while the rules run `territory`, its cells, and `state`, the lanes of the state of its sinks
 * with the budget of the paid births; and the census().
 */
async function measure(sim: Sim, s: Settings, open: Uint8Array, sites: FlowSites, rules: boolean) {
  const [w, h] = [sim.width, sim.height];
  const n = w * h;
  const alive = await sim.alive();
  const capacity = strainAgents(s.strains, sim.agents);
  const trail = await sim.readTrail();
  const envBytes = await sim.readEnv();
  // The memory of the flow of each strain; empty while the flow is off.
  const flows: Float32Array[] = [];
  for (let k = 0; k < s.strains.length; k++) flows.push(await sim.readFlow(k));
  const terr = rules ? await sim.readTerritory() : undefined;
  const state = rules ? await sim.readSinkState() : undefined;
  const counts = census(await sim.readAgents(), s, w, h, envBytes, flows, terr);
  const low = plasmLevels(s);
  const strains = s.strains.map((_, k) => {
    const flow = flows[k]?.length ? flows[k] : undefined;
    const mask = new Uint8Array(n);
    let plasm = 0;
    for (let c = 0; c < n; c++)
      if ((trail[c * 4 + k] ?? 0) >= (low[k] ?? 1)) {
        mask[c] = 1;
        plasm++;
      }
    const reach = dilate(mask, w, h, Math.floor(s.growthWindow / 2));
    let [reached, fresh, tubes, tubesStarved, closed, closedReached, territory] = [0, 0, 0, 0, 0, 0, 0];
    for (let c = 0; c < n; c++) {
      const D = flow ? (flow[c * 4] ?? 0) : 1;
      if (flow && (flow[c * 4 + 1] ?? 0) >= FLOW.bodyLow) {
        tubes++;
        if (D < FLOW.half) tubesStarved++;
      }
      if (terr && ((terr[c] ?? 0) >> k) & 1) territory++;
      if (!open[c]) continue;
      if (reach[c]) reached++;
      if (D < FLOW.half) {
        closed++;
        if (reach[c]) closedReached++;
      } else if (!reach[c]) fresh++;
    }
    let covered: number | null = null;
    if (flow) {
      covered = 0;
      for (const site of sites.list)
        for (let i = site.offset; i < site.offset + site.count; i++) {
          const c = sites.cells[i] ?? n;
          if (c < n && open[c] && (envBytes[c * 4 + 1] ?? 0) > 0 && (flow[c * 4 + 1] ?? 0) >= FLOW.bodyLow) {
            covered++;
            break;
          }
        }
    }
    const row: Record<string, unknown> = {
      alive: alive[k] ?? 0,
      capacity: capacity[k] ?? 0,
      plasm,
      reached,
      fresh,
      tubes,
      tubesStarved,
      closed,
      closedReached,
      covered,
      census: counts[k],
    };
    if (terr) row.territory = territory;
    if (state)
      row.state = Object.fromEntries(LANES.map((name, lane) => [name, state[k * SINK_STATE_LANES + lane] ?? 0]));
    return row;
  });
  return { step: sim.step, alive: alive.reduce((a, b) => a + b, 0), strains };
}

for (const run of runs)
  it(run.name, { timeout: 3_600_000 }, async () => {
    const { preset } = run;
    const settings = constrain({ ...preset.settings(), ...run.patch });
    const canvas = document.createElement('canvas');
    // The canvas of the digests (research/flow/engine/digest.gpu.test.ts): a scene without a lattice gets 512 × 320.
    [canvas.width, canvas.height] = [1280, 800];
    const backend = await WebGpuBackend.create(canvas);
    const engine = await Engine.create(canvas, settings, undefined, backend);
    try {
      await engine.load(settings, preset.env ?? []);
      const sim = engine.sim;
      const [w, h] = [sim.width, sim.height];
      const rules = territoryOn(settings);
      const envBytes = await sim.readEnv();
      const { cellAt } = grid(w, h, settings.boundary);
      const open = new Uint8Array(w * h);
      let [food, lit] = [0, 0];
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const c = cellAt(x, y);
          if (c < 0 || (envBytes[c * 4] ?? 0) >= 128) continue;
          open[c] = 1;
          if ((envBytes[c * 4 + 1] ?? 0) > 0) food++;
          if ((envBytes[c * 4 + 2] ?? 0) > 0) lit++;
        }
      // The food sites of the flow, as the engine gave them to the simulation (Engine.syncSites()).
      const sites = (sim as unknown as { sites?: FlowSites }).sites ?? { list: [], cells: new Uint32Array(0) };
      const lines = [
        JSON.stringify({
          scene: preset.id,
          run: run.name,
          patch: run.patch,
          seed: settings.seed,
          w,
          h,
          agents: sim.agents,
          capacity: strainAgents(settings.strains, sim.agents),
          open: open.reduce((a, b) => a + b, 0),
          food,
          lit,
          sites: sites.list.length,
          flow: flowOn(settings),
          rules,
          flowStrength: settings.flowStrength,
          increment: rules ? paidIncrement(settings.flowStrength) : 0,
          growth: [settings.growthEvery, settings.growthWindow, settings.growthMin, settings.growthMax],
          shrinkage: [settings.shrinkEvery, settings.shrinkWindow, settings.shrinkMin, settings.shrinkMax],
          lightGrowth: settings.lightGrowth,
          capacitySetting: settings.capacity,
          step: sim.step,
        }),
      ];
      const file = `${OUT}/${run.name}.jsonl`;
      const write = () => commands.writeFile(file, lines.join('\n') + '\n');
      const t0 = performance.now();
      const trace: number[][] = [];
      lines.push(JSON.stringify({ ...(await measure(sim, settings, open, sites, rules)), ms: 0 }));
      await write();
      while (sim.step < STEPS) {
        const next = Math.min(STEPS, (Math.floor(sim.step / TRACE) + 1) * TRACE);
        sim.run(next - sim.step);
        await sim.finish();
        const k = sim.step;
        trace.push([k, ...(await sim.alive())]);
        if (k % EVERY === 0 || k === STEPS) {
          const ms = Math.round(performance.now() - t0);
          lines.push(JSON.stringify({ ...(await measure(sim, settings, open, sites, rules)), ms }));
          await write();
        }
        if (PICS.has(k)) {
          const blob = await engine.snapshot();
          const pic = `${OUT}/${run.name}-${String(k).padStart(5, '0')}.png`;
          await commands.writeFile(pic, b64(new Uint8Array(await blob.arrayBuffer())), 'base64');
        }
      }
      const total = trace.map(([k, ...a]): [number, number] => [k ?? 0, a.reduce((x, y) => x + y, 0)]);
      let peak: [number, number] = [0, -1];
      for (const row of total) if (row[1] > peak[1]) peak = row;
      lines.push(
        JSON.stringify({
          peak: peak[1],
          peakStep: peak[0],
          end: total[total.length - 1]?.[1] ?? 0,
          ms: Math.round(performance.now() - t0),
          trace,
        }),
      );
      await write();
    } finally {
      engine.destroy();
    }
  });
