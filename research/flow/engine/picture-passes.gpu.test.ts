// The time of the passes of the picture of the tubes alone (tubes.wgsl, tubes.frag; ADR 0034, amendment of
// 2026-11-15), in the real engine, and how the tubes of the scene lie in the tiles of the passes. Not a test of the
// app: it runs only when asked, with the configuration research/vitest.config.ts (README.md, part 10, has the
// command). picture.gpu.test.ts measures a whole frame, whose time holds a step and the render pass; here the
// simulation rests, and the passes of the picture run again and again on the same state, so their time is that of the
// GPU alone. It writes one line per scene and backend to research/flow/out/engine/<name>.jsonl. Environment variables:
// VITE_KINDS, VITE_SCENES (lists), VITE_WARM (steps before the measurement), VITE_BATCH (pictures per sample),
// VITE_BATCHES, VITE_NAME, VITE_PATCH (settings as JSON, on top of the scene's), VITE_SIZE (the pixels of the canvas,
// width and height, which pick the grid), VITE_DUMP (1: also write the picture, the factors and the stream of the
// last state as files <name>-<kind>-<scene>-<field>.f32 beside the lines), VITE_AGAINST (the name of a run with
// VITE_DUMP of another checkout: the largest difference of each field against it). A line holds the SHA-256 digest of
// what the passes read (the trail of the view, the wall bytes, and the memory and the pressure of the flow), so that
// two checkouts compare the same state.
import { it } from 'vitest';
import { commands } from 'vitest/browser';
import { Engine } from '../../../src/engine/engine';
import { WebGl2Backend } from '../../../src/engine/gl/backend';
import { TUBE_REACH, TUBE_WINDOW, TUBES } from '../../../src/engine/tubes';
import type { Backend } from '../../../src/engine/types';
import { WebGpuBackend } from '../../../src/engine/webgpu';
import { constrain } from '../../../src/model/params';
import { presetById } from '../../../src/model/presets';

const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;
const KINDS = (env.VITE_KINDS ?? 'webgpu,webgl2').split(',');
const SCENES = (env.VITE_SCENES ?? 'three-strains,tokyo').split(',');
const WARM = Number(env.VITE_WARM ?? 1500);
const BATCH = Number(env.VITE_BATCH ?? 50);
const BATCHES = Number(env.VITE_BATCHES ?? 11);
const NAME = env.VITE_NAME ?? 'picture-passes';
const PATCH = JSON.parse(env.VITE_PATCH ?? '{}') as Record<string, unknown>;
const [WIDTH = 2560, HEIGHT = 1600] = (env.VITE_SIZE ?? '').split(',').filter(Boolean).map(Number);
const DUMP = env.VITE_DUMP === '1';
const AGAINST = env.VITE_AGAINST;
/** Cells per side of a tile: a workgroup of the passes (sim.ts TUBE_GROUP). */
const TILE = 8;

/**
 * How the tubes lie in the tiles: the cells with a disc of any strain, the tiles whose window (the tile and TUBE_WINDOW
 * cells around it, on the periodic grid wrapped) holds no disc, and per tile the farthest that a disc in its window
 * reaches, as the whole cells of the window that the picture must read (0 to TUBE_WINDOW, −1 without a disc).
 */
function tiles(roots: Float32Array, w: number, h: number, wrap: boolean) {
  const largest = new Float32Array(w * h);
  let discs = 0;
  for (let c = 0; c < w * h; c++) {
    const r = Math.max(roots[c * 4] ?? 0, roots[c * 4 + 1] ?? 0, roots[c * 4 + 2] ?? 0, roots[c * 4 + 3] ?? 0);
    largest[c] = r;
    if (r > 0) discs++;
  }
  const window = new Array<number>(TUBE_WINDOW + 2).fill(0);
  let count = 0;
  for (let ty = 0; ty < h; ty += TILE)
    for (let tx = 0; tx < w; tx += TILE) {
      let top = 0;
      for (let y = ty - TUBE_WINDOW; y < ty + TILE + TUBE_WINDOW; y++)
        for (let x = tx - TUBE_WINDOW; x < tx + TILE + TUBE_WINDOW; x++) {
          const [cx, cy] = wrap ? [(x + w) % w, (y + h) % h] : [x, y];
          if (cx < 0 || cy < 0 || cx >= w || cy >= h) continue;
          top = Math.max(top, largest[cy * w + cx] ?? 0);
        }
      // The whole cells nearer than the reach of the largest disc: a disc reaches a cell at d < radius · root + edge/2.
      const reach = Math.min(TUBES.radius * top + TUBES.edge / 2, TUBE_REACH);
      const cells = top > 0 ? Math.ceil(reach) - 1 : -1;
      window[cells + 1] = (window[cells + 1] ?? 0) + 1;
      count++;
    }
  return { discs: +(discs / (w * h)).toFixed(4), tiles: count, window };
}

