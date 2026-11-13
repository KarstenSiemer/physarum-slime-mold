// The time of a step with and without the flow in the tubes, in the real engine (ADR 0029, table (c)). Not a test of
// the app: it runs only when asked, with the configuration research/vitest.config.ts (README.md has the command). It
// writes one line per scene, backend and flow setting to research/flow/out/engine/<name>.jsonl. Environment
// variables: VITE_KINDS, VITE_SCENES (lists), VITE_WARM (steps before the measurement), VITE_BATCH (steps per
// sample), VITE_BATCHES, VITE_NAME, VITE_STRAINS (the scene with this many strains like its first one: every strain
// has a flow of its own, ADR 0030).
import { it } from 'vitest';
import { commands } from 'vitest/browser';
import { Engine } from '../../../src/engine/engine';
import { WebGl2Backend } from '../../../src/engine/gl/backend';
import type { Backend } from '../../../src/engine/types';
import { WebGpuBackend } from '../../../src/engine/webgpu';
import { constrain, strainLike } from '../../../src/model/params';
import { presetById } from '../../../src/model/presets';

const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;
const KINDS = (env.VITE_KINDS ?? 'webgpu,webgl2').split(',');
const SCENES = (env.VITE_SCENES ?? 'maze,tokyo').split(',');
const WARM = Number(env.VITE_WARM ?? 3000);
const BATCH = Number(env.VITE_BATCH ?? 50);
const BATCHES = Number(env.VITE_BATCHES ?? 21);
const NAME = env.VITE_NAME ?? 'bench';
const STRAINS = Number(env.VITE_STRAINS ?? 0);

it('measures the time of a step', async () => {
  const rows: string[] = [];
  for (const kind of KINDS)
    for (const scene of SCENES)
      for (const flow of [false, true]) {
        const canvas = document.createElement('canvas');
        canvas.width = 1280;
        canvas.height = 800;
        const backend: Backend = kind === 'webgpu' ? await WebGpuBackend.create(canvas) : WebGl2Backend.create(canvas);
        const preset = presetById(scene);
        if (!preset) throw new Error(`no scene ${scene}`);
        const base = preset.settings();
        const [first] = base.strains;
        // With VITE_STRAINS, strains like the first one share the agents of the scene.
        const strains =
          STRAINS > 0 && first
            ? Array.from({ length: STRAINS }, (_, i) => (i === 0 ? first : strainLike(first, i)))
            : base.strains;
        const settings = constrain({ ...base, seed: 1, flow, strains });
        const engine = await Engine.create(canvas, settings, undefined, backend);
        await engine.load(settings, preset.env ?? []);
        const sim = engine.sim;
        for (let i = 0; i < WARM; i += 50) {
          sim.run(50);
          await sim.finish();
        }
        const times: number[] = [];
        for (let b = 0; b < BATCHES; b++) {
          const t0 = performance.now();
          sim.run(BATCH);
          await sim.finish();
          times.push((performance.now() - t0) / BATCH);
        }
        times.sort((a, b) => a - b);
        const alive = (await sim.alive()).reduce((a, b) => a + b, 0);
        rows.push(
          JSON.stringify({
            kind,
            scene,
            flow,
            ...(STRAINS > 0 ? { strains: settings.strains.length } : {}),
            w: sim.width,
            h: sim.height,
            agents: sim.agents,
            alive,
            step: sim.step,
            median: +(times[Math.floor(times.length / 2)] ?? 0).toFixed(3),
            min: +(times[0] ?? 0).toFixed(3),
            max: +(times[times.length - 1] ?? 0).toFixed(3),
          }),
        );
        engine.destroy();
        backend.destroy();
      }
  await commands.writeFile(`research/flow/out/engine/${NAME}.jsonl`, rows.join('\n') + '\n');
}, 3_600_000);
