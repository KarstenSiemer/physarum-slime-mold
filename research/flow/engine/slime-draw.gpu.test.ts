// The time of a draw with and without the film of the slime, in the real engine (ADR 0055, decision 8; ADR 0057). Not
// a test of the app: it runs only when asked, with the configuration research/vitest.config.ts (README.md has the
// command). A sample is a batch of draws of one state, without a step. Three cases run in turns on the same state
// (off, on, fill, off, on, fill), so a load of the machine falls on all alike:
//   off   Show slime is off
//   on    the film, with its maps filled before the sample: the cost of the film in the render pass
//   fill  the film, with a life time that is another one in every draw, so that every draw fills the maps again: the
//         cost of a frame after a step
// It writes one line per scene, backend, style, view and case to research/flow/out/engine/<name>.jsonl. Environment
// variables: VITE_KINDS, VITE_SCENES, VITE_STYLES (lists), VITE_ZOOMS (the cells per pixel of each view, as a factor
// of the view that fits the grid to the canvas), VITE_WARM (steps before the measurement), VITE_BATCH (draws per
// sample), VITE_BATCHES, VITE_NAME, VITE_PATCH (settings as JSON, on top of the scene's), VITE_SIZE (the pixels of
// the canvas, width and height).
import { it } from 'vitest';
import { commands } from 'vitest/browser';
import { Engine } from '../../../src/engine/engine';
import { WebGl2Backend } from '../../../src/engine/gl/backend';
import type { Backend, View } from '../../../src/engine/types';
import { WebGpuBackend } from '../../../src/engine/webgpu';
import { constrain, type Settings } from '../../../src/model/params';
import { presetById } from '../../../src/model/presets';

const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;
const KINDS = (env.VITE_KINDS ?? 'webgpu,webgl2').split(',');
const SCENES = (env.VITE_SCENES ?? 'snail-maze,three-strains').split(',');
const STYLES = (env.VITE_STYLES ?? 'glow,gel').split(',') as Settings['style'][];
const ZOOMS = (env.VITE_ZOOMS ?? '1,0.25,4,8').split(',').map(Number);
const WARM = Number(env.VITE_WARM ?? 3000);
const BATCH = Number(env.VITE_BATCH ?? 50);
const BATCHES = Number(env.VITE_BATCHES ?? 21);
const NAME = env.VITE_NAME ?? 'slime-draw';
const PATCH = JSON.parse(env.VITE_PATCH ?? '{}') as Record<string, unknown>;
const [WIDTH = 2560, HEIGHT = 1600] = (env.VITE_SIZE ?? '').split(',').filter(Boolean).map(Number);

it('measures the time of a draw with and without the film of the slime', async () => {
  const rows: string[] = [];
  for (const kind of KINDS)
    for (const scene of SCENES) {
      const canvas = document.createElement('canvas');
      canvas.width = WIDTH;
      canvas.height = HEIGHT;
      const backend: Backend = kind === 'webgpu' ? await WebGpuBackend.create(canvas) : WebGl2Backend.create(canvas);
      const preset = presetById(scene);
      if (!preset) throw new Error(`no scene ${scene}`);
      const settings = constrain({ ...preset.settings(), seed: 1, model: 'extended', ...PATCH });
      const engine = await Engine.create(canvas, settings, undefined, backend);
      await engine.load(settings, preset.env ?? []);
      const sim = engine.sim;
      for (let i = 0; i < WARM; i += 50) {
        sim.run(50);
        await sim.finish();
      }
      const stamps = (await sim.readSlime()).reduce((n, v) => n + (v === 0 ? 0 : 1), 0);
      engine.fitView();
      const fit = engine.view;
      for (const style of STYLES)
        for (const zoom of ZOOMS) {
          const view: View = { center: fit.center, scale: fit.scale * zoom };
          const of = (showSlime: boolean, more = 0): Settings => ({
            ...engine.settings,
            style,
            showSlime,
            slimeLife: engine.settings.slimeLife + more,
          });
          // The settings of each case for the draw i: the case `fill` takes two life times in turns, an hour apart.
          const cases: Record<string, (i: number) => Settings> = {
            off: () => of(false),
            on: () => of(true),
            fill: (i) => of(true, i % 2),
          };
          // The levels of the frames, and the pipelines or programs of both settings: not in a sample.
          await backend.settle(sim);
          for (const showSlime of [false, true]) await backend.capture(sim, of(showSlime), view, 16, 16);
          const times: Record<string, number[]> = { off: [], on: [], fill: [] };
          for (let b = 0; b < BATCHES; b++)
            for (const [name, settingsOf] of Object.entries(cases)) {
              for (let i = 0; i < 3; i++) backend.draw(sim, settingsOf(i), view, false);
              await sim.finish();
              const t0 = performance.now();
              for (let i = 0; i < BATCH; i++) {
                backend.draw(sim, settingsOf(i), view, false);
                await sim.finish();
              }
              times[name]?.push((performance.now() - t0) / BATCH);
            }
          for (const [slime, list] of Object.entries(times)) {
            list.sort((a, b) => a - b);
            rows.push(
              JSON.stringify({
                kind,
                scene,
                style,
                scale: +view.scale.toFixed(3),
                slime,
                w: sim.width,
                h: sim.height,
                step: sim.step,
                stamps,
                median: +(list[Math.floor(list.length / 2)] ?? 0).toFixed(3),
                min: +(list[0] ?? 0).toFixed(3),
                max: +(list[list.length - 1] ?? 0).toFixed(3),
              }),
            );
          }
        }
      engine.destroy();
      backend.destroy();
    }
  await commands.writeFile(`research/flow/out/engine/${NAME}.jsonl`, rows.join('\n') + '\n');
}, 3_600_000);
