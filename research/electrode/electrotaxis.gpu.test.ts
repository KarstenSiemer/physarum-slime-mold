// The scene Electrotaxis (ADR 0047) in the real engine: where the agents go between the anodes and the cathodes
// (README.md). Not a test of the app: it runs only when asked, with the configuration research/vitest.config.ts.
//
// Built as the app builds a scene (Engine.create and Engine.load on a canvas of 1280 × 800). For each seed it runs the
// scene and writes one line per sample to research/electrode/out/<label>.jsonl: the agents alive, their mean x and y,
// the spread of x, and how many stand within NEAR cells of a cathode and of an anode. Environment variables:
//
// - VITE_EL_KIND: webgpu or webgl2. VITE_EL_LABEL: the name of the file.
// - VITE_EL_SEEDS (1 to 10). VITE_EL_STEPS: the steps of a run (600). VITE_EL_EVERY: the steps between samples (25).
// - VITE_EL_SETTLE: so many steps without agents first, as Tsuda et al. 2011 let their field settle for 400 steps
//   (p. 10). The app has no such phase, so the run copies the scent of a run with the start layout Empty into the
//   scene before its first step (Sim.writeScent). 0: the scene as the app runs it.
// - VITE_EL_PATCH: settings as JSON. VITE_EL_STRAIN: values of the strain as JSON.
// - VITE_EL_SWAP=1: the poles change places, the anodes on the left and the cathodes on the right.
import { it } from 'vitest';
import { commands } from 'vitest/browser';
import { Engine } from '../../src/engine/engine';
import { WebGl2Backend } from '../../src/engine/gl/backend';
import type { Backend } from '../../src/engine/types';
import { WebGpuBackend } from '../../src/engine/webgpu';
import { constrain, type Settings, type Strain } from '../../src/model/params';
import { ELECTROTAXIS, presetById, type EnvShape } from '../../src/model/presets';

const OUT = 'research/electrode/out/';
const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;
const list = (text: string | undefined, fallback: string) => (text ?? fallback).split(',').filter(Boolean).map(Number);
const KIND = env.VITE_EL_KIND ?? 'webgpu';
const LABEL = env.VITE_EL_LABEL ?? `electrotaxis-${KIND}`;
const SEEDS = list(env.VITE_EL_SEEDS, '1,2,3,4,5,6,7,8,9,10');
const STEPS = Number(env.VITE_EL_STEPS ?? 600);
const EVERY = Number(env.VITE_EL_EVERY ?? 25);
const SETTLE = Number(env.VITE_EL_SETTLE ?? 0);
const PATCH = JSON.parse(env.VITE_EL_PATCH ?? '{}') as Partial<Settings>;
const STRAIN = JSON.parse(env.VITE_EL_STRAIN ?? '{}') as Partial<Strain>;
const SWAP = env.VITE_EL_SWAP === '1';
/** Cells: an agent this close to the middle of an electrode stands at it. */
const NEAR = 12;

