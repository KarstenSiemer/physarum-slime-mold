// The two scenes of Reid et al. 2012 in the real engine (ADR 0066): when does the colony reach each food, how many
// agents live, and does the slime change the run? Not a test of the app: it runs only when asked, with the
// configuration research/vitest.config.ts (README.md, part 26, has the commands).
//
// One run loads a scene as the app loads it, with its start spot, and steps it. After every step until each food holds
// plasm, and then every 50 steps, it reads the trail: a cell holds plasm when its trail is at or above the low level
// (plasmLevels()), as in y-maze.gpu.test.ts. A food is a site of connected food cells of `env`, named by its middle.
// Every 50 steps it counts the agents and the cells with plasm, in the Y-maze also on the base and on each arm.
// With VITE_SLIME=0 the run drops the slime shapes of the scene: the same scene on blank ground. The digests of the
// agents and of the trail at the last step tell whether the slime changed the run.
//
// Environment variables: VITE_SCENES (ids), VITE_KINDS (webgpu, webgl2), VITE_SEEDS (a list or a range: 1-3),
// VITE_STEPS (the last step), VITE_SLIME (0: without the slime), VITE_SNAPS (steps of a picture: the PNG of the
// canvas as base64, `<name>-<scene>-<kind>-s<seed>-<step>.png.b64`), VITE_NAME. The record is
// research/flow/out/engine/<name>.jsonl, one line per run.
import { it } from 'vitest';
import { commands } from 'vitest/browser';
import { Engine } from '../../../src/engine/engine';
import { WebGl2Backend } from '../../../src/engine/gl/backend';
import { plasmLevels } from '../../../src/engine/slime';
import type { Backend } from '../../../src/engine/types';
import { WebGpuBackend } from '../../../src/engine/webgpu';
import { constrain } from '../../../src/model/params';
import { presetById } from '../../../src/model/presets';
import { yMaze } from '../../../src/model/y-maze';

const OUT = 'research/flow/out/engine/';
const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;
const SCENES = (env.VITE_SCENES ?? 'y-maze,slime-everywhere').split(',');
const KINDS = (env.VITE_KINDS ?? 'webgpu,webgl2').split(',');
const STEPS = Number(env.VITE_STEPS ?? 6000);
const SLIME = env.VITE_SLIME !== '0';
const SNAPS = (env.VITE_SNAPS ?? '').split(',').filter(Boolean).map(Number);
const NAME = env.VITE_NAME ?? `reid${SLIME ? '' : '-blank'}`;
const SEEDS = (env.VITE_SEEDS ?? '1').split(',').flatMap((part) => {
  const [from = 0, to = from] = part.split('-').map(Number);
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
});
/** The steps between two readings once every food holds plasm. */
const SAMPLE = 50;

function b64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function sha(view: ArrayBufferView): Promise<string> {
  const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength).slice();
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The sites of connected food cells of `env` (4 neighbours), each with its cells and its middle in cells. */
function foodSites(bytes: Uint8Array, w: number, h: number) {
  const site = new Int32Array(w * h).fill(-1);
  const sites: { cells: number[]; middle: [number, number] }[] = [];
  for (let c = 0; c < w * h; c++) {
    if ((bytes[c * 4 + 1] ?? 0) < 128 || site[c] !== -1) continue;
    const cells: number[] = [];
    const stack = [c];
    site[c] = sites.length;
    for (let k = stack.pop(); k !== undefined; k = stack.pop()) {
      cells.push(k);
      for (const m of [k + 1, k - 1, k + w, k - w]) {
        const beside = m >= 0 && m < w * h && Math.abs((m % w) - (k % w)) <= 1;
        if (beside && (bytes[m * 4 + 1] ?? 0) >= 128 && site[m] === -1) {
          site[m] = sites.length;
          stack.push(m);
        }
      }
    }
    const mean = (f: (cell: number) => number) => cells.reduce((s, cell) => s + f(cell), 0) / cells.length;
    sites.push({ cells, middle: [mean((cell) => (cell % w) + 0.5), mean((cell) => Math.floor(cell / w) + 0.5)] });
  }
  return sites;
}

