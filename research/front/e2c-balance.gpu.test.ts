// The diagnosis of part E2c of the engine of stage 4 (ADR 0072; E2c-NOTES.md): in the first steps of the flux, the
// balance of each component of the network of each strain (4 neighbours, g > 0 after the update): what the sources give
// there less what its sinks take, as the CPU copy computes it (flow-reference.ts sinksAndSources()) from the inputs of
// the GPU. A component without a balance draws its flux through the ground beside it.
import { it } from 'vitest';
import { commands } from 'vitest/browser';
import { Engine } from '../../src/engine/engine';
import { packFlow } from '../../src/engine/flow';
import { flowPorts, sinksAndSources, type FlowGrid } from '../../src/engine/flow-reference';
import { WebGl2Backend } from '../../src/engine/gl/backend';
import { SINK_STATE_LANES } from '../../src/engine/sinks';
import type { FlowSites } from '../../src/engine/sites';
import { packTerritory } from '../../src/engine/territory';
import type { Backend } from '../../src/engine/types';
import { WebGpuBackend } from '../../src/engine/webgpu';
import { presetById, START } from '../../src/model/presets';

const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;
const KINDS = (env.VITE_KINDS ?? 'webgpu,webgl2').split(',');
const SEEDS = (env.VITE_SEEDS ?? '1,2,3,4,5,6').split(',').map(Number);
const STEPS = Number(env.VITE_STEPS ?? 30);
const EXTRA = JSON.parse(env.VITE_EXTRA ?? '{}') as Record<string, unknown>;
const OUT = env.VITE_OUT ?? 'e2c-balance';
const SCENE = env.VITE_SCENE ?? 'start';

it('balances each component of each network', { timeout: 3_600_000 }, async () => {
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
      const s0 = engine.settings;
      const strains = s0.strains.length;
      const sites = (sim as unknown as { sites: FlowSites }).sites;
      const envAll = await sim.readEnv();
      const W = Math.round(Math.sqrt(envAll.length / 4));
      const grid: FlowGrid = { width: W, height: W, boundary: s0.boundary, env: envAll };
      const worst = new Array<number>(strains).fill(0);
      const first = new Array<number>(strains).fill(-1);
      for (let k = 0; k < STEPS; k++) {
        const before: Float32Array[] = [];
        for (let s = 0; s < strains; s++) before.push(await sim.readFlow(s));
        sim.run(1);
        await sim.finish();
        const states = await sim.readSinkState();
        for (let s = 0; s < strains; s++) {
          const state = states.subarray(s * SINK_STATE_LANES, (s + 1) * SINK_STATE_LANES);
          if ((state[4] ?? 0) === 0) continue;
          if (first[s]! < 0) first[s] = sim.step;
          const memory = await sim.readFlow(s);
          const rates = await sim.readSinks(s);
          const u = new Float32Array(packTerritory(packFlow(s0, sites, undefined, s)));
          const ports = flowPorts(grid, u, sites.cells, {
            memory: before[s]!,
            pressure: new Float32Array(0),
            before: new Float32Array(0),
            ports: new Int32Array(128).fill(-1),
          });
          const q = sinksAndSources(u, memory, ports, rates, state);
          const S = (u[0] ?? 0) * 2;
          const g = (c: number) => (memory[4 * c + 2] ?? 0) > 0;
          const label = new Int32Array(W * W).fill(-1);
          const parts: string[] = [];
          for (let c0 = 0; c0 < W * W; c0++) {
            if (!g(c0) || label[c0]! >= 0) continue;
            let [net, size, give, take] = [0, 0, 0, 0];
            const stack = [c0];
            label[c0] = c0;
            while (stack.length > 0) {
              const c = stack.pop()!;
              size++;
              const v = q[c] ?? 0;
              net += v;
              if (v > 0) give += v;
              else take -= v;
              const [x, y] = [c % W, Math.floor(c / W)];
              for (const [a, b] of [
                [x + 1, y],
                [x - 1, y],
                [x, y + 1],
                [x, y - 1],
              ] as const) {
                if (a < 0 || b < 0 || a >= W || b >= W) continue;
                const n = b * W + a;
                if (g(n) && label[n]! < 0) {
                  label[n] = c0;
                  stack.push(n);
                }
              }
            }
            if (Math.abs(net) > 0.01 * S)
              parts.push(`${String(size)} cells give ${(give / S).toFixed(3)} take ${(take / S).toFixed(3)}`);
            worst[s] = Math.max(worst[s]!, Math.abs(net) / S);
          }
          // The port's own cell: whether it conducts after the update.
          const portCells = Array.from({ length: 64 }, (_, i) => ports[i * 2] ?? -1).filter((c) => c >= 0);
          const offPort = portCells.filter((c) => !g(c)).length;
          if (parts.length > 0 || offPort > 0)
            rows.push(
              `  ${kind} seed ${String(seed)} step ${String(sim.step)} s${String(s)}: N ${String(state[2])} ports ${String(portCells.length)} without a tube ${String(offPort)}; unbalanced: ${parts.join('; ')}`,
            );
        }
      }
      rows.push(
        `${kind} seed ${String(seed)}: first flux ${first.join('/')}, the worst net source of a component ${worst.map((v) => v.toFixed(3)).join('/')} of S`,
      );
      engine.destroy();
      await commands.writeFile(`research/front/out/${OUT}.txt`, rows.join('\n') + '\n');
    }
});
