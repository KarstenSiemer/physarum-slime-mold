// The measure of the floor of the white level (ADR 0090; PLAN-2026-11-22.md, section 1.4): in every frame, the gain
// of the frame times the median trail of the cells that hold an agent. Both come from the trail that the frame draws.
// The gain is the one the frame draws with (the smoothed levels before the measurement of the frame lands, or the
// fixed gain before the first one); `after` is the gain once the measurement of the frame has landed, the next frame's.
// The median is counted on the CPU from the picture and the agents, not from the histogram of the engine. The run steps as the app
// steps (2 steps per frame) and waits for the GPU after every frame, as the app does with 16 ms between frames.
// Pictures at the steps of VITE_PICS: the frame as the app draws it. Not a test of the app.
//
// The owner's link (research/front/out/owner/owner.gpu.test.ts), one dab of the Inoculate tool in the middle:
//   VITE_NAME=link-webgpu npx vitest run --config research/vitest.config.ts research/front/levels.gpu.test.ts
// Food ring with the rules of the growth front:
//   VITE_NAME=ring-webgpu VITE_SOURCE=food-ring VITE_PATCH='{"territory":true}' VITE_INOC=0 VITE_ZOOM=1 \
//   VITE_PICS=500,1000,2000,3000,4000 VITE_STEPS=4000 npx vitest run --config research/vitest.config.ts \
//   research/front/levels.gpu.test.ts
// VITE_BACKEND=webgl2 runs the other backend. The record is research/front/out/levels/<name>/record.jsonl, its last
// line the largest product and its step.
import { it } from 'vitest';
import { commands } from 'vitest/browser';
import { Engine } from '../../src/engine/engine';
import { WebGl2Backend } from '../../src/engine/gl/backend';
import { AgentToolKind } from '../../src/engine/pack';
import { equilibrium } from '../../src/engine/sizing';
import type { Backend } from '../../src/engine/types';
import { WebGpuBackend } from '../../src/engine/webgpu';
import { constrain, type Settings } from '../../src/model/params';
import { presetById } from '../../src/model/presets';
import { decodeLink } from '../../src/model/url';

const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;
/** The owner's link of 2026-11-22: Food ring on an empty dish of 1536 × 1536 cells, the rules off. */
const HASH =
  's=VVLBbtswDP0X7qoGtmOvqW7d2uyyoYcU2KHoQbFoR6gsGpLcJCv67wMlO20BwxAf-Ci99_gGAVGDrDbXN5ui2VQbAR4D2SkaciDLZv1dgFUxmhZBuslaLs80RZCAwxjPIGBPk9PKn0GCNuEAAlqy1gRDLoCMfkIBA2m0zDlFdBp1anpFj3pLpEF2ygYU0Hs6xsNCChHHB6_Rg4SALuBVZ3yIIKCzdFy6-Hyvewwga-acLYKEHi0I_v8kSzxgMJZvDQc67lp08XInI4_THi9vTS3WDPgZ2HpiTgY0umDiGWSxKkoB2nTdFLJjAjoivYseXc9KilWxFmBNf4hfwGYGf82KSwGBn3WHrUqDyy8ObVUbWUaxKvjG6JWxOxUnr3JSBb_SG_eSjq0aVTs_sGoWW-9fkUNaL_Vf4zTbeLMAf0xWMFfqBLK8DP5g53phNwuQ2Jf2xK64ZCd_mw5BlnWd4_pwosrADxUwiasEhDHtZMlkPI0UJo9p8N4SDdkp1s_L9fTGu5by_dZVbVljilgxg_vQBfK3rueVqKpVs0APXRcwgrwW4CkmD-euusl7tzP_8gyNIwUTk1D9KRyvnKbhcfJZdZfWuJxTTScVo1dtzuepFFfz9_z-LMBPNi1s_f4f&e=Y-FMy89P0S3KzEtnYGTk_M_IAAA';
