// ADR 0100: a scene of the app with a patch of settings, stepped as the app steps it (2 steps per frame), with a record
// every few steps: the alive agents, the cells of plasm, the territory, the tubes and their flow memory, the state of
// the sinks with the budget, and the measure No sheet of study 1d (p1a.ts sheetCounts()): of the open cells that the
// front reached more than 1,500 steps before, the share with a trail of at least a fifth of a deposit. At the picture
// steps two pictures: `app` as the frames draw it, and `fix` with a white level that is at least the median trail of
// the cells that hold an agent. The coordinator's runner of 2026-11-26 (research/front/out/owner/veins.gpu.test.ts of
// the main checkout, git-ignored) with the sheet and the backend added. Not a test of the app. research/front/p100.sh
// runs it; VITE_BACKEND=webgl2 runs WebGL2. The records go to research/front/out/p100/<name>/.
import { it } from 'vitest';
import { commands } from 'vitest/browser';
import { Engine } from '../../src/engine/engine';
import { FLOW } from '../../src/engine/flow';
import { AgentToolKind } from '../../src/engine/pack';
import { plasmLevels } from '../../src/engine/slime';
import type { Simulation } from '../../src/engine/sim';
import { WebGpuBackend } from '../../src/engine/webgpu';
import { WebGl2Backend } from '../../src/engine/gl/backend';
import { constrain, type Settings } from '../../src/model/params';
import { presetById } from '../../src/model/presets';

