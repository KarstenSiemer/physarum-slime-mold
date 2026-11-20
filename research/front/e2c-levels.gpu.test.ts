// The diagnosis of part E2c of the engine of stage 4 (ADR 0072; E2c-NOTES.md): the level of the network of each strain
// against the ground beside it in the start scene with the rules of stage 4, on both backends. Per strain at a few
// steps: the mean pressure of the four lanes at the sinks, on the network (g > 0), on the ground within 7 cells of the
// network (what the sensors of the front read) and on the ground beyond.
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
const MARKS = (env.VITE_MARKS ?? '20,50,100,200,300,500').split(',').map(Number);
const EXTRA = JSON.parse(env.VITE_EXTRA ?? '{}') as Record<string, unknown>;
const OUT = env.VITE_OUT ?? 'e2c-levels';
// 'dish160': one strain in a dish of 160 × 160 cells with one food in the middle, as the dish of the prototype.
const SCENE = env.VITE_SCENE ?? 'start';

const median = (v: number[]) => {
  if (v.length === 0) return NaN;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)]!;
};
const f = (v: number) => (Number.isFinite(v) ? v.toFixed(Math.abs(v) < 100 ? 1 : 0) : '-');

it('reads the level of each network against its ground', { timeout: 3_600_000 }, async () => {
  const rows: string[] = [];
  const preset = presetById(START);
  if (!preset) throw new Error(`no scene ${START}`);
  for (const kind of KINDS)
    for (const seed of SEEDS) {
      const canvas = document.createElement('canvas');
      canvas.width = 1280;
      canvas.height = 800;
      const backend: Backend = kind === 'webgpu' ? await WebGpuBackend.create(canvas) : WebGl2Backend.create(canvas);
      const base = preset.settings();
      const dish = SCENE === 'dish160';
      const settings = {
        ...base,
        ...(dish ? { strains: base.strains.slice(0, 1), lattice: [160, 160] as [number, number] } : {}),
        seed,
        territory: true,
        ...EXTRA,
      };
      const engine = await Engine.create(canvas, settings, undefined, backend);
      await engine.load(settings, dish ? [{ kind: 'food', at: [0, 0], r: 5 / 160 }] : (preset.env ?? []));
      const sim = engine.sim;
      const strains = engine.settings.strains.length;
      const envAll = await sim.readEnv();
      let done = 0;
      for (const mark of MARKS) {
        sim.run(mark - done);
        done = mark;
        await sim.finish();
        const alive = await sim.alive();
        const st = await sim.readSinkState();
        const parts: string[] = [];
        for (let s = 0; s < strains; s++) {
          const [m, r, p] = [await sim.readFlow(s), await sim.readSinks(s), await sim.readPressure(s)];
          const cells = m.length / 4;
          const w = Math.round(Math.sqrt(cells));
          const mean = (c: number) =>
            ((p[4 * c] ?? 0) + (p[4 * c + 1] ?? 0) + (p[4 * c + 2] ?? 0) + (p[4 * c + 3] ?? 0)) / 4;
          const g = (c: number) => (m[4 * c + 2] ?? 0) > 0;
          // The distance of every cell from the network, in steps of 8 neighbours, up to 8.
          const dist = new Uint8Array(cells).fill(255);
          let front: number[] = [];
          for (let c = 0; c < cells; c++)
            if (g(c)) {
              dist[c] = 0;
              front.push(c);
            }
          for (let d = 1; d <= 7; d++) {
            const nextFront: number[] = [];
            for (const c of front) {
              const [x, y] = [c % w, Math.floor(c / w)];
              for (let dy = -1; dy <= 1; dy++)
                for (let dx = -1; dx <= 1; dx++) {
                  const [a, b] = [x + dx, y + dy];
                  if (a < 0 || b < 0 || a >= w || b >= w) continue;
                  const n = b * w + a;
                  if (dist[n] !== 255 || (envAll[4 * n] ?? 0) !== 0) continue;
                  dist[n] = d;
                  nextFront.push(n);
                }
            }
            front = nextFront;
          }
          const [sink, net, near, far]: [number[], number[], number[], number[]] = [[], [], [], []];
          for (let c = 0; c < cells; c++) {
            if ((envAll[4 * c] ?? 0) !== 0) continue;
            const v = mean(c);
            if (v === 0 && !g(c) && dist[c] === 255) continue;
            if (g(c)) {
              net.push(v);
              if ((r[c] ?? 0) < 0) sink.push(v);
            } else if (dist[c]! <= 7) near.push(v);
            else far.push(v);
          }
          const lo = (v: number[]) => v.reduce((a, b) => Math.min(a, b), Infinity);
          const hi = (v: number[]) => v.reduce((a, b) => Math.max(a, b), -Infinity);
          parts.push(
            `s${String(s)} alive ${String(alive[s])} N ${String(st[s * 8 + 2])} takes ${String(st[s * 8 + 4])} ` +
              `sinks ${f(median(sink))} net [${f(lo(net))} ${f(median(net))} ${f(hi(net))}] ` +
              `near [${f(lo(near))} ${f(median(near))} ${f(hi(near))}] far ${f(median(far))}`,
          );
        }
        rows.push(`${kind} seed ${String(seed)} step ${String(sim.step)}: ${parts.join(' | ')}`);
      }
      engine.destroy();
      await commands.writeFile(`research/front/out/${OUT}.txt`, rows.join('\n') + '\n');
    }
});
