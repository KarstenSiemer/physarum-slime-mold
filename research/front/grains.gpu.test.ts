// The pictures of ADR 0095: a scene with the flow at one step with the switch "Draw the tubes by their flow" on and
// off, and frames a few steps apart with the switch off, so that the grains are seen to move. Not a test of the app.
//
//   npx vitest run --config research/vitest.config.ts research/front/grains.gpu.test.ts
//
// It writes PNG files to research/front/out/grains/: <name>-whole-on and -whole-off (the whole grid), -close-on and
// -close-off (the window of the grid with the most stream), -off-1 to -off-<VITE_FRAMES> (the close view without the
// picture, VITE_GAP steps apart) and -anim-00 and on (one step apart, for an animation), and <name>.json with the
// numbers of the run. Environment variables: VITE_SOURCE (a scene, default food-ring), VITE_PATCH (settings as JSON,
// default {"territory":true}), VITE_BACKEND (webgpu or webgl2), VITE_STEPS (the step of the pictures, default 3000),
// VITE_GAP (default 3), VITE_FRAMES (default 3), VITE_ANIM (frames of the animation, default 24), VITE_SCALE (cells per
// pixel of the close view, default 0.25), VITE_NAME (default <scene>-<backend>).
import { it } from 'vitest';
import { commands } from 'vitest/browser';
import { Engine } from '../../src/engine/engine';
import { WebGl2Backend } from '../../src/engine/gl/backend';
import type { Backend, View } from '../../src/engine/types';
import { WebGpuBackend } from '../../src/engine/webgpu';
import { constrain, type Settings } from '../../src/model/params';
import { presetById } from '../../src/model/presets';

const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;
const SOURCE = env.VITE_SOURCE ?? 'food-ring';
const PATCH = JSON.parse(env.VITE_PATCH ?? '{"territory":true}') as Partial<Settings>;
const BACKEND = env.VITE_BACKEND ?? 'webgpu';
const STEPS = Number(env.VITE_STEPS ?? 3000);
const GAP = Number(env.VITE_GAP ?? 3);
const FRAMES = Number(env.VITE_FRAMES ?? 3);
const ANIM = Number(env.VITE_ANIM ?? 24);
const SCALE = Number(env.VITE_SCALE ?? 0.25);
const NAME = env.VITE_NAME ?? `${SOURCE}-${BACKEND}`;
const OUT = 'research/front/out/grains';
/** The pixels of the canvas per side. */
const SIZE = 800;

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

it('draws the grains with the switch of the picture of the tubes on and off', { timeout: 3_600_000 }, async () => {
  const preset = presetById(SOURCE);
  if (!preset) throw new Error(`no scene ${SOURCE}`);
  const settings = constrain({ ...preset.settings(), ...PATCH, showTubes: true });
  const canvas = document.createElement('canvas');
  [canvas.width, canvas.height] = [SIZE, SIZE];
  const backend: Backend = BACKEND === 'webgl2' ? WebGl2Backend.create(canvas) : await WebGpuBackend.create(canvas);
  const engine = await Engine.create(canvas, settings, undefined, backend);
  await engine.load(settings, preset.env ?? []);
  const sim = engine.sim;
  const whole: View = { center: [...engine.view.center], scale: engine.view.scale };
  while (sim.step < STEPS) {
    sim.run(Math.min(100, STEPS - sim.step));
    await sim.finish();
  }
  // The close view: the window of the grid where the most stream runs through cells with trail.
  const { width: w, height: h } = sim;
  const [stream, trail] = [await sim.readStream(), await sim.readView()];
  const sums = new Float64Array((w + 1) * (h + 1));
  const at = (x: number, y: number) => sums[y * (w + 1) + x] ?? 0;
  let [top, fastest] = [0, 0];
  for (let c = 0; c < w * h; c++) top = Math.max(top, trail[c * 4] ?? 0);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = y * w + x;
      const speed = Math.hypot(stream[c * 4] ?? 0, stream[c * 4 + 1] ?? 0);
      fastest = Math.max(fastest, speed);
      const own = (trail[c * 4] ?? 0) > 0.1 * top ? speed : 0;
      sums[(y + 1) * (w + 1) + x + 1] = own + at(x + 1, y) + at(x, y + 1) - at(x, y);
    }
  const half = Math.min(Math.floor((SIZE * SCALE) / 2), Math.floor(Math.min(w, h) / 2));
  let best = { sum: -1, x: w / 2, y: h / 2 };
  for (let y = half; y <= h - half; y += 2)
    for (let x = half; x <= w - half; x += 2) {
      const sum = at(x + half, y + half) - at(x - half, y + half) - at(x + half, y - half) + at(x - half, y - half);
      if (sum > best.sum) best = { sum, x, y };
    }
  // Windows that hold the same stream tie, and the first of them can hold it in a corner: the view is centred on the
  // middle of the stream in the window.
  let [mass, mx, my] = [0, 0, 0];
  for (let y = best.y - half; y < best.y + half; y++)
    for (let x = best.x - half; x < best.x + half; x++) {
      const own = at(x + 1, y + 1) - at(x, y + 1) - at(x + 1, y) + at(x, y);
      [mass, mx, my] = [mass + own, mx + own * (x + 0.5), my + own * (y + 0.5)];
    }
  const close: View = { center: mass > 0 ? [mx / mass, my / mass] : [best.x, best.y], scale: SCALE };
  const write = async (name: string) =>
    commands.writeFile(`${OUT}/${NAME}-${name}.png`, await png(await engine.capture()), 'base64');
  /** The picture of the moment with the switch on or off, with the levels of that picture, as the app settles them. */
  const both = async (name: string, view: View) => {
    for (const showTubes of [true, false]) {
      await engine.apply({ ...engine.settings, showTubes });
      engine.view = { center: [...view.center], scale: view.scale };
      await backend.settle(sim);
      await write(`${name}-${showTubes ? 'on' : 'off'}`);
    }
  };
  await both('whole', whole);
  await both('close', close);
  // Without the switch, a few steps apart: the levels of the first frame stay, so only the grains change.
  for (let k = 1; k <= FRAMES; k++) {
    if (k > 1) {
      sim.run(GAP);
      await sim.finish();
    }
    await write(`off-${String(k)}`);
  }
  for (let k = 0; k < ANIM; k++) {
    sim.run(1);
    await sim.finish();
    await write(`anim-${String(k).padStart(2, '0')}`);
  }
  const record = { source: SOURCE, patch: PATCH, backend: BACKEND, w, h, steps: STEPS, gap: GAP, close, best, fastest };
  await commands.writeFile(`${OUT}/${NAME}.json`, JSON.stringify(record) + '\n');
});