it('moves the agents of Tsuda et al. 2011 between the electrodes', async () => {
  const backend: Backend =
    KIND === 'webgpu'
      ? await WebGpuBackend.create(document.createElement('canvas'))
      : WebGl2Backend.create(document.createElement('canvas'));
  // One backend for all runs: an engine destroys its backend, this one is lent.
  const lent = new Proxy(backend, {
    get(target, key) {
      if (key === 'destroy') return () => undefined;
      return Reflect.get(target, key, target) as unknown;
    },
  });
  const preset = presetById('electrotaxis');
  if (!preset) throw new Error('no scene electrotaxis');
  const shapes: EnvShape[] = (preset.env ?? []).map((e) =>
    SWAP && e.kind !== 'food' ? { ...e, kind: e.kind === 'anode' ? 'cathode' : 'anode' } : e,
  );
  const make = async (s: Settings) => {
    const canvas = document.createElement('canvas');
    [canvas.width, canvas.height] = [1280, 800];
    const engine = await Engine.create(canvas, s, undefined, lent);
    await engine.load(s, shapes);
    return engine;
  };
  const lines: string[] = [];
  for (const seed of SEEDS) {
    const base = preset.settings();
    const s = constrain({
      ...base,
      seed,
      strains: base.strains.map((strain) => ({ ...strain, ...STRAIN })),
      ...PATCH,
    });
    // The field after SETTLE steps without agents: it does not depend on the seed, but on the settings of the run.
    let settled: Float32Array | undefined;
    if (SETTLE > 0) {
      const empty = await make({ ...s, layout: 'empty' });
      empty.sim.run(SETTLE);
      settled = await empty.sim.readScent();
      empty.destroy();
    }
    const engine = await make(s);
    const sim = engine.sim;
    if (settled) sim.writeScent(settled);
    const { width: w, height: h } = sim;
    // The middles of the electrodes on this grid, from the bytes that the scene painted.
    const bytes = await sim.readEnv();
    const columns = { cathode: 0, anode: 0, cathodes: 0, anodes: 0 };
    for (let c = 0; c < w * h; c++) {
      const b = bytes[c * 4 + 3] ?? 0;
      if (b > 191) [columns.cathode, columns.cathodes] = [columns.cathode + (c % w) + 0.5, columns.cathodes + 1];
      else if (b > 0) [columns.anode, columns.anodes] = [columns.anode + (c % w) + 0.5, columns.anodes + 1];
    }
    const [cathodeX, anodeX] = [columns.cathode / columns.cathodes, columns.anode / columns.anodes];
    const pole = (kind: 'cathode' | 'anode') =>
      shapes
        .filter((e) => e.kind === kind)
        .map((e): [number, number] => [w / 2 + (e.at[0] / 1.6) * w, h / 2 + e.at[1] * h]);
    const [cathodes, anodes] = [pole('cathode'), pole('anode')];
    const near = (x: number, y: number, at: [number, number][]) =>
      at.some(([px, py]) => Math.hypot(x - px, y - py) <= NEAR);
    const sample = async () => {
      const agents = (await sim.readAgents()).filter((a) => (a.bits & 4) !== 0);
      const n = agents.length;
      const mx = agents.reduce((sum, a) => sum + a.x, 0) / n;
      const my = agents.reduce((sum, a) => sum + a.y, 0) / n;
      const sx = Math.sqrt(agents.reduce((sum, a) => sum + (a.x - mx) ** 2, 0) / n);
      const xs = agents.map((a) => a.x).sort((p, q) => p - q);
      const scent = await sim.readScent();
      // The map that Jones' agents sense beside the electrodes, along the middle row: food scent − repellent.
      const row = Math.floor(h / 2);
      const field = [0.1, 0.3, 0.5, 0.7, 0.9].map((share) => {
        const c = row * w + Math.floor(share * w);
        return Number(((scent[c * 2] ?? 0) - (scent[c * 2 + 1] ?? 0)).toPrecision(4));
      });
      lines.push(
        JSON.stringify({
          kind: KIND,
          label: LABEL,
          settle: SETTLE,
          swap: SWAP,
          w,
          h,
          seed,
          step: sim.step,
          alive: n,
          x: Number(mx.toFixed(3)),
          y: Number(my.toFixed(3)),
          sx: Number(sx.toFixed(3)),
          x10: Number((xs[Math.floor(0.1 * n)] ?? 0).toFixed(2)),
          x90: Number((xs[Math.floor(0.9 * n)] ?? 0).toFixed(2)),
          cathodeX: Number(cathodeX.toFixed(2)),
          anodeX: Number(anodeX.toFixed(2)),
          atCathode: agents.filter((a) => near(a.x, a.y, cathodes)).length,
          atAnode: agents.filter((a) => near(a.x, a.y, anodes)).length,
          field,
        }),
      );
    };
    await sample();
    while (sim.step < STEPS) {
      sim.run(Math.min(EVERY, STEPS - sim.step));
      await sample();
    }
    console.log(`ELECTRO ${KIND} ${LABEL} seed=${String(seed)} ${lines.at(-1) ?? ''}`);
    await commands.writeFile(`${OUT}${LABEL}.jsonl`, lines.join('\n') + '\n');
    engine.destroy();
  }
  backend.destroy();
}, 3_600_000);

/** The cells of the layout, for the reader of a log. */
export const LAYOUT = ELECTROTAXIS;
