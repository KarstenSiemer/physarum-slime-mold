// The strains of a scene with the flow in the tubes, sample by sample (ADR 0031): how many agents of each strain
// live, how many cells hold a tube of the strain, how many of these cells the flow feeds or lets starve, how many
// food sites give or take in the flow of the strain, and the largest trail of the strain in deposits of the strain (a
// tube needs 0.2). Not a test of the app: it runs only when asked, with the
// configuration research/vitest.config.ts (README.md has the commands). It writes one line per sample to
// research/flow/out/engine/<name>.jsonl. Environment variables:
//
// - VITE_SCENE: the id of a scene. VITE_KIND: webgpu or webgl2. VITE_SEED: the seed.
// - VITE_STRAINS: the scene with this many strains like its first one (strainLike() in src/model/params.ts); 0: the
//   strains of the scene.
// - VITE_STEPS: the last step. VITE_EVERY: the steps between two samples.
// - VITE_PATCH: settings as JSON, on top of the scene's. VITE_NAME: the name of the file.
// - VITE_FOODS: food dots as JSON, each [x, y, radius] in the frame of the scene's shapes (EnvShape in
//   src/model/presets.ts), after the shapes of the scene.
import { it } from 'vitest';
import { commands } from 'vitest/browser';
import { Engine } from '../../../src/engine/engine';
import { FLOW } from '../../../src/engine/flow';
import { WebGl2Backend } from '../../../src/engine/gl/backend';
import type { Backend } from '../../../src/engine/types';
import { WebGpuBackend } from '../../../src/engine/webgpu';
import { constrain, strainLike, type Settings } from '../../../src/model/params';
import { presetById, type EnvShape } from '../../../src/model/presets';

const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;
const KIND = env.VITE_KIND ?? 'webgpu';
const SCENE = env.VITE_SCENE ?? 'foraging-maze';
const SEED = Number(env.VITE_SEED ?? 1);
const STRAINS = Number(env.VITE_STRAINS ?? 2);
const STEPS = Number(env.VITE_STEPS ?? 6000);
const EVERY = Number(env.VITE_EVERY ?? 500);
const PATCH = JSON.parse(env.VITE_PATCH ?? '{}') as Partial<Settings>;
const NAME = env.VITE_NAME ?? `strains-${SCENE}-${KIND}-n${String(STRAINS)}-s${String(SEED)}`;
const FOODS = (JSON.parse(env.VITE_FOODS ?? '[]') as [number, number, number][]).map(([x, y, r]): EnvShape => ({
  kind: 'food',
  at: [x, y],
  r,
}));

it('counts the strains of a scene with the flow', async () => {
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 800;
  const backend: Backend = KIND === 'webgpu' ? await WebGpuBackend.create(canvas) : WebGl2Backend.create(canvas);
  const preset = presetById(SCENE);
  if (!preset) throw new Error(`no scene ${SCENE}`);
  const base = preset.settings();
  const [first] = base.strains;
  if (!first) throw new Error(`the scene ${SCENE} has no strain`);
  const strains =
    STRAINS > 0 ? Array.from({ length: STRAINS }, (_, i) => (i === 0 ? first : strainLike(first, i))) : base.strains;
  const count = strains.length;
  const settings = constrain({ ...base, seed: SEED, flow: true, strains, ...PATCH });
  const engine = await Engine.create(canvas, settings, undefined, backend);
  await engine.load(settings, [...(preset.env ?? []), ...FOODS]);
  const sim = engine.sim;
  const rows: string[] = [];
  const sample = async () => {
    const alive = (await sim.alive()).slice(0, count);
    const tubes: number[] = [];
    const fed: number[] = [];
    const starved: number[] = [];
    const sites: number[] = [];
    for (let strain = 0; strain < count; strain++) {
      const memory = await sim.readFlow(strain);
      let [t, f, s, r] = [0, 0, 0, 0];
      for (let i = 0; i < memory.length; i += 4) {
        if ((memory[i + 3] ?? 0) !== 0) r++;
        if ((memory[i + 1] ?? 0) < FLOW.bodyLow) continue;
        t++;
        if ((memory[i] ?? 0) > FLOW.birthFrom) f++;
        if ((memory[i] ?? 0) < FLOW.half) s++;
      }
      tubes.push(t);
      fed.push(f);
      starved.push(s);
      sites.push(r);
    }
    // The largest trail of each strain, in deposits of that strain: a cell holds a tube from FLOW.trailLow on.
    const trail = await sim.readTrail();
    const top = settings.strains.map((strain, lane) => {
      let most = 0;
      for (let i = lane; i < trail.length; i += 4) most = Math.max(most, trail[i] ?? 0);
      return +(most / Math.max(strain.deposit, 1e-6)).toFixed(3);
    });
    rows.push(JSON.stringify({ step: sim.step, alive, tubes, fed, starved, sites, top }));
  };
  await sample();
  while (sim.step < STEPS) {
    for (let done = 0; done < EVERY; done += 50) {
      sim.run(Math.min(50, EVERY - done));
      await sim.finish();
    }
    await sample();
  }
  await commands.writeFile(`research/flow/out/engine/${NAME}.jsonl`, rows.join('\n') + '\n');
  engine.destroy();
  backend.destroy();
}, 3_600_000);
