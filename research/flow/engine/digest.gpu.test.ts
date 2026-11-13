// SHA-256 digests of the state of every scene after some steps, to compare two checkouts: with the flow off, a branch
// gives the bytes of `main` (ADR 0029, "With the flow off"). Runs in the real engine on both backends. Not a test of
// the app: it runs only when asked, with the configuration research/vitest.config.ts (README.md has the commands). It
// writes one line per scene and backend to research/flow/out/engine/<name>.jsonl. Environment variables: VITE_KINDS
// (list), VITE_STEPS, VITE_NAME, VITE_ONLY (scene ids; 'default' is the default settings without a scene), VITE_PATCH
// (settings as JSON).
import { it } from 'vitest';
import { commands } from 'vitest/browser';
import { Engine } from '../../../src/engine/engine';
import { WebGl2Backend } from '../../../src/engine/gl/backend';
import type { Backend } from '../../../src/engine/types';
import { WebGpuBackend } from '../../../src/engine/webgpu';
import { constrain, defaultSettings, type Settings } from '../../../src/model/params';
import { PRESETS } from '../../../src/model/presets';

const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;
const KINDS = (env.VITE_KINDS ?? 'webgpu,webgl2').split(',');
const STEPS = Number(env.VITE_STEPS ?? 500);
const NAME = env.VITE_NAME ?? 'digest';
const ONLY = (env.VITE_ONLY ?? '').split(',').filter(Boolean);
const PATCH = JSON.parse(env.VITE_PATCH ?? '{}') as Partial<Settings>;

async function sha(parts: ArrayBufferView[]): Promise<string> {
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const all = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    all.set(new Uint8Array(p.buffer, p.byteOffset, p.byteLength), at);
    at += p.byteLength;
  }
  const hash = await crypto.subtle.digest('SHA-256', all);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

it('writes the digests of every scene', async () => {
  const scenes = [
    { id: 'default', settings: () => defaultSettings(), env: [] },
    ...PRESETS.map((p) => ({ id: p.id, settings: p.settings, env: p.env ?? [] })),
  ].filter((s) => ONLY.length === 0 || ONLY.includes(s.id));
  const rows: string[] = [];
  for (const kind of KINDS)
    for (const scene of scenes) {
      const canvas = document.createElement('canvas');
      canvas.width = 1280;
      canvas.height = 800;
      const backend: Backend = kind === 'webgpu' ? await WebGpuBackend.create(canvas) : WebGl2Backend.create(canvas);
      const settings = constrain({ ...scene.settings(), seed: 12345, ...PATCH });
      const engine = await Engine.create(canvas, settings, undefined, backend);
      await engine.load(settings, scene.env);
      const sim = engine.sim;
      for (let i = 0; i < STEPS; i += 50) {
        sim.run(Math.min(50, STEPS - i));
        await sim.finish();
      }
      const agents = await sim.readAgents();
      const flat = new Float32Array(agents.length * 4);
      agents.forEach((a, i) => {
        flat.set([a.x, a.y, a.heading, a.bits], i * 4);
      });
      const [trail, scent, envBytes] = [await sim.readTrail(), await sim.readScent(), await sim.readEnv()];
      rows.push(
        JSON.stringify({
          kind,
          id: scene.id,
          w: sim.width,
          h: sim.height,
          agents: sim.agents,
          step: sim.step,
          alive: (await sim.alive()).reduce((a, b) => a + b, 0),
          agentsSha: await sha([flat]),
          trailSha: await sha([trail]),
          scentSha: await sha([scent]),
          envSha: await sha([envBytes]),
        }),
      );
      engine.destroy();
      backend.destroy();
    }
  await commands.writeFile(`research/flow/out/engine/${NAME}.jsonl`, rows.join('\n') + '\n');
}, 3_600_000);
