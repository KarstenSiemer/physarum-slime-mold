// How far the scent of one food reaches in the extended model (ADR 0036): the scent around a single dab once it no
// longer changes, for each scent decay and number of diffusion passes. No agent lives (the start layout Empty), so no
// trail and no agent changes the scent. Not a test of the app: it runs only when asked, with the configuration
// research/vitest.config.ts (research/scent/README.md has the command). It writes one line per setting to
// research/scent/logs/<name>.jsonl: the scent along the four axes from the centre of the dab, averaged, cell by cell.
//
// Environment variables: VITE_KIND (webgpu or webgl2), VITE_DECAYS and VITE_PASSES (lists), VITE_RADIUS (the radius
// of the dab in cells), VITE_SIDE (cells of the square lattice), VITE_LINE (1: a line of food from the top to the
// bottom of the lattice through its centre, in place of the dab; the line then holds the scent along x only),
// VITE_NAME.
import { it } from 'vitest';
import { commands } from 'vitest/browser';
import { Engine } from '../../src/engine/engine';
import { WebGl2Backend } from '../../src/engine/gl/backend';
import type { Backend } from '../../src/engine/types';
import { WebGpuBackend } from '../../src/engine/webgpu';
import { constrain, defaultSettings } from '../../src/model/params';

const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;
const KIND = env.VITE_KIND ?? 'webgpu';
const DECAYS = (env.VITE_DECAYS ?? '0.3,0.1,0.03,0.01,0.003,0.001,0.0003').split(',').map(Number);
const PASSES = (env.VITE_PASSES ?? '1,2,4').split(',').map(Number);
const RADIUS = Number(env.VITE_RADIUS ?? 3);
const SIDE = Number(env.VITE_SIDE ?? 512);
const LINE = env.VITE_LINE === '1';
const NAME = env.VITE_NAME ?? `profile-${KIND}`;
/** The cells along each axis that a line holds. */
const REACH = 240;

it('measures the scent of one food once it no longer changes', async () => {
  const canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 800;
  const rows: string[] = [];
  for (const passes of PASSES)
    for (const decay of DECAYS) {
      const backend: Backend = KIND === 'webgpu' ? await WebGpuBackend.create(canvas) : WebGl2Backend.create(canvas);
      const settings = constrain({
        ...defaultSettings(),
        model: 'extended',
        layout: 'empty',
        boundary: 'box',
        lattice: [SIDE, SIDE],
        diffusion: passes,
        scentDecay: decay,
        seed: 1,
      });
      const engine = await Engine.create(canvas, settings, undefined, backend);
      // A dab at the centre: the radius of a shape is in units of the short side of the grid.
      const r = RADIUS / SIDE;
      await engine.load(settings, [
        LINE ? { kind: 'food', at: [0, -0.45], to: [0, 0.45], r } : { kind: 'food', at: [0, 0], r },
      ]);
      const sim = engine.sim;
      // The scent comes within e^-12 of its end after 12 / decay steps; at most 40,000 steps.
      const steps = Math.min(40_000, Math.ceil(12 / decay));
      for (let done = 0; done < steps; done += 500) {
        sim.run(Math.min(500, steps - done));
        await sim.finish();
      }
      const scent = await sim.readScent();
      const [w, h] = [sim.width, sim.height];
      const at = (x: number, y: number) => scent[2 * (y * w + x)] ?? 0;
      const [cx, cy] = [Math.floor(w / 2), Math.floor(h / 2)];
      const line = Array.from({ length: REACH }, (_, r) => {
        const v = LINE
          ? [at(cx + r, cy), at(cx - 1 - r, cy)]
          : [at(cx + r, cy), at(cx - 1 - r, cy), at(cx, cy + r), at(cx, cy - 1 - r)];
        return v.reduce((a, b) => a + b, 0) / v.length;
      });
      const shape = LINE ? 'line' : 'dab';
      rows.push(JSON.stringify({ kind: KIND, shape, passes, decay, radius: RADIUS, w, h, steps: sim.step, line }));
      engine.destroy();
      backend.destroy();
    }
  await commands.writeFile(`research/scent/logs/${NAME}.jsonl`, rows.join('\n') + '\n');
}, 3_600_000);
