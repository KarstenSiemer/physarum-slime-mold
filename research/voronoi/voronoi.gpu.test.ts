// The scene Voronoi diagram (ADR 0048) in the real engine (README.md). Not a test of the app: it runs only when
// asked, with the configuration research/vitest.config.ts.
//
// Built as the app builds a scene (Engine.create and Engine.load on a canvas of 1280 × 800). For each repellent
// strength, food strength, kind of dot and seed it runs the scene and writes one line per sample to
// research/voronoi/out/<label>.jsonl: the agents alive and two masks, the cells that hold an agent and the cells whose
// trail lies above LEVEL deposits (a quarter). tables.ts makes every number from the masks. Environment variables:
//
// - VITE_VO_KIND: webgpu or webgl2. VITE_VO_LABEL: the name of the file.
// - VITE_VO_SCENE: the scene (voronoi). VITE_VO_SEEDS (1,2,3,4,5). VITE_VO_SAMPLES: the steps of the samples.
// - VITE_VO_LIGHT: the repellent strengths; VITE_VO_FOOD: the food strengths. Empty: the scene's.
// - VITE_VO_DOTS: the kinds of dot. scene: as the scene paints them. hard: the paper's 3 × 3 cells of the full byte,
//   written into the environment. A number: the scene's smooth dot with this radius in cells.
// - VITE_VO_TRAILS: the steps at which the trail goes to out/trails/ (to look at it); empty: none.
// - VITE_VO_PATCH: settings as JSON.
import { it } from 'vitest';
import { commands } from 'vitest/browser';
import { Engine } from '../../src/engine/engine';
import { WebGl2Backend } from '../../src/engine/gl/backend';
import type { Backend } from '../../src/engine/types';
import { WebGpuBackend } from '../../src/engine/webgpu';
import { constrain, type Settings } from '../../src/model/params';
import { presetById, VORONOI_DOTS, type EnvShape } from '../../src/model/presets';
import { maskText, veinMask } from '../coarsening/measure';
import { occupancy } from './measure';

const OUT = 'research/voronoi/out/';
/** A cell is part of the trail mask if its trail lies above this many deposits. */
const LEVEL = 0.25;
const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;
const texts = (text: string | undefined, fallback: string) => (text ?? fallback).split(',').filter(Boolean);
const KIND = env.VITE_VO_KIND ?? 'webgpu';
const LABEL = env.VITE_VO_LABEL ?? `voronoi-${KIND}`;
const SCENE = env.VITE_VO_SCENE ?? 'voronoi';
const SEEDS = texts(env.VITE_VO_SEEDS, '1,2,3,4,5').map(Number);
const SAMPLES = texts(env.VITE_VO_SAMPLES, '100,300,1000,2000,3000,5000').map(Number);
const LIGHTS = texts(env.VITE_VO_LIGHT, 'scene');
const FOODS = texts(env.VITE_VO_FOOD, 'scene');
const DOTS = texts(env.VITE_VO_DOTS, 'scene');
const TRAILS = new Set(texts(env.VITE_VO_TRAILS, '').map(Number));
const PATCH = JSON.parse(env.VITE_VO_PATCH ?? '{}') as Partial<Settings>;

const b64 = (bytes: Uint8Array) => {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
};

it('draws the Voronoi diagram of Jones and Adamatzky 2015', async () => {
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
  for (const dot of DOTS)
    for (const food of FOODS)
      for (const light of LIGHTS)
        for (const seed of SEEDS) {
          const base = preset.settings();
          const s = constrain({
            ...base,
            seed,
            ...(light === 'scene' ? {} : { lightStrength: Number(light) }),
            ...(food === 'scene' ? {} : { foodStrength: Number(food) }),
            ...PATCH,
          });
          const side = s.lattice?.[0] ?? 0;
          const radius = Number(dot);
          const shapes: EnvShape[] = (preset.env ?? []).map((e) =>
            e.kind === 'light' && Number.isFinite(radius) ? { ...e, r: radius / side } : e,
          );
          const canvas = document.createElement('canvas');
          [canvas.width, canvas.height] = [1280, 800];
          const engine = await Engine.create(canvas, s, undefined, lent);
          await engine.load(s, shapes);
          const sim = engine.sim;
          const { width: w, height: h } = sim;
          if (dot === 'hard') {
            // The paper's dot: 3 × 3 cells of the full byte around the cell of each dot, and no other repellent.
            const bytes = await sim.readEnv();
            for (let c = 0; c < w * h; c++) bytes[c * 4 + 2] = 0;
            for (const [dx, dy] of VORONOI_DOTS)
              for (let v = -1; v <= 1; v++)
                for (let u = -1; u <= 1; u++)
                  bytes[((Math.floor(h / 2) + dy + v) * w + Math.floor(w / 2) + dx + u) * 4 + 2] = 255;
            sim.writeEnv(bytes);
          }
          const envBytes = await sim.readEnv();
          let [foodCells, lightSum] = [0, 0];
          for (let c = 0; c < w * h; c++) {
            if (envBytes[c * 4 + 1]) foodCells++;
            lightSum += envBytes[c * 4 + 2] ?? 0;
          }
          const started = performance.now();
          const deposit = s.strains[0]?.deposit ?? 1;
          for (const at of SAMPLES) {
            sim.run(at - sim.step);
            const step = sim.step;
            const trail = await sim.readTrail();
            const agents = await sim.readAgents();
            const alive = (await sim.alive())[0] ?? 0;
            const cells = maskText(occupancy(agents, w, h, (bits) => (bits & 4) !== 0));
            const veins = maskText(veinMask(trail, w * h, LEVEL * deposit));
            if (TRAILS.has(step)) {
              const lane0 = new Float32Array(w * h);
              for (let c = 0; c < w * h; c++) lane0[c] = trail[c * 4] ?? 0;
              await commands.writeFile(
                `${OUT}trails/${LABEL}-${dot}-f${food}-l${light}-s${String(seed)}-${String(step)}.f32.b64`,
                b64(new Uint8Array(lane0.buffer)),
              );
            }
            lines.push(
              JSON.stringify({
                kind: KIND,
                scene: SCENE,
                w,
                h,
                dot,
                food: s.foodStrength,
                light: s.lightStrength,
                foodCells,
                lightSum,
                seed,
                step,
                alive,
                cells,
                veins,
              }),
            );
          }
          const ms = Math.round(performance.now() - started);
          console.log(
            `VORONOI ${KIND} dot=${dot} food=${food} light=${light} seed=${String(seed)} steps=${String(sim.step)} ms=${String(ms)}`,
          );
          await commands.writeFile(`${OUT}${LABEL}.jsonl`, lines.join('\n') + '\n');
          engine.destroy();
        }
  backend.destroy();
}, 14_400_000);
