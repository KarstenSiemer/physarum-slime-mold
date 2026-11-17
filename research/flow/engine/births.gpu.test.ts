// Where the children of a scene are born and where its agents die, by the flow memory of the cell (ADR 0053). Not a
// test of the app: it runs only when asked, with the configuration research/vitest.config.ts (README.md, part 17).
//
// The run steps a scene of the real engine to each step of VITE_AT. From there it steps VITE_WINDOW steps one at a
// time, and reads the agents and the flow memory before and after each step. A child is an agent that was dead before
// the step and lives after it, or that lives after it more than 2 cells from where it was (a dead agent takes a birth
// by its rank, so it lies anywhere before). A step of an agent is 1 cell.
//
// The class of a birth is the flow memory D of the cell of the child before the step, which is the memory that the
// growth pass of the step reads (docs/model.md, 8.5):
//
// - starved: D < h = 0.01. Only growth places a child there: the flow brings no agent to life below D = 0.5.
// - open: h ≤ D ≤ 0.5. Only growth.
// - fed: D > 0.5. Growth, or the flow that brings a dead agent to life on a tube.
//
// It writes, per window, one map of counts per class and one of the deaths (by the cell before the step), and the
// trail, the flow memory and the tube body of every cell at the end of the window. births.ts reads them.
//
// - VITE_SCENE, VITE_KIND, VITE_SEED, VITE_NAME, VITE_PATCH: as dump.gpu.test.ts.
// - VITE_AT: the steps at which a window starts, as a list. VITE_WINDOW: the steps of a window (300).
// - VITE_RECOVER: the share by which the flow memory of ground without a tube grows per step, in place of
//   FLOW.recover, as dump.gpu.test.ts: 0.00023 is the time of the mark before ADR 0054.
import { it } from 'vitest';
import { commands } from 'vitest/browser';
import { Engine } from '../../../src/engine/engine';
import { FLOW } from '../../../src/engine/flow';
import { WebGl2Backend } from '../../../src/engine/gl/backend';
import type { Backend } from '../../../src/engine/types';
import { WebGpuBackend } from '../../../src/engine/webgpu';
import { constrain } from '../../../src/model/params';
import { presetById } from '../../../src/model/presets';

const OUT = 'research/flow/out/engine/';
const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;
const KIND = env.VITE_KIND ?? 'webgpu';
const SCENE = env.VITE_SCENE ?? 'snail-maze';
const SEED = Number(env.VITE_SEED ?? 1);
const AT = (env.VITE_AT ?? '20000').split(',').map(Number);
const WINDOW = Number(env.VITE_WINDOW ?? 300);
const NAME = env.VITE_NAME ?? `${SCENE}-${KIND}-births-s${String(SEED)}`;
const PATCH = JSON.parse(env.VITE_PATCH ?? '{}') as Record<string, unknown>;
// packFlow() reads the share at every upload of the uniform block, so a share set before the engine starts holds for
// the whole run.
if (env.VITE_RECOVER !== undefined) (FLOW as { recover: number }).recover = Number(env.VITE_RECOVER);
const ALIVE = 4;

function b64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

it('counts the births and the deaths of a scene by the flow memory of their cells', async () => {
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 800;
  const backend: Backend = KIND === 'webgpu' ? await WebGpuBackend.create(canvas) : WebGl2Backend.create(canvas);
  const preset = presetById(SCENE);
  if (!preset) throw new Error(`no scene ${SCENE}`);
  const settings = constrain({ ...preset.settings(), seed: SEED, ...PATCH });
  const engine = await Engine.create(canvas, settings, undefined, backend);
  await engine.load(settings, preset.env ?? []);
  const sim = engine.sim;
  const [w, n] = [sim.width, sim.width * sim.height];
  const write = (kind: string, at: number, data: Float32Array) =>
    commands.writeFile(`${OUT}${NAME}-${kind}-${String(at)}.f32.b64`, b64(new Uint8Array(data.buffer)));
  const log: string[] = [];
  let done = 0;
  for (const start of AT) {
    for (let i = done; i < start;) {
      const next = Math.min(start, i + 16);
      engine.frame(performance.now(), next - i);
      if (i % 64 === 0) await sim.finish();
      i = next;
    }
    await sim.finish();
    const maps = {
      starved: new Float32Array(n),
      open: new Float32Array(n),
      fed: new Float32Array(n),
      died: new Float32Array(n),
    };
    const total = { starved: 0, open: 0, fed: 0, died: 0 };
    let before = await sim.readAgents();
    let memory = await sim.readFlow(0);
    for (let k = 0; k < WINDOW; k++) {
      engine.frame(performance.now(), 1);
      await sim.finish();
      const after = await sim.readAgents();
      after.forEach((a, id) => {
        const b = before[id];
        const lived = b !== undefined && (b.bits & ALIVE) !== 0;
        const lives = (a.bits & ALIVE) !== 0;
        const jumped = lived && lives && Math.hypot(a.x - b.x, a.y - b.y) > 2;
        if (lives && (!lived || jumped)) {
          const c = Math.floor(a.y) * w + Math.floor(a.x);
          const d = memory[c * 4] ?? 0;
          const kind = d < FLOW.half ? 'starved' : d > 0.5 ? 'fed' : 'open';
          maps[kind][c] = (maps[kind][c] ?? 0) + 1;
          total[kind]++;
        }
        if (lived && (!lives || jumped)) {
          const c = Math.floor(b.y) * w + Math.floor(b.x);
          maps.died[c] = (maps.died[c] ?? 0) + 1;
          total.died++;
        }
      });
      before = after;
      memory = await sim.readFlow(0);
    }
    done = start + WINDOW;
    for (const [kind, map] of Object.entries(maps))
      await write(`born-${kind}`.replace('born-died', 'died'), start, map);
    const trail = await sim.readTrail();
    await write(
      'trail',
      start,
      Float32Array.from({ length: n }, (_, c) => trail[c * 4] ?? 0),
    );
    await write(
      'ground',
      start,
      Float32Array.from({ length: n }, (_, c) => memory[c * 4] ?? 0),
    );
    await write(
      'body',
      start,
      Float32Array.from({ length: n }, (_, c) => memory[c * 4 + 1] ?? 0),
    );
    log.push(
      JSON.stringify({ start, steps: WINDOW, w, h: sim.height, alive: await sim.alive(), half: FLOW.half, ...total }),
    );
  }
  await commands.writeFile(`${OUT}${NAME}.jsonl`, log.join('\n') + '\n');
  engine.destroy();
  backend.destroy();
}, 14_400_000);
