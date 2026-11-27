// The diagnosis of part E2c of the engine of stage 4 (ADR 0072; E2c-NOTES.md), the check of the coordinator: do both
// backends grow the start scene alike, with and without the rules of stage 4? Prints the live agents of each strain
// after STEPS steps for each seed.
import { it } from 'vitest';
import { commands } from 'vitest/browser';
import { Engine } from '../../src/engine/engine';
import { WebGl2Backend } from '../../src/engine/gl/backend';
import type { Backend } from '../../src/engine/types';
import { WebGpuBackend } from '../../src/engine/webgpu';
import { presetById, START } from '../../src/model/presets';

const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;
const KINDS = (env.VITE_KINDS ?? 'webgpu,webgl2').split(',');
const SEEDS = (env.VITE_SEEDS ?? '1,2,3,4,5,6').split(',').map(Number);
const STEPS = Number(env.VITE_STEPS ?? 1500);
const RULES = (env.VITE_RULES ?? 'true,false').split(',').map((v) => v === 'true');
const EXTRA = JSON.parse(env.VITE_EXTRA ?? '{}') as Record<string, unknown>;
const OUT = env.VITE_OUT ?? 'backends';
// 'dish160': one strain in a dish of 160 × 160 cells with one food in the middle, as the dish of the prototype.
const SCENE = env.VITE_SCENE ?? 'start';

it('grows the start scene alike on both backends', { timeout: 3_600_000 }, async () => {
  const rows: string[] = [];
  const preset = presetById(START);
  if (!preset) throw new Error(`no scene ${START}`);
  for (const territory of RULES)
    for (const kind of KINDS)
      for (const seed of SEEDS) {
        const canvas = document.createElement('canvas');
        canvas.width = 1280;
        canvas.height = 800;
        const backend: Backend = kind === 'webgpu' ? await WebGpuBackend.create(canvas) : WebGl2Backend.create(canvas);
        const base = preset.settings();
        const dish = SCENE === 'dish160';
        const settings = {
          ...base,
          ...(dish ? { strains: base.strains.slice(0, 1), lattice: [160, 160] as [number, number] } : {}),
          seed,
          territory,
          ...EXTRA,
        };
        const engine = await Engine.create(canvas, settings, undefined, backend);
        await engine.load(settings, dish ? [{ kind: 'food', at: [0, 0], r: 5 / 160 }] : (preset.env ?? []));
        const sim = engine.sim;
        const marks: string[] = [];
        for (let i = 0; i < STEPS; i += 50) {
          sim.run(50);
          await sim.finish();
          if ((i + 50) % 500 === 0) marks.push(String((await sim.alive()).reduce((p, q) => p + q, 0)));
        }
        const alive = await sim.alive();
        rows.push(
          `CHECK rules=${String(territory)} ${kind} seed=${String(seed)} step=${String(sim.step)} alive=${alive.join('/')} sum=${String(alive.reduce((p, q) => p + q, 0))} at500s=${marks.join(',')}`,
        );
        engine.destroy();
        await commands.writeFile(`research/front/out/${OUT}.txt`, rows.join('\n') + '\n');
      }
});
