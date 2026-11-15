// The time of a step with the agent pass of another commit (the base) against the agent pass of this checkout, in one
// page and batch by batch, so that other work on the GPU slows both alike (ADR 0038, decision 8). Not a test of the
// app: it runs only when asked, with the configuration research/vitest.config.ts. Three engines run each scene: the
// base, this checkout, and this checkout after a wall stroke on one wall cell of the scene, which changes no byte but
// sets the flag of a wall over agents. They take turns for every batch, in an order that rotates. At the end the three
// must hold the same agents, bit for bit.
//
// The base is two files that this test reads from research/flow/out/engine/base/: agents.wgsl and tools.glsl, for
// example `git show 3f579ff:src/engine/shaders/agents.wgsl > research/flow/out/engine/base/agents.wgsl` and the same
// for src/engine/gl/glsl/tools.glsl. Only these two files hold the agent pass that differs; the base must not need
// another file of its commit. Environment variables: VITE_KINDS, VITE_SCENES (lists), VITE_WARM (steps before the
// measurement), VITE_BATCH (steps per sample), VITE_ROUNDS (samples per engine), VITE_NAME. The flow is off. It
// writes one line per scene and backend to research/flow/out/engine/<name>.jsonl.
import { it } from 'vitest';
import { commands } from 'vitest/browser';
import baseWgsl from '../out/engine/base/agents.wgsl?raw';
import baseTools from '../out/engine/base/tools.glsl?raw';
import { Engine } from '../../../src/engine/engine';
import { WebGl2Backend } from '../../../src/engine/gl/backend';
import { bindBlock, program, type GL } from '../../../src/engine/gl/gl';
import agentsFrag from '../../../src/engine/gl/glsl/agents.frag?raw';
import common from '../../../src/engine/gl/glsl/common.glsl?raw';
import fullscreen from '../../../src/engine/gl/glsl/fullscreen.vert?raw';
import pointsFrag from '../../../src/engine/gl/glsl/points.frag?raw';
import pointsVert from '../../../src/engine/gl/glsl/points.vert?raw';
import {
  FLOW_BINDING,
  PARAMS_BINDING,
  VIEW_BINDING,
  type Program,
  type Programs,
} from '../../../src/engine/gl/programs';
import { Simulation } from '../../../src/engine/sim';
import type { Backend, Sim } from '../../../src/engine/types';
import { WebGpuBackend } from '../../../src/engine/webgpu';
import { constrain } from '../../../src/model/params';
import { presetById } from '../../../src/model/presets';

const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;
const KINDS = (env.VITE_KINDS ?? 'webgpu,webgl2').split(',');
const SCENES = (env.VITE_SCENES ?? 'maze,foraging-maze').split(',');
const WARM = Number(env.VITE_WARM ?? 3000);
const BATCH = Number(env.VITE_BATCH ?? 50);
const ROUNDS = Number(env.VITE_ROUNDS ?? 31);
const NAME = env.VITE_NAME ?? 'base-agents';
const V = '#version 300 es\n';

/** A WebGL2 program as programs.ts wraps it: the uniform blocks bound, the uniform locations cached. */
function wrapped(gl: GL, vertex: string, fragment: string): Program {
  const p = program(gl, vertex, fragment);
  bindBlock(gl, p, 'Params', PARAMS_BINDING);
  bindBlock(gl, p, 'View', VIEW_BINDING);
  bindBlock(gl, p, 'Flow', FLOW_BINDING);
  const cache = new Map<string, WebGLUniformLocation | null>();
  return {
    program: p,
    loc: (name) => {
      if (!cache.has(name)) cache.set(name, gl.getUniformLocation(p, name));
      return cache.get(name) ?? null;
    },
  };
}

/** The programs of `prog` with the base's tools.glsl in every program that holds it, for the flow off and K = 0. */
function basePrograms(gl: GL, prog: Programs): Programs {
  const agents = (walls: boolean) =>
    wrapped(
      gl,
      V + common + fullscreen,
      V + common + (walls ? '#define SENSE_WALLS 1\n' : '') + baseTools + agentsFrag,
    );
  const plain = agents(false);
  const walled = { agents: agents(true), walls: prog.walled().walls };
  const none = (): never => {
    throw new Error('this measurement holds no base for that program');
  };
  return {
    ...prog,
    agents: plain,
    walled: () => walled,
    saturated: none,
    flowing: none,
    points: wrapped(gl, V + common + baseTools + pointsVert, V + common + pointsFrag),
  };
}

