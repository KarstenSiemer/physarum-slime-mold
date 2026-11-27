// The diagnosis of part E2c of the engine of stage 4 (ADR 0072; E2c-NOTES.md): a map of the cells around the least
// pressure of a strain at a step of the start scene with the rules of stage 4. `#` a tube cell (g > 0), `F` a tube cell
// on food, `S` a sink, `a` an agent of the strain on a cell without a tube, `.` the territory of the strain, `,` food
// outside a tube, ` ` other. Below the map: the tube body B of the same cells, in hundredths.
import { it } from 'vitest';
import { commands } from 'vitest/browser';
import { Engine } from '../../src/engine/engine';
import { WebGl2Backend } from '../../src/engine/gl/backend';
import type { Backend } from '../../src/engine/types';
import { WebGpuBackend } from '../../src/engine/webgpu';
import { presetById, START } from '../../src/model/presets';

const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;
// kind:seed:step:strain, several by commas.
const CASES = (env.VITE_CASES ?? 'webgpu:5:7:0,webgl2:1:9:1,webgl2:3:11:2').split(',');
const R = 9;

it('maps the cells around the least pressure', { timeout: 3_600_000 }, async () => {
  const rows: string[] = [];
  const preset = presetById(START);
  if (!preset) throw new Error(`no scene ${START}`);
  for (const spec of CASES) {
    const [kind, seedText, stepText, strainText] = spec.split(':');
    const [seed, step, s] = [Number(seedText), Number(stepText), Number(strainText)];
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 800;
    const backend: Backend = kind === 'webgpu' ? await WebGpuBackend.create(canvas) : WebGl2Backend.create(canvas);
    const settings = { ...preset.settings(), seed, territory: true };
    const engine = await Engine.create(canvas, settings, undefined, backend);
    await engine.load(settings, preset.env ?? []);
    const sim = engine.sim;
    const envAll = await sim.readEnv();
    for (const at of [step - 1, step, step + 1]) {
      if (at > sim.step) sim.run(at - sim.step);
      await sim.finish();
      const [m, r, p, terr, owners] = [
        await sim.readFlow(s),
        await sim.readSinks(s),
        await sim.readPressure(s),
        await sim.readTerritory(),
        await sim.readOwners(),
      ];
      const w = Math.round(Math.sqrt(m.length / 4));
      let low = 0;
      for (let c = 0; c < w * w; c++) if ((p[4 * c] ?? 0) < (p[4 * low] ?? 0)) low = c;
      const [lx, ly] = [low % w, Math.floor(low / w)];
      rows.push(
        `${kind} seed ${String(seed)} step ${String(sim.step)} s${String(s)}: least p ${(p[4 * low] ?? 0).toFixed(0)} at (${String(lx)},${String(ly)})`,
      );
      for (let y = ly - R; y <= ly + R; y++) {
        let line = '';
        let body = '';
        for (let x = lx - R; x <= lx + R; x++) {
          const c = y * w + x;
          const g = (m[4 * c + 2] ?? 0) > 0;
          const food = (envAll[4 * c + 1] ?? 0) > 0;
          const mine = ((owners[c] ?? 0) & (1 << s)) !== 0;
          const inT = ((terr[c] ?? 0) & (1 << s)) !== 0;
          line += g ? ((r[c] ?? 0) < 0 ? 'S' : food ? 'F' : '#') : mine ? 'a' : food ? ',' : inT ? '.' : ' ';
          body += ` ${String(Math.min(99, Math.round((m[4 * c + 1] ?? 0) * 100))).padStart(2)}`;
        }
        rows.push(`  |${line}|   ${body}`);
      }
    }
    engine.destroy();
    await commands.writeFile('research/front/out/e2c-island-map.txt', rows.join('\n') + '\n');
  }
});
