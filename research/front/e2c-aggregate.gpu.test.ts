// The diagnosis of part E2c of the engine of stage 4 (ADR 0072; E2c-NOTES.md): aggregates of each strain in the start
// scene with the rules of stage 4 on both backends, at a few steps, to find a quantity that differs between the
// backends in every seed: the agents, the territory, the tube cells C, the sinks N, R, the budget, the trail, the tube
// body, the conductivity, the share of the sinks on islands, and the level of the network (the mean pressure weighted
// by the sum of the edges of a cell).
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
const MARKS = (env.VITE_MARKS ?? '10,15,20,30,50,100').split(',').map(Number);
const EXTRA = JSON.parse(env.VITE_EXTRA ?? '{}') as Record<string, unknown>;
const OUT = env.VITE_OUT ?? 'e2c-aggregate';

it('reads aggregates of each strain', { timeout: 3_600_000 }, async () => {
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
      const envAll = await sim.readEnv();
      let done = sim.step;
      for (const mark of MARKS) {
        if (mark > done) sim.run(mark - done);
        done = Math.max(done, mark);
        await sim.finish();
        const alive = await sim.alive();
        const st = await sim.readSinkState();
        const terr = await sim.readTerritory();
        const trail = await sim.readTrail();
        const parts: string[] = [];
        for (let s = 0; s < strains; s++) {
          const [m, r, p] = [await sim.readFlow(s), await sim.readSinks(s), await sim.readPressure(s)];
          const cells = m.length / 4;
          const w = Math.round(Math.sqrt(cells));
          const g = (c: number) => (m[4 * c + 2] ?? 0) > 0;
          let [tsum, bsum, gsum, dsum, t, wsum, wp] = [0, 0, 0, 0, 0, 0, 0];
          const ghost = 1e-5;
          const edge = (a: number, b: number) => (a <= 0 || b <= 0 ? 0 : (2 * a * b) / (a + b));
          for (let c = 0; c < cells; c++) {
            tsum += trail[4 * c + s] ?? 0;
            if (((terr[c] ?? 0) & (1 << s)) !== 0) t++;
            if (!g(c)) continue;
            bsum += m[4 * c + 1] ?? 0;
            gsum += m[4 * c + 2] ?? 0;
            dsum += m[4 * c] ?? 0;
            const [x, y] = [c % w, Math.floor(c / w)];
            let d = 0;
            for (const [a, b] of [
              [x + 1, y],
              [x - 1, y],
              [x, y + 1],
              [x, y - 1],
            ] as const) {
              if (a < 0 || b < 0 || a >= w || b >= w || (envAll[4 * (b * w + a)] ?? 0) !== 0) continue;
              d += edge((m[4 * c + 2] ?? 0) + ghost, (m[4 * (b * w + a) + 2] ?? 0) + ghost);
            }
            const mean = ((p[4 * c] ?? 0) + (p[4 * c + 1] ?? 0) + (p[4 * c + 2] ?? 0) + (p[4 * c + 3] ?? 0)) / 4;
            wsum += d;
            wp += d * mean;
          }
          let sinks = 0;
          for (let c = 0; c < cells; c++) if ((r[c] ?? 0) < 0) sinks++;
          const C = st[s * 8 + 1] ?? 0;
          parts.push(
            `s${String(s)} a ${String(alive[s])} T ${String(t)} C ${String(C)} N ${String(st[s * 8 + 2])} sinks ${String(sinks)} R ${(st[s * 8] ?? 0).toFixed(2)} B ${(st[s * 8 + 5] ?? 0).toFixed(1)} trail ${tsum.toFixed(0)} body ${(bsum / Math.max(1, C)).toFixed(3)} g ${(gsum / Math.max(1, C)).toFixed(4)} D ${(dsum / Math.max(1, C)).toFixed(4)} level ${(wp / Math.max(1e-9, wsum)).toFixed(1)}`,
          );
        }
        rows.push(`${kind} seed ${String(seed)} step ${String(sim.step)}: ${parts.join(' | ')}`);
      }
      engine.destroy();
      await commands.writeFile(`research/front/out/${OUT}.txt`, rows.join('\n') + '\n');
    }
});
