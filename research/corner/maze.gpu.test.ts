// The Foraging maze from one food (ADR 0025, D1b; ADR 0027, "Growth after the merge of ADR 0025"), in the real
// engine: the harness behind those tables, put into the repository with the amendment of ADR 0025 of 2026-11-13
// (README.md). Not a test of the app: it runs only when asked, with the configuration research/vitest.config.ts.
//
// Built as the app builds a scene (Engine.create and Engine.load on a canvas of the screen's shape). Every 100 steps
// the flood fill of ADR 0019 (connected() below) checks for a path of trail from the bottom-right food to the
// top-left one. One line per screen and seed goes to research/corner/out/<label>-<kind>.txt. Environment variables:
//
// - VITE_MZ_KIND: webgpu or webgl2. VITE_MZ_LABEL: the name of the file.
// - VITE_MZ_FLOW: start (the scene as it loads), or inoc100 and inoc1000: the start layout Empty, and from step 100 or
//   1,000 a hold of Inoculate on the bottom-right food for 1 s (60 frames at 60 Hz, 2 steps a frame, the default brush
//   of 18 px), through Engine.agentTool() and Engine.frame() as the app does.
// - VITE_MZ_SEEDS, VITE_MZ_ASPECTS (canvas sizes), VITE_MZ_STEPS, VITE_MZ_SCENE, VITE_MZ_PATCH (settings as JSON).
import { it } from 'vitest';
import { commands } from 'vitest/browser';
import { Engine } from '../../src/engine/engine';
import { WebGl2Backend } from '../../src/engine/gl/backend';
import { AgentToolKind, inoculateRate } from '../../src/engine/pack';
import type { Backend } from '../../src/engine/types';
import { WebGpuBackend } from '../../src/engine/webgpu';
import type { Settings } from '../../src/model/params';
import { presetById } from '../../src/model/presets';

const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;
const KIND = env.VITE_MZ_KIND ?? 'webgpu';
const SEEDS = (env.VITE_MZ_SEEDS ?? '1,2,3,4,5,6,7,8,9,10').split(',').map(Number);
const ASPECTS = (env.VITE_MZ_ASPECTS ?? '1280x720,1280x800,800x800').split(',');
const STEPS = Number(env.VITE_MZ_STEPS ?? 15000);
const LABEL = env.VITE_MZ_LABEL ?? 'maze';
const PATCH = JSON.parse(env.VITE_MZ_PATCH ?? '{}') as Partial<Settings>;
const SCENE = env.VITE_MZ_SCENE ?? 'foraging-maze';
const FLOW = env.VITE_MZ_FLOW ?? 'start';
/** The steps at which a line gives the agents alive and the share of them near a wall. */
const MARKS = [500, 1000, 2000, 3000, 5000, 7500, 10000, 15000];

/**
 * The flood fill of ADR 0019: the open cells whose 3 × 3 mean trail (over open cells) lies above `scale` times the
 * mean trail of the open cells, and the food cells, joined over 8 neighbours. True if it joins a food cell right of
 * and below the middle (the bottom-right food) with one left of and above it (the top-left food).
 */
function connected(trail: Float32Array, envBytes: Uint8Array, w: number, h: number, scale: number) {
  const open = (c: number) => (envBytes[c * 4] ?? 0) < 128;
  const food = (c: number) => (envBytes[c * 4 + 1] ?? 0) > 0;
  let sum = 0;
  let n = 0;
  for (let c = 0; c < w * h; c++)
    if (open(c)) {
      sum += trail[c * 4] ?? 0;
      n++;
    }
  const threshold = (scale * sum) / n;
  const path = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = y * w + x;
      if (!open(c)) continue;
      let s = 0;
      let m = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const [xx, yy] = [x + dx, y + dy];
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const d = yy * w + xx;
          if (!open(d)) continue;
          s += trail[d * 4] ?? 0;
          m++;
        }
      if (s / m > threshold || food(c)) path[c] = 1;
    }
  const isB = (c: number) => food(c) && c % w > w / 2 && Math.floor(c / w) > h / 2;
  const isA = (c: number) => food(c) && c % w < w / 2 && Math.floor(c / w) < h / 2;
  const seen = new Uint8Array(w * h);
  const queue: number[] = [];
  for (let c = 0; c < w * h; c++)
    if (isB(c)) {
      seen[c] = 1;
      queue.push(c);
    }
  while (queue.length > 0) {
    const c = queue.pop() ?? 0;
    if (isA(c)) return true;
    const [x, y] = [c % w, Math.floor(c / w)];
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const [xx, yy] = [x + dx, y + dy];
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const d = yy * w + xx;
        if (!seen[d] && path[d]) {
          seen[d] = 1;
          queue.push(d);
        }
      }
  }
  return false;
}