const NAME = env.VITE_NAME ?? 'link-webgpu';
/** 'link': the owner's link; else the id of a scene. */
const SOURCE = env.VITE_SOURCE ?? 'link';
const PATCH = JSON.parse(env.VITE_PATCH ?? '{}') as Partial<Settings>;
const BACKEND = env.VITE_BACKEND ?? 'webgpu';
const STEPS = Number(env.VITE_STEPS ?? 2001);
/** The last step of the measure. */
const UNTIL = Number(env.VITE_UNTIL ?? 2001);
/** The radius of one dab of the Inoculate tool in the middle of the grid; 0: none. */
const INOC = Number(env.VITE_INOC ?? 40);
const ZOOM = Number(env.VITE_ZOOM ?? 3.84); // 400 cells across a canvas of 1000 pixels
const PICS = new Set(
  (env.VITE_PICS ?? '11,31,61,101,151,201,301,451,601,901,1201,2001').split(',').filter(Boolean).map(Number),
);
const OUT = `research/front/out/levels/${NAME}`;

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

it('measures the gain of each frame against the plasm', { timeout: 7_200_000 }, async () => {
  let settings: Settings;
  let food;
  if (SOURCE === 'link') {
    const link = await decodeLink(HASH);
    if (!link) throw new Error('no link');
    settings = constrain({ ...link.settings, ...PATCH });
    food = presetById('food-ring')?.env ?? [];
  } else {
    const preset = presetById(SOURCE);
    if (!preset) throw new Error(`no scene ${SOURCE}`);
    settings = constrain({ ...preset.settings(), ...PATCH });
    food = preset.env ?? [];
  }
  const canvas = document.createElement('canvas');
  [canvas.width, canvas.height] = [1000, 1000];
  const backend: Backend = BACKEND === 'webgl2' ? WebGl2Backend.create(canvas) : await WebGpuBackend.create(canvas);
  const engine = await Engine.create(canvas, settings, undefined, backend);
  await engine.load(settings, food);
  const sim = engine.sim;
  const { width: w, height: h } = sim;
  if (ZOOM !== 1) engine.zoomAt(500, 500, ZOOM);
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
  // The frame draws with this gain until the first measurement (webgpu.ts frame(), gl/backend.ts encode()).
  const fallback = 0.4 / equilibrium(engine.settings);
  const lines = [
    JSON.stringify({ source: SOURCE, backend: BACKEND, patch: PATCH, w, h, agents: sim.agents, fallback }),
  ];
  let worst = { product: 0, step: 0 };
  let now = 0;
  while (sim.step < STEPS) {
    now += 1000 / 60;
    // The measurement of a frame lands after the frame is drawn: the frame draws with the levels of before.
    const gain = backend.levels().gain || fallback;
    engine.frame(now, 2);
    await sim.finish();
    await new Promise((r) => setTimeout(r, 0));
    const k = sim.step;
    const pic = PICS.has(k) || PICS.has(k - 1);
    if (k > UNTIL && !pic) continue;
    const l = backend.levels();
    const drawn = await sim.readPicture();
    const agents = await sim.readAgents();
    const held = new Uint8Array(w * h);
    const trails: number[] = [];
    for (const a of agents) {
      if (!(a.bits & 4)) continue;
      const c = Math.floor(a.y) * w + Math.floor(a.x);
      if (c < 0 || c >= w * h || held[c]) continue;
      held[c] = 1;
      trails.push((drawn[c * 4] ?? 0) + (drawn[c * 4 + 1] ?? 0) + (drawn[c * 4 + 2] ?? 0) + (drawn[c * 4 + 3] ?? 0));
    }
    const sorted = Float32Array.from(trails).sort();
    const median = sorted[Math.min(sorted.length - 1, Math.floor(0.5 * sorted.length))] ?? 0;
    const product = gain * median;
    if (k <= UNTIL && product > worst.product) worst = { product, step: k };
    const after = l.gain || fallback;
    lines.push(JSON.stringify({ step: k, gain, after, black: l.black, cells: trails.length, median, product }));
    if (pic) {
      await commands.writeFile(`${OUT}/pic-${String(k).padStart(5, '0')}.png.b64`, await png(await engine.capture()));
      await commands.writeFile(`${OUT}/record.jsonl`, lines.join('\n') + '\n');
    }
  }
  lines.push(JSON.stringify({ worst }));
  await commands.writeFile(`${OUT}/record.jsonl`, lines.join('\n') + '\n');
});
