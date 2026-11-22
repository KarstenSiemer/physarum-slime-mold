// Study 1b of the plan of 2026-11-22 (ADR 0092): the boom at a new food. A scene of the app with a patch of settings,
// stepped as the app steps it, with a record of the alive agents every few steps. In a window of steps it steps one
// step per frame and sorts every agent that came to life or died by its kind:
// - a respawn (docs/model.md 7.2) puts the agent on the point that its stream RESPAWN draws, so an agent that came to
//   life on exactly that point respawned, and every other one was born (section 9: Jones' rule or a paid birth, 9.1);
// - a starved agent (7.1) drew less than the chance of its cell in its stream STARVE; every other death is the
//   shrinkage of Jones' rule in the growth pass (section 9), or a starved agent's twin by chance (below 2 %).
// The paid claims of a step come from the state of the sinks (9.1); they bound the paid births from above.
// A probe may set constants of FLOW for the run (VITE_FLOW); it changes no file of the app. Not a test of the app.
// Usage: VITE_NAME=today VITE_PATCH='{"territory":true}' VITE_STEPS=14000 VITE_FROM=8500 VITE_TO=12500 \
//   npx vitest run --config research/vitest.config.ts research/front/boom.gpu.test.ts
import { it } from 'vitest';
import { commands } from 'vitest/browser';
import { Engine } from '../../src/engine/engine';
import { FLOW } from '../../src/engine/flow';
import { rngSeed, stream } from '../../src/engine/growth-reference';
import { WebGpuBackend } from '../../src/engine/webgpu';
import { constrain, type Settings } from '../../src/model/params';
import { presetById } from '../../src/model/presets';

const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;
const NAME = env.VITE_NAME ?? 'boom';
const SCENE = env.VITE_SCENE ?? 'food-ring';
const PATCH = JSON.parse(env.VITE_PATCH ?? '{}') as Partial<Settings>;
const FLOW_PATCH = JSON.parse(env.VITE_FLOW ?? '{}') as Record<string, number>;
const STEPS = Number(env.VITE_STEPS ?? 14000);
const EVERY = Number(env.VITE_EVERY ?? 10);
const FROM = Number(env.VITE_FROM ?? 0);
const TO = Number(env.VITE_TO ?? 0);
const SIDE = Number(env.VITE_SIDE ?? 1000);
const PICS = new Set((env.VITE_PICS ?? '').split(',').filter(Boolean).map(Number));
const OUT = `research/front/out/p1b/${NAME}`;
const [RESPAWN, STARVE, ALIVE] = [8, 9, 4];

const b64 = (u: Uint8Array) => {
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};
const png = async (img: ImageData) => {
  const c = new OffscreenCanvas(img.width, img.height);
  c.getContext('2d')?.putImageData(img, 0, 0);
  return b64(new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer()));
};
const f = Math.fround;
// The chance of starvation of agents.wgsl, starved(): death · half² / (D² + half²), in float32.
const starveChance = (d: number) =>
  f(f(f(FLOW.death) * f(FLOW.half * FLOW.half)) / f(f(d * d) + f(FLOW.half * FLOW.half)));

