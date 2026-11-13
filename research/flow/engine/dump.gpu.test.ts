// Runs a scene in the real engine and writes its state to research/flow/out/engine/, for the measure scripts of this
// folder (measure-maze.ts, measure-tokyo.ts, exact-flux.ts). Not a test of the app: it runs only when asked, with
// the configuration research/vitest.config.ts (README.md has the commands). The settings come from environment
// variables:
//
// - VITE_SCENE: the id of a scene (maze, tokyo, foraging-maze, ...). VITE_KIND: webgpu or webgl2.
// - VITE_FLOW: 1 or 0. VITE_I0: the flow strength. VITE_SEED: the seed.
// - VITE_STEPS: the steps at which the state is written, as a list.
// - VITE_NAME: the name of the files; without it `<scene>-<kind>-<flow or base>-s<seed>`.
// - VITE_PATCH and VITE_STRAIN: settings and strain settings as JSON, on top of the scene's.
// - VITE_DUMP_P: 1 also writes the environment, the whole flow memory and the pressure (exact-flux.ts reads them).
//
// The trail, the flow memory and the pressure are those of the first strain: the measure scripts read a scene with
// one strain. strains.gpu.test.ts counts the strains of a scene with several (ADR 0031).
import { it } from 'vitest';
import { commands } from 'vitest/browser';
import { Engine } from '../../../src/engine/engine';
import { WebGl2Backend } from '../../../src/engine/gl/backend';
import type { Backend } from '../../../src/engine/types';
import { WebGpuBackend } from '../../../src/engine/webgpu';
import { constrain } from '../../../src/model/params';
import { presetById } from '../../../src/model/presets';

const OUT = 'research/flow/out/engine/';
const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;
const KIND = env.VITE_KIND ?? 'webgpu';
const SCENE = env.VITE_SCENE ?? 'maze';
const FLOW = (env.VITE_FLOW ?? '1') === '1';
const SEED = Number(env.VITE_SEED ?? 1);
const STEPS = (env.VITE_STEPS ?? '500,1000,2000,3000,4000,6000').split(',').map(Number);
const NAME = env.VITE_NAME ?? `${SCENE}-${KIND}-${FLOW ? 'flow' : 'base'}-s${String(SEED)}`;
const PATCH = JSON.parse(env.VITE_PATCH ?? '{}') as Record<string, unknown>;
const STRAIN = JSON.parse(env.VITE_STRAIN ?? '{}') as Record<string, unknown>;

function b64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

it('dumps a run of a scene', async () => {
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 800;
  const backend: Backend = KIND === 'webgpu' ? await WebGpuBackend.create(canvas) : WebGl2Backend.create(canvas);
  const preset = presetById(SCENE);
  if (!preset) throw new Error(`no scene ${SCENE}`);
  const base = preset.settings();
  // Without VITE_I0 the scene keeps its own flow strength.
  const strength = env.VITE_I0 === undefined ? {} : { flowStrength: Number(env.VITE_I0) };
  const settings = constrain({
    ...base,
    seed: SEED,
    flow: FLOW,
    ...strength,
    ...PATCH,
    strains: base.strains.map((st) => ({ ...st, ...STRAIN })),
  });
  // GPU validation errors that no error scope takes: a pass with one would run nothing, and the run would look fine.
  const gpuErrors: string[] = [];
  const device = (backend as unknown as { gpu?: { device: GPUDevice } }).gpu?.device;
  device?.addEventListener('uncapturederror', (e) => {
    if (gpuErrors.length < 5) gpuErrors.push(e.error.message.slice(0, 300));
  });
  const engine = await Engine.create(canvas, settings, undefined, backend);
  await engine.load(settings, preset.env ?? []);
  const sim = engine.sim;
  const log: string[] = [];
  let done = 0;
  const t0 = performance.now();
  for (const target of STEPS) {
    for (let i = done; i < target; i += 16) {
      engine.frame(performance.now(), Math.min(16, target - i));
      if (i % 64 === 0) await sim.finish();
    }
    await sim.finish();
    done = target;
    const [trail, flow, alive] = [await sim.readTrail(), await sim.readFlow(), await sim.alive()];
    const lane0 = Float32Array.from({ length: trail.length / 4 }, (_, i) => trail[i * 4] ?? 0);
    await commands.writeFile(`${OUT}${NAME}-trail-${String(target)}.f32.b64`, b64(new Uint8Array(lane0.buffer)));
    if (flow.length > 0) {
      // The flow memory on the cells that hold a tube, and 0 elsewhere.
      const d = Float32Array.from({ length: flow.length / 4 }, (_, i) =>
        (flow[i * 4 + 1] ?? 0) >= 0.05 ? (flow[i * 4] ?? 0) : 0,
      );
      await commands.writeFile(`${OUT}${NAME}-D-${String(target)}.f32.b64`, b64(new Uint8Array(d.buffer)));
    }
    if (env.VITE_DUMP_P === '1' && flow.length > 0) {
      const envBytes = await sim.readEnv();
      await commands.writeFile(`${OUT}${NAME}-env.u8.b64`, b64(envBytes));
      // The whole memory (4 values per cell) and the pressure of the four lanes, for a look at the flux.
      const pressure = await sim.readPressure();
      await commands.writeFile(`${OUT}${NAME}-memory-${String(target)}.f32.b64`, b64(new Uint8Array(flow.buffer)));
      await commands.writeFile(
        `${OUT}${NAME}-pressure-${String(target)}.f32.b64`,
        b64(new Uint8Array(pressure.buffer)),
      );
    }
    log.push(
      JSON.stringify({
        step: target,
        w: sim.width,
        h: sim.height,
        boundary: settings.boundary,
        agents: sim.agents,
        alive,
        ms: Math.round(performance.now() - t0),
      }),
    );
  }
  log.push(JSON.stringify({ gpuErrors }));
  await commands.writeFile(`${OUT}${NAME}.jsonl`, log.join('\n') + '\n');
  if (gpuErrors.length > 0) throw new Error(`GPU validation errors: ${gpuErrors.join(' | ')}`);
  engine.destroy();
  backend.destroy();
}, 14_400_000);
