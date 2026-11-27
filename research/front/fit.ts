// The grids that the buffers of stage 4 would change (ADR 0067): the fit of the grid to the memory of a device with the
// bytes per cell of the design and without them, for every scene that runs growth and the flow in the tubes (the
// scenes that may turn the rules of stage 4 on), on the two backends that run growth, six hints of the device's memory
// and six canvases. It runs the fit of the engine itself (Engine.fit()), as research/electrode/fit.ts does.
// Usage: node --import ./research/flow/register.mjs research/front/fit.ts
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CpuBackend } from '../../src/engine/cpu-backend.ts';
import { Engine } from '../../src/engine/engine.ts';
import { flowOn, flowStrains } from '../../src/engine/flow.ts';
import { growthOn } from '../../src/engine/pack.ts';
import { defaultSettings, type Settings } from '../../src/model/params.ts';
import { PRESETS } from '../../src/model/presets.ts';
import { BACKENDS, CANVASES, MEMORY } from '../electrode/fit.ts';

/**
 * The bytes of the design of ADR 0067 per cell, once and per strain, and per agent. Both backends: the territory, two
 * copies of 1 B, and the owner of each cell, 1 B; the key of the order of each agent, 4 B. WebGPU: the sink rate of each
 * strain, 4 B, updated in place. WebGL2: the sink rate in two targets of 4 B, and the pyramid of its sums over squares
 * of 4 × 4 cells, 16 B per square and level: 16 / 15 B per cell.
 */
export const FRONT_BYTES = {
  WebGPU: { once: 3, perStrain: 4, perAgent: 4 },
  WebGL2: { once: 3, perStrain: 8 + 16 / 15, perAgent: 4 },
} as const;

const gridOf = (s: Settings) => (s.lattice ? `lattice ${s.lattice.join(' × ')}` : String(s.resolution));

/** Every case of a scene with growth and the flow, and those whose grid the bytes of stage 4 change. */
export async function frontFit(): Promise<{ cases: number; changes: string[]; scenes: string[] }> {
  const scenes = [
    { id: 'default', settings: () => defaultSettings() },
    ...PRESETS.map((p) => ({ id: p.id, settings: p.settings })),
  ].filter(({ settings }) => {
    const s = settings();
    return flowOn(s) && growthOn(s);
  });
  const changes: string[] = [];
  let cases = 0;
  const device = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  try {
    for (const limits of BACKENDS) {
      const front =
        limits.name === 'WebGPU' ? FRONT_BYTES.WebGPU : limits.name === 'WebGL2' ? FRONT_BYTES.WebGL2 : null;
      // WebGL2 without float blending has no rule of one agent per cell, so no growth, and no stage 4.
      if (!front) continue;
      for (const canvas of CANVASES) {
        const backend = new CpuBackend();
        Object.assign(backend, limits);
        const engine = await Engine.create(
          { width: canvas[0], height: canvas[1] } as HTMLCanvasElement,
          defaultSettings(),
          undefined,
          backend,
        );
        for (const memory of MEMORY) {
          Object.defineProperty(globalThis, 'navigator', { value: { deviceMemory: memory }, configurable: true });
          for (const scene of scenes) {
            cases++;
            const s = scene.settings();
            backend.bytesPerCell = limits.bytesPerCell;
            backend.bytesPerAgent = limits.bytesPerAgent;
            const before = gridOf(engine.fit(s));
            backend.bytesPerCell = limits.bytesPerCell + front.once + front.perStrain * flowStrains(s);
            backend.bytesPerAgent = limits.bytesPerAgent + front.perAgent;
            const now = gridOf(engine.fit(s));
            const hint = memory === undefined ? 'no memory hint' : `a memory hint of ${String(memory)} GB`;
            if (before !== now)
              changes.push(
                `${scene.id} on ${limits.name}, ${hint}, a canvas of ${canvas.join(' × ')}: ${before}, ${now}`,
              );
          }
        }
      }
    }
  } finally {
    if (device) Object.defineProperty(globalThis, 'navigator', device);
  }
  return { cases, changes, scenes: scenes.map((s) => s.id) };
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const { cases, changes, scenes } = await frontFit();
  console.log(`${String(scenes.length)} scenes with growth and the flow: ${scenes.join(', ')}`);
  console.log(`${String(cases)} cases: ${String(changes.length)} with another grid`);
  for (const line of changes) console.log(line);
}
