// The diagnosis of part E2c of the engine of stage 4 (ADR 0072; E2c-NOTES.md): in the first steps of the start scene
// with the rules of stage 4, the components of the conducting cells of each strain (4 neighbours, g > 0), the share of
// the sinks that lies on a component without a covered food cell, and the component of the least pressure.
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
const STEPS = Number(env.VITE_STEPS ?? 30);
const EXTRA = JSON.parse(env.VITE_EXTRA ?? '{}') as Record<string, unknown>;
const OUT = env.VITE_OUT ?? 'e2c-islands';

it('finds the components of the sinks', { timeout: 3_600_000 }, async () => {
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
      const least = new Array<number>(strains).fill(0);
      const lostMax = new Array<number>(strains).fill(0);
      for (let k = 0; k < STEPS; k++) {
        sim.run(1);
        await sim.finish();
        const st = await sim.readSinkState();
        for (let s = 0; s < strains; s++) {
          const [m, r, p] = [await sim.readFlow(s), await sim.readSinks(s), await sim.readPressure(s)];
          const cells = m.length / 4;
          const w = Math.round(Math.sqrt(cells));
          const R = st[s * 8] ?? 0;
          const takes = (st[s * 8 + 4] ?? 0) !== 0;
          const g = (c: number) => (m[4 * c + 2] ?? 0) > 0;
          const label = new Int32Array(cells).fill(-1);
          const comps: { size: number; share: number; food: number; low: number; lowAt: number }[] = [];
          for (let c0 = 0; c0 < cells; c0++) {
            if (!g(c0) || label[c0]! >= 0) continue;
            const id = comps.length;
            const comp = { size: 0, share: 0, food: 0, low: Infinity, lowAt: -1 };
            comps.push(comp);
            const stack = [c0];
            label[c0] = id;
            while (stack.length > 0) {
              const c = stack.pop()!;
              comp.size++;
              const steps = Math.floor(Math.abs(r[c] ?? 0) * 16777216);
              const rq = Math.floor((steps + 128) / 256) / 65536;
              if (R > 0) comp.share += rq / R;
              if ((envAll[4 * c + 1] ?? 0) > 0) comp.food++;
              const v = ((p[4 * c] ?? 0) + (p[4 * c + 1] ?? 0) + (p[4 * c + 2] ?? 0) + (p[4 * c + 3] ?? 0)) / 4;
              if (v < comp.low) [comp.low, comp.lowAt] = [v, c];
              const [x, y] = [c % w, Math.floor(c / w)];
              for (const [a, b] of [
                [x + 1, y],
                [x - 1, y],
                [x, y + 1],
                [x, y - 1],
              ] as const) {
                if (a < 0 || b < 0 || a >= w || b >= w) continue;
                const n = b * w + a;
                if (g(n) && label[n]! < 0) {
                  label[n] = id;
                  stack.push(n);
                }
              }
            }
          }
          let lo = Infinity;
          let loAt = -1;
          for (let c = 0; c < cells; c++) {
            const v = ((p[4 * c] ?? 0) + (p[4 * c + 1] ?? 0) + (p[4 * c + 2] ?? 0) + (p[4 * c + 3] ?? 0)) / 4;
            if (v < lo) [lo, loAt] = [v, c];
          }
          least[s] = Math.min(least[s]!, lo);
          const lost = comps.filter((c) => c.food === 0).reduce((a, c) => a + c.share, 0);
          if (takes) lostMax[s] = Math.max(lostMax[s]!, lost);
          const big = comps.reduce((a, c) => (c.size > a.size ? c : a), comps[0] ?? { size: 0 });
          const atLow = loAt >= 0 && g(loAt) ? comps[label[loAt]!] : undefined;
          if (takes && (lost > 0.001 || lo < -2000))
            rows.push(
              `  ${kind} seed ${String(seed)} step ${String(sim.step)} s${String(s)}: comps ${String(comps.length)} largest ${String(big.size)} sink share without food ${lost.toFixed(3)} least mean p ${lo.toFixed(0)} at (${String(loAt % w)},${String(Math.floor(loAt / w))}) g ${(m[4 * loAt + 2] ?? 0).toPrecision(3)} ` +
                (atLow
                  ? `in a comp of ${String(atLow.size)} cells, food ${String(atLow.food)}, share ${atLow.share.toFixed(3)}`
                  : 'on ground'),
            );
        }
      }
      rows.push(
        `${kind} seed ${String(seed)} to step ${String(sim.step)}: least ${least.map((v) => v.toFixed(0)).join('/')} most share without food ${lostMax.map((v) => v.toFixed(3)).join('/')} alive ${(await sim.alive()).join('/')}`,
      );
      engine.destroy();
      await commands.writeFile(`research/front/out/${OUT}.txt`, rows.join('\n') + '\n');
    }
});