async function backendOf(kind: string, canvas: HTMLCanvasElement, base: boolean): Promise<Backend> {
  if (kind === 'webgpu') {
    const b = await WebGpuBackend.create(canvas);
    if (base) {
      const device = b.gpu.device;
      b.createSim = (s, w, h, n, start) => Simulation.create(device, s, w, h, n, baseWgsl, undefined, start);
    }
    return b;
  }
  const b = WebGl2Backend.create(canvas);
  if (base) {
    const holder = b as unknown as { prog: Programs; gl: GL };
    holder.prog = basePrograms(holder.gl, holder.prog);
  }
  return b;
}

const median = (t: number[]) => [...t].sort((a, b) => a - b)[Math.floor(t.length / 2)] ?? 0;

async function bytes(sim: Sim): Promise<string> {
  const agents = await sim.readAgents();
  return agents.map((a) => `${a.x},${a.y},${a.heading},${a.bits}`).join(';');
}

it('measures the agent pass of the base against this checkout', async () => {
  const rows: string[] = [];
  for (const kind of KINDS)
    for (const scene of SCENES) {
      const preset = presetById(scene);
      if (!preset) throw new Error(`no scene ${scene}`);
      const settings = constrain({ ...preset.settings(), seed: 1, flow: false });
      const roles = ['base', 'branch', 'wall'] as const;
      const runs: { engine: Engine; backend: Backend; times: number[] }[] = [];
      for (const role of roles) {
        const canvas = document.createElement('canvas');
        canvas.width = 1280;
        canvas.height = 800;
        const backend = await backendOf(kind, canvas, role === 'base');
        const engine = await Engine.create(canvas, settings, undefined, backend);
        await engine.load(settings, preset.env ?? []);
        if (role === 'wall') {
          // A wall stroke on the first wall cell of the scene, no wider than that cell: the bytes stay as they are.
          const sim = engine.sim;
          const before = await sim.readEnv();
          const c = before.findIndex((v, i) => i % 4 === 0 && v >= 128) / 4;
          if (c < 0) throw new Error(`no wall in ${scene}`);
          const at: [number, number] = [(c % sim.width) + 0.5, Math.floor(c / sim.width) + 0.5];
          sim.paint([{ kind: 'wall', from: at, to: at, radius: 0.75 }]);
          const after = await sim.readEnv();
          if (after.some((v, i) => v !== before[i])) throw new Error(`the wall stroke changed the bytes of ${scene}`);
        }
        runs.push({ engine, backend, times: [] });
      }
      for (let i = 0; i < WARM; i += 50)
        for (const r of runs) {
          r.engine.sim.run(50);
          await r.engine.sim.finish();
        }
      for (let round = 0; round < ROUNDS; round++)
        for (let k = 0; k < runs.length; k++) {
          const r = runs[(round + k) % runs.length];
          if (!r) continue;
          const t0 = performance.now();
          r.engine.sim.run(BATCH);
          await r.engine.sim.finish();
          r.times.push((performance.now() - t0) / BATCH);
        }
      const [a, b, c] = await Promise.all(runs.map((r) => bytes(r.engine.sim)));
      const alive = (await runs[1]?.engine.sim.alive())?.reduce((x, y) => x + y, 0);
      rows.push(
        JSON.stringify({
          kind,
          scene,
          step: runs[1]?.engine.sim.step,
          alive,
          same: a === b && b === c,
          ...Object.fromEntries(roles.map((role, i) => [role, +median(runs[i]?.times ?? []).toFixed(4)])),
          min: Object.fromEntries(roles.map((role, i) => [role, +Math.min(...(runs[i]?.times ?? [])).toFixed(4)])),
          // The batches of one round run one after the other: their ratio to the base's batch of the same round,
          // as a median over the rounds, stands less on how busy the GPU was than the medians do.
          ratio: Object.fromEntries(
            roles.slice(1).map((role, i) => {
              const own = runs[i + 1]?.times ?? [];
              const base = runs[0]?.times ?? [];
              return [role, +median(own.map((t, k) => t / (base[k] ?? NaN))).toFixed(4)];
            }),
          ),
        }),
      );
      for (const r of runs) {
        r.engine.destroy();
        r.backend.destroy();
      }
    }
  await commands.writeFile(`research/flow/out/engine/${NAME}.jsonl`, rows.join('\n') + '\n');
}, 3_600_000);
