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
// - VITE_RECOVER: the share by which the flow memory of ground without a tube grows per step (FLOW.recover in
//   src/engine/flow.ts), in place of the app's, for the measurement of decision 19 of ADR 0029. Each line of the log
//   names the share of the run.
// - VITE_GROUND: 1 also writes the flow memory of every cell, with the ground that holds no tube (`-ground-`;
//   strands.ts reads it).
// - VITE_CUT: the Cut tool held over a disc, as JSON [x, y, r, from, to]: the centre and the radius in the frame of the
//   scene's shapes (EnvShape in src/model/presets.ts), from the step `from` to the step `to`, as the app holds it
//   (Engine.agentTool()).
// - VITE_REMOVE: the colony taken off a disc at a step, as JSON [x, y, r, step] in the same frame: every agent in the
//   disc dies, its trail is 0, and its cells hold no tube of the first strain (tube body 0). The flow memory stays: the
//   next step of the flow treats it as that of ground that lost its tube (ADR 0029, decision 7). The Cut tool moves
//   the agents of its wound to random points of the grid instead, where growth makes colonies of them (decision 19).
// - VITE_EDITS: painted discs at a step, as JSON [[step, kind, x, y, r], ...] in the same frame, kind erase or food
//   (Engine.paint()).
//
// The trail, the flow memory and the pressure are those of the first strain: the measure scripts read a scene with
// one strain. strains.gpu.test.ts counts the strains of a scene with several (ADR 0031).
import { it } from 'vitest';
import { commands } from 'vitest/browser';
import { Engine } from '../../../src/engine/engine';
import { fromShape, strokeOn } from '../../../src/engine/environment';
import { FLOW as RULE } from '../../../src/engine/flow';
import { WebGl2Backend } from '../../../src/engine/gl/backend';
import { AgentToolKind } from '../../../src/engine/pack';
import type { Backend, EnvTool } from '../../../src/engine/types';
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
// packFlow() reads the share at every upload of the uniform block, so a share set before the engine starts holds for
// the whole run.
if (env.VITE_RECOVER !== undefined) (RULE as { recover: number }).recover = Number(env.VITE_RECOVER);
const CUT = env.VITE_CUT === undefined ? undefined : (JSON.parse(env.VITE_CUT) as number[]);
const REMOVE = env.VITE_REMOVE === undefined ? undefined : (JSON.parse(env.VITE_REMOVE) as number[]);
const EDITS = JSON.parse(env.VITE_EDITS ?? '[]') as [number, EnvTool, number, number, number][];

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
  // A disc in the frame of the scene's shapes, on the grid of the simulation: its centre and its radius in cells. The
  // kind of the shape does not change where it lies.
  const onGrid = (x: number, y: number, r: number) => {
    const st = strokeOn(fromShape({ kind: 'food', at: [x, y], r }, settings.boundary), sim.width, sim.height);
    if (!st) throw new Error(`the disc ${String([x, y, r])} lies outside the grid`);
    return { at: st.from, radius: st.radius };
  };
  const cut = CUT && { ...onGrid(CUT[0] ?? 0, CUT[1] ?? 0, CUT[2] ?? 0), from: CUT[3] ?? 0, to: CUT[4] ?? 0 };
  const remove = REMOVE && { ...onGrid(REMOVE[0] ?? 0, REMOVE[1] ?? 0, REMOVE[2] ?? 0), step: REMOVE[3] ?? 0 };
  // The steps at which the run changes: the cut starts or ends, the colony is taken off, or an edit is painted. A frame
  // ends at each of them.
  const marks = [...(cut ? [cut.from, cut.to] : []), ...(remove ? [remove.step] : []), ...EDITS.map((e) => e[0])];
  const log: string[] = [];
  let done = 0;
  const t0 = performance.now();
  for (const target of STEPS) {
    for (let i = done; i < target;) {
      for (const [step, kind, x, y, r] of EDITS)
        if (step === i) {
          const disc = onGrid(x, y, r);
          engine.paint({ kind, from: disc.at, to: disc.at, radius: disc.radius });
        }
      if (remove?.step === i) {
        await sim.finish();
        const within = (x: number, y: number) => Math.hypot(x - remove.at[0], y - remove.at[1]) < remove.radius;
        (await sim.readAgents()).forEach((a, k) => {
          if ((a.bits & 4) !== 0 && within(a.x, a.y)) sim.writeAgent(k, { ...a, bits: a.bits & 3 });
        });
        const trail = await sim.readTrail();
        for (let c = 0; c < sim.width * sim.height; c++)
          if (within((c % sim.width) + 0.5, Math.floor(c / sim.width) + 0.5)) trail.fill(0, c * 4, c * 4 + 4);
        sim.writeTrail(trail);
        const memory = await sim.readFlow(0);
        for (let c = 0; c < sim.width * sim.height; c++)
          if (within((c % sim.width) + 0.5, Math.floor(c / sim.width) + 0.5)) memory[c * 4 + 1] = 0;
        sim.writeFlow(memory, 0);
      }
      const next = Math.min(target, i + 16, ...marks.filter((m) => m > i));
      if (cut && i >= cut.from && i < cut.to)
        engine.agentTool({
          kind: AgentToolKind.cut,
          x: cut.at[0],
          y: cut.at[1],
          radius: cut.radius,
          strain: 0,
          rate: 0,
        });
      engine.frame(performance.now(), next - i);
      if (i % 64 === 0) await sim.finish();
      i = next;
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
    if (env.VITE_GROUND === '1' && flow.length > 0) {
      const d = Float32Array.from({ length: flow.length / 4 }, (_, i) => flow[i * 4] ?? 0);
      await commands.writeFile(`${OUT}${NAME}-ground-${String(target)}.f32.b64`, b64(new Uint8Array(d.buffer)));
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
        recover: RULE.recover,
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
