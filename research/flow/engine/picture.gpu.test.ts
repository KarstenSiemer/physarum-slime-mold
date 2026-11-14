// The time of a frame with and without the picture of the tubes, in the real engine (ADR 0034). Not a test of the
// app: it runs only when asked, with the configuration research/vitest.config.ts (README.md has the command). A
// frame here is one step and one drawn picture, so the difference of the two times is the cost of the picture: its two
// passes, once for each drawn state. It writes one line per scene, backend and setting of the switch to
// research/flow/out/engine/<name>.jsonl. Environment variables: VITE_KINDS, VITE_SCENES (lists), VITE_WARM (steps
// before the measurement), VITE_BATCH (frames per sample), VITE_BATCHES, VITE_NAME, VITE_STRAINS (the scene with this
// many strains like its first one), VITE_PATCH (settings as JSON, on top of the scene's).
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
const SCENES = (env.VITE_SCENES ?? 'maze,tokyo,food-ring,rival-networks,tokyo-rivals').split(',');
const WARM = Number(env.VITE_WARM ?? 3000);
const BATCH = Number(env.VITE_BATCH ?? 50);
const BATCHES = Number(env.VITE_BATCHES ?? 21);
const NAME = env.VITE_NAME ?? 'picture';
const STRAINS = Number(env.VITE_STRAINS ?? 0);
const PATCH = JSON.parse(env.VITE_PATCH ?? '{}') as Record<string, unknown>;

it('measures the time of a frame with and without the picture of the tubes', async () => {
  const rows: string[] = [];
  for (const kind of KINDS)
    for (const scene of SCENES) {
      const canvas = document.createElement('canvas');
      canvas.width = 1280;
      canvas.height = 800;
      const backend: Backend = kind === 'webgpu' ? await WebGpuBackend.create(canvas) : WebGl2Backend.create(canvas);
      const preset = presetById(scene);
      if (!preset) throw new Error(`no scene ${scene}`);
      const base = preset.settings();
      const [first] = base.strains;
      const strains =
        STRAINS > 0 && first
          ? Array.from({ length: STRAINS }, (_, i) => (i === 0 ? first : strainLike(first, i)))
          : base.strains;
      const settings = constrain({ ...base, seed: 1, flow: true, ...PATCH, strains });
      const engine = await Engine.create(canvas, settings, undefined, backend);
      await engine.load(settings, preset.env ?? []);
      const sim = engine.sim;
      for (let i = 0; i < WARM; i += 50) {
        sim.run(50);
        await sim.finish();
      }
      // Both settings on the same run, in turns, so that the state of the scene is the same for both.
      const times: Record<string, number[]> = { off: [], on: [] };
      for (let b = 0; b < BATCHES; b++)
        for (const showTubes of [false, true]) {
          await engine.apply({ ...engine.settings, showTubes });
          // The first frames after the switch build what the setting needs: not in the sample.
          for (let i = 0; i < 3; i++) engine.frame(performance.now(), 1);
          await sim.finish();
          const t0 = performance.now();
          for (let i = 0; i < BATCH; i++) {
            engine.frame(performance.now(), 1);
            await sim.finish();
          }
          times[showTubes ? 'on' : 'off']?.push((performance.now() - t0) / BATCH);
        }
      for (const [tubes, list] of Object.entries(times)) {
        list.sort((a, b) => a - b);
        rows.push(
          JSON.stringify({
            kind,
            scene,
            tubes,
            strains: settings.strains.length,
            w: sim.width,
            h: sim.height,
            step: sim.step,
            median: +(list[Math.floor(list.length / 2)] ?? 0).toFixed(3),
            min: +(list[0] ?? 0).toFixed(3),
            max: +(list[list.length - 1] ?? 0).toFixed(3),
          }),
        );
      }
      engine.destroy();
      backend.destroy();
    }
  await commands.writeFile(`research/flow/out/engine/${NAME}.jsonl`, rows.join('\n') + '\n');
}, 3_600_000);
