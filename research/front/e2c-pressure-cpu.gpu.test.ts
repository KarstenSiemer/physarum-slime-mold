// The diagnosis of part E2c of the engine of stage 4 (ADR 0072; E2c-NOTES.md): the pressure pass of each strain in the
// start scene with the rules of stage 4, against the CPU copy (flow-reference.ts), step by step: the inputs of a step
// from the GPU (the memory and the two pressures before it, the memory, the rates and the state after it), the 16
// iterations on the CPU, and the largest difference from the pressure that the GPU left. Also the net source of each
// strain (the sum of what the sinks take and the sources give) as the CPU copy computes it from the inputs of the GPU.
import { it } from 'vitest';
import { commands } from 'vitest/browser';
import { Engine } from '../../src/engine/engine';
import { FLOW_ITERATIONS, packFlow } from '../../src/engine/flow';
import { flowPorts, flowPressure, flowUpdate, sinksAndSources, type FlowGrid } from '../../src/engine/flow-reference';
import { WebGl2Backend } from '../../src/engine/gl/backend';
import { readTarget, type Target } from '../../src/engine/gl/gl';
import { readTexture } from '../../src/engine/readback';
import { SINK_STATE_LANES } from '../../src/engine/sinks';
import type { FlowSites } from '../../src/engine/sites';
import { packTerritory } from '../../src/engine/territory';
import type { Backend, Sim } from '../../src/engine/types';
import { WebGpuBackend } from '../../src/engine/webgpu';
import { presetById, START } from '../../src/model/presets';

const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;
const KINDS = (env.VITE_KINDS ?? 'webgpu,webgl2').split(',');
const SEEDS = (env.VITE_SEEDS ?? '1').split(',').map(Number);
const STEPS = Number(env.VITE_STEPS ?? 20);
const EXTRA = JSON.parse(env.VITE_EXTRA ?? '{}') as Record<string, unknown>;
const OUT = env.VITE_OUT ?? 'e2c-pressure-cpu';

/** The pressure one iteration before the last of the step (the momentum), from the inside of each sim. */
async function readBefore(kind: string, sim: Sim, strain: number): Promise<Float32Array> {
  if (kind === 'webgpu') {
    const s = sim as unknown as { device: GPUDevice; flow: { pressure: GPUTexture[] }; flowP: number };
    return readTexture(s.device, s.flow.pressure[(s.flowP + 2) % 3]!, 4, strain);
  }
  const s = sim as unknown as { gl: WebGL2RenderingContext; flow: { pressure: Target[][] }; flowP: number };
  return readTarget(s.gl, s.flow.pressure[strain]![(s.flowP + 2) % 3]!) as Float32Array;
}

it('computes the pressure of each strain as the CPU copy', { timeout: 3_600_000 }, async () => {
  const rows: string[] = [];
  const preset = presetById(START);
  if (!preset) throw new Error(`no scene ${START}`);
  for (const kind of KINDS)
    for (const seed of SEEDS) {
      const canvas = document.createElement('canvas');
      canvas.width = 1280;
      canvas.height = 800;
      const backend: Backend = kind === 'webgpu' ? await WebGpuBackend.create(canvas) : WebGl2Backend.create(canvas);
      const settings = { ...preset.settings(), seed, territory: true, ...EXTRA };
      const engine = await Engine.create(canvas, settings, undefined, backend);
      await engine.load(settings, preset.env ?? []);
      const sim = engine.sim;
      const s0 = engine.settings;
      const strains = s0.strains.length;
      const sites = (sim as unknown as { sites: FlowSites }).sites;
      const envAll = await sim.readEnv();
      const W = Math.round(Math.sqrt(envAll.length / 4));
      const grid: FlowGrid = { width: W, height: W, boundary: s0.boundary, env: envAll };
      for (let k = 0; k < STEPS; k++) {
        const before: { memory: Float32Array; pressure: Float32Array; before: Float32Array }[] = [];
        for (let s = 0; s < strains; s++)
          before.push({
            memory: await sim.readFlow(s),
            pressure: await sim.readPressure(s),
            before: await readBefore(kind, sim, s),
          });
        const statesBefore = await sim.readSinkState();
        const stepBefore = sim.step;
        sim.run(1);
        await sim.finish();
        const states = await sim.readSinkState();
        const trail = await sim.readTrail();
        const parts: string[] = [];
        for (let s = 0; s < strains; s++) {
          const memory = await sim.readFlow(s);
          const rates = await sim.readSinks(s);
          const got = await sim.readPressure(s);
          const u = new Float32Array(packTerritory(packFlow(s0, sites, undefined, s), s0));
          const b = before[s]!;
          const ports = flowPorts(grid, u, sites.cells, {
            memory: b.memory,
            pressure: b.pressure,
            before: b.before,
            ports: new Int32Array(128).fill(-1),
          });
          const state = states.subarray(s * SINK_STATE_LANES, (s + 1) * SINK_STATE_LANES);
          const took = (statesBefore[s * SINK_STATE_LANES + 4] ?? 0) !== 0;
          const fields = { memory: b.memory, pressure: b.pressure, before: b.before, ports };
          const mine = flowUpdate(grid, u, fields, trail, stepBefore, s0.seed, ports, took);
          let [mOff, mAt] = [0, -1];
          for (let i = 0; i < mine.length; i++) {
            const d = Math.abs((memory[i] ?? 0) - (mine[i] ?? 0)) / (1e-5 + Math.abs(mine[i] ?? 0));
            if (d > mOff) [mOff, mAt] = [d, i];
          }
          const extra = sinksAndSources(u, memory, ports, rates, state);
          let [net, onNet] = [0, 0];
          for (let c = 0; c < extra.length; c++) {
            net += extra[c]!;
            if ((memory[4 * c + 2] ?? 0) > 0) onNet += extra[c]!;
          }
          let [p, q] = [b.pressure, b.before];
          for (let i = 0; i < FLOW_ITERATIONS; i++) {
            const next = flowPressure(grid, u, memory, p, q, i === 0 ? 1 : i === 1 ? 2 : 0, ports, extra);
            [q, p] = [p, next];
          }
          let [off, top, at] = [0, 0, -1];
          for (let i = 0; i < p.length; i++) {
            const d = Math.abs((got[i] ?? 0) - (p[i] ?? 0));
            if (d > off) [off, at] = [d, i];
            top = Math.max(top, Math.abs(p[i] ?? 0));
          }
          const c = Math.floor(at / 4);
          parts.push(
            `s${String(s)} takes ${String(state[4])} memory off ${mOff.toPrecision(2)} lane ${String(mAt % 4)} net ${net.toExponential(2)} off-net ${(net - onNet).toExponential(2)} ` +
              `off ${off.toPrecision(3)} of ${top.toPrecision(3)} at (${String(c % W)},${String(Math.floor(c / W))}) gpu ${(got[at] ?? 0).toPrecision(5)} cpu ${(p[at] ?? 0).toPrecision(5)}`,
          );
        }
        rows.push(`${kind} seed ${String(seed)} step ${String(sim.step)}: ${parts.join(' | ')}`);
        await commands.writeFile(`research/front/out/${OUT}.txt`, rows.join('\n') + '\n');
      }
      engine.destroy();
    }
});
