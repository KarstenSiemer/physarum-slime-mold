// Part E2e of the engine of stage 4 (ADR 0075; E2e-NOTES.md), the measure of the coordinator: the start scene with the
// rules of stage 4 and the drift `take` on both backends, for the seeds of VITE_SEEDS, to step 1,503 as
// `e2c-backends.gpu.test.ts` runs it. Writes a row per run: the live agents of each strain at the end and every 500
// steps, and the least mean pressure of the four lanes of each strain over the cells in the first 30 steps
// (`e2c-islands.gpu.test.ts`). `e2e-summary.ts` reads the rows.
import { it } from 'vitest';
import { commands } from 'vitest/browser';
import { Engine } from '../../src/engine/engine';
import { WebGl2Backend } from '../../src/engine/gl/backend';
import type { Backend } from '../../src/engine/types';
import { WebGpuBackend } from '../../src/engine/webgpu';
import { presetById, START } from '../../src/model/presets';

const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;
const KINDS = (env.VITE_KINDS ?? 'webgpu,webgl2').split(',');
const SEEDS = (env.VITE_SEEDS ?? '1,2,3,4,5,6,7,8,9,10,11,12').split(',').map(Number);
const STEPS = Number(env.VITE_STEPS ?? 1500);
/** The first steps in which the least pressure is read. */
const FIRST = Number(env.VITE_FIRST ?? 30);
const EXTRA = JSON.parse(env.VITE_EXTRA ?? '{}') as Record<string, unknown>;
const OUT = env.VITE_OUT ?? 'e2e-backends';

it('grows the start scene with the drift take alike on both backends', { timeout: 7_200_000 }, async () => {
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
      const strains = engine.settings.strains.length;
      const least = new Array<number>(strains).fill(0);
      for (let k = 0; k < FIRST; k++) {
        sim.run(1);
        await sim.finish();
        for (let s = 0; s < strains; s++) {
          const p = await sim.readPressure(s);
          for (let c = 0; c < p.length / 4; c++) {
            const v = ((p[4 * c] ?? 0) + (p[4 * c + 1] ?? 0) + (p[4 * c + 2] ?? 0) + (p[4 * c + 3] ?? 0)) / 4;
            if (v < (least[s] ?? 0)) least[s] = v;
          }
        }
      }
      const marks: string[] = [];
      for (let done = FIRST; done < STEPS;) {
        // To the next multiple of 50, as e2c-backends.gpu.test.ts steps.
        const n = Math.min(50 - (done % 50), STEPS - done);
        sim.run(n);
        await sim.finish();
        done += n;
        if (done % 500 === 0) marks.push((await sim.alive()).join('/'));
      }
      const alive = await sim.alive();
      rows.push(
        `CHECK ${kind} seed=${String(seed)} step=${String(sim.step)} alive=${alive.join('/')} sum=${String(alive.reduce((p, q) => p + q, 0))} least=${least.map((v) => v.toFixed(0)).join('/')} at500s=${marks.join(',')}`,
      );
      engine.destroy();
      await commands.writeFile(`research/front/out/${OUT}.txt`, rows.join('\n') + '\n');
    }
});
