// The time of the pass `rank` of the births that the flux pays (ADR 0071; ADR 0067, decision 1), in the real engine:
// the start scene with the rules of stage 4 on both backends, at the most agents it holds (one per cell) and at its own
// capacity. Not a test of the app: it runs only when asked, with research/vitest.config.ts (research/front/ENGINE.md
// has the command), on a quiet GPU. It warms the scene up, runs to the end of a growth step, and then runs the pass
// `rank` alone, BATCH times in one submission, with the keys of that step and a budget of b for every strain: the
// time of one pass is the time of the batch less that of an empty batch, over BATCH. It writes one line per backend,
// capacity and b to research/front/out/<name>.jsonl, with the agents n, the agents with a key F of each strain, and
// the estimate of ADR 0067, b · n · (1 + ln(F / b)) keys read per strain. Environment variables: VITE_KINDS,
// VITE_CAPACITIES, VITE_WARM (steps before), VITE_BATCH, VITE_BUDGETS, VITE_NAME.
import { expect, it } from 'vitest';
import { commands } from 'vitest/browser';
import { Engine } from '../../src/engine/engine';
import { WebGl2Backend } from '../../src/engine/gl/backend';
import type { Target } from '../../src/engine/gl/gl';
import { instance } from '../../src/engine/instance';
import { strainEnds } from '../../src/engine/pack';
import { BUDGET_LANE, FRONT_LANE, NO_KEY } from '../../src/engine/paid';
import { SINK_STATE_LANES } from '../../src/engine/sinks';
import { territoryOn } from '../../src/engine/territory';
import type { Backend, Sim } from '../../src/engine/types';
import { WebGpuBackend } from '../../src/engine/webgpu';
import { presetById, START } from '../../src/model/presets';

const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;
const KINDS = (env.VITE_KINDS ?? 'webgpu,webgl2').split(',');
const CAPACITIES = (env.VITE_CAPACITIES ?? '1,0.25').split(',').map(Number);
const WARM = Number(env.VITE_WARM ?? 1500);
const BATCH = Number(env.VITE_BATCH ?? 200);
const BUDGETS = (env.VITE_BUDGETS ?? '0,1,2,4,16,64').split(',').map(Number);
const NAME = env.VITE_NAME ?? 'rank';

/** The internals of the WebGPU simulation that the pass needs (sim.ts). */
interface GpuInside {
  kernels: { growth(flow: boolean, territory: boolean): { rank?: GPUComputePipeline } };
  bindCache: Map<string, GPUBindGroup>;
  groups: [number, number];
  agentParity: number;
  occParity: number;
  flowM: number;
  territoryT: number;
}

/** The internals of the WebGL2 simulation that the pass needs (gl/sim.ts). */
interface GlInside {
  gl: WebGL2RenderingContext;
  prog: { territory(): { rank: unknown } };
  agentsTex: [Target, Target];
  a: 0 | 1;
  q: 0 | 1;
  st: 0 | 1;
  tt: 0 | 1;
  agentWidth: number;
  env: Target;
  flow: unknown;
  collision: { occ: [Target, Target] };
  territory: { copies: [Target, Target] };
  sinks: { keys: Target; state: [Target, Target] };
  flowMemories(flow: unknown): Record<string, WebGLTexture>;
  pass(p: unknown, dst: Target, tex: Record<string, WebGLTexture>, ints: Record<string, number>): void;
}

/** The time of `runs` passes of `rank` on WebGPU in one submission, in ms, after the GPU is idle. */
async function gpuBatch(backend: WebGpuBackend, sim: Sim, runs: number): Promise<number> {
  const inside = sim as unknown as GpuInside;
  const device = backend.gpu.device;
  const pipeline = inside.kernels.growth(true, true).rank;
  // The group of the last growth step: the step flipped the occupancy, the flow memory and the territory after it.
  const flip = (b: number) => 1 - b;
  const key = `grow-rank${inside.agentParity}${flip(inside.occParity)}flow${flip(inside.flowM)}terr${flip(inside.territoryT)}-sinks`;
  const group = inside.bindCache.get(key);
  if (!pipeline || !group) throw new Error(`no pass rank of the last growth step (${key})`);
  await device.queue.onSubmittedWorkDone();
  const t0 = performance.now();
  const enc = device.createCommandEncoder();
  const pass = enc.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, group);
  for (let r = 0; r < runs; r++) pass.dispatchWorkgroups(...inside.groups);
  pass.end();
  device.queue.submit([enc.finish()]);
  await device.queue.onSubmittedWorkDone();
  return performance.now() - t0;
}