it('sorts the births and the deaths of a run by their kind', { timeout: 7_200_000 }, async () => {
  for (const [k, v] of Object.entries(FLOW_PATCH)) (FLOW as unknown as Record<string, number>)[k] = v;
  const preset = presetById(SCENE);
  if (!preset) throw new Error(`no scene ${SCENE}`);
  const settings = constrain({ ...preset.settings(), ...PATCH });
  const canvas = document.createElement('canvas');
  [canvas.width, canvas.height] = [SIDE, SIDE];
  const backend = await WebGpuBackend.create(canvas);
  const engine = await Engine.create(canvas, settings, undefined, backend);
  await engine.load(settings, preset.env ?? []);
  const sim = engine.sim;
  const { width: w, height: h } = sim;
  const seed = settings.seed >>> 0;
  const lines: string[] = [
    JSON.stringify({
      scene: SCENE,
      patch: PATCH,
      flow: FLOW_PATCH,
      seed,
      w,
      h,
      agents: sim.agents,
      from: FROM,
      to: TO,
    }),
  ];
  const save = () => commands.writeFile(`${OUT}/record.jsonl`, lines.join('\n') + '\n');
  let now = 0;
  let last = -1;
  let before: Awaited<ReturnType<typeof sim.readAgents>> | undefined;
  let flowBefore: Float32Array | undefined;
  const t0 = performance.now();
  while (sim.step < STEPS) {
    const fine = sim.step + 1 >= FROM && sim.step < TO;
    if (fine && !before) [before, flowBefore] = [await sim.readAgents(), await sim.readFlow(0)];
    const k0 = sim.step;
    now += 1000 / 60;
    engine.frame(now, fine ? 1 : 2);
    await sim.finish();
    await new Promise((r) => setTimeout(r, 0));
    const k = sim.step;
    const pic = PICS.has(k) || (!fine && PICS.has(k - 1));
    if (fine && before && flowBefore) {
      // One step: k0 is the step count before it, k = k0 + 1 after it. Each kind is sorted with both counts as the
      // step of the streams (P.grid.w), A = k0 and B = k: one of the two must explain every respawn.
      const after = await sim.readAgents();
      const flow = await sim.readFlow(0);
      const state = await sim.readSinkState();
      let born = 0,
        respawnA = 0,
        respawnB = 0,
        died = 0,
        starvedA = 0,
        starvedB = 0;
      let bornOnVein = 0;
      for (let id = 0; id < after.length; id++) {
        const a = after[id]!,
          b = before[id]!;
        const was = (b.bits & ALIVE) !== 0,
          is = (a.bits & ALIVE) !== 0;
        if (!was && is) {
          born++;
          for (const [s, add] of [
            [k0, 0],
            [k, 1],
          ] as const) {
            const r = stream(rngSeed(id, RESPAWN, s, seed));
            const x = f(r() * w),
              y = f(r() * h);
            if (x === a.x && y === a.y) {
              if (add) respawnB++;
              else respawnA++;
            }
          }
          const c = Math.floor(a.y) * w + Math.floor(a.x);
          if ((flowBefore[c * 4] ?? 0) > FLOW.birthFrom) bornOnVein++;
        } else if (was && !is) {
          died++;
          const c = Math.floor(b.y) * w + Math.floor(b.x);
          const chance = starveChance(flowBefore[c * 4] ?? 0);
          if (stream(rngSeed(id, STARVE, k0, seed))() < chance) starvedA++;
          if (stream(rngSeed(id, STARVE, k, seed))() < chance) starvedB++;
        }
      }
      let veins = 0,
        open = 0;
      for (let c = 0; c < w * h; c++) {
        const D = flow[c * 4] ?? 0,
          B = flow[c * 4 + 1] ?? 0;
        if (B >= FLOW.bodyLow && D > FLOW.birthFrom) veins++;
        if (B >= FLOW.bodyLow && D >= FLOW.half) open++;
      }
      const alive = after.reduce((n, a) => n + ((a.bits & ALIVE) !== 0 ? 1 : 0), 0);
      lines.push(
        JSON.stringify({
          step: k,
          fine: 1,
          alive,
          born,
          respawnA,
          respawnB,
          bornOnVein,
          died,
          starvedA,
          starvedB,
          paid: state[7],
          front: state[6],
          budget: state[5],
          ports: state[3],
          veins,
          open,
        }),
      );
      [before, flowBefore] = [after, flow];
      if (k % 50 === 0) await save();
    } else {
      before = undefined;
      flowBefore = undefined;
      if (Math.floor(k / EVERY) === last && !pic) continue;
      last = Math.floor(k / EVERY);
      const alive = (await sim.alive())[0] ?? 0;
      const row: Record<string, unknown> = { step: k, alive };
      if (k % 100 < 2 || pic) {
        const flow = await sim.readFlow(0);
        let tubes = 0,
          dsum = 0,
          closed = 0,
          veins = 0;
        for (let c = 0; c < w * h; c++) {
          const D = flow[c * 4] ?? 0,
            B = flow[c * 4 + 1] ?? 0;
          if (B >= FLOW.bodyLow) {
            tubes++;
            dsum += D;
            if (D < FLOW.half) closed++;
            if (D > FLOW.birthFrom) veins++;
          }
        }
        Object.assign(row, { tubes, dMean: tubes ? dsum / tubes : 0, closed, veins });
        if (settings.territory) Object.assign(row, { ports: (await sim.readSinkState())[3] });
      }
      if (k % 500 < 2) {
        // The spread of the pressure of lane 0 over the tube cells: the head that the flux between foods needs.
        const [flow, pressure] = [await sim.readFlow(0), await sim.readPressure(0)];
        let lo = Infinity,
          hi = -Infinity;
        for (let c = 0; c < w * h; c++) {
          if ((flow[c * 4 + 1] ?? 0) < FLOW.bodyLow) continue;
          const p = pressure[c * 4] ?? 0;
          if (p < lo) lo = p;
          if (p > hi) hi = p;
        }
        Object.assign(row, { pLow: lo, pHigh: hi });
      }
      lines.push(JSON.stringify(row));
      if (lines.length % 200 === 0) await save();
    }
    if (pic) {
      const name = String(k).padStart(6, '0');
      await commands.writeFile(`${OUT}/app-${name}.png.b64`, await png(await engine.capture()));
    }
  }
  lines.push(JSON.stringify({ done: sim.step, seconds: (performance.now() - t0) / 1000 }));
  await save();
});
