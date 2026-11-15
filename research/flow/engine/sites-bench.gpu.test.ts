// The time of the pass of the ports (ADR 0029, decision 17; flow.wgsl `sites`, flow.frag PASS 2) for a large food
// stroke, in the real simulation on both backends. Not a test of the app: it runs only when asked, with the
// configuration research/vitest.config.ts (README.md has the command). A pass finds the port of a site as the first
// covered cell of its list, so a site that no tube covers costs a look at every one of its cells in every step. The
// case: the default grid of 1,536 × 960 cells, one strain, a tube between two small dabs, and a dab of `cells` cells
// far from the tube, covered nowhere or at its centre. It writes one line per backend and case to
// research/flow/out/engine/<name>.jsonl. Environment variables: VITE_KINDS, VITE_NAME, VITE_BATCHES.
import { it } from 'vitest';
import { commands } from 'vitest/browser';
import { WebGl2Backend } from '../../../src/engine/gl/backend';
import { flowSites, type FoodStroke } from '../../../src/engine/sites';
import type { Backend } from '../../../src/engine/types';
import { WebGpuBackend } from '../../../src/engine/webgpu';
import { defaultSettings, defaultStrain, type Settings } from '../../../src/model/params';

const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;
const KINDS = (env.VITE_KINDS ?? 'webgpu,webgl2').split(',');
const NAME = env.VITE_NAME ?? 'sites-bench';
const BATCHES = Number(env.VITE_BATCHES ?? 15);
const BATCH = 20;

it('measures the pass of the ports for a large stroke', async () => {
  const [w, h] = [1536, 960];
  const settings: Settings = {
    ...defaultSettings(),
    model: 'extended',
    flow: true,
    boundary: 'box',
    layout: 'empty',
    collisions: false,
    diffusion: 0,
    flowStrength: 2,
    strains: [{ ...defaultStrain(0), decay: 0.0001, deposit: 0 }],
  };
  const rows: string[] = [];
  for (const kind of KINDS) {
    const canvas = document.createElement('canvas');
    const backend: Backend = kind === 'webgpu' ? await WebGpuBackend.create(canvas) : WebGl2Backend.create(canvas);
    // Radius 0 is no large stroke; the others give about 10,000, 100,000 and 250,000 cells.
    for (const radius of [0, 56.5, 178.5, 282])
      for (const covered of radius > 0 ? [false, true] : [false]) {
        const sim = await backend.createSim(settings, w, h, 1);
        const dab = (x: number, y: number, r: number): FoodStroke => [
          { kind: 'food', from: [x, y], to: [x, y], radius: r },
        ];
        const strokes = [
          dab(100.5, 100.5, 3),
          dab(700.5, 100.5, 3),
          ...(radius > 0 ? [dab(1000.5, 600.5, radius)] : []),
        ];
        sim.paint(strokes.flat());
        const sites = flowSites(strokes, w, h, 'box');
        sim.foodSites(sites);
        sim.reset();
        // A tube between the two small dabs, and one cell of tube at the centre of the large one.
        const trail = new Float32Array(w * h * 4);
        for (let x = 100; x <= 700; x++) trail[(100 * w + x) * 4] = 10;
        if (covered) trail[(600 * w + 1000) * 4] = 10;
        sim.writeTrail(trail);
        sim.run(200);
        await sim.finish();
        const times: number[] = [];
        for (let b = 0; b < BATCHES; b++) {
          const t0 = performance.now();
          sim.run(BATCH);
          await sim.finish();
          times.push((performance.now() - t0) / BATCH);
        }
        times.sort((a, b) => a - b);
        const roles = (await sim.readFlow()).filter((v, i) => i % 4 === 3 && v !== 0).length;
        rows.push(
          JSON.stringify({
            kind,
            cells: sites.list[2]?.count ?? 0,
            covered,
            roles,
            median: +(times[Math.floor(times.length / 2)] ?? 0).toFixed(3),
            min: +(times[0] ?? 0).toFixed(3),
            max: +(times[times.length - 1] ?? 0).toFixed(3),
          }),
        );
        sim.destroy();
      }
    backend.destroy();
  }
  await commands.writeFile(`research/flow/out/engine/${NAME}.jsonl`, rows.join('\n') + '\n');
}, 3_600_000);
