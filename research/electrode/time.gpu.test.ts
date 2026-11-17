// The time of a draw and of a stroke with electrodes, in the real engine (ADR 0058, open points). Not a test of the
// app: it runs only when asked, with the configuration research/vitest.config.ts (README.md has the commands).
// Nothing else may use the GPU while it runs. It uses only calls that the engine had before ADR 0058, so the same
// file measures a build of `main`: copy it there, and run the two builds in turns.
//
// Draws: a sample is a batch of draws of one state, without a step. Three states on a canvas of 2,560 × 1,600 pixels:
//  - `electrotaxis`: the scene Electrotaxis after 800 steps, with its ten small poles;
//  - `poles`: the default settings after 500 steps with a wide cathode, a wide anode and thin lines of both, so that
//    a large part of the pixels reads the outlines of the poles;
//  - `none`: the default settings after 500 steps without a pole. A frame without a pole reads no outline of a pole.
// Each in the glow and in the paper style, fitted to the canvas and zoomed in 8 times on a pole.
//
// Strokes: a sample is a number of calls of Sim.paint() with one stroke each, as a drag of the pointer paints them,
// on the grid of the default settings: a dab and a line of a pole; an erase and a wall in a simulation with poles,
// where they run the outline pass twice, and in one without; and the first pole of a new simulation, which builds
// the pass.
//
// It writes one line per case to research/electrode/out/<name>.jsonl. Environment variables: VITE_KINDS (a list),
// VITE_NAME, VITE_BATCH (draws per sample), VITE_BATCHES, VITE_CALLS (strokes per sample), VITE_SIZE (the pixels of
// the canvas, width and height), VITE_PARTS (`draw`, `stroke`, or both).
import { it } from 'vitest';
import { commands } from 'vitest/browser';
import { Engine } from '../../src/engine/engine';
import { WebGl2Backend } from '../../src/engine/gl/backend';
import type { Backend, Stroke, View } from '../../src/engine/types';
import { WebGpuBackend } from '../../src/engine/webgpu';
import { constrain, defaultSettings, type Settings } from '../../src/model/params';
import { presetById } from '../../src/model/presets';

const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;
const KINDS = (env.VITE_KINDS ?? 'webgpu,webgl2').split(',');
const NAME = env.VITE_NAME ?? 'time';
const BATCH = Number(env.VITE_BATCH ?? 50);
const BATCHES = Number(env.VITE_BATCHES ?? 21);
const CALLS = Number(env.VITE_CALLS ?? 32);
const PARTS = (env.VITE_PARTS ?? 'draw,stroke').split(',');
const [WIDTH = 2560, HEIGHT = 1600] = (env.VITE_SIZE ?? '').split(',').filter(Boolean).map(Number);

/** Strokes of both poles on a grid of `w` × `h` cells: two wide dabs and four thin lines. */
function poles(w: number, h: number): Stroke[] {
  const at = (x: number, y: number): [number, number] => [x * w, y * h];
  const r = Math.min(w, h);
  return [
    { kind: 'cathode', from: at(0.3, 0.5), to: at(0.3, 0.5), radius: 0.2 * r },
    { kind: 'anode', from: at(0.7, 0.5), to: at(0.7, 0.5), radius: 0.2 * r },
    { kind: 'cathode', from: at(0.1, 0.1), to: at(0.9, 0.15), radius: 1.5 },
    { kind: 'anode', from: at(0.1, 0.9), to: at(0.9, 0.85), radius: 1.5 },
    { kind: 'anode', from: at(0.2, 0.3), to: at(0.4, 0.7), radius: 3 },
    { kind: 'cathode', from: at(0.6, 0.3), to: at(0.8, 0.7), radius: 3 },
  ];
}

const median = (list: number[]) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)] ?? 0;
const stats = (list: number[]) => ({
  median: +median(list).toFixed(3),
  min: +Math.min(...list).toFixed(3),
  max: +Math.max(...list).toFixed(3),
});

