// The scene Coarsening network (ADR 0045) in the real engine, measured as Baumgarten, Jones and Hauser 2015 measure
// their model (README.md). Not a test of the app: it runs only when asked, with the configuration
// research/vitest.config.ts.
//
// Built as the app builds a scene (Engine.create and Engine.load on a canvas of 1280 × 800). For each sensor distance
// and seed it runs the scene and writes one line per sample to research/coarsening/out/<label>.jsonl: the agents
// alive, and for each level the cells of the veins, the smallest circle around them, the coverage and the lacunae
// (measure.ts). A run ends when the network has collapsed: no lacuna for VITE_CO_QUIET steps after the last one.
// Environment variables:
//
// - VITE_CO_KIND: webgpu or webgl2. VITE_CO_LABEL: the name of the file.
// - VITE_CO_SO: the sensor distances (3,5,7,15). VITE_CO_SEEDS (1,2,3). VITE_CO_STEPS: the most steps of a run.
// - VITE_CO_LEVELS: the levels of the vein mask, in deposits (0.125,0.25,0.5). VITE_CO_QUIET (1500).
// - VITE_CO_MASKS: every so many steps the mask of the level LEVEL goes to out/masks/ (for veins.ts), and at every
//   sample of the first 1,000 steps; 0: never.
// - VITE_CO_TRAILS: the steps at which the trail goes to out/trails/ (to look at it); empty: none.
// - VITE_CO_PATCH: settings as JSON.
import { it } from 'vitest';
import { commands } from 'vitest/browser';
import { Engine } from '../../src/engine/engine';
import { WebGl2Backend } from '../../src/engine/gl/backend';
import type { Backend } from '../../src/engine/types';
import { WebGpuBackend } from '../../src/engine/webgpu';
import { constrain, type Settings } from '../../src/model/params';
import { presetById } from '../../src/model/presets';
import { coverage, LEVEL, maskText, veinMask } from './measure';

const OUT = 'research/coarsening/out/';
const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;
const list = (text: string | undefined, fallback: string) => (text ?? fallback).split(',').filter(Boolean).map(Number);
const KIND = env.VITE_CO_KIND ?? 'webgpu';
const LABEL = env.VITE_CO_LABEL ?? `coarsen-${KIND}`;
const SOS = list(env.VITE_CO_SO, '3,5,7,15');
const SEEDS = list(env.VITE_CO_SEEDS, '1,2,3');
const STEPS = Number(env.VITE_CO_STEPS ?? 60000);
const LEVELS = list(env.VITE_CO_LEVELS, '0.125,0.25,0.5');
const QUIET = Number(env.VITE_CO_QUIET ?? 1500);
const MASKS = Number(env.VITE_CO_MASKS ?? 0);
const TRAILS = new Set(list(env.VITE_CO_TRAILS, ''));
const PATCH = JSON.parse(env.VITE_CO_PATCH ?? '{}') as Partial<Settings>;

/** The steps between two samples: close at the start, where the network changes fast. */
const stride = (step: number) => (step < 500 ? 25 : step < 3000 ? 50 : 100);

const b64 = (bytes: Uint8Array) => {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
};

it('coarsens the network of Baumgarten, Jones and Hauser 2015', async () => {
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
  const preset = presetById('coarsening');
  if (!preset) throw new Error('no scene coarsening');
  const lines: string[] = [];
  for (const so of SOS)
    for (const seed of SEEDS) {
      const base = preset.settings();
      const s = constrain({
        ...base,
        seed,
        strains: base.strains.map((strain) => ({ ...strain, sensorOffset: so })),
        ...PATCH,
      });
      const canvas = document.createElement('canvas');
      [canvas.width, canvas.height] = [1280, 800];
      const engine = await Engine.create(canvas, s, undefined, lent);
      await engine.load(s, preset.env ?? []);
      const sim = engine.sim;
      const { width: w, height: h } = sim;
      const started = performance.now();
      let lastHole = 0;
      let hadHoles = false;
      while (sim.step < STEPS) {
        sim.run(stride(sim.step));
        const trail = await sim.readTrail();
        const step = sim.step;
        const levels: Record<string, ReturnType<typeof coverage>> = {};
        for (const level of LEVELS) {
          // The level is in deposits: the scene deposits 5 per move.
          const mask = veinMask(trail, w * h, level * (s.strains[0]?.deposit ?? 5));
          levels[String(level)] = coverage(mask, w, h);
          if (level === LEVEL && MASKS > 0 && (step <= 1000 || step % MASKS === 0))
            await commands.writeFile(
              `${OUT}masks/${LABEL}-so${String(so)}-s${String(seed)}-${String(step)}.b64`,
              maskText(mask),
            );
        }
        if (TRAILS.has(step)) {
          const lane0 = new Float32Array(w * h);
          for (let c = 0; c < w * h; c++) lane0[c] = trail[c * 4] ?? 0;
          await commands.writeFile(
            `${OUT}trails/${LABEL}-so${String(so)}-s${String(seed)}-${String(step)}.f32.b64`,
            b64(new Uint8Array(lane0.buffer)),
          );
        }
        const alive = (await sim.alive())[0] ?? 0;
        lines.push(JSON.stringify({ kind: KIND, w, h, so, seed, step, alive, levels }));
        const holes = levels[String(LEVEL)]?.holes ?? 0;
        if (holes > 0) [lastHole, hadHoles] = [step, true];
        if (alive === 0 || (hadHoles && step - lastHole >= QUIET)) break;
      }
      const ms = Math.round(performance.now() - started);
      console.log(`COARSEN ${KIND} so=${String(so)} seed=${String(seed)} steps=${String(sim.step)} ms=${String(ms)}`);
      await commands.writeFile(`${OUT}${LABEL}.jsonl`, lines.join('\n') + '\n');
      engine.destroy();
    }
  backend.destroy();
}, 14_400_000);