const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;
const NAME = env.VITE_NAME ?? 'ring';
const SCENE = env.VITE_SCENE ?? 'food-ring';
const PATCH = JSON.parse(env.VITE_PATCH ?? '{}') as Partial<Settings>;
const STEPS = Number(env.VITE_STEPS ?? 8000);
const EVERY = Number(env.VITE_EVERY ?? 10);
const INOC = Number(env.VITE_INOC ?? 0); // the radius of one dab of the Inoculate tool in the middle; 0: none
const ZOOM = Number(env.VITE_ZOOM ?? 1);
const SIDE = Number(env.VITE_SIDE ?? 1000);
const CW = Number(env.VITE_W ?? SIDE);
const CH = Number(env.VITE_H ?? SIDE);
const PICS = new Set((env.VITE_PICS ?? '').split(',').filter(Boolean).map(Number));
const OUT = `research/front/out/p100/${NAME}`;
// A probe only: another flow memory of fresh ground (FLOW.fresh, 0.2 in the app). It changes no file of the app.
const FRESH = env.VITE_FRESH ? Number(env.VITE_FRESH) : undefined;
const TARGET = 1.3;

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
const quantile = (sorted: Float32Array, q: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;

it('runs a scene with a record', { timeout: 7_200_000 }, async () => {
  if (FRESH !== undefined) (FLOW as { fresh: number }).fresh = FRESH;
  const preset = presetById(SCENE);
  if (!preset) throw new Error(`no scene ${SCENE}`);
  const settings = constrain({ ...preset.settings(), ...PATCH });
  const canvas = document.createElement('canvas');
  [canvas.width, canvas.height] = [CW, CH];
  // Both backends have measured() and capture() of the same form; the type of one of them serves both.
  const backend = (
    env.VITE_BACKEND === 'webgl2' ? WebGl2Backend.create(canvas) : await WebGpuBackend.create(canvas)
  ) as WebGpuBackend;
  const engine = await Engine.create(canvas, settings, undefined, backend);
  await engine.load(settings, preset.env ?? []);
  const sim = engine.sim;
  const { width: w, height: h } = sim;
  if (ZOOM !== 1) engine.zoomAt(CW / 2, CH / 2, ZOOM);
  const low = plasmLevels(settings)[0] ?? 1;
  const lines: string[] = [];
  if (INOC > 0) {
    const tries = Math.PI * INOC * INOC;
    sim.run(1, {
      kind: AgentToolKind.inoculate,
      x: w / 2,
      y: h / 2,
      radius: INOC,
      strain: 0,
      revive: Math.min(1, tries / sim.agents),
    });
    await sim.finish();
  }
  lines.push(
    JSON.stringify({
      scene: SCENE,
      patch: PATCH,
      fresh: FLOW.fresh,
      w,
      h,
      agents: sim.agents,
      low,
      territory: settings.territory,
      alive: (await sim.alive())[0],
    }),
  );
  let now = 0;
  let last = -1;
  while (sim.step < STEPS) {
    now += 1000 / 60;
    engine.frame(now, 2);
    await sim.finish();
    await new Promise((r) => setTimeout(r, 0));
    const k = sim.step;
    const pic = PICS.has(k) || PICS.has(k - 1);
    if (Math.floor(k / EVERY) === last && !pic) continue;
    last = Math.floor(k / EVERY);
    const l = backend.levels();
    const alive = (await sim.alive())[0] ?? 0;
    const trail = await sim.readTrail();
    const flow = await sim.readFlow(0);
    const terr = settings.territory ? await sim.readTerritory() : undefined;
    const state = settings.territory ? await sim.readSinkState() : undefined;
    // The measure No sheet of study 1d (p1a.ts sheetCounts()): of the open cells that the front reached more than
    // 1,500 steps before, the share with a trail of at least a fifth of a deposit.
    const fronts = await sim.readSlimeFront();
    const envBytes = await sim.readEnv();
    let old = 0,
      oldPlasm = 0;
    for (let c = 0; c < w * h; c++) {
      const F = fronts[c] ?? 0;
      if (F === 0 || (envBytes[c * 4] ?? 0) >= 128 || k + 1 - F <= 1500) continue;
      old++;
      if ((trail[c * 4] ?? 0) >= 0.2 * (settings.strains[0]?.deposit ?? 5)) oldPlasm++;
    }
    let plasm = 0,
      tubes = 0,
      dsum = 0,
      starved = 0,
      closed = 0,
      ground = 0,
      plasmIn = 0,
      tsum = 0;
    for (let c = 0; c < w * h; c++) {
      const t = trail[c * 4] ?? 0;
      const D = flow[c * 4] ?? 0,
        B = flow[c * 4 + 1] ?? 0;
      if (t >= low) {
        plasm++;
        tsum += t;
      }
      if (B >= 0.05) {
        tubes++;
        dsum += D;
        if (D < 0.01) starved++;
      }
      if (D < 0.01) closed++;
      if (terr && (terr[c] ?? 0) & 1) {
        ground++;
        if (t >= low) plasmIn++;
      }
    }
    const row: Record<string, unknown> = {
      step: k,
      gain: l.gain,
      black: l.black,
      alive,
      plasm,
      trailMean: plasm ? tsum / plasm : 0,
      tubes,
      dMean: tubes ? dsum / tubes : 0,
      starved,
      closed,
      ground,
      plasmIn,
      old,
      sheet: old ? oldPlasm / old : 0,
    };
    if (state)
      Object.assign(row, {
        rate: state[0],
        tubeCells: state[1],
        sinks: state[2],
        ports: state[3],
        takes: state[4],
        budget: state[5],
        front: state[6],
        paid: state[7],
      });
    if (pic) {
      const drawn = await sim.readPicture();
      const agents = await sim.readAgents();
      const onAgents: number[] = [];
      for (const a of agents) {
        if (!(a.bits & 4)) continue;
        const c = Math.floor(a.y) * w + Math.floor(a.x);
        if (c < 0 || c >= w * h) continue;
        onAgents.push(
          (drawn[c * 4] ?? 0) + (drawn[c * 4 + 1] ?? 0) + (drawn[c * 4 + 2] ?? 0) + (drawn[c * 4 + 3] ?? 0),
        );
      }
      const median = quantile(Float32Array.from(onAgents).sort(), 0.5);
      const measured = await backend.measured(sim as Simulation);
      const whiteNow = measured.gain > 0 ? TARGET / measured.gain + measured.black : 0;
      const white = Math.max(whiteNow, median);
      const black = Math.min(measured.black, 0.8 * white, 0.5 * median);
      const fix = { gain: TARGET / (white - black), black, strand: measured.strand };
      Object.assign(row, {
        heldMedian: median,
        measuredGain: measured.gain,
        measuredBlack: measured.black,
        fixGain: fix.gain,
        fixBlack: fix.black,
      });
      const name = String(k).padStart(6, '0');
      await commands.writeFile(`${OUT}/app-${name}.png.b64`, await png(await engine.capture()));
      const raw = new Float32Array(w * h * 3);
      for (let c = 0; c < w * h; c++) {
        raw[c * 3] = trail[c * 4] ?? 0;
        raw[c * 3 + 1] = flow[c * 4] ?? 0;
        raw[c * 3 + 2] = flow[c * 4 + 1] ?? 0;
      }
      await commands.writeFile(`${OUT}/raw-${name}.f32.b64`, b64(new Uint8Array(raw.buffer)));
      await commands.writeFile(`${OUT}/dims.json`, JSON.stringify({ w, h, low }));
      await commands.writeFile(
        `${OUT}/fix-${name}.png.b64`,
        await png(await backend.capture(sim as Simulation, settings, engine.view, canvas.width, canvas.height, fix)),
      );
    }
    lines.push(JSON.stringify(row));
    if (pic || lines.length % 50 === 0) await commands.writeFile(`${OUT}/record.jsonl`, lines.join('\n') + '\n');
  }
  await commands.writeFile(`${OUT}/record.jsonl`, lines.join('\n') + '\n');
});