it('runs the scenes of Reid et al. 2012 and writes when the colony reaches each food', async () => {
  const lines: string[] = [];
  for (const kind of KINDS)
    for (const id of SCENES)
      for (const seed of SEEDS) {
        const t0 = performance.now();
        const preset = presetById(id);
        if (!preset?.env) throw new Error(`no scene ${id}`);
        const shapes = SLIME ? preset.env : preset.env.filter((e) => e.kind !== 'slime');
        const settings = constrain({ ...preset.settings(), seed });
        const [lw = 1, lh = 1] = settings.lattice ?? [];
        const canvas = document.createElement('canvas');
        [canvas.width, canvas.height] = [1000, Math.round((1000 * lh) / lw)];
        const backend: Backend = kind === 'webgpu' ? await WebGpuBackend.create(canvas) : WebGl2Backend.create(canvas);
        const engine = await Engine.create(canvas, settings, undefined, backend);
        await engine.load(settings, shapes);
        const sim = engine.sim;
        const { width: w, height: h } = sim;
        const sites = foodSites(await sim.readEnv(), w, h);
        const low = plasmLevels(settings)[0] ?? 1;
        const touched: (number | null)[] = sites.map(() => null);
        // In the Y-maze also the plasm on the base and on the own part of each arm.
        const maze = id === 'y-maze' ? yMaze() : undefined;
        const parts = maze ? { base: maze.base, left: maze.arm.left, right: maze.arm.right } : {};
        const series: { step: number; alive: number; plasm: number; parts: Record<string, number> }[] = [];
        const look = async () => {
          const trail = await sim.readTrail();
          const plasm = (c: number) => (trail[c * 4] ?? 0) >= low;
          sites.forEach((site, k) => {
            if (touched[k] === null && site.cells.some(plasm)) touched[k] = sim.step;
          });
          if (sim.step % SAMPLE === 0) {
            let cells = 0;
            for (let c = 0; c < w * h; c++) if (plasm(c)) cells++;
            const inParts = Object.fromEntries(
              Object.entries(parts).map(([name, list]) => [name, list.filter(plasm).length]),
            );
            series.push({ step: sim.step, alive: (await sim.alive())[0] ?? 0, plasm: cells, parts: inParts });
          }
        };
        const stepTo = async (target: number) => {
          while (sim.step < target) {
            engine.frame(performance.now(), Math.min(100, target - sim.step));
            await sim.finish();
          }
        };
        await look();
        while (sim.step < STEPS) {
          const all = touched.every((t) => t !== null);
          const next = all ? Math.min(STEPS, (Math.floor(sim.step / SAMPLE) + 1) * SAMPLE) : sim.step + 1;
          const snap = SNAPS.find((s) => s > sim.step && s <= next);
          await stepTo(snap ?? next);
          await look();
          if (snap !== undefined && sim.step === snap) {
            const blob = await engine.snapshot();
            const file = `${OUT}${NAME}-${id}-${kind}-s${String(seed)}-${String(snap)}.png.b64`;
            await commands.writeFile(file, b64(new Uint8Array(await blob.arrayBuffer())));
          }
        }
        const agents = await sim.readAgents();
        const flat = new Float32Array(agents.length * 4);
        agents.forEach((a, i) => {
          flat.set([a.x, a.y, a.heading, a.bits], i * 4);
        });
        const line = {
          name: NAME,
          kind,
          scene: id,
          seed,
          slime: SLIME,
          grid: [w, h],
          step: sim.step,
          sites: sites.map((site, k) => ({
            middle: site.middle.map((v) => Math.round(v * 10) / 10),
            cells: site.cells.length,
            touched: touched[k],
          })),
          alive: (await sim.alive())[0] ?? 0,
          agentsSha: await sha(flat),
          trailSha: await sha(await sim.readTrail()),
          series,
          ms: Math.round(performance.now() - t0),
        };
        lines.push(JSON.stringify(line));
        await commands.writeFile(`${OUT}${NAME}.jsonl`, lines.join('\n') + '\n');
        console.log(
          `${NAME} ${kind} ${id} seed ${String(seed)}: foods at ${JSON.stringify(line.sites.map((s) => [s.middle, s.touched]))}, ` +
            `alive ${String(line.alive)} at step ${String(sim.step)}, ms ${String(line.ms)}`,
        );
        engine.destroy();
        backend.destroy();
      }
}, 3_600_000);