it('grows through the Foraging maze', async () => {
  const backend: Backend =
    KIND === 'webgpu'
      ? await WebGpuBackend.create(document.createElement('canvas'))
      : WebGl2Backend.create(document.createElement('canvas'));
  // One backend for all runs: an engine destroys its backend, this one is lent.
  const lent = new Proxy(backend, {
    get(target, key) {
      if (key === 'destroy') return () => undefined;
      return Reflect.get(target, key, target) as unknown;
    },
  });
  const preset = presetById(SCENE);
  if (!preset) throw new Error(`no scene ${SCENE}`);
  const lines: string[] = [];
  for (const aspect of ASPECTS) {
    const [cw, ch] = aspect.split('x').map(Number) as [number, number];
    for (const seed of SEEDS) {
      const base = preset.settings();
      const layout = FLOW === 'start' ? base.layout : 'empty';
      const s: Settings = { ...base, seed, layout, growth: true, ...PATCH };
      const canvas = document.createElement('canvas');
      [canvas.width, canvas.height] = [cw, ch];
      const engine = await Engine.create(canvas, s, undefined, lent);
      await engine.load(s, preset.env ?? []);
      const sim = engine.sim;
      const { width: w, height: h } = sim;
      const envBytes = await sim.readEnv();
      // The centre of the bottom-right food, and the default brush of 18 px in cells.
      const [fx, fy] = [0.9 * w, 0.9 * h];
      const brush = 18 * Math.max(w / cw, h / ch);
      const startAlive = (await sim.alive())[0] ?? 0;
      let placed = -1;
      const holdAt = FLOW.startsWith('inoc') ? Number(FLOW.slice(4)) : -1;
      let reached = -1;
      let half = -1;
      let nearA = -1;
      const pop: string[] = [];
      let now = 0;
      for (let step = 100; step <= STEPS; step += 100) {
        if (holdAt >= 0 && step - 100 <= holdAt && holdAt < step) {
          sim.run(holdAt - (step - 100));
          const before = (await sim.alive())[0] ?? 0;
          const rate = inoculateRate(brush, engine.settings, sim.agents, 0);
          engine.paused = false;
          for (let f = 0; f < 60; f++) {
            engine.agentTool({ kind: AgentToolKind.inoculate, x: fx, y: fy, radius: brush, strain: 0, rate });
            now += 1000 / 60;
            engine.frame(now, 2);
          }
          await sim.finish();
          placed = ((await sim.alive())[0] ?? 0) - before;
          sim.run(step - sim.step);
        } else sim.run(100);
        const trail = await sim.readTrail();
        if (reached < 0 && connected(trail, envBytes, w, h, 1)) reached = sim.step;
        if (half < 0 && connected(trail, envBytes, w, h, 0.5)) half = sim.step;
        if (MARKS.includes(step) || step === STEPS) {
          const alive = (await sim.alive())[0] ?? 0;
          const living = (await sim.readAgents()).filter((a) => a.bits & 4);
          // Within 4 cells of a wall or of the box's edge.
          const nearWall = (a: { x: number; y: number }) => {
            const [ax, ay] = [Math.floor(a.x), Math.floor(a.y)];
            for (let dy = -4; dy <= 4; dy++)
              for (let dx = -4; dx <= 4; dx++) {
                const [xx, yy] = [ax + dx, ay + dy];
                if (xx < 0 || yy < 0 || xx >= w || yy >= h || (envBytes[(yy * w + xx) * 4] ?? 0) >= 128) return true;
              }
            return false;
          };
          const share = living.length > 0 ? Math.round((100 * living.filter(nearWall).length) / living.length) : 0;
          pop.push(`${String(step)}:${String(alive)}/w${String(share)}`);
        }
        if (nearA < 0) {
          // The first step with an agent near the centre of the top-left food.
          const agents = await sim.readAgents();
          if (agents.some((a) => a.bits & 4 && Math.hypot(a.x - 0.1 * w, a.y - 0.1 * h) < 0.03 * h)) nearA = step;
        }
        if (reached > 0 && step >= 15000) break;
      }
      const final = connected(await sim.readTrail(), envBytes, w, h, 1);
      const line = [
        `MAZE ${KIND} ${SCENE} ${FLOW} ${aspect} grid=${String(w)}x${String(h)} n=${String(sim.agents)}`,
        `start=${String(startAlive)} placed=${String(placed)} brush=${brush.toFixed(1)} seed=${String(seed)}`,
        `reached=${String(reached)} half=${String(half)} nearA=${String(nearA)} final=${String(final)}`,
        `pop=${pop.join(',')}`,
      ].join(' ');
      console.log(line);
      lines.push(line);
      await commands.writeFile(`research/corner/out/${LABEL}-${KIND}.txt`, lines.join('\n') + '\n');
      engine.destroy();
    }
  }
  backend.destroy();
}, 7_200_000);