async function sha(parts: ArrayBufferView[]): Promise<string> {
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const all = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    all.set(new Uint8Array(p.buffer, p.byteOffset, p.byteLength), at);
    at += p.byteLength;
  }
  const hash = await crypto.subtle.digest('SHA-256', all);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The bytes of a field as base64, in pieces: a string of all of them at once is too long for the call. */
function base64(field: Float32Array): string {
  const bytes = new Uint8Array(field.buffer, field.byteOffset, field.byteLength);
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

function fromBase64(text: string): Float32Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

/** Of two fields: the values that differ, and the largest difference, absolute and against the size of the value. */
function difference(got: Float32Array, want: Float32Array) {
  let [values, largest, relative] = [0, 0, 0];
  for (let i = 0; i < Math.max(got.length, want.length); i++) {
    const [a, b] = [got[i] ?? NaN, want[i] ?? NaN];
    if (Object.is(a, b)) continue;
    values++;
    largest = Math.max(largest, Math.abs(a - b));
    relative = Math.max(relative, Math.abs(a - b) / Math.max(Math.abs(b), 1e-30));
  }
  return { values, largest, relative };
}

it('measures the passes of the picture of the tubes alone', async () => {
  const rows: string[] = [];
  for (const kind of KINDS)
    for (const scene of SCENES) {
      const canvas = document.createElement('canvas');
      canvas.width = WIDTH;
      canvas.height = HEIGHT;
      const backend: Backend = kind === 'webgpu' ? await WebGpuBackend.create(canvas) : WebGl2Backend.create(canvas);
      const preset = presetById(scene);
      if (!preset) throw new Error(`no scene ${scene}`);
      const settings = constrain({ ...preset.settings(), seed: 1, flow: true, showTubes: true, ...PATCH });
      const engine = await Engine.create(canvas, settings, undefined, backend);
      await engine.load(settings, preset.env ?? []);
      const sim = engine.sim;
      for (let i = 0; i < WARM; i += 50) {
        sim.run(50);
        await sim.finish();
      }
      // The passes run when a reader asks for the picture of a stale state (sim.ts pictureTexture, gl/sim.ts
      // pictureTarget()): here the state stays, and only the mark of the picture says that it is stale.
      const inner = sim as unknown as { tubesStale: boolean; pictureTexture?: unknown; pictureTarget?: () => unknown };
      const draw = (): unknown => {
        inner.tubesStale = true;
        return kind === 'webgpu' ? inner.pictureTexture : inner.pictureTarget?.();
      };
      // The first pictures build the passes: not in the sample.
      for (let i = 0; i < 3; i++) draw();
      await sim.finish();
      const times: number[] = [];
      for (let b = 0; b < BATCHES; b++) {
        const t0 = performance.now();
        for (let i = 0; i < BATCH; i++) draw();
        await sim.finish();
        times.push((performance.now() - t0) / BATCH);
      }
      times.sort((a, b) => a - b);
      const fields = {
        picture: await sim.readPicture(),
        roots: await sim.readTubeRoots(),
        stream: await sim.readStream(),
      };
      const lie = tiles(fields.roots, sim.width, sim.height, settings.boundary === 'wrap');
      const read: ArrayBufferView[] = [await sim.readView(), await sim.readShape()];
      for (let strain = 0; strain < settings.strains.length; strain++)
        read.push(await sim.readFlow(strain), await sim.readPressure(strain));
      const file = (name: string, field: string) => `research/flow/out/engine/${name}-${kind}-${scene}-${field}.f32`;
      const against: Record<string, ReturnType<typeof difference>> = {};
      for (const [field, data] of Object.entries(fields)) {
        if (DUMP) await commands.writeFile(file(NAME, field), base64(data), 'base64');
        if (AGAINST)
          against[field] = difference(data, fromBase64(await commands.readFile(file(AGAINST, field), 'base64')));
      }
      rows.push(
        JSON.stringify({
          kind,
          scene,
          strains: settings.strains.length,
          w: sim.width,
          h: sim.height,
          step: sim.step,
          median: +(times[Math.floor(times.length / 2)] ?? 0).toFixed(3),
          min: +(times[0] ?? 0).toFixed(3),
          max: +(times[times.length - 1] ?? 0).toFixed(3),
          ...lie,
          read: await sha(read),
          ...(AGAINST ? { against } : {}),
        }),
      );
      engine.destroy();
      backend.destroy();
    }
  await commands.writeFile(`research/flow/out/engine/${NAME}.jsonl`, rows.join('\n') + '\n');
}, 3_600_000);