it('measures the time of a draw and of a stroke with electrodes', async () => {
  const rows: string[] = [];
  const make = async (kind: string, settings: Settings) => {
    const canvas = document.createElement('canvas');
    [canvas.width, canvas.height] = [WIDTH, HEIGHT];
    const backend: Backend = kind === 'webgpu' ? await WebGpuBackend.create(canvas) : WebGl2Backend.create(canvas);
    const engine = await Engine.create(canvas, settings, undefined, backend);
    return { backend, engine };
  };
  for (const kind of KINDS) {
    if (PARTS.includes('draw'))
      for (const state of ['electrotaxis', 'poles', 'none'] as const) {
        const preset = state === 'electrotaxis' ? presetById('electrotaxis') : undefined;
        const settings = constrain({ ...(preset?.settings() ?? defaultSettings()), seed: 1 });
        const { backend, engine } = await make(kind, settings);
        await engine.load(settings, preset?.env ?? []);
        const sim = engine.sim;
        const painted = state === 'poles' ? poles(sim.width, sim.height) : [];
        if (painted.length > 0) sim.paint(painted);
        for (let i = 0; i < (preset ? 800 : 500); i += 50) {
          sim.run(50);
          await sim.finish();
        }
        engine.fitView();
        const fit = engine.view;
        // The middle of a pole: the first cathode of the scene, or the wide cathode.
        const pole: [number, number] = preset ? [25, 58] : [0.3 * sim.width, 0.5 * sim.height];
        const views: [string, View][] = [
          ['fitted', fit],
          ['zoomed in 8 times', { center: pole, scale: fit.scale / 8 }],
        ];
        for (const style of ['glow', 'paper'] as const)
          for (const [zoom, view] of views) {
            const s: Settings = { ...engine.settings, style };
            // The levels of the frames, and the pipelines or programs of the frame: not in a sample.
            await backend.settle(sim);
            await backend.capture(sim, s, view, 16, 16);
            const times: number[] = [];
            for (let b = 0; b < BATCHES; b++) {
              for (let i = 0; i < 3; i++) backend.draw(sim, s, view, false);
              await sim.finish();
              const t0 = performance.now();
              for (let i = 0; i < BATCH; i++) {
                backend.draw(sim, s, view, false);
                await sim.finish();
              }
              times.push((performance.now() - t0) / BATCH);
            }
            rows.push(
              JSON.stringify({ part: 'draw', kind, state, style, zoom, w: sim.width, h: sim.height, ...stats(times) }),
            );
          }
        engine.destroy();
      }
    if (PARTS.includes('stroke')) {
      const settings = constrain({ ...defaultSettings(), seed: 1 });
      /** The strokes of a sample: CALLS strokes like `stroke`, each a few cells beside the one before. */
      const drag = (stroke: Stroke): Stroke[] =>
        Array.from({ length: CALLS }, (_, i) => ({
          ...stroke,
          from: [stroke.from[0] + 3 * i, stroke.from[1] + i] as [number, number],
          to: [stroke.to[0] + 3 * i, stroke.to[1] + i] as [number, number],
        }));
      const cases: [name: string, withPoles: boolean, stroke: (w: number, h: number) => Stroke][] = [
        [
          'a dab of a pole of 1.5 cells',
          true,
          (w, h) => ({ kind: 'cathode', from: [0.2 * w, 0.2 * h], to: [0.2 * w, 0.2 * h], radius: 1.5 }),
        ],
        [
          'a line of a pole of 3 cells',
          true,
          (w, h) => ({ kind: 'anode', from: [0.2 * w, 0.3 * h], to: [0.2 * w + 40, 0.3 * h + 8], radius: 3 }),
        ],
        [
          'an erase of 3 cells beside poles',
          true,
          (w, h) => ({ kind: 'erase', from: [0.2 * w, 0.4 * h], to: [0.2 * w + 40, 0.4 * h + 8], radius: 3 }),
        ],
        [
          'a wall of 3 cells beside poles',
          true,
          (w, h) => ({ kind: 'wall', from: [0.2 * w, 0.6 * h], to: [0.2 * w + 40, 0.6 * h + 8], radius: 3 }),
        ],
        [
          'an erase of 3 cells without a pole',
          false,
          (w, h) => ({ kind: 'erase', from: [0.2 * w, 0.4 * h], to: [0.2 * w + 40, 0.4 * h + 8], radius: 3 }),
        ],
        [
          'a wall of 3 cells without a pole',
          false,
          (w, h) => ({ kind: 'wall', from: [0.2 * w, 0.6 * h], to: [0.2 * w + 40, 0.6 * h + 8], radius: 3 }),
        ],
      ];
      for (const [name, withPoles, stroke] of cases) {
        const { engine } = await make(kind, settings);
        const sim = engine.sim;
        // Food, so that an erase has an outline to take, and the passes of walls and food are built.
        sim.paint([
          {
            kind: 'food',
            from: [0.5 * sim.width, 0.5 * sim.height],
            to: [0.5 * sim.width, 0.5 * sim.height],
            radius: 0.3 * sim.height,
          },
        ]);
        if (withPoles) sim.paint(poles(sim.width, sim.height));
        const list = drag(stroke(sim.width, sim.height));
        // The passes of this kind of stroke are built before the first sample.
        for (const s of list) sim.paint([s]);
        await sim.finish();
        const times: number[] = [];
        for (let b = 0; b < BATCHES; b++) {
          const t0 = performance.now();
          for (const s of list) sim.paint([s]);
          await sim.finish();
          times.push((performance.now() - t0) / CALLS);
        }
        rows.push(JSON.stringify({ part: 'stroke', kind, case: name, w: sim.width, h: sim.height, ...stats(times) }));
        engine.destroy();
      }
      // The first pole of a simulation, with the build of its pass: one sample per new simulation.
      const first: number[] = [];
      for (let b = 0; b < 5; b++) {
        const { engine } = await make(kind, settings);
        const sim = engine.sim;
        sim.paint([{ kind: 'food', from: [100, 100], to: [100, 100], radius: 20 }]);
        await sim.finish();
        const t0 = performance.now();
        sim.paint([{ kind: 'cathode', from: [300, 300], to: [300, 300], radius: 3 }]);
        await sim.finish();
        first.push(performance.now() - t0);
        engine.destroy();
      }
      rows.push(JSON.stringify({ part: 'stroke', kind, case: 'the first pole of a new simulation', ...stats(first) }));
    }
  }
  await commands.writeFile(`research/electrode/out/${NAME}.jsonl`, rows.join('\n') + '\n');
}, 3_600_000);
