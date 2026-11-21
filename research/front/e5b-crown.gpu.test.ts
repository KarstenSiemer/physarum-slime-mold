// Part E5b of the engine of stage 4 (ADR 0087): the scene Crown of veins in the real engine, for the comparison with
// the prototype's case `none` of research/front/e2n.sh (ADR 0084) and between the backends. Not a test of the app: it
// runs only when asked, with research/vitest.config.ts (`research/front/e5b.sh` runs it). Environment
// variables:
//
// - VITE_KINDS: webgpu, webgl2 or both (a list). VITE_SEEDS: the seeds, a list. VITE_STEPS: the last step.
// - VITE_EVERY: the steps between two records of a run (500): the live agents, the reach (the farthest cell with a tube
//   body from the food, as crownProfile() of measure.ts takes it), the cells of the territory and the sinks.
// - VITE_DUMP: the steps at which the run saves the fields that the measures of the crown read (CrownFields of
//   measure.ts), in the file format of saveState() of crowns.ts: research/front/out/<VITE_OUT>/<kind>/s<seed>-state/
//   s<seed>-<step>.bin.gz. Q is the mean over the four lanes of the flux of flowFlux() of flow-reference.ts, from the
//   memory and the pressure after the step.
// - VITE_OUT: the folder under research/front/out/ (e5b). The records go to <VITE_OUT>/<kind>/s<seed>.rows.jsonl.
import { it } from 'vitest';
import { commands } from 'vitest/browser';
import { Engine } from '../../src/engine/engine';
import { FLOW } from '../../src/engine/flow';
import { flowFlux } from '../../src/engine/flow-reference';
import { WebGl2Backend } from '../../src/engine/gl/backend';
import type { Backend, Sim } from '../../src/engine/types';
import { WebGpuBackend } from '../../src/engine/webgpu';
import { CROWN, presetById } from '../../src/model/presets';

const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;
const KINDS = (env.VITE_KINDS ?? 'webgpu,webgl2').split(',');
const SEEDS = (env.VITE_SEEDS ?? '1,2,3,4,5,6').split(',').map(Number);
const STEPS = Number(env.VITE_STEPS ?? 1500);
const EVERY = Number(env.VITE_EVERY ?? 500);
const DUMP = (env.VITE_DUMP ?? '').split(',').filter(Boolean).map(Number);
const OUT = `research/front/out/${env.VITE_OUT ?? 'e5b'}`;
/** The middle of the food, where the colony starts: the start of the layout of the prototype. */
const START: [number, number] = [CROWN.lattice[0] / 2, CROWN.foodY];

async function gzipBase64(parts: ArrayBufferView[]): Promise<string> {
  const stream = new Blob(parts.map((p) => new Uint8Array(p.buffer, p.byteOffset, p.byteLength) as BlobPart))
    .stream()
    .pipeThrough(new CompressionStream('gzip'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * The record of a step: the live agents, the reach, the cells of the territory and the sinks of the first strain, and
 * the rows below the neck that its agents and its territory reach (`below`, `ground`: 0 while they stay in the neck).
 */
async function record(sim: Sim) {
  const [memory, territory, sinks, owners] = [
    await sim.readFlow(0),
    await sim.readTerritory(),
    await sim.readSinks(0),
    await sim.readOwners(),
  ];
  const w = sim.width;
  let [far, below, ground] = [-1, 0, 0];
  for (let c = 0; c < w * sim.height; c++) {
    const y = Math.floor(c / w);
    if ((owners[c] ?? 0) & 1) below = Math.max(below, y + 1 - CROWN.long);
    if ((territory[c] ?? 0) & 1) ground = Math.max(ground, y + 1 - CROWN.long);
    if ((memory[c * 4 + 1] ?? 0) < FLOW.bodyLow) continue;
    far = Math.max(far, Math.hypot((c % w) + 0.5 - START[0], y + 0.5 - START[1]));
  }
  let [owned, sinkCells] = [0, 0];
  for (const t of territory) owned += t & 1;
  for (const r of sinks) if (r < 0) sinkCells++;
  return {
    alive: (await sim.alive())[0] ?? 0,
    reach: Math.round(far * 10) / 10,
    territory: owned,
    sinks: sinkCells,
    below,
    ground,
  };
}

/** The fields of CrownFields in the order of saveState() of crowns.ts, gzipped. */
async function state(sim: Sim): Promise<string> {
  const [w, h] = [sim.width, sim.height];
  const cells = w * h;
  const envBytes = await sim.readEnv();
  const [memory, pressure, trail, owners, front] = [
    await sim.readFlow(0),
    await sim.readPressure(0),
    await sim.readTrail(),
    await sim.readOwners(),
    await sim.readSlimeFront(),
  ];
  const open = new Uint8Array(cells);
  for (let c = 0; c < cells; c++) open[c] = (envBytes[c * 4] ?? 0) >= 128 ? 0 : 1;
  const occ = Uint8Array.from(owners, (o) => o & 1);
  const flux = flowFlux({ width: w, height: h, boundary: 'box', env: envBytes }, memory, pressure, true);
  const lane = (from: Float32Array, k: number, n: number) =>
    Float32Array.from({ length: cells }, (_, c) => from[c * n + k] ?? 0);
  const Q = Float32Array.from(
    { length: cells },
    (_, c) => ((flux[c * 4] ?? 0) + (flux[c * 4 + 1] ?? 0) + (flux[c * 4 + 2] ?? 0) + (flux[c * 4 + 3] ?? 0)) / 4,
  );
  const head = new Float64Array([w, h, sim.step, START[0], START[1]]);
  return gzipBase64([head, open, occ, front, lane(trail, 0, 4), lane(memory, 1, 4), lane(memory, 0, 4), Q]);
}

it('runs the Crown of veins on both backends', { timeout: 14_400_000 }, async () => {
  const preset = presetById('crown');
  if (!preset) throw new Error('no scene crown');
  for (const kind of KINDS)
    for (const seed of SEEDS) {
      const canvas = document.createElement('canvas');
      canvas.width = 1280;
      canvas.height = 800;
      const backend: Backend = kind === 'webgpu' ? await WebGpuBackend.create(canvas) : WebGl2Backend.create(canvas);
      const settings = { ...preset.settings(), seed };
      const engine = await Engine.create(canvas, settings, undefined, backend);
      await engine.load(settings, preset.env ?? []);
      const sim = engine.sim;
      if (sim.width !== CROWN.lattice[0] || sim.height !== CROWN.lattice[1])
        throw new Error(`grid ${String(sim.width)} × ${String(sim.height)}`);
      const rows: string[] = [];
      const t0 = performance.now();
      for (let done = 0; done < STEPS;) {
        const n = Math.min(EVERY - (done % EVERY), 50 - (done % 50), STEPS - done);
        sim.run(n);
        await sim.finish();
        done += n;
        if (done % EVERY === 0)
          rows.push(
            JSON.stringify({ kind, seed, k: sim.step, ...(await record(sim)), ms: Math.round(performance.now() - t0) }),
          );
        if (DUMP.includes(done))
          await commands.writeFile(
            `${OUT}/${kind}/s${String(seed)}-state/s${String(seed)}-${String(done)}.bin.gz`,
            await state(sim),
            'base64',
          );
      }
      await commands.writeFile(`${OUT}/${kind}/s${String(seed)}.rows.jsonl`, rows.join('\n') + '\n');
      engine.destroy();
      backend.destroy();
    }
});
