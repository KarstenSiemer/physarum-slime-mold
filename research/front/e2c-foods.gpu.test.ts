// The diagnosis of part E2c of the engine of stage 4 (ADR 0072; E2c-NOTES.md): the food discs of the start scene in
// cells, in the order of the sites.
import { it } from 'vitest';
import { commands } from 'vitest/browser';
import { Engine } from '../../src/engine/engine';
import type { FlowSites } from '../../src/engine/sites';
import { WebGpuBackend } from '../../src/engine/webgpu';
import { presetById, START } from '../../src/model/presets';

it('lists the foods of the start scene', async () => {
  const preset = presetById(START);
  if (!preset) throw new Error(`no scene ${START}`);
  const canvas = document.createElement('canvas');
  const backend = await WebGpuBackend.create(canvas);
  const settings = { ...preset.settings(), territory: true };
  const engine = await Engine.create(canvas, settings, undefined, backend);
  await engine.load(settings, preset.env ?? []);
  const sites = (engine.sim as unknown as { sites: FlowSites }).sites;
  const env = await engine.sim.readEnv();
  const w = Math.round(Math.sqrt(env.length / 4));
  const rows = sites.list.map((s) => {
    const cells = Array.from(sites.cells.subarray(s.offset, s.offset + s.count));
    const xs = cells.map((c) => (c % w) + 0.5);
    const ys = cells.map((c) => Math.floor(c / w) + 0.5);
    const cx = xs.reduce((a, b) => a + b, 0) / cells.length;
    const cy = ys.reduce((a, b) => a + b, 0) / cells.length;
    return [cx, cy, Math.sqrt(cells.length / Math.PI), s.x, s.y].map((v) => Number(v.toFixed(3)));
  });
  await commands.writeFile('research/front/out/e2c-foods.json', JSON.stringify({ w, rows }) + '\n');
  engine.destroy();
});