/** The time of `runs` passes of `rank` (PASS 5 of growth.frag) on WebGL2, in ms, up to a read of one texel. */
function glBatch(sim: Sim, runs: number): number {
  const inside = sim as unknown as GlInside;
  const { gl, sinks, agentsTex, a } = inside;
  const program = inside.prog.territory().rank;
  const dst = agentsTex[a === 0 ? 1 : 0];
  const textures = {
    agentsIn: agentsTex[a].texture,
    keys: sinks.keys.texture,
    occ: inside.collision.occ[inside.q].texture,
    env: inside.env.texture,
    ...inside.flowMemories(inside.flow),
    territory: inside.territory.copies[inside.tt].texture,
    state: sinks.state[inside.st].texture,
  };
  const texel = new Float32Array(4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, texel);
  const t0 = performance.now();
  for (let r = 0; r < runs; r++) inside.pass(program, dst, textures, { agentWidth: inside.agentWidth });
  gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, texel);
  return performance.now() - t0;
}

it('measures the time of the pass rank in the start scene', async () => {
  const rows: string[] = [];
  const preset = presetById(START);
  if (!preset) throw new Error(`no scene ${START}`);
  for (const kind of KINDS)
    for (const capacity of CAPACITIES) {
      const canvas = document.createElement('canvas');
      canvas.width = 1280;
      canvas.height = 800;
      const backend: Backend = kind === 'webgpu' ? await WebGpuBackend.create(canvas) : WebGl2Backend.create(canvas);
      const settings = { ...preset.settings(), seed: 1, territory: true, capacity };
      expect(territoryOn(settings)).toBe(true);
      const engine = await Engine.create(canvas, settings, undefined, backend);
      await engine.load(settings, preset.env ?? []);
      const sim = engine.sim;
      for (let i = 0; i < WARM; i += 50) {
        sim.run(50);
        await sim.finish();
      }
      // To the end of a growth step: the keys of that step are in the buffer.
      const every = engine.settings.growthEvery;
      while ((sim.step - 1) % every !== 0) sim.run(1);
      await sim.finish();
      const keys = await sim.readPaidKeys();
      const state = await sim.readSinkState();
      const strains = engine.settings.strains.length;
      const ends = strainEnds(engine.settings.strains, sim.agents);
      const n = ends.map((end, s) => end - (s > 0 ? (ends[s - 1] ?? 0) : 0));
      const keyed = n.map((_, s) => {
        let f = 0;
        for (let id = s > 0 ? (ends[s - 1] ?? 0) : 0; id < (ends[s] ?? 0); id++) if (keys[id] !== NO_KEY) f++;
        return f;
      });
      const budgets = Array.from({ length: strains }, (_, s) => state[s * SINK_STATE_LANES + BUDGET_LANE] ?? 0);
      const front = Array.from({ length: strains }, (_, s) => state[s * SINK_STATE_LANES + FRONT_LANE] ?? 0);
      const batch = async (runs: number) =>
        kind === 'webgpu' ? gpuBatch(instance(backend, WebGpuBackend), sim, runs) : glBatch(sim, runs);
      for (const b of [...BUDGETS, ...budgets.map((v) => Math.floor(v))]) {
        // The budget of every strain, half a birth above b: the pass reads ⌊B⌋.
        const written = state.slice();
        for (let s = 0; s < strains; s++) written[s * SINK_STATE_LANES + BUDGET_LANE] = b + 0.5;
        sim.writeSinkState(written);
        const times: number[] = [];
        for (let round = 0; round < 5; round++) {
          const empty = await batch(0);
          const full = await batch(BATCH);
          times.push((full - empty) / BATCH);
        }
        times.sort((p, q) => p - q);
        const estimate = n.map((agents, s) => {
          const f = keyed[s] ?? 0;
          return b > 0 && f > 0 ? Math.round(Math.min(b, f) * agents * (1 + Math.log(Math.max(f / b, 1)))) : 0;
        });
        rows.push(
          JSON.stringify({
            kind,
            capacity,
            step: sim.step,
            w: sim.width,
            h: sim.height,
            agents: sim.agents,
            alive: (await sim.alive()).reduce((p, q) => p + q, 0),
            n,
            keyed,
            front,
            budget: budgets,
            b,
            reads: estimate,
            ms: +(times[2] ?? 0).toFixed(4),
            min: +(times[0] ?? 0).toFixed(4),
            max: +(times[4] ?? 0).toFixed(4),
          }),
        );
      }
      engine.destroy();
      backend.destroy();
    }
  await commands.writeFile(`research/front/out/${NAME}.jsonl`, rows.join('\n') + '\n');
}, 3_600_000);
