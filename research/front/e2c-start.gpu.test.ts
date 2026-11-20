// The diagnosis of part E2c of the engine of stage 4 (ADR 0072; E2c-NOTES.md): the start of each strain in the start
// scene with the rules of stage 4 on both backends: per strain the territory (cells, centre), the agents (count,
// centre, mean distance from the centre of the territory), the tube cells and the sinks, after the load and after a few
// steps.
import { it } from 'vitest';
import { commands } from 'vitest/browser';
import { Engine } from '../../src/engine/engine';
import { WebGl2Backend } from '../../src/engine/gl/backend';
import type { Backend } from '../../src/engine/types';
import { WebGpuBackend } from '../../src/engine/webgpu';
import { presetById, START } from '../../src/model/presets';

const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;
const KINDS = (env.VITE_KINDS ?? 'webgpu,webgl2').split(',');
const SEEDS = (env.VITE_SEEDS ?? '1,2,3').split(',').map(Number);
const MARKS = (env.VITE_MARKS ?? '0,1,2,4,6,8,10,15,20').split(',').map(Number);
const EXTRA = JSON.parse(env.VITE_EXTRA ?? '{}') as Record<string, unknown>;
const OUT = env.VITE_OUT ?? 'e2c-start';

it('reads the start of each strain', { timeout: 3_600_000 }, async () => {
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
      let done = 0;
      for (const mark of MARKS) {
        if (mark > done) sim.run(mark - done);
        done = mark;
        await sim.finish();
        const terr = await sim.readTerritory();
        const owners = await sim.readOwners();
        const agents = await sim.readAgents();
        const st = await sim.readSinkState();
        const w = Math.round(Math.sqrt(terr.length));
        const parts: string[] = [];
        for (let s = 0; s < strains; s++) {
          let [n, sx, sy, own] = [0, 0, 0, 0];
          for (let c = 0; c < terr.length; c++) {
            if (((terr[c] ?? 0) & (1 << s)) !== 0)
              [n, sx, sy] = [n + 1, sx + (c % w) + 0.5, sy + Math.floor(c / w) + 0.5];
            if (((owners[c] ?? 0) & (1 << s)) !== 0) own++;
          }
          const [cx, cy] = [sx / Math.max(1, n), sy / Math.max(1, n)];
          let [a, ax, ay, dist] = [0, 0, 0, 0];
          for (const ag of agents) {
            if ((ag.bits & 3) !== s || (ag.bits & 4) === 0) continue;
            a++;
            ax += ag.x;
            ay += ag.y;
            dist += Math.hypot(ag.x - cx, ag.y - cy);
          }
          const m = await sim.readFlow(s);
          let tubes = 0;
          for (let c = 0; c < m.length / 4; c++) if ((m[4 * c + 2] ?? 0) > 0) tubes++;
          parts.push(
            `s${String(s)} terr ${String(n)} at (${cx.toFixed(2)},${cy.toFixed(2)}) owners ${String(own)} agents ${String(a)} at (${(ax / Math.max(1, a)).toFixed(2)},${(ay / Math.max(1, a)).toFixed(2)}) dist ${(dist / Math.max(1, a)).toFixed(2)} tubes ${String(tubes)} N ${String(st[s * 8 + 2])} R ${(st[s * 8] ?? 0).toPrecision(3)}`,
          );
        }
        rows.push(`${kind} seed ${String(seed)} step ${String(sim.step)}: ${parts.join(' | ')}`);
      }
      engine.destroy();
      await commands.writeFile(`research/front/out/${OUT}.txt`, rows.join('\n') + '\n');
    }
});
