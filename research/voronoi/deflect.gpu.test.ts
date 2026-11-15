// A path that repellents deflect, as Fig. 8 of Jones and Adamatzky 2015 (ADR 0048, README.md), in the real engine.
// Not a test of the app and not a scene of the app: it runs only when asked, with research/vitest.config.ts.
//
// The model of the scene Voronoi diagram on the figure's lattice of 200 × 200 cells, with two foods where the figure
// has its attractants. The agents start at random and draw one path between the foods. Then the run paints the three
// repellents of the figure, one after the other, takes them away again, and writes one line per stage to
// research/voronoi/out/<label>.jsonl: the cells that hold an agent. tables.ts reads the path from them.
// Environment variables:
//
// - VITE_VO_KIND: webgpu or webgl2. VITE_VO_LABEL: the name of the file. VITE_VO_SEEDS (1,2,3,4,5).
// - VITE_VO_LIGHT: the repellent strengths (0.05,0.2,0.5). VITE_VO_FOOD: the food strength (0.2).
// - VITE_VO_FORM: the steps for the path to form (6000); the run goes on in parts of 2,000 steps, up to 40,000,
//   while the network still holds a loop. VITE_VO_STAGE: the steps of each stage (3000).
// - VITE_VO_PATCH: settings as JSON.
import { it } from 'vitest';
import { commands } from 'vitest/browser';
import { Engine } from '../../src/engine/engine';
import { WebGl2Backend } from '../../src/engine/gl/backend';
import type { Backend } from '../../src/engine/types';
import { WebGpuBackend } from '../../src/engine/webgpu';
import { constrain, type Settings } from '../../src/model/params';
import { presetById, type EnvShape } from '../../src/model/presets';
import { maskText } from '../coarsening/measure';
import { crossing, DEFLECT, occupancy } from './measure';

const OUT = 'research/voronoi/out/';
const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;
const numbers = (text: string | undefined, fallback: string) =>
  (text ?? fallback).split(',').filter(Boolean).map(Number);
const KIND = env.VITE_VO_KIND ?? 'webgpu';
const LABEL = env.VITE_VO_LABEL ?? `deflect-${KIND}`;
const SEEDS = numbers(env.VITE_VO_SEEDS, '1,2,3,4,5');
const LIGHTS = numbers(env.VITE_VO_LIGHT, '0.05,0.2,0.5');
const FOOD = Number(env.VITE_VO_FOOD ?? 0.2);
const FORM = Number(env.VITE_VO_FORM ?? 6000);
const STAGE = Number(env.VITE_VO_STAGE ?? 3000);
const PATCH = JSON.parse(env.VITE_VO_PATCH ?? '{}') as Partial<Settings>;

it('deflects a path with repellents, as Fig. 8 of Jones and Adamatzky 2015', async () => {
  const backend: Backend =
    KIND === 'webgpu'
      ? await WebGpuBackend.create(document.createElement('canvas'))
      : WebGl2Backend.create(document.createElement('canvas'));
  // One backend for all runs: an engine destroys its backend, this one is lent.
  const lent = new Proxy(backend, {
    get(target, key) {
      if (key === 'destroy') return () => undefined;
      return Reflect.get(target, key, target) as unknown;
    },
  });
  const preset = presetById('voronoi');
  if (!preset) throw new Error('no scene voronoi');
  const { side, foods, foodRadius, repellents, repellentRadius } = DEFLECT;
  const shapes: EnvShape[] = foods.map(([x, y]) => ({ kind: 'food', at: [x / side, y / side], r: foodRadius / side }));
  const lines: string[] = [];
  for (const light of LIGHTS)
    for (const seed of SEEDS) {
      const s = constrain({
        ...preset.settings(),
        lattice: [side, side],
        density: DEFLECT.density,
        foodStrength: FOOD,
        lightStrength: light,
        seed,
        ...PATCH,
      });
      const canvas = document.createElement('canvas');
      [canvas.width, canvas.height] = [1280, 800];
      const engine = await Engine.create(canvas, s, undefined, lent);
      await engine.load(s, shapes);
      const sim = engine.sim;
      const { width: w, height: h } = sim;
      let formed = 0;
      const sample = async (stage: string) => {
        if (stage === '0') formed = sim.step;
        const agents = await sim.readAgents();
        const bytes = await sim.readEnv();
        let lightSum = 0;
        for (let c = 0; c < w * h; c++) lightSum += bytes[c * 4 + 2] ?? 0;
        lines.push(
          JSON.stringify({
            kind: KIND,
            scene: 'deflect',
            w,
            h,
            food: s.foodStrength,
            light,
            lightSum,
            seed,
            stage,
            formed,
            step: sim.step,
            alive: (await sim.alive())[0] ?? 0,
            cells: maskText(occupancy(agents, w, h, (bits) => (bits & 4) !== 0)),
          }),
        );
      };
      // One path: the network crosses each of five bands of columns in a span of at most 10 cells.
      const onePath = async () => {
        const mask = occupancy(await sim.readAgents(), w, h, (bits) => (bits & 4) !== 0);
        return [-60, -30, 0, 30, 60].every((x) => crossing(mask, w, h, x - 5, x + 5, 0).span <= 10);
      };
      sim.run(FORM);
      while (sim.step < 40000 && !(await onePath())) sim.run(2000);
      await sample('0');
      for (const [i, [x, y]] of repellents.entries()) {
        const at: [number, number] = [w / 2 + x, h / 2 + y];
        sim.paint([{ kind: 'light', from: at, to: at, radius: repellentRadius }]);
        sim.run(STAGE);
        await sample(String(i + 1));
      }
      for (const [x, y] of repellents) {
        const at: [number, number] = [w / 2 + x, h / 2 + y];
        sim.paint([{ kind: 'erase', from: at, to: at, radius: repellentRadius + 2 }]);
      }
      // The path comes back slowly: one sample after a stage, one after four.
      sim.run(STAGE);
      await sample('away');
      sim.run(3 * STAGE);
      await sample('away later');
      console.log(`DEFLECT ${KIND} light=${String(light)} seed=${String(seed)} steps=${String(sim.step)}`);
      await commands.writeFile(`${OUT}${LABEL}.jsonl`, lines.join('\n') + '\n');
      engine.destroy();
    }
  backend.destroy();
}, 14_400_000);
